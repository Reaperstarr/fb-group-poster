# Irishka Community — update script (Windows)
# Run in PowerShell: irm https://fb-group-poster-production.up.railway.app/community/update-irishka.ps1 | iex
# Or save and run:  .\update-irishka.ps1

$ErrorActionPreference = "Stop"

$BaseUrl = "https://fb-group-poster-production.up.railway.app/community"
$InstallDir = "C:\Irishka\COMMUNITY"
$ZipPath = Join-Path $env:TEMP "irishka-COMMUNITY.zip"

Write-Host "Irishka Community updater" -ForegroundColor Cyan
Write-Host "Install dir: $InstallDir"

try {
  $ver = Invoke-RestMethod -Uri "$BaseUrl/version.json" -TimeoutSec 30
  Write-Host "Remote version: $($ver.version) ($($ver.updatedAt))"
} catch {
  Write-Warning "Could not fetch version.json — continuing anyway."
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Host "Downloading COMMUNITY.zip..."
Invoke-WebRequest -Uri "$BaseUrl/COMMUNITY.zip" -OutFile $ZipPath -UseBasicParsing

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
Write-Host "  3. Click Reload (circular arrow)"
Write-Host "  4. Confirm version shows $localVer"
Write-Host ""
Write-Host "If Load unpacked points elsewhere, update that folder or re-point to:" 
Write-Host "  $InstallDir"
