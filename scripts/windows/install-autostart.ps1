# Start ZBoard (in WSL) when Windows boots, before anyone logs in, so it comes back after Windows Update reboots.
# Run once in an elevated PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
# Remove with:  Unregister-ScheduledTask -TaskName ZBoard
param(
  [string]$Distro = 'Ubuntu',
  [string]$RepoPath = '~/zboard'
)
$ErrorActionPreference = 'Stop'
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this from an elevated (Run as administrator) PowerShell.' }

# The task runs as you without a login, so Windows needs your password once.
$cred = Get-Credential -UserName "$env:USERDOMAIN\$env:USERNAME" -Message 'Your Windows password (ZBoard runs as you at start-up)'
$cmd = "cd $RepoPath && ./start.sh >> ~/zboard-autostart.log 2>&1"
$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "-d $Distro --exec bash -lc '$cmd'"
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'ZBoard' -Action $action -Trigger $trigger -Settings $settings `
  -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Limited -Force | Out-Null

Write-Host 'Registered the "ZBoard" task. It starts ZBoard at boot (log: ~/zboard-autostart.log in WSL).'
Write-Host 'Keep the PC awake while plugged in:  powercfg /change standby-timeout-ac 0'
