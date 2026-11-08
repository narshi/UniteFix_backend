/**
 * Book by call: a customer phones UniteFix and staff book the service for
 * them. Same catalogue price and queue as an app booking; marked "Booked by
 * call" with who booked it. Payment: a link for the booking fee (Razorpay SMS
 * and email, and WhatsApp), which the customer can also pay in the app — the
 * booking joins the queue once paid — or nothing now and the full bill after
 * the service. See server/services/call-booking.service.ts.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, MapPin, Phone, Search, UserPlus, UserCheck, Minus, Plus, Copy, MessageCircle, Send, CreditCard, Check, X } from "lucide-react";

type Address = { label: string; address: string; pinCode: string };
type Lookup = { phone: string; customer: null | { id: number; name: string; email: string | null; isActive: boolean; addresses: Address[]; recent: { id: number; ref: string; serviceType: string; status: string; createdAt: string }[] } };
type Quote = {
  service: { id: number; name: string; categoryName: string | null }; band: string; quantity: number; unitPrice: number | null; total: number | null; partnerName: string | null;
  link: { payNow: number; payAfter: number | null; prepaid: boolean }; afterService: { payNow: number; payAfter: number | null }; linksAvailable: boolean;
};
type SendRow = { channel: "sms" | "email" | "whatsapp"; at: string; ok: boolean; detail?: string };
type PaymentResult = { mode: "link" | "after_service"; amount: number; url: string | null; sends: SendRow[]; whatsappFallbackUrl: string | null };
type Item = { id: number; name: string; status: string; basePrice: number };
type Category = { id: number; name: string; isActive: boolean; items: Item[] };
type Recent = {
  id: number; ref: string; serviceType: string; status: string; totalAmount: number | null; createdAt: string; note: string | null; customerName: string | null; customerPhone: string | null; customerEmail: string | null; bookedBy: string | null;
  payment: "awaiting" | "paid_by_link" | "after_service" | "paid"; amountDue: number | null; paymentLinkUrl: string | null; paymentLinkExpiresAt: string | null; whatsappFallbackUrl: string | null;
};
const CHANNEL: Record<string, string> = { sms: "SMS", email: "Email", whatsapp: "WhatsApp" };

/** Copy text; a fallback for browsers that refuse the clipboard. */
async function copy(text: string, toast: (o: any) => void) {
  try { await navigator.clipboard.writeText(text); toast({ title: "Link copied" }); }
  catch { window.prompt("Copy the payment link:", text); }
}

