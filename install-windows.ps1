<#
  Hours Report - install / update the website on Windows (Server).

  1. Extract the package ZIP anywhere (for example to Downloads).
  2. Open PowerShell as Administrator in the extracted folder and run:
         powershell -ExecutionPolicy Bypass -File .\install-windows.ps1

  The site is installed to C:\HoursReport (change with -InstallDir).
  Updating = extract the new ZIP and run the same command again.
  The data (data\) and settings (config.json) in the install folder are never overwritten.

  Options:
      -Port 8081                      use another port (if 8080 is taken)
      -InstallDir D:\Apps\HoursReport install somewhere else
      -Uninstall                      remove the service and firewall rule (data is kept)

  What it does:
    1. Checks that Node.js 18+ is installed.
    2. Copies the site files to the install folder (keeps data and config.json).
    3. Opens the port in Windows Firewall (inbound TCP).
    4. Registers a scheduled task "HoursReport" that starts the site when the server boots
       (as SYSTEM, no login needed) and restarts it automatically if it stops.
    5. Starts the site and checks that it answers.
#>
param(
  [int]$Port = 0,
  [string]$InstallDir = 'C:\HoursReport',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'HoursReport'
$RuleName = 'Hours Report website'
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dir = [IO.Path]::GetFullPath($InstallDir)
$ConfigFile = Join-Path $Dir 'config.json'
$runner = Join-Path $Dir 'run-server.cmd'

# the files that make up the site (everything else in the install folder - data, config.json, logs - is left alone)
$AppDirs = @('public')
$AppFiles = @('server.js', 'mailer.js', 'package.json', 'run-server.cmd', 'start.bat', 'install-windows.ps1', 'config.example.json', 'README.md')

function Write-Ok($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  [!!] $msg" -ForegroundColor Red }

function Copy-AppFiles([string]$From, [string]$To) {
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  foreach ($d in $AppDirs) {
    $target = Join-Path $To $d
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Copy-Item -Recurse -Force (Join-Path $From $d) $target
  }
  foreach ($f in $AppFiles) {
    $src = Join-Path $From $f
    if (Test-Path $src) { Copy-Item -Force $src (Join-Path $To $f) }
  }
}

function Get-AppVersion([string]$Folder) {
  $pkg = Join-Path $Folder 'package.json'
  if (Test-Path $pkg) { return (Get-Content $pkg -Raw -Encoding UTF8 | ConvertFrom-Json).version }
  return '?'
}

# stops only the processes of the install folder (other services on the server are not touched)
function Stop-HoursReport {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  $serverJs = Join-Path $Dir 'server.js'
  # a process may already be gone by the time we get to it (stopping the task closes it) - that is fine
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'cmd.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$serverJs*" -or $_.CommandLine -like "*$runner*") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
}

if (-not $Uninstall) {
  if (-not (Test-Path (Join-Path $Source 'server.js')) -or -not (Test-Path (Join-Path $Source 'public'))) {
    Write-Fail 'Run this script from the extracted package folder (server.js and public\ were not found next to it).'
    exit 1
  }
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Fail 'Please run PowerShell as Administrator (right click > Run as administrator).'
  exit 1
}

Write-Host ''
Write-Host 'Hours Report - Windows setup' -ForegroundColor Cyan
Write-Host "Install folder: $Dir"
Write-Host ''

if ($Uninstall) {
  Stop-HoursReport
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Write-Ok "Removed the scheduled task and the firewall rule. The folder $Dir (with the data) was NOT deleted."
  exit 0
}

# ---------- 1. Node.js ----------
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Fail 'Node.js is not installed.'
  Write-Host '      Install the LTS version from https://nodejs.org  (or run: winget install OpenJS.NodeJS.LTS)'
  Write-Host '      Then open a NEW PowerShell window as Administrator and run this script again.'
  exit 1
}
$node = $nodeCmd.Source
$version = (& $node --version).Trim().TrimStart('v')
if ([int]($version.Split('.')[0]) -lt 18) {
  Write-Fail "Node.js $version is too old - version 18 or newer is required."
  exit 1
}
Write-Ok "Node.js $version ($node)"

# ---------- 2. Copy the site ----------
$oldVersion = $null
if (Test-Path (Join-Path $Dir 'server.js')) { $oldVersion = Get-AppVersion $Dir }
Stop-HoursReport
$sourceFull = [IO.Path]::GetFullPath($Source).TrimEnd('\')
if ($sourceFull -ine $Dir.TrimEnd('\')) {
  Copy-AppFiles $Source $Dir
  if ($oldVersion) { Write-Ok "Updated $oldVersion -> $(Get-AppVersion $Dir) in $Dir (data and config.json kept)" }
  else { Write-Ok "Version $(Get-AppVersion $Dir) copied to $Dir" }
} else {
  Write-Ok "Running from the install folder (version $(Get-AppVersion $Dir))"
}

# ---------- 3. Port: -Port parameter > config.json > 8080 ----------
if ($Port -gt 0) {
  if (-not (Test-Path $ConfigFile)) { Copy-Item (Join-Path $Dir 'config.example.json') $ConfigFile }
  $text = [IO.File]::ReadAllText($ConfigFile)
  $text = [regex]::Replace($text, '"port"\s*:\s*\d+', "`"port`": $Port")
  [IO.File]::WriteAllText($ConfigFile, $text, (New-Object Text.UTF8Encoding($false)))
  Write-Ok "Port $Port saved in config.json"
} else {
  $Port = 8080
  if (Test-Path $ConfigFile) {
    $match = Select-String -Path $ConfigFile -Pattern '"port"\s*:\s*(\d+)' | Select-Object -First 1
    if ($match) { $Port = [int]$match.Matches[0].Groups[1].Value }
  }
}

# the previous version may need a moment to release the port
$busy = $null
for ($i = 0; $i -lt 10; $i++) {
  $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $busy) { break }
  Start-Sleep -Seconds 1
}
if ($busy) {
  $owner = (Get-Process -Id ($busy | Select-Object -First 1).OwningProcess -ErrorAction SilentlyContinue).ProcessName
  Write-Fail "Port $Port is already used by another program ($owner)."
  Write-Host '      Choose another port, for example:  .\install-windows.ps1 -Port 8081'
  exit 1
}
Write-Ok "Port $Port is free"

# ---------- 4. Firewall ----------
Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
Write-Ok "Windows Firewall: inbound TCP $Port allowed"

# ---------- 5. Background task ----------
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$runner`" `"$node`"`"" -WorkingDirectory $Dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$taskUser = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $taskUser `
  -Settings $settings -Description "Hours report website (Node.js) - $Dir" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Ok "Scheduled task '$TaskName' registered (starts with Windows, restarts automatically)"

# ---------- 6. Check ----------
$ok = $false
for ($i = 0; $i -lt 15 -and -not $ok; $i++) {
  Start-Sleep -Seconds 1
  try {
    $res = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 3
    $ok = $res.StatusCode -eq 200
  } catch { }
}
Write-Host ''
if (-not $ok) {
  Write-Fail "The site did not answer. Check the log: $Dir\data\logs\console.log"
  exit 1
}
Write-Ok "The site is running! (version $(Get-AppVersion $Dir))"
Write-Host ''
Write-Host 'Open from your computer:' -ForegroundColor Cyan
$portSuffix = if ($Port -eq 80) { '' } else { ":$Port" }
Write-Host "    http://$($env:COMPUTERNAME.ToLower())$portSuffix"
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  ForEach-Object { Write-Host "    http://$($_.IPAddress)$portSuffix" }
Write-Host ''
if (-not $oldVersion) { Write-Host 'The first person to register becomes the team admin.' }
Write-Host ''
