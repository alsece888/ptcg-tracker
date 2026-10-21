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
        readonly bool demo;
        readonly bool selfTest;
        string mode = "home";
        bool ready;
        bool closing;
        bool testing;
        double surface = 0.72;
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
            MinWidth = 200;
            MinHeight = 160;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            UseLayoutRounding = true;
            var grid = new Grid();
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(28) });
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
            Content = grid;
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
            return button;
        }

        async Task Initialize()
        {
            try
            {
                var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MaloTCG", demo ? "LauncherDemo" : "Launcher");
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
                    } catch (Exception ex) { Debug.WriteLine(ex.Message); }
                };
                if (demo) await core.AddScriptToExecuteOnDocumentCreatedAsync(ReadResource("DemoSeed"));
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
                Width = mode == "mini" ? 200 : 400;
                Height = mode == "mini" ? 200 : 620;
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
            toolbar.Background = new SolidColorBrush(Color.FromArgb(mode == "home" ? (byte)245 : (byte)(255 * surface), 237, 243, 239));
            await ApplyWebMode();
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
            foreach (var value in new[] { 0.45, 0.72, 1.0 }) {
                var opacity = value;
                var item = new MenuItem { Header = "面板不透明度 " + (int)(value * 100) + "%", IsCheckable = true, IsChecked = Math.Abs(surface - value) < 0.01 };
                item.Click += async (s, e) => { surface = opacity; toolbar.Background = new SolidColorBrush(Color.FromArgb(mode == "home" ? (byte)245 : (byte)(255 * surface), 237, 243, 239)); await ApplyWebMode(); };
                menu.Items.Add(item);
            }
            menu.Items.Add(new Separator());
            var refresh = new MenuItem { Header = "刷新在线界面（F5）" };
            refresh.Click += (s, e) => Refresh();
            menu.Items.Add(refresh);
            var minimize = new MenuItem { Header = "最小化" };
            minimize.Click += (s, e) => WindowState = WindowState.Minimized;
            menu.Items.Add(minimize);
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
