import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type Alert, type Band, type Mark, type Status, type Today } from "../lib/api";
import { countdown, hmBJ, hmIn, periodLabel } from "../lib/format";
import { DstBadge, PageHead } from "../components/ui";
import type { PageProps } from "../App";

const DAY = 86_400_000;
const BAND_BG: Record<string, string> = { 亚盘: "bg-asia", 欧盘: "bg-eu", 美盘: "bg-us" };
const SESSION_ROWS = ["亚盘", "欧盘", "美盘"] as const;

// 时间轴尺寸（px）：左侧留名称栏，右侧按层分行，避免文字互相压住
const GUTTER = 48;
const TOP = 20;
const ROW_H = 20;
const BAND_H = 14;
const EXTRA_H = 14;
const MARKS_H = 10;
const AXIS_H = 17;
const LANE_H = 16;
const LANES = 4;

export default function TodayPage({ cfg }: PageProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [upcoming, setUpcoming] = useState<Alert[]>([]);
  const [now, setNow] = useState(Date.now());

  // 数据从 Rust 拉取；配置变化、提醒触发、暂停变化时刷新
  useEffect(() => {
    const load = () => {
      api.getStatus().then(setStatus);
      api.getToday().then(setToday);
      api.getUpcoming(5).then(setUpcoming);
    };
    load();
    const uns = ["alert", "pause-changed", "news-changed", "calendar-changed"].map((e) => listen(e, load));
    const minute = setInterval(load, 60_000);
    return () => {
      clearInterval(minute);
      uns.forEach((u) => void u.then((f) => f()));
    };
  }, [cfg]);

  // 只有窗口打开时才每秒刷新倒计时
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const next = status?.next;
  // 收盘时刻过了就取下一个提醒，不等每分钟的刷新
  useEffect(() => {
    if (next && now >= new Date(next.at).getTime() + 1000) api.getStatus().then(setStatus);
  }, [now, next]);
  const left = next ? new Date(next.at).getTime() - now : 0;
  const hot = !!next && left < 60_000;
  const paused = !!status?.paused_until && new Date(status.paused_until).getTime() > now;
  const chip = statusChip(status, today, now, paused);

  const togglePause = () => (paused ? api.resume() : api.pause(15)).then(() => api.getStatus().then(setStatus));
  const pauseToday = () => api.pauseToday().then(() => api.getStatus().then(setStatus));

  const d = new Date(now);
  const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "short" }).format(d);
  const month = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric" }).format(d);
  const day = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", day: "numeric" }).format(d);

  return (
    <>
      <PageHead
        title="今日"
        sub={`${month} 月 ${day} 日 ${weekday} · 北京时间`}
        aside={today && <DstBadge text={today.dst_note} />}
      />

      <section className="mb-6 grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-x-6">
        <div className={`num text-[60px] font-semibold leading-[0.85] tracking-[-0.02em] ${hot ? "text-amber-ink" : "text-ink"}`}>
          {next ? countdown(left) : "--:--"}
        </div>
        <div className="min-w-0 pb-0.5">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mute">
            {chip && (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.tone}`}>
                <i className="h-1.5 w-1.5 rounded-full bg-current" />
                {chip.label}
              </span>
            )}
            <span>{paused ? `已暂停至 ${hmBJ(status!.paused_until!)}` : "距离下次提醒"}</span>
          </div>
          <p className="truncate text-[16px] font-medium leading-6 text-ink">{next ? describe(next) : "未来 10 天无提醒"}</p>
          <p className="mt-0.5 text-[12px] text-mute">
            {next ? `${next.session} · ` : ""}芝加哥 {hmIn(now, "America/Chicago")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 pb-0.5">
          <button
            type="button"
            onClick={togglePause}
            className={`h-8 rounded-lg px-3 text-[12.5px] ${
              paused ? "bg-amber font-medium text-on-amber hover:opacity-90" : "border border-line text-ink hover:bg-soft"
            }`}
          >
            {paused ? "恢复提醒" : "暂停 15 分钟"}
          </button>
          {!paused && (
            <button type="button" onClick={pauseToday} className="text-[11.5px] text-mute hover:text-ink">
              今天不再提醒
            </button>
          )}
        </div>
      </section>

      {today && <Timeline today={today} now={now} />}

      <div className="mb-1 flex items-baseline justify-between border-b border-line pb-2">
        <h2 className="text-[13px] font-medium text-ink">接下来</h2>
        <span className="text-[11.5px] text-mute">北京时间</span>
      </div>
      {upcoming.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-mute">未来 10 天暂无提醒</p>
      ) : (
        <ul>
          {upcoming.map((a) => {
            const rel = new Date(a.at).getTime() - now;
            const soon = rel < 10 * 60_000;
            return (
              <li key={a.fire_at} className="grid grid-cols-[56px_1fr_auto] items-baseline gap-x-4 border-b border-line py-3 last:border-b-0">
                <span className="flex flex-col leading-tight">
                  <span className="num text-[16px] font-semibold">{hmBJ(a.at)}</span>
                  <span className="mt-0.5 text-[11px] text-mute">{dayLabel(a.at, now)}</span>
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-5">
                  {a.rolls.map((r) => (
                    <span key={r} className="font-medium text-roll-ink">{r}</span>
                  ))}
                  {a.bars.map((b) => (
                    <span key={b} className="text-mute">{periodLabel(b)} 收盘</span>
                  ))}
                  {a.keys.map((k) => (
                    <span key={k} className="font-medium text-amber-ink">{k}</span>
                  ))}
                  {a.news.map((n) => (
                    <span key={n} className="text-danger-ink">{n}</span>
                  ))}
                  {a.risk && (
                    <span className="inline-flex items-center gap-1.5 text-danger-ink">
                      <i className="h-1.5 w-1.5 rounded-full bg-danger-solid" aria-hidden="true" />
                      风险窗口
                    </span>
                  )}
                </span>
                <span className="text-right leading-tight">
                  <span className={`num block text-[12px] ${soon ? "font-medium text-amber-ink" : "text-mute"}`}>{relLabel(rel)}</span>
                  <span className="mt-0.5 block text-[11px] text-mute">{a.session}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** 顶部状态：交易中 / 休市至 HH:MM / 今日休市 / 已暂停 */
function statusChip(status: Status | null, today: Today | null, now: number, paused: boolean) {
  if (paused) return { label: "已暂停", tone: "bg-amber-soft text-amber-ink" };
  if (!status) return null;
  if (today?.day_note) {
    const tone = today.day_note === "未启用品种" ? "bg-amber-soft text-amber-ink" : "bg-soft text-mute";
    return { label: today.day_note, tone };
  }
  if (status.open) return { label: "交易中", tone: "bg-success-soft text-success-ink" };
  if (today) {
    const end = today.closed.find((b) => Date.parse(b.start) <= now && now < Date.parse(b.end))?.end;
    if (end) {
      const dayEnd = Date.parse(today.day_start) + DAY;
      return { label: `休市至 ${Date.parse(end) >= dayEnd - 1000 ? "24:00" : hmBJ(end)}`, tone: "bg-soft text-mute" };
    }
  }
  return { label: "休市", tone: "bg-soft text-mute" };
}

function describe(a: Alert) {
  const bars = a.bars.map(periodLabel).join(" + ");
  const parts = [...a.rolls, ...a.keys];
  if (a.news.length) parts.push(a.news.length > 1 ? `${a.news[0]} 等 ${a.news.length} 条数据` : a.news[0]);
  if (bars) parts.push(`${bars} 收盘`);
  return `${hmBJ(a.at)} ${parts.join(" · ")}`;
}

/** 未来提醒相对现在的时间，列表里比只写时刻更好扫读 */
function relLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "即将";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟后`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 24) return r ? `${h} 小时 ${r} 分后` : `${h} 小时后`;
  return `${Math.floor(h / 24)} 天后`;
}

