param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$PreviousInstaller
)

$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$initialInstaller = if ($PreviousInstaller) { (Resolve-Path -LiteralPath $PreviousInstaller).Path } else { $installerPath }
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
$testRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot ('AgentValue-Installer-Smoke-' + [guid]::NewGuid().ToString('N'))))
if (-not $testRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Installer test directory must be inside TEMP'
}
$appDirectory = Join-Path $testRoot 'AgentValue'
$program = Join-Path $appDirectory 'AgentValue.exe'
$data = Join-Path $appDirectory 'data'
$marker = Join-Path $data 'installer-test.txt'
$existingInstall = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like 'AgentValue*' }
if ($existingInstall) { throw 'Installer smoke test requires a machine without an existing AgentValue installation' }

try {
  $install = Start-Process -FilePath $initialInstaller -ArgumentList @('/S', "/D=$appDirectory") -WindowStyle Hidden -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "Custom-path install failed: $($install.ExitCode)" }
  if (-not (Test-Path -LiteralPath $program)) { throw 'Installer ignored the chosen app directory' }
  $uninstallEntry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'AgentValue*' -and $_.UninstallString -like "*$appDirectory*" }
  if (-not $uninstallEntry) { throw 'Windows uninstall entry is missing' }

  node scripts/installed-updater-smoke.mjs $program $testRoot
  if ($LASTEXITCODE -ne 0) { throw 'Custom-path installed app disabled software updates' }

  New-Item -ItemType Directory -Force -Path $data | Out-Null
  'preserve-data' | Set-Content -LiteralPath $marker -Encoding ascii
  Remove-Item -LiteralPath $program

  $upgrade = Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if ($upgrade.ExitCode -ne 0) { throw "Upgrade failed: $($upgrade.ExitCode)" }
  if (-not (Test-Path -LiteralPath $program)) { throw 'Upgrade forgot the chosen app directory' }
  if (-not (Test-Path -LiteralPath $marker)) { throw 'Upgrade removed personal data' }
  node scripts/installed-smoke.mjs $program
  if ($LASTEXITCODE -ne 0) { throw 'Installed app uninstall control failed' }

  $uninstaller = Join-Path $appDirectory 'Uninstall AgentValue.exe'
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Uninstaller is missing' }
  $removed = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if ($removed.ExitCode -ne 0) { throw "Uninstaller failed: $($removed.ExitCode)" }
  if (-not (Test-Path -LiteralPath $marker)) { throw 'Uninstall removed personal data' }
  if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne 'preserve-data') { throw 'Personal data changed' }
  $uninstallEntry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'AgentValue*' -and $_.UninstallString -like "*$appDirectory*" }
  if ($uninstallEntry) { throw 'Windows uninstall entry remains after uninstall' }
  Write-Output 'Chosen install path survived upgrade; uninstall preserved data inside the install directory.'
} finally {
  $uninstaller = Join-Path $appDirectory 'Uninstall AgentValue.exe'
  if (Test-Path -LiteralPath $uninstaller) {
    Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait | Out-Null
  }
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
