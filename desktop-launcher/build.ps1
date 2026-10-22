$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$dependencyRoot = Join-Path $projectRoot '.build-tools/webview2'
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$outputRoot = Join-Path $PSScriptRoot 'bin'
if (!(Test-Path "$dependencyRoot/lib/net462/Microsoft.Web.WebView2.Wpf.dll")) {
    $packagePath = Join-Path $projectRoot '.build-tools/webview2.zip'
    New-Item -ItemType Directory -Force -Path (Split-Path $packagePath -Parent) | Out-Null
    Invoke-WebRequest 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4258.31/microsoft.web.webview2.1.0.4258.31.nupkg' -OutFile $packagePath -UseBasicParsing
    if ((Get-FileHash $packagePath -Algorithm SHA256).Hash -ne '56F7F4B8BF9AEE4B8EFEFBBDD4F67D5F74EBD1B100ED0806DA71BF76AF481AA9') {
        throw 'WebView2 SDK package hash mismatch'
    }
    Expand-Archive -LiteralPath $packagePath -DestinationPath $dependencyRoot -Force
}
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$references = @('System.dll', 'System.Core.dll', 'System.Xaml.dll', 'System.Drawing.dll', 'System.Web.Extensions.dll', 'System.Security.dll') | ForEach-Object { "/reference:$framework/$_" }
$references += @('WindowsBase.dll', 'PresentationCore.dll', 'PresentationFramework.dll') | ForEach-Object { "/reference:$framework/WPF/$_" }
$references += @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Wpf.dll') | ForEach-Object { "/reference:$dependencyRoot/lib/net462/$_" }
$compilerArgs = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', "/out:$outputRoot\MaloTCG.exe", "/win32manifest:$PSScriptRoot\app.manifest", "/resource:$PSScriptRoot\bridge.js,DesktopBridge", "/resource:$PSScriptRoot\demo-seed.js,DemoSeed")
$compilerArgs += $references | ForEach-Object { $_.Replace('/', '\').Replace('\reference:', '/reference:') }
$compilerArgs += "$PSScriptRoot\Launcher.cs"
$compilerArgs += "$PSScriptRoot\SessionCache.cs"
& "$framework/csc.exe" @compilerArgs
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
Copy-Item "$dependencyRoot/lib/net462/Microsoft.Web.WebView2.Core.dll", "$dependencyRoot/lib/net462/Microsoft.Web.WebView2.Wpf.dll", "$dependencyRoot/runtimes/win-x64/native/WebView2Loader.dll" -Destination $outputRoot -Force
Copy-Item "$dependencyRoot/LICENSE.txt" -Destination "$outputRoot/WebView2-LICENSE.txt" -Force
Copy-Item "$PSScriptRoot/README.txt" -Destination $outputRoot -Force
Copy-Item "$PSScriptRoot/MaloTCG.exe.config" -Destination $outputRoot -Force
Write-Output "Built $outputRoot/MaloTCG.exe"
