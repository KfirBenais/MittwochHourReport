<#
  Hours Report - install the website as a background service on Windows (Server).

  Run in PowerShell as Administrator, from the HoursReport folder:
      powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
  Different port (e.g. if 8080 is taken):
      powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Port 8081
  Update after copying new files: run the same command again.
  Remove (the data folder is kept):
      powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Uninstall

  What it does:
    1. Checks that Node.js 18+ is installed.
    2. Opens the port in Windows Firewall (inbound TCP).
    3. Registers a scheduled task "HoursReport" that starts the site when the server boots
       (as SYSTEM, no login needed) and restarts it automatically if it stops.
    4. Starts the site and checks that it answers.
#>
param(
  [int]$Port = 0,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'HoursReport'
$RuleName = 'Hours Report website'
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigFile = Join-Path $Dir 'config.json'

function Write-Ok($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  [!!] $msg" -ForegroundColor Red }

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Fail 'Please run PowerShell as Administrator (right click > Run as administrator).'
  exit 1
}

$runner = Join-Path $Dir 'run-server.cmd'

# stops only the processes of THIS folder (other services on the server are not touched)
function Stop-HoursReport {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  # the task runs a small loop (run-server.cmd) - stop the node process of this folder too
  $serverJs = Join-Path $Dir 'server.js'
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'cmd.exe'" |
    Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$serverJs*" -or $_.CommandLine -like "*$runner*") } |
    ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
  Start-Sleep -Seconds 1
}

Write-Host ''
Write-Host 'Hours Report - Windows setup' -ForegroundColor Cyan
Write-Host "Folder: $Dir"
Write-Host ''

if ($Uninstall) {
  Stop-HoursReport
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Write-Ok 'Removed the scheduled task and the firewall rule. The data folder was NOT deleted.'
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

# ---------- 2. Port: -Port parameter > config.json > 8080 ----------
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

Stop-HoursReport
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  $owner = (Get-Process -Id ($busy | Select-Object -First 1).OwningProcess -ErrorAction SilentlyContinue).ProcessName
  Write-Fail "Port $Port is already used by another program ($owner)."
  Write-Host "      Choose another port, for example:  .\install-windows.ps1 -Port 8081"
  exit 1
}
Write-Ok "Port $Port is free"

# ---------- 3. Firewall ----------
Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
Write-Ok "Windows Firewall: inbound TCP $Port allowed"

# ---------- 4. Background task ----------
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$runner`" `"$node`"`"" -WorkingDirectory $Dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$taskUser = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $taskUser `
  -Settings $settings -Description 'Hours report website (Node.js) - see README.md' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Ok "Scheduled task '$TaskName' registered (starts with Windows, restarts automatically)"

# ---------- 5. Check ----------
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
  Write-Fail 'The site did not answer. Check the log: data\logs\console.log'
  exit 1
}
Write-Ok 'The site is running!'
Write-Host ''
Write-Host 'Open from your computer:' -ForegroundColor Cyan
Write-Host "    http://$($env:COMPUTERNAME.ToLower()):$Port"
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  ForEach-Object { Write-Host "    http://$($_.IPAddress):$Port" }
Write-Host ''
Write-Host 'The first person to register becomes the team admin.'
Write-Host ''
