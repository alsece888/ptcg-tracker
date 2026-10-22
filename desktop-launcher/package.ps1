$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'verify-self-test.ps1')
$binaryRoot = Join-Path $PSScriptRoot 'bin'
$reportFile = Get-Item (Join-Path $binaryRoot 'self-test.json')
if ((Get-Item (Join-Path $binaryRoot 'MaloTCG.exe')).LastWriteTimeUtc -gt $reportFile.LastWriteTimeUtc) {
    throw 'Acceptance report is older than the executable; rerun --self-test before packaging'
}
$artifactRoot = Join-Path $PSScriptRoot 'artifacts'
$folder = Join-Path $artifactRoot 'MALO-TCG-Launcher-0.1.5-win-x64'
$files = @('MaloTCG.exe', 'MaloTCG.exe.config', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Wpf.dll', 'WebView2Loader.dll', 'WebView2-LICENSE.txt', 'README.txt')
New-Item -ItemType Directory -Force -Path $folder | Out-Null
foreach ($name in $files) { Copy-Item -LiteralPath (Join-Path $binaryRoot $name) -Destination (Join-Path $folder $name) -Force }
$zipPath = "$folder.zip"
Compress-Archive -LiteralPath $folder -DestinationPath $zipPath -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entries = @($archive.Entries | Where-Object { $_.Name })
    if ($entries.Count -ne $files.Count) { throw 'Unexpected package file count' }
    foreach ($entry in $entries) {
        if ($entry.Name -notin $files) { throw 'Unexpected package file' }
        $stream = $entry.Open()
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $digest = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
        finally { $stream.Dispose(); $hasher.Dispose() }
        if ($digest -ne (Get-FileHash -LiteralPath (Join-Path $binaryRoot $entry.Name) -Algorithm SHA256).Hash) { throw 'Package contents do not match tested binaries' }
    }
} finally { $archive.Dispose() }
$packageHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
Set-Content -LiteralPath "$zipPath.sha256" -Encoding ASCII -Value "$packageHash  $([IO.Path]::GetFileName($zipPath))"
Write-Output "Verified $($files.Count)/$($files.Count) package files. ZIP: $zipPath ($((Get-Item $zipPath).Length) bytes)"
