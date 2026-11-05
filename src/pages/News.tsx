import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type Impact, type NewsInfo } from "../lib/api";
import { hmBJ } from "../lib/format";
import { Group, PageHead, Row, Switch } from "../components/ui";
import type { PageProps } from "../App";

const IMPACTS: { id: Impact; label: string }[] = [
  { id: "high", label: "高" },
  { id: "medium", label: "中" },
  { id: "low", label: "低" },
];
const RISK_MIN = [3, 5, 10, 15, 30];
const LEADS = [0, 1, 2, 5, 10];
const PREWARN = [0, 10, 15, 30, 60];
const DOT: Record<string, string> = { high: "bg-red-600", medium: "bg-orange-400", low: "bg-yellow-300" };

const dayBJ = (iso: string) =>
  new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", weekday: "short" }).format(
    new Date(iso),
  );

export default function NewsPage({ cfg, save }: PageProps) {
  const [info, setInfo] = useState<NewsInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const load = () => void api.getNews().then(setInfo);
    load();
    const un = listen("news-changed", load);
    return () => void un.then((f) => f());
  }, [cfg]);

  const refresh = () => {
    setBusy(true);
    setMsg("");
    api
      .refreshNews()
      .then((n) => setMsg(`已更新，本周共 ${n} 条`))
      .catch((e) => setMsg(String(e)))
      .finally(() => setBusy(false));
  };

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const currencies = [...new Set(["USD", ...(info?.currencies ?? []), ...cfg.news_currencies])].sort();

  const updated = info?.state.updated;
  const status = info?.state.error
    ? `更新失败：${info.state.error}`
    : updated
      ? `上次更新 ${dayBJ(updated)} ${hmBJ(updated)}，每小时自动更新`
      : "尚未下载数据";

  // 按北京时间日期分组
  const byDay = new Map<string, NewsInfo["events"]>();
  for (const e of info?.events ?? []) {
    const k = dayBJ(e.at);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }

  return (
    <>
      <PageHead title="财经日历" />
      <Group title="数据提醒">
        <Row label="启用" hint="数据来自 ForexFactory 官方周数据文件">
          <Switch checked={cfg.news_enabled} label="启用财经日历提醒" onChange={(v) => save({ ...cfg, news_enabled: v })} />
        </Row>
        <Row label="关注币种" hint="USD 数据会影响黄金和美股指数">
          <div className="flex flex-wrap justify-end gap-1.5">
            {currencies.map((c) => (
              <Chip key={c} on={cfg.news_currencies.includes(c)} onClick={() => save({ ...cfg, news_currencies: toggle(cfg.news_currencies, c) })}>
                {c}
              </Chip>
            ))}
          </div>
        </Row>
        <Row label="重要程度">
          <div className="flex gap-1.5">
            {IMPACTS.map((i) => (
              <Chip key={i.id} on={cfg.news_impacts.includes(i.id)} onClick={() => save({ ...cfg, news_impacts: toggle(cfg.news_impacts, i.id) })}>
                {i.label}
              </Chip>
            ))}
          </div>
        </Row>
        <Row label="提前提醒">
          <div className="flex gap-1.5">
            {LEADS.map((m) => (
              <Chip key={m} on={cfg.news_lead_minutes === m} onClick={() => save({ ...cfg, news_lead_minutes: m })}>
                {m === 0 ? "准点" : `${m} 分钟`}
              </Chip>
            ))}
          </div>
        </Row>
        <Row label="高重要度额外预警" hint="非农、CPI 等在常规提醒之外更早再提醒一次">
          <div className="flex gap-1.5">
            {PREWARN.map((m) => (
              <Chip key={m} on={cfg.news_prewarn_minutes === m} onClick={() => save({ ...cfg, news_prewarn_minutes: m })}>
                {m === 0 ? "关闭" : `${m} 分钟`}
              </Chip>
            ))}
          </div>
        </Row>
      </Group>

      <Group title="风险窗口">
        <Row label="启用" hint="高重要度数据前后在今日时间轴上标红，窗口内的提醒会写明“谨慎开新仓”">
          <Switch checked={cfg.risk_enabled} label="启用风险窗口" onChange={(v) => save({ ...cfg, risk_enabled: v })} />
        </Row>
        <Row label="公布前">
          <div className="flex gap-1.5">
            {RISK_MIN.map((m) => (
              <Chip key={m} on={cfg.risk_before_minutes === m} onClick={() => save({ ...cfg, risk_before_minutes: m })}>
                {m} 分钟
              </Chip>
            ))}
          </div>
        </Row>
        <Row label="公布后">
          <div className="flex gap-1.5">
            {RISK_MIN.map((m) => (
              <Chip key={m} on={cfg.risk_after_minutes === m} onClick={() => save({ ...cfg, risk_after_minutes: m })}>
                {m} 分钟
              </Chip>
            ))}
          </div>
        </Row>
      </Group>

      <div className="mb-2 flex items-center justify-between">
        <span className={`text-[12.5px] ${info?.state.error ? "text-red-700" : "text-mute"}`}>{msg || status}</span>
        <button
          onClick={refresh}
          disabled={busy}
          className="rounded-lg border border-line bg-soft px-3 py-1 text-[12.5px] hover:bg-hover disabled:opacity-50"
        >
          {busy ? "更新中…" : "立即更新"}
        </button>
      </div>

      {byDay.size === 0 ? (
        <p className="py-6 text-center text-[13px] text-mute">本周暂无符合条件的数据</p>
      ) : (
        [...byDay].map(([day, list]) => (
          <Group key={day} title={day}>
            {list.map((e) => (
              <div key={e.at + e.title} className="grid grid-cols-[52px_12px_1fr_auto] items-center gap-2 px-4 py-2 text-[13px]">
                <span className="num font-semibold">{hmBJ(e.at)}</span>
                <i className={`h-2 w-2 rounded-full ${DOT[e.impact]}`} title={IMPACTS.find((i) => i.id === e.impact)?.label} />
                <span>
                  <span className="mr-1.5 text-mute">{e.country}</span>
                  {e.title}
                </span>
                <span className="num text-[12px] text-mute">
                  {e.forecast && `预期 ${e.forecast}`}
                  {e.previous && ` · 前值 ${e.previous}`}
                </span>
              </div>
            ))}
          </Group>
        ))
      )}
      <p className="mt-2 text-[12px] text-mute">时间为北京时间。数据可能临时改期，以 ForexFactory 网站为准。</p>
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-md px-2.5 py-0.5 text-[12.5px] ${on ? "bg-ink font-semibold text-white" : "bg-soft text-mute hover:text-ink"}`}
    >
      {children}
    </button>
  );
}
