// 自动更新：版本检查、下载安装与进度回调。
// 真正联网和校验签名的是 Rust 侧的 tauri-plugin-updater，这里只包一层界面友好的 API。
import { getVersion } from "@tauri-apps/api/app";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

export const AUTO_UPDATE_KEY = "tradeclock.autoUpdateCheck";

/** 浏览器预览里没有 Tauri 注入对象，所有更新操作都要先判断。 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 默认开启：只有明确关掉才不自动检查。 */
export function autoCheckEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_UPDATE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAutoCheckEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_UPDATE_KEY, on ? "1" : "0");
  } catch {
    // 隐私模式写不进去时保持默认开启即可
  }
}

export function appVersion(): Promise<string> {
  if (!isTauriRuntime()) return Promise.resolve("开发预览");
  return getVersion().catch(() => "未知");
}

/** 返回可用的新版本；已是最新或不在桌面环境时返回 null。 */
export function checkForUpdate(): Promise<Update | null> {
  if (!isTauriRuntime()) return Promise.resolve(null);
  return check({ timeout: 20_000 });
}

export interface InstallProgress {
  /** 已下载字节数 */
  downloaded: number;
  /** 服务端给出的总字节数，未知时为 undefined */
  total?: number;
  /** 0–100，未知总大小时为 undefined */
  percent?: number;
}

/**
 * 下载并安装。Windows 上安装器启动后应用会自动退出并重启，
 * 所以这个 Promise 结束后不需要再调用 relaunch。
 */
export function downloadAndInstall(update: Update, onProgress: (p: InstallProgress) => void): Promise<void> {
  let downloaded = 0;
  let total: number | undefined;
  return update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") {
      total = event.data.contentLength;
      onProgress({ downloaded: 0, total, percent: 0 });
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress({
        downloaded,
        total,
        percent: total ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined,
      });
    } else {
      onProgress({ downloaded, total, percent: 100 });
    }
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatCheckedAt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
