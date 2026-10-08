/**
 * /photographers/<code> — a photographer's portfolio: the reel, their best
 * work in a mosaic, albums told as stories, films, packages and reviews; and
 * asking for a date. The date is held for them while the photographer sends
 * a quotation of exactly what was chosen.
 *
 * /photographers/<code>/albums/<id> — one album, every photo and film.
 * ?preview=1 / ?preview=admin&bp=<id> as for halls.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { ALBUM_CATEGORIES, OCCASIONS, SLOT_LABEL, cancellationText } from "@shared/celebrations";
import { C, display, rs, niceDate, istToday, Shell, SectionTitle, Lightbox, VideoEmbed, Reviews, NotFoundCard, Loading, btnPrimary, btnAccent, btnGhost, field, labelCls, type ReviewsData } from "@/components/celebrations/kit";
import { addToPlan } from "@/pages/celebrations/plan-store";

type Media = { id: number; albumId: number; kind: "photo" | "video" | "embed"; url: string; thumb: string | null; embed: string | null; provider: string | null; width: number | null; height: number | null; caption: string | null; featured: boolean };
type Album = { id: number; title: string; story: string | null; location: string | null; eventDate: string | null; category: string; cover: string | null; photos: number; videos: number };
type Pkg = { id: number; name: string; category: string; description: string | null; unit: string; price: number; gstRate: number; photos: string[]; maxQty: number | null };
type Portfolio = {
  code: string; name: string; city: string | null; phone: string | null; preview?: boolean;
  profile: { tagline: string | null; about: string | null; coverPhoto: string | null; coverVideo: { url: string; poster: string | null } | null; styles: string[]; travelAreas: string[]; languages: string[]; since: number | null; instagram: string | null; youtube: string | null; deliveryDays: number | null };
  policies: { advancePercent: number; balanceDueDays: number; cancellation: Array<{ daysBefore: number; refundPercent: number }>; holdHours: number };
  stats: { albums: number; photos: number; films: number };
  featured: Media[]; films: Media[]; albums: Album[]; packages: Pkg[]; addons: Pkg[]; reviews: ReviewsData;
};
type Slot = "am" | "pm" | "full";
const catLabel = (c: string) => ALBUM_CATEGORIES.find(x => x[0] === c)?.[1] ?? "Story";
const monthAdd = (m: string, n: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const unitText = (u: string) => (u === "event" ? "" : u === "day" ? " / day" : u === "hour" ? " / hour" : ` / ${u}`);
const lbItems = (m: Media[]) => m.map(x => ({ src: x.kind === "photo" ? x.url : x.kind === "video" ? x.url : x.thumb ?? "", caption: x.caption, kind: x.kind, embed: x.embed }));

/** Masonry by columns: photos keep their own shape, as a photographer framed them. */
function Mosaic({ items, onOpen }: { items: Media[]; onOpen: (i: number) => void }) {
  return (
    <div className="columns-2 gap-3 sm:columns-3 [&>*]:mb-3">
      {items.map((m, i) => (
        <button key={m.id} onClick={() => onOpen(i)} className="group relative block w-full overflow-hidden rounded-xl bg-[#EFE6DB] break-inside-avoid" aria-label={m.caption ?? `Open ${m.kind === "photo" ? "photo" : "film"} ${i + 1}`}>
          {m.kind === "photo" ? <img src={m.url} alt={m.caption ?? ""} loading="lazy" className="w-full object-cover transition duration-700 group-hover:scale-[1.03]" style={m.width && m.height ? { aspectRatio: `${m.width}/${m.height}` } : undefined} />
            : m.kind === "video" ? <video src={m.url} poster={m.thumb ?? undefined} muted playsInline loop preload="none" className="w-full" onMouseEnter={e => (e.currentTarget as HTMLVideoElement).play().catch(() => undefined)} onMouseLeave={e => (e.currentTarget as HTMLVideoElement).pause()} />
            : <div className="relative aspect-video w-full bg-[#1d1611]">{m.thumb && <img src={m.thumb} alt="" className="h-full w-full object-cover opacity-90" loading="lazy" />}</div>}
          {m.kind !== "photo" && <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">▶ Film</span>}
          {m.caption && <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 text-left text-sm text-white opacity-0 transition group-hover:opacity-100">{m.caption}</span>}
        </button>
      ))}
    </div>
  );
}

function useSource(path: string, admin: string) {
  const qs = new URLSearchParams(window.location.search);
  const preview = qs.get("preview");
  const url = preview === "admin" ? `/api/admin/hub/celebrations/listings/${encodeURIComponent(qs.get("bp") ?? "")}/portfolio/preview` : preview ? admin : path;
  return { preview: !!preview, q: useQuery<any>({ queryKey: [url], queryFn: async () => { const r = (await apiRequest("GET", url)).data; return r.page ?? r; }, retry: false }) };
}

export default function PhotographerPage({ code }: { code: string }) {
  const { preview, q } = useSource(`/api/public/photographers/${encodeURIComponent(code)}`, "/api/hub/portfolio/preview");
  const d = q.data as Portfolio | undefined;
  const [lb, setLb] = useState<{ items: ReturnType<typeof lbItems>; i: number } | null>(null);
  const ask = useRef<HTMLDivElement>(null);
  const [pkgId, setPkgId] = useState<number | null>(null);
  const [extras, setExtras] = useState<Record<number, number>>({});
  const initial = useMemo(() => { const q = new URLSearchParams(window.location.search); const d = q.get("date"); return { date: d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d > istToday() ? d : null, guests: (q.get("guests") ?? "").replace(/\D/g, "") }; }, []);
  const [month, setMonth] = useState((initial.date ?? istToday()).slice(0, 7));
  const [date, setDate] = useState<string | null>(initial.date);
  const [slot, setSlot] = useState<Slot>("full");
  const [days, setDays] = useState(1);
  const [hours, setHours] = useState(4);
  const [occasion, setOccasion] = useState("");
  const [where, setWhere] = useState("");
  const [guests, setGuests] = useState(initial.guests);
  const [who, setWho] = useState({ name: "", phone: "", email: "", notes: "" });
  const [est, setEst] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => { if (d) document.title = `${d.name} — Photography · UniteFix Celebrations`; }, [d]);
  const pkg = d?.packages.find(p => p.id === pkgId) ?? null;
  const avail = useQuery<{ days: Array<{ day: string; closed: boolean; am: boolean; pm: boolean }> }>({
    queryKey: ["photo-avail", code, month], enabled: !!d && !preview,
    queryFn: async () => (await apiRequest("GET", `/api/public/photographers/${encodeURIComponent(code)}/availability?month=${month}`)).data,
  });
  const pickExtras = useMemo(() => Object.entries(extras).filter(([, n]) => n > 0).map(([id, n]) => ({ packageId: Number(id), quantity: n })), [extras]);
  useEffect(() => {
    if (!pkgId || preview) { setEst(null); return; }
    let stop = false;
    const t = setTimeout(async () => {
      try { const r = await apiRequest("POST", `/api/public/photographers/${encodeURIComponent(code)}/estimate`, { packageId: pkgId, days, hours, addons: pickExtras, date: date ?? undefined, slot }); if (!stop) { setEst(r.data); setErr(null); } }
      catch (e) { if (!stop) { setEst(null); setErr(apiErrorMessage(e)); } }
    }, 300);
    return () => { stop = true; clearTimeout(t); };
  }, [pkgId, days, hours, pickExtras, date, slot, code, preview]);

  if (q.isLoading) return <Shell><Loading /></Shell>;
  if (!d) return <Shell><NotFoundCard /></Shell>;
  const p = d.profile;
  const years = p.since ? new Date().getFullYear() - p.since : null;
  const lead = avail.data?.days[0] ? new Date(`${avail.data.days[0].day}T00:00:00Z`).getUTCDay() : 0;
  const ready = !!(pkgId && date && occasion && where.trim().length >= 2 && who.name.trim().length >= 2 && who.phone.replace(/\D/g, "").length >= 10 && est?.available !== false);
  const choose = (id: number) => { setPkgId(id); ask.current?.scrollIntoView({ behavior: "smooth" }); };
  const send = async () => {
    setSending(true); setErr(null);
    try {
      const r = await apiRequest("POST", `/api/public/photographers/${encodeURIComponent(code)}/request`, { packageId: pkgId, days, hours, addons: pickExtras, date, slot, occasion, location: where, guests: Number(guests) || null, name: who.name, phone: who.phone, email: who.email || null, notes: who.notes || null });
      window.location.href = r.data.link;
    } catch (e) { setErr(apiErrorMessage(e)); avail.refetch(); } finally { setSending(false); }
  };
  const toPlan = () => {
    if (!pkg || !date) return;
    addToPlan({ type: "photographer", code: d.code, name: d.name, date, detail: `${pkg.name}${days > 1 ? ` · ${days} days` : ""} · ${SLOT_LABEL[slot]}`, photo: d.featured[0]?.url ?? p.coverPhoto, payload: { packageId: pkg.id, days, hours, slot, addons: pickExtras }, estimate: est?.total ?? null, guests: Number(guests) || null, occasion: occasion || null });
    window.location.href = "/celebrations/plan";
  };

  return (
    <Shell>
      {preview && <div className="bg-[#231B16] px-4 py-2 text-center text-sm text-[#FBF7F1]">Preview — how clients will see your portfolio once it is live. Requests are switched off here.</div>}
      <section className="relative h-[70vh] min-h-[420px] overflow-hidden bg-[#140f0c] text-white">
        {p.coverVideo ? <video src={p.coverVideo.url} poster={p.coverVideo.poster ?? p.coverPhoto ?? undefined} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover opacity-80" />
          : p.coverPhoto && <img src={p.coverPhoto} alt="" className="absolute inset-0 h-full w-full object-cover opacity-85" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#140f0c] via-[#140f0c]/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-6xl px-4 pb-10">
          <p className="text-xs uppercase tracking-[0.3em] text-white/75">Photography{d.city ? ` · ${d.city}` : ""}</p>
          <h1 className="mt-3 max-w-4xl text-5xl leading-[1.05] sm:text-7xl" style={{ ...display, textWrap: "balance" as any }}>{d.name}</h1>
          {p.tagline && <p className="mt-4 max-w-2xl text-lg text-white/85">{p.tagline}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/80">
            {years != null && years > 0 && <span><span className="text-xl text-white" style={display}>{years}</span> years</span>}
            <span><span className="text-xl text-white" style={display}>{d.stats.albums}</span> stories</span>
            <span><span className="text-xl text-white" style={display}>{d.stats.photos}</span> photos</span>
            {d.reviews.count > 0 && <span><span className="text-[#E8C37A]">★</span> {d.reviews.average.toFixed(1)} · {d.reviews.count} reviews</span>}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="inline-flex h-11 items-center rounded-full bg-[#FBF7F1] px-6 text-sm font-medium text-[#231B16]" onClick={() => ask.current?.scrollIntoView({ behavior: "smooth" })}>Check a date</button>
            <a href="#work" className="inline-flex h-11 items-center rounded-full border border-white/40 px-6 text-sm hover:bg-white/10">See the work</a>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4">
        <section id="work" className="scroll-mt-20 pt-14">
          <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0">
              <SectionTitle kicker="Selected work" title="Moments we kept" />
              {d.featured.length ? <Mosaic items={d.featured} onOpen={i => setLb({ items: lbItems(d.featured), i })} /> : <p className={C.soft}>Work coming soon.</p>}
            </div>
            <aside className="space-y-6 lg:pt-16">
              {p.about && <p className="whitespace-pre-line text-[17px] leading-relaxed">{p.about}</p>}
              {p.styles.length > 0 && <div><p className={labelCls}>Styles</p><div className="flex flex-wrap gap-1.5">{p.styles.map(s => <span key={s} className={`rounded-full border ${C.line} bg-white px-3 py-1 text-xs`}>{s}</span>)}</div></div>}
              {p.travelAreas.length > 0 && <div><p className={labelCls}>Travels to</p><p>{p.travelAreas.join(" · ")}</p></div>}
              {p.languages.length > 0 && <div><p className={labelCls}>Speaks</p><p>{p.languages.join(", ")}</p></div>}
              {p.deliveryDays && <div><p className={labelCls}>Delivery</p><p>Edited photos within {p.deliveryDays} days</p></div>}
              <div className="flex flex-wrap gap-3 text-sm">
                {p.instagram && <a className={`${C.accent} underline`} href={`https://www.instagram.com/${p.instagram}/`} target="_blank" rel="noopener noreferrer">Instagram @{p.instagram}</a>}
                {p.youtube && <a className={`${C.accent} underline`} href={p.youtube} target="_blank" rel="noopener noreferrer">YouTube</a>}
              </div>
            </aside>
          </div>
        </section>

        {d.albums.length > 0 && (
          <section className="pt-20">
            <SectionTitle kicker="Stories" title="Albums" />
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {d.albums.map(a => (
                <a key={a.id} href={`/photographers/${encodeURIComponent(d.code)}/albums/${a.id}${preview ? window.location.search : ""}`} className="group block">
                  <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-[#EFE6DB]">{a.cover && <img src={a.cover} alt={a.title} loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" />}</div>
                  <p className={`mt-3 text-xs uppercase tracking-[0.18em] ${C.accent}`}>{catLabel(a.category)}{a.location ? ` · ${a.location}` : ""}</p>
                  <p className="mt-1 text-xl" style={display}>{a.title}</p>
                  <p className={`text-sm ${C.soft}`}>{a.photos} photos{a.videos ? ` · ${a.videos} film${a.videos === 1 ? "" : "s"}` : ""}</p>
                </a>
              ))}
            </div>
          </section>
        )}

        {d.films.length > 0 && (
          <section className="pt-20">
            <SectionTitle kicker="In motion" title="Films" />
            <div className="grid gap-6 md:grid-cols-2">{d.films.map(f => f.embed && <div key={f.id}><VideoEmbed video={{ provider: f.provider ?? "youtube", url: f.url, embed: f.embed, thumb: f.thumb }} title={f.caption ?? "Film"} />{f.caption && <p className={`mt-2 text-sm ${C.soft}`}>{f.caption}</p>}</div>)}</div>
          </section>
        )}

        <section className="pt-20" id="packages">
          <SectionTitle kicker="Packages" title="Ways to work together">Prices before GST. The quotation you receive is final.</SectionTitle>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {d.packages.map(k => (
              <div key={k.id} className={`flex flex-col rounded-3xl border p-6 ${k.id === pkgId ? "border-[#231B16] bg-white shadow-lg" : `${C.line} bg-white`}`}>
                <p className="text-xl" style={display}>{k.name}</p>
                {k.description && <p className={`mt-2 flex-1 ${C.soft}`}>{k.description}</p>}
                <p className="mt-4 text-2xl" style={display}>{rs(k.price)}<span className={`text-sm ${C.faint}`}>{unitText(k.unit)}</span></p>
                {!preview && <button className={`${k.id === pkgId ? btnAccent : btnPrimary} mt-4`} onClick={() => choose(k.id)}>{k.id === pkgId ? "Chosen" : "Choose"}</button>}
              </div>
            ))}
          </div>
          {d.addons.length > 0 && <p className={`mt-4 text-sm ${C.soft}`}>Extras: {d.addons.map(a => `${a.name} ${rs(a.price)}${unitText(a.unit)}`).join(" · ")}</p>}
        </section>

        <section className="grid gap-12 pt-20 lg:grid-cols-[1fr_420px]">
          <div className="min-w-0 space-y-14">
            <div><SectionTitle kicker="From real bookings" title="Kind words" /><Reviews data={d.reviews} partner={d.name} /></div>
            <div>
              <h3 className="text-xl" style={display}>Booking terms</h3>
              <ul className={`mt-2 list-disc space-y-1 pl-5 ${C.soft}`}>
                <li>{d.policies.advancePercent}% advance to confirm; the balance {d.policies.balanceDueDays} days before</li>
                <li>Your date is held for {d.policies.holdHours} hours while {d.name} sends your quotation</li>
                {cancellationText(d.policies.cancellation).map(t => <li key={t}>{t}</li>)}
              </ul>
            </div>
          </div>
          <aside ref={ask} id="ask" className="scroll-mt-20 lg:sticky lg:top-20 lg:self-start">
            <div className={`rounded-3xl border ${C.line} bg-white p-5 shadow-[0_10px_40px_-20px_rgba(35,27,22,0.35)]`}>
              <h2 className="text-2xl" style={display}>Check a date</h2>
              {preview ? <p className={`mt-2 text-sm ${C.soft}`}>Requests open once the portfolio is live.</p> : (
                <div className="mt-4 space-y-4">
                  <div><label className={labelCls} htmlFor="ph-p">Package</label>
                    <select id="ph-p" className={field} value={pkgId ?? ""} onChange={e => setPkgId(e.target.value ? Number(e.target.value) : null)}><option value="">Choose a package…</option>{d.packages.map(k => <option key={k.id} value={k.id}>{k.name} — {rs(k.price)}{unitText(k.unit)}</option>)}</select>
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between"><span className={labelCls}>Date</span>
                      <div className="flex items-center gap-1">
                        <button aria-label="Previous month" disabled={month <= istToday().slice(0, 7)} onClick={() => setMonth(monthAdd(month, -1))} className="h-8 w-8 rounded-full hover:bg-[#F3ECE3] disabled:opacity-30">‹</button>
                        <span className="w-32 text-center text-sm font-medium">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
                        <button aria-label="Next month" onClick={() => setMonth(monthAdd(month, 1))} className="h-8 w-8 rounded-full hover:bg-[#F3ECE3]">›</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-sm">
                      {["S", "M", "T", "W", "T", "F", "S"].map((x, i) => <span key={i} className={`text-[11px] ${C.faint}`}>{x}</span>)}
                      {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} />)}
                      {(avail.data?.days ?? []).map(x => {
                        const free = !x.closed && (x.am || x.pm);
                        return <button key={x.day} disabled={!free} onClick={() => setDate(x.day)} aria-label={`${niceDate(x.day)}${free ? "" : ", not available"}`} className={`aspect-square rounded-lg ${x.day === date ? "bg-[#231B16] text-white" : free ? "hover:bg-[#F3ECE3]" : "text-[#CDBFB2] line-through"}`}>{Number(x.day.slice(8))}</button>;
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">{(["am", "pm", "full"] as Slot[]).map(s => <button key={s} onClick={() => setSlot(s)} className={`rounded-xl border px-2 py-2 text-sm ${slot === s ? "border-[#231B16] bg-[#231B16] text-white" : C.line}`}>{SLOT_LABEL[s]}</button>)}</div>
                  {pkg?.unit === "day" && <div><label className={labelCls} htmlFor="ph-d">Days</label><select id="ph-d" className={field} value={days} onChange={e => setDays(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} day{n === 1 ? "" : "s"}{date && n > 1 ? ` (to ${niceDate(new Date(Date.parse(`${date}T00:00:00Z`) + (n - 1) * 86_400_000).toISOString().slice(0, 10), { day: "numeric", month: "short" })})` : ""}</option>)}</select></div>}
                  {pkg?.unit === "hour" && <div><label className={labelCls} htmlFor="ph-h">Hours</label><input id="ph-h" className={field} inputMode="numeric" value={hours} onChange={e => setHours(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))} /></div>}
                  {d.addons.length > 0 && <div><span className={labelCls}>Extras</span><ul className="space-y-1.5">{d.addons.map(a => <li key={a.id} className="flex items-center justify-between gap-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={(extras[a.id] ?? 0) > 0} onChange={e => setExtras({ ...extras, [a.id]: e.target.checked ? 1 : 0 })} />{a.name}</label><span className="tabular-nums">{rs(a.price)}{unitText(a.unit)}</span></li>)}</ul></div>}
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls} htmlFor="ph-o">Occasion</label><select id="ph-o" className={field} value={occasion} onChange={e => setOccasion(e.target.value)}><option value="">Choose…</option>{[...OCCASIONS, "Pre-wedding shoot", "Maternity shoot", "Portraits"].map(o => <option key={o}>{o}</option>)}</select></div>
                    <div><label className={labelCls} htmlFor="ph-g">Guests</label><input id="ph-g" className={field} inputMode="numeric" value={guests} onChange={e => setGuests(e.target.value.replace(/\D/g, ""))} /></div>
                  </div>
                  <div><label className={labelCls} htmlFor="ph-w">Where</label><input id="ph-w" className={field} placeholder="Venue and town" value={where} onChange={e => setWhere(e.target.value)} /></div>
                  {est && (
                    <div className="rounded-2xl bg-[#F6EFE6] p-4 text-sm tabular-nums">
                      {est.available === false && <p className="mb-2 font-medium text-[#B03A2E]">Already booked that day — please try another.</p>}
                      <ul className="space-y-1">{est.items.map((i: any, n: number) => <li key={n} className="flex justify-between gap-3"><span>{i.name}{i.quantity > 1 ? ` × ${i.quantity}` : ""}</span><span>{rs(i.amount)}</span></li>)}</ul>
                      <div className={`mt-2 flex justify-between border-t ${C.line} pt-2 ${C.soft}`}><span>GST</span><span>{rs(est.gst)}</span></div>
                      <div className="mt-1 flex justify-between text-base font-medium"><span>Estimate</span><span>{rs(est.total)}</span></div>
                    </div>
                  )}
                  {pkgId && date && (
                    <div className="space-y-3">
                      <div><label className={labelCls} htmlFor="ph-n">Your name</label><input id="ph-n" className={field} autoComplete="name" value={who.name} onChange={e => setWho({ ...who, name: e.target.value })} /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className={labelCls} htmlFor="ph-m">Mobile</label><input id="ph-m" className={field} inputMode="tel" autoComplete="tel" value={who.phone} onChange={e => setWho({ ...who, phone: e.target.value })} /></div>
                        <div><label className={labelCls} htmlFor="ph-e">Email (optional)</label><input id="ph-e" className={field} type="email" autoComplete="email" value={who.email} onChange={e => setWho({ ...who, email: e.target.value })} /></div>
                      </div>
                      <div><label className={labelCls} htmlFor="ph-x">Tell them about your day</label><textarea id="ph-x" rows={3} maxLength={1000} className={`${field} h-auto py-2`} value={who.notes} onChange={e => setWho({ ...who, notes: e.target.value })} /></div>
                    </div>
                  )}
                  {err && <p role="alert" className="text-sm text-[#B03A2E]">{err}</p>}
                  <button className={`${btnAccent} w-full`} disabled={!ready || sending} onClick={send}>{sending ? "Holding your date…" : "Hold the date & ask for a quotation"}</button>
                  {pkgId && date && <button className={`${btnGhost} w-full`} onClick={toPlan}>Add to my plan instead</button>}
                  <p className={`text-center text-xs ${C.faint}`}>Nothing to pay now. {d.name} sends a quotation within {d.policies.holdHours} hours.</p>
                </div>
              )}
            </div>
          </aside>
        </section>
      </div>
      <Lightbox items={lb?.items ?? []} index={lb?.i ?? null} onClose={() => setLb(null)} onIndex={i => setLb(lb && { ...lb, i })} />
    </Shell>
  );
}

export function AlbumPage({ code, id }: { code: string; id: number }) {
  const qs = new URLSearchParams(window.location.search);
  const preview = qs.get("preview");
  // In preview the album comes from the Hub's album endpoint.
  const url = preview === "1" ? `/api/hub/portfolio/albums/${id}/media` : `/api/public/photographers/${encodeURIComponent(code)}/albums/${id}`;
  const q = useQuery<any>({ queryKey: [url], queryFn: async () => (await apiRequest("GET", url)).data, retry: false });
  const [lb, setLb] = useState<number | null>(null);
  if (q.isLoading) return <Shell><Loading /></Shell>;
  if (!q.data) return <Shell><NotFoundCard /></Shell>;
  const a: Album = q.data.album; const media: Media[] = q.data.media; const partner = q.data.partner ?? { code, name: "" };
  const photos = media.filter(m => m.kind !== "embed");
  const films = media.filter(m => m.kind === "embed");
  return (
    <Shell>
      <section className="relative h-[60vh] min-h-[360px] overflow-hidden bg-[#140f0c] text-white">
        {a.cover && <img src={a.cover} alt="" className="absolute inset-0 h-full w-full object-cover opacity-85" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#140f0c] via-transparent to-transparent" />
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-4xl px-4 pb-10 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-white/75">{catLabel(a.category)}{a.location ? ` · ${a.location}` : ""}{a.eventDate ? ` · ${niceDate(a.eventDate, { month: "long", year: "numeric" })}` : ""}</p>
          <h1 className="mt-3 text-4xl sm:text-6xl" style={{ ...display, textWrap: "balance" as any }}>{a.title}</h1>
        </div>
      </section>
      <div className="mx-auto max-w-6xl px-4">
        {a.story && <p className="mx-auto max-w-2xl py-12 text-center text-xl leading-relaxed" style={display}>{a.story}</p>}
        {films.length > 0 && <div className="mx-auto mb-10 grid max-w-4xl gap-6">{films.map(f => f.embed && <VideoEmbed key={f.id} video={{ provider: f.provider ?? "youtube", url: f.url, embed: f.embed, thumb: f.thumb }} title={f.caption ?? a.title} />)}</div>}
        <Mosaic items={photos} onOpen={i => setLb(i)} />
        <div className={`mt-16 flex flex-wrap items-center justify-between gap-4 border-t ${C.line} pt-8`}>
          <a href={`/photographers/${encodeURIComponent(partner.code)}${preview ? window.location.search : ""}`} className={btnGhost}>← More from {partner.name || "this photographer"}</a>
          <a href={`/photographers/${encodeURIComponent(partner.code)}#ask`} className={btnPrimary}>Check your date</a>
        </div>
        {q.data.others?.length > 0 && (
          <div className="grid gap-6 pt-12 sm:grid-cols-3">{q.data.others.map((o: Album) => (
            <a key={o.id} href={`/photographers/${encodeURIComponent(partner.code)}/albums/${o.id}`} className="group block"><div className="aspect-[4/5] overflow-hidden rounded-2xl bg-[#EFE6DB]">{o.cover && <img src={o.cover} alt={o.title} className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" loading="lazy" />}</div><p className="mt-2 text-lg" style={display}>{o.title}</p></a>
          ))}</div>
        )}
      </div>
      <Lightbox items={lbItems(photos)} index={lb} onClose={() => setLb(null)} onIndex={setLb} />
    </Shell>
  );
}
