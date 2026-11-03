# 生成 fish.ico（多尺寸 PNG 内嵌的 ICO）：pwsh build/make-icon.ps1 <输出路径>
param([string]$Out = (Join-Path $PSScriptRoot 'fish.ico'))
Add-Type -AssemblyName System.Drawing

function Draw-Fish([int]$s) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $k = $s / 256.0
    # 尾巴
    $tail = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF (190 * $k), (128 * $k)),
        (New-Object System.Drawing.PointF (248 * $k), (70 * $k)),
        (New-Object System.Drawing.PointF (236 * $k), (128 * $k)),
        (New-Object System.Drawing.PointF (248 * $k), (186 * $k)))
    $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 31, 98, 214))), $tail)
    # 身体（渐变）
    $rect = New-Object System.Drawing.RectangleF (10 * $k), (46 * $k), (200 * $k), (164 * $k)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 92, 170, 255)), ([System.Drawing.Color]::FromArgb(255, 37, 110, 230)), 90
    $g.FillEllipse($brush, $rect)
    # 肚皮
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(110, 255, 255, 255))), (40 * $k), (128 * $k), (130 * $k), (66 * $k))
    # 眼睛
    $g.FillEllipse([System.Drawing.Brushes]::White, (52 * $k), (88 * $k), (46 * $k), (46 * $k))
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 16, 35, 63))), (66 * $k), (100 * $k), (24 * $k), (24 * $k))
    $g.FillEllipse([System.Drawing.Brushes]::White, (74 * $k), (104 * $k), (8 * $k), (8 * $k))
    # 腮红
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(120, 255, 140, 170))), (100 * $k), (136 * $k), (30 * $k), (16 * $k))
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    , $ms.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = $sizes | ForEach-Object { , (Draw-Fish $_) }
$fs = [System.IO.File]::Create($Out)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]; $len = $pngs[$i].Length
    $w.Write([byte]($s % 256)); $w.Write([byte]($s % 256)); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$len); $w.Write([uint32]$offset)
    $offset += $len
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Close()
Write-Host "图标：$Out"
