import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { api, type ContractId, type ContractInfo } from "../lib/api";
import { PageHead, Switch } from "../components/kit";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { hmIn } from "../lib/format";
import type { PageProps } from "../App";

const fmtCT = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  const md = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/Chicago",
    month: "numeric",
    day: "numeric",
  }).format(d);
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/Chicago",
    weekday: "short",
  }).format(d);
  return `${md} ${weekday}`;
};

const chicagoTodayKey = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

function timeLeft(iso: string) {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "已换月";
  const hours = Math.ceil(ms / 3_600_000);
  return hours < 24 ? `${hours} 小时后` : `${Math.ceil(hours / 24)} 天后`;
}

export default function ContractsPage({ cfg, save }: PageProps) {
  const [items, setItems] = useState<ContractInfo[] | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    api
      .getContracts()
      .then((next) => {
        setItems(next);
        setError("");
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load, cfg]);

  // 让“x 小时后”保持更新
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const update = (id: ContractId, patch: { enabled?: boolean; roll_override?: string | null }) => {
    const contracts = cfg.contracts.map((c) => (c.id === id ? { ...c, ...patch } : c));
    void Promise.resolve(save({ ...cfg, contracts })).then(load);
  };

  return (
    <>
      <PageHead
        title="合约换月"
        sub="ES / NQ 按季度换月，GC 和 BTC 按各自合约月规则。手动日期只影响当前合约的换月提醒，不改变合约代码。"
        aside={<span className="text-[12px] text-muted-foreground">换月前 1 天 / 1 小时提醒</span>}
      />

      {error && (
        <Alert className="mb-3 py-2" variant="error">
          <AlertDescription className="text-[12px] text-destructive-foreground">{error}</AlertDescription>
        </Alert>
      )}

      {!items ? (
        <p className="text-[13px] text-muted-foreground">加载合约…</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const overridden = item.roll_override !== null;
            return (
              <section key={item.id} className="rounded-xl border border-border bg-card px-4 py-3 shadow-xs/5" data-tick={tick}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className={`text-sm font-semibold ${item.enabled ? "" : "text-muted-foreground"}`}>
                        {item.name}
                      </span>
                      <span className="num text-[12px] text-muted-foreground">
                        {item.current_code} → {item.next_code}
                      </span>
                      {overridden && (
                        <span className="rounded bg-muted px-1.5 text-[11px] leading-4 text-warning-foreground">手动</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                      <span>
                        换月 <b className="font-medium text-foreground">{fmtCT(item.roll_date)}</b>{" "}
                        <span className="num">{hmIn(item.roll_at, "America/Chicago")}</span> 芝加哥
                      </span>
                      <span>
                        到期 <b className="font-medium text-foreground">{fmtCT(item.expiry_date)}</b>
                      </span>
                      <span className={overridden ? "text-warning-foreground" : ""}>{timeLeft(item.roll_at)}</span>
                    </div>
                  </div>
                  <Switch
                    checked={item.enabled}
                    onChange={(v) => update(item.id, { enabled: v })}
                    label={`${item.name} 换月提醒`}
                  />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-[12px] text-muted-foreground">
                  <span>标准 {fmtCT(item.standard_roll_date)}</span>
                  <span className="text-border">·</span>
                  <label htmlFor={`roll-${item.id}`}>手动换月日</label>
                  <Input
                    className="num h-7 w-max"
                    id={`roll-${item.id}`}
                    max={item.expiry_date}
                    min={chicagoTodayKey()}
                    size="sm"
                    type="date"
                    value={item.roll_override ?? ""}
                    onChange={(e) => update(item.id, { roll_override: e.target.value || null })}
                  />
                  {overridden && (
                    <Button
                      className="h-auto p-0 text-warning-foreground"
                      size="xs"
                      variant="link"
                      onClick={() => update(item.id, { roll_override: null })}
                    >
                      <RotateCcw />
                      恢复标准日期
                    </Button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-5 text-[12px] leading-5 text-muted-foreground">
        提醒会合并到同一时刻的今日页、悬浮条和系统通知里。交易所临时调整换月日时，可在这里手动覆盖。
      </p>
    </>
  );
}
