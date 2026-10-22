using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace MaloTCG
{
    public class Launcher : Window
    {
        const string Site = "https://malo-ptcg.cn/";
        readonly WebView2CompositionControl web = new WebView2CompositionControl();
        readonly JavaScriptSerializer json = new JavaScriptSerializer();
        readonly TextBlock status = new TextBlock();
        readonly Button modeButton;
        readonly Button pinButton;
        readonly Border toolbar;
        readonly Border shell;
        readonly RowDefinition toolbarRow;
        readonly Button floatingMenu;
        readonly TextBlock floatingDrag;
        readonly System.Collections.Generic.List<Button> buttons = new System.Collections.Generic.List<Button>();
        readonly bool demo;
        readonly bool selfTest;
        string mode = "home";
        bool ready;
        bool closing;
        bool testing;
        double surface = 0.90;
        bool dark;
        SessionCache sessionCache;
        string restoreScriptId;
        Rect homeBounds;
        Point floatPosition = new Point(double.NaN, double.NaN);

        [STAThread]
        public static void Main(string[] args)
        {
            var app = new Application();
            app.DispatcherUnhandledException += (s, e) => {
                MessageBox.Show("启动器发生错误：" + e.Exception.Message, "MALO-TCG");
                e.Handled = true;
            };
            app.Run(new Launcher(args));
        }

        Launcher(string[] args)
        {
            demo = args.Contains("--demo") || args.Contains("--self-test");
            selfTest = args.Contains("--self-test");
            Title = demo ? "MALO-TCG 桌面启动器 · 演示" : "MALO-TCG 桌面启动器";
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            Width = Math.Min(1024, SystemParameters.WorkArea.Width);
            Height = Math.Min(760, SystemParameters.WorkArea.Height);
            MinWidth = 180;
            MinHeight = 160;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            UseLayoutRounding = true;
            var grid = new Grid();
            toolbarRow = new RowDefinition { Height = new GridLength(28) };
            grid.RowDefinitions.Add(toolbarRow);
            grid.RowDefinitions.Add(new RowDefinition());
            toolbar = new Border { Background = new SolidColorBrush(Color.FromArgb(225, 237, 243, 239)), CornerRadius = new CornerRadius(8, 8, 0, 0) };
            var strip = new DockPanel { LastChildFill = true };
            toolbar.Child = strip;
            var controls = new StackPanel { Orientation = Orientation.Horizontal };
            DockPanel.SetDock(controls, Dock.Right);
            controls.Children.Add(MakeButton("主页", "回到完整页面和账号登录", async () => await SetMode("home")));
            modeButton = MakeButton("悬浮", "切换微缩／详细悬浮窗", async () => await SetMode(mode == "mini" ? "detail" : "mini"));
            controls.Children.Add(modeButton);
            pinButton = MakeButton("钉", "开启／关闭窗口置顶", () => { Topmost = !Topmost; pinButton.Foreground = Topmost ? Brushes.SeaGreen : Brushes.DimGray; });
            controls.Children.Add(pinButton);
            controls.Children.Add(MakeButton("⋯", "透明度、刷新和最小化", ShowMenu));
            controls.Children.Add(MakeButton("×", "关闭启动器", Close));
            strip.Children.Add(controls);
            var drag = new TextBlock { Text = " ⠿", FontSize = 15, Foreground = Brushes.DimGray, VerticalAlignment = VerticalAlignment.Center, Background = Brushes.Transparent, Cursor = Cursors.SizeAll, ToolTip = "按住拖动窗口" };
            drag.MouseLeftButtonDown += (s, e) => { if (e.ClickCount == 1) DragMove(); };
            strip.Children.Add(drag);
            grid.Children.Add(toolbar);
            var content = new Grid();
            Grid.SetRow(content, 1);
            status.Text = "正在加载在线练牌追踪器…";
            status.TextWrapping = TextWrapping.Wrap;
            status.Margin = new Thickness(20);
            status.Background = Brushes.WhiteSmoke;
            content.Children.Add(status);
            web.DefaultBackgroundColor = System.Drawing.Color.Transparent;
            web.Visibility = Visibility.Hidden;
            content.Children.Add(web);
            grid.Children.Add(content);
            floatingMenu = MakeButton("⋯", "窗口操作：主页、展开、置顶与透明度", ShowMenu);
            floatingMenu.HorizontalAlignment = HorizontalAlignment.Right;
            floatingMenu.VerticalAlignment = VerticalAlignment.Top;
            floatingMenu.Margin = new Thickness(0, 4, 4, 0);
            floatingMenu.Height = 24;
            floatingMenu.Visibility = Visibility.Collapsed;
            Grid.SetRow(floatingMenu, 1);
            Panel.SetZIndex(floatingMenu, 10);
            grid.Children.Add(floatingMenu);
            floatingDrag = new TextBlock { Text = "⠿", Width = 16, Height = 24, FontSize = 15, Foreground = Brushes.DimGray, Cursor = Cursors.SizeAll, ToolTip = "按住拖动", Background = Brushes.Transparent, Margin = new Thickness(6, 5, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Visibility = Visibility.Collapsed };
            floatingDrag.MouseLeftButtonDown += (s, e) => DragMove();
            Grid.SetRow(floatingDrag, 1);
            Panel.SetZIndex(floatingDrag, 10);
            grid.Children.Add(floatingDrag);
            shell = new Border { CornerRadius = new CornerRadius(10), Child = grid };
            Content = shell;
            PaintShell();
            Loaded += async (s, e) => await Initialize();
            Closed += (s, e) => { closing = true; web.Dispose(); };
            PreviewKeyDown += async (s, e) => {
                if (e.Key == Key.Escape && mode != "home") { await SetMode("home"); e.Handled = true; }
                if (e.Key == Key.F5) { Refresh(); e.Handled = true; }
            };
        }

        Button MakeButton(string label, string tip, Action action)
        {
            var button = new Button { Content = label, ToolTip = tip, FontSize = 11, Padding = new Thickness(6, 2, 6, 2), MinWidth = 24, BorderThickness = new Thickness(0), Background = Brushes.Transparent, Foreground = Brushes.DarkSlateGray, Cursor = Cursors.Hand, Focusable = true };
            button.Click += (s, e) => action();
            buttons.Add(button);
            return button;
        }

        async Task Initialize()
        {
            try
            {
                var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MaloTCG", demo ? "LauncherDemo" : "Launcher");
                sessionCache = new SessionCache(Path.Combine(profile, "remembered-session.bin"));
                var env = await CoreWebView2Environment.CreateAsync(null, profile);
                await web.EnsureCoreWebView2Async(env);
                var core = web.CoreWebView2;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                core.Settings.AreDevToolsEnabled = demo;
                core.NavigationStarting += (s, e) => {
                    ready = false;
                    if (!Trusted(e.Uri)) { e.Cancel = true; OpenExternal(e.Uri); return; }
                    status.Text = "正在加载在线界面…";
                    status.Visibility = Visibility.Visible;
                };
                core.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
                core.PermissionRequested += (s, e) => e.State = CoreWebView2PermissionState.Deny;
                core.NavigationCompleted += (s, e) => {
                    // Session storage survives refreshes in this WebView. Restore only on
                    // the first successful navigation so logout cannot resurrect a token.
                    if (e.IsSuccess && restoreScriptId != null) { core.RemoveScriptToExecuteOnDocumentCreated(restoreScriptId); restoreScriptId = null; }
                    if (e.IsSuccess) { web.Visibility = Visibility.Visible; status.Visibility = Visibility.Collapsed; }
                    else { web.Visibility = Visibility.Hidden; status.Visibility = Visibility.Visible; status.Text = "在线页面加载失败：" + e.WebErrorStatus + "\n请检查网络，再按 F5 或点击 ⋯ → 刷新。已保存的本地记录不会清除。"; }
                };
                core.ProcessFailed += (s, e) => { ready = false; status.Text = "网页进程已中断，请按 F5 重试。"; status.Visibility = Visibility.Visible; web.Visibility = Visibility.Hidden; };
                core.WebMessageReceived += async (s, e) => {
                    if (!Trusted(e.Source)) return;
                    try {
                        var message = json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(e.WebMessageAsJson);
                        object command;
                        if (message == null || !message.TryGetValue("command", out command)) return;
                        if ((string)command == "ready") {
                            ready = true;
                            await ApplyWebMode();
                            if (selfTest && !testing) { testing = true; await SelfTest(); }
                        }
                        if ((string)command == "mode" && message.ContainsKey("mode")) await SetMode(Convert.ToString(message["mode"]));
                        if ((string)command == "theme" && message.ContainsKey("theme")) { dark = Convert.ToString(message["theme"]) == "dark"; PaintShell(); }
                        if ((string)command == "session" && !demo && message.ContainsKey("session")) {
                            bool saved = sessionCache.Save(json.Serialize(message["session"]));
                            core.PostWebMessageAsJson("{\"type\":\"remember-status\",\"saved\":" + (saved ? "true" : "false") + "}");
                        }
                    } catch (Exception ex) { Debug.WriteLine(ex.Message); }
                };
                if (demo) await core.AddScriptToExecuteOnDocumentCreatedAsync(ReadResource("DemoSeed"));
                if (!demo) {
                    var restore = sessionCache.RestoreScript();
                    if (restore != null) restoreScriptId = await core.AddScriptToExecuteOnDocumentCreatedAsync(restore);
                }
                await core.AddScriptToExecuteOnDocumentCreatedAsync(ReadResource("DesktopBridge"));
                core.Navigate(Site + "?desktop=1&v=" + DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            }
            catch (WebView2RuntimeNotFoundException)
            {
                status.Text = "需要 Microsoft Edge WebView2 运行环境。\n安装后重新打开启动器即可。本程序未打包完整浏览器。";
                var install = MakeButton("打开微软官方下载页", "下载 WebView2 Evergreen Runtime", () => OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/"));
                ((Grid)status.Parent).Children.Add(install);
                install.VerticalAlignment = VerticalAlignment.Bottom;
            }
            catch (Exception ex) { status.Text = "启动失败：" + ex.Message + "\n请关闭后重试。"; }
        }

        static bool Trusted(string address)
        {
            Uri uri;
            return Uri.TryCreate(address, UriKind.Absolute, out uri) && uri.Scheme == "https" && uri.IsDefaultPort && uri.Host == "malo-ptcg.cn";
        }

        static void OpenExternal(string address)
        {
            Uri uri;
            if (Uri.TryCreate(address, UriKind.Absolute, out uri) && uri.Scheme == "https") Process.Start(new ProcessStartInfo(address) { UseShellExecute = true });
        }

        static string ReadResource(string name)
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            using (var reader = new StreamReader(stream)) return reader.ReadToEnd();
        }

        async Task SetMode(string next)
        {
            if (next != "home" && next != "mini" && next != "detail") return;
            if (next == mode) return;
            if (mode == "home") homeBounds = new Rect(Left, Top, Width, Height);
            else floatPosition = new Point(Left, Top);
            mode = next;
            if (mode == "home") {
                Topmost = false;
                Width = homeBounds.Width > 0 ? homeBounds.Width : 1024;
                Height = homeBounds.Height > 0 ? homeBounds.Height : 760;
                if (homeBounds.Width > 0) { Left = homeBounds.Left; Top = homeBounds.Top; }
            } else {
                Width = mode == "mini" ? 180 : 400;
                Height = mode == "mini" ? 180 : 620;
                Topmost = true;
                var area = SystemParameters.WorkArea;
                Left = double.IsNaN(floatPosition.X) ? area.Right - Width - 24 : floatPosition.X;
                Top = double.IsNaN(floatPosition.Y) ? area.Top + 80 : floatPosition.Y;
            }
            var work = SystemParameters.WorkArea;
            Left = Math.Max(work.Left, Math.Min(Left, work.Right - Width));
            Top = Math.Max(work.Top, Math.Min(Top, work.Bottom - Height));
            modeButton.Content = mode == "mini" ? "展开" : "悬浮";
            pinButton.Foreground = Topmost ? Brushes.SeaGreen : Brushes.DimGray;
            PaintShell();
            await ApplyWebMode();
        }

        void PaintShell()
        {
            bool home = mode == "home";
            toolbarRow.Height = new GridLength(home ? 28 : 0);
            toolbar.Visibility = home ? Visibility.Visible : Visibility.Collapsed;
            toolbar.Background = Brushes.Transparent;
            floatingMenu.Visibility = home ? Visibility.Collapsed : Visibility.Visible;
            floatingDrag.Visibility = home ? Visibility.Collapsed : Visibility.Visible;
            byte alpha = home ? (byte)255 : (byte)Math.Round(255 * surface);
            shell.Background = new SolidColorBrush(dark ? Color.FromArgb(alpha, 23, 32, 41) : Color.FromArgb(alpha, 250, 252, 251));
            foreach (var button in buttons) button.Foreground = dark ? Brushes.WhiteSmoke : Brushes.DarkSlateGray;
            pinButton.Foreground = Topmost ? Brushes.SeaGreen : (dark ? Brushes.LightGray : Brushes.DimGray);
            floatingDrag.Foreground = dark ? Brushes.LightGray : Brushes.DimGray;
        }

        async Task ApplyWebMode()
        {
            if (!ready || closing) return;
            await web.CoreWebView2.ExecuteScriptAsync("window.PtcgDesktop && (PtcgDesktop.setMode(" + json.Serialize(mode) + "),PtcgDesktop.setSurface(" + surface.ToString(System.Globalization.CultureInfo.InvariantCulture) + "));");
        }

        void Refresh()
        {
            if (web.CoreWebView2 != null) web.CoreWebView2.Reload();
        }

        void ShowMenu()
        {
            var menu = new ContextMenu();
            var homeItem = new MenuItem { Header = "回到主页（Esc）" };
            homeItem.Click += async (s, e) => await SetMode("home");
            menu.Items.Add(homeItem);
            var viewItem = new MenuItem { Header = mode == "mini" ? "展开详细版" : "切换微缩版" };
            viewItem.Click += async (s, e) => await SetMode(mode == "mini" ? "detail" : "mini");
            menu.Items.Add(viewItem);
            var pinItem = new MenuItem { Header = "窗口置顶", IsCheckable = true, IsChecked = Topmost };
            pinItem.Click += (s, e) => { Topmost = !Topmost; PaintShell(); };
            menu.Items.Add(pinItem);
            menu.Items.Add(new Separator());
            foreach (var value in new[] { 0.72, 0.90, 1.0 }) {
                var opacity = value;
                var item = new MenuItem { Header = "面板不透明度 " + (int)(value * 100) + "%", IsCheckable = true, IsChecked = Math.Abs(surface - value) < 0.01 };
                item.Click += async (s, e) => { surface = opacity; PaintShell(); await ApplyWebMode(); };
                menu.Items.Add(item);
            }
            menu.Items.Add(new Separator());
            var refresh = new MenuItem { Header = "刷新在线界面（F5）" };
            refresh.Click += (s, e) => Refresh();
            menu.Items.Add(refresh);
            var minimize = new MenuItem { Header = "最小化" };
            minimize.Click += (s, e) => WindowState = WindowState.Minimized;
            menu.Items.Add(minimize);
            var close = new MenuItem { Header = "关闭启动器" };
            close.Click += (s, e) => Close();
            menu.Items.Add(close);
            menu.IsOpen = true;
        }

        async Task SelfTest()
        {
            // Isolated demo profile; no credentials or cloud writes.
            try {
                bool panelReady = false;
                for (int attempt = 0; attempt < 60 && !closing; attempt++) {
                    var loaded = await web.CoreWebView2.ExecuteScriptAsync("!!(window.PtcgStore && document.getElementById('ptcg-desktop-panel') && document.getElementById('ptcg-desktop-panel').contentWindow.popRecordMatch)");
                    if (loaded == "true") { panelReady = true; break; }
                    await Task.Delay(500);
                }
                if (!panelReady) throw new InvalidOperationException("Online record panel did not finish loading within 30 seconds");
                await web.CoreWebView2.ExecuteScriptAsync("window.__desktopSelfTestMarker='same-document';sessionStorage.setItem('ptcg-desktop-self-test','keep-session');");
                await SetMode("mini");
                await Task.Delay(700);
                await web.CoreWebView2.ExecuteScriptAsync(@"(()=>{
                  const f=document.getElementById('ptcg-desktop-panel');
                  if(!f?.contentWindow.popRecordMatch)throw Error('Popup not ready');
                  const w=f.contentWindow;
                  const before=PtcgStore.read().personal.matchHistory.length;
                  w.popSetTurn('second');w.popSetOpp('沙奈朵 ex');w.popRecordMatch('win');
                  const p=PtcgStore.read().personal;
                  const last=p.matchHistory[p.matchHistory.length-1];
                  if(p.matchHistory.length!==before+1||last.result!=='win'||last.firstMove!=='second'||last.opponentDeck!=='沙奈朵 ex')throw Error('Record mismatch');
                })()");
                await Task.Delay(500);
                var result = await web.CoreWebView2.ExecuteScriptAsync(@"(()=>{const f=document.getElementById('ptcg-desktop-panel');const w=f.contentWindow;const p=PtcgStore.read().personal;const last=p.matchHistory[p.matchHistory.length-1];return {count:p.matchHistory.length,result:last.result,turn:last.firstMove,opponent:last.opponentDeck,rate:w.document.getElementById('miniRate').textContent,transparent:w.getComputedStyle(w.document.documentElement).backgroundColor,mode:PtcgDesktop.getMode(),panelHeight:f.clientHeight,contentHeight:w.document.body.scrollHeight};})()");
                var report = json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(result);
                if (report == null) throw new InvalidOperationException("Browser did not return a record-panel test report");
                report["windowWidth"] = Width;
                report["windowHeight"] = Height;
                report["topmost"] = Topmost;
                report["allowsTransparency"] = AllowsTransparency;
                report["noNativeTitleBar"] = WindowStyle == WindowStyle.None;
                var image = new RenderTargetBitmap((int)ActualWidth, (int)ActualHeight, 96, 96, PixelFormats.Pbgra32);
                image.Render(this);
                var pixels = new byte[(int)ActualWidth * (int)ActualHeight * 4];
                image.CopyPixels(pixels, (int)ActualWidth * 4, 0);
                report["minimumAlpha"] = Enumerable.Range(0, pixels.Length / 4).Min(i => pixels[i * 4 + 3]);
                report["hasSemitransparentPixels"] = Enumerable.Range(0, pixels.Length / 4).Any(i => pixels[i * 4 + 3] > 0 && pixels[i * 4 + 3] < 255);
                report["panelAlpha"] = pixels[(50 * (int)ActualWidth + 100) * 4 + 3];
                report["bottomAlpha"] = pixels[((int)ActualHeight - 5) * (int)ActualWidth * 4 + 100 * 4 + 3];
                report["toolbarHeight"] = toolbarRow.ActualHeight;
                report["bodyBackgroundIsTransparent"] = await web.CoreWebView2.ExecuteScriptAsync("getComputedStyle(document.getElementById('ptcg-desktop-panel').contentDocument.querySelector('.quick-record')).backgroundColor==='rgba(0, 0, 0, 0)'");
                var cachePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "session-cache-self-test.bin");
                var cache = new SessionCache(cachePath);
                string testToken = "desktop-test." + (DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 3600) + ".test-nonce.test-signature";
                bool saveSucceeded = cache.Save(json.Serialize(new RememberedSession { userId = "desktop-test", token = testToken }));
                var reopened = new SessionCache(cachePath).Read();
                report["rememberedSessionRoundTrip"] = saveSucceeded && reopened != null && reopened.token == testToken;
                report["sessionProtectedAtRest"] = saveSucceeded && !System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(cachePath)).Contains(testToken);
                cache.Clear();
                report["logoutClearsRememberedSession"] = new SessionCache(cachePath).Read() == null && !File.Exists(cachePath);
                string expired = "desktop-test." + (DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 1) + ".test-nonce.test-signature";
                cache.Save(json.Serialize(new RememberedSession { userId = "desktop-test", token = expired }));
                report["expiredSessionRejected"] = cache.Read() == null && !File.Exists(cachePath);
                File.WriteAllBytes(cachePath, new byte[] { 1, 2, 3, 4 });
                report["corruptSessionRejected"] = cache.Read() == null && !File.Exists(cachePath);
                var encoder = new PngBitmapEncoder();
                encoder.Frames.Add(BitmapFrame.Create(image));
                using (var file = File.Create(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "desktop-preview.png"))) encoder.Save(file);
                var output = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "self-test.json");
                await SetMode("detail");
                await Task.Delay(300);
                report["detailWidth"] = Width;
                report["detailMode"] = await web.CoreWebView2.ExecuteScriptAsync("PtcgDesktop.getMode()");
                await Task.Delay(16000);
                report["backgroundStatus"] = await web.CoreWebView2.ExecuteScriptAsync("document.getElementById('ptcg-desktop-panel').contentDocument.getElementById('stText').textContent");
                await SetMode("home");
                await Task.Delay(300);
                report["homeWidth"] = Width;
                report["homeMode"] = await web.CoreWebView2.ExecuteScriptAsync("PtcgDesktop.getMode()");
                report["sameDocumentAndSession"] = await web.CoreWebView2.ExecuteScriptAsync("window.__desktopSelfTestMarker==='same-document'&&sessionStorage.getItem('ptcg-desktop-self-test')==='keep-session'");
                await SetMode("mini");
                File.WriteAllText(output, json.Serialize(report));
            } catch (Exception ex) { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "self-test-error.txt"), ex.ToString()); }
        }
    }
}
