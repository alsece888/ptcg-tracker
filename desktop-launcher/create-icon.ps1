$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetRoot = Join-Path $PSScriptRoot 'assets'
New-Item -ItemType Directory -Force $assetRoot | Out-Null
function RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc(($x+$w-$d), $y, $d, $d, 270, 90)
    $path.AddArc(($x+$w-$d), ($y+$h-$d), $d, $d, 0, 90)
    $path.AddArc($x, ($y+$h-$d), $d, $d, 90, 90)
    $path.CloseFigure()
    return ,$path
}
$bitmap = New-Object Drawing.Bitmap(256, 256)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$navy = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#172b35'))
$white = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#f6fbf8'))
$green = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#0caf7b'))
$mintPen = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#79dcc0'), 9)
try {
    $path = RoundedPath 8 8 240 240 54
    $graphics.FillPath($navy, $path); $path.Dispose()
    $state = $graphics.Save()
    $graphics.TranslateTransform(115, 128); $graphics.RotateTransform(-13)
    $path = RoundedPath -56 -78 112 156 15
    $graphics.DrawPath($mintPen, $path); $path.Dispose()
    $graphics.Restore($state)
    $state = $graphics.Save()
    $graphics.TranslateTransform(143, 128); $graphics.RotateTransform(9)
    $path = RoundedPath -56 -78 112 156 15
    $graphics.FillPath($white, $path); $path.Dispose()
    $points = [Drawing.PointF[]]@(
        [Drawing.PointF]::new(0,-51), [Drawing.PointF]::new(-32,10),
        [Drawing.PointF]::new(-5,10), [Drawing.PointF]::new(-15,54),
        [Drawing.PointF]::new(34,-12), [Drawing.PointF]::new(8,-12),
        [Drawing.PointF]::new(18,-51)
    )
    $graphics.FillPolygon($green, $points)
    $graphics.Restore($state)
    $bitmap.Save((Join-Path $assetRoot 'launcher-icon.png'), [Drawing.Imaging.ImageFormat]::Png)
    $frames = @()
    foreach ($size in @(16, 20, 24, 32, 48, 64, 128, 256)) {
        $frame = New-Object Drawing.Bitmap($size, $size)
        $g = [Drawing.Graphics]::FromImage($frame)
        $stream = New-Object IO.MemoryStream
        try {
            $g.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
            $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.DrawImage($bitmap, 0, 0, $size, $size)
            $frame.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
            $frames += @{ Size = $size; Bytes = $stream.ToArray() }
        } finally { $g.Dispose(); $frame.Dispose(); $stream.Dispose() }
    }
    $output = [IO.File]::Create((Join-Path $assetRoot 'launcher.ico'))
    $writer = New-Object IO.BinaryWriter($output)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
        $offset = 6 + 16 * $frames.Count
        foreach ($frame in $frames) {
            $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
            $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
            $offset += $frame.Bytes.Length
        }
        foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
    } finally { $writer.Dispose(); $output.Dispose() }
} finally {
    $mintPen.Dispose(); $navy.Dispose(); $white.Dispose(); $green.Dispose()
    $graphics.Dispose(); $bitmap.Dispose()
}
Write-Output 'Created launcher icon: 8 sizes, 16–256 pixels.'
