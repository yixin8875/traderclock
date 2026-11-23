import { useEffect, useState } from "react";
import { ChoiceGroup, Group, MultiChoiceGroup, Row, SelectField, Switch, type Option } from "../components/kit";
import { Input } from "../components/ui/input";
import { periodLabel } from "../lib/format";
import type { PageProps } from "../App";

const OPTIONS = [1, 3, 5, 10, 15, 30, 60, 120, 240];
const ALIGN: Option<string>[] = [
  { value: "America/Chicago", label: "芝加哥时间（CME 期货）" },
  { value: "Asia/Shanghai", label: "北京时间" },
];
const LEADS = [0, 10, 30, 60];
const MAX_LEAD = 600;

export default function PeriodsPage({ cfg, save }: PageProps) {
  const togglePeriods = (next: number[]) => save({ ...cfg, periods: [...next].sort((a, b) => a - b) });

  return (
    <>
      <section className="mb-5">
        <p className="mb-2 text-[12.5px] text-muted-foreground">K 线周期，可多选。多个周期同时收盘时只提醒一次。</p>
        <MultiChoiceGroup<number>
          label="K 线周期"
          options={OPTIONS.map((p) => ({ value: p, label: periodLabel(p) }))}
          render={(o) => <span className="num">{o.label}</span>}
          values={cfg.periods.filter((p) => OPTIONS.includes(p))}
          onChange={togglePeriods}
        />
      </section>

      <Group title="对齐方式">
        <Row label="按哪个时区对齐 K 线" hint="影响 2h、4h 的收盘时刻">
          <SelectField
            label="对齐时区"
            options={ALIGN}
            value={cfg.align_tz}
            onChange={(align_tz) => save({ ...cfg, align_tz })}
          />
        </Row>
        <Row label="收盘前提前提醒" hint={`0–${MAX_LEAD} 秒，关键时点也一起提前`}>
          <LeadInput value={cfg.lead_seconds} onChange={(v) => save({ ...cfg, lead_seconds: v })} />
        </Row>
      </Group>

      <Group title="K 线静音时段">
        <Row label="启用" hint="北京时间。这段时间不提醒 K 线收盘，关键时点和财经数据照常提醒">
          <Switch
            checked={cfg.quiet_enabled}
            label="K 线静音时段"
            onChange={(v) => save({ ...cfg, quiet_enabled: v })}
          />
        </Row>
        {cfg.quiet_enabled && (
          <Row label="时间" hint={cfg.quiet_start > cfg.quiet_end ? "跨午夜" : undefined}>
            <div className="flex items-center gap-1.5">
              <TimeInput value={cfg.quiet_start} onChange={(v) => save({ ...cfg, quiet_start: v })} label="开始" />
              <span className="text-muted-foreground">–</span>
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
      <ChoiceGroup
        label="提前秒数常用值"
        options={LEADS.map((s) => ({ value: s, label: s === 0 ? "准点" : `${s}s` }))}
        value={value}
        onChange={onChange}
      />
      <Input
        aria-label="提前秒数"
        className="num ml-1 w-16 text-right"
        max={MAX_LEAD}
        min={0}
        size="sm"
        step={1}
        type="number"
        value={text}
        onBlur={commit}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <span className="text-sm text-muted-foreground">秒</span>
    </div>
  );
}

// 分钟数 <-> "HH:MM"
function TimeInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const hhmm = `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return (
    <Input
      aria-label={label}
      className="num w-max"
      size="sm"
      type="time"
      value={hhmm}
      onChange={(e) => {
        const [h, m] = e.target.value.split(":").map(Number);
        if (Number.isFinite(h) && Number.isFinite(m)) onChange(h * 60 + m);
      }}
    />
  );
}
