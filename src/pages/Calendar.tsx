import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  type CalGroup,
  type CalKind,
  type CalendarInfo,
  type ContractEvent,
  type ContractInfo,
  type NewsEvent,
} from "../lib/api";
import { hmIn } from "../lib/format";

const GROUP: CalGroup = "cme";
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

type TzKey = "America/Chicago" | "America/New_York" | "Asia/Shanghai";

const TIMEZONES: { id: TzKey; label: string }[] = [
  { id: "America/Chicago", label: "芝加哥" },
  { id: "America/New_York", label: "纽约" },
  { id: "Asia/Shanghai", label: "北京" },
];

const KIND_LABEL: Record<CalKind, string> = {
  closed: "全天休市",
  early_close: "提前收盘",
  normal: "照常交易",
};

const ACTION_STYLE = {
  closed:
    "rounded-md bg-danger-soft px-2.5 py-1 text-[11.5px] font-medium text-danger-ink hover:bg-danger-hover disabled:opacity-50",
  early:
    "rounded-md bg-amber-soft px-2.5 py-1 text-[11.5px] font-medium text-amber-ink hover:bg-amber-hover disabled:opacity-50",
  normal:
    "rounded-md bg-success-soft px-2.5 py-1 text-[11.5px] font-medium text-success-ink hover:bg-success-hover disabled:opacity-50",
} as const;

type Filters = {
  holidays: boolean;
  rolls: boolean;
  news: boolean;
  highOnly: boolean;
};

type Layout = "month" | "agenda";
type ExportRange = "month" | "3m";

type CalendarPrefs = {
  tz: TzKey;
  filters: Filters;
  layout: Layout;
  exportRange: ExportRange;
};

type CalCell = { key: string; day: number; inMonth: boolean };

const CAL_PREFS_KEY = "tradeclock.calendar";
const DEFAULT_CAL_PREFS: CalendarPrefs = {
  tz: "America/Chicago",
  filters: { holidays: true, rolls: true, news: true, highOnly: false },
  layout: "month",
  exportRange: "month",
};

function loadCalendarPrefs(): CalendarPrefs {
  try {
    const raw = localStorage.getItem(CAL_PREFS_KEY);
    if (!raw) return DEFAULT_CAL_PREFS;
    const saved = JSON.parse(raw) as Partial<CalendarPrefs>;
    const tz = TIMEZONES.some((t) => t.id === saved.tz) ? (saved.tz as TzKey) : DEFAULT_CAL_PREFS.tz;
    const f = saved.filters ?? DEFAULT_CAL_PREFS.filters;
    return {
      tz,
      layout: saved.layout === "agenda" ? "agenda" : "month",
      exportRange: saved.exportRange === "3m" ? "3m" : "month",
      filters: {
        holidays: f.holidays !== false,
        rolls: f.rolls !== false,
        news: f.news !== false,
        highOnly: f.highOnly === true,
      },
    };
  } catch {
    return DEFAULT_CAL_PREFS;
  }
}

