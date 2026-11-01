# Lets phones and tablets on your home network open ZBoard at http://<this PC>:3000.
# Run in an admin PowerShell (right-click Start -> Terminal (Admin)):
#   powershell -ExecutionPolicy Bypass -File \\wsl.localhost\ubuntu\home\zlud\zboard\scripts\phone-lan.ps1
# Run it again after Windows restarts: WSL gets a new address and the forward has to follow it.
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$port = 3000

# 1. The home network is Private (Public networks block incoming connections).
$net = Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -eq 'Internet' } | Select-Object -First 1
if ($net.NetworkCategory -ne 'Private') {
  Set-NetConnectionProfile -InterfaceIndex $net.InterfaceIndex -NetworkCategory Private
  Write-Host "Network '$($net.Name)' on $($net.InterfaceAlias) is now Private."
}

# 2. Pass the port on to WSL's current address.
$wsl = ((wsl hostname -I) -split '\s+' | Where-Object { $_ })[0]
netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0 2>$null | Out-Null
netsh interface portproxy add v4tov4 listenport=$port listenaddress=0.0.0.0 connectport=$port connectaddress=$wsl | Out-Null
Write-Host "Port $port forwarded to WSL at $wsl."

# 3. Allow it in the firewall, only from devices on the same local network.
if (-not (Get-NetFirewallRule -DisplayName 'ZBoard' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'ZBoard' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private -RemoteAddress LocalSubnet | Out-Null
  Write-Host "Firewall: port $port allowed from your local network."
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $net.InterfaceIndex).IPAddress
Write-Host "`nOn the phone (same network), open in Safari:  http://${ip}:$port" -ForegroundColor Green