/** 北京时间日历日：今天 / 明天 / 后天 / 周几 */
function dayLabel(iso: string, now: number): string {
  const day = (t: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  const diff = Math.round((Date.parse(day(new Date(iso).getTime())) - Date.parse(day(now))) / DAY);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === 2) return "后天";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "short" }).format(new Date(iso));
}

/** 大致文字宽度：中文按字号，数字和标点按 0.56 倍，用于给标签分道 */
function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += /[⺀-鿿＀-￯]/.test(ch) ? size : size * 0.56;
  return w;
}

/** 分道摆放时点名称：同一道内绝不叠字，贴近两端时向内收 */
function layoutLabels(marks: Mark[], xOf: (t: string | number | Date) => number, plotW: number) {
  const lanes: { left: number; right: number }[][] = Array.from({ length: LANES }, () => []);
  const sorted = [...marks].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return sorted.map((m) => {
    const width = textWidth(m.name, 11);
    const maxLeft = Math.max(GUTTER, GUTTER + plotW - width);
    let left = Math.min(Math.max(xOf(m.at) - width / 2, GUTTER), maxLeft);
    let lane = lanes.findIndex((boxes) => boxes.every((b) => left > b.right + 12 || left + width + 12 < b.left));
    if (lane < 0) {
      // 所有道都被占满时加一层，宁可轴高一点，也不让文字叠在一起
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane].push({ left, right: left + width });
    return { m, left, lane };
  });
}

