// 页面共用的组合件：标题、分组卡片、行、开关、下拉、滑杆、多选。
// 底层全部是 coss ui 的组件（Base UI + Tailwind），这里只做本项目的密度与 API 收敛。
import type { ReactNode } from "react";
import { Badge } from "./ui/badge";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { Switch as CossSwitch } from "./ui/switch";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { cn } from "../lib/utils";

export function PageHead({ title, sub, aside }: { title: string; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="page-head mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold leading-7 tracking-tight text-foreground">{title}</h1>
        {sub && <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{sub}</p>}
      </div>
      {aside && <div className="flex flex-none items-center gap-2 pt-1.5">{aside}</div>}
    </header>
  );
}

export function Group({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("group mb-5", className)}>
      {title && <h2 className="mb-2 px-1 text-[12.5px] font-medium text-muted-foreground">{title}</h2>}
      <div className="rounded-xl border border-border bg-card px-4 shadow-xs/5">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="row flex items-center justify-between gap-4 border-b border-border py-3 text-sm last:border-b-0">
      <span className="min-w-0">
        {label}
        {hint && <span className="num ml-2 text-[12.5px] text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <CossSwitch
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onChange(next)}
    />
  );
}

export function SliderField({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  className?: string;
}) {
  return (
    <Slider
      aria-label={label}
      className={cn("w-36 self-center", className)}
      getAriaLabel={() => label}
      max={max}
      min={min}
      step={step}
      value={value}
      onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
    />
  );
}

export interface Option<T extends string | number> {
  value: T;
  label: ReactNode;
}

/** coss Select：和原生 <select> 一样用 value/onChange，选项由 options 给出。 */
export function SelectField<T extends string | number>({
  value,
  onChange,
  options,
  label,
  className,
  size = "sm",
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<Option<T>>;
  label?: string;
  className?: string;
  size?: "sm" | "default" | "lg";
}) {
  return (
    <Select
      items={options as ReadonlyArray<{ label: ReactNode; value: T }>}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next as T);
      }}
    >
      <SelectTrigger aria-label={label} className={cn("w-auto min-w-36", className)} size={size}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {options.map((o) => (
          <SelectItem key={String(o.value)} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** 单选分段控件：主题、密度、对齐方式这类 2–4 个互斥选项。 */
export function ChoiceGroup<T extends string | number>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<Option<T>>;
  label: string;
  className?: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      className={cn("rounded-lg border border-border bg-muted p-0.5", className)}
      size="sm"
      value={[String(value)]}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked === undefined) return;
        const option = options.find((o) => String(o.value) === picked);
        if (option) onChange(option.value);
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={String(o.value)}
          className="h-7 border-0 px-2.5 text-[12px] data-pressed:bg-card data-pressed:text-foreground data-pressed:shadow-xs/5 dark:data-pressed:bg-accent"
          value={String(o.value)}
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** 多选按钮组：K 线周期这类可以同时选多个的选项。 */
export function MultiChoiceGroup<T extends string | number>({
  values,
  onChange,
  options,
  label,
  className,
  render,
}: {
  values: ReadonlyArray<T>;
  onChange: (next: T[]) => void;
  options: ReadonlyArray<Option<T>>;
  label: string;
  className?: string;
  render?: (o: Option<T>) => ReactNode;
}) {
  const selected = values.map(String);
  return (
    <ToggleGroup
      aria-label={label}
      className={cn("flex-wrap gap-1.5", className)}
      multiple
      size="default"
      value={selected}
      onValueChange={(next) => {
        const picked = options.filter((o) => next.includes(String(o.value))).map((o) => o.value);
        onChange(picked);
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={String(o.value)}
          className="rounded-lg border-transparent bg-muted px-3 data-pressed:bg-primary data-pressed:text-primary-foreground"
          value={String(o.value)}
        >
          {render ? render(o) : o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function DstBadge({ text }: { text: string }) {
  return (
    <Badge size="lg" variant="warning">
      <i className="h-1.5 w-1.5 flex-none rounded-full bg-current" aria-hidden="true" />
      {text}
    </Badge>
  );
}
