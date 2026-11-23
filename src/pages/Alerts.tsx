import { useRef, useState } from "react";
import { Group, Row, SelectField, SliderField, Switch, type Option } from "../components/kit";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
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

const SOUND_OPTIONS: Option<SoundMode | "">[] = [
  { value: "", label: "跟随上面" },
  ...MODES.map((m) => ({ value: m.id as SoundMode | "", label: m.label })),
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
            <SelectField
              label="浮窗自动关闭时间"
              options={SECONDS.map((s) => ({ value: s, label: `${s} 秒后` }))}
              value={cfg.toast_seconds}
              onChange={(toast_seconds) => save({ ...cfg, toast_seconds })}
            />
          </Row>
        )}
      </Group>

      <Group title="提示音">
        <div className="py-3">
          <ToggleGroup
            aria-label="提示音"
            className="grid w-full grid-cols-5 gap-2"
            multiple={false}
            value={[cfg.sound_mode]}
            onValueChange={(next) => {
              const picked = next[0];
              if (picked) pickMode(picked as SoundMode);
            }}
          >
            {MODES.map((m) => (
              <ToggleGroupItem
                key={m.id}
                className="h-auto flex-col items-start justify-start rounded-lg border border-border bg-card px-3 py-2.5 text-left data-pressed:border-primary/60 data-pressed:bg-primary/8 data-pressed:text-foreground sm:h-auto"
                value={m.id}
              >
                <span className="text-sm font-medium">{m.label}</span>
                <span className="mt-1 whitespace-normal text-[11.5px] font-normal leading-snug text-muted-foreground">
                  {m.hint}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {cfg.sound_mode === "custom" && (
          <Row label="音频文件" hint={cfg.sound_name ?? "未上传"}>
            <Button disabled={busy} size="xs" variant="outline" onClick={() => fileRef.current?.click()}>
              {busy ? "正在保存…" : "更换"}
            </Button>
          </Row>
        )}

        {cfg.sound_mode !== "off" && (
          <Row label="音量" hint={`${cfg.volume}`}>
            <div className="flex items-center gap-3">
              <SliderField
                className="w-32"
                label="音量"
                step={5}
                value={cfg.volume}
                onChange={(volume) => save({ ...cfg, volume })}
              />
              <Button size="xs" variant="outline" onClick={() => api.testSound()}>
                试听
              </Button>
            </div>
          </Row>
        )}
      </Group>

      <Group title="按提醒类型区分声音">
        <SoundRow
          hasFile={!!cfg.sound_file}
          hint="开盘、收盘、休市等"
          label="关键时点"
          value={cfg.sound_key}
          onChange={(v) => save({ ...cfg, sound_key: v })}
        />
        <SoundRow
          hasFile={!!cfg.sound_file}
          hint="数据发布和预警"
          label="财经数据"
          value={cfg.sound_news}
          onChange={(v) => save({ ...cfg, sound_news: v })}
        />
      </Group>

      <input ref={fileRef} accept=".wav,.mp3,.ogg,.flac,audio/*" hidden type="file" onChange={onFile} />

      {msg && (
        <Alert className="mb-3 py-2" variant={msg.error ? "error" : "success"}>
          <AlertDescription className="text-[12.5px]">{msg.text}</AlertDescription>
        </Alert>
      )}
      <p className="text-[12.5px] leading-5 text-muted-foreground">
        自定义音频支持 WAV、MP3、OGG、FLAC，5 MB 以内，最多播放 10 秒。文件损坏或语音不可用时会自动改用系统提示音。
      </p>
    </>
  );
}

// “跟随上面”表示和 K 线收盘用同一种声音
function SoundRow(props: {
  label: string;
  hint: string;
  value: SoundMode | null;
  onChange: (v: SoundMode | null) => void;
  hasFile: boolean;
}) {
  const { label, hint, value, onChange, hasFile } = props;
  const options = SOUND_OPTIONS.filter((m) => m.value !== "custom" || hasFile);
  return (
    <Row label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <SelectField
          className="min-w-28"
          label={`${label}提示音`}
          options={options}
          value={value ?? ""}
          onChange={(next) => onChange(next === "" ? null : next)}
        />
        <Button size="xs" variant="outline" onClick={() => api.testSound(value ?? undefined)}>
          试听
        </Button>
      </div>
    </Row>
  );
}
