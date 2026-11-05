# TradeClock

Windows 桌面看盘提醒：按 K 线收盘和全球关键时点准时提醒，自动识别交易时段、节假日和美欧澳夏令时。需求见 [PRD.md](PRD.md)，界面原型见 `prototype/ui-prototype.html`。

## 环境准备（只需一次）

1. 安装 [Rust](https://www.rust-lang.org/tools/install)（安装时选默认的 MSVC 工具链，会提示安装 Visual Studio C++ 生成工具）。
2. 安装 [Node.js](https://nodejs.org/) 22 或更高版本。
3. Windows 10/11 已自带 WebView2，无需另装。

## 常用命令

```powershell
npm install                 # 安装前端依赖
cd src-tauri; cargo test    # 运行调度引擎单元测试（夏令时、跨午夜、节假日等）
cd ..; npm run tauri dev    # 开发模式运行
npm run tauri build         # 打包安装程序，输出在 src-tauri/target/release/bundle/nsis/
```

## 目录

```text
src/                 React 前端（设置窗口 main.tsx，提醒浮窗 toast.tsx）
src-tauri/src/
  engine/            时段与调度引擎，纯计算，带单元测试
  lib.rs             托盘、快捷键、调度线程、窗口管理
  today.rs           “今日”时间轴数据
src-tauri/calendar/  内置节假日日历
```

## 说明

- 计时、通知、托盘都在 Rust 里完成。关闭设置窗口会销毁 WebView，只在托盘运行时内存占用最低。
- 配置保存在 `%APPDATA%\com.tradeclock.app\config.json`。
- 节假日按美国交易所规则自动计算（`src-tauri/src/engine/holidays.rs`），每年自动生效，不需要更新。CME 临时调整（如国丧日休市）写进 `src-tauri/calendar/overrides.json`，或在配置目录放一个同格式的 `calendar.json`，重启生效。`calendar/bundled.json` 已不再使用，可以删除。

## 发版与自动更新

远程仓库：<https://github.com/yixin8875/traderclock>

- **推送 main 即发版**：`.github/workflows/release.yml` 会自动递增补丁号、提交版本、打 `vX.Y.Z` tag，在 Windows runner 上构建 NSIS 安装包并发布 GitHub Release。提交信息含 `[skip release]` 时跳过。
- **本地发版**：`npm run release:patch`（或 `release:minor`、`release:major`）递增版本、提交、打 tag 并推送，tag 触发同样的构建流程。
- **手动指定版本**：在 Actions 里运行 Release 工作流，填写 `version` 输入。
- **应用内更新**：程序启动后静默检查 `releases/latest/download/latest.json`，发现新版本会在主界面提示；也可以到“设置 → 关于与更新”手动检查、下载并安装。安装包签名由内置公钥校验。
- **签名密钥**：私钥保存在仓库外（`%USERPROFILE%\.tauri\tradeclock.key`），CI 通过 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 两个仓库 Secret 使用。丢失私钥或密码后旧版本无法再自动更新，请务必备份。
- 本地执行 `npm run tauri build` 时若开启了 updater 签名，需要先设置上述两个环境变量，否则会因缺少签名私钥而失败。
