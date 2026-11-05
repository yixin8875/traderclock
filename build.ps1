# TradeClock 打包脚本：生成正式版（安装包 + 免安装 exe），输出到 release 文件夹
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

function Step($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Fail($t) {
    Write-Host "`n[失败] $t" -ForegroundColor Red
    Read-Host "按回车关闭"
    exit 1
}

foreach ($v in "HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy","CARGO_HTTP_PROXY") {
    Remove-Item "Env:$v" -ErrorAction SilentlyContinue
}

Step "安装前端依赖"
npm install
if ($LASTEXITCODE -ne 0) { Fail "npm install 出错。" }

Step "运行引擎测试"
Push-Location src-tauri
cmd /c "cargo test 2>&1" | Tee-Object -FilePath "..\cargo-test.log"
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Fail "测试没通过，输出在 cargo-test.log，请发给 Claude。" }

Step "编译正式版（第一次约 5-10 分钟）"
cmd /c "npm run tauri build 2>&1" | Tee-Object -FilePath "build.log"
$buildCode = $LASTEXITCODE

$exe = "src-tauri\target\release\tradeclock.exe"
if (-not (Test-Path $exe)) { Fail "编译失败，输出在 build.log，请发给 Claude。" }

New-Item -ItemType Directory -Force release | Out-Null
Copy-Item $exe "release\TradeClock.exe" -Force
$setup = Get-ChildItem "src-tauri\target\release\bundle\nsis\*.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if ($setup) { Copy-Item $setup.FullName "release\" -Force }

Step "完成"
Write-Host "免安装版：release\TradeClock.exe（双击即可运行）"
if ($setup) {
    Write-Host "安装包：  release\$($setup.Name)"
} else {
    Write-Host "安装包没有生成（打包工具 NSIS 要从 GitHub 下载，可能被网络挡住）。" -ForegroundColor Yellow
    Write-Host "免安装版不受影响，可以直接用。build.log 里有详细原因。"
}
if ($buildCode -ne 0 -and $setup) { Write-Host "注意：编译过程有报错，见 build.log" -ForegroundColor Yellow }
explorer.exe release
