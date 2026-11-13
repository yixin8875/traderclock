// 桌面悬浮倒计时条：独立入口，体积很小。始终置顶，可拖动，双击打开设置。
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { api, type ContractInfo, type NewsEvent, type Status } from "./lib/api";
import { countdown, periodLabel } from "./lib/format";
import { applyUiPrefs, loadUiPrefs, type UiPrefs } from "./lib/ui-prefs";
import "./styles.css";

applyUiPrefs(loadUiPrefs());

const ONE_LINE = { w: 236, h: 30 };
const TWO_LINE = { w: 236, h: 50 };

function label(s: Status): string {
  const a = s.next;
  if (!a) return "未来 10 天无提醒";
  if (a.rolls.length) return a.rolls[0];
  if (a.bars.length) return `${a.bars.map(periodLabel).join("+")} 收盘`;
  if (a.news.length) return "数据发布";
  return a.keys[0] ?? "关键时点";
}

/** 高影响数据可能隔几天，按天/小时显示，避免出现 51:22:00 这种难读的倒计时。 */
function until(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3_600)}h`;
  if (s >= 3_600) return `${Math.floor(s / 3_600)}h ${String(Math.floor((s % 3_600) / 60)).padStart(2, "0")}m`;
  return countdown(ms);
}

function Bar() {
  const [st, setSt] = useState<Status | null>(null);
  const [contracts, setContracts] = useState<ContractInfo[]>([]);
  const [news, setNews] = useState<NewsEvent[]>([]);
  const [prefs, setPrefs] = useState<UiPrefs>(loadUiPrefs);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0); // 本机时钟与核心时钟的差
  const windowStyle = useRef("");

  const load = () => {
    api.getStatus().then((s) => {
      offset.current = new Date(s.now).getTime() - Date.now();
      setSt(s);
    });
    api.getContracts().then(setContracts).catch(() => {
      // 合约接口失败不影响倒计时
    });
    api.getNews().then((n) => setNews(n.events)).catch(() => {
      // 财经接口失败不影响倒计时
    });
  };

  useEffect(() => {
    load();
    const un = [
      listen("alert", load),
      listen("pause-changed", load),
      listen("config-changed", load),
      listen("news-changed", load),
    ];
    // 每 30 秒校准一次，防止睡眠唤醒后显示旧数据
    const sync = window.setInterval(load, 30_000);
    return () => {
      clearInterval(sync);
      un.forEach((p) => p.then((f) => f()));
    };
  }, []);

  // 悬浮条样式、锁定、穿透和透明度都来自纯前端偏好
  useEffect(() => {
    const apply = async (next: UiPrefs) => {
      setPrefs(next);
      applyUiPrefs(next);
      try {
        const win = getCurrentWindow();
        const size = next.barStyle === "one-line" ? ONE_LINE : TWO_LINE;
        const key = `${size.w}x${size.h}`;
        if (windowStyle.current !== key) {
          const old = await win.outerSize();
          const pos = await win.outerPosition();
          const sf = await win.scaleFactor();
          const oldW = old.width / sf;
          await win.setSize(new LogicalSize(size.w, size.h));
          // 变宽时向左补，保持右上角位置不跑出屏幕
          if (Math.abs(oldW - size.w) > 1) {
            await win.setPosition(new LogicalPosition(pos.x / sf + (oldW - size.w), pos.y / sf));
          }
          windowStyle.current = key;
        }
        await win.setIgnoreCursorEvents(next.barClickThrough);
      } catch {
        // 浏览器预览或平台不支持窗口 API 时只保留视觉样式
      }
    };

    void apply(loadUiPrefs());
    const onLocal = () => void apply(loadUiPrefs());
    const un = listen<UiPrefs>("ui-prefs-changed", (e) => void apply(e.payload));
    window.addEventListener("ui-prefs-changed", onLocal);
    window.addEventListener("storage", onLocal);
    return () => {
      window.removeEventListener("ui-prefs-changed", onLocal);
      window.removeEventListener("storage", onLocal);
      void un.then((f) => f());
    };
  }, []);

  // 倒计时每秒刷新；到点后重新取下一个提醒
  useEffect(() => {
    const t = window.setInterval(() => {
      const n = Date.now() + offset.current;
      setNow(n);
      if (st?.next && n >= new Date(st.next.at).getTime() + 1000) load();
    }, 1000);
    return () => clearInterval(t);
  }, [st]);

  // 拖动结束后保存位置（逻辑像素）
  useEffect(() => {
    const w = getCurrentWindow();
    let timer: number | undefined;
    const un = w.onMoved(({ payload }) => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const sf = await w.scaleFactor();
        api.saveBarPos(payload.x / sf, payload.y / sf);
      }, 400);
    });
    return () => void un.then((f) => f());
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (e.detail === 2) {
      api.openSettings();
    } else if (!prefs.barLocked) {
      void getCurrentWindow().startDragging();
    }
  };

  const paused = !!st?.paused_until && new Date(st.paused_until).getTime() > now;
  const left = st?.next ? new Date(st.next.at).getTime() - now : 0;
  const soon = !paused && st?.next && left <= 60_000;
  const risk = !paused && !!st?.next?.risk;
  const current = contracts.find((c) => c.enabled)?.current_code;
  const nextHigh = news.find((e) => e.impact === "high" && new Date(e.at).getTime() > now);
  const highLeft = nextHigh ? new Date(nextHigh.at).getTime() - now : 0;

  const tone = paused
    ? "bg-hud-soft text-hud-mute"
    : risk
      ? "bg-danger-solid text-white"
      : soon
        ? "bg-amber text-on-amber"
        : "bg-hud text-hud-ink";

  const twoLine = prefs.barStyle !== "one-line";
  const title = [
    nextHigh ? `下一个高影响数据：${nextHigh.country} ${nextHigh.title}` : "",
    risk ? `风险窗口：${st?.next?.risk}，谨慎开新仓` : "",
    prefs.barLocked ? "已锁定位置" : "拖动移动位置",
    "双击打开设置",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      onMouseDown={onMouseDown}
      title={title}
      style={{ opacity: prefs.barOpacity / 100 }}
      className={`flex h-screen select-none ${prefs.barLocked ? "cursor-default" : "cursor-move"} ${tone} ${
        twoLine ? "flex-col justify-center gap-0.5 px-3 py-1" : "items-center gap-2 px-3 text-[13px]"
      }`}
    >
      {twoLine ? (
        <>
          <div className="flex w-full items-center gap-2 text-[12px]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${!paused && st?.open ? "bg-success" : "bg-hud-mute"}`} />
            {!st ? (
              <span className="opacity-70">TradeClock</span>
            ) : paused ? (
              <span className="truncate">已暂停提醒</span>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">
                  下次 {label(st)}
                </span>
                {st.next && <b className="num shrink-0 font-semibold tabular-nums">{countdown(left)}</b>}
              </>
            )}
          </div>
          <div className="flex w-full items-center justify-between gap-2 text-[11px] opacity-80">
            <span className="num shrink-0">
              {current ?? "—"} · {st?.open ? "交易中" : "休市"}
            </span>
            {nextHigh ? (
              <span
                className="flex min-w-0 flex-1 items-center justify-end gap-1"
                title={`${nextHigh.country} ${nextHigh.title}`}
              >
                <span className="truncate">
                  {nextHigh.country} {nextHigh.title}
                </span>
                <b className="num shrink-0 font-semibold">{until(highLeft)}</b>
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-right">{st?.next?.session ?? ""}</span>
            )}
          </div>
        </>
      ) : (
        <>
          <span className={`h-2 w-2 shrink-0 rounded-full ${!paused && st?.open ? "bg-success" : "bg-hud-mute"}`} />
          {!st ? (
            <span className="opacity-70">TradeClock</span>
          ) : paused ? (
            <span className="truncate">已暂停提醒</span>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate">
                下次 {label(st)}
              </span>
              {st.next && <b className="num font-semibold tabular-nums">{countdown(left)}</b>}
            </>
          )}
        </>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Bar />
  </React.StrictMode>,
);
