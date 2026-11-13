import type { TemplateId } from "../lib/api";
import { Group, Row, Switch } from "../components/ui";
import type { PageProps } from "../App";

const META: Record<TemplateId, { name: string; hint: string; weekend?: boolean }> = {
  cme_equity: { name: "ES / NQ 股指", hint: "CME · 周日 17:00 – 周五 16:00 芝加哥" },
  comex_gold: { name: "GC 黄金", hint: "COMEX · 同 CME 时段" },
  cme_crypto: { name: "BTC 比特币", hint: "CME · 7×24，每日 16:00 维护", weekend: true },
};

export default function SymbolsPage({ cfg, save }: PageProps) {
  const update = (id: TemplateId, patch: Partial<{ enabled: boolean; weekend: boolean }>) =>
    save({ ...cfg, templates: cfg.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  return (
    <>
      <p className="mb-4 text-[12.5px] text-mute">只在所选 CME 品种的交易时段内提醒，多个品种取并集。</p>
      <Group title="CME">
        {cfg.templates.map((t) => (
          <Row key={t.id} label={META[t.id].name} hint={META[t.id].hint}>
            <span className="flex items-center gap-4">
              {META[t.id].weekend && t.enabled && (
                <label className="flex items-center gap-2 text-xs text-mute">
                  周末提醒
                  <Switch checked={t.weekend} onChange={(v) => update(t.id, { weekend: v })} label={`${META[t.id].name} 周末提醒`} />
                </label>
              )}
              <Switch checked={t.enabled} onChange={(v) => update(t.id, { enabled: v })} label={META[t.id].name} />
            </span>
          </Row>
        ))}
      </Group>
    </>
  );
}
