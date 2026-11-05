// 共用的小组件：页面标题、分组列表、开关
import type { ReactNode } from "react";

export function PageHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="page-head mb-4 flex items-center justify-between">
      <h1 className="text-[15px] font-semibold text-mute">{title}</h1>
      {aside}
    </div>
  );
}

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="group mb-5">
      {title && <h2 className="mb-1.5 text-[12.5px] text-mute">{title}</h2>}
      <ul className="rounded-xl bg-soft px-3.5">{children}</ul>
    </section>
  );
}

export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <li className="row flex items-center justify-between gap-4 border-b border-line py-2.5 text-sm last:border-b-0">
      <span>
        {label}
        {hint && <span className="num ml-2.5 text-[12.5px] text-mute">{hint}</span>}
      </span>
      {children}
    </li>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-[34px] flex-none rounded-full transition-colors ${checked ? "bg-amber" : "bg-switch-off"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${checked ? "left-4" : "left-0.5"}`}
      />
    </button>
  );
}

export function DstBadge({ text }: { text: string }) {
  return <span className="rounded-full bg-amber-soft px-2.5 py-0.5 text-xs text-amber-ink">{text}</span>;
}
