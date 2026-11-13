import { useEffect, useState } from "react";
import { api, type KeyPoint } from "../lib/api";
import { hmBJ } from "../lib/format";
import { Group, Row, Switch } from "../components/ui";
import type { PageProps } from "../App";

const CITY: Record<string, string> = {
  "America/Chicago": "芝加哥",
  "America/New_York": "纽约",
  "Europe/London": "伦敦",
  "Europe/Berlin": "法兰克福",
  "Asia/Tokyo": "东京",
  "Asia/Hong_Kong": "香港",
  "Australia/Sydney": "悉尼",
};
const LEADS = [0, 1, 5, 10, 15];

export default function KeysPage({ cfg, save }: PageProps) {
  const [keys, setKeys] = useState<KeyPoint[]>([]);
  useEffect(() => void api.listKeys().then(setKeys), []);

  const setting = (id: string) => cfg.keys.find((k) => k.id === id) ?? { id, enabled: false, lead_minutes: 0 };
  const update = (id: string, patch: Partial<{ enabled: boolean; lead_minutes: number }>) =>
    save({ ...cfg, keys: cfg.keys.map((k) => (k.id === id ? { ...k, ...patch } : k)) });

  const groups = [...new Set(keys.map((k) => k.group))];

  return (
    <>
      <p className="mb-4 text-[12.5px] text-mute">按当地时间定义，夏令时自动换算。右侧是下一次的北京时间。</p>
      {groups.map((g) => (
        <Group key={g} title={g}>
          {keys
            .filter((k) => k.group === g)
            .map((k) => {
              const s = setting(k.id);
              return (
                <Row key={k.id} label={k.name} hint={`${CITY[k.tz] ?? k.tz} ${k.time.slice(0, 5)} → 北京 ${hmBJ(k.next)}`}>
                  <span className="flex items-center gap-3">
                    {s.enabled && (
                      <select
                        aria-label={`${k.name} 提前提醒`}
                        value={s.lead_minutes}
                        onChange={(e) => update(k.id, { lead_minutes: Number(e.target.value) })}
                        className="rounded-md border border-line bg-surface px-2 py-0.5 text-[12px]"
                      >
                        {LEADS.map((m) => (
                          <option key={m} value={m}>{m === 0 ? "准点" : `提前 ${m} 分钟`}</option>
                        ))}
                      </select>
                    )}
                    <Switch checked={s.enabled} onChange={(v) => update(k.id, { enabled: v })} label={k.name} />
                  </span>
                </Row>
              );
            })}
        </Group>
      ))}
    </>
  );
}
