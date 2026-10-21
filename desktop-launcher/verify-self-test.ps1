$ErrorActionPreference = 'Stop'
$report = Get-Content (Join-Path $PSScriptRoot 'bin/self-test.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$checks = [ordered]@{
    'Record and shared store' = ($report.count -eq 11 -and $report.result -eq 'win' -and $report.turn -eq 'second' -and $report.opponent -eq '沙奈朵 ex')
    'Updated win rate' = ($report.rate -eq '胜率 72.7%')
    'Square native window' = ($report.windowWidth -eq 200 -and $report.windowHeight -eq 200)
    'No native title bar' = ($report.noNativeTitleBar -eq $true)
    'Real transparent surface pixels' = ($report.allowsTransparency -and $report.minimumAlpha -eq 0 -and $report.hasSemitransparentPixels -and $report.panelAlpha -gt 0 -and $report.panelAlpha -lt 255)
    'Always on top' = ($report.topmost -eq $true)
    'Modes preserve page and session' = ($report.detailWidth -eq 400 -and $report.detailMode -eq '"detail"' -and $report.homeMode -eq '"home"' -and $report.sameDocumentAndSession -eq 'true')
    'No clipped compact content' = ($report.contentHeight -le $report.panelHeight)
    'No false background-page closed warning' = ($report.backgroundStatus -eq '"主页在后台运行"')
}
foreach ($check in $checks.GetEnumerator()) {
    Write-Output "$(if ($check.Value) { 'PASS' } else { 'FAIL' }): $($check.Key)"
}
$passed = @($checks.Values | Where-Object { $_ }).Count
Write-Output "$passed/$($checks.Count) launcher acceptance checks passed"
if ($passed -ne $checks.Count) { throw 'Launcher acceptance checks failed' }
