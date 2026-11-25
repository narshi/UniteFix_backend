/**
 * Trip requests from the app's travel planner (server/services/travel.service.ts).
 *
 * The default travel manager takes every new trip. For each trip the manager
 * collects supplier prices — our own team first, then travel partners — picks
 * one, and sends the customer a price that is held for a while. The customer
 * books by paying the advance (not refundable) in the app.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Search, Phone, MessageCircle, Users, MapPin, CalendarDays, BedDouble, Car, Compass, ChevronDown, ChevronUp, Route, Settings2, Trash2, Check, Clock, BadgeCheck, Copy, ShieldCheck, ShieldAlert, Play, Flag } from "lucide-react";
import { TRIP_STATUS_LABEL, TRAVEL_PARTNER_KIND_LABEL, advanceFor, type TripPlan, type TripStatus, type TravelSettings, type TravelPartnerKind } from "@shared/travel";

type Quote = { id: number; source: "own" | "partner"; partnerId: number | null; label: string; covers: string | null; amount: number | null; status: "asked" | "quoted" | "declined"; note: string | null; respondedAt?: string | null };
type Trip = {
  id: number; code: string; contactName: string; contactPhone: string; adults: number; children: number; people: number; vehicle: string;
  tripType: "round_trip" | "one_way"; pickupText: string | null; dropText: string | null; startDate: string | null; days: number | null; pace: string;
  stay: string; rooms: number | null; needsCab: boolean; needsGuide: boolean; budgetPerPerson: number | null; notes: string | null; regionIds: number[];
  status: TripStatus; managerAdminId: number | null; managerName: string | null; managerPhone: string | null; assignedAt: string | null;
  quoteAmount: number | null; quoteNote: string | null; quotedAt: string | null; quoteValidUntil: string | null; staffNote: string | null; createdAt: string;
  chosenQuoteId: number | null; costAmount: number | null; advancePercent: number | null; advanceAmount: number | null; advanceStatus: "none" | "due" | "paid"; advancePaidAt: string | null;
  plan: TripPlan | null; members: Array<{ id: number; name: string; phone: string | null; status: string }>; quotes: Quote[];
  team: TeamMember[]; startCode: string | null; startedAt: string | null; endedAt: string | null;
  payouts: Payout[]; ratings: Rating[]; familyUrl: string | null; balanceMethod: string | null;
  money: { price: number; advance: number; balanceReceived: number; balanceDue: number; collected: number; paidOut: number; margin: number; cashInHand: number };
  progress: { done: number; total: number; next: string | null };
};
type Payout = { id: number; partnerId: number | null; payee: string; amount: number; method: string; reference: string | null; paidOn: string | null; note: string | null };
type Rating = { id: number; teamMemberId: number | null; role: string; name: string; stars: number; tags: string[]; comment: string | null };
type TeamMember = {
  id: number; day: number | null; role: "driver" | "stay" | "guide" | "activity"; source: "own" | "partner"; employeeId: number | null; partnerId: number | null;
  name: string; phone: string | null; vehicle: string | null; plate: string | null; place: string | null; time: string | null;
  docs: { licence?: boolean; rc?: boolean; photo?: boolean }; docOverride: string | null; verified: boolean; driverLink: string | null; accepted?: boolean;
  partnerStatus?: "offered" | "accepted" | "declined" | null; partnerDeclineReason?: string | null; partnerAmount?: number | null; earningPostedAt?: string | null; fleetDriverId?: number | null;
};
type Score = { avg: number; ratings: number; strikes: number; reports: number } | null;
type Expert = { id: number; name: string; phone: string | null; score?: Score };
type Manager = { id: number; name: string; email: string; role: string };
type Partner = { id: number; name: string; kinds: TravelPartnerKind[]; baseTown: string | null; regionIds: number[]; phone: string | null; isActive: boolean; score?: Score; businessPartnerId?: number | null };
const stars = (s: Score | undefined) => (s ? ` · ${s.avg}★ (${s.ratings})${s.strikes ? ` · ${s.strikes} strike${s.strikes === 1 ? "" : "s"}` : ""}` : "");

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "open", label: "Open" }, { key: "new", label: "New" }, { key: "assigned", label: "Assigned" }, { key: "contacted", label: "In discussion" },
  { key: "quoted", label: "Quoted" }, { key: "confirmed", label: "Booked" }, { key: "started", label: "On trip" }, { key: "completed", label: "Completed" }, { key: "cancelled", label: "Cancelled" }, { key: "", label: "All" },
];
const STAY: Record<string, string> = { none: "No stay", budget: "Budget stay", standard: "Standard hotel", premium: "Premium hotel", homestay: "Homestay" };
const TONE: Record<TripStatus, string> = {
  new: "bg-amber-500/15 text-amber-300 border-amber-500/30", assigned: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  contacted: "bg-violet-500/15 text-violet-300 border-violet-500/30", quoted: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  confirmed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", started: "bg-orange-500/20 text-orange-200 border-orange-500/40",
  completed: "bg-white/10 text-slate-200 border-white/20", cancelled: "bg-white/5 text-slate-400 border-white/10",
};
const ROLE: Record<TeamMember["role"], string> = { driver: "Driver", stay: "Stay", guide: "Guide", activity: "Activity" };
const field = "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white";
const select = "h-10 w-full rounded-md border border-[rgba(255,255,255,0.08)] bg-[hsl(222,47%,11%)] px-3 text-sm text-white";
const panel = "rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]";
const box = "space-y-2 rounded-xl border border-white/5 p-3";
const rupees = (n: number | null | undefined) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN")}`);
const hours = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);
const dateText = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—");
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
const STAFF_ROLE = (r: string) => r.replace(/_/g, " ");

function Itinerary({ plan }: { plan: TripPlan }) {
  return (
    <ol className="space-y-3">
      {plan.days.map((d) => (
        <li key={d.day} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-200">Day {d.day}</span>
            <span>{d.km} km · {hours(d.minutes)}{d.stayNear ? ` · night near ${d.stayNear}` : ""}</span>
          </div>
          <ul className="space-y-1 text-sm">
            {d.stops.map((s, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${s.type === "place" ? "bg-sky-400" : "bg-slate-500"}`} />
                <span className="text-slate-200">{s.name}</span>
                <span className="text-xs text-slate-500">{s.driveKm ? `${s.driveKm} km drive` : ""}{s.visitMinutes ? `${s.driveKm ? " · " : ""}${hours(s.visitMinutes)} there` : ""}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** The message a manager sends a partner to ask for their price (no customer contact details). */
