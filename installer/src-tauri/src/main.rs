#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! TradeClock 动画安装器。
//!
//! 界面只负责呈现；真正的安装交给内嵌的 NSIS 安装包静默完成，
//! 因此快捷方式、卸载项、WebView2 检查和后续升级行为与普通安装包一致。

use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// 由构建脚本在打包前复制到 assets/。
const CORE_SETUP: &[u8] = include_bytes!("../../assets/core-setup.exe");

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Serialize)]
struct InstallPhase {
    phase: &'static str,
    message: &'static str,
}

fn emit(app: &AppHandle, phase: &'static str, message: &'static str) {
    let _ = app.emit("install-phase", InstallPhase { phase, message });
}

fn install_dir() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA")
        .ok_or_else(|| "找不到 LOCALAPPDATA 目录，无法确定安装位置。".to_string())?;
    Ok(PathBuf::from(base).join("TradeClock"))
}

fn installed_exe() -> Result<PathBuf, String> {
    Ok(install_dir()?.join("tradeclock.exe"))
}

/// 静默安装时 NSIS 无法弹窗提示。先检查进程，避免覆盖正在运行的程序。
fn app_is_running() -> bool {
    let mut cmd = Command::new("tasklist");
    cmd.args(["/FI", "IMAGENAME eq TradeClock.exe", "/FO", "CSV", "/NH"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.output() {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .to_ascii_lowercase()
            .contains("tradeclock.exe"),
        Err(_) => false,
    }
}

fn run_core_setup(app: &AppHandle) -> Result<String, String> {
    if app_is_running() {
        return Err("TradeClock 正在运行。请先退出程序，再开始安装。".into());
    }

    emit(app, "preparing", "正在准备安装文件…");
    let target = installed_exe()?;
    let temp = std::env::temp_dir().join(format!("tradeclock-setup-{}.exe", std::process::id()));

    std::fs::write(&temp, CORE_SETUP).map_err(|e| format!("无法释放安装文件：{e}"))?;

    emit(app, "installing", "正在安装 TradeClock…");
    let mut cmd = Command::new(&temp);
    cmd.arg("/S");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let status = cmd.status();
    let _ = std::fs::remove_file(&temp);
    let status = status.map_err(|e| format!("无法启动安装程序：{e}"))?;

    if !status.success() {
        return Err(format!(
            "安装程序返回错误码 {}。请重试，或直接运行 core-setup.exe。",
            status.code().unwrap_or(-1)
        ));
    }

    if !target.exists() {
        return Err("安装程序已结束，但没有找到 TradeClock.exe。".into());
    }

    emit(app, "finalizing", "正在完成最后的设置…");
    std::thread::sleep(Duration::from_millis(450));
    emit(app, "done", "安装完成");

    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
async fn install_app(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_core_setup(&app))
        .await
        .map_err(|e| format!("安装线程异常：{e}"))?
}

fn valid_installed_exe(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_file() {
        return Err("没有找到已安装的 TradeClock。".into());
    }
    let expected = installed_exe()?;
    if p != expected {
        return Err("启动路径不是本次安装的程序。".into());
    }
    Ok(p)
}

#[tauri::command]
fn launch_app(path: String) -> Result<(), String> {
    let exe = valid_installed_exe(&path)?;
    let mut cmd = Command::new(&exe);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("启动 TradeClock 失败：{e}"))
}

#[tauri::command]
fn close_setup(app: AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![install_app, launch_app, close_setup])
        .run(tauri::generate_context!())
        .expect("failed to run TradeClock setup");
}
