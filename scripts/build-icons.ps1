param([string]$Source = (Join-Path $PSScriptRoot '..\assets\icon.png'), [string]$Target = (Join-Path $PSScriptRoot '..\assets\icon.ico'))
Add-Type -AssemblyName System.Drawing
$original = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Source))
$streams = @()
try {
  foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($original, 0, 0, $size, $size)
    $memory = [System.IO.MemoryStream]::new()
    $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
    $streams += @{ Size = $size; Bytes = $memory.ToArray() }
    $memory.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
  }
  $output = [System.IO.File]::Create([System.IO.Path]::GetFullPath($Target))
  $writer = [System.IO.BinaryWriter]::new($output)
  try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$streams.Count)
    $offset = 6 + 16 * $streams.Count
    foreach ($entry in $streams) {
      $dimension = if ($entry.Size -eq 256) { 0 } else { $entry.Size }
      $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([uint16]0)
      $writer.Write([uint16]1); $writer.Write([uint16]32)
      $writer.Write([uint32]$entry.Bytes.Length); $writer.Write([uint32]$offset)
      $offset += $entry.Bytes.Length
    }
    foreach ($entry in $streams) { $writer.Write([byte[]]$entry.Bytes) }
  } finally { $writer.Dispose(); $output.Dispose() }
} finally { $original.Dispose() }