function askText(t: Trip, p: Partner) {
  const places = t.plan ? t.plan.days.flatMap((d) => d.stops.filter((s) => s.type === "place").map((s) => s.name)).join(", ") : "";
  const needs = [t.needsCab ? `cab (${t.vehicle})` : null, t.stay !== "none" ? `${STAY[t.stay] ?? t.stay}${t.rooms ? `, ${t.rooms} room${t.rooms === 1 ? "" : "s"}` : ""}${t.plan?.nights ? `, ${t.plan.nights} night${t.plan.nights === 1 ? "" : "s"}` : ""}` : null, t.needsGuide ? "guide" : null].filter(Boolean).join("; ");
  return `Hello ${p.name}, UniteFix travel enquiry ${t.code}.\n${t.adults + t.children} people, from ${dateText(t.startDate)} for ${t.days ?? "?"} day${t.days === 1 ? "" : "s"}.\nFrom ${t.pickupText ?? "?"}${t.tripType === "round_trip" ? " (round trip)" : ` to ${t.dropText ?? "?"}`}.\nPlaces: ${places}.\nWe need: ${needs || "—"}.\nPlease send your best price.`;
}

function SupplierPrices({ t, partners, onDone }: { t: Trip; partners: Partner[]; onDone: () => void }) {
  const { toast } = useToast();
  const [source, setSource] = useState<string>("own");
  const [covers, setCovers] = useState("");
  const [amount, setAmount] = useState("");
  const [edit, setEdit] = useState<Record<number, string>>({});
  const err = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });
  const add = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/travel/trips/${t.id}/quotes`, source === "own"
      ? { source: "own", covers: covers || null, amount: amount ? Number(amount) : null }
      : { source: "partner", partnerId: Number(source), covers: covers || null, amount: amount ? Number(amount) : null }),
    onSuccess: () => { setCovers(""); setAmount(""); onDone(); }, onError: err("Not added"),
  });
  const save = useMutation({ mutationFn: async (v: { id: number; body: Record<string, unknown> }) => apiRequest("PATCH", `/api/admin/travel/trips/${t.id}/quotes/${v.id}`, v.body), onSuccess: () => onDone(), onError: err("Not saved") });
  const remove = useMutation({ mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/travel/trips/${t.id}/quotes/${id}`), onSuccess: () => onDone(), onError: err("Not removed") });
  const choose = useMutation({ mutationFn: async (id: number | null) => apiRequest("PATCH", `/api/admin/travel/trips/${t.id}`, { chosenQuoteId: id }), onSuccess: () => onDone(), onError: err("Not saved") });

  const priced = t.quotes.filter((q) => q.status === "quoted" && q.amount != null);
  const lowest = priced.length ? Math.min(...priced.map((q) => q.amount!)) : null;
  // Partners for this trip's regions first, then the rest.
  const active = partners.filter((p) => p.isActive);
  const near = active.filter((p) => p.regionIds.some((r) => t.regionIds.includes(r)));
  const others = active.filter((p) => !near.includes(p));
  const byId = new Map(partners.map((p) => [p.id, p]));
  const paid = t.advanceStatus === "paid";

  return (
    <section className={box}>
      <p className="text-sm font-semibold text-white">2. Supplier prices</p>
      <p className="text-xs text-slate-400">Check our own team first, then ask travel partners. The lowest price is marked.</p>
      {t.quotes.length > 0 && (
        <ul className="space-y-2">
          {t.quotes.map((q) => {
            const p = q.partnerId ? byId.get(q.partnerId) : null;
            const isLow = q.status === "quoted" && q.amount != null && q.amount === lowest;
            const chosen = t.chosenQuoteId === q.id;
            return (
              <li key={q.id} className={`rounded-lg border p-2.5 ${chosen ? "border-emerald-500/40 bg-emerald-500/5" : "border-white/5"}`} data-testid={`quote-${q.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{q.label}</span>
                  {q.source === "own" && <Badge className="bg-sky-500/20 text-sky-200 hover:bg-sky-500/20">Our team</Badge>}
                  {p?.businessPartnerId ? <Badge className="bg-violet-500/20 text-violet-200 hover:bg-violet-500/20">{q.respondedAt ? "Answered in their Hub" : "Asked in their Hub"}</Badge> : null}
                  {isLow && <Badge className="bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/20">Lowest</Badge>}
                  {chosen && <Badge className="bg-emerald-600 text-white hover:bg-emerald-600"><Check className="mr-1 h-3 w-3" />Chosen</Badge>}
                  <span className="ml-auto text-sm font-semibold text-white">{q.status === "declined" ? <span className="text-slate-500">Declined</span> : q.amount != null ? rupees(q.amount) : <span className="text-amber-300">Waiting</span>}</span>
                </div>
                {q.covers && <p className="mt-0.5 text-xs text-slate-400">{q.covers}</p>}
                {!paid && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {q.status !== "quoted" && (
                      <>
                        <Input aria-label={`Price from ${q.label}`} className={`${field} h-8 w-32`} inputMode="numeric" placeholder="₹ price" value={edit[q.id] ?? ""} onChange={(e) => setEdit({ ...edit, [q.id]: e.target.value.replace(/\D/g, "") })} />
                        <Button size="sm" variant="outline" className="h-8" disabled={!edit[q.id]} onClick={() => save.mutate({ id: q.id, body: { amount: Number(edit[q.id]) } })}>Save price</Button>
                        {q.status === "asked" && <Button size="sm" variant="ghost" className="h-8 text-slate-400" onClick={() => save.mutate({ id: q.id, body: { status: "declined" } })}>Declined</Button>}
                      </>
                    )}
                    {q.status === "quoted" && !chosen && <Button size="sm" variant="outline" className="h-8" onClick={() => choose.mutate(q.id)}>Use this</Button>}
                    {p?.phone && (
                      <a className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-500/30 px-2.5 text-xs text-emerald-300 hover:bg-emerald-500/10" target="_blank" rel="noreferrer"
                        href={`https://wa.me/91${p.phone}?text=${encodeURIComponent(askText(t, p))}`}><MessageCircle className="h-3.5 w-3.5" /> Ask on WhatsApp</a>
                    )}
                    {p?.phone && <a className="inline-flex h-8 items-center gap-1 rounded-md border border-white/10 px-2.5 text-xs text-slate-200 hover:bg-white/5" href={`tel:+91${p.phone}`}><Phone className="h-3.5 w-3.5" /> {p.phone}</a>}
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-slate-500" title="Remove" onClick={() => remove.mutate(q.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!paid && (
        <div className="grid gap-2 sm:grid-cols-[1.3fr_1.3fr_0.8fr_auto] sm:items-end">
          <div>
            <Label htmlFor={`src-${t.id}`} className="text-xs text-slate-400">From</Label>
            <select id={`src-${t.id}`} className={select} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="own">Our team (UniteFix experts)</option>
              {near.length > 0 && <optgroup label="Serve these places">{near.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.kinds.map((k) => TRAVEL_PARTNER_KIND_LABEL[k] ?? k).join(", ")}</option>)}</optgroup>}
              {others.length > 0 && <optgroup label="Other partners">{others.map((p) => <option key={p.id} value={p.id}>{p.name}{p.baseTown ? ` (${p.baseTown})` : ""}</option>)}</optgroup>}
            </select>
          </div>
          <div><Label htmlFor={`cov-${t.id}`} className="text-xs text-slate-400">For</Label><Input id={`cov-${t.id}`} className={field} value={covers} onChange={(e) => setCovers(e.target.value)} placeholder="Innova 3 days + 2 rooms" /></div>
          <div><Label htmlFor={`amt-${t.id}`} className="text-xs text-slate-400">Price (blank = ask)</Label><Input id={`amt-${t.id}`} className={field} value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="₹" /></div>
          <Button size="sm" className="h-10" onClick={() => add.mutate()} disabled={add.isPending}>{amount ? "Add price" : "Ask"}</Button>
        </div>
      )}
      {partners.length === 0 && <p className="text-xs text-slate-500">No travel partners yet. Add them in Travel → Travel Partners.</p>}
    </section>
  );
}

