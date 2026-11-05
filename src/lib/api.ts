// 与 Rust 核心通信的类型和命令封装
import { invoke } from "@tauri-apps/api/core";

export type TemplateId = "cme_equity" | "comex_gold" | "cme_crypto";
export type CalGroup = "cme";
export type ContractId = "es" | "nq" | "gc" | "btc";

export interface ContractSetting {
  id: ContractId;
  enabled: boolean;
  /** 手动覆盖当前合约换月日，格式 YYYY-MM-DD；null 表示按标准规则 */
  roll_override: string | null;
}

export interface Config {
  templates: { id: TemplateId; enabled: boolean; weekend: boolean }[];
  contracts: ContractSetting[];
  periods: number[];
  align_tz: string;
  lead_seconds: number;
  keys: { id: string; enabled: boolean; lead_minutes: number }[];
  notify: boolean;
  toast: boolean;
  toast_seconds: number;
  sound_mode: SoundMode;
  sound_file: string | null;
  sound_name: string | null;
  volume: number;
  news_enabled: boolean;
  news_currencies: string[];
  news_impacts: Impact[];
  news_lead_minutes: number;
  risk_enabled: boolean;
  risk_before_minutes: number;
  risk_after_minutes: number;
  news_prewarn_minutes: number;
  quiet_enabled: boolean;
  quiet_start: number;
  quiet_end: number;
  sound_key: SoundMode | null;
  sound_news: SoundMode | null;
  bar_enabled: boolean;
  bar_pos: [number, number] | null;
  /** 主窗口位置（逻辑像素）；null 表示居中 */
  window_pos: [number, number] | null;
  /** 主窗口大小（逻辑像素）；null 表示默认 880×600 */
  window_size: [number, number] | null;
  /** 全局快捷键；null 表示关闭 */
  hotkey: string | null;
}

export type Impact = "high" | "medium" | "low" | "holiday";

export interface NewsEvent { title: string; country: string; at: string; impact: Impact; forecast: string; previous: string }
export interface NewsInfo {
  state: { updated: string | null; error: string | null };
  events: NewsEvent[];
  currencies: string[];
}

export type SoundMode = "off" | "system" | "custom" | "voice" | "alarm";

export interface Alert {
  fire_at: string;
  at: string;
  bars: number[];
  keys: string[];
  news: string[];
  rolls: string[];
  session: string;
  risk: string | null;
}

export interface Status {
  now: string;
  next: Alert | null;
  paused_until: string | null;
  open: boolean;
  calendar_version: string;
  hotkey: string | null;
  hotkey_error: string | null;
}

export interface Band { name: string; start: string; end: string }
export interface Mark { name: string; at: string; major: boolean; enabled: boolean; news: boolean }
export interface Today {
  day_start: string;
  sessions: Band[];
  /** 已启用品种全部不能交易的时间 */
  closed: Band[];
  marks: Mark[];
  risks: Band[];
  dst_note: string;
  /** 全天休市原因：今日休市 / 周末休市 / 未启用品种 */
  day_note: string | null;
}

export type CalKind = "closed" | "early_close" | "normal";
export interface CalEntry { date: string; group: CalGroup; kind: CalKind; time: string | null }
export interface CalOverride { date: string; group: CalGroup; kind: CalKind; time: string | null }
export interface CalendarInfo { version: string; entries: CalEntry[]; overrides: CalOverride[] }

export interface KeyPoint { id: string; name: string; group: string; tz: string; time: string; major: boolean; next: string }

export interface ContractEvent {
  date: string;
  kind: "roll" | "expiry";
  code: string;
  label: string;
}

export interface ContractInfo {
  id: ContractId;
  name: string;
  root: string;
  enabled: boolean;
  roll_override: string | null;
  current_code: string;
  next_code: string;
  standard_roll_date: string;
  roll_date: string;
  expiry_date: string;
  roll_at: string;
  standard_roll_at: string;
  events: ContractEvent[];
}

export interface Diagnostics {
  version: string;
  config_path: string;
  data_dir: string;
  calendar_version: string;
  news_updated: string | null;
  news_error: string | null;
  news_count: number;
  news_enabled: boolean;
  news_currencies: string[];
}

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  setConfig: (cfg: Config) => invoke<Config>("set_config", { cfg }),
  getStatus: () => invoke<Status>("get_status"),
  getUpcoming: (n: number) => invoke<Alert[]>("get_upcoming", { n }),
  getContracts: () => invoke<ContractInfo[]>("get_contracts"),
  getToday: () => invoke<Today>("get_today"),
  listKeys: () => invoke<KeyPoint[]>("list_keys"),
  pause: (minutes: number) => invoke<void>("pause", { minutes }),
  pauseToday: () => invoke<void>("pause_today"),
  resume: () => invoke<void>("resume"),
  getCalendar: (month: string) => invoke<CalendarInfo>("get_calendar", { month }),
  addCalendarOverride: (group: CalGroup, date: string, kind: CalKind, time: string | null) =>
    invoke<CalendarInfo>("add_calendar_override", { group, date, kind, time }),
  removeCalendarOverride: (group: CalGroup, date: string) =>
    invoke<CalendarInfo>("remove_calendar_override", { group, date }),
  uploadSound: (name: string, bytes: number[]) => invoke<Config>("upload_sound", { name, bytes }),
  testSound: (mode?: SoundMode) => invoke<void>("test_sound", { mode: mode ?? null }),
  currentAlert: () => invoke<Alert | null>("current_alert"),
  getNews: () => invoke<NewsInfo>("get_news"),
  refreshNews: () => invoke<number>("refresh_news"),
  saveBarPos: (x: number, y: number) => invoke<void>("save_bar_pos", { x, y }),
  saveWindowState: (x: number, y: number, width: number, height: number) =>
    invoke<void>("save_window_state", { x, y, width, height }),
  getDiagnostics: () => invoke<Diagnostics>("get_diagnostics"),
  exportBackup: () => invoke<string>("export_backup"),
  importBackup: (json: string) => invoke<Config>("import_backup", { json }),
  resetConfig: () => invoke<Config>("reset_config"),
  openDataDir: () => invoke<void>("open_data_dir"),
  openSettings: () => invoke<void>("open_settings"),
};
