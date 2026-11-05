// 时间格式化：界面上统一显示北京时间
const bjFmt = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const hmBJ = (iso: string | number | Date): string => bjFmt.format(new Date(iso));

export function hmIn(iso: string | number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** 毫秒 → "mm:ss"，超过 1 小时显示 "h:mm:ss" */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  if (s >= 3600) return `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
  return `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}

/** 15 → "15m"，60 → "1h" */
export const periodLabel = (m: number): string => (m % 60 === 0 ? `${m / 60}h` : `${m}m`);
