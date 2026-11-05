# TradeClock 一键准备和启动脚本
# 做的事：检查环境 → 关闭本窗口的代理变量 → 安装前端依赖 → 运行引擎测试 → 启动软件
# 镜像配置只对本项目生效（.npmrc 和 src-tauri\.cargo\config.toml），不改你电脑的全局设置。

# 不用 Stop：cargo/npm 把进度写到 stderr，PowerShell 5 会误当成错误
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

function Step($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Fail($t) {
    Write-Host "`n[失败] $t" -ForegroundColor Red
    Read-Host "按回车关闭"
    exit 1
}

Step "检查 Rust 和 Node.js"
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { Fail "没找到 cargo。请先安装 Rust：https://www.rust-lang.org/tools/install" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "没找到 node。请先安装 Node.js 22 或更高版本：https://nodejs.org/" }
$nodeMajor = [int]((node -v).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) { Fail "Node.js 版本是 $(node -v)，需要 22 或更高。" }
Write-Host "cargo: $(cargo --version)"
Write-Host "node:  $(node -v)"

Step "关闭本窗口的代理变量（只影响这次运行）"
# 找出代理设置来自哪里，方便以后排查
$gitProxy = git config --global --get http.proxy 2>$null
if ($gitProxy) { Write-Host "发现 git 全局代理 http.proxy = $gitProxy（本项目已在 cargo 配置里忽略它）" }
$cargoCfg = "$env:USERPROFILE\.cargo\config.toml"
if ((Test-Path $cargoCfg) -and (Select-String -Path $cargoCfg -Pattern "proxy" -Quiet)) {
    Write-Host "发现 $cargoCfg 里有 proxy 设置（本项目已忽略它）"
}
foreach ($v in "HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy","CARGO_HTTP_PROXY") {
    Remove-Item "Env:$v" -ErrorAction SilentlyContinue
}

Step "安装前端依赖（npm install）"
npm install
if ($LASTEXITCODE -ne 0) { Fail "npm install 出错。请把上面的输出复制给 Claude。" }

Step "检查是否有其他 cargo 进程占用下载缓存"
$busy = Get-Process cargo, rustc, rust-analyzer -ErrorAction SilentlyContinue
if ($busy) {
    $busy | Format-Table Id, ProcessName, StartTime -AutoSize | Out-String | Write-Host
    Write-Host "这些进程会让 cargo 一直显示 Blocking waiting for file lock。"
    Write-Host "常见来源：之前没结束的 cargo 命令、VS Code 的 rust-analyzer 插件。"
    $ans = Read-Host "是否结束这些进程？(Y/N)"
    if ($ans -match '^[Yy]') { $busy | Stop-Process -Force; Start-Sleep 1; Write-Host "已结束。" }
    else { Write-Host "保留这些进程，cargo 会等它们结束后再继续。" }
}

Step "运行调度引擎测试（第一次要下载和编译依赖，约 5-15 分钟）"
Push-Location src-tauri
cmd /c "cargo test 2>&1" | Tee-Object -FilePath "..\cargo-test.log"
$testCode = $LASTEXITCODE
Pop-Location
if ($testCode -ne 0) { Fail "cargo test 没通过。完整输出已保存到 cargo-test.log，请把这个文件发给 Claude。" }

Step "启动 TradeClock（开发模式）"
Write-Host "软件窗口出现后，这个窗口要保持打开。关闭它会退出软件。"
cmd /c "npm run tauri dev 2>&1" | Tee-Object -FilePath "tauri-dev.log"
if ($LASTEXITCODE -ne 0) { Fail "启动出错。完整输出已保存到 tauri-dev.log，请把这个文件发给 Claude。" }
