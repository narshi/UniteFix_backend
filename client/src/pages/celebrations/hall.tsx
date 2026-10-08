/**
 * /halls/<partner code> — a hall's page in UniteFix Celebrations, and booking
 * a date from it: pick a space, see which mornings and evenings are free this
 * month (peak dates marked), choose guests and add-ons, see the price, and
 * hold the date. Instant-booking halls take the advance straight away;
 * confirm-first halls answer within the hold.
 *
 * ?preview=1 shows the partner their page before it is live (Hub sign-in);
 * ?preview=admin&bp=<id> shows it to UniteFix staff reviewing it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { SLOT_LABEL, cancellationText, OCCASIONS } from "@shared/celebrations";
import { C, display, rs, niceDate, istToday, Shell, SectionTitle, Lightbox, VideoEmbed, Reviews, NotFoundCard, Loading, btnPrimary, btnAccent, btnGhost, field, labelCls, type ReviewsData } from "@/components/celebrations/kit";
import { addToPlan } from "@/pages/celebrations/plan-store";

type Slot = "am" | "pm" | "full";
type Video = { provider: string; url: string; embed: string; thumb: string | null };
type Space = {
  id: number; name: string; kind: string; description: string | null; seated: number | null; floating: number | null; areaSqft: number | null; photos: string[]; video: Video | null;
  features: string[]; included: string | null; gstRate: number; slots: Slot[]; from: number | null; rates: Array<{ type: string; am: number | null; pm: number | null; full: number | null }>;
};
type Addon = { id: number; name: string; category: string; description: string | null; unit: string; price: number; gstRate: number; photos: string[]; maxQty: number | null };
export type HallPage = {
  code: string; name: string; city: string | null; pincode: string | null; phone: string | null; gstRegistered: boolean; preview?: boolean;
  profile: { tagline: string | null; about: string | null; coverPhoto: string | null; video: Video | null; address: string | null; mapUrl: string | null; amenities: string[]; rooms: number | null; parking: number | null; catering: string | null; rules: any };
  policies: { slots: { am: { from: string; to: string }; pm: { from: string; to: string } }; weekendDays: number[]; advancePercent: number; balanceDueDays: number; deposit: number; cancellation: Array<{ daysBefore: number; refundPercent: number }>; instantBooking: boolean; holdHours: number };
  spaces: Space[]; addons: Addon[]; reviews: ReviewsData;
};
type Day = { day: string; type: "weekday" | "weekend" | "peak"; label: string | null; closed: boolean; am: string; pm: string; full: boolean; from: number | null };

const KIND: Record<string, string> = { hall: "Hall", banquet: "Banquet hall", lawn: "Lawn", terrace: "Terrace", rooftop: "Rooftop", room: "Room", other: "Space" };
const CAT: Record<string, string> = { catering: "Catering", decor: "Décor", av: "Sound & light", photography: "Photography", staff: "Staff", cake: "Cakes", other: "Extras" };
const per = (u: string) => (u === "event" ? "" : u === "plate" ? " / plate" : ` / ${u}`);
const monthAdd = (m: string, n: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);

function useSource(code: string) {
  const qs = new URLSearchParams(window.location.search);
  const preview = qs.get("preview");
  const url = preview === "admin" ? `/api/admin/hub/celebrations/listings/${encodeURIComponent(qs.get("bp") ?? "")}/venue/preview` : preview ? "/api/hub/venue/preview" : `/api/public/halls/${encodeURIComponent(code)}`;
  return { preview: !!preview, q: useQuery<HallPage>({ queryKey: [url], queryFn: async () => { const r = (await apiRequest("GET", url)).data; return r.page ?? r; }, retry: false }) };
}

function SpacePhotos({ s, onOpen }: { s: Space; onOpen: (i: number) => void }) {
  const [i, setI] = useState(0);
  if (!s.photos.length) return <div className="aspect-[4/3] rounded-2xl bg-[#EFE6DB]" />;
  return (
    <div className="group relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#EFE6DB]">
      <button className="h-full w-full" onClick={() => onOpen(i)} aria-label={`View photos of ${s.name}`}><img src={s.photos[i]} alt={s.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" loading="lazy" /></button>
      {s.photos.length > 1 && <>
        <button aria-label="Previous photo" onClick={() => setI((i - 1 + s.photos.length) % s.photos.length)} className="absolute left-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full bg-white/85 text-lg opacity-0 shadow transition group-hover:opacity-100 focus:opacity-100">‹</button>
        <button aria-label="Next photo" onClick={() => setI((i + 1) % s.photos.length)} className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full bg-white/85 text-lg opacity-0 shadow transition group-hover:opacity-100 focus:opacity-100">›</button>
        <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-xs text-white">{i + 1}/{s.photos.length}</span>
      </>}
    </div>
  );
}

export default function HallPageView({ code }: { code: string }) {
  const { preview, q } = useSource(code);
  const d = q.data;
  const [lb, setLb] = useState<{ items: Array<{ src: string; caption?: string | null }>; i: number } | null>(null);
  const book = useRef<HTMLDivElement>(null);

  // booking state
  const [spaceId, setSpaceId] = useState<number | null>(null);
  const initial = useMemo(() => { const q = new URLSearchParams(window.location.search); const d = q.get("date"); return { date: d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d > istToday() ? d : null, guests: (q.get("guests") ?? "").replace(/\D/g, "") }; }, []);
  const [month, setMonth] = useState((initial.date ?? istToday()).slice(0, 7));
  const [date, setDate] = useState<string | null>(initial.date);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [guests, setGuests] = useState(initial.guests);
  const [occasion, setOccasion] = useState("");
  const [addons, setAddons] = useState<Record<number, number>>({});
  const [who, setWho] = useState({ name: "", phone: "", email: "", notes: "" });
  const [est, setEst] = useState<any>(null);
  const [estErr, setEstErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sid = spaceId ?? d?.spaces[0]?.id ?? null;
  const space = d?.spaces.find(s => s.id === sid) ?? null;

  useEffect(() => { if (d) document.title = `${d.name} — UniteFix Celebrations`; }, [d]);
  const avail = useQuery<{ days: Day[] }>({
    queryKey: ["hall-avail", code, sid, month], enabled: !!sid && !preview,
    queryFn: async () => (await apiRequest("GET", `/api/public/halls/${encodeURIComponent(code)}/availability?spaceId=${sid}&month=${month}`)).data,
  });
  const dayInfo = avail.data?.days.find(x => x.day === date) ?? null;
  const g = Number(guests) || 0;
  const pickAddons = useMemo(() => Object.entries(addons).filter(([, n]) => n > 0).map(([id, n]) => ({ packageId: Number(id), quantity: n })), [addons]);

  // live price
  useEffect(() => {
    if (!sid || !date || !slot || preview) { setEst(null); return; }
    let stop = false;
    const t = setTimeout(async () => {
      try { const r = await apiRequest("POST", `/api/public/halls/${encodeURIComponent(code)}/estimate`, { spaceId: sid, date, slot, guests: g || null, addons: pickAddons }); if (!stop) { setEst(r.data); setEstErr(null); } }
      catch (e) { if (!stop) { setEst(null); setEstErr(apiErrorMessage(e)); } }
    }, 300);
    return () => { stop = true; clearTimeout(t); };
  }, [sid, date, slot, g, pickAddons, code, preview]);

  if (q.isLoading) return <Shell><Loading /></Shell>;
  if (!d) return <Shell><NotFoundCard /></Shell>;

  const cover = d.profile.coverPhoto ?? d.spaces[0]?.photos[0] ?? null;
  const maxGuests = Math.max(0, ...d.spaces.map(s => Math.max(s.seated ?? 0, s.floating ?? 0)));
  const from = d.spaces.map(s => s.from).filter((x): x is number => x != null);
  const allPhotos = d.spaces.flatMap(s => s.photos.map(src => ({ src, caption: s.name })));
  const rules = d.profile.rules ?? {};
  const facts = [
    maxGuests ? ["Up to", `${maxGuests.toLocaleString("en-IN")} guests`] : null,
    d.spaces.length > 1 ? ["Spaces", String(d.spaces.length)] : null,
    d.profile.rooms ? ["Guest rooms", String(d.profile.rooms)] : null,
    d.profile.parking ? ["Parking", `${d.profile.parking} cars`] : null,
    d.profile.catering ? ["Catering", d.profile.catering === "in_house" ? "In-house" : d.profile.catering === "outside" ? "Your own caterer" : "In-house or your own"] : null,
    rules.vegOnly ? ["Food", "Vegetarian only"] : null,
  ].filter(Boolean) as Array<[string, string]>;
  const lead = avail.data?.days[0] ? new Date(`${avail.data.days[0].day}T00:00:00Z`).getUTCDay() : 0;
  const slotOk = (s: Slot) => !!dayInfo && (s === "full" ? dayInfo.full : dayInfo[s] === "free");
  const ready = !!(sid && date && slot && occasion && who.name.trim().length >= 2 && who.phone.replace(/\D/g, "").length >= 10 && est?.available);

  const send = async () => {
    setSending(true); setErr(null);
    try {
      const r = await apiRequest("POST", `/api/public/halls/${encodeURIComponent(code)}/request`, { spaceId: sid, date, slot, guests: g || null, occasion, addons: pickAddons, name: who.name, phone: who.phone, email: who.email || null, notes: who.notes || null });
      window.location.href = r.data.payUrl ? `${r.data.link}?pay=1` : r.data.link;
    } catch (e) { setErr(apiErrorMessage(e)); avail.refetch(); } finally { setSending(false); }
  };
  const saveToPlan = () => {
    if (!space || !date || !slot) return;
    addToPlan({ type: "hall", code: d.code, name: d.name, date, detail: `${space.name} · ${SLOT_LABEL[slot]}`, photo: space.photos[0] ?? cover, payload: { spaceId: space.id, slot, addons: pickAddons }, estimate: est?.total ?? null, guests: g || null, occasion: occasion || null });
    window.location.href = "/celebrations/plan";
  };

  return (
    <Shell>
      {preview && <div className="bg-[#231B16] px-4 py-2 text-center text-sm text-[#FBF7F1]">Preview — this is how clients will see the page once UniteFix puts it live. Booking is switched off here.</div>}
      {/* Hero */}
      <section className="relative">
        <div className="relative h-[52vh] min-h-[340px] w-full overflow-hidden bg-[#2a201a] sm:h-[62vh]">
          {cover && <img src={cover} alt={d.name} className="absolute inset-0 h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-[#120d0a]/85 via-[#120d0a]/25 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 mx-auto max-w-6xl px-4 pb-8 text-white">
            <p className="text-xs uppercase tracking-[0.25em] text-white/80">{[d.city, "Hall"].filter(Boolean).join(" · ")}</p>
            <h1 className="mt-2 max-w-3xl text-4xl leading-tight sm:text-6xl" style={{ ...display, textWrap: "balance" as any }}>{d.name}</h1>
            {d.profile.tagline && <p className="mt-3 max-w-2xl text-base text-white/85 sm:text-lg">{d.profile.tagline}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button className={`${btn("light")}`} onClick={() => book.current?.scrollIntoView({ behavior: "smooth" })}>Check dates</button>
              {allPhotos.length > 0 && <button className="inline-flex h-11 items-center rounded-full border border-white/40 px-5 text-sm text-white hover:bg-white/10" onClick={() => setLb({ items: allPhotos, i: 0 })}>All {allPhotos.length} photos</button>}
              {d.reviews.count > 0 && <span className="text-sm text-white/90"><span className="text-[#E8C37A]">★</span> {d.reviews.average.toFixed(1)} · {d.reviews.count} reviews</span>}
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-10 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-16">
          {/* Facts + about */}
          <section>
            {facts.length > 0 && (
              <dl className={`grid grid-cols-2 gap-px overflow-hidden rounded-2xl border ${C.line} bg-[#E9DFD3] sm:grid-cols-3`}>
                {facts.map(([k, v]) => <div key={k} className="bg-[#FBF7F1] p-4"><dt className={`text-xs uppercase tracking-wider ${C.faint}`}>{k}</dt><dd className="mt-1 text-lg" style={display}>{v}</dd></div>)}
              </dl>
            )}
            {from.length > 0 && <p className={`mt-4 ${C.soft}`}>Rent from <span className="text-xl text-[#231B16]" style={display}>{rs(Math.min(...from))}</span> + GST, on a weekday.</p>}
            {d.profile.about && <p className="mt-6 whitespace-pre-line text-[17px] leading-relaxed" style={{ maxWidth: "65ch" }}>{d.profile.about}</p>}
          </section>

          {d.profile.video && <section><SectionTitle kicker="Take a walk through" title="Video tour" /><VideoEmbed video={d.profile.video} title={`${d.name} — video tour`} /></section>}

          {/* Spaces */}
          <section>
            <SectionTitle kicker="Choose your space" title={d.spaces.length > 1 ? `${d.spaces.length} spaces to book` : "The space"} id="spaces">Rents are before GST. Weekends and peak dates (muhurtham days, festivals) are priced separately.</SectionTitle>
            <div className="space-y-12">
              {d.spaces.map(s => (
                <article key={s.id} className="grid gap-6 md:grid-cols-[1.15fr_1fr]">
                  <SpacePhotos s={s} onOpen={i => setLb({ items: s.photos.map(src => ({ src, caption: s.name })), i })} />
                  <div className="min-w-0">
                    <p className={`text-xs uppercase tracking-[0.2em] ${C.accent}`}>{KIND[s.kind] ?? "Space"}</p>
                    <h3 className="mt-1 text-2xl" style={display}>{s.name}</h3>
                    <p className={`mt-1 ${C.soft}`}>{[s.seated && `${s.seated} seated`, s.floating && `${s.floating} floating`, s.areaSqft && `${s.areaSqft.toLocaleString("en-IN")} sq ft`].filter(Boolean).join(" · ")}</p>
                    {s.description && <p className="mt-3 leading-relaxed">{s.description}</p>}
                    {s.features.length > 0 && <ul className="mt-3 flex flex-wrap gap-1.5">{s.features.map(f => <li key={f} className={`rounded-full border ${C.line} bg-white px-3 py-1 text-xs`}>{f}</li>)}</ul>}
                    {s.included && <p className={`mt-3 text-sm ${C.soft}`}><span className="font-medium text-[#231B16]">Included:</span> {s.included}</p>}
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[300px] text-sm tabular-nums">
                        <thead><tr className={C.faint}><th className="py-1 text-left font-normal"></th>{s.slots.map(sl => <th key={sl} className="py-1 text-right font-normal">{SLOT_LABEL[sl]}</th>)}</tr></thead>
                        <tbody>{s.rates.map(r => <tr key={r.type} className={`border-t ${C.line}`}><td className="py-1.5">{r.type === "weekday" ? "Weekday" : r.type === "weekend" ? "Weekend" : "Peak date"}</td>{s.slots.map(sl => <td key={sl} className="py-1.5 text-right">{rs(r[sl])}</td>)}</tr>)}</tbody>
                      </table>
                    </div>
                    {!preview && <button className={`${btnPrimary} mt-5`} onClick={() => { setSpaceId(s.id); setDate(null); setSlot(null); book.current?.scrollIntoView({ behavior: "smooth" }); }}>Check dates for {s.name}</button>}
                    {s.video && <div className="mt-5"><VideoEmbed video={s.video} title={`${s.name} — tour`} /></div>}
                  </div>
                </article>
              ))}
            </div>
          </section>

          {d.profile.amenities.length > 0 && (
            <section><SectionTitle kicker="On the property" title="Amenities" />
              <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">{d.profile.amenities.map(a => <li key={a} className="flex items-center gap-2"><span className={C.accent}>✓</span>{a}</li>)}</ul>
            </section>
          )}

          {d.addons.length > 0 && (
            <section><SectionTitle kicker="Add to your booking" title="From the hall">Choose these while booking — they go on the same bill.</SectionTitle>
              <ul className={`divide-y ${C.line} border-y ${C.line}`}>{d.addons.map(a => (
                <li key={a.id} className="flex items-center gap-4 py-3">
                  {a.photos[0] ? <img src={a.photos[0]} alt="" className="h-14 w-14 rounded-xl object-cover" loading="lazy" /> : <span className="h-14 w-14 rounded-xl bg-[#EFE6DB]" />}
                  <div className="min-w-0 flex-1"><p className="font-medium">{a.name}</p><p className={`text-sm ${C.soft}`}>{CAT[a.category] ?? "Extras"}{a.description ? ` · ${a.description}` : ""}</p></div>
                  <p className="whitespace-nowrap text-right tabular-nums">{rs(a.price)}<span className={`text-xs ${C.faint}`}>{per(a.unit)}</span></p>
                </li>
              ))}</ul>
            </section>
          )}

          <section><SectionTitle kicker="Before you book" title="House rules and terms" id="terms" />
            <div className="grid gap-8 sm:grid-cols-2">
              <div>
                <h3 className="font-medium">House rules</h3>
                <ul className={`mt-2 space-y-1.5 ${C.soft}`}>
                  <li>Time slots: morning {d.policies.slots.am.from}–{d.policies.slots.am.to}, evening {d.policies.slots.pm.from}–{d.policies.slots.pm.to}</li>
                  {rules.vegOnly && <li>Vegetarian food only</li>}
                  <li>Alcohol: {rules.alcohol === "allowed" ? "allowed" : rules.alcohol === "licensed" ? "with a licence only" : "not allowed"}</li>
                  {rules.outsideCaterers != null && <li>Outside caterers {rules.outsideCaterers ? "allowed" : "not allowed"}</li>}
                  {rules.outsideDecorators != null && <li>Outside decorators {rules.outsideDecorators ? "allowed" : "not allowed"}</li>}
                  {rules.musicUntil && <li>Music until {rules.musicUntil}</li>}
                  {rules.notes && <li>{rules.notes}</li>}
                </ul>
              </div>
              <div>
                <h3 className="font-medium">Paying and cancelling</h3>
                <ul className={`mt-2 space-y-1.5 ${C.soft}`}>
                  <li>{d.policies.advancePercent >= 100 ? "Pay in full to confirm" : `${d.policies.advancePercent}% advance to confirm; the balance ${d.policies.balanceDueDays} days before`}</li>
                  {d.policies.deposit > 0 && <li>Refundable security deposit {rs(d.policies.deposit)}, paid to the hall and returned after the event</li>}
                  <li>{d.policies.instantBooking ? `Book instantly: your date is held for ${d.policies.holdHours} hours while you pay the advance` : `The hall confirms your request within ${d.policies.holdHours} hours; your date is held until then`}</li>
                  {cancellationText(d.policies.cancellation).map(t => <li key={t}>{t}</li>)}
                </ul>
              </div>
            </div>
          </section>

          <section><SectionTitle kicker="From real bookings" title="Reviews" id="reviews" /><Reviews data={d.reviews} partner={d.name} /></section>

          <section className={`rounded-3xl border ${C.line} bg-white p-6`}>
            <h3 className="text-xl" style={display}>Finding {d.name}</h3>
            {d.profile.address && <p className={`mt-2 ${C.soft}`}>{d.profile.address}{d.pincode ? ` — ${d.pincode}` : ""}</p>}
            <div className="mt-4 flex flex-wrap gap-3">
              {d.profile.mapUrl && <a href={d.profile.mapUrl} target="_blank" rel="noopener noreferrer" className={btnGhost}>Open in Google Maps ↗</a>}
              {d.phone && <a href={`tel:${d.phone}`} className={btnGhost}>Call {d.phone}</a>}
            </div>
          </section>
        </div>

        {/* Booking */}
        <aside ref={book} id="book" className="scroll-mt-20 lg:sticky lg:top-20 lg:self-start">
          <div className={`rounded-3xl border ${C.line} bg-white p-5 shadow-[0_10px_40px_-20px_rgba(35,27,22,0.35)]`}>
            <h2 className="text-2xl" style={display}>Book a date</h2>
            {preview ? <p className={`mt-2 text-sm ${C.soft}`}>Booking opens once the page is live.</p> : (
              <div className="mt-4 space-y-4">
                {d.spaces.length > 1 && (
                  <div><span className={labelCls}>Space</span>
                    <div className="grid grid-cols-2 gap-2">{d.spaces.map(s => <button key={s.id} onClick={() => { setSpaceId(s.id); setDate(null); setSlot(null); }} className={`rounded-xl border px-3 py-2 text-left text-sm ${s.id === sid ? "border-[#231B16] bg-[#231B16] text-white" : `${C.line} hover:border-[#B5562B]`}`}>{s.name}<span className={`block text-xs ${s.id === sid ? "text-white/70" : C.faint}`}>up to {Math.max(s.seated ?? 0, s.floating ?? 0) || "—"}</span></button>)}</div>
                  </div>
                )}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={labelCls}>Date</span>
                    <div className="flex items-center gap-1">
                      <button aria-label="Previous month" disabled={month <= istToday().slice(0, 7)} onClick={() => setMonth(monthAdd(month, -1))} className="h-8 w-8 rounded-full hover:bg-[#F3ECE3] disabled:opacity-30">‹</button>
                      <span className="w-32 text-center text-sm font-medium">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
                      <button aria-label="Next month" onClick={() => setMonth(monthAdd(month, 1))} className="h-8 w-8 rounded-full hover:bg-[#F3ECE3]">›</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
                    {["S", "M", "T", "W", "T", "F", "S"].map((x, i) => <span key={i} className={C.faint}>{x}</span>)}
                    {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} />)}
                    {(avail.data?.days ?? []).map(x => {
                      const anyFree = !x.closed && (x.am === "free" || x.pm === "free");
                      const sel = x.day === date;
                      return (
                        <button key={x.day} disabled={!anyFree} onClick={() => { setDate(x.day); setSlot(null); }} title={x.label ?? undefined} aria-label={`${niceDate(x.day)}${x.closed ? ", closed" : anyFree ? ", available" : ", booked"}`}
                          className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm transition ${sel ? "bg-[#231B16] text-white" : anyFree ? "hover:bg-[#F3ECE3]" : "text-[#CDBFB2] line-through"} ${x.type === "peak" && !sel ? "ring-1 ring-[#E3B868]" : ""}`}>
                          {Number(x.day.slice(8))}
                          {!x.closed && <span className="mt-0.5 flex gap-0.5">{(["am", "pm"] as const).map(p => <span key={p} className={`h-1 w-1 rounded-full ${x[p] === "free" ? (sel ? "bg-white" : "bg-[#3F8F5B]") : x[p] === "taken" ? "bg-[#D9534F]/60" : "bg-transparent"}`} />)}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <p className={`mt-2 text-[11px] ${C.faint}`}>Dots: morning · evening free. Gold ring: peak date.</p>
                </div>
                {date && dayInfo && (
                  <div><span className={labelCls}>{niceDate(date)}{dayInfo.label ? ` · ${dayInfo.label}` : dayInfo.type === "weekend" ? " · weekend" : ""}</span>
                    <div className="grid grid-cols-3 gap-2">{(["am", "pm", "full"] as Slot[]).filter(s => space?.slots.includes(s)).map(s => (
                      <button key={s} disabled={!slotOk(s)} onClick={() => setSlot(s)} className={`rounded-xl border px-2 py-2 text-sm ${slot === s ? "border-[#231B16] bg-[#231B16] text-white" : slotOk(s) ? `${C.line} hover:border-[#B5562B]` : "border-dashed border-[#E2D6C8] text-[#CDBFB2]"}`}>
                        {SLOT_LABEL[s]}<span className={`block text-[11px] ${slot === s ? "text-white/70" : C.faint}`}>{s === "full" ? `${d.policies.slots.am.from}–${d.policies.slots.pm.to}` : `${d.policies.slots[s].from}–${d.policies.slots[s].to}`}</span>
                      </button>
                    ))}</div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelCls} htmlFor="h-g">Guests</label><input id="h-g" className={field} inputMode="numeric" placeholder="250" value={guests} onChange={e => setGuests(e.target.value.replace(/\D/g, ""))} /></div>
                  <div><label className={labelCls} htmlFor="h-o">Occasion</label><select id="h-o" className={field} value={occasion} onChange={e => setOccasion(e.target.value)}><option value="">Choose…</option>{OCCASIONS.map(o => <option key={o}>{o}</option>)}</select></div>
                </div>
                {d.addons.length > 0 && (
                  <details className={`rounded-xl border ${C.line} p-3`}>
                    <summary className="cursor-pointer text-sm font-medium">Add-ons {pickAddons.length ? `(${pickAddons.length})` : ""}</summary>
                    <ul className="mt-3 space-y-2">{d.addons.map(a => {
                      const n = addons[a.id] ?? 0;
                      const counted = !["event", "plate"].includes(a.unit);
                      return (
                        <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                          <label className="flex min-w-0 items-center gap-2"><input type="checkbox" checked={n > 0} onChange={e => setAddons({ ...addons, [a.id]: e.target.checked ? 1 : 0 })} /><span className="truncate">{a.name}</span></label>
                          <span className="flex items-center gap-2 whitespace-nowrap tabular-nums">{counted && n > 0 && <input aria-label={`${a.name} quantity`} className="h-8 w-14 rounded-lg border border-[#E2D6C8] px-2" inputMode="numeric" value={n} onChange={e => setAddons({ ...addons, [a.id]: Math.max(1, Math.min(a.maxQty ?? 50, Number(e.target.value.replace(/\D/g, "")) || 1)) })} />}{rs(a.price)}<span className={C.faint}>{per(a.unit)}</span></span>
                        </li>
                      );
                    })}</ul>
                  </details>
                )}
                {est && (
                  <div className="rounded-2xl bg-[#F6EFE6] p-4 text-sm tabular-nums">
                    {!est.available && <p className="mb-2 font-medium text-[#B03A2E]">Just taken — please pick another date or time.</p>}
                    <ul className="space-y-1">{est.items.map((i: any, n: number) => <li key={n} className="flex justify-between gap-3"><span className="truncate">{i.name}{i.quantity > 1 ? ` × ${i.quantity}` : ""}</span><span>{rs(i.amount)}</span></li>)}</ul>
                    <div className={`mt-2 flex justify-between border-t ${C.line} pt-2 ${C.soft}`}><span>GST</span><span>{rs(est.gst)}</span></div>
                    <div className="mt-1 flex justify-between text-base font-medium"><span>Total</span><span>{rs(est.total)}</span></div>
                    <div className={`mt-2 flex justify-between ${C.accent}`}><span>{est.advancePercent >= 100 ? "Pay now" : `Advance now (${est.advancePercent}%)`}</span><span>{rs(est.advance)}</span></div>
                    {est.deposit > 0 && <p className={`mt-1 text-xs ${C.soft}`}>+ {rs(est.deposit)} refundable deposit, paid at the hall.</p>}
                  </div>
                )}
                {estErr && <p className="text-sm text-[#B03A2E]">{estErr}</p>}
                {date && slot && (
                  <div className="space-y-3">
                    <div><label className={labelCls} htmlFor="h-n">Your name</label><input id="h-n" className={field} autoComplete="name" value={who.name} onChange={e => setWho({ ...who, name: e.target.value })} /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={labelCls} htmlFor="h-p">Mobile</label><input id="h-p" className={field} inputMode="tel" autoComplete="tel" value={who.phone} onChange={e => setWho({ ...who, phone: e.target.value })} /></div>
                      <div><label className={labelCls} htmlFor="h-e">Email (optional)</label><input id="h-e" className={field} type="email" autoComplete="email" value={who.email} onChange={e => setWho({ ...who, email: e.target.value })} /></div>
                    </div>
                    <div><label className={labelCls} htmlFor="h-x">Anything the hall should know</label><textarea id="h-x" rows={2} className={`${field} h-auto py-2`} maxLength={1000} value={who.notes} onChange={e => setWho({ ...who, notes: e.target.value })} /></div>
                  </div>
                )}
                {err && <p role="alert" className="text-sm text-[#B03A2E]">{err}</p>}
                <button className={`${btnAccent} w-full`} disabled={!ready || sending} onClick={send}>
                  {sending ? "Holding your date…" : d.policies.instantBooking ? (est ? `Hold the date · pay ${rs(est.advance)}` : "Hold the date") : "Send booking request"}
                </button>
                {date && slot && <button className={`${btnGhost} w-full`} onClick={saveToPlan}>Add to my plan instead</button>}
                <p className={`text-center text-xs ${C.faint}`}>{d.policies.instantBooking ? `Your date is held for ${d.policies.holdHours} hours while you pay.` : `${d.name} answers within ${d.policies.holdHours} hours. Nothing to pay until they accept.`}</p>
              </div>
            )}
          </div>
        </aside>
      </div>
      <Lightbox items={lb?.items ?? []} index={lb?.i ?? null} onClose={() => setLb(null)} onIndex={i => setLb(lb && { ...lb, i })} />
    </Shell>
  );
}

function btn(_: "light") { return "inline-flex h-11 items-center rounded-full bg-[#FBF7F1] px-6 text-sm font-medium text-[#231B16] hover:bg-white"; }
