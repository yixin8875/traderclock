import { useEffect, useRef, useState } from "react";
import { api, type Diagnostics } from "../lib/api";
import { loadUiPrefs, normalizeUiPrefs, saveUiPrefs } from "../lib/ui-prefs";
import { Group, PageHead, Row } from "../components/ui";
import type { PageProps } from "../App";

function downloadJson(name: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stampName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `TradeClock-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
}

const BTN =
  "rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink hover:bg-soft disabled:opacity-50";
const PRIMARY =
  "rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50";

export default function DataPage({ save }: PageProps) {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    api
      .getDiagnostics()
      .then((next) => {
        setDiag(next);
        setError("");
      })
      .catch((e) => setError(String(e)));
  };

  useEffect(load, []);

  const exportBackup = async () => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const raw = await api.exportBackup();
      const payload = JSON.parse(raw) as Record<string, unknown>;
      payload.ui = loadUiPrefs();
      downloadJson(stampName(), JSON.stringify(payload, null, 2));
      setMsg("已导出配置、自定义日历和界面偏好");
    } catch (e) {
      setError(`导出失败：${e}`);
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    if (!window.confirm("导入会覆盖当前提醒设置和自定义日历，确定继续？")) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as { ui?: unknown };
      const next = await api.importBackup(text);
      if (payload.ui && typeof payload.ui === "object") {
        saveUiPrefs(normalizeUiPrefs(payload.ui));
      }
      save(next, { persist: false });
      setMsg("配置已恢复，界面偏好也已同步");
      load();
    } catch (e) {
      setError(`导入失败：${e}`);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("恢复默认提醒设置？自定义日历和界面偏好会保留。")) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const next = await api.resetConfig();
      save(next, { persist: false });
      setMsg("已恢复默认提醒设置");
      load();
    } catch (e) {
      setError(`恢复失败：${e}`);
    } finally {
      setBusy(false);
    }
  };

  const refreshNews = async () => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const n = await api.refreshNews();
      setMsg(`已更新 ${n} 条财经数据`);
      load();
    } catch (e) {
      setError(`刷新失败：${e}`);
      load();
    } finally {
      setBusy(false);
    }
  };

  const copyDiagnostics = async () => {
    if (!diag) return;
    const text = [
      `TradeClock ${diag.version}`,
      `配置：${diag.config_path}`,
      `日历：${diag.calendar_version || "内置规则"}`,
      `财经更新：${diag.news_updated ? new Date(diag.news_updated).toLocaleString("zh-CN") : "尚未更新"}`,
      `财经事件：${diag.news_count} 条`,
      diag.news_error ? `财经错误：${diag.news_error}` : "财经状态：正常",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMsg("诊断信息已复制");
    } catch (e) {
      setError(`复制失败：${e}`);
    }
  };

  const updated = diag?.news_updated
    ? new Date(diag.news_updated).toLocaleString("zh-CN", { hour12: false })
    : "尚未更新";

  return (
    <>
      <PageHead title="数据与诊断" />

      <Group title="备份与恢复">
        <Row label="导出配置" hint="提醒设置、自定义日历、窗口和界面偏好">
          <button type="button" onClick={exportBackup} disabled={busy} className={PRIMARY}>
            导出 JSON
          </button>
        </Row>
        <Row label="导入配置" hint="会覆盖当前提醒设置和自定义日历">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={BTN}>
            选择文件
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </Row>
        <Row label="恢复默认" hint="只重置提醒设置，保留日历和界面偏好">
          <button type="button" onClick={reset} disabled={busy} className={BTN}>
            恢复默认
          </button>
        </Row>
      </Group>

      <Group title="运行状态">
        <Row label="程序版本">
          <span className="num text-[12px] text-mute">v{diag?.version ?? "--"}</span>
        </Row>
        <Row label="数据目录">
          <span className="max-w-[360px] truncate text-[11px] text-mute" title={diag?.data_dir}>
            {diag?.data_dir || "--"}
          </span>
        </Row>
        <Row label="休市日历">
          <span className="text-[12px] text-mute">{diag?.calendar_version || "内置规则"}</span>
        </Row>
        <Row label="财经数据">
          <span className="num text-[12px] text-mute">
            {updated} · {diag?.news_count ?? 0} 条
          </span>
        </Row>
        <Row label="财经状态">
          <span className={diag?.news_error ? "text-[12px] text-danger-ink" : "text-[12px] text-success-ink"}>
            {diag?.news_error ?? "正常"}
          </span>
        </Row>
      </Group>

      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" onClick={refreshNews} disabled={busy} className={BTN}>
          {busy ? "处理中…" : "立即刷新财经数据"}
        </button>
        <button type="button" onClick={() => void api.openDataDir().catch((e) => setError(String(e)))} className={BTN}>
          打开数据目录
        </button>
        <button type="button" onClick={copyDiagnostics} disabled={!diag} className={BTN}>
          复制诊断信息
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger-ink">
          {error}
        </p>
      )}
      {msg && (
        <p role="status" className="mb-3 rounded-lg bg-success-soft px-3 py-2 text-[12.5px] text-success-ink">
          {msg}
        </p>
      )}

      <p className="text-[12.5px] leading-6 text-mute">
        备份文件是普通 JSON，可以自己保存或放到另一台电脑导入。自定义提示音文件不会写进 JSON；换机器后如果音频不存在，会自动退回系统提示音。
      </p>
    </>
  );
}