function TripCard({ t, managers, partners, experts, settings, onDone }: { t: Trip; managers: Manager[]; partners: Partner[]; experts: Expert[]; settings: TravelSettings | undefined; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(["new", "assigned", "contacted", "quoted", "confirmed", "started"].includes(t.status));
  const [mgr, setMgr] = useState<string>(t.managerAdminId ? String(t.managerAdminId) : "");
  const [mgrName, setMgrName] = useState(t.managerName ?? "");
  const [mgrPhone, setMgrPhone] = useState(t.managerPhone ?? "");
  const [status, setStatus] = useState<TripStatus>(t.status);
  const chosen = t.quotes.find((q) => q.id === t.chosenQuoteId) ?? null;
  const [price, setPrice] = useState(t.quoteAmount != null ? String(t.quoteAmount) : "");
  const [quoteNote, setQuoteNote] = useState(t.quoteNote ?? "");
  const [holdHours, setHoldHours] = useState(String(settings?.quoteValidHours ?? 48));
  const [staffNote, setStaffNote] = useState(t.staffNote ?? "");
  useEffect(() => { setStatus(t.status); }, [t.status]);
  // Picking a supplier fills in the customer price and what it covers, to adjust.
  useEffect(() => { if (chosen && t.quoteAmount == null) { setPrice(chosen.amount != null ? String(chosen.amount) : ""); if (!quoteNote && chosen.covers) setQuoteNote(chosen.covers); } }, [chosen?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const err = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });
  const assign = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/travel/trips/${t.id}/assign`, { managerAdminId: mgr ? Number(mgr) : null, managerName: mgrName, managerPhone: mgrPhone }),
    onSuccess: (r: any) => { toast({ title: "Assigned", description: r?.message }); onDone(); }, onError: err("Not assigned"),
  });
  const sendQuote = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/admin/travel/trips/${t.id}`, { quoteAmount: Number(price), quoteNote: quoteNote.trim() || null, validHours: Number(holdHours) || undefined }),
    onSuccess: (r: any) => { toast({ title: r?.message ?? "Sent" }); onDone(); }, onError: err("Not sent"),
  });
  const hold = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/admin/travel/trips/${t.id}`, { validHours: Number(holdHours) || 24 }),
    onSuccess: () => { toast({ title: "Price held again", description: "The customer can book it now." }); onDone(); }, onError: err("Not saved"),
  });
  const save = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/admin/travel/trips/${t.id}`, { status: status !== t.status ? status : undefined, staffNote: staffNote.trim() || null }),
    onSuccess: () => { toast({ title: "Saved" }); onDone(); }, onError: err("Not saved"),
  });

  const people = `${t.adults} adult${t.adults === 1 ? "" : "s"}${t.children ? `, ${t.children} child${t.children === 1 ? "" : "ren"}` : ""}`;
  const route = t.tripType === "round_trip" ? `${t.pickupText ?? "?"} ⇄ round trip` : `${t.pickupText ?? "?"} → ${t.dropText ?? "?"}`;
  const wa = `https://wa.me/91${t.contactPhone.slice(-10)}?text=${encodeURIComponent(`Hello ${t.contactName}, this is ${t.managerName ?? "your UniteFix travel manager"} about your trip ${t.code}.`)}`;
  const paid = t.advanceStatus === "paid";
  const expired = !!t.quoteValidUntil && new Date(t.quoteValidUntil).getTime() < Date.now() && !paid;
  const priceN = Number(price) || 0;
  const pct = settings?.advancePercent ?? 20;
  const margin = chosen?.amount != null && priceN ? priceN - chosen.amount : null;
  const closed = t.status === "cancelled";

  return (
    <li className={panel} data-testid={`trip-${t.code}`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left">
        <span className="font-mono text-sm text-sky-300">{t.code}</span>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE[t.status]}`}>{TRIP_STATUS_LABEL[t.status]}</span>
        <span className="font-semibold text-white">{t.contactName}</span>
        <span className="text-sm text-slate-400">{people} · {route}</span>
        <span className="text-sm text-slate-400">{dateText(t.startDate)} · {t.days ?? "?"} day{t.days === 1 ? "" : "s"}</span>
        {t.managerName && <span className="text-xs text-slate-400">Manager: {t.managerName}</span>}
        {t.quoteAmount != null && <span className="text-sm font-semibold text-emerald-300">{rupees(t.quoteAmount)}{paid ? " · advance paid" : expired ? " · price expired" : ""}</span>}
        <span className="ml-auto text-slate-500">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>
      {open && (
        <div className="grid gap-5 border-t border-white/5 p-4 lg:grid-cols-[1fr_1.15fr]">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap gap-2">
              <a href={`tel:+91${t.contactPhone.slice(-10)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/5"><Phone className="h-4 w-4" /> {t.contactPhone}</a>
              <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/10"><MessageCircle className="h-4 w-4" /> WhatsApp</a>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex gap-2"><Users className="h-4 w-4 text-slate-500" /><dd className="text-slate-200">{people}</dd></div>
              <div className="flex gap-2"><MapPin className="h-4 w-4 text-slate-500" /><dd className="text-slate-200">{route}</dd></div>
              <div className="flex gap-2"><CalendarDays className="h-4 w-4 text-slate-500" /><dd className="text-slate-200">From {dateText(t.startDate)}, {t.pace} pace</dd></div>
              <div className="flex gap-2"><BedDouble className="h-4 w-4 text-slate-500" /><dd className="text-slate-200">{STAY[t.stay] ?? t.stay}{t.rooms ? ` · ${t.rooms} room${t.rooms === 1 ? "" : "s"}` : ""}</dd></div>
              <div className="flex gap-2"><Car className="h-4 w-4 text-slate-500" /><dd className="text-slate-200">{t.needsCab ? `Cab: ${t.vehicle}` : "Own transport"}</dd></div>
              <div className="flex gap-2"><Compass className="h-4 w-4 text-slate-500" /><dd className="text-slate-200">{t.needsGuide ? "Wants a guide" : "No guide"}{t.budgetPerPerson ? ` · budget ${rupees(t.budgetPerPerson)} a person` : ""}</dd></div>
            </dl>
            {t.notes && <p className="rounded-lg bg-white/[0.03] p-3 text-sm text-slate-300">“{t.notes}”</p>}
            {t.members.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Invited</p>
                <ul className="flex flex-wrap gap-2 text-sm">{t.members.map((m) => <li key={m.id} className="rounded-full bg-white/5 px-2.5 py-1 text-slate-300">{m.name}{m.phone ? ` · ${m.phone}` : ""}</li>)}</ul>
              </div>
            )}
            {t.plan && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Route className="h-3.5 w-3.5" /> Plan · {t.plan.totalKm} km · {t.plan.nights} night{t.plan.nights === 1 ? "" : "s"}</p>
                <Itinerary plan={t.plan} />
                {t.plan.startUnknown && <p className="mt-2 text-xs text-amber-300">Pickup was typed by the customer, so drive times from it are not counted. Confirm the pickup on the call.</p>}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <section className={box}>
              <p className="text-sm font-semibold text-white">1. Travel manager</p>
              <select aria-label="Staff member" className={select} value={mgr} onChange={(e) => { setMgr(e.target.value); const m = managers.find((x) => String(x.id) === e.target.value); if (m) setMgrName(m.name); }}>
                <option value="">Someone outside the admin</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name} ({STAFF_ROLE(m.role)})</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor={`mgrn-${t.id}`} className="text-xs text-slate-400">Name the customer sees</Label><Input id={`mgrn-${t.id}`} className={field} value={mgrName} onChange={(e) => setMgrName(e.target.value)} placeholder="Kiran" /></div>
                <div><Label htmlFor={`mgrp-${t.id}`} className="text-xs text-slate-400">Their phone</Label><Input id={`mgrp-${t.id}`} className={field} value={mgrPhone} onChange={(e) => setMgrPhone(e.target.value)} placeholder="98450 12345" inputMode="tel" /></div>
              </div>
              <Button size="sm" variant={t.managerName ? "outline" : "default"} onClick={() => assign.mutate()} disabled={assign.isPending || mgrName.trim().length < 2 || mgrPhone.replace(/\D/g, "").length < 10 || closed || paid}>
                {t.managerName ? "Change manager" : "Assign and tell the customer"}
              </Button>
            </section>

            <SupplierPrices t={t} partners={partners} onDone={onDone} />

            <section className={box}>
              <p className="text-sm font-semibold text-white">3. Price for the customer</p>
              {paid ? (
                <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-200">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>Booked: {rupees(t.advanceAmount)} advance paid {when(t.advancePaidAt)}. Balance {rupees((t.quoteAmount ?? 0) - (t.advanceAmount ?? 0))} on the trip.{t.costAmount != null ? ` Supplier cost ${rupees(t.costAmount)}.` : ""}</div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label htmlFor={`q-${t.id}`} className="text-xs text-slate-400">Whole group (₹)</Label><Input id={`q-${t.id}`} className={field} value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="42000" /></div>
                    <div><Label htmlFor={`h-${t.id}`} className="text-xs text-slate-400">Hold the price for (hours)</Label><Input id={`h-${t.id}`} className={field} value={holdHours} onChange={(e) => setHoldHours(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></div>
                  </div>
                  <div><Label htmlFor={`qn-${t.id}`} className="text-xs text-slate-400">What it covers (the customer sees this)</Label><Input id={`qn-${t.id}`} className={field} value={quoteNote} onChange={(e) => setQuoteNote(e.target.value)} placeholder="Innova for 3 days, 2 rooms × 2 nights, guide at Gokarna" /></div>
                  {priceN > 0 && (
                    <p className="text-xs text-slate-400">
                      Customer books with {pct}%: <b className="text-slate-200">{rupees(advanceFor(priceN, pct))}</b> (not refundable), balance {rupees(priceN - advanceFor(priceN, pct))} on the trip.
                      {margin != null && <> Our margin over {chosen!.label}: <b className={margin < 0 ? "text-red-300" : "text-emerald-300"}>{rupees(margin)}</b>{priceN ? ` (${Math.round((margin / priceN) * 100)}%)` : ""}.</>}
                    </p>
                  )}
                  {t.quoteAmount != null && (
                    <p className={`flex items-center gap-1.5 text-xs ${expired ? "text-amber-300" : "text-slate-400"}`}>
                      <Clock className="h-3.5 w-3.5" /> {rupees(t.quoteAmount)} sent {when(t.quotedAt)} · {expired ? "hold ran out" : `held until ${when(t.quoteValidUntil)}`}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => sendQuote.mutate()} disabled={sendQuote.isPending || !priceN || !t.managerName || closed}>{t.quoteAmount != null && Number(price) === t.quoteAmount ? "Send again" : "Send to customer"}</Button>
                    {expired && <Button size="sm" variant="outline" onClick={() => hold.mutate()} disabled={hold.isPending}>Hold the same price again</Button>}
                  </div>
                </>
              )}
            </section>

            <section className={box}>
              <p className="text-sm font-semibold text-white">4. Status and notes</p>
              <div className="grid grid-cols-[1fr_2fr] gap-2">
                <select aria-label="Status" className={select} value={status} onChange={(e) => setStatus(e.target.value as TripStatus)}>
                  {(Object.keys(TRIP_STATUS_LABEL) as TripStatus[]).map((s) => <option key={s} value={s}>{TRIP_STATUS_LABEL[s]}</option>)}
                </select>
                <Input aria-label="Staff note" className={field} value={staffNote} onChange={(e) => setStaffNote(e.target.value)} placeholder="Staff note: called at 4 pm, wants a sea-view room" />
              </div>
              <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
            </section>
            {["confirmed", "started", "completed"].includes(t.status) && <TripTeam t={t} partners={partners} experts={experts} onDone={onDone} />}
            {["confirmed", "started", "completed"].includes(t.status) && <TripMoney t={t} partners={partners} onDone={onDone} />}
            {t.status === "started" && <p className="text-xs text-slate-400">Progress: {t.progress.done} of {t.progress.total} places{t.progress.next ? ` · next ${t.progress.next}` : ""}{t.familyUrl ? <> · <a className="underline" href={t.familyUrl} target="_blank" rel="noreferrer">family view</a></> : null} · see Live Trips</p>}
            <p className="text-xs text-slate-500">Sent {when(t.createdAt)}{t.assignedAt ? ` · assigned ${when(t.assignedAt)}` : ""}{t.quotedAt ? ` · quoted ${when(t.quotedAt)}` : ""}</p>
          </div>
        </div>
      )}
    </li>
  );
}