function saveCalendarPrefs(prefs: CalendarPrefs) {
  try {
    localStorage.setItem(CAL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 隐私模式或存储已满时不影响日历本身
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 芝加哥时间的今天。日历按 CME 交易日显示，所以“今天”也取交易所日期。 */
function ctToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  return { year, month, day, key: `${year}-${pad2(month)}-${pad2(day)}` };
}

/** ISO 时刻在芝加哥的日期键，财经事件按交易所日期落到日历格。 */
function ctKeyOf(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

const monthKeyOf = (year: number, month: number) => `${year}-${pad2(month)}`;

function parseKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

/** 以周一为第一列计算月份偏移。 */
function mondayOffset(year: number, month: number) {
  return (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
}

function weekdayLabel(key: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(key + "T00:00:00Z"));
}

function nextMonth(year: number, month: number, delta: number) {
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  return { year: y, month: total - y * 12 + 1 };
}

/**
 * 把“某时区的日期 + HH:MM”换成 UTC 毫秒。
 * 用于把日历规则里的芝加哥提前收盘时间显示成纽约/北京时间。
 */
function zonedToUtc(dateKey: string, hhmm: string, timeZone: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const observed = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return guess + (guess - observed);
}

function zonedKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** 目标时区的时刻；跨过交易所日期时标出“次日/前日”，避免把 03:00 误读成当天。 */
function clockInZone(iso: string, tz: string, baseKey: string): string {
  const key = zonedKey(iso, tz);
  const hm = hmIn(iso, tz);
  if (key === baseKey) return hm;
  return `${key > baseKey ? "次日" : "前日"} ${hm}`;
}

function timeInZone(dateKey: string, hhmm: string, from: string, to: string): string {
  return clockInZone(new Date(zonedToUtc(dateKey, hhmm, from)).toISOString(), to, dateKey);
}

function describe(kind: CalKind, date: string, time: string | null, tz: TzKey): string {
  if (kind === "early_close") {
    return `提前收盘${time ? ` ${timeInZone(date, time, "America/Chicago", tz)}` : ""}`;
  }
  return KIND_LABEL[kind];
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

const icsDate = (key: string) => key.replace(/-/g, "");

function icsNextDay(key: string): string {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function icsStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function FilterChip(props: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 transition-colors ${
        props.active
          ? "border-line bg-surface text-ink shadow-sm"
          : "border-transparent text-mute opacity-60 hover:opacity-100"
      }`}
    >
      {props.children}
      {props.label}
    </button>
  );
}

export default function CalendarPage() {
  const [today] = useState(ctToday);
  const [initial] = useState(loadCalendarPrefs);
  const [view, setView] = useState(() => ({ year: today.year, month: today.month }));
  const [selected, setSelected] = useState(today.key);
  const [info, setInfo] = useState<CalendarInfo | null>(null);
  const [infoMonth, setInfoMonth] = useState("");
  const [contracts, setContracts] = useState<ContractInfo[]>([]);
  const [news, setNews] = useState<NewsEvent[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [earlyOpen, setEarlyOpen] = useState(false);
  const [time, setTime] = useState("12:00");
  const [tz, setTz] = useState<TzKey>(initial.tz);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [layout, setLayout] = useState<Layout>(initial.layout);
  const [exportRange, setExportRange] = useState<ExportRange>(initial.exportRange);
  const [exporting, setExporting] = useState(false);
  const [hover, setHover] = useState<{ key: string; rect: DOMRect } | null>(null);
  const [exportMsg, setExportMsg] = useState("");

  // 时区、筛选、视图和导出范围都是每天会调的选项，切页面或重启后保持
  useEffect(() => {
    saveCalendarPrefs({ tz, filters, layout, exportRange });
  }, [tz, filters, layout, exportRange]);

  const monthKey = monthKeyOf(view.year, view.month);
  const tzLabel = TIMEZONES.find((t) => t.id === tz)!.label;

  const load = useCallback(() => {
    api
      .getCalendar(monthKey)
      .then((next) => {
        setInfo(next);
        setInfoMonth(monthKey);
        setError("");
      })
      .catch((e) => setError(String(e)));
  }, [monthKey]);

  const loadEvents = useCallback(() => {
    Promise.all([api.getContracts(), api.getNews()])
      .then(([nextContracts, nextNews]) => {
        setContracts(nextContracts);
        setNews(nextNews.events);
      })
      .catch(() => {
        // 财经数据或合约失败不影响休市日历本身
      });
  }, []);

  useEffect(() => {
    load();
    loadEvents();
    const un = listen("calendar-changed", () => {
      load();
      loadEvents();
    });
    const unNews = listen("news-changed", loadEvents);
    const unConfig = listen("config-changed", loadEvents);
    return () => {
      void un.then((f) => f());
      void unNews.then((f) => f());
      void unConfig.then((f) => f());
    };
  }, [load, loadEvents]);

  // 加载完成前不拿上个月的条目去渲染新月份
  const data = infoMonth === monthKey ? info : null;

  const entryMap = useMemo(() => new Map((data?.entries ?? []).map((e) => [e.date, e])), [data]);
  const overrideMap = useMemo(() => new Map((data?.overrides ?? []).map((o) => [o.date, o])), [data]);

  const newsByDate = useMemo(() => {
    const map = new Map<string, NewsEvent[]>();
    for (const e of news) {
      const key = ctKeyOf(e.at);
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return map;
  }, [news]);

  const rollByDate = useMemo(() => {
    const map = new Map<string, ContractEvent[]>();
    for (const c of contracts) {
      if (!c.enabled) continue;
      for (const e of c.events) {
        map.set(e.date, [...(map.get(e.date) ?? []), e]);
      }
    }
    return map;
  }, [contracts]);

  const newsFor = (key: string) =>
    (newsByDate.get(key) ?? []).filter(
      (e) => filters.news && (!filters.highOnly || e.impact === "high"),
    );

  const rollsFor = (key: string) => (filters.rolls ? rollByDate.get(key) ?? [] : []);

  const selectedEntry = entryMap.get(selected);
  const selectedOverride = overrideMap.get(selected);
  const selectedNews = newsFor(selected);
  const selectedRolls = rollsFor(selected);
  const selectedParts = parseKey(selected);

  const statusText = selectedOverride
    ? `我的覆盖：${describe(selectedOverride.kind, selected, selectedOverride.time, tz)}${
        selectedEntry
          ? `；规则为${describe(selectedEntry.kind, selected, selectedEntry.time, tz)}`
          : ""
      }`
    : selectedEntry
      ? `规则：${describe(selectedEntry.kind, selected, selectedEntry.time, tz)}`
      : "无休市安排";

  const counts = useMemo(() => {
    const finalKind = new Map<string, CalKind>();
    for (const e of data?.entries ?? []) finalKind.set(e.date, e.kind);
    for (const o of data?.overrides ?? []) finalKind.set(o.date, o.kind);
    let closed = 0;
    let early = 0;
    for (const kind of finalKind.values()) {
      if (kind === "closed") closed += 1;
      else if (kind === "early_close") early += 1;
    }
    return { closed, early };
  }, [data]);

  const summary = !data
    ? "加载中…"
    : counts.closed === 0 && counts.early === 0
      ? "本月无休市安排"
      : `${counts.closed ? `${counts.closed} 天休市` : ""}${
          counts.closed && counts.early ? " · " : ""
        }${counts.early ? `${counts.early} 天提前收盘` : ""}`;

  const cells = useMemo<CalCell[]>(() => {
    const offset = mondayOffset(view.year, view.month);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(Date.UTC(view.year, view.month - 1, 1 - offset + i));
      return {
        key: d.toISOString().slice(0, 10),
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === view.month - 1,
      };
    });
  }, [view]);

  // 议程按周分组，只保留本月日期；小窗口下比 6×7 格子更好读
  const agendaWeeks = useMemo(() => {
    const out: { start: string; end: string; days: CalCell[] }[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      const week = cells.slice(i, i + 7);
      const days = week.filter((c) => c.inMonth);
      if (days.length) out.push({ start: week[0].key, end: week[6].key, days });
    }
    return out;
  }, [cells]);

  const stateFor = (key: string) => {
    const override = overrideMap.get(key);
    const entry = entryMap.get(key);
    const kind = override?.kind ?? entry?.kind;
    const time = override?.time ?? entry?.time ?? null;
    return { kind, time, override: !!override };
  };

  // 选中已有提前收盘时，把它的时间带回输入框
  useEffect(() => {
    const t =
      selectedOverride?.kind === "early_close"
        ? selectedOverride.time
        : selectedEntry?.kind === "early_close"
          ? selectedEntry.time
          : null;
    setTime(t ?? "12:00");
    setEarlyOpen(false);
  }, [selected, selectedEntry, selectedOverride]);

  const goMonth = (delta: number) => {
    const next = nextMonth(view.year, view.month, delta);
    const isTodayMonth = next.year === today.year && next.month === today.month;
    setView(next);
    setSelected(isTodayMonth ? today.key : `${monthKeyOf(next.year, next.month)}-01`);
  };

  const goToday = () => {
    setView({ year: today.year, month: today.month });
    setSelected(today.key);
  };

  const selectCell = (key: string) => {
    const p = parseKey(key);
    if (p.year !== view.year || p.month !== view.month) {
      setView({ year: p.year, month: p.month });
    }
    setSelected(key);
  };

  const openEarly = () => {
    const t =
      selectedOverride?.kind === "early_close"
        ? selectedOverride.time
        : selectedEntry?.kind === "early_close"
          ? selectedEntry.time
          : null;
    setTime(t ?? "12:00");
    setEarlyOpen(true);
  };

  const apply = (kind: CalKind) => {
    if (kind === "early_close" && !time) {
      setError("请选择提前收盘时间");
      return;
    }
    setSaving(true);
    setError("");
    api
      .addCalendarOverride(GROUP, selected, kind, kind === "early_close" ? time : null)
      .then((next) => {
        setInfo(next);
        setInfoMonth(selected.slice(0, 7));
        setEarlyOpen(false);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setSaving(false));
  };

  const remove = () => {
    setSaving(true);
    setError("");
    api
      .removeCalendarOverride(GROUP, selected)
      .then((next) => {
        setInfo(next);
        setInfoMonth(selected.slice(0, 7));
        setEarlyOpen(false);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setSaving(false));
  };

  const toggleFilter = (key: keyof Filters) => {
    setFilters((f) => ({ ...f, [key]: !f[key] }));
  };

  const exportIcs = async () => {
    setExporting(true);
    setError("");
    setExportMsg("");
    try {
      const count = exportRange === "3m" ? 3 : 1;
      const months = Array.from({ length: count }, (_, i) => nextMonth(view.year, view.month, i));
      const monthKeys = months.map((m) => monthKeyOf(m.year, m.month));
      const keySet = new Set(monthKeys);
      const infos = await Promise.all(monthKeys.map((m) => api.getCalendar(m)));

      const lines: string[] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//TradeClock//CME Calendar//CN",
        "CALSCALE:GREGORIAN",
        `X-WR-CALNAME:${icsEscape(
          count === 3 ? `TradeClock CME ${monthKey} 起 3 个月` : `TradeClock CME ${monthKey}`,
        )}`,
        "X-WR-TIMEZONE:America/Chicago",
      ];
      const stamp = icsStamp();

      // 休市/提前收盘：覆盖优先于内置规则；照常日不导出，避免把整月塞满
      const final = new Map<string, { kind: CalKind; time: string | null }>();
      for (const info of infos) {
        for (const e of info.entries) final.set(e.date, { kind: e.kind, time: e.time });
        for (const o of info.overrides) final.set(o.date, { kind: o.kind, time: o.time });
      }
      for (const [date, e] of final) {
        if (!keySet.has(date.slice(0, 7)) || e.kind === "normal") continue;
        const summary = `CME ${KIND_LABEL[e.kind]}${e.kind === "early_close" && e.time ? ` ${e.time}` : ""}`;
        const desc =
          e.kind === "early_close" && e.time ? `提前收盘 ${e.time} 芝加哥时间` : KIND_LABEL[e.kind];
        lines.push(
          "BEGIN:VEVENT",
          `UID:tradeclock-holiday-${date}@tradeclock`,
          `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${icsDate(date)}`,
          `DTEND;VALUE=DATE:${icsNextDay(date)}`,
          `SUMMARY:${icsEscape(summary)}`,
          `DESCRIPTION:${icsEscape(desc)}`,
          "END:VEVENT",
        );
      }

      if (filters.rolls) {
        for (const c of contracts) {
          if (!c.enabled) continue;
          for (const e of c.events) {
            if (!keySet.has(e.date.slice(0, 7))) continue;
            const kind = e.kind === "roll" ? "换月" : "到期";
            lines.push(
              "BEGIN:VEVENT",
              `UID:tradeclock-${e.kind}-${e.code}-${e.date}@tradeclock`,
              `DTSTAMP:${stamp}`,
              `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
              `DTEND;VALUE=DATE:${icsNextDay(e.date)}`,
              `SUMMARY:${icsEscape(`${e.code} ${kind}`)}`,
              `DESCRIPTION:${icsEscape(`${e.label} · CME`)}`,
              "END:VEVENT",
            );
          }
        }
      }

      if (filters.news) {
        news.forEach((e, i) => {
          const key = ctKeyOf(e.at);
          if (!keySet.has(key.slice(0, 7))) return;
          if (filters.highOnly && e.impact !== "high") return;
          const end = new Date(new Date(e.at).getTime() + 30 * 60_000).toISOString();
          const summary = `${e.impact === "high" ? "[高] " : ""}${e.country} ${e.title}`;
          const desc = [e.forecast && `预期 ${e.forecast}`, e.previous && `前值 ${e.previous}`]
            .filter(Boolean)
            .join(" · ");
          lines.push(
            "BEGIN:VEVENT",
            `UID:tradeclock-news-${icsUtc(e.at)}-${i}@tradeclock`,
            `DTSTAMP:${stamp}`,
            `DTSTART:${icsUtc(e.at)}`,
            `DTEND:${icsUtc(end)}`,
            `SUMMARY:${icsEscape(summary)}`,
            `DESCRIPTION:${icsEscape(desc)}`,
            "END:VEVENT",
          );
        });
      }

      lines.push("END:VCALENDAR");
      const text = lines.join("\r\n");
      const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = count === 3 ? `TradeClock-CME-${monthKey}-3m.ics` : `TradeClock-CME-${monthKey}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMsg(count === 3 ? "已生成未来 3 个月 .ics" : "已生成 .ics");
    } catch (e) {
      setError(`导出失败：${e}`);
    } finally {
      setExporting(false);
      window.setTimeout(() => setExportMsg(""), 3000);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h1 className="text-[22px] font-semibold leading-8 tracking-tight">
              <span className="num">{view.year}</span> 年 <span className="num">{view.month}</span> 月
            </h1>
            <span className="text-[11px] text-mute">CME · 交易日按芝加哥</span>
          </div>
          <p className="text-[12px] text-mute">
            {summary} · 数据 {data?.version || "规则"} · 时间按{tzLabel}
          </p>
        </div>
        <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">
          <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="日历视图">
            {([
              ["month", "月"],
              ["agenda", "议程"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={layout === id}
                onClick={() => setLayout(id)}
                className={`rounded-md px-2 py-0.5 text-[11.5px] ${
                  layout === id ? "bg-soft font-semibold text-ink shadow-sm" : "text-mute hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={tz}
            onChange={(e) => setTz(e.target.value as TzKey)}
            aria-label="时间显示时区"
            className="h-8 rounded-lg border border-line bg-surface px-2 text-[12px] text-mute"
          >
            {TIMEZONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => goMonth(-1)}
            aria-label="上个月"
            className="h-8 w-8 rounded-lg border border-line bg-surface text-lg leading-none text-mute hover:bg-soft hover:text-ink"
          >
            ‹
          </button>
          <button
            onClick={goToday}
            className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[12px] text-mute hover:bg-soft hover:text-ink"
          >
            今天
          </button>
          <button
            onClick={() => goMonth(1)}
            aria-label="下个月"
            className="h-8 w-8 rounded-lg border border-line bg-surface text-lg leading-none text-mute hover:bg-soft hover:text-ink"
          >
            ›
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-2 rounded-lg bg-amber-soft px-3 py-1.5 text-[12px] text-amber-ink">
          {error}
        </p>
      )}

      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-mute">
        <FilterChip active={filters.holidays} onClick={() => toggleFilter("holidays")} label="休市">
          <i className="h-2 w-2 rounded-[2px] bg-halt-ink" />
        </FilterChip>
        <FilterChip active={filters.rolls} onClick={() => toggleFilter("rolls")} label="换月/到期">
          <i className="h-2 w-2 rotate-45 rounded-[1px] bg-roll" />
        </FilterChip>
        <FilterChip active={filters.news} onClick={() => toggleFilter("news")} label="财经">
          <i className="h-2 w-2 rounded-full bg-news" />
        </FilterChip>
        <FilterChip active={filters.highOnly} onClick={() => toggleFilter("highOnly")} label="只看高影响">
          <i className="h-2 w-2 rounded-full bg-news ring-2 ring-news/30" />
        </FilterChip>
        <span className="ml-auto flex items-center gap-1.5">
          {exportMsg && <span className="text-success-ink">{exportMsg}</span>}
          <select
            value={exportRange}
            onChange={(e) => setExportRange(e.target.value as ExportRange)}
            aria-label="ICS 导出范围"
            className="h-6 rounded-md border border-line bg-surface px-1.5 text-[11px] text-mute"
          >
            <option value="month">本月</option>
            <option value="3m">未来 3 个月</option>
          </select>
          <button
            type="button"
            onClick={() => void exportIcs()}
            disabled={exporting}
            className="h-6 rounded-md border border-line bg-surface px-2 text-[11px] text-mute hover:bg-soft hover:text-ink disabled:opacity-50"
          >
            {exporting ? "导出中…" : "导出 .ics"}
          </button>
        </span>
      </div>

      {layout === "month" ? (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(20,30,45,.04)]">
        <div className="grid grid-cols-7 border-b border-line bg-soft/60 text-center text-[11px] font-medium text-mute">
          {WEEKDAYS.map((w, i) => (
            <span key={w} className={`py-1.5 ${i >= 5 ? "text-weekend" : ""}`}>
              {w}
            </span>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px bg-line/70 p-px">
          {cells.map((cell) => {
            const state = stateFor(cell.key);
            const isToday = cell.key === today.key;
            const isSelected = cell.key === selected;
            const dayNews = newsFor(cell.key);
            const dayRolls = rollsFor(cell.key);
            const highNews = dayNews.some((e) => e.impact === "high");
            const showState = filters.holidays && state.kind && (state.kind !== "normal" || state.override);
            const status = state.kind ? describe(state.kind, cell.key, state.time, tz) : "无休市安排";
            const eventsTitle = [
              ...dayRolls.map((e) => `${e.label} ${e.code}`),
              ...dayNews.map((e) => `${clockInZone(e.at, tz, cell.key)} ${e.country} ${e.title}`),
            ].join(" · ");
            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => selectCell(cell.key)}
                onMouseEnter={(e) => {
                  if (cell.inMonth && (state.kind || dayRolls.length || dayNews.length)) {
                    setHover({ key: cell.key, rect: e.currentTarget.getBoundingClientRect() });
                  }
                }}
                onMouseLeave={() => setHover(null)}
                aria-pressed={isSelected}
                aria-label={`${cell.key} ${status}${eventsTitle ? ` ${eventsTitle}` : ""}`}
                className={`relative flex min-h-0 flex-col items-stretch px-1 pb-1 pt-1 text-left transition-colors ${
                  cell.inMonth ? "bg-surface" : "bg-surface-alt text-mute"
                } ${isSelected ? "z-10 bg-selected ring-1 ring-inset ring-amber/70" : "hover:bg-soft"}`}
              >
                <span className="flex items-center justify-between">
                  <span
                    className={`num flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11.5px] ${
                      isToday ? "bg-amber font-semibold text-white" : cell.inMonth ? "font-medium" : ""
                    }`}
                  >
                    {cell.day}
                  </span>
                  {state.override && <span className="h-1.5 w-1.5 flex-none rounded-full bg-ink/35" title="我的覆盖" />}
                </span>
                {cell.inMonth && (showState || dayRolls.length > 0 || dayNews.length > 0) && (
                  <span className="mt-auto flex min-w-0 items-center gap-1">
                    {showState && (
                      <i
                        className={`h-1.5 w-1.5 flex-none rounded-[2px] ${
                          state.kind === "closed"
                            ? "bg-halt-ink"
                            : state.kind === "early_close"
                              ? "bg-amber"
                              : "bg-success"
                        }`}
                      />
                    )}
                    {dayRolls.length > 0 && (
                      <span className="flex items-center gap-0.5 text-roll-ink" title={dayRolls.map((e) => `${e.label} ${e.code}`).join("\n")}>
                        <i className="h-1.5 w-1.5 flex-none rotate-45 rounded-[1px] bg-roll" />
                        {dayRolls.length > 1 && <span className="num text-[9px] leading-none">{dayRolls.length}</span>}
                      </span>
                    )}
                    {dayNews.length > 0 && (
                      <span
                        className={`flex items-center gap-0.5 ${highNews ? "text-news-ink" : "text-mute"}`}
                        title={dayNews.map((e) => `${clockInZone(e.at, tz, cell.key)} ${e.country} ${e.title}`).join("\n")}
                      >
                        <i className={`h-1.5 w-1.5 flex-none rounded-full ${highNews ? "bg-news" : "bg-mute/60"}`} />
                        <span className="num text-[9px] leading-none">{dayNews.length}</span>
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface">
          {agendaWeeks.map((week) => {
            const start = parseKey(week.start);
            const end = parseKey(week.end);
            return (
              <div key={week.start}>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-soft/95 px-3 py-1.5 text-[10.5px] font-medium text-mute backdrop-blur">
                  <span className="num">
                    {start.month}/{start.day} – {end.month}/{end.day}
                  </span>
                  <span>本周</span>
                </div>
                {week.days.map((day) => {
                  const state = stateFor(day.key);
                  const dayNews = newsFor(day.key);
                  const dayRolls = rollsFor(day.key);
                  const isToday = day.key === today.key;
                  const isSelected = day.key === selected;
                  const firstRoll = dayRolls[0];
                  const firstNews = dayNews[0];
                  const detail = firstRoll
                    ? `${firstRoll.label} ${firstRoll.code} ${firstRoll.kind === "roll" ? "换月" : "到期"}`
                    : firstNews
                      ? `${clockInZone(firstNews.at, tz, day.key)} ${firstNews.country} ${firstNews.title}`
                      : "";
                  return (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => selectCell(day.key)}
                      aria-pressed={isSelected}
                      className={`flex w-full items-start gap-2 border-b border-line/70 px-3 py-2 text-left last:border-b-0 ${
                        isSelected ? "bg-selected" : "hover:bg-soft"
                      }`}
                    >
                      <span
                        className={`num flex h-6 w-8 shrink-0 items-center justify-center rounded-full text-[12.5px] ${
                          isToday ? "bg-amber font-semibold text-white" : "font-medium"
                        }`}
                      >
                        {day.day}
                      </span>
                      <span className="w-7 shrink-0 pt-1 text-[10.5px] text-mute">{weekdayLabel(day.key)}</span>
                      <span className="min-w-0 flex-1 pt-0.5">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {filters.holidays && state.kind && (
                            <span
                              className={`inline-flex items-center gap-1 text-[11.5px] ${
                                state.kind === "closed"
                                  ? "text-danger-ink"
                                  : state.kind === "early_close"
                                    ? "text-amber-ink"
                                    : "text-success-ink"
                              }`}
                            >
                              <i
                                className={`h-1.5 w-1.5 rounded-[2px] ${
                                  state.kind === "closed"
                                    ? "bg-halt-ink"
                                    : state.kind === "early_close"
                                      ? "bg-amber"
                                      : "bg-success"
                                }`}
                              />
                              {describe(state.kind, day.key, state.time, tz)}
                            </span>
                          )}
                          {dayRolls.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-roll-ink">
                              <i className="h-1.5 w-1.5 rotate-45 rounded-[1px] bg-roll" />
                              换月/到期 {dayRolls.length}
                            </span>
                          )}
                          {dayNews.length > 0 && (
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] ${
                                dayNews.some((e) => e.impact === "high") ? "text-danger-ink" : "text-mute"
                              }`}
                            >
                              <i className="h-1.5 w-1.5 rounded-full bg-news" />
                              财经 {dayNews.length}
                            </span>
                          )}
                        </span>
                        {detail && (
                          <span className="mt-0.5 block truncate text-[11px] text-mute" title={detail}>
                            {detail}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <section className="mt-2.5 rounded-xl border border-line bg-soft/70 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="num text-[14px] font-semibold">
                {selectedParts.month} 月 {selectedParts.day} 日
              </span>
              <span className="text-[12px] text-mute">{weekdayLabel(selected)}</span>
              {selected === today.key && (
                <span className="rounded bg-amber-soft px-1.5 py-px text-[10px] font-medium text-amber-ink">今天</span>
              )}
              {selectedRolls.length > 0 && (
                <span className="rounded bg-roll-soft px-1.5 py-px text-[10px] font-medium text-roll-ink">
                  换月 {selectedRolls.length}
                </span>
              )}
              {selectedNews.length > 0 && (
                <span className="rounded bg-danger-soft px-1.5 py-px text-[10px] font-medium text-danger-ink">
                  财经 {selectedNews.length}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-mute" title={statusText}>
              {statusText}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button onClick={() => apply("closed")} disabled={saving} className={ACTION_STYLE.closed}>
              全天休市
            </button>
            <button onClick={openEarly} disabled={saving} className={ACTION_STYLE.early}>
              提前收盘
            </button>
            <button onClick={() => apply("normal")} disabled={saving} className={ACTION_STYLE.normal}>
              照常交易
            </button>
            {selectedOverride && (
              <button
                onClick={remove}
                disabled={saving}
                className="px-1 text-[11.5px] text-mute hover:text-danger-ink disabled:opacity-50"
              >
                清除
              </button>
            )}
          </div>
        </div>

        {(selectedRolls.length > 0 || selectedNews.length > 0) && (
          <ul className="mt-1.5 max-h-[78px] space-y-0.5 overflow-auto border-t border-line pt-1.5 text-[11.5px]">
            {selectedRolls.map((e) => (
              <li key={`${e.kind}-${e.code}-${e.date}`} className="flex items-center gap-2">
                <span className="w-9 shrink-0 text-[10px] text-mute">{e.kind === "roll" ? "换月" : "到期"}</span>
                <span className="rounded bg-roll-soft px-1.5 py-px text-roll-ink" title={`${e.label} ${e.code}`}>
                  {e.label} · {e.code}
                </span>
              </li>
            ))}
            {selectedNews.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex items-start gap-2">
                <span className="num w-9 shrink-0 pt-px text-[10px] text-mute">
                  {clockInZone(e.at, tz, selected)}
                </span>
                <span className={e.impact === "high" ? "font-medium text-danger-ink" : "text-mute"}>
                  {e.country} {e.title}
                </span>
                {e.impact === "high" && (
                  <span className="rounded bg-danger-soft px-1 text-[9px] leading-4 text-danger-ink">高</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {earlyOpen && (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-[12px]">
            <span className="text-mute">芝加哥时间</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="提前收盘时间"
              className="num rounded-md border border-line bg-surface px-2 py-1 text-sm"
            />
            <button
              onClick={() => apply("early_close")}
              disabled={saving}
              className="rounded-md bg-ink px-2.5 py-1 text-[11.5px] font-medium text-white disabled:opacity-50"
            >
              保存
            </button>
            <button onClick={() => setEarlyOpen(false)} className="text-[11.5px] text-mute hover:text-ink">
              取消
            </button>
          </div>
        )}
      </section>

      {hover && (() => {
        const state = stateFor(hover.key);
        const p = parseKey(hover.key);
        const dayRolls = rollsFor(hover.key);
        const items = newsFor(hover.key);
        const w = 270;
        const h = 190;
        const left = Math.min(Math.max(8, hover.rect.left), window.innerWidth - w - 8);
        const top =
          hover.rect.bottom + h + 8 > window.innerHeight
            ? Math.max(8, hover.rect.top - h - 6)
            : hover.rect.bottom + 6;
        return (
          <div
            role="tooltip"
            className="pointer-events-none fixed z-50 rounded-xl border border-line bg-surface p-2.5 text-[11.5px] shadow-xl"
            style={{ left, top, width: w }}
          >
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <b className="num text-[12.5px]">
                {p.month} 月 {p.day} 日
              </b>
              <span className="text-[10.5px] text-mute">{weekdayLabel(hover.key)}</span>
            </div>
            <p
              className={`text-[11px] ${
                state.kind === "closed"
                  ? "text-danger-ink"
                  : state.kind === "early_close"
                    ? "text-amber-ink"
                    : "text-mute"
              }`}
            >
              {state.kind ? describe(state.kind, hover.key, state.time, tz) : "无休市安排"}
            </p>
            {dayRolls.map((e) => (
              <p key={`${e.kind}-${e.code}`} className="mt-1 text-roll-ink">
                {e.label} · {e.code}
              </p>
            ))}
            {items.slice(0, 4).map((e, i) => (
              <p key={`${e.at}-${i}`} className={`mt-0.5 ${e.impact === "high" ? "text-danger-ink" : "text-mute"}`}>
                <span className="num mr-1">{clockInZone(e.at, tz, hover.key)}</span>
                {e.country} {e.title}
              </p>
            ))}
            {items.length > 4 && <p className="mt-0.5 text-[10.5px] text-mute">还有 {items.length - 4} 条…</p>}
          </div>
        );
      })()}
    </div>
  );
}