function Sends({ sends }: { sends: SendRow[] }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Where the link was sent">
      {sends.map((s, i) => (
        <li key={i} title={s.detail} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${s.ok ? "bg-[rgba(16,185,129,0.12)] text-emerald-300" : "bg-[rgba(245,158,11,0.12)] text-amber-300"}`}>
          {s.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {CHANNEL[s.channel]}{s.ok ? "" : `: ${s.detail ?? "not sent"}`}
        </li>
      ))}
    </ul>
  );
}

const SLOTS = ["Morning (9 am – 12 pm)", "Afternoon (12 – 4 pm)", "Evening (4 – 8 pm)"];
const field = "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white";
const select = "h-10 w-full rounded-md border border-[rgba(255,255,255,0.08)] bg-[hsl(222,47%,11%)] px-3 text-sm text-white";
const panel = "rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4 sm:p-5";
const rupees = (n: number | null | undefined) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN")}`);
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const STATUS: Record<string, string> = { created: "Waiting for an expert", assigned: "Assigned", accepted: "Accepted", reached: "Expert arrived", in_progress: "In progress", pending_payment: "Awaiting payment", completed: "Completed", cancelled: "Cancelled" };

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function CallBookingPage() {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [serviceId, setServiceId] = useState<number | "">("");
  const [quantity, setQuantity] = useState(1);
  const [address, setAddress] = useState("");
  const [pincode, setPincode] = useState("");
  const [date, setDate] = useState(todayIst());
  const [slot, setSlot] = useState(SLOTS[0]);
  const [urgent, setUrgent] = useState(false);
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [payMode, setPayMode] = useState<"link" | "after_service">("link");
  const [done, setDone] = useState<{ ref: string; id: number; service: string; total: number | null; newCustomer: boolean; payment: PaymentResult } | null>(null);

  const digits = phone.replace(/\D/g, "").slice(-10);
  const phoneOk = /^[6-9]\d{9}$/.test(digits);
  const lookup = useQuery<Lookup>({
    queryKey: ["/api/admin/call-bookings/customer", digits],
    queryFn: async () => (await apiRequest("GET", `/api/admin/call-bookings/customer?phone=${digits}`)).data,
    enabled: phoneOk, retry: false,
  });
  const customer = lookup.data?.customer ?? null;
  const catalog = useQuery<Category[]>({ queryKey: ["/api/admin/catalog/categories"], queryFn: async () => (await apiRequest("GET", "/api/admin/catalog/categories")).data });
  const cats = useMemo(() => (catalog.data ?? []).filter(c => c.isActive && c.items.some(s => s.status === "ACTIVE")), [catalog.data]);
  const items = useMemo(() => cats.find(c => c.id === categoryId)?.items.filter(s => s.status === "ACTIVE") ?? [], [cats, categoryId]);

  const qKey = useDebounced(`${serviceId}|${pincode}|${quantity}`);
  const quote = useQuery<Quote>({
    queryKey: ["/api/admin/call-bookings/quote", qKey],
    queryFn: async () => (await apiRequest("GET", `/api/admin/call-bookings/quote?catalogServiceId=${serviceId}&pincode=${/^\d{6}$/.test(pincode) ? pincode : ""}&quantity=${quantity}`)).data,
    enabled: !!serviceId, retry: false,
  });
  const consultation = quote.data?.band === "consultation";
  const linksAvailable = quote.data?.linksAvailable ?? true;
  const mode = linksAvailable ? payMode : "after_service";
  const plan = quote.data ? (mode === "link" ? quote.data.link : quote.data.afterService) : null;
  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const recent = useQuery<Recent[]>({ queryKey: ["/api/admin/call-bookings"], queryFn: async () => (await apiRequest("GET", "/api/admin/call-bookings")).data });

  // A known caller: their home address is the usual one.
  useEffect(() => {
    const first = customer?.addresses[0];
    if (first && !address) { setAddress(first.address); if (first.pinCode) setPincode(first.pinCode); }
    if (customer?.email && !email) setEmail(customer.email);
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const book = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/call-bookings", {
      phone: digits, name: customer ? undefined : name, catalogServiceId: serviceId, quantity, address, pincode,
      preferredDate: date || undefined, preferredTimeSlot: slot || undefined, urgency: urgent ? "urgent" : "normal", description, note,
      payment: mode, email: email.trim() || undefined,
    }),
    onSuccess: (r: any) => {
      setDone(r.data);
      toast({ title: "Booked", description: r.message });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/call-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/call-bookings/customer", digits] });
    },
    onError: e => toast({ title: "Not booked", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const refreshRecent = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/call-bookings"] });
  const resend = useMutation({
    mutationFn: async (v: { id: number; channels: string[] }) => apiRequest("POST", `/api/admin/call-bookings/${v.id}/resend-link`, { channels: v.channels }),
    onSuccess: (r: any) => {
      const failed = (r.data?.sends ?? []).filter((x: SendRow) => !x.ok).map((x: SendRow) => CHANNEL[x.channel]);
      toast({ title: r.message, description: failed.length ? `Not sent by ${failed.join(", ")}: use Copy or WhatsApp Web.` : undefined });
      refreshRecent();
    },
    onError: e => toast({ title: "Not sent", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const payAfter = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/admin/call-bookings/${id}/pay-after-service`, {}),
    onSuccess: (r: any) => { toast({ title: "Switched", description: r.message }); refreshRecent(); },
    onError: e => toast({ title: "Not changed", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const reset = () => { setDone(null); setEmail(""); setPayMode("link"); setPhone(""); setName(""); setCategoryId(""); setServiceId(""); setQuantity(1); setAddress(""); setPincode(""); setDate(todayIst()); setSlot(SLOTS[0]); setUrgent(false); setDescription(""); setNote(""); };
  const missing = [
    !phoneOk && "the customer's mobile number",
    phoneOk && lookup.isSuccess && !customer && name.trim().length < 2 && "the new customer's name",
    !serviceId && "the service",
    quote.isError && "a service that can be booked by call",
    !consultation && address.trim().length < 8 && "the address",
    !/^\d{6}$/.test(pincode) && "the 6-digit pincode",
    consultation && (!date || !slot) && "a day and time for the call",
    !emailOk && "a valid email (or leave it empty)",
  ].filter(Boolean) as string[];

  return (
    <main className="min-w-0 flex-1 space-y-6 p-4 sm:p-6 xl:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Book by call</h1>
        <p className="mt-1 max-w-3xl text-sm text-[hsl(215,20%,65%)]">
          For customers who phone in. Same catalogue price and queue as an app booking, marked <span className="text-[#FFB15C]">Booked by call</span>. Send a payment link for the booking fee (SMS, email, WhatsApp; they can also pay in the app under My Bookings): it joins the queue once paid. Or choose pay after the service: nothing now, into the queue at once. They see the booking in the app when they sign in with this number.
        </p>
      </div>

      {done ? (
        <section className={`${panel} max-w-2xl`} aria-live="polite">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-400" />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-white">Booked {done.ref}</h2>
              <p className="text-sm text-[hsl(215,20%,70%)]">{done.service} · {rupees(done.total)} in all · {done.newCustomer ? "new customer added" : "existing customer"}</p>
              {done.payment.mode === "link" ? (
                <div className="space-y-2 pt-1" data-testid="link-result">
                  <p className="text-sm text-[hsl(215,20%,70%)]">Payment link for <span className="font-semibold text-white">{rupees(done.payment.amount)}</span> sent. The booking joins the queue as soon as they pay (by the link, or in the app under My Bookings).</p>
                  {done.payment.url && (
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-[rgba(255,255,255,0.06)] px-2 py-1 text-xs text-white">{done.payment.url}</code>
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => copy(done.payment.url!, toast)}><Copy className="h-3.5 w-3.5" /> Copy</Button>
                      {done.payment.whatsappFallbackUrl && <a href={done.payment.whatsappFallbackUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="gap-1"><MessageCircle className="h-3.5 w-3.5" /> Open in WhatsApp Web</Button></a>}
                    </div>
                  )}
                  <Sends sends={done.payment.sends} />
                </div>
              ) : (
                <p className="text-sm text-[hsl(215,20%,70%)]">Nothing to pay now; the customer pays the bill after the service. It is in the queue now.</p>
              )}
              <p className="text-sm text-[hsl(215,20%,70%)]">Tell the customer their booking number {done.ref}.</p>
              <div className="flex flex-wrap gap-2 pt-2">
                <Link href="/admin/assignments"><Button variant="outline">Assignment queue</Button></Link>
                <Link href="/services"><Button variant="outline">Service requests</Button></Link>
                <Button onClick={reset}>Book another call</Button>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            {/* 1. Customer */}
            <section className={panel} aria-label="Customer">
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-white"><Phone className="h-4 w-4 text-[#FF8A00]" /> 1. Who is calling</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="cb-phone" className="text-[hsl(215,20%,75%)]">Mobile number</Label>
                  <Input id="cb-phone" inputMode="tel" autoComplete="off" value={phone} onChange={e => setPhone(e.target.value)} placeholder="98450 12345" className={field} />
                </div>
                {phoneOk && lookup.isSuccess && !customer && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="cb-name" className="text-[hsl(215,20%,75%)]">Name (new customer)</Label>
                    <Input id="cb-name" value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="Customer's name" className={field} />
                  </div>
                )}
              </div>
              {phoneOk && lookup.isFetching && <p className="mt-3 text-sm text-[hsl(215,20%,60%)]"><Search className="mr-1 inline h-3.5 w-3.5" /> Looking up…</p>}
              {phoneOk && lookup.isError && <p className="mt-3 text-sm text-red-300">{apiErrorMessage(lookup.error)}</p>}
              {customer && (
                <div className="mt-3 rounded-xl bg-[rgba(16,185,129,0.08)] p-3" data-testid="known-customer">
                  <p className="flex items-center gap-2 text-sm font-semibold text-emerald-300"><UserCheck className="h-4 w-4" /> {customer.name || "Customer"} · existing customer</p>
                  {!customer.isActive && <p className="mt-1 text-sm text-red-300">This account is blocked. Check with an admin before booking.</p>}
                  {customer.recent.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-[hsl(215,20%,70%)]">
                      {customer.recent.map(r => <li key={r.id}>{r.ref} · {r.serviceType} · {STATUS[r.status] ?? r.status} · {new Date(r.createdAt).toLocaleDateString("en-IN")}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {phoneOk && lookup.isSuccess && !customer && <p className="mt-3 flex items-center gap-2 text-sm text-[hsl(215,20%,70%)]"><UserPlus className="h-4 w-4" /> New customer: an account is created with this number and name.</p>}
            </section>

            {/* 2. Service */}
            <section className={panel} aria-label="Service">
              <h2 className="mb-3 text-base font-semibold text-white">2. What they need</h2>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <div className="grid gap-1.5">
                  <Label htmlFor="cb-cat" className="text-[hsl(215,20%,75%)]">Category</Label>
                  <select id="cb-cat" className={select} value={categoryId} onChange={e => { setCategoryId(e.target.value ? Number(e.target.value) : ""); setServiceId(""); }}>
                    <option value="">Choose…</option>
                    {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cb-svc" className="text-[hsl(215,20%,75%)]">Service</Label>
                  <select id="cb-svc" className={select} value={serviceId} disabled={!categoryId} onChange={e => setServiceId(e.target.value ? Number(e.target.value) : "")}>
                    <option value="">Choose…</option>
                    {items.map(s => <option key={s.id} value={s.id}>{s.name}{s.basePrice > 0 ? ` · ₹${s.basePrice}` : ""}</option>)}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-[hsl(215,20%,75%)]">Units</Label>
                  <div className="flex h-10 items-center gap-1">
                    <Button type="button" size="icon" variant="outline" aria-label="Fewer" disabled={quantity <= 1} onClick={() => setQuantity(q => Math.max(1, q - 1))}><Minus className="h-4 w-4" /></Button>
                    <span className="w-8 text-center text-white" aria-label="Units">{quantity}</span>
                    <Button type="button" size="icon" variant="outline" aria-label="More" disabled={quantity >= 50} onClick={() => setQuantity(q => Math.min(50, q + 1))}><Plus className="h-4 w-4" /></Button>
                  </div>
                </div>
              </div>
              {quote.isError && <p className="mt-3 text-sm text-red-300" role="alert">{apiErrorMessage(quote.error)}</p>}
              <div className="mt-3 grid gap-1.5">
                <Label htmlFor="cb-desc" className="text-[hsl(215,20%,75%)]">The problem, in the customer's words</Label>
                <textarea id="cb-desc" value={description} maxLength={1000} onChange={e => setDescription(e.target.value)} rows={2} placeholder="e.g. Kitchen tap leaking since yesterday" className={`${field} rounded-md border px-3 py-2 text-sm`} />
              </div>
            </section>

            {/* 3. Where and when */}
            <section className={panel} aria-label="Where and when">
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-white"><MapPin className="h-4 w-4 text-[#FF8A00]" /> 3. Where and when</h2>
              {customer && customer.addresses.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {customer.addresses.map(a => (
                    <button key={a.address} type="button" onClick={() => { setAddress(a.address); if (a.pinCode) setPincode(a.pinCode); }}
                      className={`rounded-full border px-3 py-1 text-xs ${address === a.address ? "border-[#FF8A00] bg-[rgba(255,138,0,0.14)] text-white" : "border-[rgba(255,255,255,0.12)] text-[hsl(215,20%,75%)] hover:text-white"}`}>
                      {a.label}: {a.address.slice(0, 40)}{a.address.length > 40 ? "…" : ""}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <div className="grid gap-1.5">
                  <Label htmlFor="cb-addr" className="text-[hsl(215,20%,75%)]">{consultation ? "Address (optional for a call)" : "Address for the visit"}</Label>
                  <textarea id="cb-addr" value={address} maxLength={300} onChange={e => setAddress(e.target.value)} rows={2} placeholder="House / flat, street, area, landmark" className={`${field} rounded-md border px-3 py-2 text-sm`} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cb-pin" className="text-[hsl(215,20%,75%)]">Pincode</Label>
                  <Input id="cb-pin" inputMode="numeric" maxLength={6} value={pincode} onChange={e => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="560001" className={field} />
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="cb-date" className="text-[hsl(215,20%,75%)]">{consultation ? "Day of the call" : "Preferred day"}</Label>
                  <input id="cb-date" type="date" min={todayIst()} value={date} onChange={e => setDate(e.target.value)} className={`${select} [color-scheme:dark]`} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cb-slot" className="text-[hsl(215,20%,75%)]">Time</Label>
                  <select id="cb-slot" className={select} value={slot} onChange={e => setSlot(e.target.value)}>{SLOTS.map(s => <option key={s}>{s}</option>)}</select>
                </div>
                <label className="flex items-center gap-2 pt-6 text-sm text-white">
                  <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} className="h-4 w-4 accent-[#FF8A00]" /> Urgent
                </label>
              </div>
            </section>
          </div>

          {/* Summary */}
          <aside className={`${panel} h-fit space-y-3 xl:sticky xl:top-6`} aria-label="Summary">
            <h2 className="text-base font-semibold text-white">Booking</h2>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-[hsl(215,20%,60%)]">Customer</dt><dd className="text-right text-white">{customer?.name || name || "—"}{phoneOk ? ` · ${digits}` : ""}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[hsl(215,20%,60%)]">Service</dt><dd className="text-right text-white">{quote.data?.service.name ?? "—"}{quantity > 1 ? ` × ${quantity}` : ""}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[hsl(215,20%,60%)]">Total</dt><dd className="text-right text-white" data-testid="cb-total">{quote.data ? (quote.data.total != null ? rupees(quote.data.total) : "Expert quotes on site") : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[hsl(215,20%,60%)]">Pay now</dt><dd className="text-right font-semibold text-emerald-300" data-testid="cb-paynow">{plan ? rupees(plan.payNow) : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[hsl(215,20%,60%)]">After the service</dt><dd className="text-right text-white">{plan?.payAfter != null ? rupees(plan.payAfter) : "the bill"}</dd></div>
              {quote.data?.partnerName && <div className="flex justify-between gap-3"><dt className="text-[hsl(215,20%,60%)]">Served by</dt><dd className="text-right text-white">{quote.data.partnerName}</dd></div>}
            </dl>
            <fieldset className="grid gap-2" aria-label="Payment">
              <legend className="mb-1 text-sm text-[hsl(215,20%,75%)]">Payment</legend>
              <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm ${mode === "link" ? "border-[#FF8A00] bg-[rgba(255,138,0,0.08)]" : "border-[rgba(255,255,255,0.08)]"} ${linksAvailable ? "" : "opacity-50"}`}>
                <input type="radio" name="cb-pay" className="mt-0.5 accent-[#FF8A00]" checked={mode === "link"} disabled={!linksAvailable} onChange={() => setPayMode("link")} />
                <span><span className="flex items-center gap-1 font-medium text-white"><CreditCard className="h-3.5 w-3.5" /> Send a payment link{quote.data ? ` · ${rupees(quote.data.link.payNow)} now` : ""}</span>
                  <span className="text-xs text-[hsl(215,20%,60%)]">{linksAvailable ? "By SMS, email and WhatsApp. They can also pay in the app. Joins the queue once paid." : "Razorpay is not set up on this server."}</span></span>
              </label>
              <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm ${mode === "after_service" ? "border-[#FF8A00] bg-[rgba(255,138,0,0.08)]" : "border-[rgba(255,255,255,0.08)]"}`}>
                <input type="radio" name="cb-pay" className="mt-0.5 accent-[#FF8A00]" checked={mode === "after_service"} onChange={() => setPayMode("after_service")} />
                <span><span className="font-medium text-white">Pay after the service</span><span className="block text-xs text-[hsl(215,20%,60%)]">Nothing now; into the queue at once.</span></span>
              </label>
              {mode === "link" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="cb-email" className="text-[hsl(215,20%,75%)]">Email for the link (optional)</Label>
                  <Input id="cb-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="customer@example.com" className={field} />
                </div>
              )}
            </fieldset>
            <div className="grid gap-1.5">
              <Label htmlFor="cb-note" className="text-[hsl(215,20%,75%)]">Note for the team (not shown to the customer)</Label>
              <textarea id="cb-note" value={note} maxLength={500} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. Call before reaching; gate code 1234" className={`${field} rounded-md border px-3 py-2 text-sm`} />
            </div>
            {missing.length > 0 && <p className="text-xs text-[hsl(215,20%,60%)]">Still needed: {missing.join(", ")}.</p>}
            <Button className="w-full" disabled={missing.length > 0 || book.isPending || (customer ? !customer.isActive : false)} onClick={() => book.mutate()}>
              {book.isPending ? "Booking…" : mode === "link" ? "Book and send the payment link" : "Book for the customer"}
            </Button>
          </aside>
        </div>
      )}

      {/* Recent call bookings */}
      <section className="space-y-3" aria-label="Recent call bookings">
        <h2 className="text-base font-semibold text-white">Recent call bookings</h2>
        {(recent.data ?? []).length === 0 ? <p className="text-sm text-[hsl(215,20%,60%)]">None yet.</p> : (
          <div className="overflow-x-auto rounded-2xl border border-[rgba(255,255,255,0.08)]">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-[rgba(255,255,255,0.03)] text-left text-xs uppercase tracking-wider text-[hsl(215,20%,60%)]">
                <tr><th className="p-3">Booking</th><th className="p-3">Customer</th><th className="p-3">Service</th><th className="p-3">Total</th><th className="p-3">Payment</th><th className="p-3">Status</th><th className="p-3">Booked by</th></tr>
              </thead>
              <tbody>
                {(recent.data ?? []).map(r => (
                  <tr key={r.id} className="border-t border-[rgba(255,255,255,0.05)] align-top text-[hsl(210,20%,88%)]" data-testid={`recent-${r.ref}`}>
                    <td className="p-3"><span className="font-medium text-white">{r.ref}</span><br /><span className="text-xs text-[hsl(215,20%,55%)]">{new Date(r.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span></td>
                    <td className="p-3">{r.customerName ?? "—"}<br /><span className="text-xs text-[hsl(215,20%,55%)]">{r.customerPhone}</span></td>
                    <td className="p-3">{r.serviceType}{r.note ? <><br /><span className="text-xs text-[hsl(215,20%,55%)]">Note: {r.note}</span></> : null}</td>
                    <td className="p-3">{rupees(r.totalAmount)}</td>
                    <td className="p-3">
                      {r.payment === "awaiting" ? (
                        <div className="space-y-1.5">
                          <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20">Waiting for {rupees(r.amountDue)}</Badge>
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={resend.isPending} onClick={() => resend.mutate({ id: r.id, channels: ["sms", "whatsapp", ...(r.customerEmail ? ["email"] : [])] })}><Send className="h-3 w-3" /> Resend</Button>
                            {r.paymentLinkUrl && <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" aria-label={`Copy the payment link for ${r.ref}`} onClick={() => copy(r.paymentLinkUrl!, toast)}><Copy className="h-3 w-3" /></Button>}
                            {r.whatsappFallbackUrl && <a href={r.whatsappFallbackUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" aria-label={`WhatsApp Web for ${r.ref}`}><MessageCircle className="h-3 w-3" /></Button></a>}
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={payAfter.isPending} onClick={() => payAfter.mutate(r.id)}>Pay after service</Button>
                          </div>
                        </div>
                      ) : r.payment === "paid_by_link" ? <Badge className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">Paid by link</Badge>
                        : r.payment === "after_service" ? <Badge variant="outline" className="text-[hsl(215,20%,80%)]">After the service</Badge>
                        : <Badge className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">Paid</Badge>}
                    </td>
                    <td className="p-3"><Badge variant="outline" className="text-[hsl(215,20%,80%)]">{r.payment === "awaiting" ? "Waiting for payment" : (STATUS[r.status] ?? r.status)}</Badge></td>
                    <td className="p-3">{r.bookedBy ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
