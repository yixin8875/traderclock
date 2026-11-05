// 纯前端外观偏好：不写进 Rust 配置，避免为了主题/密度改配置结构。
// 主窗口、托盘倒计时条和提醒浮窗共用同一个 localStorage key。
export type ThemePref = "light" | "dark" | "system";
export type DensityPref = "comfortable" | "compact";
export type BarStyle = "one-line" | "two-line" | "news-line";
export type StartPage = "today" | "calendar" | "contracts";

export interface UiPrefs {
  theme: ThemePref;
  density: DensityPref;
  barStyle: BarStyle;
  /** 70–100，百分比 */
  barOpacity: number;
  barLocked: boolean;
  barClickThrough: boolean;
  /** 每次启动主窗口默认打开的页面 */
  startPage: StartPage;
}

export const UI_PREFS_KEY = "tradeclock.ui";

export const DEFAULT_UI_PREFS: UiPrefs = {
  theme: "light",
  density: "comfortable",
  barStyle: "one-line",
  barOpacity: 100,
  barLocked: false,
  barClickThrough: false,
  startPage: "today",
};

/** 导入备份或读取旧 localStorage 时，把任意值收敛成合法偏好。 */
export function normalizeUiPrefs(raw: Partial<UiPrefs> | null | undefined): UiPrefs {
  const p = raw ?? {};
  const theme: ThemePref = p.theme === "dark" || p.theme === "light" || p.theme === "system" ? p.theme : "light";
  const barStyle: BarStyle =
    p.barStyle === "two-line" || p.barStyle === "news-line" ? p.barStyle : "one-line";
  const startPage: StartPage =
    p.startPage === "calendar" || p.startPage === "contracts" ? p.startPage : "today";
  return {
    theme,
    density: p.density === "compact" ? "compact" : "comfortable",
    barStyle,
    barOpacity: Math.min(100, Math.max(70, Number(p.barOpacity) || 100)),
    barLocked: p.barLocked === true,
    barClickThrough: p.barClickThrough === true,
    startPage,
  };
}

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    return raw ? normalizeUiPrefs(JSON.parse(raw) as Partial<UiPrefs>) : DEFAULT_UI_PREFS;
  } catch {
    return DEFAULT_UI_PREFS;
  }
}

export function resolveTheme(theme: ThemePref): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

/** 把偏好写到 <html> 上；CSS 用 data-theme / data-density 切换整套 token。 */
export function applyUiPrefs(prefs: UiPrefs) {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(prefs.theme);
  root.dataset.density = prefs.density;
}

export function saveUiPrefs(next: UiPrefs) {
  const prefs = normalizeUiPrefs(next);
  localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
  applyUiPrefs(prefs);
  window.dispatchEvent(new CustomEvent<UiPrefs>("ui-prefs-changed", { detail: prefs }));
}
