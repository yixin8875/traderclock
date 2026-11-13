import { useCallback, useEffect, useState } from "react";
import { api, type ContractId, type ContractInfo } from "../lib/api";
import { PageHead, Switch } from "../components/ui";
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
        aside={<span className="text-[12px] text-mute">换月前 1 天 / 1 小时提醒</span>}
      />

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger-ink">
          {error}
        </p>
      )}

      {!items ? (
        <p className="text-[13px] text-mute">加载合约…</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const overridden = item.roll_override !== null;
            return (
              <section
                key={item.id}
                data-tick={tick}
                className="rounded-xl border border-line bg-soft px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className={`text-sm font-semibold ${item.enabled ? "" : "text-mute"}`}>{item.name}</span>
                      <span className="num text-[12px] text-mute">
                        {item.current_code} → {item.next_code}
                      </span>
                      {overridden && (
                        <span className="rounded bg-surface px-1.5 text-[11px] leading-4 text-amber-ink">手动</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-mute">
                      <span>
                        换月 <b className="font-medium text-ink">{fmtCT(item.roll_date)}</b>{" "}
                        <span className="num">{hmIn(item.roll_at, "America/Chicago")}</span> 芝加哥
                      </span>
                      <span>
                        到期 <b className="font-medium text-ink">{fmtCT(item.expiry_date)}</b>
                      </span>
                      <span className={overridden ? "text-amber-ink" : ""}>{timeLeft(item.roll_at)}</span>
                    </div>
                  </div>
                  <Switch
                    checked={item.enabled}
                    onChange={(v) => update(item.id, { enabled: v })}
                    label={`${item.name} 换月提醒`}
                  />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-[12px] text-mute">
                  <span>标准 {fmtCT(item.standard_roll_date)}</span>
                  <span className="text-line">·</span>
                  <label htmlFor={`roll-${item.id}`}>手动换月日</label>
                  <input
                    id={`roll-${item.id}`}
                    type="date"
                    value={item.roll_override ?? ""}
                    min={chicagoTodayKey()}
                    max={item.expiry_date}
                    onChange={(e) => update(item.id, { roll_override: e.target.value || null })}
                    className="num h-7 rounded-lg border border-line bg-surface px-2 text-[12px] text-ink"
                  />
                  {overridden && (
                    <button
                      type="button"
                      onClick={() => update(item.id, { roll_override: null })}
                      className="text-[12px] text-amber-ink hover:underline"
                    >
                      恢复标准日期
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-5 text-[12px] leading-5 text-mute">
        提醒会合并到同一时刻的今日页、悬浮条和系统通知里。交易所临时调整换月日时，可在这里手动覆盖。
      </p>
    </>
  );
}
