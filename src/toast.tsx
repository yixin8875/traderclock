// 提醒浮窗：独立入口，只加载这一页需要的代码。关闭即销毁窗口，释放内存。
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, type Alert } from "./lib/api";
import { hmBJ, hmIn, periodLabel } from "./lib/format";
import { applyUiPrefs, loadUiPrefs } from "./lib/ui-prefs";
import "./styles.css";

applyUiPrefs(loadUiPrefs());

function Toast() {
  const [alert, setAlert] = useState<Alert | null>(null);
  const [life, setLife] = useState(8);
  const timer = useRef<number>();
  const close = () => void getCurrentWindow().close();

  useEffect(() => {
    Promise.all([api.currentAlert(), api.getConfig()]).then(([a, c]) => {
      setAlert(a);
      setLife(c.toast_seconds);
      timer.current = window.setTimeout(close, c.toast_seconds * 1000);
    });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  // 鼠标停在浮窗上时不自动关闭，移开 3 秒后关闭
  const hold = () => clearTimeout(timer.current);
  const release = () => (timer.current = window.setTimeout(close, 3000));

  if (!alert) return null;
  const bars = alert.bars.map(periodLabel).join(" + ");

  return (
    <div
      onMouseEnter={hold}
      onMouseLeave={release}
      role="status"
      className="flex h-full flex-col overflow-hidden bg-surface [animation:toast-in_.3s_cubic-bezier(.2,.8,.2,1)]"
    >
      {alert.risk && (
        <div className="bg-red-600 px-4 py-1 text-xs font-semibold text-white" title={alert.risk}>
          风险窗口，谨慎开新仓 · {alert.risk}
        </div>
      )}
      {alert.keys.length > 0 && (
        <div className="bg-amber-soft px-4 py-1 text-xs font-semibold text-amber-ink">{alert.keys.join(" + ")}</div>
      )}
      {alert.news.length > 0 && (
        <div className="bg-danger-soft px-4 py-1 text-xs font-semibold text-danger-ink" title={alert.news.join("\n")}>
          {alert.news.length > 1 ? `${alert.news[0]} 等 ${alert.news.length} 条` : alert.news[0]}
        </div>
      )}
      {alert.rolls.length > 0 && (
        <div className="bg-roll-soft px-4 py-1 text-xs font-semibold text-roll-ink" title={alert.rolls.join("\n")}>
          {alert.rolls.join(" + ")}
        </div>
      )}
      <div className="flex flex-1 flex-col justify-center px-4">
        <div className="flex items-baseline justify-between">
          <b className="text-[15px] font-semibold">
            {bars ? `${bars} 收盘` : alert.news.length ? "数据发布" : alert.rolls.length ? "换月提醒" : "关键时点"}
          </b>
          <span className="num text-[26px] font-semibold">{hmBJ(alert.at)}</span>
        </div>
        <p className="mb-2 text-[12.5px] text-mute">
          芝加哥 {hmIn(alert.at, "America/Chicago")} · {alert.session}
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={() => api.pause(15).then(close)} className="rounded-md bg-soft px-3 py-1 text-[12.5px]">
            暂停 15 分钟
          </button>
          <button onClick={close} className="rounded-md bg-ink px-3 py-1 text-[12.5px] font-semibold text-white">
            已看
          </button>
        </div>
      </div>
      <div className="h-[3px] origin-left bg-amber" style={{ animation: `life ${life}s linear forwards` }} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Toast />
  </React.StrictMode>,
);
