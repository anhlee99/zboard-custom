# Start ZBoard on native Windows (without WSL): same steps as start.sh.
#   powershell -ExecutionPolicy Bypass -File .\start.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$need = [version]'22.13.0'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "ZBoard needs Node.js $need or newer: https://nodejs.org" }
$have = [version]((node -p 'process.versions.node').Trim())
if ($have -lt $need) { throw "Node $have is too old: ZBoard needs $need or newer (for node:sqlite)." }

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host 'Created .env from .env.example. Set APP_PASSWORD in it, then run start.ps1 again.'
  exit 1
}
if (Select-String -Path .env -Pattern '^APP_PASSWORD=(change-me)?\s*$' -Quiet) { throw 'Set APP_PASSWORD in .env first (it is empty or still change-me).' }

Write-Host 'Installing server packages...'
Push-Location server
npm ci --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE) { throw 'npm ci failed in server/' }
Pop-Location

Write-Host 'Installing and building the web app...'
Push-Location web
npm ci --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE) { throw 'npm ci failed in web/' }
npm run build --silent | Out-Null
if ($LASTEXITCODE) { throw 'web build failed' }
Pop-Location

$port = (Select-String -Path .env -Pattern '^PORT=(\d+)').Matches.Groups[1].Value
if (-not $port) { $port = 3000 }
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' -and $_.IPAddress -notmatch '^169\.' } |
  Select-Object -First 1).IPAddress
Write-Host ''
Write-Host "ZBoard on http://localhost:$port"
if ($ip) { Write-Host "On your network: http://${ip}:$port" }
Write-Host ''

Set-Location server
node --disable-warning=ExperimentalWarning --env-file=../.env src/index.js
