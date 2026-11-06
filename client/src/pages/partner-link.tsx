/**
 * A partner's customer link: app.unitefix.com/p/:code
 *
 * What a partner's customer sees when they tap the link a partner shared on
 * WhatsApp or scanned from a visiting card: who the partner is, their
 * customers' rating, what they do, and the code. On Android the button opens
 * the UniteFix app with this partner already chosen (or the Play Store when
 * the app is not installed); elsewhere the code is what they type in the app.
 */

import { useEffect, useState } from "react";

const PLAY = "https://play.google.com/store/apps/details?id=com.unitefix.app";
export const isPartnerLinkPath = (p: string) => /^\/p\/[A-Za-z0-9-]{3,24}\/?$/.test(p);

type Card = { code: string; link: string; name: string; rating: number | null; reviews: number; jobsDone: number; services: string[]; takesJobs: boolean };

const isAndroid = () => typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
/** Opens the app at this partner when installed; otherwise Android goes to the Play Store. */
const appLink = (code: string) => `intent://p/${encodeURIComponent(code)}#Intent;scheme=unitefix;package=com.unitefix.app;S.browser_fallback_url=${encodeURIComponent(PLAY)};end`;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "U";

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-hidden>
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} viewBox="0 0 20 20" className={`h-4 w-4 ${value >= i - 0.25 ? "fill-amber-400" : "fill-slate-200"}`}><path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L10 14.8l-5.2 2.8 1-5.8L1.5 7.7l5.9-.8z" /></svg>
      ))}
    </span>
  );
}

export default function PartnerLinkPage() {
  const code = decodeURIComponent((typeof window !== "undefined" ? window.location.pathname : "").split("/")[2] ?? "");
  const [state, setState] = useState<{ card?: Card; error?: string; loading: boolean }>({ loading: true });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let on = true;
    fetch(`/api/public/partners/${encodeURIComponent(code)}`).then(async r => {
      const b = await r.json().catch(() => null);
      if (!on) return;
      setState(r.ok ? { loading: false, card: b.data } : { loading: false, error: b?.message ?? "This link is not valid." });
    }).catch(() => on && setState({ loading: false, error: "Could not load. Check your connection." }));
    return () => { on = false; };
  }, [code]);

  useEffect(() => { if (state.card) document.title = `${state.card.name} on UniteFix`; }, [state.card]);

  const copy = async () => {
    if (!state.card) return;
    try { await navigator.clipboard.writeText(state.card.code); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* the code is selectable anyway */ }
  };

  const c = state.card;
  return (
    <main className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-md">
        <p className="mb-6 text-center text-sm font-semibold tracking-wide text-indigo-600">UniteFix</p>

        {state.loading ? (
          <div className="h-80 animate-pulse rounded-3xl bg-white shadow-sm" />
        ) : !c ? (
          <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
            <p className="text-lg font-semibold">{state.error}</p>
            <p className="mt-2 text-sm text-slate-500">Ask the partner for their UniteFix code, or book any service in the app.</p>
            <a href={PLAY} className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-indigo-600 px-6 font-semibold text-white">Get the UniteFix app</a>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl bg-white shadow-[0_12px_40px_-12px_rgba(79,70,229,0.25)] ring-1 ring-indigo-100" style={{ animation: "uf-rise .5s cubic-bezier(.2,.8,.2,1) both" }}>
            <style>{`@keyframes uf-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>
            <div className="bg-indigo-600 px-6 pb-14 pt-6 text-white">
              <p className="text-xs font-semibold uppercase tracking-widest text-indigo-200">UniteFix verified partner</p>
            </div>
            <div className="-mt-10 px-6 pb-6">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white text-2xl font-bold text-indigo-600 shadow-md ring-4 ring-white">{initials(c.name)}</div>
              <h1 className="mt-4 text-2xl font-bold leading-tight" style={{ textWrap: "balance" } as any}>{c.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {c.rating != null && c.reviews > 0 ? (
                  <><Stars value={c.rating} /><span className="font-semibold">{c.rating.toFixed(1)}</span><span className="text-slate-500">({c.reviews} {c.reviews === 1 ? "review" : "reviews"})</span></>
                ) : (
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-600">New on UniteFix</span>
                )}
                {c.jobsDone > 0 && <span className="text-slate-500">· {c.jobsDone} jobs done</span>}
              </div>

              {c.services.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Services</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.services.slice(0, 10).map(s => <span key={s} className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-700">{s}</span>)}
                  </div>
                </div>
              )}

              <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Partner code</p>
                <p className="mt-1 select-all font-mono text-3xl font-bold tracking-[0.15em] text-indigo-700">{c.code}</p>
                <button type="button" onClick={copy} className="mt-2 text-sm font-medium text-indigo-600 underline-offset-2 hover:underline">{copied ? "Copied" : "Copy code"}</button>
              </div>

              {!c.takesJobs && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{c.name} is not taking bookings in the app right now. You can still book, and UniteFix will send its own expert.</p>}

              <div className="mt-6 grid gap-3">
                {isAndroid() ? (
                  <a href={appLink(c.code)} className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-indigo-600 px-6 text-base font-semibold text-white shadow-sm transition active:scale-[0.98]">Book {c.name.split(" ")[0]} in the app</a>
                ) : null}
                <a href={PLAY} target="_blank" rel="noreferrer" className={`inline-flex min-h-[48px] items-center justify-center rounded-xl px-6 font-semibold transition active:scale-[0.98] ${isAndroid() ? "border border-slate-200 text-slate-700" : "bg-indigo-600 text-white"}`}>Get the UniteFix app</a>
              </div>
              <p className="mt-4 text-center text-sm text-slate-500">In the app, choose your service, then <span className="font-medium text-slate-700">Book via UniteFix</span> and enter <span className="font-mono font-semibold text-slate-700">{c.code}</span>. Same UniteFix price and guarantee.</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
