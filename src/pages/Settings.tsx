import { useState } from "react";
import SymbolsPage from "./Symbols";
import PeriodsPage from "./Periods";
import KeysPage from "./Keys";
import NewsPage from "./News";
import AlertsPage from "./Alerts";
import GeneralPage from "./General";
import DataPage from "./Data";
import AboutPage from "./About";
import type { PageProps } from "../App";

const TABS = [
  { id: "symbols", label: "交易品种", Comp: SymbolsPage },
  { id: "periods", label: "K 线周期", Comp: PeriodsPage },
  { id: "keys", label: "关键时点", Comp: KeysPage },
  { id: "news", label: "财经日历", Comp: NewsPage },
  { id: "alerts", label: "提醒方式", Comp: AlertsPage },
  { id: "general", label: "常规与外观", Comp: GeneralPage },
  { id: "data", label: "数据与诊断", Comp: DataPage },
  { id: "about", label: "关于与更新", Comp: AboutPage },
] as const;

export type SettingsTabId = (typeof TABS)[number]["id"];

export default function SettingsPage({
  initialTab,
  ...props
}: PageProps & { initialTab?: SettingsTabId }) {
  const [tab, setTab] = useState<SettingsTabId>(initialTab ?? "symbols");
  const Active = TABS.find((t) => t.id === tab)!.Comp;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-line pb-2.5" aria-label="设置分类">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`settings-tab rounded-lg px-3 py-1.5 text-[12.5px] transition-colors ${
              tab === t.id
                ? "bg-surface font-semibold text-ink shadow-sm ring-1 ring-line"
                : "text-mute hover:bg-soft hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <Active {...props} />
      </div>
    </div>
  );
}
