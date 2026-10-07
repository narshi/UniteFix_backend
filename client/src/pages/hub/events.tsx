/**
 * Events — enquiries → quotation (accepted by the client's link) → booking
 * with advances → vendors → final invoice. Plus packages and a calendar.
 */

import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useHubMe, hubCan, inr, openAuthedPdf } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty, Stat, HubSelect, Thead } from "@/components/hub/ui";
import { PayLinkButton } from "@/components/hub/PayLink";

type Pkg = { id: number; name: string; category: string; description: string | null; unit: string; price: number; sac: string; gstRate: number; isActive: boolean };
type Enquiry = { id: number; source: string; eventType: string; eventDate: string | null; guests: number | null; venue: string | null; budget: number | null; message: string | null; status: string; lostReason: string | null; customerId: number; customerName: string; customerPhone: string | null; createdAt: string; statusLink: string };
type BookingRow = { id: number; title: string; eventDate: string; venue: string | null; guests: number | null; status: string; total: number; paid: number; vendorCost: number; customerName: string; customerPhone: string | null; invoiced: boolean };
type Vendor = { id: number; name: string; category: string; phone: string | null; gstin: string | null; notes: string | null; isActive: boolean };

const CATS = ["venue", "decor", "catering", "av", "photography", "staff", "other"];
const CAT_LABEL: Record<string, string> = { venue: "Venue", decor: "Décor", catering: "Catering", av: "Sound & light", photography: "Photography", staff: "Staff", other: "Other" };
const E_TONE: Record<string, string> = { new: "warn", contacted: "info", quoted: "info", won: "good", lost: "muted" };
const SRC: Record<string, string> = { app: "UniteFix app", public: "your page", hub: "added by you" };
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const nice = (d: string | null) => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const useFail = () => { const { toast } = useToast(); return (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" }); };
const copy = (s: string) => navigator.clipboard?.writeText(s);
const linkBtn = "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium";

export function usePackages() { return useQuery<Pkg[]>({ queryKey: ["/api/hub/events/packages"], queryFn: async () => (await apiRequest("GET", "/api/hub/events/packages")).data }); }

// ═══════════════════════════════════════════════════════════════════════════
// Enquiries (with the quote builder)
// ═══════════════════════════════════════════════════════════════════════════

export function HubEventEnquiries() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = useFail();
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuery<Enquiry[]>({ queryKey: ["/api/hub/events/enquiries", status], queryFn: async () => (await apiRequest("GET", `/api/hub/events/enquiries${status ? `?status=${status}` : ""}`)).data });
  const pk = usePackages();
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/hub/events/enquiries"] });
  const [addOpen, setAddOpen] = useState(false);
  const [n, setN] = useState({ name: "", phone: "", eventType: "", eventDate: "", guests: "", venue: "", budgetRupees: "", message: "" });
  const [quoteFor, setQuoteFor] = useState<Enquiry | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [made, setMade] = useState<{ id: number; number: string; total: number } | null>(null);
  const pageLink = me ? `${window.location.origin}/events/${me.partnerCode}` : "";

  const add = async () => {
    try {
      await apiRequest("POST", "/api/hub/events/enquiries", { name: n.name, phone: n.phone, eventType: n.eventType, eventDate: n.eventDate || null, guests: n.guests ? Number(n.guests) : null, venue: n.venue || null, budgetRupees: n.budgetRupees ? Number(n.budgetRupees) : null, message: n.message || null });
      refresh(); setAddOpen(false); toast({ title: "Enquiry added" });
    } catch (e) { fail("Not added")(e); }
  };
  const setSt = async (e: Enquiry, s: string) => {
    const lostReason = s === "lost" ? window.prompt("Why was it lost?") : undefined;
    if (s === "lost" && lostReason === null) return;
    try { await apiRequest("PATCH", `/api/hub/events/enquiries/${e.id}`, { status: s, ...(lostReason !== undefined ? { lostReason } : {}) }); refresh(); } catch (x) { fail("Not changed")(x); }
  };
  const openQuote = (e: Enquiry) => {
    setQuoteFor(e); setMade(null);
    const q: Record<number, string> = {};
    (pk.data ?? []).filter(p => p.isActive).forEach(p => { q[p.id] = p.unit === "plate" && e.guests ? String(e.guests) : ""; });
    setQty(q);
  };
  const picks = (pk.data ?? []).filter(p => Number(qty[p.id]) > 0).map(p => ({ packageId: p.id, quantity: Number(qty[p.id]) }));
  const preview = (pk.data ?? []).reduce((a, p) => { const q = Number(qty[p.id]) || 0; const v = p.price * q; return { value: a.value + v, tax: a.tax + v * p.gstRate / 100 }; }, { value: 0, tax: 0 });
  const makeQuote = async () => {
    try { const r: any = await apiRequest("POST", `/api/hub/events/enquiries/${quoteFor!.id}/quote`, { packages: picks }); setMade(r.data); refresh(); qc.invalidateQueries({ queryKey: ["/api/hub/quotations"] }); }
    catch (e) { fail("Not created")(e); }
  };
  const share = async (id: number) => {
    try { const r: any = await apiRequest("POST", `/api/hub/events/quotations/${id}/share`, {}); const url = `${window.location.origin}${r.data.link}`; copy(url); toast({ title: "Client link copied", description: url }); }
    catch (e) { fail("Not shared")(e); }
  };

  return (
    <HubPage title="Enquiries" subtitle="Enquiries from your public page, the UniteFix customer app, or added by you. Quote from your packages and send the client a link to accept."
      actions={<Button onClick={() => { setN({ name: "", phone: "", eventType: "", eventDate: "", guests: "", venue: "", budgetRupees: "", message: "" }); setAddOpen(true); }}>Add enquiry</Button>}>
      <Panel title="Your enquiry page">
        <div className="flex flex-wrap items-center gap-2"><code className="break-all rounded bg-white/5 px-2 py-1 text-sm text-white">{pageLink}</code><Button size="sm" variant="outline" onClick={() => { copy(pageLink); toast({ title: "Link copied" }); }}>Copy</Button>
          <span className="text-xs text-[hsl(215,20%,60%)]">UniteFix app customers near you can also find you under "Plan an event".</span></div>
      </Panel>
      <Panel actions={<HubSelect aria-label="Status" value={status} onChange={setStatus}><option value="">All</option>{Object.keys(E_TONE).map(s => <option key={s} value={s}>{s}</option>)}</HubSelect>}>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !data?.length ? <Empty icon="celebration" title="No enquiries yet">Share your page link to start receiving them.</Empty> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)]">{data.map(e => (
            <li key={e.id} className="grid gap-2 py-3 lg:grid-cols-[1fr_auto]">
              <div className="text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-white">{e.eventType}</span><Chip tone={E_TONE[e.status]}>{e.status}</Chip><Chip>{SRC[e.source]}</Chip></div>
                <p className="mt-0.5 text-[hsl(215,20%,70%)]">{e.customerName}{e.customerPhone ? ` · ${e.customerPhone}` : ""} · {nice(e.eventDate)}{e.guests ? ` · ${e.guests} guests` : ""}{e.venue ? ` · ${e.venue}` : ""}{e.budget ? ` · budget ${inr(e.budget)}` : ""}</p>
                {e.message && <p className="mt-0.5 text-xs text-[hsl(215,20%,60%)]">“{e.message}”</p>}
                {e.lostReason && <p className="mt-0.5 text-xs text-rose-300">{e.lostReason}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-1 lg:justify-end">
                {e.status === "new" && <Button size="sm" variant="ghost" onClick={() => setSt(e, "contacted")}>Contacted</Button>}
                {["new", "contacted", "quoted"].includes(e.status) && <Button size="sm" onClick={() => openQuote(e)}>{e.status === "quoted" ? "New quotation" : "Quote"}</Button>}
                {["new", "contacted", "quoted"].includes(e.status) && <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => setSt(e, "lost")}>Lost</Button>}
                {e.status === "quoted" && <Link href="/partner/events/quotations" className="text-sm text-[hsl(174,72%,60%)] hover:text-white">Quotations →</Link>}
              </div>
            </li>
          ))}</ul>
        )}
      </Panel>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add an enquiry</DialogTitle><DialogDescription>For a client who called or walked in.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="en-n">Client name</Label><Input id="en-n" value={n.name} onChange={e => setN({ ...n, name: e.target.value })} /></div>
            <div><Label htmlFor="en-p">Mobile</Label><Input id="en-p" inputMode="tel" value={n.phone} onChange={e => setN({ ...n, phone: e.target.value })} /></div>
            <div><Label htmlFor="en-t">Event</Label><Input id="en-t" placeholder="Wedding reception" value={n.eventType} onChange={e => setN({ ...n, eventType: e.target.value })} /></div>
            <div><Label htmlFor="en-d">Date</Label><Input id="en-d" type="date" min={today()} value={n.eventDate} onChange={e => setN({ ...n, eventDate: e.target.value })} /></div>
            <div><Label htmlFor="en-g">Guests</Label><Input id="en-g" inputMode="numeric" value={n.guests} onChange={e => setN({ ...n, guests: e.target.value })} /></div>
            <div><Label htmlFor="en-b">Budget ₹</Label><Input id="en-b" inputMode="numeric" value={n.budgetRupees} onChange={e => setN({ ...n, budgetRupees: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="en-v">Venue / city</Label><Input id="en-v" value={n.venue} onChange={e => setN({ ...n, venue: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="en-m">Notes</Label><Textarea id="en-m" rows={2} value={n.message} onChange={e => setN({ ...n, message: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={add} disabled={!n.name.trim() || n.phone.replace(/\D/g, "").length < 10 || !n.eventType.trim()}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!quoteFor} onOpenChange={o => !o && setQuoteFor(null)}>
        <DialogContent className="max-w-2xl">
          {quoteFor && <>
            <DialogHeader><DialogTitle>Quote: {quoteFor.eventType} for {quoteFor.customerName}</DialogTitle><DialogDescription>Pick packages and quantities. You can fine-tune lines afterwards in Sales → Quotations.</DialogDescription></DialogHeader>
            {made ? (
              <div className="space-y-3 text-sm">
                <p className="text-white">Quotation {made.number} drafted for {inr(made.total)}.</p>
                <div className="flex flex-wrap gap-2"><Button onClick={() => share(made.id)}>Copy the client's link</Button><Link href={`/partner/sales/quotations/${made.id}`} className={`${linkBtn} border border-[rgba(255,255,255,0.15)] text-white`}>Open / edit</Link></div>
              </div>
            ) : !(pk.data ?? []).some(p => p.isActive) ? <Empty icon="inventory" title="No packages yet"><Link href="/partner/events/packages" className="underline">Build your packages</Link> first.</Empty> : (
              <>
                <div className="max-h-[50vh] overflow-y-auto"><table className="w-full text-sm">
                  <Thead cols={["Package", ["Rate", "right"], ["Qty", "right"]]} />
                  <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{(pk.data ?? []).filter(p => p.isActive).map(p => (
                    <tr key={p.id}><td className="py-2 text-white">{p.name}<span className="block text-xs text-[hsl(215,20%,55%)]">{CAT_LABEL[p.category]} · per {p.unit} · {p.gstRate}% GST</span></td>
                      <td className="text-right tabular-nums">{inr(p.price)}</td>
                      <td className="text-right"><Input aria-label={`Quantity of ${p.name}`} className="ml-auto h-8 w-20" inputMode="decimal" value={qty[p.id] ?? ""} onChange={e => setQty({ ...qty, [p.id]: e.target.value })} /></td></tr>
                  ))}</tbody></table></div>
                <p className="text-right text-sm">Value {inr(preview.value)} · GST {inr(preview.tax)} · <span className="font-semibold text-white">Total {inr(preview.value + preview.tax)}</span></p>
              </>
            )}
            <DialogFooter><Button variant="outline" onClick={() => setQuoteFor(null)}>Close</Button>{!made && <Button disabled={!picks.length} onClick={makeQuote}>Create quotation</Button>}</DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Quotations (events) — share, and turn accepted ones into bookings
// ═══════════════════════════════════════════════════════════════════════════

type QuoteRow = { id: number; number: string; version: number; status: string; customerName?: string; total: number; validUntil: string | null; createdAt: string };

export function HubEventQuotations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = useFail();
  const { data, isLoading } = useQuery<QuoteRow[]>({ queryKey: ["/api/hub/quotations", "events"], queryFn: async () => (await apiRequest("GET", "/api/hub/quotations?source=events")).data });
  const rows = (data ?? []).filter(q => q.status !== "superseded");
  const [book, setBook] = useState<QuoteRow | null>(null);
  const [plan, setPlan] = useState({ title: "", eventDate: "", advance: "30" });
  const share = async (id: number) => {
    try { const r: any = await apiRequest("POST", `/api/hub/events/quotations/${id}/share`, {}); const url = `${window.location.origin}${r.data.link}`; copy(url); qc.invalidateQueries({ queryKey: ["/api/hub/quotations"] }); toast({ title: "Client link copied", description: url }); }
    catch (e) { fail("Not shared")(e); }
  };
  const confirm = async () => {
    const a = Number(plan.advance);
    try {
      const r: any = await apiRequest("POST", "/api/hub/events/bookings", {
        quotationId: book!.id, title: plan.title || undefined, eventDate: plan.eventDate || undefined,
        milestones: a > 0 && a < 100 ? [{ label: "Advance on booking", percent: a, dueDate: today() }, { label: "Balance before the event", percent: 100 - a }] : undefined,
      });
      qc.invalidateQueries({ queryKey: ["/api/hub/quotations"] }); qc.invalidateQueries({ queryKey: ["/api/hub/events/bookings"] }); setBook(null); toast({ title: "Booking confirmed", description: r.message });
    } catch (e) { fail("Not booked")(e); }
  };
  return (
    <HubPage title="Event quotations" subtitle="Quotations raised from enquiries. Copy a client link — they open it, see every line, and accept or decline. Revising a sent quotation makes a new version; the old link shows the latest.">
      <Panel>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !rows.length ? <Empty icon="request_quote" title="No event quotations yet">Quote from an enquiry.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <Thead cols={["Quotation", "Client", "Status", ["Total", "right"], ""]} />
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{rows.map(q => (
              <tr key={q.id}>
                <td className="py-2 pr-2"><Link href={`/partner/sales/quotations/${q.id}`} className="font-mono text-[hsl(174,72%,60%)] hover:text-white">{q.number}{q.version > 1 ? ` v${q.version}` : ""}</Link></td>
                <td className="pr-2 text-white">{q.customerName}</td>
                <td className="pr-2"><Chip tone={q.status === "accepted" ? "good" : q.status === "declined" ? "bad" : q.status === "invoiced" ? "good" : "info"}>{q.status}</Chip></td>
                <td className="pr-2 text-right tabular-nums">{inr(q.total)}</td>
                <td className="text-right whitespace-nowrap">
                  {["draft", "sent", "accepted"].includes(q.status) && <Button size="sm" variant="ghost" onClick={() => share(q.id)}>Copy client link</Button>}
                  {q.status === "accepted" && <Button size="sm" onClick={() => { setBook(q); setPlan({ title: "", eventDate: "", advance: "30" }); }}>Confirm booking</Button>}
                </td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
      <Dialog open={!!book} onOpenChange={o => !o && setBook(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Confirm booking</DialogTitle><DialogDescription>{book?.number} · {inr(book?.total ?? 0)}. The advance is due now; the balance 3 days before the event. You can record each payment as it comes.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="bk-t">Title</Label><Input id="bk-t" placeholder="Kavya wedding reception" value={plan.title} onChange={e => setPlan({ ...plan, title: e.target.value })} /></div>
            <div><Label htmlFor="bk-d">Event date (if not on the enquiry)</Label><Input id="bk-d" type="date" min={today()} value={plan.eventDate} onChange={e => setPlan({ ...plan, eventDate: e.target.value })} /></div>
            <div><Label htmlFor="bk-a">Advance %</Label><Input id="bk-a" inputMode="numeric" value={plan.advance} onChange={e => setPlan({ ...plan, advance: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setBook(null)}>Cancel</Button><Button onClick={confirm}>Confirm</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Bookings
// ═══════════════════════════════════════════════════════════════════════════

export function HubEventBookings() {
  const [past, setPast] = useState(false);
  const { data, isLoading } = useQuery<BookingRow[]>({ queryKey: ["/api/hub/events/bookings", past], queryFn: async () => (await apiRequest("GET", `/api/hub/events/bookings${past ? "" : `?from=${today()}`}`)).data });
  const rows = (data ?? []).slice().sort((a, b) => past ? b.eventDate.localeCompare(a.eventDate) : a.eventDate.localeCompare(b.eventDate));
  const due = (data ?? []).filter(b => b.status === "confirmed").reduce((a, b) => a + (b.total - b.paid), 0);
  return (
    <HubPage title="Bookings" subtitle="Confirmed events with their payment plan, vendors and event-day list.">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3"><Stat label="Upcoming events" value={(data ?? []).filter(b => b.status === "confirmed" && b.eventDate >= today()).length} /><Stat label="Still to collect" value={inr(due)} /></div>
      <Panel actions={<label className="flex items-center gap-2 text-xs text-[hsl(215,20%,65%)]"><input type="checkbox" checked={past} onChange={e => setPast(e.target.checked)} /> Include past events</label>}>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !rows.length ? <Empty icon="event_available" title="No bookings" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
            <Thead cols={["Date", "Event", "Client", "Status", ["Total", "right"], ["Received", "right"], ["Vendors", "right"]]} />
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{rows.map(b => (
              <tr key={b.id}>
                <td className="py-2 pr-2 whitespace-nowrap text-white">{nice(b.eventDate)}</td>
                <td className="pr-2"><Link href={`/partner/events/bookings/${b.id}`} className="text-[hsl(174,72%,60%)] hover:text-white">{b.title}</Link><span className="block text-xs text-[hsl(215,20%,55%)]">{[b.venue, b.guests ? `${b.guests} guests` : null].filter(Boolean).join(" · ")}</span></td>
                <td className="pr-2">{b.customerName}</td>
                <td className="pr-2"><Chip tone={b.status === "confirmed" ? "info" : b.status === "completed" ? "good" : "muted"}>{b.status}</Chip>{b.invoiced && <Chip tone="good">invoiced</Chip>}</td>
                <td className="pr-2 text-right tabular-nums">{inr(b.total)}</td>
                <td className="pr-2 text-right tabular-nums">{inr(b.paid)}</td>
                <td className="text-right tabular-nums">{inr(b.vendorCost)}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
    </HubPage>
  );
}

type BookingDetail = {
  id: number; title: string; eventDate: string; venue: string | null; guests: number | null; status: string; total: number; paid: number; vendorCost: number; margin: number; notes: string | null;
  checklist: Array<{ text: string; done: boolean; owner?: string | null }>; staff: Array<{ name: string; role?: string | null; phone?: string | null }>;
  finalInvoiceDocumentId: number | null; cancelledReason: string | null;
  customer: { id: number; name: string; phone: string | null }; quotation: { id: number; number: string; version: number };
  milestones: Array<{ id: number; label: string; dueDate: string | null; amount: number; status: string; paidOn: string | null; method: string | null; reference: string | null; receiptDocumentId: number | null; receiptNumber: string | null }>;
  costs: Array<{ id: number; vendorName: string; description: string; taxable: number; gst: number; dueDate: string | null; status: string; paidOn: string | null; billNumber: string | null; inPurchaseRegister: boolean }>;
  refunds: Array<{ id: number; number: string; total: number }>;
};

export function HubEventBookingDetail() {
  const [, params] = useRoute("/partner/events/bookings/:id");
  const id = Number(params?.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = useFail();
  const { me } = useHubMe();
  const { data: b, isLoading } = useQuery<BookingDetail>({ queryKey: ["/api/hub/events/bookings", id], queryFn: async () => (await apiRequest("GET", `/api/hub/events/bookings/${id}`)).data, enabled: !!id });
  const vendors = useQuery<Vendor[]>({ queryKey: ["/api/hub/events/vendors"], queryFn: async () => (await apiRequest("GET", "/api/hub/events/vendors")).data });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/hub/events/bookings"] }); qc.invalidateQueries({ queryKey: ["/api/hub/invoices"] }); };
  const [pay, setPay] = useState<{ id: number; method: string; reference: string; paidOn: string } | null>(null);
  const [cost, setCost] = useState({ vendorId: "", description: "", taxableRupees: "", gstRupees: "" });
  const [newItem, setNewItem] = useState("");
  const [staff, setStaff] = useState({ name: "", role: "", phone: "" });
  if (isLoading || !b) return <HubPage title="Booking"><p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p></HubPage>;
  const live = b.status !== "cancelled";
  const patch = async (body: Record<string, unknown>) => { try { await apiRequest("PATCH", `/api/hub/events/bookings/${id}`, body); refresh(); } catch (e) { fail("Not saved")(e); } };
  const recordPay = async () => {
    try { const r: any = await apiRequest("POST", `/api/hub/events/milestones/${pay!.id}/pay`, { method: pay!.method, reference: pay!.reference || null, paidOn: pay!.paidOn }); setPay(null); refresh(); toast({ title: "Payment recorded", description: r.message }); }
    catch (e) { fail("Not recorded")(e); }
  };
  const finalInvoice = async () => {
    try { const r: any = await apiRequest("POST", `/api/hub/events/bookings/${id}/final-invoice`, {}); refresh(); toast({ title: "Final invoice issued", description: r.message }); } catch (e) { fail("Not issued")(e); }
  };
  const cancel = async () => {
    const reason = window.prompt("Why is it cancelled?"); if (!reason) return;
    const refund = window.prompt(`Refund how much of the ₹${b.paid} received? (0 for none)`, "0"); if (refund === null) return;
    try { const r: any = await apiRequest("POST", `/api/hub/events/bookings/${id}/cancel`, { reason, refundRupees: Number(refund) || 0 }); refresh(); toast({ title: "Cancelled", description: r.message }); } catch (e) { fail("Not cancelled")(e); }
  };
  const addCost = async () => {
    try { await apiRequest("POST", `/api/hub/events/bookings/${id}/costs`, { vendorId: Number(cost.vendorId), description: cost.description, taxableRupees: Number(cost.taxableRupees), gstRupees: cost.gstRupees ? Number(cost.gstRupees) : 0 }); setCost({ vendorId: "", description: "", taxableRupees: "", gstRupees: "" }); refresh(); }
    catch (e) { fail("Not added")(e); }
  };
  const payCost = async (c: BookingDetail["costs"][number]) => {
    const billNumber = c.gst > 0 ? window.prompt("Vendor's GST bill number (goes to your purchase register)") : null;
    if (c.gst > 0 && !billNumber) return;
    const reference = window.prompt("Payment reference (UTR / cheque) — optional", "") ?? "";
    try { const r: any = await apiRequest("POST", `/api/hub/events/costs/${c.id}/pay`, { billNumber, reference: reference || null }); refresh(); toast({ title: r.message }); } catch (e) { fail("Not paid")(e); }
  };
  const canSell = hubCan(me, "sales:manage");

  return (
    <HubPage title={b.title} subtitle={`${nice(b.eventDate)}${b.venue ? ` · ${b.venue}` : ""}${b.guests ? ` · ${b.guests} guests` : ""} · ${b.customer.name}${b.customer.phone ? ` · ${b.customer.phone}` : ""}`}
      actions={<>
        <Link href="/partner/events/bookings" className="self-center text-sm text-[hsl(174,72%,60%)] hover:text-white">← Bookings</Link>
        <Link href={`/partner/sales/quotations/${b.quotation.id}`} className={`${linkBtn} border border-[rgba(255,255,255,0.15)] text-white`}>Quotation {b.quotation.number}</Link>
        {canSell && live && !b.finalInvoiceDocumentId && <Button onClick={finalInvoice}>Issue final invoice</Button>}
        {b.finalInvoiceDocumentId && <Link href={`/partner/sales/invoices/${b.finalInvoiceDocumentId}`} className={`${linkBtn} bg-[hsl(174,72%,40%)] text-white`}>Final invoice</Link>}
        {live && b.eventDate < today() && b.status === "confirmed" && <Button variant="outline" onClick={() => patch({ status: "completed" })}>Mark completed</Button>}
        {canSell && live && !b.finalInvoiceDocumentId && <Button variant="ghost" className="text-rose-300" onClick={cancel}>Cancel</Button>}
      </>}>
      {b.status === "cancelled" && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">Cancelled: {b.cancelledReason}{b.refunds.length ? ` · refund voucher ${b.refunds.map(r => `${r.number} (${inr(r.total)})`).join(", ")}` : ""}</div>}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Quoted (with GST)" value={inr(b.total)} />
        <Stat label="Received" value={inr(b.paid)} hint={`${inr(Math.max(0, b.total - b.paid))} to collect`} />
        <Stat label="Vendor costs" value={inr(b.vendorCost)} />
        <Stat label="Margin before GST" value={inr(b.margin)} />
      </div>

      <Panel title="Payment plan">
        <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">{b.milestones.map(m => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="text-white">{m.label}</span><span className="tabular-nums">{inr(m.amount)}</span>
            {m.status === "paid" ? <Chip tone="good">paid {m.paidOn}</Chip> : <Chip tone={m.dueDate && m.dueDate < today() ? "bad" : "warn"}>due {m.dueDate ?? "—"}</Chip>}
            {m.receiptNumber && <button className="font-mono text-xs text-[hsl(174,72%,60%)] underline" onClick={() => openAuthedPdf(`/api/hub/tax-documents/${m.receiptDocumentId}/pdf`).catch(fail("Could not open"))}>{m.receiptNumber}</button>}
            {canSell && live && m.status === "due" && <span className="ml-auto flex gap-1"><PayLinkButton kind="milestone" refId={m.id} /><Button size="sm" onClick={() => setPay({ id: m.id, method: "upi", reference: "", paidOn: today() })}>Record payment</Button></span>}
          </li>
        ))}</ul>
        <p className="mt-2 text-xs text-[hsl(215,20%,55%)]">Before the final invoice, each payment is an advance and gets a GST receipt voucher (tax is due when an advance is received). The final invoice adjusts them.</p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Event-day checklist">
          <ul className="space-y-1 text-sm">{b.checklist.map((c, i) => (
            <li key={i} className="flex items-center gap-2"><input type="checkbox" aria-label={c.text} checked={c.done} disabled={!live} onChange={e => patch({ checklist: b.checklist.map((x, j) => j === i ? { ...x, done: e.target.checked } : x) })} />
              <span className={c.done ? "text-[hsl(215,20%,55%)] line-through" : "text-white"}>{c.text}</span>
              {live && <button className="ml-auto text-xs text-[hsl(215,20%,55%)] hover:text-rose-300" aria-label={`Remove ${c.text}`} onClick={() => patch({ checklist: b.checklist.filter((_, j) => j !== i) })}>✕</button>}</li>
          ))}</ul>
          {live && <div className="mt-2 flex gap-2"><Input aria-label="New checklist item" className="h-9" value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="Add an item" /><Button size="sm" disabled={!newItem.trim()} onClick={() => { patch({ checklist: [...b.checklist, { text: newItem.trim(), done: false }] }); setNewItem(""); }}>Add</Button></div>}
        </Panel>
        <Panel title="Staff on the day">
          <ul className="space-y-1 text-sm">{b.staff.map((s, i) => (
            <li key={i} className="flex items-center gap-2"><span className="text-white">{s.name}</span><span className="text-[hsl(215,20%,60%)]">{s.role}</span><span className="text-[hsl(215,20%,60%)]">{s.phone}</span>
              {live && <button className="ml-auto text-xs text-[hsl(215,20%,55%)] hover:text-rose-300" aria-label={`Remove ${s.name}`} onClick={() => patch({ staff: b.staff.filter((_, j) => j !== i) })}>✕</button>}</li>
          ))}</ul>
          {live && <div className="mt-2 grid grid-cols-[1fr_1fr_1fr_auto] gap-2"><Input aria-label="Name" className="h-9" placeholder="Name" value={staff.name} onChange={e => setStaff({ ...staff, name: e.target.value })} /><Input aria-label="Role" className="h-9" placeholder="Role" value={staff.role} onChange={e => setStaff({ ...staff, role: e.target.value })} /><Input aria-label="Phone" className="h-9" placeholder="Phone" value={staff.phone} onChange={e => setStaff({ ...staff, phone: e.target.value })} />
            <Button size="sm" disabled={!staff.name.trim()} onClick={() => { patch({ staff: [...b.staff, staff] }); setStaff({ name: "", role: "", phone: "" }); }}>Add</Button></div>}
        </Panel>
      </div>

      <Panel title="Vendors for this event">
        {b.costs.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm">
          <Thead cols={["Vendor", "For", ["Amount", "right"], ["GST", "right"], "Status", ""]} />
          <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{b.costs.map(c => (
            <tr key={c.id}><td className="py-2 text-white">{c.vendorName}</td><td>{c.description}</td><td className="text-right tabular-nums">{inr(c.taxable)}</td><td className="text-right tabular-nums">{c.gst ? inr(c.gst) : "—"}</td>
              <td>{c.status === "paid" ? <Chip tone="good">paid{c.inPurchaseRegister ? " · in purchases" : ""}</Chip> : <Chip tone="warn">due</Chip>}</td>
              <td className="text-right">{c.status === "due" && hubCan(me, "purchases:manage") && <Button size="sm" variant="outline" onClick={() => payCost(c)}>Mark paid</Button>}</td></tr>
          ))}</tbody></table></div>}
        {live && hubCan(me, "purchases:manage") && (
          <div className="mt-3 grid gap-2 sm:grid-cols-[1.2fr_1.5fr_0.8fr_0.7fr_auto]">
            <HubSelect aria-label="Vendor" value={cost.vendorId} onChange={v => setCost({ ...cost, vendorId: v })}><option value="">Vendor…</option>{(vendors.data ?? []).filter(v => v.isActive).map(v => <option key={v.id} value={v.id}>{v.name}{v.gstin ? " (GST)" : ""}</option>)}</HubSelect>
            <Input aria-label="What for" className="h-9" placeholder="What for" value={cost.description} onChange={e => setCost({ ...cost, description: e.target.value })} />
            <Input aria-label="Amount before GST" className="h-9" inputMode="decimal" placeholder="₹ before GST" value={cost.taxableRupees} onChange={e => setCost({ ...cost, taxableRupees: e.target.value })} />
            <Input aria-label="GST amount" className="h-9" inputMode="decimal" placeholder="GST ₹" value={cost.gstRupees} onChange={e => setCost({ ...cost, gstRupees: e.target.value })} />
            <Button size="sm" disabled={!cost.vendorId || !cost.description.trim() || !cost.taxableRupees} onClick={addCost}>Add</Button>
          </div>
        )}
        {!vendors.data?.length && <p className="mt-2 text-xs text-[hsl(215,20%,55%)]"><Link href="/partner/events/vendors" className="underline">Add vendors</Link> to track what you owe them.</p>}
      </Panel>

      <Dialog open={!!pay} onOpenChange={o => !o && setPay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Record payment</DialogTitle><DialogDescription>{b.finalInvoiceDocumentId ? "Recorded against the final invoice." : "A GST receipt voucher is issued for this advance."}</DialogDescription></DialogHeader>
          {pay && <div className="grid gap-3">
            <div><Label htmlFor="mp-m">Method</Label><HubSelect id="mp-m" className="w-full" value={pay.method} onChange={v => setPay({ ...pay, method: v })}>{["upi", "bank", "cash", "card", "cheque", "other"].map(m => <option key={m} value={m}>{m}</option>)}</HubSelect></div>
            <div><Label htmlFor="mp-r">Reference</Label><Input id="mp-r" value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} /></div>
            <div><Label htmlFor="mp-d">Received on</Label><Input id="mp-d" type="date" max={today()} value={pay.paidOn} onChange={e => setPay({ ...pay, paidOn: e.target.value })} /></div>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setPay(null)}>Cancel</Button><Button onClick={recordPay}>Record</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Packages, vendors, calendar
// ═══════════════════════════════════════════════════════════════════════════

export function HubEventPackages() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const fail = useFail();
  const { data, isLoading } = usePackages();
  const blank = { name: "", category: "venue", unit: "event", priceRupees: "", sac: "998596", gstRate: "18", description: "" };
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<Pkg | null>(null);
  const [open, setOpen] = useState(false);
  const manage = hubCan(me, "settings:manage");
  const save = async () => {
    const body = { name: f.name, category: f.category, unit: f.unit, priceRupees: Number(f.priceRupees), sac: f.sac, gstRate: Number(f.gstRate), description: f.description || null };
    try { await apiRequest(editing ? "PATCH" : "POST", editing ? `/api/hub/events/packages/${editing.id}` : "/api/hub/events/packages", body); qc.invalidateQueries({ queryKey: ["/api/hub/events/packages"] }); setOpen(false); } catch (e) { fail("Not saved")(e); }
  };
  const grouped = useMemo(() => CATS.map(c => [c, (data ?? []).filter(p => p.category === c)] as const).filter(([, l]) => l.length), [data]);
  return (
    <HubPage title="Packages" subtitle="The building blocks of your quotations. Catering is usually priced per plate (SAC 996337, 5% GST); event management per event (SAC 998596, 18%). Confirm rates with your CA."
      actions={manage ? <Button onClick={() => { setEditing(null); setF(blank); setOpen(true); }}>Add package</Button> : undefined}>
      {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !grouped.length ? <Panel><Empty icon="inventory" title="No packages yet" /></Panel> : grouped.map(([c, list]) => (
        <Panel key={c} title={CAT_LABEL[c]}>
          <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">{list.map(p => (
            <li key={p.id} className={`flex flex-wrap items-center gap-3 py-2 ${p.isActive ? "" : "opacity-60"}`}>
              <span className="text-white">{p.name}</span><span className="text-[hsl(215,20%,60%)]">{p.description}</span>
              <span className="ml-auto tabular-nums">{inr(p.price)} / {p.unit}</span><span className="text-xs text-[hsl(215,20%,55%)]">SAC {p.sac} · {p.gstRate}%</span>
              {manage && <><Button size="sm" variant="ghost" onClick={() => { setEditing(p); setF({ name: p.name, category: p.category, unit: p.unit, priceRupees: String(p.price), sac: p.sac, gstRate: String(p.gstRate), description: p.description ?? "" }); setOpen(true); }}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={async () => { try { await apiRequest("PATCH", `/api/hub/events/packages/${p.id}`, { isActive: !p.isActive }); qc.invalidateQueries({ queryKey: ["/api/hub/events/packages"] }); } catch (e) { fail("Not changed")(e); } }}>{p.isActive ? "Hide" : "Show"}</Button></>}
            </li>
          ))}</ul>
        </Panel>
      ))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit package" : "Add a package"}</DialogTitle><DialogDescription>Prices are before GST.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="pk-n">Name</Label><Input id="pk-n" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
            <div><Label htmlFor="pk-c">Category</Label><HubSelect id="pk-c" className="w-full" value={f.category} onChange={v => setF({ ...f, category: v, ...(v === "catering" ? { unit: "plate", sac: "996337", gstRate: "5" } : {}) })}>{CATS.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</HubSelect></div>
            <div><Label htmlFor="pk-u">Priced per</Label><HubSelect id="pk-u" className="w-full" value={f.unit} onChange={v => setF({ ...f, unit: v })}>{["event", "plate", "hour", "day", "piece"].map(u => <option key={u} value={u}>{u}</option>)}</HubSelect></div>
            <div><Label htmlFor="pk-p">Price ₹</Label><Input id="pk-p" inputMode="decimal" value={f.priceRupees} onChange={e => setF({ ...f, priceRupees: e.target.value })} /></div>
            <div><Label htmlFor="pk-s">SAC</Label><Input id="pk-s" maxLength={6} value={f.sac} onChange={e => setF({ ...f, sac: e.target.value.replace(/\D/g, "") })} /></div>
            {me?.business?.gstin && <div><Label htmlFor="pk-g">GST %</Label><HubSelect id="pk-g" className="w-full" value={f.gstRate} onChange={v => setF({ ...f, gstRate: v })}>{[0, 5, 18].map(r => <option key={r} value={r}>{r}%</option>)}</HubSelect></div>}
            <div className="sm:col-span-2"><Label htmlFor="pk-d">Description</Label><Input id="pk-d" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={!f.name.trim() || !f.priceRupees}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

export function HubEventVendors() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const fail = useFail();
  const { data, isLoading } = useQuery<Vendor[]>({ queryKey: ["/api/hub/events/vendors"], queryFn: async () => (await apiRequest("GET", "/api/hub/events/vendors")).data });
  const payables = useQuery<Array<{ id: number; vendorName: string; bookingId: number; bookingTitle: string; eventDate: string; description: string; amount: number; gst: number; dueDate: string | null }>>({ queryKey: ["/api/hub/events/payables"], queryFn: async () => (await apiRequest("GET", "/api/hub/events/payables")).data, enabled: hubCan(me, "purchases:manage") });
  const [f, setF] = useState({ name: "", category: "decor", phone: "", gstin: "" });
  const add = async () => { try { await apiRequest("POST", "/api/hub/events/vendors", { ...f, phone: f.phone || null, gstin: f.gstin || null }); setF({ name: "", category: "decor", phone: "", gstin: "" }); qc.invalidateQueries({ queryKey: ["/api/hub/events/vendors"] }); } catch (e) { fail("Not added")(e); } };
  const owed = (payables.data ?? []).reduce((a, p) => a + p.amount, 0);
  return (
    <HubPage title="Vendors" subtitle="Your caterers, decorators, sound and light — and what you owe them. Paying a vendor's GST bill adds it to your purchase register for input tax credit.">
      <Panel title={`Payables · ${inr(owed)}`}>
        {!(payables.data ?? []).length ? <p className="text-sm text-[hsl(215,20%,60%)]">Nothing owed.</p> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">{(payables.data ?? []).map(p => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2"><span className="text-white">{p.vendorName}</span><span className="text-[hsl(215,20%,65%)]">{p.description}</span>
              <Link href={`/partner/events/bookings/${p.bookingId}`} className="text-xs text-[hsl(174,72%,60%)]">{p.bookingTitle} · {nice(p.eventDate)}</Link><span className="ml-auto tabular-nums">{inr(p.amount)}</span></li>
          ))}</ul>
        )}
      </Panel>
      <Panel title="Directory">
        {hubCan(me, "purchases:manage") && <div className="mb-3 grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto]">
          <Input aria-label="Vendor name" className="h-9" placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <HubSelect aria-label="Category" value={f.category} onChange={v => setF({ ...f, category: v })}>{CATS.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</HubSelect>
          <Input aria-label="Phone" className="h-9" placeholder="Phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
          <Input aria-label="GSTIN" className="h-9" placeholder="GSTIN (if registered)" maxLength={15} value={f.gstin} onChange={e => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
          <Button size="sm" disabled={!f.name.trim()} onClick={add}>Add</Button>
        </div>}
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !data?.length ? <Empty icon="storefront" title="No vendors yet" /> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">{data.map(v => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 py-2"><span className="text-white">{v.name}</span><Chip>{CAT_LABEL[v.category] ?? v.category}</Chip><span className="text-[hsl(215,20%,65%)]">{v.phone}</span><span className="font-mono text-xs text-[hsl(215,20%,55%)]">{v.gstin ?? "unregistered"}</span></li>
          ))}</ul>
        )}
      </Panel>
    </HubPage>
  );
}

export function HubEventCalendar() {
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const bookings = useQuery<BookingRow[]>({ queryKey: ["/api/hub/events/bookings", "cal", month], queryFn: async () => (await apiRequest("GET", `/api/hub/events/bookings?from=${first}&to=${next}`)).data });
  const enq = useQuery<Enquiry[]>({ queryKey: ["/api/hub/events/enquiries", ""], queryFn: async () => (await apiRequest("GET", "/api/hub/events/enquiries")).data });
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const shift = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  return (
    <HubPage title="Event calendar" subtitle="Confirmed events, and dates clients have asked about." actions={<div className="flex items-center gap-1"><Button size="sm" variant="ghost" onClick={() => shift(-1)}>←</Button><span className="text-sm text-white">{new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</span><Button size="sm" variant="ghost" onClick={() => shift(1)}>→</Button></div>}>
      <Panel>
        <div className="grid grid-cols-7 gap-1 text-xs">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => <div key={d} className="px-1 text-[hsl(215,20%,55%)]">{d}</div>)}
          {Array.from({ length: lead }).map((_, i) => <div key={`l${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const d = `${month}-${String(i + 1).padStart(2, "0")}`;
            const bs = (bookings.data ?? []).filter(b => b.eventDate === d && b.status !== "cancelled");
            const es = (enq.data ?? []).filter(e => e.eventDate === d && ["new", "contacted", "quoted"].includes(e.status));
            return (
              <div key={d} className={`min-h-[78px] rounded border p-1 ${d === today() ? "border-[hsl(174,72%,45%)]" : "border-[rgba(255,255,255,0.06)]"}`}>
                <div className="text-[hsl(215,20%,60%)]">{i + 1}</div>
                {bs.map(b => <Link key={b.id} href={`/partner/events/bookings/${b.id}`} className="mt-0.5 block truncate rounded bg-[hsl(174,72%,40%)]/30 px-1 text-white">{b.title}</Link>)}
                {es.map(e => <div key={e.id} className="mt-0.5 truncate rounded bg-amber-500/15 px-1 text-amber-200">? {e.eventType}</div>)}
                {bs.length > 1 && <div className="mt-0.5 text-[10px] text-rose-300">{bs.length} events</div>}
              </div>
            );
          })}
        </div>
      </Panel>
    </HubPage>
  );
}
