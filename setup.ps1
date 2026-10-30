# ZBoard setup (Windows). Run in PowerShell from D:\code\zboard:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = 'Stop'
Write-Host '== Checking tools =='
foreach ($t in 'git','node','npm') {
  if (Get-Command $t -ErrorAction SilentlyContinue) { Write-Host "$t : $(& $t --version)" } else { Write-Host "$t : MISSING" -ForegroundColor Yellow }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements }
$nodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) { $v = [version]((node --version).TrimStart('v')); $nodeOk = ($v -ge [version]'22.13.0') }
if (-not $nodeOk) { Write-Host 'Installing Node LTS (needs 22.13+)'; winget install OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements }
Write-Host '== WSL2 =='
wsl --status 2>&1 | Select-Object -First 3
Write-Host '(If WSL is missing: run  wsl --install -d Ubuntu  in an admin PowerShell, then reboot.)'
Write-Host '== Git repo =='
if (-not (Test-Path .git)) { git init -b main }
git config user.name  'endiluong'
git config user.email 'endiluong@gmail.com'
git add -A
git commit -m 'step 0: project scaffold' 2>&1 | Select-Object -First 3
Write-Host '== Done. Reopen your terminal if Node/Git were just installed, then tell Claude. =='
