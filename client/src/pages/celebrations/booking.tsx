/**
 * /celebrations/b/<token> — the client's own page for a hall, photography or
 * event booking: where the request stands, what is paid and due (with the
 * payment link), the cancellation terms, and — after the event — a review.
 * The token is the key; no sign-in.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { C, display, rs, niceDate, Shell, NotFoundCard, Loading, btnAccent, btnGhost, btnPrimary, field, labelCls } from "@/components/celebrations/kit";

type View = {
  kind: string; partner: { name: string; phone: string | null; page: string; city: string | null };
  occasion: string; eventDate: string | null; guests: number | null; status: string; lostReason: string | null; selection: any; heldUntil: string | null;
  quotation: string | null; quotationStatus: string | null; basketToken: string | null;
  booking: null | {
    id: number; status: string; title: string; eventDate: string; slot: string | null; slotName: string | null; space: string | null; guests: number | null; total: number; paid: number; holdExpiresAt: string | null;
    deposit: { amount: number; status: string } | null; cancellation: string[] | null;
    milestones: Array<{ label: string; amount: number; dueDate: string | null; status: string; paidOn: string | null; payUrl: string | null }>;
    cancelRequestedAt: string | null; cancelledReason: string | null; canCancel: boolean; refundIfCancelledNow: { percent: number; amount: number } | null;
    canReview: boolean; review: { rating: number; body: string | null; reply: string | null; status: string } | null;
  };
};

function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!until) return; const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, [until]);
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return "a moment";
  const h = Math.floor(ms / 3600_000), m = Math.floor((ms % 3600_000) / 60_000);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export default function BookingStatusPage({ token }: { token: string }) {
  const q = useQuery<View>({ queryKey: ["/api/public/celebrations/b", token], queryFn: async () => (await apiRequest("GET", `/api/public/celebrations/b/${encodeURIComponent(token)}`)).data, retry: false, refetchInterval: 20_000 });
  const v = q.data;
  const b = v?.booking ?? null;
  const left = useCountdown(b?.status === "pending" ? b.holdExpiresAt : v?.heldUntil ?? null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Straight from booking: open the payment for the advance.
    if (b && new URLSearchParams(window.location.search).get("pay") === "1") {
      const due = b.milestones.find(m => m.payUrl);
      if (due && b.status === "pending") { window.history.replaceState(null, "", window.location.pathname); window.location.href = due.payUrl!; }
    }
    if (window.location.hash === "#review") setTimeout(() => document.getElementById("review")?.scrollIntoView({ behavior: "smooth" }), 300);
  }, [b?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <Shell><Loading /></Shell>;
  if (!v) return <Shell><NotFoundCard title="We could not find this booking">Check the link in your message, or contact the business.</NotFoundCard></Shell>;

  const sel = v.selection ?? {};
  const kindLabel = v.kind === "hall" ? "Hall booking" : v.kind === "shoot" ? "Photography" : "Event";
  const step = b ? (b.status === "cancelled" ? -1 : b.status === "pending" ? 1 : b.status === "completed" || (b.eventDate < new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)) ? 3 : 2) : v.status === "lost" ? -1 : v.quotation ? 1 : 0;
  const steps = v.kind === "hall" ? ["Requested", "Date held", "Confirmed", "Celebrated"] : ["Requested", "Quotation", "Confirmed", "Celebrated"];
  const headline = b?.status === "cancelled" || v.status === "lost" ? "Not going ahead"
    : !b ? (v.quotation ? "Your quotation is ready" : v.kind === "hall" ? "Waiting for the hall to confirm" : "Request sent")
    : b.status === "pending" ? "Your date is held" : b.status === "completed" ? "Thank you for celebrating with us" : "You're booked";

  const act = async (path: string, body: unknown, ok: (r: any) => void) => {
    setBusy(true); setErr(null);
    try { const r = await apiRequest("POST", `/api/public/celebrations/b/${encodeURIComponent(token)}/${path}`, body); ok(r); q.refetch(); } catch (e) { setErr(apiErrorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className={`text-xs uppercase tracking-[0.2em] ${C.accent}`}>{kindLabel} · {v.partner.name}</p>
        <h1 className="mt-2 text-4xl" style={{ ...display, textWrap: "balance" as any }}>{headline}</h1>
        <p className={`mt-2 ${C.soft}`}>{v.occasion}{v.eventDate ? ` · ${niceDate(v.eventDate)}` : ""}{b?.slotName ? ` · ${b.slotName}` : ""}{(b?.space ?? sel.space) ? ` · ${b?.space ?? sel.space}` : ""}{v.guests ? ` · ${v.guests} guests` : ""}</p>

        {step >= 0 && (
          <ol className="mt-8 grid grid-cols-4 gap-2" aria-label="Progress">
            {steps.map((s, i) => (
              <li key={s} className="text-center">
                <span className={`mx-auto block h-1.5 rounded-full ${i <= step ? "bg-[#B5562B]" : "bg-[#EADFD2]"}`} />
                <span className={`mt-2 block text-xs ${i <= step ? "text-[#231B16]" : C.faint}`}>{s}</span>
              </li>
            ))}
          </ol>
        )}

        {msg && <p role="status" className="mt-6 rounded-2xl bg-[#EAF4EC] p-4 text-[#24603A]">{msg}</p>}
        {err && <p role="alert" className="mt-6 rounded-2xl bg-[#FBEAEA] p-4 text-[#9B2C2C]">{err}</p>}

        {(v.status === "lost" && !b) && <p className="mt-8 rounded-2xl border border-[#E9DFD3] bg-white p-5">{v.lostReason ?? "This request did not go ahead."} <a href={v.partner.page} className={`${C.accent} underline`}>See other dates</a></p>}
        {b?.status === "cancelled" && <p className="mt-8 rounded-2xl border border-[#E9DFD3] bg-white p-5">{b.cancelledReason ?? "This booking was cancelled."}</p>}

        {b?.status === "pending" && (
          <div className="mt-8 rounded-3xl bg-[#231B16] p-6 text-[#FBF7F1]">
            <p className="text-lg" style={display}>Pay the advance to confirm</p>
            <p className="mt-1 text-sm text-white/75">Your date is held for you for {left ?? "a little while"}. After that it is released for others.</p>
            {b.milestones.filter(m => m.payUrl).slice(0, 1).map(m => <a key={m.label} href={m.payUrl!} className="mt-4 inline-flex h-12 items-center rounded-full bg-[#E8A35A] px-6 font-medium text-[#231B16] hover:bg-[#f0b373]">Pay {rs(m.amount)} now</a>)}
          </div>
        )}
        {!b && v.heldUntil && v.status !== "lost" && <p className="mt-8 rounded-2xl border border-[#E9DFD3] bg-white p-5">The date is held for you while {v.partner.name} confirms — for up to {left}. You'll get a message when they answer; nothing is due until then.</p>}
        {!b && v.quotation && v.status !== "lost" && <a href={v.quotation} className={`${btnPrimary} mt-6`}>Open your quotation</a>}

        {b && (
          <section className="mt-10 rounded-3xl border border-[#E9DFD3] bg-white p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-2xl" style={display}>Payments</h2>
              <p className="tabular-nums"><span className={C.soft}>Paid</span> {rs(b.paid)} <span className={C.faint}>of</span> {rs(b.total)}</p>
            </div>
            <ul className="mt-4 divide-y divide-[#F0E7DC]">
              {b.milestones.map(m => (
                <li key={m.label} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div><p className="font-medium">{m.label}</p><p className={`text-sm ${C.soft}`}>{m.status === "paid" ? `Paid ${niceDate(m.paidOn)}` : m.dueDate ? `Due ${niceDate(m.dueDate)}` : "Due"}</p></div>
                  <div className="flex items-center gap-3 tabular-nums">{rs(m.amount)}{m.status === "paid" ? <span className="rounded-full bg-[#EAF4EC] px-3 py-1 text-xs text-[#24603A]">Paid</span> : m.payUrl ? <a href={m.payUrl} className={`${btnAccent} h-9 px-4`}>Pay</a> : <span className={`text-xs ${C.faint}`}>{b.status === "pending" ? "After the advance" : "Pay the business"}</span>}</div>
                </li>
              ))}
            </ul>
            {b.deposit && <p className={`mt-3 text-sm ${C.soft}`}>Refundable security deposit {rs(b.deposit.amount)} — paid to and returned by {v.partner.name} ({b.deposit.status}).</p>}
            {v.quotation && <a href={v.quotation} className={`mt-3 inline-block text-sm ${C.accent} underline`}>See the full quotation</a>}
          </section>
        )}

        {sel.items?.length > 0 && (
          <section className="mt-6 rounded-3xl border border-[#E9DFD3] bg-white p-6">
            <h2 className="text-xl" style={display}>What you asked for</h2>
            <ul className="mt-3 space-y-1 text-sm tabular-nums">{sel.ownVenue && <li>At: {sel.ownVenue}</li>}{sel.items.map((i: any, n: number) => <li key={n} className="flex justify-between gap-3"><span>{i.name}{i.quantity > 1 ? ` × ${i.quantity}` : ""}</span><span>{rs(i.amount)}</span></li>)}</ul>
            {sel.estimate && <p className={`mt-3 border-t border-[#F0E7DC] pt-2 text-sm ${C.soft}`}>Price shown {rs(sel.estimate.total)} incl. GST</p>}
            {(sel.notes || sel.customization) && <p className={`mt-2 text-sm ${C.soft}`}>“{sel.notes ?? sel.customization}”</p>}
          </section>
        )}

        {b?.canReview && (
          <section id="review" className="mt-6 scroll-mt-24 rounded-3xl border border-[#E9DFD3] bg-white p-6">
            <h2 className="text-2xl" style={display}>How was it?</h2>
            <p className={`mt-1 text-sm ${C.soft}`}>Your review helps other families choose — and {v.partner.name} reads every one.</p>
            <div className="mt-4 flex gap-1" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map(n => <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => setRating(n)} className={`text-4xl transition ${n <= rating ? "text-[#B98B2E]" : "text-[#E3D6C6] hover:text-[#d9c4a0]"}`}>★</button>)}
            </div>
            <label className={`${labelCls} mt-4`} htmlFor="rv">Tell others about it</label>
            <textarea id="rv" rows={4} maxLength={1500} className={`${field} h-auto py-2`} placeholder="The hall was spotless and the staff helped with everything…" value={text} onChange={e => setText(e.target.value)} />
            <button className={`${btnPrimary} mt-4`} disabled={!rating || busy} onClick={() => act("review", { rating, body: text || null }, r => setMsg(r.message))}>Publish review</button>
          </section>
        )}
        {b?.review && (
          <section className="mt-6 rounded-3xl border border-[#E9DFD3] bg-white p-6">
            <h2 className="text-xl" style={display}>Your review</h2>
            <p className="mt-2 text-2xl text-[#B98B2E]">{"★".repeat(b.review.rating)}<span className="text-[#E3D6C6]">{"★".repeat(5 - b.review.rating)}</span></p>
            {b.review.body && <p className="mt-2">{b.review.body}</p>}
            {b.review.reply && <p className={`mt-3 border-l-2 border-[#E2D6C8] pl-3 text-sm ${C.soft}`}><span className="font-medium text-[#231B16]">{v.partner.name}:</span> {b.review.reply}</p>}
          </section>
        )}

        {b?.cancellation && b.status !== "cancelled" && (
          <section className="mt-6 rounded-3xl border border-[#E9DFD3] bg-white p-6">
            <h2 className="text-xl" style={display}>If plans change</h2>
            <ul className={`mt-2 list-disc space-y-1 pl-5 text-sm ${C.soft}`}>{b.cancellation.map(t => <li key={t}>{t}</li>)}</ul>
            {b.cancelRequestedAt && <p className="mt-3 text-sm">You asked to cancel on {new Date(b.cancelRequestedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}. {v.partner.name} will process it and your refund under these terms.</p>}
          </section>
        )}
        {(b?.canCancel || (!b && v.status !== "lost" && ["new", "contacted", "quoted"].includes(v.status))) && (
          <div className="mt-6">
            {!cancelOpen ? <button className={`text-sm ${C.soft} underline`} onClick={() => setCancelOpen(true)}>{b ? "Cancel this booking" : "Withdraw this request"}</button> : (
              <div className="rounded-3xl border border-[#E9DFD3] bg-white p-6">
                <p className="font-medium">{b ? (b.status === "pending" ? "Cancel before paying? The date is released straight away." : `Ask ${v.partner.name} to cancel?`) : "Withdraw your request?"}</p>
                {b?.refundIfCancelledNow && <p className={`mt-1 text-sm ${C.soft}`}>Under the terms, cancelling today gives {b.refundIfCancelledNow.percent}% back: {rs(b.refundIfCancelledNow.amount)} of the {rs(b.paid)} paid.</p>}
                <label className={`${labelCls} mt-3`} htmlFor="cn">Reason (optional)</label>
                <input id="cn" className={field} maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
                <div className="mt-4 flex flex-wrap gap-3">
                  <button className={btnPrimary} disabled={busy} onClick={() => act("cancel", { note: note || null }, r => { setMsg(r.message); setCancelOpen(false); })}>{b ? "Yes, cancel" : "Yes, withdraw"}</button>
                  <button className={btnGhost} onClick={() => setCancelOpen(false)}>Keep it</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className={`mt-12 flex flex-wrap items-center gap-4 border-t border-[#E9DFD3] pt-6 text-sm ${C.soft}`}>
          <a href={v.partner.page} className="underline">{v.partner.name}'s page</a>
          {v.partner.phone && <span>Questions? Call <a href={`tel:${v.partner.phone}`} className="underline">{v.partner.phone}</a></span>}
          {v.basketToken && <a href={`/celebrations/plan/${v.basketToken}`} className="underline">Your whole plan</a>}
        </div>
      </div>
    </Shell>
  );
}
