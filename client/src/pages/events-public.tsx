/**
 * Public event pages — no login.
 *
 *   /events/<partner code>   the planner's packages and an enquiry form
 *   /events/q/<token>        a quotation: every line, PDF, accept or decline
 *   /events/e/<token>        an enquiry's status, with the quotation once sent
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

const rs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const CAT: Record<string, string> = { venue: "Venue", decor: "Décor", catering: "Catering", av: "Sound & light", photography: "Photography", staff: "Staff", other: "Other" };

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-surface-0 noise-overlay px-4 py-10"><div className="mx-auto max-w-2xl">{children}<p className="mt-10 text-center text-xs text-[hsl(215,20%,50%)]">Through UniteFix Partner Hub</p></div></div>;
}

function EnquiryPage({ code }: { code: string }) {
  const p = useQuery<{ name: string; city: string | null; packages: Array<{ name: string; category: string; unit: string; price: number; description: string | null }> }>({ queryKey: ["/api/public/events", code], queryFn: async () => (await apiRequest("GET", `/api/public/events/${encodeURIComponent(code)}`)).data, retry: false });
  const [f, setF] = useState({ name: "", phone: "", email: "", eventType: "", eventDate: "", guests: "", venue: "", budgetRupees: "", message: "" });
  const [done, setDone] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/public/events/${encodeURIComponent(code)}/enquire`, { name: f.name, phone: f.phone, email: f.email || null, eventType: f.eventType, eventDate: f.eventDate || null, guests: f.guests ? Number(f.guests) : null, venue: f.venue || null, budgetRupees: f.budgetRupees ? Number(f.budgetRupees) : null, message: f.message || null })) as any,
    onSuccess: (r: any) => setDone(r.data.link),
  });
  if (p.isError) return <Shell><h1 className="text-2xl font-semibold text-white">This page is not available.</h1></Shell>;
  if (!p.data) return <Shell><p className="text-[hsl(215,20%,65%)]">Loading…</p></Shell>;
  if (done) return <Shell><h1 className="text-2xl font-semibold text-white">Enquiry sent</h1><p className="mt-2 text-[hsl(215,20%,70%)]">{p.data.name} will reply with a quotation. Keep this link to follow it:</p><a href={done} className="mt-3 inline-block break-all text-[hsl(174,72%,60%)] underline">{window.location.origin}{done}</a></Shell>;
  const cats = Array.from(new Set(p.data.packages.map(x => x.category)));
  const ok = f.name.trim().length >= 2 && f.phone.replace(/\D/g, "").length >= 10 && f.eventType.trim().length >= 2;
  return (
    <Shell>
      <p className="text-xs font-mono uppercase tracking-widest text-[hsl(174,72%,55%)]">Plan your event</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">{p.data.name}</h1>
      {p.data.city && <p className="text-[hsl(215,20%,65%)]">{p.data.city}</p>}
      {cats.length > 0 && <section className="mt-6 space-y-3">{cats.map(c => (
        <div key={c}><h2 className="text-sm font-semibold text-white">{CAT[c] ?? c}</h2>
          <ul className="mt-1 space-y-1 text-sm">{p.data!.packages.filter(x => x.category === c).map((x, i) => <li key={i} className="flex justify-between gap-3 text-[hsl(215,20%,75%)]"><span>{x.name}{x.description ? ` — ${x.description}` : ""}</span><span className="tabular-nums text-white">{rs(x.price)}/{x.unit}</span></li>)}</ul></div>
      ))}<p className="text-xs text-[hsl(215,20%,55%)]">Prices before GST. Your quotation is tailored to your event.</p></section>}
      <section className="mt-8 grid gap-3 sm:grid-cols-2" aria-labelledby="h-enq">
        <h2 id="h-enq" className="sm:col-span-2 text-sm font-semibold text-white">Tell us about your event</h2>
        <div><Label htmlFor="pe-t">What is the occasion?</Label><Input id="pe-t" placeholder="Wedding reception" value={f.eventType} onChange={e => setF({ ...f, eventType: e.target.value })} /></div>
        <div><Label htmlFor="pe-d">Date</Label><Input id="pe-d" type="date" min={today()} value={f.eventDate} onChange={e => setF({ ...f, eventDate: e.target.value })} /></div>
        <div><Label htmlFor="pe-g">Guests</Label><Input id="pe-g" inputMode="numeric" value={f.guests} onChange={e => setF({ ...f, guests: e.target.value })} /></div>
        <div><Label htmlFor="pe-b">Budget ₹ (optional)</Label><Input id="pe-b" inputMode="numeric" value={f.budgetRupees} onChange={e => setF({ ...f, budgetRupees: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label htmlFor="pe-v">Venue or city</Label><Input id="pe-v" value={f.venue} onChange={e => setF({ ...f, venue: e.target.value })} /></div>
        <div><Label htmlFor="pe-n">Your name</Label><Input id="pe-n" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
        <div><Label htmlFor="pe-p">Mobile</Label><Input id="pe-p" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label htmlFor="pe-e">Email (optional)</Label><Input id="pe-e" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label htmlFor="pe-m">Anything else?</Label><Textarea id="pe-m" rows={3} value={f.message} onChange={e => setF({ ...f, message: e.target.value })} /></div>
        {send.isError && <p role="alert" className="sm:col-span-2 text-sm text-rose-300">{apiErrorMessage(send.error)}</p>}
        <div className="sm:col-span-2"><Button disabled={!ok || send.isPending} onClick={() => send.mutate()}>{send.isPending ? "Sending…" : "Send enquiry"}</Button></div>
      </section>
    </Shell>
  );
}

type PublicQuote = { token: string; replaced: boolean; number: string; version: number; status: string; validUntil: string | null; partner: string; partnerPhone: string | null; customer: string; lines: Array<{ description: string; quantity: number; unit: string | null; rate: number; gstRate: number; value: number }>; taxable: number; tax: number; total: number; notes: string | null; terms: string | null; expired: boolean };

function QuotePage({ token }: { token: string }) {
  const q = useQuery<PublicQuote>({ queryKey: ["/api/public/events/q", token], queryFn: async () => (await apiRequest("GET", `/api/public/events/q/${encodeURIComponent(token)}`)).data, retry: false });
  const [note, setNote] = useState("");
  const respond = useMutation({ mutationFn: async (decision: "accept" | "decline") => apiRequest("POST", `/api/public/events/q/${encodeURIComponent(q.data!.token)}/respond`, { decision, note: note || null }), onSuccess: () => q.refetch() });
  if (q.isError) return <Shell><h1 className="text-2xl font-semibold text-white">Quotation not found.</h1></Shell>;
  if (!q.data) return <Shell><p className="text-[hsl(215,20%,65%)]">Loading…</p></Shell>;
  const d = q.data;
  const open = ["sent", "draft"].includes(d.status) && !d.expired;
  return (
    <Shell>
      <p className="text-xs font-mono uppercase tracking-widest text-[hsl(174,72%,55%)]">Quotation {d.number}{d.version > 1 ? ` · version ${d.version}` : ""}</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">{d.partner}</h1>
      <p className="text-[hsl(215,20%,65%)]">For {d.customer}{d.validUntil ? ` · valid until ${d.validUntil}` : ""}</p>
      {d.replaced && <p className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200">This quotation was revised. You are looking at the latest version.</p>}
      <div className="mt-6 overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-[hsl(215,20%,55%)]"><th className="py-2">Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">GST</th><th className="text-right">Value</th></tr></thead>
        <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{d.lines.map((l, i) => <tr key={i}><td className="py-2 text-white">{l.description}</td><td className="text-right">{l.quantity}{l.unit ? ` ${l.unit}` : ""}</td><td className="text-right tabular-nums">{rs(l.rate)}</td><td className="text-right">{l.gstRate}%</td><td className="text-right tabular-nums">{rs(l.value)}</td></tr>)}</tbody>
      </table></div>
      <p className="mt-3 text-right text-sm text-[hsl(215,20%,75%)]">Value {rs(d.taxable)} · GST {rs(d.tax)} · <span className="text-lg font-semibold text-white">Total {rs(d.total)}</span></p>
      {(d.notes || d.terms) && <p className="mt-3 whitespace-pre-wrap text-xs text-[hsl(215,20%,60%)]">{[d.notes, d.terms].filter(Boolean).join("\n")}</p>}
      <a className="mt-4 inline-block text-sm text-[hsl(174,72%,60%)] underline" href={`/api/public/events/q/${encodeURIComponent(d.token)}/pdf`} target="_blank" rel="noreferrer">Download PDF</a>
      <div className="mt-8">
        {d.status === "accepted" && <p className="text-lg text-emerald-300">You accepted this quotation. {d.partner} will confirm the booking and the advance.</p>}
        {d.status === "declined" && <p className="text-lg text-[hsl(215,20%,70%)]">You declined this quotation.</p>}
        {["invoiced"].includes(d.status) && <p className="text-lg text-emerald-300">Booked and invoiced.</p>}
        {d.expired && ["sent", "draft"].includes(d.status) && <p className="text-[hsl(215,20%,70%)]">This quotation has expired. Ask {d.partner} for a fresh one{d.partnerPhone ? ` — ${d.partnerPhone}` : ""}.</p>}
        {open && <div className="space-y-3">
          <div><Label htmlFor="q-note">A note for {d.partner} (optional)</Label><Textarea id="q-note" rows={2} value={note} onChange={e => setNote(e.target.value)} /></div>
          {respond.isError && <p role="alert" className="text-sm text-rose-300">{apiErrorMessage(respond.error)}</p>}
          <div className="flex gap-2"><Button disabled={respond.isPending} onClick={() => respond.mutate("accept")}>Accept quotation</Button><Button variant="outline" disabled={respond.isPending} onClick={() => { if (window.confirm("Decline this quotation?")) respond.mutate("decline"); }}>Decline</Button></div>
        </div>}
      </div>
    </Shell>
  );
}

function StatusPage({ token }: { token: string }) {
  const q = useQuery<{ partner: string; eventType: string; eventDate: string | null; status: string; quotation: string | null }>({ queryKey: ["/api/public/events/e", token], queryFn: async () => (await apiRequest("GET", `/api/public/events/e/${encodeURIComponent(token)}`)).data, retry: false });
  if (q.isError) return <Shell><h1 className="text-2xl font-semibold text-white">Enquiry not found.</h1></Shell>;
  if (!q.data) return <Shell><p className="text-[hsl(215,20%,65%)]">Loading…</p></Shell>;
  const L: Record<string, string> = { new: "Received", contacted: "In discussion", quoted: "Quotation ready", won: "Booked", lost: "Closed" };
  return (
    <Shell>
      <p className="text-xs font-mono uppercase tracking-widest text-[hsl(174,72%,55%)]">{L[q.data.status] ?? q.data.status}</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">{q.data.eventType}</h1>
      <p className="text-[hsl(215,20%,65%)]">with {q.data.partner}{q.data.eventDate ? ` · ${q.data.eventDate}` : ""}</p>
      {q.data.quotation ? <a href={q.data.quotation} className="mt-6 inline-block rounded-lg bg-[hsl(174,72%,38%)] px-5 py-2.5 font-medium text-white">View your quotation</a> : <p className="mt-6 text-[hsl(215,20%,70%)]">Your quotation will appear here.</p>}
    </Shell>
  );
}

export default function EventsPublicRouter() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[1] === "q" && parts[2]) return <QuotePage token={parts[2]} />;
  if (parts[1] === "e" && parts[2]) return <StatusPage token={parts[2]} />;
  return <EnquiryPage code={parts[1] ?? ""} />;
}
