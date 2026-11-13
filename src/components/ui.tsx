// 共用的小组件：页面标题、分组列表、开关
import type { ReactNode } from "react";

export function PageHead({ title, sub, aside }: { title: string; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="page-head mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold leading-7 text-ink">{title}</h1>
        {sub && <p className="mt-1 text-[12.5px] leading-5 text-mute">{sub}</p>}
      </div>
      {aside && <div className="flex flex-none items-center gap-2 pt-1.5">{aside}</div>}
    </header>
  );
}

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="group mb-5">
      {title && <h2 className="mb-2 px-4 text-[12.5px] font-medium text-mute">{title}</h2>}
      <ul className="rounded-xl bg-soft px-4">{children}</ul>
    </section>
  );
}

export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <li className="row flex items-center justify-between gap-4 border-b border-line py-3 text-sm last:border-b-0">
      <span className="min-w-0">
        {label}
        {hint && <span className="num ml-2 text-[12.5px] text-mute">{hint}</span>}
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
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-3.5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function DstBadge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-amber-ink">
      <i className="h-1.5 w-1.5 flex-none rounded-full bg-amber" aria-hidden="true" />
      {text}
    </span>
  );
}
