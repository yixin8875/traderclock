import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { Download, RefreshCw } from "lucide-react";
import { Group, Row, Switch } from "../components/kit";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
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
      <Group title="版本">
        <Row label="当前版本" hint={version || "--"}>
          <span />
        </Row>
        <Row label="自动检查更新" hint="启动后静默检查，有新版本才提示">
          <Switch checked={auto} onChange={toggleAuto} label="自动检查更新" />
        </Row>
        <Row label="检查更新" hint={checkedAt ? `上次检查 ${formatCheckedAt(checkedAt)}` : "尚未检查"}>
          <Button disabled={phase === "checking"} size="xs" variant="outline" onClick={runCheck}>
            <RefreshCw className={phase === "checking" ? "animate-spin" : undefined} />
            {phase === "checking" ? "检查中…" : "立即检查"}
          </Button>
        </Row>
      </Group>

      {phase === "available" && update && (
        <Alert className="mb-5" variant="warning">
          <div className="col-span-full flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-warning-foreground">发现新版本 v{update.version}</p>
              <p className="mt-0.5 text-[12.5px] text-warning-foreground/80">当前版本 v{update.currentVersion}</p>
            </div>
            <Button size="sm" onClick={install}>
              <Download />
              下载并安装
            </Button>
          </div>
          {update.body && (
            <pre className="col-span-full mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-background/70 px-2.5 py-2 font-sans text-[12px] leading-5 text-foreground">
              {update.body}
            </pre>
          )}
        </Alert>
      )}

      {phase === "downloading" && (
        <section aria-live="polite" className="mb-5 rounded-xl border border-border bg-card px-3.5 py-3">
          <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
            <span className="font-medium">正在下载更新</span>
            <span className="num text-muted-foreground">
              {progress.total
                ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
                : formatBytes(progress.downloaded)}
            </span>
          </div>
          <div
            aria-valuenow={progress.percent ?? 0}
            className="h-1.5 overflow-hidden rounded-full bg-border"
            role="progressbar"
          >
            <div
              className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-200"
              style={{ transform: `scaleX(${(progress.percent ?? 8) / 100})` }}
            />
          </div>
          <p className="mt-1.5 text-[12px] text-muted-foreground">
            {progress.percent !== undefined ? `${progress.percent}%` : "下载中…"} · 完成后会自动安装并重启
          </p>
        </section>
      )}

      {(phase === "latest" || phase === "installing" || phase === "error") && (
        <Alert className="mb-5 py-2" variant={phase === "error" ? "error" : "default"}>
          <AlertDescription className="text-[13px] leading-5">
            {phase === "latest" && "已是最新版本"}
            {phase === "installing" && message}
            {phase === "error" && message}
          </AlertDescription>
        </Alert>
      )}

      <p className="text-[12.5px] leading-5 text-muted-foreground">
        更新包来自 GitHub Releases（yixin8875/traderclock），下载后会用内置公钥校验签名，校验不通过不会安装。
        <br />
        首次使用建议保留自动检查更新；手动安装的版本也能收到后续更新。
      </p>
    </>
  );
}
