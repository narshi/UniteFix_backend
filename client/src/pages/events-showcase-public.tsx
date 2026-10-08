/**
 * /events/<partner code> — an events partner's showcase, and planning an event
 * from it: see their work (photos, Instagram), venues and themes, then build
 * the event — venue, theme, your own touches, add-ons like photography and
 * cakes — with a live estimate, and send it. The partner confirms the date and
 * sends the final quotation.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { addToPlan } from "@/pages/celebrations/plan-store";

type Pkg = { id: number; name: string; category: string; description: string | null; unit: string; price: number; gstRate: number; photos: string[]; capacity: number | null; maxQty: number | null };
type Theme = { id: number; name: string; description: string | null; suitableFor: string | null; photos: string[]; price: number; gstRate: number };
type Showcase = {
  name: string; city: string | null; phone: string | null; gstRegistered: boolean;
  profile: { tagline: string | null; about: string | null; coverPhoto: string | null; instagram: string | null };
  gallery: Array<{ id: number; kind: "photo" | "instagram"; url: string; embed: string | null; caption: string | null; themeId: number | null }>;
  venues: Pkg[]; themes: Theme[]; addons: Pkg[];
};

const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const CAT: Record<string, string> = { decor: "Décor", catering: "Catering", cake: "Cakes & desserts", av: "Sound & light", photography: "Photography", staff: "Staff", other: "More" };
const OCCASIONS = ["Birthday", "Wedding", "Engagement", "Baby shower", "Anniversary", "Corporate event"];
const per = (u: string) => (u === "event" ? "" : `/${u}`);

function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!src) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k);
  }, [src, onClose]);
  if (!src) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo" className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <img src={src} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
      <button className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white" onClick={onClose}>Close</button>
    </div>
  );
}

function Photos({ photos, alt, onOpen }: { photos: string[]; alt: string; onOpen: (u: string) => void }) {
  const [i, setI] = useState(0);
  if (!photos.length) return <div className="grid aspect-[16/10] place-items-center bg-white/[0.03] text-xs text-[hsl(215,20%,50%)]">No photos yet</div>;
  return (
    <div className="relative aspect-[16/10] overflow-hidden bg-black/20">
      <button className="h-full w-full" onClick={() => onOpen(photos[i])} aria-label={`View ${alt} photo`}><img src={photos[i]} alt={alt} className="h-full w-full object-cover" loading="lazy" /></button>
      {photos.length > 1 && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
          {photos.map((_, n) => <button key={n} aria-label={`Photo ${n + 1}`} onClick={() => setI(n)} className={`h-2 w-2 rounded-full ${n === i ? "bg-white" : "bg-white/40"}`} />)}
        </div>
      )}
    </div>
  );
}

export default function ShowcasePage({ code, fallback }: { code: string; fallback: React.ReactNode }) {
  const q = useQuery<Showcase>({ queryKey: ["/api/public/events/showcase", code], queryFn: async () => (await apiRequest("GET", `/api/public/events/${encodeURIComponent(code)}/showcase`)).data, retry: false });
  const [big, setBig] = useState<string | null>(null);
  const [filter, setFilter] = useState<number | null>(null);
  const planner = useRef<HTMLDivElement>(null);
  // the event being built
  const [occasion, setOccasion] = useState(""); const [date, setDate] = useState(""); const [guests, setGuests] = useState("");
  const [venueId, setVenueId] = useState<number | "own" | null>(null); const [ownVenue, setOwnVenue] = useState("");
  const [themeId, setThemeId] = useState<number | null>(null); const [custom, setCustom] = useState("");
  const [addons, setAddons] = useState<Record<number, number>>({});
  const [who, setWho] = useState({ name: "", phone: "", email: "" });
  const [sending, setSending] = useState(false); const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ link: string; total: number } | null>(null);

  const d = q.data;
  const g = Number(guests) || 0;
  const lines = useMemo(() => {
    if (!d) return [];
    const out: Array<{ name: string; detail: string; amount: number; gst: number }> = [];
    const v = typeof venueId === "number" ? d.venues.find(x => x.id === venueId) : null;
    if (v) out.push({ name: v.name, detail: "Venue", amount: v.price, gst: v.gstRate });
    const t = themeId ? d.themes.find(x => x.id === themeId) : null;
    if (t) out.push({ name: `${t.name} theme`, detail: t.price ? "Decoration" : "Included", amount: t.price, gst: t.gstRate });
    for (const a of d.addons) {
      if (!(a.id in addons)) continue;
      const qty = a.unit === "plate" ? g : a.unit === "event" ? 1 : addons[a.id];
      out.push({ name: a.name, detail: a.unit === "event" ? "" : `${qty} × ${rs(a.price)}${per(a.unit)}`, amount: a.price * qty, gst: a.gstRate });
    }
    return out;
  }, [d, venueId, themeId, addons, g]);
  const taxable = lines.reduce((s, l) => s + l.amount, 0);
  const gst = lines.reduce((s, l) => s + Math.round(l.amount * l.gst) / 100, 0);
  const venue = d && typeof venueId === "number" ? d.venues.find(x => x.id === venueId) : null;
  const tooMany = !!venue?.capacity && g > venue.capacity;
  const needsGuests = !!d?.addons.some(a => a.id in addons && a.unit === "plate") && !g;
  const ready = occasion.trim().length >= 2 && !!date && lines.length > 0 && !tooMany && !needsGuests && who.name.trim().length >= 2 && /^[6-9]\d{9}$/.test(who.phone) && (venueId !== "own" || ownVenue.trim().length >= 3);

  if (q.isError) return <>{fallback}</>;
  if (!d) return <div className="min-h-screen bg-surface-0 px-4 py-10"><p className="mx-auto max-w-5xl text-[hsl(215,20%,65%)]">Loading…</p></div>;
  if (!d.venues.length && !d.themes.length && !d.addons.length) return <>{fallback}</>;

  const pickVenue = (id: number) => { setVenueId(id); planner.current?.scrollIntoView({ behavior: "smooth" }); };
  const pickTheme = (id: number) => { setThemeId(id); planner.current?.scrollIntoView({ behavior: "smooth" }); };
  const send = async () => {
    setSending(true); setError(null);
    try {
      const r: any = await apiRequest("POST", `/api/public/events/${encodeURIComponent(code)}/request`, {
        name: who.name, phone: who.phone, email: who.email || null, eventType: occasion, eventDate: date, guests: g || null,
        venueId: typeof venueId === "number" ? venueId : null, ownVenue: venueId === "own" ? ownVenue : null, themeId, customization: custom || null,
        addons: Object.entries(addons).map(([id, qty]) => ({ packageId: Number(id), quantity: qty })),
      });
      setDone({ link: r.data.link, total: r.data.estimate.total });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError(apiErrorMessage(e)); } finally { setSending(false); }
  };

  const photos = d.gallery.filter(x => x.kind === "photo" && (filter === null || x.themeId === filter));
  const posts = d.gallery.filter(x => x.kind === "instagram" && (filter === null || x.themeId === filter));
  const taggedThemes = d.themes.filter(t => d.gallery.some(x => x.themeId === t.id));
  // The order clients think in: the camera, the cake, the food, then the rest.
  const ORDER = ["photography", "cake", "catering", "decor", "av", "staff", "other"];
  const groups = Array.from(new Set(d.addons.map(a => a.category))).sort((x, y) => (ORDER.indexOf(x) + 99) % 99 - (ORDER.indexOf(y) + 99) % 99);
  const field = "w-full rounded-lg border border-[rgba(255,255,255,0.12)] bg-white/[0.04] px-3 py-2.5 text-white placeholder:text-[hsl(215,20%,45%)] focus:border-[hsl(174,72%,50%)] focus:outline-none";
  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm ${on ? "border-[hsl(174,72%,50%)] bg-[hsla(174,72%,45%,0.15)] text-white" : "border-[rgba(255,255,255,0.12)] text-[hsl(215,20%,70%)] hover:text-white"}`;

  if (done) return (
    <div className="min-h-screen bg-surface-0 px-4 py-12">
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[hsla(160,84%,39%,0.15)] text-2xl text-[hsl(160,84%,60%)]">✓</div>
        <h1 className="mt-4 text-3xl font-semibold text-white">Request sent to {d.name}</h1>
        <p className="mt-2 text-[hsl(215,20%,72%)]">Your estimate was {rs(done.total)}. {d.name} will confirm the date and send your final quotation — you can accept it online and pay the advance.</p>
        <p className="mt-6 text-sm text-[hsl(215,20%,60%)]">Keep this link to follow your booking:</p>
        <a href={done.link} className="mt-1 inline-block break-all text-[hsl(174,72%,62%)] underline">{window.location.origin}{done.link}</a>
        {d.phone && <p className="mt-6 text-sm text-[hsl(215,20%,60%)]">Questions? Call {d.phone}.</p>}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface-0 pb-16">
      <Lightbox src={big} onClose={() => setBig(null)} />
      {/* Hero */}
      <header className="relative">
        <div className="h-64 w-full overflow-hidden bg-gradient-to-br from-[hsl(174,40%,18%)] to-[hsl(222,40%,12%)] sm:h-80">
          {d.profile.coverPhoto && <img src={d.profile.coverPhoto} alt="" className="h-full w-full object-cover opacity-70" />}
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[hsl(222,47%,6%)] to-transparent px-4 pb-6 pt-20">
          <div className="mx-auto max-w-5xl">
            <p className="text-xs font-mono uppercase tracking-widest text-[hsl(174,72%,60%)]">Events{d.city ? ` · ${d.city}` : ""}</p>
            <h1 className="mt-1 text-4xl font-semibold text-white">{d.name}</h1>
            {d.profile.tagline && <p className="mt-1 max-w-2xl text-lg text-[hsl(210,20%,85%)]">{d.profile.tagline}</p>}
          </div>
        </div>
      </header>

      <nav className="sticky top-0 z-20 border-b border-[rgba(255,255,255,0.06)] bg-[hsl(222,47%,6%)]/95 backdrop-blur" aria-label="Sections">
        <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 py-2 text-sm">
          {d.gallery.length > 0 && <a href="#work" className="whitespace-nowrap rounded-md px-3 py-1.5 text-[hsl(215,20%,72%)] hover:text-white">Our work</a>}
          {d.venues.length > 0 && <a href="#venues" className="whitespace-nowrap rounded-md px-3 py-1.5 text-[hsl(215,20%,72%)] hover:text-white">Venues</a>}
          {d.themes.length > 0 && <a href="#themes" className="whitespace-nowrap rounded-md px-3 py-1.5 text-[hsl(215,20%,72%)] hover:text-white">Themes</a>}
          <a href="#plan" className="ml-auto whitespace-nowrap rounded-md bg-[hsl(174,72%,38%)] px-3 py-1.5 font-medium text-white hover:bg-[hsl(174,72%,33%)]">Plan your event</a>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl space-y-14 px-4 pt-8">
        {(d.profile.about || d.profile.instagram) && (
          <section className="max-w-3xl">
            {d.profile.about && <p className="whitespace-pre-line text-[hsl(210,20%,82%)]">{d.profile.about}</p>}
            {d.profile.instagram && <a href={`https://www.instagram.com/${d.profile.instagram}/`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[hsl(330,75%,70%)] hover:text-white">@{d.profile.instagram} on Instagram ↗</a>}
          </section>
        )}

        {d.gallery.length > 0 && (
          <section id="work" aria-labelledby="h-work" className="scroll-mt-16">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="h-work" className="text-2xl font-semibold text-white">Our work</h2>
              {taggedThemes.length > 0 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by theme">
                  <button className={chip(filter === null)} onClick={() => setFilter(null)}>All</button>
                  {taggedThemes.map(t => <button key={t.id} className={chip(filter === t.id)} onClick={() => setFilter(t.id)}>{t.name}</button>)}
                </div>
              )}
            </div>
            {photos.length > 0 && (
              <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {photos.map(p => (
                  <li key={p.id}><button className="block aspect-square w-full overflow-hidden rounded-lg" onClick={() => setBig(p.url)} aria-label={p.caption ?? "View photo"}>
                    <img src={p.url} alt={p.caption ?? ""} className="h-full w-full object-cover transition-transform duration-300 hover:scale-105" loading="lazy" />
                  </button></li>
                ))}
              </ul>
            )}
            {posts.length > 0 && (
              <>
                <h3 className="mt-8 text-lg font-semibold text-white">On Instagram</h3>
                <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
                  {posts.map(p => (
                    <div key={p.id} className="w-[326px] shrink-0">
                      <iframe src={p.embed ?? undefined} title={p.caption ?? "Instagram post"} className="h-[560px] w-full rounded-lg border-0 bg-white" loading="lazy" allowTransparency scrolling="no" />
                      {/* If a post is removed or made private the frame stays blank; the link still says where it was. */}
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-[hsl(330,75%,70%)] hover:text-white">View on Instagram ↗</a>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {d.venues.length > 0 && (
          <section id="venues" aria-labelledby="h-venues" className="scroll-mt-16">
            <h2 id="h-venues" className="text-2xl font-semibold text-white">Venues</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {d.venues.map(v => (
                <li key={v.id} className={`overflow-hidden rounded-xl border bg-white/[0.02] ${venueId === v.id ? "border-[hsl(174,72%,50%)]" : "border-[rgba(255,255,255,0.08)]"}`}>
                  <Photos photos={v.photos} alt={v.name} onOpen={setBig} />
                  <div className="p-4">
                    <div className="flex items-baseline justify-between gap-2"><h3 className="font-semibold text-white">{v.name}</h3><span className="tabular-nums text-white">{rs(v.price)}<span className="text-xs text-[hsl(215,20%,55%)]">{per(v.unit)}</span></span></div>
                    {v.capacity && <p className="text-sm text-[hsl(215,20%,65%)]">Up to {v.capacity} guests</p>}
                    {v.description && <p className="mt-1 text-sm text-[hsl(215,20%,70%)]">{v.description}</p>}
                    <button className="mt-3 w-full rounded-lg border border-[rgba(255,255,255,0.15)] py-2 text-sm text-white hover:bg-white/5" onClick={() => pickVenue(v.id)}>{venueId === v.id ? "✓ Chosen" : "Choose this venue"}</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {d.themes.length > 0 && (
          <section id="themes" aria-labelledby="h-themes" className="scroll-mt-16">
            <h2 id="h-themes" className="text-2xl font-semibold text-white">Themes</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {d.themes.map(t => (
                <li key={t.id} className={`overflow-hidden rounded-xl border bg-white/[0.02] ${themeId === t.id ? "border-[hsl(174,72%,50%)]" : "border-[rgba(255,255,255,0.08)]"}`}>
                  <Photos photos={t.photos} alt={t.name} onOpen={setBig} />
                  <div className="p-4">
                    <div className="flex items-baseline justify-between gap-2"><h3 className="font-semibold text-white">{t.name}</h3><span className="tabular-nums text-white">{t.price ? rs(t.price) : "Included"}</span></div>
                    {t.suitableFor && <p className="text-sm text-[hsl(215,20%,65%)]">{t.suitableFor}</p>}
                    {t.description && <p className="mt-1 text-sm text-[hsl(215,20%,70%)]">{t.description}</p>}
                    <button className="mt-3 w-full rounded-lg border border-[rgba(255,255,255,0.15)] py-2 text-sm text-white hover:bg-white/5" onClick={() => pickTheme(t.id)}>{themeId === t.id ? "✓ Chosen" : "Choose this theme"}</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Planner */}
        <section id="plan" ref={planner} aria-labelledby="h-plan" className="scroll-mt-16">
          <h2 id="h-plan" className="text-2xl font-semibold text-white">Plan your event</h2>
          <p className="mt-1 text-[hsl(215,20%,65%)]">Build it the way you want and see the estimate as you go. {d.name} confirms the date and sends the final quotation.</p>
          <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0 space-y-8">
              <fieldset className="space-y-3">
                <legend className="mb-2 font-semibold text-white">1 · The occasion</legend>
                <div className="flex flex-wrap gap-2">{OCCASIONS.map(o => <button key={o} type="button" className={chip(occasion === o)} onClick={() => setOccasion(o)}>{o}</button>)}</div>
                <input aria-label="Occasion" className={field} placeholder="Or type it — e.g. 1st birthday" value={occasion} onChange={e => setOccasion(e.target.value)} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-[hsl(215,20%,70%)]">Date<input type="date" min={today()} className={`${field} mt-1`} value={date} onChange={e => setDate(e.target.value)} /></label>
                  <label className="text-sm text-[hsl(215,20%,70%)]">Guests<input inputMode="numeric" className={`${field} mt-1`} placeholder="e.g. 80" value={guests} onChange={e => setGuests(e.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-3 font-semibold text-white">2 · Venue</legend>
                <div className="grid gap-2">
                  {d.venues.map(v => (
                    <label key={v.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${venueId === v.id ? "border-[hsl(174,72%,50%)] bg-[hsla(174,72%,45%,0.08)]" : "border-[rgba(255,255,255,0.1)]"}`}>
                      <input type="radio" name="venue" checked={venueId === v.id} onChange={() => setVenueId(v.id)} className="accent-[hsl(174,72%,45%)]" />
                      {v.photos[0] && <img src={v.photos[0]} alt="" className="h-12 w-16 rounded object-cover" />}
                      <span className="min-w-0 flex-1"><span className="block text-white">{v.name}</span>{v.capacity && <span className="text-xs text-[hsl(215,20%,60%)]">up to {v.capacity} guests</span>}</span>
                      <span className="tabular-nums text-white">{rs(v.price)}</span>
                    </label>
                  ))}
                  <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${venueId === "own" ? "border-[hsl(174,72%,50%)] bg-[hsla(174,72%,45%,0.08)]" : "border-[rgba(255,255,255,0.1)]"}`}>
                    <input type="radio" name="venue" checked={venueId === "own"} onChange={() => setVenueId("own")} className="accent-[hsl(174,72%,45%)]" />
                    <span className="text-white">At my place / another venue</span>
                  </label>
                  {venueId === "own" && <input aria-label="Your venue" className={field} placeholder="Address or venue name" value={ownVenue} onChange={e => setOwnVenue(e.target.value)} />}
                  {tooMany && <p className="text-sm text-amber-300">{venue!.name} holds up to {venue!.capacity} guests.</p>}
                </div>
              </fieldset>

              {d.themes.length > 0 && (
                <fieldset>
                  <legend className="mb-3 font-semibold text-white">3 · Theme</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {d.themes.map(t => (
                      <button type="button" key={t.id} onClick={() => setThemeId(themeId === t.id ? null : t.id)} aria-pressed={themeId === t.id}
                        className={`overflow-hidden rounded-lg border text-left ${themeId === t.id ? "border-[hsl(174,72%,50%)] ring-1 ring-[hsl(174,72%,50%)]" : "border-[rgba(255,255,255,0.1)]"}`}>
                        <div className="aspect-[4/3] bg-white/[0.03]">{t.photos[0] && <img src={t.photos[0]} alt="" className="h-full w-full object-cover" loading="lazy" />}</div>
                        <div className="p-2"><span className="block text-sm text-white">{t.name}</span><span className="text-xs text-[hsl(215,20%,60%)]">{t.price ? rs(t.price) : "Included"}</span></div>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-[hsl(215,20%,55%)]">Tap again to clear. Not sure? Leave it — {d.name} can suggest one.</p>
                </fieldset>
              )}

              <fieldset>
                <legend className="mb-2 font-semibold text-white">{d.themes.length ? "4" : "3"} · Make it yours</legend>
                <textarea aria-label="Your ideas" rows={3} className={field} placeholder="Colours, the name on the backdrop, a character, music, anything special" value={custom} onChange={e => setCustom(e.target.value)} />
              </fieldset>

              {d.addons.length > 0 && (
                <fieldset>
                  <legend className="mb-3 font-semibold text-white">{d.themes.length ? "5" : "4"} · Add-ons</legend>
                  <div className="space-y-5">
                    {groups.map(c => (
                      <div key={c}>
                        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[hsl(215,20%,55%)]">{CAT[c] ?? c}</p>
                        <div className="grid gap-2">
                          {d.addons.filter(a => a.category === c).map(a => {
                            const on = a.id in addons;
                            const max = a.maxQty ?? 50;
                            return (
                              <div key={a.id} className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${on ? "border-[hsl(174,72%,50%)] bg-[hsla(174,72%,45%,0.08)]" : "border-[rgba(255,255,255,0.1)]"}`}>
                                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                                  <input type="checkbox" className="mt-1 accent-[hsl(174,72%,45%)]" checked={on} onChange={e => setAddons(x => { const n = { ...x }; if (e.target.checked) n[a.id] = 1; else delete n[a.id]; return n; })} />
                                  {a.photos[0] && <img src={a.photos[0]} alt="" className="h-12 w-12 rounded object-cover" />}
                                  <span className="min-w-0"><span className="block text-white">{a.name}</span>{a.description && <span className="block text-xs text-[hsl(215,20%,62%)]">{a.description}</span>}
                                    <span className="text-xs text-[hsl(215,20%,55%)]">{rs(a.price)}{a.unit === "plate" ? " per guest" : per(a.unit)}</span></span>
                                </label>
                                {on && !["event", "plate"].includes(a.unit) && (
                                  <div className="flex items-center rounded-full border border-[rgba(255,255,255,0.15)]">
                                    <button type="button" aria-label="One less" className="h-9 w-9 text-white disabled:opacity-30" disabled={addons[a.id] <= 1} onClick={() => setAddons(x => ({ ...x, [a.id]: x[a.id] - 1 }))}>−</button>
                                    <span className="min-w-[2ch] text-center tabular-nums text-white">{addons[a.id]}</span>
                                    <button type="button" aria-label="One more" className="h-9 w-9 text-white disabled:opacity-30" disabled={addons[a.id] >= max} onClick={() => setAddons(x => ({ ...x, [a.id]: x[a.id] + 1 }))}>+</button>
                                  </div>
                                )}
                                {on && a.unit === "plate" && <span className="text-sm tabular-nums text-white">{g ? `${g} × ${rs(a.price)}` : "Enter guests"}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </fieldset>
              )}

              <fieldset className="space-y-3">
                <legend className="mb-2 font-semibold text-white">Your details</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input aria-label="Your name" autoComplete="name" className={field} placeholder="Your name" value={who.name} onChange={e => setWho({ ...who, name: e.target.value })} />
                  <input aria-label="Mobile number" inputMode="numeric" autoComplete="tel-national" className={field} placeholder="Mobile number" value={who.phone} onChange={e => setWho({ ...who, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
                </div>
                <input aria-label="Email" type="email" autoComplete="email" className={field} placeholder="Email (optional)" value={who.email} onChange={e => setWho({ ...who, email: e.target.value })} />
              </fieldset>
            </div>

            {/* Estimate */}
            <aside className="lg:sticky lg:top-16 lg:self-start" aria-labelledby="h-est">
              <div className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-white/[0.03] p-5">
                <h3 id="h-est" className="font-semibold text-white">Your estimate</h3>
                {!lines.length ? <p className="mt-2 text-sm text-[hsl(215,20%,60%)]">Choose a venue, a theme or add-ons to see the cost.</p> : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {lines.map((l, n) => (
                      <li key={n} className="flex justify-between gap-3"><span className="min-w-0 text-[hsl(210,20%,85%)]">{l.name}{l.detail && <span className="block text-xs text-[hsl(215,20%,55%)]">{l.detail}</span>}</span><span className="tabular-nums text-white">{rs(l.amount)}</span></li>
                    ))}
                  </ul>
                )}
                {lines.length > 0 && (
                  <div className="mt-4 space-y-1 border-t border-[rgba(255,255,255,0.08)] pt-3 text-sm">
                    {gst > 0 && <><div className="flex justify-between text-[hsl(215,20%,65%)]"><span>Before GST</span><span className="tabular-nums">{rs(taxable)}</span></div>
                      <div className="flex justify-between text-[hsl(215,20%,65%)]"><span>GST</span><span className="tabular-nums">{rs(gst)}</span></div></>}
                    <div className="flex justify-between pt-1 text-lg font-semibold text-white"><span>Total</span><span className="tabular-nums">{rs(taxable + gst)}</span></div>
                  </div>
                )}
                {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
                <button disabled={!ready || sending} onClick={send} className="mt-4 w-full rounded-lg bg-[hsl(174,72%,38%)] py-3 font-medium text-white hover:bg-[hsl(174,72%,33%)] disabled:cursor-not-allowed disabled:opacity-40">
                  {sending ? "Sending…" : "Send booking request"}
                </button>
                {date && lines.length > 0 && (
                  <button className="mt-2 w-full rounded-lg border border-[rgba(255,255,255,0.15)] py-2.5 text-sm text-white hover:bg-white/5" onClick={() => {
                    addToPlan({ type: "planner", code, name: d.name, date, detail: lines.map(l => l.name).slice(0, 3).join(", "), photo: d.profile.coverPhoto ?? d.gallery.find(x => x.kind === "photo")?.url ?? null,
                      payload: { venueId: typeof venueId === "number" ? venueId : null, ownVenue: venueId === "own" ? ownVenue : null, themeId, customization: custom || null, addons: Object.entries(addons).map(([id, qty]) => ({ packageId: Number(id), quantity: qty })) },
                      estimate: taxable + gst, guests: g || null, occasion: occasion || null });
                    window.location.href = "/celebrations/plan";
                  }}>Add to my plan — book with a hall and photographer</button>
                )}
                <p className="mt-2 text-xs text-[hsl(215,20%,55%)]">
                  {!occasion.trim() || !date ? "Add the occasion and date." : !lines.length ? "Choose at least a venue, theme or add-on." : needsGuests ? "Enter the number of guests." : tooMany ? "Too many guests for this venue." : venueId === "own" && ownVenue.trim().length < 3 ? "Add your venue." : !(who.name.trim().length >= 2 && /^[6-9]\d{9}$/.test(who.phone)) ? "Add your name and mobile number." : "Nothing is charged now. You get the final quotation to accept."}
                </p>
              </div>
            </aside>
          </div>
        </section>
      </main>
      <footer className="mt-16 text-center text-xs text-[hsl(215,20%,50%)]">Through UniteFix Partner Hub{d.phone ? ` · ${d.phone}` : ""}</footer>
    </div>
  );
}