function TripTeam({ t, partners, experts, onDone }: { t: Trip; partners: Partner[]; experts: Expert[]; onDone: () => void }) {
  const { toast } = useToast();
  const blank = { role: "driver", day: "1", source: "own", employeeId: "", partnerId: "", name: "", phone: "", vehicle: "", plate: "", place: "", time: "", licence: false, rc: false, photo: false, docOverride: "", partnerAmount: "" };
  const [f, setF] = useState<Record<string, any>>(blank);
  const err = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });
  const add = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/travel/trips/${t.id}/team`, {
      role: f.role, day: f.day ? Number(f.day) : null, source: f.source,
      employeeId: f.source === "own" && f.employeeId ? Number(f.employeeId) : null, partnerId: f.source === "partner" && f.partnerId ? Number(f.partnerId) : null,
      name: f.name || null, phone: f.phone || null, vehicle: f.vehicle || null, plate: f.plate || null, place: f.place || null, time: f.time || null,
      docs: { licence: f.licence, rc: f.rc, photo: f.photo }, docOverride: f.docOverride || null,
      partnerAmount: f.source === "partner" && f.partnerAmount ? Number(f.partnerAmount) : null,
    }),
    onSuccess: () => { setF({ ...blank, role: f.role }); onDone(); }, onError: err("Not added"),
  });
  const remove = useMutation({ mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/travel/trips/${t.id}/team/${id}`), onSuccess: () => onDone(), onError: err("Not removed") });
  const start = useMutation({ mutationFn: async () => apiRequest("POST", `/api/admin/travel/trips/${t.id}/start`, {}), onSuccess: (r: any) => { toast({ title: r?.message }); onDone(); }, onError: err("Not started") });
  const end = useMutation({ mutationFn: async () => apiRequest("POST", `/api/admin/travel/trips/${t.id}/end`, {}), onSuccess: (r: any) => { toast({ title: r?.message }); onDone(); }, onError: err("Not finished") });
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast({ title: "Driver link copied" }); } catch { window.prompt("Copy the driver link:", text); } };
  const days = Math.max(1, t.days ?? 1);
  const hubPartner = f.source === "partner" && !!partners.find((p) => String(p.id) === String(f.partnerId))?.businessPartnerId;
  const partnerDriver = f.role === "driver" && f.source === "partner" && !hubPartner;
  const docsOk = f.licence && f.rc && f.photo;
  return (
    <section className={box}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-white">5. Trip team</p>
        {t.startCode && <span className="text-xs text-slate-400">Pickup code <b className="font-mono text-slate-200">{t.startCode}</b> (the traveller gives it to the driver)</span>}
        {t.status === "confirmed" && <Button size="sm" variant="outline" className="ml-auto h-8" onClick={() => start.mutate()} disabled={start.isPending}><Play className="mr-1 h-3.5 w-3.5" />Start the trip</Button>}
        {t.status === "started" && <Button size="sm" variant="outline" className="ml-auto h-8" onClick={() => end.mutate()} disabled={end.isPending}><Flag className="mr-1 h-3.5 w-3.5" />Trip finished</Button>}
      </div>
      <p className="text-xs text-slate-400">The traveller sees the team once the trip is booked; phone numbers and the pickup code from 6 pm the evening before. Our experts first.</p>
      {t.team.length > 0 && (
        <ul className="space-y-2">
          {t.team.map((m) => (
            <li key={m.id} className="rounded-lg border border-white/5 p-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-white/10 px-1.5 text-xs text-slate-300">{m.day ? `Day ${m.day}` : "All days"}</span>
                <span className="text-xs text-slate-400">{ROLE[m.role]}</span>
                <b className="text-white">{m.name}</b>
                {m.source === "own" && <span className="rounded-full bg-sky-500/20 px-2 text-xs text-sky-200">Our team</span>}
                {m.partnerStatus === "offered" && <span className="rounded-full bg-amber-500/20 px-2 text-xs text-amber-200">Waiting for the partner</span>}
                {m.partnerStatus === "accepted" && <span className="rounded-full bg-emerald-500/20 px-2 text-xs text-emerald-200">Partner accepted{m.role === "driver" && !m.fleetDriverId ? ", driver to come" : ""}</span>}
                {m.partnerStatus === "declined" && <span className="rounded-full bg-rose-500/20 px-2 text-xs text-rose-200">Partner declined{m.partnerDeclineReason ? `: ${m.partnerDeclineReason}` : ""}</span>}
                {m.partnerAmount != null && <span className="text-xs text-slate-300">₹{m.partnerAmount.toLocaleString("en-IN")}{m.earningPostedAt ? " · on their statement" : ""}</span>}
                {m.role === "driver" && (m.accepted ? <span className="rounded-full bg-emerald-500/20 px-2 text-xs text-emerald-200">Accepted</span> : <span className="rounded-full bg-white/10 px-2 text-xs text-slate-300">Not accepted yet</span>)}
                {m.verified ? <ShieldCheck className="h-4 w-4 text-emerald-400" aria-label="Verified" /> : <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 text-xs text-amber-200"><ShieldAlert className="h-3 w-3" />Not verified</span>}
                <span className="text-slate-400">{[m.phone, m.vehicle, m.plate, m.place, m.time].filter(Boolean).join(" · ")}</span>
                <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-slate-500" title="Remove" onClick={() => remove.mutate(m.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
              {m.docOverride && <p className="mt-1 text-xs text-amber-200">Assigned without all documents: {m.docOverride}</p>}
              {m.driverLink && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copy(m.driverLink!)}><Copy className="mr-1 h-3 w-3" />Copy driver link</Button>
                  {m.phone && <a className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-500/30 px-2.5 text-xs text-emerald-300 hover:bg-emerald-500/10" target="_blank" rel="noreferrer"
                    href={`https://wa.me/91${m.phone}?text=${encodeURIComponent(`UniteFix trip ${t.code}, pickup ${t.pickupText ?? ""} on ${t.startDate ?? ""}${m.time ? ` at ${m.time}` : ""}. At pickup, ask the traveller for the 4-digit code and enter it here to start the trip: ${m.driverLink}`)}`}><MessageCircle className="h-3 w-3" />Send the link on WhatsApp</a>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {t.status !== "completed" && t.status !== "cancelled" && (
        <div className="space-y-2 rounded-lg border border-dashed border-white/10 p-2.5">
          <div className="grid gap-2 sm:grid-cols-4">
            <select aria-label="Role" className={select} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select aria-label="Day" className={select} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })}><option value="">All days</option>{Array.from({ length: days }, (_, i) => <option key={i} value={i + 1}>Day {i + 1}</option>)}</select>
            <select aria-label="From" className={select} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="own">Our team</option><option value="partner">A travel partner</option></select>
            {f.source === "own"
              ? <select aria-label="Expert" className={select} value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Choose an expert</option>{experts.map((x) => <option key={x.id} value={x.id}>{x.name}{stars(x.score)}</option>)}</select>
              : <select aria-label="Partner" className={select} value={f.partnerId} onChange={(e) => setF({ ...f, partnerId: e.target.value })}><option value="">Which partner (optional)</option>{partners.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}{stars(p.score)}</option>)}</select>}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {f.source === "partner" && !hubPartner && <Input aria-label="Name" className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.role === "stay" ? "Hotel or homestay name" : "Name"} />}
            {f.source === "partner" && !hubPartner && <Input aria-label="Phone" className={field} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Mobile" inputMode="tel" />}
            {f.source === "partner" && <Input aria-label="Agreed pay" className={field} value={f.partnerAmount} onChange={(e) => setF({ ...f, partnerAmount: e.target.value.replace(/\D/g, "") })} placeholder="Agreed pay to the partner, ₹" inputMode="numeric" />}
            {f.role === "driver" && <Input aria-label="Vehicle" className={field} value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value })} placeholder="Innova, white" />}
            {f.role === "driver" && <Input aria-label="Number plate" className={field} value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} placeholder="KA 31 M 4821" />}
            {f.role !== "driver" && <Input aria-label="Place" className={field} value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} placeholder="Address or meeting point" />}
            <Input aria-label="Time" className={field} value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} placeholder={f.role === "driver" ? "Pickup 07:30" : f.role === "stay" ? "Check-in 18:00" : "Time 10:00"} />
          </div>
          {partnerDriver && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
              <span>Checked:</span>
              {(["licence", "rc", "photo"] as const).map((k) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{k === "rc" ? "RC" : k === "licence" ? "Licence" : "Face photo"}</label>)}
              {!docsOk && <Input aria-label="Why without documents" className={`${field} h-8 flex-1 min-w-[220px]`} value={f.docOverride} onChange={(e) => setF({ ...f, docOverride: e.target.value })} placeholder="Why assign without all documents (logged)" />}
            </div>
          )}
          {hubPartner && <p className="text-xs text-sky-200">This partner has a Hub account: they accept the trip and put their own checked driver and vehicle on it. Their agreed pay goes on their statement when the trip ends.</p>}
          <Button size="sm" onClick={() => add.mutate()} disabled={add.isPending}>{hubPartner ? "Assign to the partner" : "Add to the team"}</Button>
        </div>
      )}
    </section>
  );
}

