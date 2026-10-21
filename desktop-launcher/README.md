# Windows 轻量启动器

WPF 无边框透明窗口 + WebView2CompositionControl，复用正式网站的主页面和悬浮面板。Windows 10/11 x64，.NET Framework 4.8、Evergreen WebView2 Runtime。

## 构建与运行

在仓库根目录运行 `powershell -ExecutionPolicy Bypass -File desktop-launcher/build.ps1`，输出 `desktop-launcher/bin/MaloTCG.exe`。首次构建从微软 NuGet 下载固定版本 WebView2 SDK 并校验 SHA-256，无需全局安装 .NET SDK。整个输出目录一起分发，不能只复制 exe。

普通启动加载 `https://malo-ptcg.cn/?desktop=1`；`--demo` 使用独立演示资料目录；`--self-test` 运行演示记录与窗口切换，并写出 `self-test.json` 和透明 PNG `desktop-preview.png`。演示会重置演示资料，不写普通使用资料，不登录云端。

自测结束后运行 `desktop-launcher/verify-self-test.ps1`，检查十项桌面验收。运行 `desktop-launcher/package.ps1` 生成 ZIP；打包前会确认报告晚于程序构建，并逐文件核对 ZIP 中的七个发布文件。测试报告、演示数据、截图和开发工具不会打入发布包。

## 数据与界面

- 主页面持续运行，悬浮 iframe 与它同源、同浏览上下文，复用 localStorage、已有账号会话、storage 事件和 BroadcastChannel。
- 网页内的悬浮按钮在宿主中切换原生窗口模式，不调用浏览器 PiP。
- 切换主页／微缩／详细不重载主页面，不丢登录会话或停止同步。
- 与外部浏览器之间沿用现有云端同步规则：本地变更自动上传，十分钟轮询，支持手动立即同步。没有新增实时服务，没有修改 cloud.js。
- 关闭进程后仍遵循当前网页的重新登录规则；不持久化密码或会话令牌。
- 主页面、记录面板和记录逻辑从网站加载；原生外框与宿主适配脚本编译进启动器，网站 DOM 或底层能力变化可能需要更新启动器。

## 安全边界与限制

只允许正式 HTTPS 主域名在宿主顶层导航；其他 HTTPS 链接交由系统浏览器打开。仅接受正式来源的有限模式切换消息，不向网页暴露文件、命令执行或凭据接口。权限请求默认拒绝。用户数据在 `%LOCALAPPDATA%/MaloTCG/Launcher`，演示数据在独立 `LauncherDemo`。

试用版未签名，无启动器自身自动更新；无鼠标穿透、托盘、全局快捷键。独占全屏游戏覆盖和真实账户跨设备同步仍需用户环境联调。透明面板不承诺对后方游戏进行实时毛玻璃模糊。

0.1.1：悬浮模式折叠原生工具栏行，仅在内容角落保留拖动点和操作菜单；整个 WPF Border 绘制统一背景，默认不透明度 90%，网页卡片不再分别绘制半透明块。主题变化通知宿主同步背景色。验收增加底部 alpha 与工具栏行高度检查。
