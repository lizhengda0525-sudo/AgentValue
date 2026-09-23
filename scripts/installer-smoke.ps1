param([Parameter(Mandatory = $true)][string]$Installer)

$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$root = Join-Path $env:LOCALAPPDATA 'Programs\AgentValue'
$program = Join-Path $root 'app\AgentValue.exe'
$data = Join-Path $root 'data'
$marker = Join-Path $data 'installer-test.txt'

if (Test-Path -LiteralPath $program) { throw 'AgentValue is already installed on this machine' }
$install = Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "Installer failed: $($install.ExitCode)" }
if (-not (Test-Path -LiteralPath $program)) { throw 'Installed executable is missing from the expected app folder' }

New-Item -ItemType Directory -Force -Path $data | Out-Null
'preserve-data' | Set-Content -LiteralPath $marker -Encoding ascii
$uninstall = Join-Path $root 'app\Uninstall AgentValue.exe'
if (-not (Test-Path -LiteralPath $uninstall)) { throw 'Uninstaller is missing' }
$removed = Start-Process -FilePath $uninstall -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
if ($removed.ExitCode -ne 0) { throw "Uninstaller failed: $($removed.ExitCode)" }
if (-not (Test-Path -LiteralPath $marker)) { throw 'Uninstall removed personal data' }
if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne 'preserve-data') { throw 'Personal data changed' }
Write-Output 'Installer created the expected app path and uninstall preserved data.'
Remove-Item -LiteralPath $marker
Remove-Item -LiteralPath $data
