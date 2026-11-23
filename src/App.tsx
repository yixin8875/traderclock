import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Calendar, Clock3, LineChart, Settings as SettingsIcon } from "lucide-react";
import { api, type Config } from "./lib/api";
import TodayPage from "./pages/Today";
import ContractsPage from "./pages/Contracts";
import CalendarPage from "./pages/Calendar";
import SettingsPage, { type SettingsTabId } from "./pages/Settings";
import { applyUiPrefs, loadUiPrefs, type UiPrefs } from "./lib/ui-prefs";
import { autoCheckEnabled, checkForUpdate, isTauriRuntime } from "./lib/updater";
import { Button } from "./components/ui/button";
import { Alert, AlertDescription } from "./components/ui/alert";
import { cn } from "./lib/utils";
import type { Update } from "@tauri-apps/plugin-updater";

const PAGES = [
  { id: "today", label: "今日", Icon: Clock3 },
  { id: "calendar", label: "日历", Icon: Calendar },
  { id: "contracts", label: "合约", Icon: LineChart },
] as const;
type PageId = (typeof PAGES)[number]["id"];

export interface PageProps {
  cfg: Config;
  /** persist=false 只更新界面（后端已经保存过，例如上传提示音） */
  save: (next: Config, opts?: { persist?: boolean }) => Promise<void> | void;
}

