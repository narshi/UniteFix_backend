/**
 * /celebrations/plan — the client's plan: a hall, a photographer and a
 * planner for the same day, sent together with their details once.
 * /celebrations/plan/<token> — where each request in a sent plan stands.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { OCCASIONS } from "@shared/celebrations";
import { C, display, rs, niceDate, istToday, Shell, NotFoundCard, Loading, btnAccent, btnGhost, btnPrimary, field, labelCls } from "@/components/celebrations/kit";
import { readPlan, removeFromPlan, clearPlan, type PlanItem } from "@/pages/celebrations/plan-store";

const TYPE: Record<string, string> = { hall: "Hall", photographer: "Photographer", planner: "Event planner" };
const SUGGEST: Array<[PlanItem["type"], string, string]> = [["hall", "a hall", "halls"], ["photographer", "a photographer", "photographers"], ["planner", "a planner for décor and the rest", "planners"]];

export function PlanPage() {
  const [items, setItems] = useState<PlanItem[]>(readPlan);
  const dates = Array.from(new Set(items.map(i => i.date)));
  const [date, setDate] = useState(dates[0] ?? "");
  const [occasion, setOccasion] = useState(items.find(i => i.occasion)?.occasion ?? "");
  const [guests, setGuests] = useState(String(items.find(i => i.guests)?.guests ?? ""));
  const [who, setWho] = useState({ name: "", phone: "", email: "", notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const [problems, setProblems] = useState<Array<{ code: string; message: string }>>([]);
  const [sending, setSending] = useState(false);
  useEffect(() => { document.title = "My plan — UniteFix Celebrations"; }, []);
  const mismatch = items.some(i => i.date !== date);
  const total = items.reduce((a, i) => a + (i.estimate ?? 0), 0);
  const ready = items.length > 0 && !mismatch && !!date && date > istToday() && !!occasion && who.name.trim().length >= 2 && who.phone.replace(/\D/g, "").length >= 10;
  const remove = (i: PlanItem) => { removeFromPlan(i.type, i.code); setItems(readPlan()); };
  const send = async () => {
    setSending(true); setErr(null); setProblems([]);
    try {
      const r = await apiRequest("POST", "/api/public/celebrations/plan", {
        date, occasion, guests: Number(guests) || null, name: who.name, phone: who.phone, email: who.email || null, notes: who.notes || null,
        items: items.map(i => ({ type: i.type, code: i.code, ...(i.payload as object) })),
      });
      clearPlan();
      window.location.href = r.data.link;
    } catch (e: any) {
      setErr(apiErrorMessage(e));
      try { const body = JSON.parse(String(e?.message ?? "").replace(/^\d+:\s*/, "")); if (Array.isArray(body?.problems)) setProblems(body.problems); } catch { /* the message says it */ }
    } finally { setSending(false); }
  };
  const have = new Set(items.map(i => i.type));

  return (
    <Shell>
      <div className="mx-auto max-w-4xl px-4 py-12">
        <p className={`text-xs uppercase tracking-[0.2em] ${C.accent}`}>My plan</p>
        <h1 className="mt-2 text-4xl" style={display}>{items.length ? "Your celebration, in one request" : "Your plan is empty"}</h1>
        <p className={`mt-2 ${C.soft}`}>Add a hall, a photographer and a planner for the same day, then send one request to all of them. Each holds your date while they confirm. Nothing is paid until you choose to.</p>

        {items.length > 0 && (
          <ul className="mt-8 space-y-3">
            {items.map(i => (
              <li key={`${i.type}:${i.code}`} className={`flex items-center gap-4 rounded-2xl border bg-white p-3 ${i.date !== date ? "border-[#E3A0A0]" : C.line}`}>
                {i.photo ? <img src={i.photo} alt="" className="h-20 w-24 rounded-xl object-cover" /> : <span className="h-20 w-24 rounded-xl bg-[#EFE6DB]" />}
                <div className="min-w-0 flex-1">
                  <p className={`text-xs uppercase tracking-wider ${C.accent}`}>{TYPE[i.type]}</p>
                  <p className="truncate text-lg" style={display}>{i.name}</p>
                  <p className={`text-sm ${C.soft}`}>{i.detail} · {niceDate(i.date)}{i.date !== date ? " — different date" : ""}</p>
                </div>
                <div className="text-right">
                  {i.estimate != null && <p className="tabular-nums">{rs(i.estimate)}</p>}
                  <button className={`text-xs ${C.soft} underline`} onClick={() => remove(i)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGEST.filter(([t]) => !have.has(t)).map(([t, l, q]) => <a key={t} href={`/celebrations?type=${q}${date ? `&date=${date}` : ""}${guests ? `&guests=${guests}` : ""}`} className={btnGhost}>+ Add {l}</a>)}
        </div>

        {items.length > 0 && (
          <section className={`mt-10 rounded-3xl border ${C.line} bg-white p-6`}>
            {mismatch && <p className="mb-4 rounded-xl bg-[#FBEAEA] p-3 text-sm text-[#9B2C2C]">Your plan has more than one date. Pick the day below, then open the others and choose the same day.</p>}
            <div className="grid gap-4 sm:grid-cols-3">
              <div><label className={labelCls} htmlFor="pl-d">Date</label><select id="pl-d" className={field} value={date} onChange={e => setDate(e.target.value)}>{dates.map(d => <option key={d} value={d}>{niceDate(d)}</option>)}</select></div>
              <div><label className={labelCls} htmlFor="pl-o">Occasion</label><select id="pl-o" className={field} value={occasion} onChange={e => setOccasion(e.target.value)}><option value="">Choose…</option>{OCCASIONS.map(o => <option key={o}>{o}</option>)}</select></div>
              <div><label className={labelCls} htmlFor="pl-g">Guests</label><input id="pl-g" className={field} inputMode="numeric" value={guests} onChange={e => setGuests(e.target.value.replace(/\D/g, ""))} /></div>
              <div><label className={labelCls} htmlFor="pl-n">Your name</label><input id="pl-n" className={field} autoComplete="name" value={who.name} onChange={e => setWho({ ...who, name: e.target.value })} /></div>
              <div><label className={labelCls} htmlFor="pl-p">Mobile</label><input id="pl-p" className={field} inputMode="tel" autoComplete="tel" value={who.phone} onChange={e => setWho({ ...who, phone: e.target.value })} /></div>
              <div><label className={labelCls} htmlFor="pl-e">Email (optional)</label><input id="pl-e" className={field} type="email" autoComplete="email" value={who.email} onChange={e => setWho({ ...who, email: e.target.value })} /></div>
              <div className="sm:col-span-3"><label className={labelCls} htmlFor="pl-x">Anything everyone should know</label><textarea id="pl-x" rows={2} className={`${field} h-auto py-2`} maxLength={1000} value={who.notes} onChange={e => setWho({ ...who, notes: e.target.value })} /></div>
            </div>
            {total > 0 && <p className={`mt-4 ${C.soft}`}>Prices shown add up to <span className="text-xl text-[#231B16]" style={display}>{rs(total)}</span> with GST. Planners and photographers confirm theirs in a quotation.</p>}
            {err && <p role="alert" className="mt-4 rounded-xl bg-[#FBEAEA] p-3 text-sm text-[#9B2C2C]">{err}</p>}
            {problems.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-[#9B2C2C]">{problems.map(p => <li key={p.code}>{items.find(i => i.code === p.code)?.name}: {p.message}</li>)}</ul>}
            <button className={`${btnAccent} mt-6 w-full sm:w-auto`} disabled={!ready || sending} onClick={send}>{sending ? "Sending…" : `Send to all ${items.length}`}</button>
          </section>
        )}
      </div>
    </Shell>
  );
}

type PlanView = { name: string; occasion: string | null; eventDate: string; guests: number | null; estimate: number; items: Array<{ kind: string; partner: string; code: string; link: string; stage: string; total: number | null; paid: number; payUrl: string | null; payAmount: number | null; quotation: string | null; heldUntil: string | null; note: string | null }> };
const STAGE: Record<string, [string, string]> = {
  requested: ["Waiting for them to confirm", "bg-[#F6EFE6] text-[#6F625A]"], new: ["Waiting for them to confirm", "bg-[#F6EFE6] text-[#6F625A]"], quoted: ["Quotation ready", "bg-[#FFF3D6] text-[#7A5A12]"],
  pending: ["Date held — pay the advance", "bg-[#FFF3D6] text-[#7A5A12]"], confirmed: ["Confirmed", "bg-[#EAF4EC] text-[#24603A]"], completed: ["Done", "bg-[#EAF4EC] text-[#24603A]"],
  cancelled: ["Cancelled", "bg-[#FBEAEA] text-[#9B2C2C]"], closed: ["Not going ahead", "bg-[#FBEAEA] text-[#9B2C2C]"],
};

export function PlanStatusPage({ token }: { token: string }) {
  const q = useQuery<PlanView>({ queryKey: ["/api/public/celebrations/plan", token], queryFn: async () => (await apiRequest("GET", `/api/public/celebrations/plan/${encodeURIComponent(token)}`)).data, retry: false, refetchInterval: 30_000 });
  if (q.isLoading) return <Shell><Loading /></Shell>;
  if (!q.data) return <Shell><NotFoundCard title="We could not find this plan" /></Shell>;
  const v = q.data;
  const done = v.items.filter(i => ["confirmed", "completed"].includes(i.stage)).length;
  return (
    <Shell>
      <div className="mx-auto max-w-4xl px-4 py-12">
        <p className={`text-xs uppercase tracking-[0.2em] ${C.accent}`}>{v.name}'s plan · {v.occasion}</p>
        <h1 className="mt-2 text-4xl" style={display}>{niceDate(v.eventDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h1>
        <p className={`mt-2 ${C.soft}`}>{done} of {v.items.length} confirmed{v.guests ? ` · ${v.guests} guests` : ""}{v.estimate ? ` · about ${rs(v.estimate)} in all` : ""}. Keep this page — it updates as each one answers.</p>
        <ul className="mt-8 space-y-3">
          {v.items.map(i => {
            const [label, cls] = STAGE[i.stage] ?? [i.stage, "bg-[#F6EFE6]"];
            return (
              <li key={i.link} className={`rounded-2xl border ${C.line} bg-white p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><p className={`text-xs uppercase tracking-wider ${C.accent}`}>{i.kind === "hall" ? "Hall" : i.kind === "shoot" ? "Photographer" : "Event planner"}</p><p className="text-xl" style={display}>{i.partner}</p>{i.note && <p className={`mt-1 text-sm ${C.soft}`}>{i.note}</p>}</div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${cls}`}>{label}</span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {i.payUrl && <a href={i.payUrl} className={btnAccent}>Pay {rs(i.payAmount)}</a>}
                  {i.quotation && i.stage === "quoted" && <a href={i.quotation} className={btnPrimary}>See the quotation</a>}
                  <a href={i.link} className={btnGhost}>Details</a>
                  {i.total != null && <span className={`text-sm ${C.soft}`}>{rs(i.total)}{i.paid ? ` · ${rs(i.paid)} paid` : ""}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Shell>
  );
}
