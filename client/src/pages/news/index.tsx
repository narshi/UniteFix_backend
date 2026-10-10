/**
 * Newspapers on the web.
 *
 *   /news/e/:token   a shared edition: the paper, the date and the top half of
 *                    page one, fading out — then "read the rest in the app"
 *   /news/p/:code    a paper's follow page (the link and QR code papers post)
 *   /news/read/:id   the full reader, opened only from the app with a signed,
 *                    expiring link
 *
 * Newsprint rather than dashboard: warm paper, black ink, a serif masthead
 * face that also covers Kannada and Devanagari.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const PLAY = "https://play.google.com/store/apps/details?id=com.unitefix.app";
const serif = { fontFamily: '"Noto Serif", "Noto Serif Kannada", "Noto Serif Devanagari", Georgia, serif' } as const;
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const longDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export const isNewsPath = (p: string) => /^\/news\/(e|p|read)\//.test(p);

type SharedEdition = {
  id: number; paper: string; logoUrl: string | null; language: string; languageLabel: string; city: string | null; editionDate: string; title: string;
  headline: string | null; pageCount: number; previewUrl: string | null; available: boolean; paperCode: string;
};
type PublicPaper = {
  id: number; code: string | null; name: string; languageLabel: string; city: string | null; frequency: string; description: string | null; logoUrl: string | null; followers: number;
  keepsDays: number; editions: Array<{ id: number; editionDate: string; title: string; headline: string | null; pageCount: number; previewUrl: string | null; shareUrl: string }>;
};

const platform = () => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && "ontouchend" in document) ? "ios" : "desktop";
};
/** Opens the app at this place when it is installed; otherwise Android goes to the Play Store. */
const appLink = (path: string) => `intent://${path}#Intent;scheme=unitefix;package=com.unitefix.app;S.browser_fallback_url=${encodeURIComponent(PLAY)};end`;

function useNewsFonts() {
  useEffect(() => {
    if (document.getElementById("uf-news-font")) return;
    const l = document.createElement("link");
    l.id = "uf-news-font"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Noto+Serif:wght@400;600;700&family=Noto+Serif+Kannada:wght@500;700&display=swap";
    document.head.appendChild(l);
  }, []);
}

function useJson<T>(url: string) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let on = true;
    fetch(url).then(async r => {
      const b = await r.json().catch(() => null);
      if (!on) return;
      if (!r.ok) setState({ loading: false, error: b?.message ?? "Not found" }); else setState({ loading: false, data: b.data });
    }).catch(() => on && setState({ loading: false, error: "Could not load. Check your connection." }));
    return () => { on = false; };
  }, [url]);
  return state;
}

function Shell({ children }: { children: ReactNode }) {
  useNewsFonts();
  useEffect(() => { const prev = document.body.style.background; document.body.style.background = "#F5F1E8"; return () => { document.body.style.background = prev; }; }, []);
  return (
    <div className="min-h-screen bg-[#F5F1E8] text-[#16130F] antialiased">
      <header className="border-b-2 border-[#16130F]" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto flex h-12 max-w-2xl items-center justify-between gap-3 px-4">
          <a href="https://unitefix.com" className="flex items-baseline gap-2"><span className="text-lg font-bold tracking-tight" style={serif}>UniteFix</span><span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#A3271F]">News</span></a>
          <span className="text-xs text-[#6B6358]">Your local papers, free</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-16">{children}</main>
    </div>
  );
}

