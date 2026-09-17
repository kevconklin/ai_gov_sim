import type { ReactNode } from "react";
import { BANK_COLORS, BANK_LABELS } from "@/lib/constants";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle ? <div className="muted">{subtitle}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </header>
  );
}

export function Panel({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel min-w-0 p-3 ${className}`}>
      {title || actions ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-semibold">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded border p-2" style={{ borderColor: "var(--border)" }}>
      <div className="muted text-xs">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      {hint ? <div className="muted text-xs">{hint}</div> : null}
    </div>
  );
}

export function BankName({ bankId, condition }: { bankId: string; condition?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BANK_COLORS[bankId] ?? "var(--muted)" }} />
      <span className="font-semibold">{BANK_LABELS[bankId] ?? bankId}</span>
      {condition ? <span className="muted">({condition})</span> : null}
    </span>
  );
}

export function Chip({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="chip" style={color ? { borderColor: color, color } : undefined}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted py-2 italic">{children}</p>;
}

export function TabLinks({ items }: { items: { href: string; label: ReactNode; active: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it, i) => (
        <a key={i} href={it.href} className="btn no-underline" style={it.active ? { borderColor: "var(--accent)", color: "var(--accent)" } : { color: "var(--text)" }}>
          {it.label}
        </a>
      ))}
    </div>
  );
}

export function Json({ text, value }: { text?: string | null; value?: unknown }) {
  let out = "";
  if (value !== undefined) out = JSON.stringify(value, null, 2);
  else if (text) {
    try {
      out = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      out = text;
    }
  }
  return <pre className="code">{out || "(empty)"}</pre>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}
