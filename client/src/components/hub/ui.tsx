/**
 * Small building blocks shared by Partner Hub pages, so every page has the
 * same header, the same status chip and the same empty state.
 */

import type { ReactNode } from "react";

export function HubPage({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-[1200px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-[hsl(215,20%,65%)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

const TONES: Record<string, string> = {
  good: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  warn: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  bad: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  info: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  muted: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export function Chip({ tone = "muted", children }: { tone?: keyof typeof TONES | string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${TONES[tone] ?? TONES.muted}`}>{children}</span>;
}

export function Panel({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-white">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ icon = "inbox", title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="py-10 text-center">
      <span className="material-icons text-4xl text-[hsl(215,20%,40%)]" style={{ fontFamily: "Material Icons" }} aria-hidden="true">{icon}</span>
      <p className="mt-2 font-medium text-[hsl(210,20%,85%)]">{title}</p>
      {children && <div className="mt-1 text-sm text-[hsl(215,20%,60%)]">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-4">
      <p className="text-xs text-[hsl(215,20%,60%)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-[hsl(215,20%,55%)]">{hint}</p>}
    </div>
  );
}