function TripMoney({ t, partners, onDone }: { t: Trip; partners: Partner[]; onDone: () => void }) {
  const { toast } = useToast();
  const [bal, setBal] = useState(String(t.money.balanceReceived || ""));
  const [balMethod, setBalMethod] = useState(t.balanceMethod ?? "cash");
  const [f, setF] = useState({ who: "", payee: "", amount: "", method: "upi", reference: "" });
  const err = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });
  const saveBal = useMutation({ mutationFn: async () => apiRequest("PUT", `/api/admin/travel/trips/${t.id}/balance`, { amount: Number(bal || 0), method: balMethod }), onSuccess: () => { toast({ title: "Balance recorded" }); onDone(); }, onError: err("Not saved") });
  const pay = useMutation({
    mutationFn: async () => {
      const m = f.who.startsWith("m:") ? t.team.find((x) => x.id === Number(f.who.slice(2))) : null;
      const pid = f.who.startsWith("p:") ? Number(f.who.slice(2)) : m?.partnerId ?? null;
      const payee = f.payee.trim() || m?.name || partners.find((p) => p.id === pid)?.name || "";
      return apiRequest("POST", `/api/admin/travel/trips/${t.id}/payouts`, { partnerId: pid, teamMemberId: m?.id ?? null, payee, amount: Number(f.amount), method: f.method, reference: f.reference || null });
    },
    onSuccess: () => { setF({ who: "", payee: "", amount: "", method: "upi", reference: "" }); onDone(); }, onError: err("Not recorded"),
  });
  const del = useMutation({ mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/travel/trips/${t.id}/payouts/${id}`), onSuccess: () => onDone(), onError: err("Not removed") });
  const m = t.money;
  const tile = (label: string, value: string, tone = "text-white") => <div className="rounded-lg bg-white/[0.04] p-2.5"><p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p><p className={`text-lg font-semibold ${tone}`}>{value}</p></div>;
  return (
    <section className={box}>
      <p className="text-sm font-semibold text-white">6. Money</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tile("Price", rupees(m.price))}
        {tile("Collected", rupees(m.collected), m.balanceDue ? "text-amber-200" : "text-emerald-300")}
        {tile("Paid to partners", rupees(m.paidOut))}
        {tile("Margin", rupees(m.margin), m.margin < 0 ? "text-red-300" : "text-emerald-300")}
      </div>
      <p className="text-xs text-slate-400">Advance {rupees(m.advance)} by link · balance received {rupees(m.balanceReceived)}{m.balanceDue ? ` · still due ${rupees(m.balanceDue)}` : ""} · cash in hand after payouts {rupees(m.cashInHand)}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div><Label htmlFor={`bal-${t.id}`} className="text-xs text-slate-400">Balance received on the trip (₹)</Label><Input id={`bal-${t.id}`} className={`${field} w-40`} value={bal} onChange={(e) => setBal(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></div>
        <select aria-label="Balance method" className={`${select} w-32`} value={balMethod} onChange={(e) => setBalMethod(e.target.value)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="other">Other</option></select>
        <Button size="sm" variant="outline" className="h-10" onClick={() => saveBal.mutate()} disabled={saveBal.isPending}>Save balance</Button>
      </div>
      {t.payouts.length > 0 && (
        <ul className="space-y-1 text-sm">
          {t.payouts.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 px-2.5 py-1.5">
              <b className="text-white">{p.payee}</b><span className="text-slate-300">{rupees(p.amount)}</span>
              <span className="text-xs text-slate-400">{p.method.toUpperCase()}{p.reference ? ` · ${p.reference}` : ""}{p.paidOn ? ` · ${p.paidOn}` : ""}</span>
              <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-slate-500" title="Remove" onClick={() => del.mutate(p.id)}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_1fr_auto] sm:items-end">
        <select aria-label="Paid to" className={select} value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })}>
          <option value="">Paid to…</option>
          {t.team.length > 0 && <optgroup label="On this trip">{t.team.map((x) => <option key={x.id} value={`m:${x.id}`}>{x.name} ({ROLE[x.role]})</option>)}</optgroup>}
          <optgroup label="Travel partners">{partners.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>
        </select>
        <Input aria-label="Payee name" className={field} value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} placeholder="Or type a name" />
        <Input aria-label="Amount paid" className={field} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="₹" />
        <select aria-label="Paid by" className={select} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="upi">UPI</option><option value="bank">Bank</option><option value="cash">Cash</option><option value="other">Other</option></select>
        <Input aria-label="Reference" className={field} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="UTR / note" />
        <Button size="sm" className="h-10" onClick={() => pay.mutate()} disabled={pay.isPending || !f.amount || (!f.who && f.payee.trim().length < 2)}>Record payment</Button>
      </div>
      {t.ratings.length > 0 && (
        <div className="space-y-1 border-t border-white/5 pt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Traveller's ratings</p>
          {t.ratings.map((r) => (
            <p key={r.id} className="text-sm"><b className="text-white">{r.name}</b> <span className="text-xs text-slate-400">{r.role}</span> <span className={r.stars < 3 ? "text-red-300" : "text-amber-300"}>{"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}</span>
              {r.tags.length > 0 && <span className="text-xs text-slate-400"> · {r.tags.join(", ")}</span>}{r.comment && <span className="text-slate-300"> · “{r.comment}”</span>}</p>
          ))}
        </div>
      )}
    </section>
  );
}

function SettingsPanel({ settings, managers }: { settings: TravelSettings; managers: Manager[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(!settings.defaultManager);
  const [mgr, setMgr] = useState(settings.defaultManager?.adminId ? String(settings.defaultManager.adminId) : "");
  const [name, setName] = useState(settings.defaultManager?.name ?? "");
  const [phone, setPhone] = useState(settings.defaultManager?.phone ?? "");
  const [pct, setPct] = useState(String(settings.advancePercent));
  const [hrs, setHrs] = useState(String(settings.quoteValidHours));
  const [cut, setCut] = useState(String(settings.cancelCutoffDays));
  const [lead, setLead] = useState({ name: settings.safetyLead?.name ?? "", phone: settings.safetyLead?.phone ?? "", email: settings.safetyLead?.email ?? "" });
  const save = useMutation({
    mutationFn: async () => apiRequest("PUT", "/api/admin/travel/settings", {
      defaultManager: name.trim() ? { adminId: mgr ? Number(mgr) : null, name: name.trim(), phone } : null,
      advancePercent: Number(pct), quoteValidHours: Number(hrs), cancelCutoffDays: Number(cut),
      safetyLead: lead.name.trim() ? { name: lead.name.trim(), phone: lead.phone, email: lead.email.trim() || null } : null,
    }),
    onSuccess: () => { toast({ title: "Travel settings saved" }); queryClient.invalidateQueries({ queryKey: ["/api/admin/travel/settings"] }); setOpen(false); },
    onError: (e) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <section className={`${panel} p-4`}>
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Settings2 className="h-4 w-4 text-slate-400" />
        <span className="font-semibold text-white">Travel settings</span>
        <span className="text-sm text-slate-400">
          {settings.defaultManager ? `New trips go to ${settings.defaultManager.name}` : "No default manager: new trips wait for one"} · {settings.advancePercent}% advance · prices held {settings.quoteValidHours} h · cancel up to {settings.cancelCutoffDays} days before · {settings.safetyLead ? `night alerts: ${settings.safetyLead.name}` : "no safety lead set"}
        </span>
        <span className="ml-auto text-slate-500">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>
      {open && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[2fr_1fr_1fr]">
          <div className="space-y-2">
            <Label className="text-xs text-slate-400">Default travel manager: takes every new trip, and the customer sees their name at once</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              <select aria-label="Default manager" className={select} value={mgr} onChange={(e) => { setMgr(e.target.value); const m = managers.find((x) => String(x.id) === e.target.value); if (m) setName(m.name); }}>
                <option value="">Someone outside the admin</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name} ({STAFF_ROLE(m.role)})</option>)}
              </select>
              <Input aria-label="Default manager name" className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name the customer sees (blank = none)" />
              <Input aria-label="Default manager phone" className={field} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" inputMode="tel" />
            </div>
          </div>
          <div className="space-y-2"><Label htmlFor="ts-pct" className="text-xs text-slate-400">Advance to book (%), not refundable</Label><Input id="ts-pct" className={field} value={pct} onChange={(e) => setPct(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></div>
          <div className="space-y-2"><Label htmlFor="ts-hrs" className="text-xs text-slate-400">Hold a price for (hours)</Label><Input id="ts-hrs" className={field} value={hrs} onChange={(e) => setHrs(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></div>
          <div className="space-y-2"><Label htmlFor="ts-cut" className="text-xs text-slate-400">Booked trips can be cancelled in the app until (days before)</Label><Input id="ts-cut" className={field} value={cut} onChange={(e) => setCut(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></div>
          <div className="space-y-2 lg:col-span-2">
            <Label className="text-xs text-slate-400">Safety lead: alerted when nobody picks up an SOS within 2 minutes (the owner)</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input aria-label="Safety lead name" className={field} value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} placeholder="Name" />
              <Input aria-label="Safety lead phone" className={field} value={lead.phone} onChange={(e) => setLead({ ...lead, phone: e.target.value })} placeholder="Phone" inputMode="tel" />
              <Input aria-label="Safety lead email" className={field} value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} placeholder="Email for alerts" />
            </div>
          </div>
          <div className="lg:col-span-3"><Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || (!!name.trim() && phone.replace(/\D/g, "").length < 10) || (!!lead.name.trim() && lead.phone.replace(/\D/g, "").length < 10)}>Save settings</Button></div>
        </div>
      )}
    </section>
  );
}

export default function TravelTripsPage() {
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(false);
  const qs = useMemo(() => new URLSearchParams({ ...(filter ? { status: filter } : {}), ...(search.trim() ? { search: search.trim() } : {}), ...(mine ? { mine: "1" } : {}) }).toString(), [filter, search, mine]);
  const { data, isLoading } = useQuery<{ counts: { new: number; open: number }; trips: Trip[] }>({
    queryKey: ["/api/admin/travel/trips", qs],
    queryFn: async () => (await apiRequest("GET", `/api/admin/travel/trips?${qs}`)).data,
  });
  const { data: managers = [] } = useQuery<Manager[]>({ queryKey: ["/api/admin/travel/managers"], queryFn: async () => (await apiRequest("GET", "/api/admin/travel/managers")).data });
  const { data: partners = [] } = useQuery<Partner[]>({ queryKey: ["/api/admin/travel/partners"], queryFn: async () => (await apiRequest("GET", "/api/admin/travel/partners")).data });
  const { data: experts = [] } = useQuery<Expert[]>({ queryKey: ["/api/admin/travel/experts"], queryFn: async () => (await apiRequest("GET", "/api/admin/travel/experts")).data });
  const { data: settings } = useQuery<TravelSettings>({ queryKey: ["/api/admin/travel/settings"], queryFn: async () => (await apiRequest("GET", "/api/admin/travel/settings")).data });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/travel/trips"] });

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-white">Trip requests</h1>
        <p className="max-w-3xl text-sm text-slate-400">Plans customers send from the app. The travel manager calls, checks our own team first, asks travel partners for prices, picks one and sends the customer a price. The customer books by paying the advance in the app.</p>
      </header>
      {settings && <SettingsPanel key={JSON.stringify(settings)} settings={settings} managers={managers} />}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.key || "all"} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
            className={`rounded-full border px-3 py-1.5 text-sm ${filter === f.key ? "border-sky-400/50 bg-sky-500/15 text-white" : "border-white/10 text-slate-300 hover:bg-white/5"}`}>
            {f.label}{f.key === "new" && data?.counts.new ? <Badge className="ml-1.5 bg-amber-500 text-black hover:bg-amber-500">{data.counts.new}</Badge> : null}
            {f.key === "open" && data?.counts.open ? <span className="ml-1.5 text-xs text-slate-400">{data.counts.open}</span> : null}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input aria-label="Search trips" className={`${field} pl-9`} placeholder="Code, name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {isLoading ? <p className="text-sm text-slate-400">Loading…</p> : !data?.trips.length ? (
        <div className={`${panel} p-8 text-center text-slate-400`}>No trips here yet. When customers send a plan from the app's Travel tab, it appears under Open.</div>
      ) : (
        <ul className="space-y-3">{data.trips.map((t) => <TripCard key={t.id} t={t} managers={managers} partners={partners} experts={experts} settings={settings} onDone={refresh} />)}</ul>
      )}
    </div>
  );
}
