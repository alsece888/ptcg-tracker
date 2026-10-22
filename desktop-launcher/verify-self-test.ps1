$ErrorActionPreference = 'Stop'
$report = Get-Content (Join-Path $PSScriptRoot 'bin/self-test.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$checks = [ordered]@{
    'Record and shared store' = ($report.count -eq 11 -and $report.result -eq 'win' -and $report.turn -eq 'second' -and $report.opponent -eq '沙奈朵 ex')
    'Updated win rate' = ($report.rate -eq '胜率 72.7%')
    'Square native window' = ($report.windowWidth -eq 150 -and $report.windowHeight -eq 150)
    'No native title bar' = ($report.noNativeTitleBar -eq $true)
    'Real transparent surface pixels' = ($report.systemRoundedSurface -eq $true -and $report.hasSemitransparentPixels -and $report.panelAlpha -gt 0 -and $report.panelAlpha -lt 255)
    'Borderless frosted panel' = ($report.borderlessSurface -and ($report.nativeBlurAccepted -or !$report.systemBackdropSupported) -and $report.surfaceOpacity -eq 0.72)
    'System owns rounded corners in both sizes without layered accent blur' = ($report.systemRoundedSurface -and $report.detailSystemRoundedSurface)
    'All four blur source corners are filled without a second alpha cutout' = ($report.cornerSourceFilled -eq $true)
    'Always on top' = ($report.topmost -eq $true)
    'Modes preserve page and session' = ($report.detailWidth -eq 400 -and $report.detailMode -eq '"detail"' -and $report.homeMode -eq '"home"' -and $report.sameDocumentAndSession -eq 'true')
    'No clipped compact content' = ($report.contentHeight -le $report.panelHeight)
    'No false background-page closed warning' = ($report.backgroundStatus -eq '"主页在后台运行"')
    'Continuous panel without floating title row' = ($report.toolbarHeight -eq 0 -and $report.bottomAlpha -ge 180 -and $report.panelAlpha -ge 180 -and $report.bodyBackgroundIsTransparent -eq 'true')
    'Remembered session survives reopening and is encrypted' = ($report.rememberedSessionRoundTrip -and $report.sessionProtectedAtRest)
    'Logout clears remembered session' = ($report.logoutClearsRememberedSession -eq $true)
    'Expired remembered session is rejected' = ($report.expiredSessionRejected -eq $true)
    'Corrupt remembered session is rejected' = ($report.corruptSessionRejected -eq $true)
    'Compact controls are grouped in separate rows without overflow' = ($report.compactLayoutGrouped -eq 'true')
    'Dark theme matches the native background' = ($report.darkThemeRendered -eq $true)
}
foreach ($check in $checks.GetEnumerator()) {
    Write-Output "$(if ($check.Value) { 'PASS' } else { 'FAIL' }): $($check.Key)"
}
$passed = @($checks.Values | Where-Object { $_ }).Count
Write-Output "$passed/$($checks.Count) launcher acceptance checks passed"
if ($passed -ne $checks.Count) { throw 'Launcher acceptance checks failed' }
