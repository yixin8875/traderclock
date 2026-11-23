import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { CircleAlert } from "lucide-react";
import { api } from "../lib/api";
import { ChoiceGroup, Group, Row, SelectField, SliderField, Switch, type Option } from "../components/kit";
import { Alert, AlertDescription } from "../components/ui/alert";
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

const HOTKEYS: Option<string>[] = [
  { value: "ctrl+alt+p", label: "Ctrl + Alt + P" },
  { value: "ctrl+shift+p", label: "Ctrl + Shift + P" },
  { value: "ctrl+alt+k", label: "Ctrl + Alt + K" },
  { value: "off", label: "关闭" },
];

const THEMES: Option<ThemePref>[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const DENSITIES: Option<DensityPref>[] = [
  { value: "comfortable", label: "舒适" },
  { value: "compact", label: "紧凑" },
];

const BAR_STYLES: Option<BarStyle>[] = [
  { value: "one-line", label: "单行 · 只显示倒计时" },
  { value: "two-line", label: "两行 · 加当前合约" },
  { value: "news-line", label: "两行 · 数据优先" },
];

const START_PAGES: Option<StartPage>[] = [
  { value: "today", label: "今日" },
  { value: "calendar", label: "日历" },
  { value: "contracts", label: "合约" },
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
      <Group title="外观">
        <Row label="主题" hint="主窗口、浮窗和倒计时条一起切换">
          <ChoiceGroup label="主题" options={THEMES} value={prefs.theme} onChange={(theme) => updatePrefs({ theme })} />
        </Row>
        <Row label="界面密度" hint="紧凑模式只缩间距，不改字号">
          <ChoiceGroup
            label="界面密度"
            options={DENSITIES}
            value={prefs.density}
            onChange={(density) => updatePrefs({ density })}
          />
        </Row>
        <Row label="启动页" hint="下次打开主窗口时生效">
          <SelectField
            label="启动页"
            options={START_PAGES}
            value={prefs.startPage}
            onChange={(startPage) => updatePrefs({ startPage })}
          />
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
          <SelectField
            label="暂停 / 恢复提醒快捷键"
            options={HOTKEYS}
            value={cfg.hotkey ?? "off"}
            onChange={changeHotkey}
          />
        </Row>
      </Group>

      <Group title="悬浮条">
        <Row label="显示样式" hint={cfg.bar_enabled ? "两行会显示当前合约" : "开启桌面倒计时条后生效"}>
          <SelectField
            label="悬浮条显示样式"
            options={BAR_STYLES}
            value={prefs.barStyle}
            onChange={(barStyle) => updatePrefs({ barStyle })}
          />
        </Row>
        <Row label="不透明度" hint={`${prefs.barOpacity}%`}>
          <SliderField
            label="悬浮条不透明度"
            max={100}
            min={70}
            step={5}
            value={prefs.barOpacity}
            onChange={(barOpacity) => updatePrefs({ barOpacity })}
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
        <Alert className="mb-4" variant="warning">
          <CircleAlert />
          <AlertDescription className="text-[13px] leading-5 text-warning-foreground">{hotkeyError}</AlertDescription>
        </Alert>
      )}
      <p className="text-[12.5px] leading-5 text-muted-foreground">
        关闭这个窗口后 TradeClock 会继续在托盘运行。要完全退出，请右键托盘图标选择“退出”。
        <br />
        托盘图标会随状态变色：琥珀色为交易中，灰色为已暂停，蓝灰色为休市。
      </p>
    </>
  );
}
