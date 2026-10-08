/**
 * /celebrations — find a hall, a photographer or an event planner by place,
 * date and guests. With a date, each card says whether they are free.
 * Filters and the search live in the URL, so a search can be shared.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { PHOTO_STYLES } from "@shared/celebrations";
import { C, display, rs, niceDate, istToday, Shell, btnPrimary, field, labelCls } from "@/components/celebrations/kit";
import { readPlan } from "@/pages/celebrations/plan-store";

type Type = "halls" | "photographers" | "planners";
type Card = { code: string; name: string; city: string | null; featured: boolean; rating: { avg: number; count: number } | null; cover: string | null; shots?: string[]; tagline: string | null; from: number | null; available: boolean | null; capacity?: number; spaces?: number; highlights: string[]; since?: number | null; themes?: number; url: string };
const TYPES: Array<[Type, string, string]> = [["halls", "Halls & venues", "Marriage halls, banquets and lawns"], ["photographers", "Photographers", "Weddings, candids and films"], ["planners", "Event planners", "Décor, themes and the whole day"]];
const FILTER_AMENITIES = ["Air conditioning", "Car parking", "Guest rooms", "Power backup", "In-house catering", "Open lawn"];

function readQs() {
  const q = new URLSearchParams(window.location.search);
  return { type: (["halls", "photographers", "planners"].includes(q.get("type") ?? "") ? q.get("type") : "halls") as Type, city: q.get("city") ?? "", date: q.get("date") ?? "", guests: q.get("guests") ?? "", sort: q.get("sort") ?? "recommended", amenities: (q.get("amenities") ?? "").split(",").filter(Boolean), style: q.get("style") ?? "", veg: q.get("veg") === "1", maxPrice: q.get("maxPrice") ?? "" };
}

export default function SearchPage() {
  const [f, setF] = useState(readQs);
  const [applied, setApplied] = useState(f);
  const planCount = useMemo(() => readPlan().length, []);
  useEffect(() => { document.title = "UniteFix Celebrations — halls, photographers and planners"; }, []);
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("type", applied.type);
    if (applied.city) q.set("city", applied.city); if (applied.date) q.set("date", applied.date); if (applied.guests) q.set("guests", applied.guests);
    if (applied.sort !== "recommended") q.set("sort", applied.sort); if (applied.amenities.length) q.set("amenities", applied.amenities.join(","));
    if (applied.style) q.set("style", applied.style); if (applied.veg) q.set("veg", "1"); if (applied.maxPrice) q.set("maxPrice", applied.maxPrice);
    window.history.replaceState(null, "", `/celebrations?${q.toString()}`);
  }, [applied]);
  const cities = useQuery<Array<{ city: string; halls: number; photographers: number; planners: number }>>({ queryKey: ["/api/public/celebrations/cities"], queryFn: async () => (await apiRequest("GET", "/api/public/celebrations/cities")).data });
  const qs = useMemo(() => {
    const q = new URLSearchParams({ type: applied.type, sort: applied.sort });
    if (/^\d{6}$/.test(applied.city)) q.set("pincode", applied.city); else if (applied.city) q.set("city", applied.city);
    if (applied.date) q.set("date", applied.date); if (applied.guests) q.set("guests", applied.guests);
    if (applied.type === "halls" && applied.amenities.length) q.set("amenities", applied.amenities.join(","));
    if (applied.type === "halls" && applied.veg) q.set("veg", "1");
    if (applied.type === "photographers" && applied.style) q.set("style", applied.style);
    if (applied.maxPrice) q.set("maxPrice", applied.maxPrice);
    return q.toString();
  }, [applied]);
  const res = useQuery<{ count: number; results: Card[] }>({ queryKey: ["/api/public/celebrations/search", qs], queryFn: async () => (await apiRequest("GET", `/api/public/celebrations/search?${qs}`)).data, retry: false });
  const go = (patch: Partial<typeof f> = {}) => { const n = { ...f, ...patch }; setF(n); setApplied(n); };
  const carry = (url: string) => { const q = new URLSearchParams(); if (applied.date) q.set("date", applied.date); if (applied.guests) q.set("guests", applied.guests); return q.toString() ? `${url}?${q}` : url; };
  const label = TYPES.find(t => t[0] === applied.type)!;

  return (
    <Shell crumb={planCount ? <a href="/celebrations/plan" className="rounded-full bg-[#231B16] px-3 py-1.5 text-xs text-white sm:hidden">My plan ({planCount})</a> : undefined}>
      <section className="border-b border-[#E9DFD3] bg-[radial-gradient(ellipse_at_top,_#F6E7D3,_#FBF7F1_60%)]">
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-12 sm:pt-16">
          <p className={`text-xs uppercase tracking-[0.25em] ${C.accent}`}>Weddings · Birthdays · Every celebration</p>
          <h1 className="mt-3 max-w-3xl text-4xl leading-tight sm:text-6xl" style={{ ...display, textWrap: "balance" as any }}>Find the hall, the photographer and the planner — for your date.</h1>
          <p className={`mt-4 max-w-2xl text-lg ${C.soft}`}>Real availability, clear prices, and reviews only from people who booked.</p>
          <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label="What are you looking for">
            {TYPES.map(([t, l]) => <button key={t} role="tab" aria-selected={f.type === t} onClick={() => go({ type: t })} className={`rounded-full px-5 py-2.5 text-sm transition ${f.type === t ? "bg-[#231B16] text-white" : "border border-[#D9CBBB] bg-white/70 hover:bg-white"}`}>{l}</button>)}
          </div>
          <form className="mt-4 grid gap-3 rounded-3xl border border-[#E9DFD3] bg-white p-4 shadow-[0_10px_40px_-25px_rgba(35,27,22,0.5)] sm:grid-cols-[1.4fr_1fr_0.8fr_auto]" onSubmit={e => { e.preventDefault(); go(); }}>
            <div><label className={labelCls} htmlFor="s-c">Where</label><input id="s-c" className={field} list="s-cities" placeholder="Town or pincode" value={f.city} onChange={e => setF({ ...f, city: e.target.value })} /><datalist id="s-cities">{(cities.data ?? []).map(c => <option key={c.city} value={c.city} />)}</datalist></div>
            <div><label className={labelCls} htmlFor="s-d">Date</label><input id="s-d" className={field} type="date" min={new Date(Date.parse(`${istToday()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></div>
            <div><label className={labelCls} htmlFor="s-g">Guests</label><input id="s-g" className={field} inputMode="numeric" placeholder="200" value={f.guests} onChange={e => setF({ ...f, guests: e.target.value.replace(/\D/g, "") })} /></div>
            <button type="submit" className={`${btnPrimary} self-end`}>Search</button>
          </form>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={C.soft}><span className="text-[#231B16]" style={display}>{res.data?.count ?? "…"}</span> {res.data?.count === 1 ? ({ halls: "hall", photographers: "photographer", planners: "event planner" } as const)[applied.type] : label[1].toLowerCase()}{applied.city ? ` near ${applied.city}` : ""}{applied.date ? ` · ${niceDate(applied.date)}` : ""}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {applied.type === "halls" && FILTER_AMENITIES.map(a => { const on = f.amenities.includes(a); return <button key={a} aria-pressed={on} onClick={() => go({ amenities: on ? f.amenities.filter(x => x !== a) : [...f.amenities, a] })} className={`rounded-full border px-3 py-1 ${on ? "border-[#231B16] bg-[#231B16] text-white" : "border-[#D9CBBB] bg-white"}`}>{a === "Air conditioning" ? "AC" : a}</button>; })}
            {applied.type === "halls" && <button aria-pressed={f.veg} onClick={() => go({ veg: !f.veg })} className={`rounded-full border px-3 py-1 ${f.veg ? "border-[#231B16] bg-[#231B16] text-white" : "border-[#D9CBBB] bg-white"}`}>Veg only</button>}
            {applied.type === "photographers" && <select aria-label="Style" className="h-9 rounded-full border border-[#D9CBBB] bg-white px-3" value={f.style} onChange={e => go({ style: e.target.value })}><option value="">Any style</option>{PHOTO_STYLES.map(s => <option key={s}>{s}</option>)}</select>}
            <select aria-label="Budget" className="h-9 rounded-full border border-[#D9CBBB] bg-white px-3" value={f.maxPrice} onChange={e => go({ maxPrice: e.target.value })}><option value="">Any budget</option>{[25000, 50000, 100000, 200000, 500000].map(v => <option key={v} value={v}>From under {rs(v)}</option>)}</select>
            <select aria-label="Sort" className="h-9 rounded-full border border-[#D9CBBB] bg-white px-3" value={f.sort} onChange={e => go({ sort: e.target.value })}><option value="recommended">Recommended</option><option value="price">Price: low to high</option><option value="rating">Best rated</option></select>
          </div>
        </div>
        {res.isError && <p role="alert" className="mt-6 rounded-2xl bg-[#FBEAEA] p-4 text-[#9B2C2C]">{apiErrorMessage(res.error)}</p>}
        {res.isLoading && <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-80 animate-pulse rounded-3xl bg-[#EFE6DB]" />)}</div>}
        {res.data && !res.data.results.length && (
          <div className="mt-10 rounded-3xl border border-dashed border-[#D9CBBB] p-10 text-center">
            <p className="text-2xl" style={display}>Nobody here yet</p>
            <p className={`mt-2 ${C.soft}`}>Try a nearby town, another date, or fewer filters. New {label[1].toLowerCase()} join every week.</p>
          </div>
        )}
        <div className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {(res.data?.results ?? []).map(c => (
            <a key={c.code} href={carry(c.url)} className="group block">
              <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-[#EFE6DB]">
                {c.cover && <img src={c.cover} alt={c.name} loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" />}
                <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                  {c.featured && <span className="rounded-full bg-[#231B16]/85 px-2.5 py-1 text-[11px] font-medium text-white">Featured</span>}
                  {c.available === true && <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-[#24603A]">Free on {niceDate(applied.date, { day: "numeric", month: "short" })}</span>}
                  {c.available === false && <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-[#9B2C2C]">Booked that day</span>}
                </div>
                {c.shots && c.shots.length > 1 && <div className="absolute bottom-3 right-3 flex gap-1">{c.shots.slice(1, 3).map(s => <img key={s} src={s} alt="" className="h-12 w-12 rounded-lg border-2 border-white object-cover" loading="lazy" />)}</div>}
              </div>
              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xl" style={display}>{c.name}</p>
                  <p className={`text-sm ${C.soft}`}>{[c.city, c.capacity ? `up to ${c.capacity.toLocaleString("en-IN")} guests` : null, c.since ? `since ${c.since}` : null, c.themes ? `${c.themes} themes` : null].filter(Boolean).join(" · ")}</p>
                </div>
                {c.rating && <p className="whitespace-nowrap text-sm"><span className={C.gold}>★</span> {c.rating.avg.toFixed(1)} <span className={C.faint}>({c.rating.count})</span></p>}
              </div>
              {c.highlights.length > 0 && <p className={`mt-1 text-sm ${C.faint}`}>{c.highlights.join(" · ")}</p>}
              {c.from != null && <p className="mt-2 text-sm">From <span className="text-lg" style={display}>{rs(c.from)}</span><span className={C.faint}> + GST</span></p>}
            </a>
          ))}
        </div>
        <section className="mt-24 grid gap-8 rounded-3xl bg-[#231B16] p-8 text-[#FBF7F1] sm:grid-cols-3 sm:p-12">
          <div className="sm:col-span-1"><p className="text-3xl" style={display}>Plan the whole day at once</p></div>
          <p className="text-white/75 sm:col-span-2">Add a hall, a photographer and a planner to <a href="/celebrations/plan" className="underline">your plan</a> for the same date and send one request to all of them. Each one holds your date while they confirm, and you follow everything on one page.</p>
        </section>
      </div>
    </Shell>
  );
}
