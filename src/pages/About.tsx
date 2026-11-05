import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { Group, PageHead, Row, Switch } from "../components/ui";
import {
  appVersion,
  autoCheckEnabled,
  checkForUpdate,
  downloadAndInstall,
  formatBytes,
  formatCheckedAt,
  isTauriRuntime,
  setAutoCheckEnabled,
  type InstallProgress,
} from "../lib/updater";

const BTN =
  "rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink hover:bg-soft disabled:opacity-50";
const PRIMARY =
  "rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50";

type Phase = "idle" | "checking" | "latest" | "available" | "downloading" | "installing" | "error";

export default function AboutPage() {
  const [version, setVersion] = useState("");
  const [auto, setAuto] = useState(autoCheckEnabled);
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<InstallProgress>({ downloaded: 0 });
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => void appVersion().then(setVersion), []);

  const runCheck = async () => {
    if (phase === "checking" || phase === "downloading" || phase === "installing") return;
    if (!isTauriRuntime()) {
      setPhase("error");
      setMessage("浏览器预览中无法检查更新，请在桌面程序里操作。");
      return;
    }
    setPhase("checking");
    setMessage("");
    try {
      const next = await checkForUpdate();
      setCheckedAt(new Date());
      if (next) {
        setUpdate(next);
        setPhase("available");
      } else {
        setUpdate(null);
        setPhase("latest");
      }
    } catch (e) {
      setPhase("error");
      setMessage(`检查失败：${String(e)}`);
    }
  };

  const install = async () => {
    if (!update) return;
    setPhase("downloading");
    setProgress({ downloaded: 0 });
    try {
      await downloadAndInstall(update, setProgress);
      // Windows 上安装器会接管并重启应用，通常走不到这里
      setPhase("installing");
      setMessage("安装程序已启动，应用会自动重启完成更新。");
    } catch (e) {
      setPhase("error");
      setMessage(`下载或安装失败：${String(e)}`);
    }
  };

  const toggleAuto = (on: boolean) => {
    setAuto(on);
    setAutoCheckEnabled(on);
  };

  return (
    <>
      <PageHead title="关于与更新" />

      <Group title="版本">
        <Row label="当前版本" hint={version || "--"}>
          <span />
        </Row>
        <Row label="自动检查更新" hint="启动后静默检查，有新版本才提示">
          <Switch checked={auto} onChange={toggleAuto} label="自动检查更新" />
        </Row>
        <Row label="检查更新" hint={checkedAt ? `上次检查 ${formatCheckedAt(checkedAt)}` : "尚未检查"}>
          <button type="button" onClick={runCheck} disabled={phase === "checking"} className={BTN}>
            {phase === "checking" ? "检查中…" : "立即检查"}
          </button>
        </Row>
      </Group>

      {phase === "available" && update && (
        <section className="mb-5 rounded-xl bg-amber-soft px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-ink">发现新版本 v{update.version}</p>
              <p className="mt-0.5 text-[12.5px] text-amber-ink/80">当前版本 v{update.currentVersion}</p>
            </div>
            <button type="button" onClick={install} className={PRIMARY}>
              下载并安装
            </button>
          </div>
          {update.body && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface/70 px-2.5 py-2 text-[12px] leading-5 text-ink">
              {update.body}
            </pre>
          )}
        </section>
      )}

      {phase === "downloading" && (
        <section className="mb-5 rounded-xl bg-soft px-3.5 py-3" aria-live="polite">
          <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
            <span className="font-medium">正在下载更新</span>
            <span className="num text-mute">
              {progress.total
                ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
                : formatBytes(progress.downloaded)}
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={progress.percent ?? 0}
          >
            <div
              className="h-full rounded-full bg-amber transition-[width] duration-200"
              style={{ width: `${progress.percent ?? 8}%` }}
            />
          </div>
          <p className="mt-1.5 text-[12px] text-mute">
            {progress.percent !== undefined ? `${progress.percent}%` : "下载中…"} · 完成后会自动安装并重启
          </p>
        </section>
      )}

      {(phase === "latest" || phase === "installing" || phase === "error") && (
        <p
          role={phase === "error" ? "alert" : "status"}
          className={`mb-5 rounded-lg px-3 py-2 text-[13px] leading-5 ${
            phase === "error" ? "bg-danger-soft text-danger-ink" : "bg-soft text-mute"
          }`}
        >
          {phase === "latest" && "已是最新版本。"}
          {phase === "installing" && message}
          {phase === "error" && message}
        </p>
      )}

      <p className="text-[13px] leading-6 text-mute">
        更新包来自 GitHub Releases（yixin8875/traderclock），下载后会用内置公钥校验签名，校验不通过不会安装。
        <br />
        首次使用建议保留自动检查更新；手动安装的版本也能收到后续更新。
      </p>
    </>
  );
}
