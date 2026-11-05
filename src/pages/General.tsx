import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { api } from "../lib/api";
import { Group, PageHead, Row, Switch } from "../components/ui";
import {
  loadUiPrefs,
  saveUiPrefs,
  type BarStyle,
  type DensityPref,
  type StartPage,
  type ThemePref,
  type UiPrefs,
} from "../lib/ui-prefs";
import type { PageProps } from "../App";

const HOTKEYS = [
  { value: "ctrl+alt+p", label: "Ctrl + Alt + P" },
  { value: "ctrl+shift+p", label: "Ctrl + Shift + P" },
  { value: "ctrl+alt+k", label: "Ctrl + Alt + K" },
  { value: "off", label: "关闭" },
] as const;

const THEMES: { id: ThemePref; label: string }[] = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
];

const DENSITIES: { id: DensityPref; label: string }[] = [
  { id: "comfortable", label: "舒适" },
  { id: "compact", label: "紧凑" },
];

const BAR_STYLES: { id: BarStyle; label: string }[] = [
  { id: "one-line", label: "单行 · 只显示倒计时" },
  { id: "two-line", label: "两行 · 加当前合约" },
  { id: "news-line", label: "两行 · 数据优先" },
];

const START_PAGES: { id: StartPage; label: string }[] = [
  { id: "today", label: "今日" },
  { id: "calendar", label: "日历" },
  { id: "contracts", label: "合约" },
];

export default function GeneralPage({ cfg, save }: PageProps) {
  const [auto, setAuto] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<UiPrefs>(loadUiPrefs);
  const prefsRef = useRef(prefs);

  useEffect(() => void isEnabled().then(setAuto), []);
  // 启动时若快捷键已被其他程序占用，直接把后端记录的原因显示出来
  useEffect(() => {
    api.getStatus().then((s) => setHotkeyError(s.hotkey_error)).catch(() => {});
  }, []);

  const toggleAuto = async (v: boolean) => {
    await (v ? enable() : disable());
    setAuto(await isEnabled());
  };

  // 等后端保存并重新注册后再读状态，避免读到上一次的注册结果
  const changeHotkey = (value: string) => {
    setHotkeyError(null);
    const next = { ...cfg, hotkey: value === "off" ? null : value };
    void Promise.resolve(save(next)).then(() =>
      api.getStatus().then((s) => setHotkeyError(s.hotkey_error)).catch(() => {}),
    );
  };

  const updatePrefs = (patch: Partial<UiPrefs>) => {
    // 连续点“深色”再点“紧凑”时，第二次要用刚写入的值，不能拿上一次渲染的闭包
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    saveUiPrefs(next);
    void emit("ui-prefs-changed", next).catch(() => {
      // 浏览器预览没有 Tauri 事件总线，主窗口自己的 CSS 已经更新
    });
  };

  return (
    <>
      <PageHead title="常规与外观" />

      <Group title="外观">
        <Row label="主题" hint="主窗口、浮窗和倒计时条一起切换">
          <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="主题">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={prefs.theme === t.id}
                onClick={() => updatePrefs({ theme: t.id })}
                className={`rounded-md px-2.5 py-1 text-[12px] ${
                  prefs.theme === t.id ? "bg-soft font-semibold text-ink shadow-sm" : "text-mute hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="界面密度" hint="紧凑模式只缩间距，不改字号">
          <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="界面密度">
            {DENSITIES.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={prefs.density === d.id}
                onClick={() => updatePrefs({ density: d.id })}
                className={`rounded-md px-2.5 py-1 text-[12px] ${
                  prefs.density === d.id ? "bg-soft font-semibold text-ink shadow-sm" : "text-mute hover:text-ink"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="启动页" hint="下次打开主窗口时生效">
          <select
            value={prefs.startPage}
            onChange={(e) => updatePrefs({ startPage: e.target.value as StartPage })}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
          >
            {START_PAGES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Row>
      </Group>

      <Group title="常规">
        <Row label="开机自动启动" hint="启动后只显示托盘图标">
          <Switch checked={auto} onChange={toggleAuto} label="开机自动启动" />
        </Row>
        <Row label="桌面倒计时条" hint="屏幕角落始终置顶，可拖动；双击打开设置">
          <Switch checked={cfg.bar_enabled} onChange={(v) => save({ ...cfg, bar_enabled: v })} label="桌面倒计时条" />
        </Row>
        <Row label="暂停 / 恢复提醒" hint="全局快捷键">
          <select
            value={cfg.hotkey ?? "off"}
            onChange={(e) => changeHotkey(e.target.value)}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
          >
            {HOTKEYS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </Row>
      </Group>

      <Group title="悬浮条">
        <Row label="显示样式" hint={cfg.bar_enabled ? "两行会显示当前合约" : "开启桌面倒计时条后生效"}>
          <select
            value={prefs.barStyle}
            onChange={(e) => updatePrefs({ barStyle: e.target.value as BarStyle })}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
          >
            {BAR_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="不透明度" hint={`${prefs.barOpacity}%`}>
          <input
            type="range"
            min={70}
            max={100}
            step={5}
            value={prefs.barOpacity}
            onChange={(e) => updatePrefs({ barOpacity: Number(e.target.value) })}
            className="w-36 accent-amber"
            aria-label="悬浮条不透明度"
          />
        </Row>
        <Row label="锁定位置" hint="防止误拖；双击仍可打开设置">
          <Switch checked={prefs.barLocked} onChange={(v) => updatePrefs({ barLocked: v })} label="锁定悬浮条位置" />
        </Row>
        <Row label="点击穿透" hint="开启后悬浮条不接收鼠标，需回到这里关闭">
          <Switch
            checked={prefs.barClickThrough}
            onChange={(v) => updatePrefs({ barClickThrough: v })}
            label="悬浮条点击穿透"
          />
        </Row>
      </Group>

      {hotkeyError && (
        <p role="alert" className="mb-4 rounded-lg bg-amber-soft px-3 py-2 text-[13px] leading-5 text-amber-ink">
          {hotkeyError}
        </p>
      )}
      <p className="text-[13px] leading-6 text-mute">
        关闭这个窗口后 TradeClock 会继续在托盘运行。要完全退出，请右键托盘图标选择“退出”。
        <br />
        托盘图标会随状态变色：琥珀色为交易中，灰色为已暂停，蓝灰色为休市。
      </p>
    </>
  );
}
