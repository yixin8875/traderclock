import { useState } from "react";
import SymbolsPage from "./Symbols";
import PeriodsPage from "./Periods";
import KeysPage from "./Keys";
import NewsPage from "./News";
import AlertsPage from "./Alerts";
import GeneralPage from "./General";
import DataPage from "./Data";
import AboutPage from "./About";
import { Tabs, TabsList, TabsTab } from "../components/ui/tabs";
import type { PageProps } from "../App";

const TABS = [
  { id: "symbols", label: "交易品种", Comp: SymbolsPage },
  { id: "periods", label: "K 线周期", Comp: PeriodsPage },
  { id: "keys", label: "关键时点", Comp: KeysPage },
  { id: "news", label: "财经日历", Comp: NewsPage },
  { id: "alerts", label: "提醒方式", Comp: AlertsPage },
  { id: "general", label: "外观", Comp: GeneralPage },
  { id: "data", label: "数据", Comp: DataPage },
  { id: "about", label: "关于", Comp: AboutPage },
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
      <Tabs className="mb-5" value={tab} onValueChange={(next) => setTab(next as SettingsTabId)}>
        <TabsList aria-label="设置分类" className="flex-wrap">
          {TABS.map((t) => (
            <TabsTab key={t.id} className="settings-tab px-2.5 text-[12.5px]" value={t.id}>
              {t.label}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1 overflow-auto pr-2">
        <Active {...props} />
      </div>
    </div>
  );
}