/** 窄色带只写开始时间，极窄时省掉文字（悬停可看完整区间） */
function bandLabel(b: Band, width: number, dayStart: number, dayEnd: number): string {
  const s = new Date(b.start).getTime();
  const e = new Date(b.end).getTime();
  const from = s <= dayStart ? "00:00" : hmBJ(b.start);
  const to = e >= dayEnd - 1000 ? "24:00" : hmBJ(b.end);
  if (textWidth(`${from}–${to}`, 10) + 8 <= width) return `${from}–${to}`;
  if (textWidth(from, 10) + 8 <= width) return from;
  return "";
}

/** 北京时间 24 小时时间轴：时段、休市、风险、关键时点各占一层 */
function Timeline({ today, now }: { today: Today; now: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // 标签要按像素避让，所以先量出实际宽度，窗口缩放时跟着重排
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const start = new Date(today.day_start).getTime();
  const dayEnd = start + DAY;
  const plotW = Math.max(120, (width || 640) - GUTTER);
  const xOf = (t: string | number | Date) => GUTTER + ((new Date(t).getTime() - start) / DAY) * plotW;

  const placed = layoutLabels(today.marks.filter((m) => m.major && !m.news), xOf, plotW);
  const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));

  const rowY = [TOP, TOP + ROW_H, TOP + 2 * ROW_H];
  let y = TOP + 3 * ROW_H;
  const closedY = y;
  if (today.closed.length) y += EXTRA_H;
  const riskY = y;
  if (today.risks.length) y += EXTRA_H;
  y += MARKS_H;
  const axisY = y;
  y += AXIS_H;
  const labelsY = y;
  const height = labelsY + lanes * LANE_H;
  const nowX = Math.min(Math.max(xOf(now), GUTTER), GUTTER + plotW);

  return (
    <div ref={ref} className="relative mb-6 mt-1" style={{ height }} role="group" aria-label="今日时间轴（北京时间）">
      {/* 每 3 小时一条参考线，读时间时不用反复对照底轴 */}
      {Array.from({ length: 9 }, (_, i) => i * 3).map((h) => (
        <i key={h} className="absolute w-px bg-line" style={{ left: GUTTER + (h / 24) * plotW, top: TOP, height: axisY - TOP }} />
      ))}

      {SESSION_ROWS.map((name, i) => (
        <span
          key={name}
          className="absolute flex w-11 items-center gap-1.5 text-[11px] text-mute"
          style={{ top: rowY[i] + ROW_H / 2, left: 0, transform: "translateY(-50%)" }}
        >
          <i className={`h-2 w-2 flex-none rounded-[2px] ring-1 ring-inset ring-ink/10 ${BAND_BG[name]}`} />
          {name}
        </span>
      ))}
      {today.closed.length > 0 && (
        <span
          className="absolute flex w-11 items-center gap-1.5 text-[11px] text-mute"
          style={{ top: closedY + EXTRA_H / 2, left: 0, transform: "translateY(-50%)" }}
        >
          <i className="halt-stripes h-2 w-2 flex-none rounded-[2px] ring-1 ring-line" />
          休市
        </span>
      )}
      {today.risks.length > 0 && (
        <span
          className="absolute flex w-11 items-center gap-1.5 text-[11px] text-mute"
          style={{ top: riskY + EXTRA_H / 2, left: 0, transform: "translateY(-50%)" }}
        >
          <i className="h-2 w-2 flex-none rounded-[2px] bg-danger-solid/25 ring-1 ring-danger-solid/50" />
          风险
        </span>
      )}

      {SESSION_ROWS.map((name, i) =>
        today.sessions
          .filter((b) => b.name === name)
          .map((b) => {
            const left = xOf(b.start);
            const w = Math.max(2, xOf(b.end) - left);
            const label = bandLabel(b, w, start, dayEnd);
            return (
              <div
                key={name + b.start}
                title={`${name} ${hmBJ(b.start)}–${hmBJ(b.end)}`}
                className={`absolute overflow-hidden rounded-[3px] ${BAND_BG[name]}`}
                style={{ left, top: rowY[i] + (ROW_H - BAND_H) / 2, width: w, height: BAND_H }}
              >
                {label && <span className="num block px-1.5 text-[10.5px] leading-[14px] text-label-strong">{label}</span>}
              </div>
            );
          }),
      )}

      {today.closed.map((h) => {
        const left = xOf(h.start);
        const w = Math.max(3, xOf(h.end) - left);
        const end = Date.parse(h.end);
        const to = end >= dayEnd - 1000 ? "24:00" : hmBJ(h.end);
        const fullDay = today.day_note && Date.parse(h.start) <= start && end >= dayEnd - 1000;
        return (
          <div
            key={h.start}
            title={`休市 ${hmBJ(h.start)}–${to}`}
            className="halt-stripes absolute overflow-hidden rounded-[3px] text-center text-[10.5px] leading-[14px] text-weekend"
            style={{ left, top: closedY, width: w, height: EXTRA_H }}
          >
            {fullDay && w > 70 ? today.day_note : w > 60 ? "休市" : w > 15 ? "休" : ""}
          </div>
        );
      })}

      {today.risks.map((r) => {
        const left = xOf(r.start);
        const w = Math.max(2, xOf(r.end) - left);
        return (
          <div
            key={r.start}
            title={`风险窗口 ${hmBJ(r.start)}–${hmBJ(r.end)} · ${r.name}`}
            className="absolute rounded-[3px] bg-danger-solid/15 ring-1 ring-inset ring-danger-solid/35"
            style={{ left, top: riskY + 2, width: w, height: EXTRA_H - 4 }}
          />
        );
      })}

      {/* 时点刻度画在轴线上方：重要时点更高更粗，数据发布用红色 */}
      {today.marks.map((m) => {
        const h = m.news ? 10 : m.major ? 8 : 5;
        const w = m.news ? 3 : m.major ? 2 : 1;
        return (
          <i
            key={m.name + m.at}
            title={`${m.name} ${hmBJ(m.at)}`}
            className={`absolute -translate-x-1/2 rounded-sm ${
              m.news ? (m.major ? "bg-news" : "bg-news/55") : m.major ? "bg-ink" : "bg-mark-muted"
            } ${m.enabled ? "" : "opacity-40"}`}
            style={{ left: xOf(m.at), top: axisY - h, width: w, height: h }}
          />
        );
      })}

      <div className="absolute h-px bg-axis" style={{ left: GUTTER, top: axisY, width: plotW }} />
      {Array.from({ length: 9 }, (_, i) => i * 3).map((h, i) => (
        <span
          key={h}
          className="num absolute text-[10.5px] text-label"
          style={{
            left: GUTTER + (h / 24) * plotW,
            top: axisY + 3,
            transform: i === 0 ? undefined : i === 8 ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          {String(h).padStart(2, "0")}
        </span>
      ))}

      {placed.map(({ m, left, lane }) => (
        <span
          key={"l" + m.name + m.at}
          title={`${m.name} ${hmBJ(m.at)}`}
          className={`absolute whitespace-nowrap text-[11px] ${m.enabled ? "text-ink" : "text-mute"}`}
          style={{ left, top: labelsY + lane * LANE_H, lineHeight: `${LANE_H}px` }}
        >
          {m.name}
        </span>
      ))}

      <div className="absolute w-[2px] rounded-full bg-amber" style={{ left: nowX - 1, top: TOP - 2, height: axisY - TOP + 2 }} />
      <i className="absolute h-2 w-2 rounded-full bg-amber" style={{ left: nowX - 4, top: axisY - 4 }} />
      <span
        className="num absolute -translate-x-1/2 rounded-full bg-surface px-2 text-[10.5px] font-semibold leading-4 text-amber-ink ring-1 ring-amber/30"
        style={{ left: Math.min(Math.max(nowX, GUTTER + 24), GUTTER + plotW - 24), top: TOP - 18 }}
      >
        {hmBJ(now)}
      </span>
    </div>
  );
}
