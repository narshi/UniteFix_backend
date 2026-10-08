/**
 * UniteFix Celebrations — the look of the public pages for halls,
 * photographers and planners. Warm ivory paper, deep ink, a marigold accent
 * and a serif display face: a wedding card, not a dashboard.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export const C = {
  paper: "bg-[#FBF7F1]", ink: "text-[#231B16]", soft: "text-[#6F625A]", faint: "text-[#9A8C82]",
  line: "border-[#E9DFD3]", card: "bg-white", accent: "text-[#B5562B]", accentBg: "bg-[#B5562B]", gold: "text-[#B98B2E]",
};
export const display = { fontFamily: '"Fraunces", "Playfair Display", Georgia, "Times New Roman", serif' } as const;

/** The serif display face, loaded once when a Celebrations page opens. */
export function useCelebrationFonts() {
  useEffect(() => {
    if (document.getElementById("uf-celebrations-font")) return;
    const l = document.createElement("link");
    l.id = "uf-celebrations-font"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap";
    document.head.appendChild(l);
  }, []);
}

export const rs = (n: number | null | undefined) => (n == null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);
export const niceDate = (d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" }) : "—";
export const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export function Shell({ children, crumb }: { children: ReactNode; crumb?: ReactNode }) {
  useCelebrationFonts();
  useEffect(() => { const prev = document.body.style.background; document.body.style.background = "#FBF7F1"; return () => { document.body.style.background = prev; }; }, []);
  return (
    <div className={`min-h-screen ${C.paper} ${C.ink} antialiased`}>
      <header className={`sticky top-0 z-30 border-b ${C.line} bg-[#FBF7F1]/90 backdrop-blur`} style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <a href="/celebrations" className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="text-lg font-semibold" style={display}>UniteFix</span>
            <span className={`text-xs uppercase tracking-[0.18em] ${C.accent}`}>Celebrations</span>
          </a>
          <nav className={`hidden items-center gap-5 text-sm ${C.soft} sm:flex`} aria-label="Celebrations">
            <a href="/celebrations?type=halls" className="hover:text-[#231B16]">Halls</a>
            <a href="/celebrations?type=photographers" className="hover:text-[#231B16]">Photographers</a>
            <a href="/celebrations?type=planners" className="hover:text-[#231B16]">Event planners</a>
            <a href="/celebrations/plan" className="hover:text-[#231B16]">My plan</a>
          </nav>
          {crumb}
        </div>
      </header>
      <main>{children}</main>
      <footer className={`mt-20 border-t ${C.line}`}>
        <div className={`mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-sm ${C.soft}`}>
          <span><span style={display} className={C.ink}>UniteFix Celebrations</span> — halls, photographers and planners, booked with care.</span>
          <span>Every review is from a real booking.</span>
        </div>
      </footer>
    </div>
  );
}

export function SectionTitle({ kicker, title, id, children }: { kicker?: string; title: string; id?: string; children?: ReactNode }) {
  return (
    <div id={id} className="mb-6 scroll-mt-24">
      {kicker && <p className={`text-xs uppercase tracking-[0.2em] ${C.accent}`}>{kicker}</p>}
      <h2 className="mt-1 text-2xl sm:text-3xl" style={{ ...display, textWrap: "balance" as any }}>{title}</h2>
      {children && <div className={`mt-2 max-w-2xl ${C.soft}`}>{children}</div>}
    </div>
  );
}

export function Stars({ value, size = "text-base", label = true }: { value: number; size?: string; label?: boolean }) {
  const full = Math.round(value);
  return (
    <span className={`${size} ${C.gold}`} aria-label={label ? `${value} out of 5` : undefined}>
      {"★".repeat(full)}<span className="text-[#E3D6C6]">{"★".repeat(5 - full)}</span>
    </span>
  );
}

export const btn = "inline-flex items-center justify-center gap-2 rounded-full px-5 h-11 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
export const btnPrimary = `${btn} bg-[#231B16] text-[#FBF7F1] hover:bg-[#3a2e27]`;
export const btnAccent = `${btn} bg-[#B5562B] text-white hover:bg-[#9c4721]`;
export const btnGhost = `${btn} border border-[#D9CBBB] text-[#231B16] hover:bg-white`;
export const field = "h-11 w-full rounded-xl border border-[#E2D6C8] bg-white px-3 text-[15px] text-[#231B16] placeholder:text-[#B2A498] focus:border-[#B5562B] focus:outline-none focus:ring-2 focus:ring-[#B5562B]/20";
export const labelCls = `mb-1 block text-xs font-medium uppercase tracking-wider ${C.soft}`;

/** Full-screen photo viewer: arrows, keyboard, swipe. */
export function Lightbox({ items, index, onClose, onIndex }: { items: Array<{ src: string; caption?: string | null; kind?: string; embed?: string | null }>; index: number | null; onClose: () => void; onIndex: (i: number) => void }) {
  const start = useRef<number | null>(null);
  const go = useCallback((d: number) => { if (index == null) return; onIndex((index + d + items.length) % items.length); }, [index, items.length, onIndex]);
  useEffect(() => {
    if (index == null) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    document.addEventListener("keydown", k);
    const o = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = o; };
  }, [index, onClose, go]);
  if (index == null || !items[index]) return null;
  const it = items[index];
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo viewer" className="fixed inset-0 z-50 flex flex-col bg-[#120d0a]/95"
      onTouchStart={e => { start.current = e.touches[0].clientX; }}
      onTouchEnd={e => { if (start.current == null) return; const dx = e.changedTouches[0].clientX - start.current; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); start.current = null; }}>
      <div className="flex items-center justify-between px-4 py-3 text-sm text-white/80" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        <span>{index + 1} / {items.length}</span>
        <button className="rounded-full bg-white/10 px-4 py-1.5 text-white hover:bg-white/20" onClick={onClose}>Close</button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2" onClick={onClose}>
        <div onClick={e => e.stopPropagation()} className="flex max-h-full max-w-full items-center justify-center">
          {it.kind === "video" ? <video src={it.src} controls autoPlay playsInline className="max-h-[78vh] max-w-full rounded" />
            : it.kind === "embed" && it.embed ? <iframe src={it.embed} title={it.caption ?? "Video"} className="aspect-video w-[min(92vw,1100px)] rounded" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
            : <img src={it.src} alt={it.caption ?? ""} className="max-h-[78vh] max-w-full rounded object-contain" />}
        </div>
        {items.length > 1 && <>
          <button aria-label="Previous" onClick={e => { e.stopPropagation(); go(-1); }} className="absolute left-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 rounded-full bg-white/10 text-2xl text-white hover:bg-white/20 sm:block">‹</button>
          <button aria-label="Next" onClick={e => { e.stopPropagation(); go(1); }} className="absolute right-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 rounded-full bg-white/10 text-2xl text-white hover:bg-white/20 sm:block">›</button>
        </>}
      </div>
      {it.caption && <p className="px-4 pb-6 pt-2 text-center text-sm text-white/80" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}>{it.caption}</p>}
    </div>
  );
}

