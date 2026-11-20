"use client";
import { forwardRef, useEffect, useId, useRef } from "react";
import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { avatarHue, initials } from "@/lib/format";

/* ---------------- Button ---------------- */
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading}
      className={clsx(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-[15px]",
        variant === "primary" && "bg-brand text-brand-ink shadow-[0_1px_0_rgba(255,255,255,.2)_inset,0_6px_16px_-6px_var(--brand)] hover:brightness-110",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-surface-2",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "bg-absent text-white hover:brightness-110",
        className)}
      {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

/* ---------------- Form fields ---------------- */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={clsx("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}
const fieldCls = "h-10 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/15";
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(fieldCls, className)} {...rest} />;
});
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={clsx(fieldCls, "appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9", className)}
    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
    {...rest} />;
});

/* ---------------- Surfaces ---------------- */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("rounded-2xl border border-line bg-surface shadow-card", className)} {...rest}>{children}</div>;
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-brand">{eyebrow}</div>}
        <h1 className="font-display text-[34px] leading-[1.05] tracking-tight md:text-[44px]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, tone, sub }: { label: string; value: React.ReactNode; tone?: "present" | "confirm" | "absent" | "brand"; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={clsx("mt-1 font-display text-[40px] leading-none tabular-nums",
        tone === "present" && "text-present", tone === "confirm" && "text-confirm",
        tone === "absent" && "text-absent", tone === "brand" && "text-brand")}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/* ---------------- Badges / avatars ---------------- */
export function Badge({ tone = "muted", children, className }: { tone?: "present" | "confirm" | "absent" | "brand" | "muted"; children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
      tone === "present" && "bg-present-soft text-present",
      tone === "confirm" && "bg-confirm-soft text-confirm",
      tone === "absent" && "bg-absent-soft text-absent",
      tone === "brand" && "bg-brand-soft text-brand",
      tone === "muted" && "bg-surface-2 text-muted", className)}>{children}</span>
  );
}

export function Avatar({ name, seed, size = 36 }: { name: string; seed?: string; size?: number }) {
  const h = avatarHue(seed ?? name);
  return (
    <span aria-hidden className="inline-grid shrink-0 place-items-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.36,
        background: `oklch(0.93 0.05 ${h})`, color: `oklch(0.42 0.12 ${h})` }}>
      {initials(name)}
    </span>
  );
}

export function Meter({ value, tone }: { value: number; tone: "present" | "confirm" | "absent" | "muted" }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={clsx("h-full rounded-full transition-[width] duration-500",
        tone === "present" && "bg-present", tone === "confirm" && "bg-confirm", tone === "absent" && "bg-absent", tone === "muted" && "bg-muted")}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

export function Empty({ icon, title, children, action }: { icon: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="dot-grid flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-surface text-brand shadow-card">{icon}</div>
      <div className="font-display text-2xl">{title}</div>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ---------------- Dialog & sheet ---------------- */
function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    setTimeout(() => ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([data-close])")?.focus(), 30);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus(); };
  }, [open, onClose]);
  return ref;
}

export function Dialog({ open, onClose, title, description, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; description?: string; children?: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  const ref = useModal(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id}
        className={clsx("rise relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 shadow-2xl sm:rounded-3xl sm:p-6", wide ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id={id} className="font-display text-[28px] leading-tight">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button data-close aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"><X className="size-5" /></button>
        </div>
        {children}
        {footer && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", danger, loading }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; description: React.ReactNode;
  confirmLabel?: string; danger?: boolean; loading?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </>}>
      <div className="text-sm text-muted">{description}</div>
    </Dialog>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[];
}) {
  return (
    <div role="tablist" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={clsx("flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition",
            value === o.value ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
