# Irishka Community — private update script (Windows)
# NOT public — requires IRISHKA_FLEET_SECRET (same as Fleet Hub in Irishka settings).
#
# Usage:
#   $env:IRISHKA_FLEET_SECRET = "your-fleet-secret"
#   .\update-irishka.ps1
#
# Or:
#   .\update-irishka.ps1 -FleetSecret "your-fleet-secret"

param(
  [string]$FleetSecret = $env:IRISHKA_FLEET_SECRET,
  [string]$InstallDir = "C:\Irishka\COMMUNITY",
  [string]$BaseUrl = "https://fb-group-poster-production.up.railway.app/community"
)

$ErrorActionPreference = "Stop"

if (-not $FleetSecret) {
  Write-Host "Missing Fleet secret." -ForegroundColor Red
  Write-Host "Set: `$env:IRISHKA_FLEET_SECRET = '...'  (same as Irishka Fleet Hub settings)"
  Write-Host "Or:  .\update-irishka.ps1 -FleetSecret '...'"
  exit 1
}

$Headers = @{ Authorization = "Bearer $FleetSecret" }
$ZipPath = Join-Path $env:TEMP "irishka-COMMUNITY.zip"

Write-Host "Irishka Community updater (private)" -ForegroundColor Cyan
Write-Host "Install dir: $InstallDir"

try {
  $ver = Invoke-RestMethod -Uri "$BaseUrl/version.json" -Headers $Headers -TimeoutSec 30
  Write-Host "Remote version: $($ver.version) ($($ver.updatedAt))"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 401) {
    throw "Unauthorized — check IRISHKA_FLEET_SECRET"
  }
  Write-Warning "Could not fetch version.json — continuing anyway."
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Host "Downloading COMMUNITY.zip..."
Invoke-WebRequest -Uri "$BaseUrl/COMMUNITY.zip" -Headers $Headers -OutFile $ZipPath -UseBasicParsing

$extractRoot = Join-Path $env:TEMP "irishka-community-extract"
if (Test-Path $extractRoot) { Remove-Item -Recurse -Force $extractRoot }
Expand-Archive -Path $ZipPath -DestinationPath $extractRoot -Force

$inner = Join-Path $extractRoot "COMMUNITY"
if (-not (Test-Path $inner)) {
  throw "ZIP does not contain COMMUNITY folder"
}

Write-Host "Copying files to $InstallDir ..."
Get-ChildItem -Path $InstallDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $inner "*") -Destination $InstallDir -Recurse -Force

Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue

$localVer = (Get-Content (Join-Path $InstallDir "manifest.json") -Raw | ConvertFrom-Json).version
Write-Host ""
Write-Host "Done. Installed version: $localVer" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps (each Chrome profile):" -ForegroundColor Yellow
Write-Host "  1. Open chrome://extensions"
Write-Host "  2. Find 'Irishka Group Master by SBS — Community'"
Write-Host "  3. Click Reload"
Write-Host "  4. Confirm version shows $localVer"
