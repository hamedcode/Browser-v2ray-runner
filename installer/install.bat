@echo off
setlocal EnableExtensions
title Browser v2ray Runner - Setup
chcp 65001 >nul
color 0B
cls

echo ============================================
echo   Browser v2ray Runner - Local Helper Setup
echo ============================================
echo.
echo This single file installs everything needed to run the
echo proxy inside your browser: the local helper and the
echo sing-box engine. Before downloading anything, it will
echo show you exactly what it's about to get (file names and
echo sizes) and ask you to confirm.
echo No admin rights needed - nothing outside your user account is touched.
echo.

set "PS1FILE=%TEMP%\v2ray-ext-setup-%RANDOM%.ps1"

set "MARKER_A=__PS1_BOUND"
set "MARKER_B=ARY__"
for /f "delims=:" %%A in ('findstr /n /c:"%MARKER_A%%MARKER_B%" "%~f0"') do set "MARKERLINE=%%A"
more +%MARKERLINE% "%~f0" > "%PS1FILE%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1FILE%" %*
set EXITCODE=%ERRORLEVEL%
del "%PS1FILE%" >nul 2>&1

echo.
if %EXITCODE% EQU 0 (
    color 0A
    echo [DONE] Setup finished. You can close this window and click the
    echo        extension icon in your browser.
) else if %EXITCODE% EQU 2 (
    color 0E
    echo [CANCELLED] Setup was stopped before anything was downloaded.
    echo             Run this file again whenever you're ready.
) else (
    color 0C
    echo [FAILED] Setup did not finish successfully ^(exit code %EXITCODE%^).
    echo Please check the messages above, or share them for help.
)
echo.
pause
set "FINALCODE=%EXITCODE%"
endlocal & exit /b %FINALCODE%

:: __PS1_BOUNDARY__
<#
  Everything below this line is PowerShell, extracted from this very .bat
  file at runtime (see the "more +%MARKERLINE%" line above) and run as a
  temp .ps1. cmd.exe never parses this part directly: execution above
  always ends at "exit /b" before reaching here.
#>

param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# --- fill these in before shipping ---------------------------------------
# GitHub repo that hosts a Release with a "v2ray-ext-host.exe" asset
# (the native host binary built from native-host/main.go).
$HostBinaryRepo = 'REPLACE_ME/REPLACE_ME'
# ---------------------------------------------------------------------------

$installDir = Join-Path $env:LOCALAPPDATA 'V2rayExtHost'
$hostName = 'com.v2rayext.host'

Write-Host "Installing to $installDir ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

function Get-LatestReleaseAsset($repo, $namePattern) {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'v2ray-ext-installer' }
    $asset = $release.assets | Where-Object { $_.name -match $namePattern } | Select-Object -First 1
    if (-not $asset) { throw "Could not find an asset matching '$namePattern' in the latest release of $repo" }
    [PSCustomObject]@{ Version = $release.tag_name; Asset = $asset }
}

# 1. Figure out what actually needs downloading (skip anything already
#    installed at the same version, unless -Force is passed), then show a
#    single combined confirmation with real file names and sizes before
#    touching the network for anything.
Write-Host 'Checking latest versions...' -ForegroundColor Cyan

$hostDest = Join-Path $installDir 'v2ray-ext-host.exe'
$hostVersionFile = Join-Path $installDir 'v2ray-ext-host.version'
$hostInfo = Get-LatestReleaseAsset $HostBinaryRepo 'v2ray-ext-host\.exe$'
$hostCurrent = (-not $Force) -and (Test-Path $hostDest) -and (Test-Path $hostVersionFile) -and ((Get-Content $hostVersionFile -Raw).Trim() -eq $hostInfo.Version)

$singboxDest = Join-Path $installDir 'sing-box.exe'
$singboxVersionFile = Join-Path $installDir 'sing-box.version'
$singboxInfo = Get-LatestReleaseAsset 'SagerNet/sing-box' 'windows-amd64\.zip$'
$singboxCurrent = (-not $Force) -and (Test-Path $singboxDest) -and (Test-Path $singboxVersionFile) -and ((Get-Content $singboxVersionFile -Raw).Trim() -eq $singboxInfo.Version)