function Masthead({ name, logoUrl, line }: { name: string; logoUrl: string | null; line: ReactNode }) {
  return (
    <div className="border-b border-[#16130F]/20 py-5 text-center">
      {logoUrl ? <img src={logoUrl} alt={name} className="mx-auto max-h-20 max-w-full object-contain" /> : null}
      <h1 className={`${logoUrl ? "mt-2 text-lg" : "text-3xl"} font-bold leading-tight`} style={{ ...serif, textWrap: "balance" as any }}>{name}</h1>
      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[#6B6358]">{line}</p>
    </div>
  );
}

function InstallCard({ title, body, path }: { title: string; body: ReactNode; path: string }) {
  const os = platform();
  return (
    <section className="rounded-xl border-2 border-[#16130F] bg-white p-5 shadow-[4px_4px_0_#16130F]">
      <h2 className="text-xl font-bold leading-snug" style={serif}>{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-[#3D372F]">{body}</div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {os === "android"
          ? <a href={appLink(path)} className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-[#A3271F] px-5 text-base font-semibold text-white">Open in the UniteFix app</a>
          : os === "ios"
            // No iPhone app yet: say so rather than send them to a store they cannot use.
            ? <a href={PLAY} target="_blank" rel="noreferrer" className="inline-flex min-h-[48px] items-center justify-center rounded-lg border border-[#16130F]/30 px-5 text-sm font-medium">Android phone? Get it on Google Play</a>
            : <a href={PLAY} target="_blank" rel="noreferrer" className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-[#A3271F] px-5 text-base font-semibold text-white">Install the UniteFix app</a>}
        {os === "android" && <a href={PLAY} className="inline-flex min-h-[48px] items-center justify-center rounded-lg border border-[#16130F]/30 px-5 text-sm font-medium">Get it on Google Play</a>}
      </div>
      <p className="mt-3 text-xs text-[#6B6358]">
        {os === "ios" ? "The UniteFix app is on Android today; the iPhone app is on its way. Share this link with someone on Android to read it now." : "Free to read. Sign in with your phone number."}
      </p>
    </section>
  );
}

function Missing({ text }: { text: string }) {
  return <div className="py-20 text-center"><p className="text-lg" style={serif}>{text}</p><a href={PLAY} className="mt-4 inline-block text-sm text-[#A3271F] underline">Get the UniteFix app</a></div>;
}

// ── a shared edition ──────────────────────────────────────────────────────

function SharedEditionPage({ token }: { token: string }) {
  const { data: e, error, loading } = useJson<SharedEdition>(`/api/public/news/e/${encodeURIComponent(token)}`);
  useEffect(() => { if (e) document.title = `${e.paper} — ${longDay(e.editionDate)}`; }, [e]);
  if (loading) return <Shell><p className="py-20 text-center text-[#6B6358]">Loading…</p></Shell>;
  if (error || !e) return <Shell><Missing text="This link is not valid any more." /></Shell>;
  const rest = Math.max(0, e.pageCount - 1);
  return (
    <Shell>
      <Masthead name={e.paper} logoUrl={e.logoUrl} line={<>{longDay(e.editionDate)}{e.title !== "Main edition" ? ` · ${e.title}` : ""}{e.city ? ` · ${e.city}` : ""}</>} />
      {e.headline && <p className="pt-4 text-center text-lg font-semibold leading-snug" style={{ ...serif, textWrap: "balance" as any }}>{e.headline}</p>}
      {e.available && e.previewUrl ? (
        <div className="relative mt-4 overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/10">
          <img src={e.previewUrl} alt={`The top half of page one of ${e.paper}`} className="block w-full select-none" draggable={false} onContextMenu={ev => ev.preventDefault()} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-b from-transparent via-[#F5F1E8]/85 to-[#F5F1E8]" />
        </div>
      ) : (
        <p className="mt-6 rounded-lg border border-[#16130F]/15 bg-white p-4 text-sm text-[#3D372F]">
          {e.available ? "This edition is ready to read in the app." : `This edition is no longer kept. The latest ${e.paper} is in the UniteFix app.`}
        </p>
      )}
      <div className="relative -mt-16">
        <InstallCard
          title={e.available ? `Read all ${e.pageCount} page${e.pageCount === 1 ? "" : "s"} free on UniteFix` : `Read today's ${e.paper} on UniteFix`}
          path={e.available ? `news/e/${token}` : `news/p/${e.paperCode}`}
          body={<>{e.available && rest > 0 ? <>You are seeing half of the front page. </> : null}Install the UniteFix app to read the whole paper, follow <b>{e.paper}</b> and get every new edition the moment it comes out.</>}
        />
      </div>
      <p className="mt-6 text-center text-xs text-[#6B6358]">Published by {e.paper} · {e.languageLabel}. UniteFix carries it with the publisher's permission.</p>
    </Shell>
  );
}

// ── a paper's follow page ─────────────────────────────────────────────────

function PaperPage({ code }: { code: string }) {
  const { data: p, error, loading } = useJson<PublicPaper>(`/api/public/news/p/${encodeURIComponent(code)}`);
  useEffect(() => { if (p) document.title = `${p.name} on UniteFix`; }, [p]);
  if (loading) return <Shell><p className="py-20 text-center text-[#6B6358]">Loading…</p></Shell>;
  if (error || !p) return <Shell><Missing text="This paper is not on UniteFix." /></Shell>;
  const latest = p.editions[0];
  return (
    <Shell>
      <Masthead name={p.name} logoUrl={p.logoUrl} line={<>{p.languageLabel}{p.city ? ` · ${p.city}` : ""} · {p.frequency}</>} />
      {p.description && <p className="pt-4 text-center leading-relaxed text-[#3D372F]" style={{ textWrap: "pretty" as any }}>{p.description}</p>}
      {latest?.previewUrl && (
        <a href={latest.shareUrl} className="relative mt-5 block overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/10">
          <img src={latest.previewUrl} alt={`Front page, ${longDay(latest.editionDate)}`} className="block max-h-80 w-full object-cover object-top" />
          <span className="absolute left-2 top-2 rounded bg-[#16130F] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">{latest.editionDate === istToday() ? "Today" : longDay(latest.editionDate)}</span>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-[#F5F1E8]" />
        </a>
      )}
      <div className="mt-5">
        <InstallCard title={`Follow ${p.name} on UniteFix`} path={`news/p/${code}`}
          body={<>Every edition in the app, free — with a notification the moment it comes out. {p.followers >= 25 ? <>{p.followers.toLocaleString("en-IN")} readers already follow.</> : null}</>} />
      </div>
    </Shell>
  );
}

// ── the full reader (inside the app) ──────────────────────────────────────

function ReaderPage({ id }: { id: string }) {
  const qs = new URLSearchParams(window.location.search);
  const src = `/api/public/news/file/${encodeURIComponent(id)}?exp=${encodeURIComponent(qs.get("exp") ?? "")}&sig=${encodeURIComponent(qs.get("sig") ?? "")}`;
  const [doc, setDoc] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const inApp = typeof window !== "undefined" && !!(window as any).ReactNativeWebView;
  useEffect(() => {
    document.body.style.background = "#3A3631";
    let gone = false, d: any = null;
    (async () => {
      try {
        const { pdfjs, PDF_OPTIONS } = await import("@/lib/pdf");
        const lib = await pdfjs();
        const task = lib.getDocument({ url: src, ...PDF_OPTIONS, disableRange: true });
        task.onProgress = (p: { loaded: number; total: number }) => p.total && setProgress(Math.round((p.loaded / p.total) * 100));
        d = await task.promise;
        if (gone) { void d.destroy(); return; }
        setDoc(d);
      } catch (e: any) {
        if (gone) return;
        setError(e?.status === 403 ? "This reading link has expired. Go back and open the edition again."
          : e?.status === 410 || e?.status === 404 ? "This edition is no longer available."
          : "The edition could not be opened. Check your connection and try again.");
      }
    })();
    return () => { gone = true; if (d) void d.destroy(); };
  }, [src]);
  const post = (msg: object) => { try { (window as any).ReactNativeWebView?.postMessage(JSON.stringify(msg)); } catch { /* not in the app */ } };
  useEffect(() => { if (doc) post({ type: "pages", pages: doc.numPages }); }, [doc]);
  useEffect(() => { if (doc) post({ type: "page", page }); }, [page, doc]);
  if (error) return <div className="grid min-h-screen place-items-center bg-[#3A3631] p-6 text-center text-white"><p className="max-w-xs">{error}</p></div>;
  if (!doc) return (
    <div className="grid min-h-screen place-items-center bg-[#3A3631] p-6 text-center text-white">
      <div><p>Opening the paper…</p><div className="mx-auto mt-3 h-1.5 w-48 overflow-hidden rounded bg-white/20"><div className="h-full bg-white transition-all" style={{ width: `${Math.max(5, progress)}%` }} /></div></div>
    </div>
  );
  return (
    <div className="min-h-screen bg-[#3A3631] pb-24">
      <div className={zoom > 1 ? "overflow-x-auto" : ""}>
        <div className="mx-auto flex flex-col items-center gap-3 py-3" style={{ width: `${zoom * 100}%`, maxWidth: zoom > 1 ? "none" : 1100 }}>
          {Array.from({ length: doc.numPages }, (_, i) => <ReaderPageCanvas key={i} doc={doc} n={i + 1} zoom={zoom} onSeen={setPage} />)}
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-4 pt-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
        {!inApp && <span className="rounded-full bg-black/60 px-3 py-1.5 text-sm tabular-nums text-white">Page {page} of {doc.numPages}</span>}
        <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - 0.5))} className="grid h-10 w-10 place-items-center rounded-full bg-black/60 text-xl text-white disabled:opacity-40">−</button>
        <button type="button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + 0.5))} className="grid h-10 w-10 place-items-center rounded-full bg-black/60 text-xl text-white disabled:opacity-40">+</button>
      </div>
    </div>
  );
}

/** One page: drawn when it comes near the screen, released when it is far away, so a 20-page paper fits in a phone's memory. */
function ReaderPageCanvas({ doc, n, zoom, onSeen }: { doc: any; n: number; zoom: number; onSeen: (n: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.75);
  const [near, setNear] = useState(n <= 2);
  const drawn = useRef<string | null>(null);
  const [shown, setShown] = useState(false);
  const task = useRef<any>(null);
  useEffect(() => { doc.getPage(n).then((p: any) => { const v = p.getViewport({ scale: 1 }); setRatio(v.height / v.width); }); }, [doc, n]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const near = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: "150% 0px" });
    const seen = new IntersectionObserver(([e]) => { if (e.isIntersecting) onSeen(n); }, { threshold: 0.35 });
    near.observe(el); seen.observe(el);
    return () => { near.disconnect(); seen.disconnect(); };
  }, [n, onSeen]);
  const draw = useCallback(async () => {
    const el = box.current, c = canvas.current; if (!el || !c) return;
    const width = el.clientWidth;
    const key = `${width}:${zoom}`;
    if (drawn.current === key) return;
    task.current?.cancel?.();
    const p = await doc.getPage(n);
    const base = p.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const vp = p.getViewport({ scale: Math.min((width / base.width) * dpr, 2400 / base.width) });
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    try { task.current = p.render({ canvasContext: c.getContext("2d")!, viewport: vp }); await task.current.promise; drawn.current = key; setShown(true); }
    catch { /* cancelled by a newer draw */ }
  }, [doc, n, zoom]);
  useEffect(() => {
    if (near) void draw();
    else if (canvas.current && drawn.current) { task.current?.cancel?.(); canvas.current.width = 0; canvas.current.height = 0; drawn.current = null; setShown(false); }
  }, [near, draw]);
  return (
    <div ref={box} className="relative w-full bg-white shadow-lg" style={{ aspectRatio: `1 / ${ratio}` }}>
      {!shown && <span className="absolute inset-0 grid place-items-center text-sm text-slate-400">Page {n}</span>}
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-label={`Page ${n}`} />
    </div>
  );
}

export default function NewsRouter() {
  const path = window.location.pathname;
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/news\/e\/([^/]+)/))) return <SharedEditionPage token={decodeURIComponent(m[1])} />;
  if ((m = path.match(/^\/news\/p\/([^/]+)/))) return <PaperPage code={decodeURIComponent(m[1])} />;
  if ((m = path.match(/^\/news\/read\/(\d+)/))) return <ReaderPage id={m[1]} />;
  return <Shell><Missing text="Page not found." /></Shell>;
}
