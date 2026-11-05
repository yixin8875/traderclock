# Build the animated TradeClock installer.
# Usage: powershell -ExecutionPolicy Bypass -File installer/build.ps1
$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $PSScriptRoot
$setupDir = $PSScriptRoot

Get-Process tradeclock-setup -ErrorAction SilentlyContinue | Stop-Process -Force

Push-Location $project
try {
    Write-Host "==> Building app and core NSIS installer"
    npm run tauri build
    if ($LASTEXITCODE -ne 0) { throw "npm run tauri build failed" }

    $core = Get-ChildItem "$project\src-tauri\target\release\bundle\nsis\TradeClock_*-setup.exe" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $core) { throw "Core NSIS installer was not found" }

    Write-Host "==> Embedding $($core.Name)"
    Copy-Item $core.FullName "$setupDir\assets\core-setup.exe" -Force

    Push-Location $setupDir
    try {
        Write-Host "==> Building animated setup UI"
        node "$project\node_modules\@tauri-apps\cli\tauri.js" build --no-bundle
        if ($LASTEXITCODE -ne 0) { throw "Setup UI build failed" }
    }
    finally {
        Pop-Location
    }

    $out = "$project\release\TradeClock-Setup.exe"
    Copy-Item "$setupDir\src-tauri\target\release\tradeclock-setup.exe" $out -Force
    Write-Host "==> Done: $out"
}
finally {
    Pop-Location
}
