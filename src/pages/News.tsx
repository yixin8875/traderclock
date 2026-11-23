import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { RefreshCw } from "lucide-react";
import { api, type Impact, type NewsInfo } from "../lib/api";
import { hmBJ } from "../lib/format";
import { ChoiceGroup, Group, MultiChoiceGroup, Row, Switch } from "../components/kit";
import { Button } from "../components/ui/button";
import type { PageProps } from "../App";

const IMPACTS: { id: Impact; label: string }[] = [
  { id: "high", label: "高" },
  { id: "medium", label: "中" },
  { id: "low", label: "低" },
];
const RISK_MIN = [3, 5, 10, 15, 30];
const LEADS = [0, 1, 2, 5, 10];
const PREWARN = [0, 10, 15, 30, 60];
const DOT: Record<string, string> = { high: "bg-danger-solid", medium: "bg-amber", low: "bg-mark-muted" };

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
      <Group title="数据提醒">
        <Row label="启用" hint="数据来自 ForexFactory 官方周数据文件">
          <Switch checked={cfg.news_enabled} label="启用财经日历提醒" onChange={(v) => save({ ...cfg, news_enabled: v })} />
        </Row>
        <Row label="关注币种" hint="USD 数据会影响黄金和美股指数">
          <div className="flex flex-wrap justify-end">
            <MultiChoiceGroup<string>
              label="关注币种"
              options={currencies.map((c) => ({ value: c, label: c }))}
              values={cfg.news_currencies}
              onChange={(next) => save({ ...cfg, news_currencies: next })}
            />
          </div>
        </Row>
        <Row label="重要程度">
          <MultiChoiceGroup
            label="重要程度"
            options={IMPACTS.map((i) => ({ value: i.id as Impact, label: i.label }))}
            values={cfg.news_impacts}
            onChange={(next) => save({ ...cfg, news_impacts: next })}
          />
        </Row>
        <Row label="提前提醒">
          <ChoiceGroup
            label="提前提醒"
            options={LEADS.map((m) => ({ value: m, label: m === 0 ? "准点" : `${m} 分钟` }))}
            value={cfg.news_lead_minutes}
            onChange={(news_lead_minutes) => save({ ...cfg, news_lead_minutes })}
          />
        </Row>
        <Row label="高重要度额外预警" hint="非农、CPI 等在常规提醒之外更早再提醒一次">
          <ChoiceGroup
            label="高重要度额外预警"
            options={PREWARN.map((m) => ({ value: m, label: m === 0 ? "关闭" : `${m} 分钟` }))}
            value={cfg.news_prewarn_minutes}
            onChange={(news_prewarn_minutes) => save({ ...cfg, news_prewarn_minutes })}
          />
        </Row>
      </Group>

      <Group title="风险窗口">
        <Row label="启用" hint="高重要度数据前后在今日时间轴上标红，窗口内的提醒会写明“谨慎开新仓”">
          <Switch checked={cfg.risk_enabled} label="启用风险窗口" onChange={(v) => save({ ...cfg, risk_enabled: v })} />
        </Row>
        <Row label="公布前">
          <ChoiceGroup
            label="风险窗口公布前"
            options={RISK_MIN.map((m) => ({ value: m, label: `${m} 分钟` }))}
            value={cfg.risk_before_minutes}
            onChange={(risk_before_minutes) => save({ ...cfg, risk_before_minutes })}
          />
        </Row>
        <Row label="公布后">
          <ChoiceGroup
            label="风险窗口公布后"
            options={RISK_MIN.map((m) => ({ value: m, label: `${m} 分钟` }))}
            value={cfg.risk_after_minutes}
            onChange={(risk_after_minutes) => save({ ...cfg, risk_after_minutes })}
          />
        </Row>
      </Group>

      <div className="mb-2 flex items-center justify-between">
        <span className={`text-[12.5px] ${info?.state.error ? "text-destructive-foreground" : "text-muted-foreground"}`}>
          {msg || status}
        </span>
        <Button disabled={busy} size="xs" variant="outline" onClick={refresh}>
          <RefreshCw className={busy ? "animate-spin" : undefined} />
          {busy ? "更新中…" : "立即更新"}
        </Button>
      </div>

      {byDay.size === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">本周暂无符合条件的数据</p>
      ) : (
        [...byDay].map(([day, list]) => (
          <Group key={day} title={day}>
            {list.map((e) => (
              <div
                key={e.at + e.title}
                className="grid grid-cols-[52px_12px_1fr_auto] items-center gap-2 border-b border-border py-2.5 text-[12.5px] last:border-b-0"
              >
                <span className="num font-semibold">{hmBJ(e.at)}</span>
                <i className={`h-2 w-2 rounded-full ${DOT[e.impact]}`} title={IMPACTS.find((i) => i.id === e.impact)?.label} />
                <span>
                  <span className="mr-1.5 text-muted-foreground">{e.country}</span>
                  {e.title}
                </span>
                <span className="num text-[12px] text-muted-foreground">
                  {e.forecast && `预期 ${e.forecast}`}
                  {e.previous && ` · 前值 ${e.previous}`}
                </span>
              </div>
            ))}
          </Group>
        ))
      )}
      <p className="mt-2 text-[12px] text-muted-foreground">时间为北京时间。数据可能临时改期，以 ForexFactory 网站为准。</p>
    </>
  );
}
