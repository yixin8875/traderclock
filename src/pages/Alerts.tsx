import { useRef, useState } from "react";
import { Group, Row, Switch } from "../components/ui";
import { api, type SoundMode } from "../lib/api";
import type { PageProps } from "../App";

const SECONDS = [5, 8, 12, 20, 30];
const MAX_BYTES = 5 * 1024 * 1024;

const MODES: { id: SoundMode; label: string; hint: string }[] = [
  { id: "system", label: "系统默认", hint: "Windows 自带提示音" },
  { id: "custom", label: "自定义", hint: "上传自己的音频" },
  { id: "voice", label: "语音播报", hint: "读出“美股开盘，15 分钟收盘”" },
  { id: "alarm", label: "闹钟铃声", hint: "Windows 闹钟，更醒目" },
  { id: "off", label: "静音", hint: "只弹窗不出声" },
];

export default function AlertsPage({ cfg, save }: PageProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const pickMode = (m: SoundMode) => {
    setMsg(null);
    // 选“自定义”但还没上传过文件，直接打开文件选择
    if (m === "custom" && !cfg.sound_file) {
      fileRef.current?.click();
      return;
    }
    save({ ...cfg, sound_mode: m });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // 允许再次选择同一个文件
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setMsg({ text: "文件太大，请选择 5 MB 以内的音频", error: true });
      return;
    }
    setBusy(true);
    try {
      const bytes = Array.from(new Uint8Array(await f.arrayBuffer()));
      const next = await api.uploadSound(f.name, bytes);
      save(next, { persist: false });
      setMsg({ text: "已保存，正在试听", error: false });
      api.testSound("custom");
    } catch (err) {
      setMsg({ text: String(err), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Group>
        <Row label="Windows 系统通知" hint="出现在通知中心">
          <Switch checked={cfg.notify} onChange={(v) => save({ ...cfg, notify: v })} label="Windows 系统通知" />
        </Row>
        <Row label="屏幕右下角浮窗">
          <Switch checked={cfg.toast} onChange={(v) => save({ ...cfg, toast: v })} label="屏幕右下角浮窗" />
        </Row>
        {cfg.toast && (
          <Row label="浮窗自动关闭">
            <select
              value={cfg.toast_seconds}
              onChange={(e) => save({ ...cfg, toast_seconds: Number(e.target.value) })}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-sm"
            >
              {SECONDS.map((s) => (
                <option key={s} value={s}>{s} 秒后</option>
              ))}
            </select>
          </Row>
        )}
      </Group>

      <Group title="提示音">
        <li className="grid grid-cols-5 gap-2 py-3">
          {MODES.map((m) => {
            const on = cfg.sound_mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => pickMode(m.id)}
                className={`rounded-lg px-3 py-2.5 text-left transition-colors ${
                  on ? "bg-surface ring-1 ring-amber/60" : "hover:bg-surface/70"
                }`}
              >
                <div className={`text-sm ${on ? "font-medium text-amber-ink" : ""}`}>{m.label}</div>
                <div className="mt-1 text-[11.5px] leading-snug text-mute">{m.hint}</div>
              </button>
            );
          })}
        </li>

        {cfg.sound_mode === "custom" && (
          <Row label="音频文件" hint={cfg.sound_name ?? "未上传"}>
            <button
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="rounded-lg bg-surface px-3 py-1 text-[12.5px] shadow-sm disabled:opacity-50"
            >
              {busy ? "正在保存…" : "更换"}
            </button>
          </Row>
        )}

        {cfg.sound_mode !== "off" && (
          <Row label="音量" hint={`${cfg.volume}`}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={cfg.volume}
                onChange={(e) => save({ ...cfg, volume: Number(e.target.value) })}
                className="w-32 accent-amber"
                aria-label="音量"
              />
              <button onClick={() => api.testSound()} className="rounded-lg bg-surface px-3 py-1 text-[12.5px] shadow-sm">
                试听
              </button>
            </div>
          </Row>
        )}
      </Group>

      <Group title="按提醒类型区分声音">
        <SoundRow label="关键时点" hint="开盘、收盘、休市等" value={cfg.sound_key} onChange={(v) => save({ ...cfg, sound_key: v })} hasFile={!!cfg.sound_file} />
        <SoundRow label="财经数据" hint="数据发布和预警" value={cfg.sound_news} onChange={(v) => save({ ...cfg, sound_news: v })} hasFile={!!cfg.sound_file} />
      </Group>

      <input ref={fileRef} type="file" accept=".wav,.mp3,.ogg,.flac,audio/*" hidden onChange={onFile} />

      {msg && <p className={`mb-3 text-[12.5px] ${msg.error ? "text-danger-ink" : "text-mute"}`}>{msg.text}</p>}
      <p className="text-[12.5px] leading-5 text-mute">
        自定义音频支持 WAV、MP3、OGG、FLAC，5 MB 以内，最多播放 10 秒。文件损坏或语音不可用时会自动改用系统提示音。
      </p>
    </>
  );
}

// “跟随上面”表示和 K 线收盘用同一种声音
function SoundRow(props: { label: string; hint: string; value: SoundMode | null; onChange: (v: SoundMode | null) => void; hasFile: boolean }) {
  const { label, hint, value, onChange, hasFile } = props;
  return (
    <Row label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <select
          value={value ?? ""}
          aria-label={`${label}提示音`}
          onChange={(e) => onChange((e.target.value || null) as SoundMode | null)}
          className="rounded-lg border border-line bg-surface px-2 py-1 text-sm"
        >
          <option value="">跟随上面</option>
          {MODES.filter((m) => m.id !== "custom" || hasFile).map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <button
          onClick={() => api.testSound(value ?? undefined)}
          className="rounded-lg bg-surface px-3 py-1 text-[12.5px] shadow-sm"
        >
          试听
        </button>
      </div>
    </Row>
  );
}
