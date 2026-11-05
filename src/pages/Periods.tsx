import { useEffect, useState } from "react";
import { Group, PageHead, Row, Switch } from "../components/ui";
import { periodLabel } from "../lib/format";
import type { PageProps } from "../App";

const OPTIONS = [1, 3, 5, 10, 15, 30, 60, 120, 240];
const ALIGN = [
  { tz: "America/Chicago", label: "芝加哥时间（CME 期货）" },
  { tz: "Asia/Shanghai", label: "北京时间" },
];
const LEADS = [0, 10, 30, 60];
const MAX_LEAD = 600;

export default function PeriodsPage({ cfg, save }: PageProps) {
  const toggle = (p: number) => {
    const has = cfg.periods.includes(p);
    save({ ...cfg, periods: has ? cfg.periods.filter((x) => x !== p) : [...cfg.periods, p].sort((a, b) => a - b) });
  };

  return (
    <>
      <PageHead title="周期" />
      <section className="mb-5">
        <h2 className="mb-1.5 text-[12.5px] text-mute">K 线周期，可多选。多个周期同时收盘时只提醒一次。</h2>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((p) => {
            const on = cfg.periods.includes(p);
            return (
              <button
                key={p}
                aria-pressed={on}
                onClick={() => toggle(p)}
                className={`num h-9 min-w-14 rounded-lg px-3 text-sm ${on ? "bg-ink font-semibold text-white" : "bg-soft text-ink hover:bg-hover"}`}
              >
                {periodLabel(p)}
              </button>
            );
          })}
        </div>
      </section>

      <Group title="对齐方式">
        <Row label="按哪个时区对齐 K 线" hint="影响 2h、4h 的收盘时刻">
          <select
            value={cfg.align_tz}
            onChange={(e) => save({ ...cfg, align_tz: e.target.value })}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
          >
            {ALIGN.map((a) => (
              <option key={a.tz} value={a.tz}>{a.label}</option>
            ))}
          </select>
        </Row>
        <Row label="收盘前提前提醒" hint={`0–${MAX_LEAD} 秒，关键时点也一起提前`}>
          <LeadInput value={cfg.lead_seconds} onChange={(v) => save({ ...cfg, lead_seconds: v })} />
        </Row>
      </Group>

      <Group title="K 线静音时段">
        <Row label="启用" hint="北京时间。这段时间不提醒 K 线收盘，关键时点和财经数据照常提醒">
          <Switch checked={cfg.quiet_enabled} label="K 线静音时段" onChange={(v) => save({ ...cfg, quiet_enabled: v })} />
        </Row>
        {cfg.quiet_enabled && (
          <Row label="时间" hint={cfg.quiet_start > cfg.quiet_end ? "跨午夜" : undefined}>
            <div className="flex items-center gap-1.5">
              <TimeInput value={cfg.quiet_start} onChange={(v) => save({ ...cfg, quiet_start: v })} label="开始" />
              <span className="text-mute">–</span>
              <TimeInput value={cfg.quiet_end} onChange={(v) => save({ ...cfg, quiet_end: v })} label="结束" />
            </div>
          </Row>
        )}
      </Group>
    </>
  );
}

// 常用值一键选择，也可以直接输入秒数；回车或离开输入框时保存
function LeadInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.max(0, Math.min(MAX_LEAD, Math.round(Number(text) || 0)));
    setText(String(n));
    if (n !== value) onChange(n);
  };
  return (
    <div className="flex items-center gap-1.5">
      {LEADS.map((s) => (
        <button
          key={s}
          aria-pressed={value === s}
          onClick={() => onChange(s)}
          className={`rounded-md px-2 py-1 text-xs ${value === s ? "bg-ink text-white" : "bg-soft"}`}
        >
          {s === 0 ? "准点" : `${s}s`}
        </button>
      ))}
      <input
        type="number"
        min={0}
        max={MAX_LEAD}
        step={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        aria-label="提前秒数"
        className="num ml-1 w-16 rounded-md border border-line bg-surface px-2 py-1 text-right text-sm"
      />
      <span className="text-sm text-mute">秒</span>
    </div>
  );
}

// 分钟数 <-> "HH:MM"
function TimeInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const hhmm = `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return (
    <input
      type="time"
      value={hhmm}
      aria-label={label}
      onChange={(e) => {
        const [h, m] = e.target.value.split(":").map(Number);
        if (Number.isFinite(h) && Number.isFinite(m)) onChange(h * 60 + m);
      }}
      className="num rounded-md border border-line bg-surface px-2 py-1 text-sm"
    />
  );
}