$toDownload = @()
if (-not $hostCurrent) { $toDownload += [PSCustomObject]@{ Label = 'Local helper'; Name = $hostInfo.Asset.name; SizeMB = [Math]::Round($hostInfo.Asset.size / 1MB, 1) } }
if (-not $singboxCurrent) { $toDownload += [PSCustomObject]@{ Label = 'sing-box engine'; Name = $singboxInfo.Asset.name; SizeMB = [Math]::Round($singboxInfo.Asset.size / 1MB, 1) } }

if ($toDownload.Count -eq 0) {
    Write-Host 'Everything is already up to date — nothing to download.' -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host 'About to download:' -ForegroundColor Yellow
    foreach ($item in $toDownload) {
        Write-Host "  - $($item.Label): $($item.Name) ($($item.SizeMB) MB)"
    }
    $confirm = Read-Host 'Continue with download? (Y/N)'
    if ($confirm -notmatch '^[Yy]') {
        Write-Host ''
        Write-Host 'Setup cancelled — nothing else was changed.' -ForegroundColor Yellow
        exit 2
    }

    if (-not $hostCurrent) {
        Write-Host "Downloading $($hostInfo.Asset.name) ..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $hostInfo.Asset.browser_download_url -OutFile $hostDest -Headers @{ 'User-Agent' = 'v2ray-ext-installer' }
        Set-Content -Path $hostVersionFile -Value $hostInfo.Version -Encoding UTF8 -NoNewline
        Write-Host "Local helper $($hostInfo.Version) installed." -ForegroundColor Green
    }

    if (-not $singboxCurrent) {
        $zipPath = Join-Path $env:TEMP 'sing-box.zip'
        Write-Host "Downloading $($singboxInfo.Asset.name) ..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $singboxInfo.Asset.browser_download_url -OutFile $zipPath -Headers @{ 'User-Agent' = 'v2ray-ext-installer' }

        $extractDir = Join-Path $env:TEMP 'sing-box-extract'
        if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
        $singboxExe = Get-ChildItem -Path $extractDir -Filter 'sing-box.exe' -Recurse | Select-Object -First 1
        if (-not $singboxExe) { throw "sing-box.exe not found inside the downloaded archive" }
        Copy-Item $singboxExe.FullName $singboxDest -Force
        Set-Content -Path $singboxVersionFile -Value $singboxInfo.Version -Encoding UTF8 -NoNewline
        Remove-Item $zipPath, $extractDir -Recurse -Force

        Write-Host "sing-box $($singboxInfo.Version) installed." -ForegroundColor Green
    }
}

# 2. Native messaging manifests — embedded here as text, not separate
#    files, since this installer is meant to be the only file you need.
$hostExePath = $hostDest.Replace('\', '\\')

$chromeManifestJson = @"
{
  "name": "com.v2rayext.host",
  "description": "Native host for Browser v2ray Runner",
  "path": "$hostExePath",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://bnajfffphmhkpajnijbdekbbjppckidc/"
  ]
}
"@

$firefoxManifestJson = @"
{
  "name": "com.v2rayext.host",
  "description": "Native host for Browser v2ray Runner",
  "path": "$hostExePath",
  "type": "stdio",
  "allowed_extensions": [
    "v2ray-ext-runner@example.invalid"
  ]
}
"@

$chromeManifestPath = Join-Path $installDir 'com.v2rayext.host.chrome.json'
$firefoxManifestPath = Join-Path $installDir 'com.v2rayext.host.firefox.json'
Set-Content -Path $chromeManifestPath -Value $chromeManifestJson -Encoding UTF8
Set-Content -Path $firefoxManifestPath -Value $firefoxManifestJson -Encoding UTF8

# 3. Register in the registry for whichever browsers are present
function Register-NativeHost($regPath, $manifestPath) {
    New-Item -Path $regPath -Force | Out-Null
    Set-ItemProperty -Path $regPath -Name '(Default)' -Value $manifestPath
    Write-Host "Registered: $regPath -> $manifestPath" -ForegroundColor DarkGray
}

Register-NativeHost "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName" $chromeManifestPath
Register-NativeHost "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName" $chromeManifestPath
Register-NativeHost "HKCU:\Software\Mozilla\NativeMessagingHosts\$hostName" $firefoxManifestPath

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green -NoNewline
Write-Host ' Load the extension (chrome://extensions or about:debugging), then reopen the popup.'