export default function App() {
  // 启动页来自纯前端偏好；无效值由 normalizeUiPrefs 收敛回“今日”
  const [page, setPage] = useState<PageId>(() => loadUiPrefs().startPage);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId | undefined>();
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [calVer, setCalVer] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.getConfig().then(setCfg).catch((e) => setError(String(e)));
    api.getStatus().then((s) => setCalVer(s.calendar_version));
    const un = listen<Config>("config-changed", (e) => setCfg(e.payload));
    const unCal = listen("calendar-changed", () => {
      api.getStatus().then((s) => setCalVer(s.calendar_version));
    });
    return () => {
      void un.then((f) => f());
      void unCal.then((f) => f());
    };
  }, []);

  // 启动后静默检查一次更新：网络不通就安静跳过，用户仍可在“关于与更新”里手动检查
  useEffect(() => {
    if (!isTauriRuntime() || !autoCheckEnabled()) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      checkForUpdate()
        .then((next) => {
          if (!disposed && next) setPendingUpdate(next);
        })
        .catch(() => {
          // 离线或 GitHub 暂不可达时不打扰用户
        });
    }, 4000);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, []);

  // 主题/密度在 React 之外也生效：托盘条和浮窗各自读同一份 localStorage
  useEffect(() => {
    applyUiPrefs(loadUiPrefs());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemTheme = () => applyUiPrefs(loadUiPrefs());
    mq.addEventListener("change", onSystemTheme);
    const un = listen<UiPrefs>("ui-prefs-changed", (e) => applyUiPrefs(e.payload));
    return () => {
      mq.removeEventListener("change", onSystemTheme);
      void un.then((f) => f());
    };
  }, []);

  // 记住主窗口位置和大小：移动/缩放停下 400ms 后写回 Rust 配置，
  // 下次 open_main 在窗口显示前直接按记录创建，不会先居中再跳。
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let timer: number | undefined;
    let unMoved: (() => void) | undefined;
    let unResized: (() => void) | undefined;

    const saveGeometry = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          const win = getCurrentWindow();
          if (await win.isMaximized()) return;
          // 位置用外框左上角，尺寸用内容区：Rust 端分别对应 position/inner_size，
          // 避免每次启动都把标题栏和边框重复加进窗口大小。
          const [pos, size, sf] = await Promise.all([win.outerPosition(), win.innerSize(), win.scaleFactor()]);
          if (!disposed) {
            await api.saveWindowState(pos.x / sf, pos.y / sf, size.width / sf, size.height / sf);
          }
        } catch {
          // 浏览器预览没有窗口 API
        }
      }, 400);
    };

    void (async () => {
      try {
        const win = getCurrentWindow();
        unMoved = await win.onMoved(saveGeometry);
        unResized = await win.onResized(saveGeometry);
        if (disposed) {
          unMoved();
          unResized();
        }
      } catch {
        // 预览环境忽略
      }
    })();

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unMoved?.();
      unResized?.();
    };
  }, []);

  // 立即更新界面，再写入磁盘；失败时提示
  const save = (next: Config, opts?: { persist?: boolean }) => {
    setCfg(next);
    if (opts?.persist === false) return Promise.resolve();
    return api
      .setConfig(next)
      .then(setCfg)
      .catch((e) => setError(`保存失败：${e}`));
  };

  const openPage = (id: PageId) => {
    setSettingsOpen(false);
    setPage(id);
  };

  return (
    <div className="grid h-full grid-cols-[176px_1fr]">
      <aside className="flex flex-col gap-0.5 border-r border-border bg-sidebar px-3 pb-4 pt-4">
        <div className="mb-5 flex items-center gap-2 px-2 font-semibold text-sidebar-foreground">
          <Logo /> TradeClock
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="主导航">
          {PAGES.map((p) => {
            const active = !settingsOpen && page === p.id;
            return (
              <Button
                key={p.id}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "nav-item h-auto justify-start gap-2.5 rounded-lg border-transparent px-2 py-2 text-sm font-normal text-muted-foreground hover:text-foreground",
                  active &&
                    "bg-card font-semibold text-foreground shadow-xs/5 hover:bg-card dark:bg-accent dark:hover:bg-accent",
                )}
                variant="ghost"
                onClick={() => openPage(p.id)}
              >
                <p.Icon className="size-4 opacity-70" />
                {p.label}
              </Button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2">
          <p className="px-2 text-[11.5px] leading-5 text-muted-foreground">日历数据 {calVer || "--"}</p>
          <Button
            aria-current={settingsOpen ? "page" : undefined}
            className={cn(
              "nav-item h-auto w-full justify-start gap-2.5 rounded-lg border-transparent px-2 py-2 text-sm font-normal text-muted-foreground hover:text-foreground",
              settingsOpen &&
                "bg-card font-semibold text-foreground shadow-xs/5 hover:bg-card dark:bg-accent dark:hover:bg-accent",
            )}
            variant="ghost"
            onClick={() => {
              setSettingsTab(undefined);
              setSettingsOpen(true);
            }}
          >
            <SettingsIcon className="size-4 opacity-70" />
            设置
          </Button>
        </div>
      </aside>

      <main className="overflow-auto px-8 py-5">
        {pendingUpdate && (
          <Alert className="mb-4 flex items-center justify-between gap-3 py-2" role="status">
            <AlertDescription className="flex flex-row flex-wrap items-center gap-x-1 text-[12.5px] text-foreground">
              发现新版本 <b className="num font-medium">v{pendingUpdate.version}</b>
              <span className="text-muted-foreground">当前 v{pendingUpdate.currentVersion}</span>
            </AlertDescription>
            <span className="flex flex-none items-center gap-1">
              <Button
                size="xs"
                onClick={() => {
                  setSettingsTab("about");
                  setSettingsOpen(true);
                }}
              >
                查看更新
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setPendingUpdate(null)}>
                稍后
              </Button>
            </span>
          </Alert>
        )}
        {error && (
          <Alert className="mb-4 py-2" variant="error">
            <AlertDescription className="text-[12.5px] text-destructive-foreground">{error}</AlertDescription>
          </Alert>
        )}
        {!cfg ? null : settingsOpen ? (
          <SettingsPage key={settingsTab ?? "default"} cfg={cfg} save={save} initialTab={settingsTab} />
        ) : page === "today" ? (
          <TodayPage cfg={cfg} save={save} />
        ) : page === "calendar" ? (
          <CalendarPage />
        ) : (
          <ContractsPage cfg={cfg} save={save} />
        )}
      </main>
    </div>
  );
}

function Logo() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="none" stroke="#F0A020" strokeWidth="2.5" />
      <path d="M10 5v5l3 2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