/** A video that only loads its player when asked — the page stays fast. */
export function VideoEmbed({ video, title, className = "" }: { video: { provider: string; embed: string; thumb: string | null; url: string }; title: string; className?: string }) {
  const [on, setOn] = useState(false);
  if (video.provider === "instagram") {
    return (
      <div className={`overflow-hidden rounded-2xl border ${C.line} bg-white ${className}`}>
        <iframe src={video.embed} title={title} className="h-[560px] w-full max-w-[400px]" loading="lazy" />
        <a href={video.url} target="_blank" rel="noopener noreferrer" className={`block px-3 py-2 text-xs ${C.soft}`}>View on Instagram ↗</a>
      </div>
    );
  }
  return (
    <div className={`relative aspect-video overflow-hidden rounded-2xl bg-[#1d1611] ${className}`}>
      {on ? <iframe src={`${video.embed}${video.embed.includes("?") ? "&" : "?"}autoplay=1`} title={title} className="absolute inset-0 h-full w-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
        : (
          <button onClick={() => setOn(true)} className="group absolute inset-0 h-full w-full" aria-label={`Play ${title}`}>
            {video.thumb ? <img src={video.thumb} alt="" className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100" loading="lazy" /> : <div className="h-full w-full bg-gradient-to-br from-[#3b2a20] to-[#120d0a]" />}
            <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-2xl text-[#231B16] shadow-lg transition group-hover:scale-105">▶</span></span>
            <span className="absolute bottom-3 left-4 text-sm text-white/90">{title}</span>
          </button>
        )}
    </div>
  );
}

export type ReviewsData = { average: number; count: number; stars: number[]; items: Array<{ id: number; name: string; occasion: string | null; eventDate: string | null; rating: number; body: string | null; reply: string | null }> };

export function Reviews({ data, partner }: { data: ReviewsData; partner: string }) {
  if (!data.count) return <p className={C.soft}>No reviews yet. Reviews come only from clients who booked {partner} through UniteFix, after their event.</p>;
  return (
    <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
      <div>
        <p className="text-5xl" style={display}>{data.average.toFixed(1)}</p>
        <Stars value={data.average} size="text-xl" />
        <p className={`mt-1 text-sm ${C.soft}`}>{data.count} review{data.count === 1 ? "" : "s"} from real bookings</p>
        <div className="mt-4 space-y-1.5">
          {data.stars.map((n, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className={`w-6 ${C.soft}`}>{5 - i}★</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#EFE6DB]"><span className="block h-full rounded-full bg-[#B98B2E]" style={{ width: `${data.count ? (n / data.count) * 100 : 0}%` }} /></span>
              <span className={`w-6 text-right ${C.faint}`}>{n}</span>
            </div>
          ))}
        </div>
      </div>
      <ul className="space-y-6">
        {data.items.map(r => (
          <li key={r.id} className={`border-b ${C.line} pb-6 last:border-0`}>
            <div className="flex flex-wrap items-center gap-2"><Stars value={r.rating} /><span className="text-sm font-medium">{r.name}</span><span className={`text-xs ${C.faint}`}>{[r.occasion, r.eventDate && niceDate(r.eventDate, { month: "short", year: "numeric" })].filter(Boolean).join(" · ")}</span></div>
            {r.body && <p className="mt-2 leading-relaxed">{r.body}</p>}
            {r.reply && <p className={`mt-3 border-l-2 border-[#E2D6C8] pl-3 text-sm ${C.soft}`}><span className="font-medium text-[#231B16]">{partner}:</span> {r.reply}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NotFoundCard({ title = "This page is not available", children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <p className="text-3xl" style={display}>{title}</p>
      <p className={`mt-3 ${C.soft}`}>{children ?? "It may not be live yet, or the link has changed."}</p>
      <a href="/celebrations" className={`${btnGhost} mt-6`}>Browse Celebrations</a>
    </div>
  );
}

export function Loading() {
  return <div className="mx-auto max-w-6xl px-4 py-24"><div className="h-72 animate-pulse rounded-3xl bg-[#EFE6DB]" /><div className="mt-6 h-6 w-1/3 animate-pulse rounded bg-[#EFE6DB]" /><div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-[#EFE6DB]" /></div>;
}
