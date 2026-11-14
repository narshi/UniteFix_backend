/**
 * Trip requests from the app's travel planner (server/services/travel.service.ts).
 * Staff assign a travel manager, who calls the customer and sends the
 * quotation by hand; the amount entered here shows in the customer's app.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Search, Phone, MessageCircle, Users, MapPin, CalendarDays, BedDouble, Car, Compass, ChevronDown, ChevronUp, Route } from "lucide-react";
import { TRIP_STATUS_LABEL, type TripPlan, type TripStatus } from "@shared/travel";

type Trip = {
  id: number; code: string; contactName: string; contactPhone: string; adults: number; children: number; people: number; vehicle: string;
  tripType: "round_trip" | "one_way"; pickupText: string | null; dropText: string | null; startDate: string | null; days: number | null; pace: string;
  stay: string; rooms: number | null; needsCab: boolean; needsGuide: boolean; budgetPerPerson: number | null; notes: string | null;
  status: TripStatus; managerAdminId: number | null; managerName: string | null; managerPhone: string | null; assignedAt: string | null;
  quoteAmount: number | null; quoteNote: string | null; quotedAt: string | null; staffNote: string | null; createdAt: string;
  plan: TripPlan | null; members: Array<{ id: number; name: string; phone: string | null; status: string }>;
};
type Manager = { id: number; name: string; email: string; role: string };

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "open", label: "Open" }, { key: "new", label: "New" }, { key: "assigned", label: "Assigned" }, { key: "contacted", label: "In discussion" },
  { key: "quoted", label: "Quoted" }, { key: "confirmed", label: "Confirmed" }, { key: "cancelled", label: "Cancelled" }, { key: "", label: "All" },
];
const STAY: Record<string, string> = { none: "No stay", budget: "Budget stay", standard: "Standard hotel", premium: "Premium hotel", homestay: "Homestay" };
const TONE: Record<TripStatus, string> = {
  new: "bg-amber-500/15 text-amber-300 border-amber-500/30", assigned: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  contacted: "bg-violet-500/15 text-violet-300 border-violet-500/30", quoted: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  confirmed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", cancelled: "bg-white/5 text-slate-400 border-white/10",
};
const field = "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white";
const select = "h-10 w-full rounded-md border border-[rgba(255,255,255,0.08)] bg-[hsl(222,47%,11%)] px-3 text-sm text-white";
const panel = "rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]";
const rupees = (n: number | null | undefined) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN")}`);
const hours = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);
const dateText = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—");

function Itinerary({ plan }: { plan: TripPlan }) {
  return (
    <ol className="space-y-3">
      {plan.days.map((d) => (
        <li key={d.day} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-200">Day {d.day}</span>
            <span>{d.km} km · {hours(d.minutes)}{d.stayNear ? ` · stay near ${d.stayNear}` : ""}</span>
          </div>
          <ul className="space-y-1 text-sm">
            {d.stops.map((s, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${s.type === "place" ? "bg-sky-400" : "bg-slate-500"}`} />
                <span className="text-slate-200">{s.name}</span>
                <span className="text-xs text-slate-500">
                  {s.driveKm ? `${s.driveKm} km drive` : ""}{s.visitMinutes ? `${s.driveKm ? " · " : ""}${hours(s.visitMinutes)} there` : ""}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function TripCard({ t, managers, onDone }: { t: Trip; managers: Manager[]; onDone: () => void }) {
  const { toast } = useToast();
  // Open trips start unfolded; the card keeps its state while staff work on it.
  const [open, setOpen] = useState(["new", "assigned", "contacted"].includes(t.status));
  const [mgr, setMgr] = useState<string>(t.managerAdminId ? String(t.managerAdminId) : "");
  const [mgrName, setMgrName] = useState(t.managerName ?? "");
  const [mgrPhone, setMgrPhone] = useState(t.managerPhone ?? "");
  const [status, setStatus] = useState<TripStatus>(t.status);
  const [quote, setQuote] = useState(t.quoteAmount != null ? String(t.quoteAmount) : "");
  const [quoteNote, setQuoteNote] = useState(t.quoteNote ?? "");
  const [staffNote, setStaffNote] = useState(t.staffNote ?? "");
  // The server moves the status on (assigned, quoted); follow it unless staff pick one.
  useEffect(() => { setStatus(t.status); }, [t.status]);

  const assign = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/travel/trips/${t.id}/assign`, { managerAdminId: mgr ? Number(mgr) : null, managerName: mgrName, managerPhone: mgrPhone }),
    onSuccess: (r: any) => { toast({ title: "Assigned", description: r?.message }); onDone(); },
    onError: (e) => toast({ title: "Not assigned", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const save = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/admin/travel/trips/${t.id}`, {
      status: status !== t.status ? status : undefined, quoteAmount: quote.trim() === "" ? null : Number(quote), quoteNote: quoteNote.trim() || null, staffNote: staffNote.trim() || null,
    }),
    onSuccess: () => { toast({ title: "Saved" }); onDone(); },
    onError: (e) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const people = `${t.adults} adult${t.adults === 1 ? "" : "s"}${t.children ? `, ${t.children} child${t.children === 1 ? "" : "ren"}` : ""}`;
  const route = t.tripType === "round_trip" ? `${t.pickupText ?? "?"} ⇄ round trip` : `${t.pickupText ?? "?"} → ${t.dropText ?? "?"}`;
  const wa = `https://wa.me/91${t.contactPhone.slice(-10)}?text=${encodeURIComponent(`Hello ${t.contactName}, this is your UniteFix travel manager about trip ${t.code}.`)}`;

  return (
    <li className={panel} data-testid={`trip-${t.code}`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left">
        <span className="font-mono text-sm text-sky-300">{t.code}</span>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE[t.status]}`}>{TRIP_STATUS_LABEL[t.status]}</span>
        <span className="font-semibold text-white">{t.contactName}</span>
        <span className="text-sm text-slate-400">{people} · {route}</span>
        <span className="text-sm text-slate-400">{dateText(t.startDate)} · {t.days ?? "?"} day{t.days === 1 ? "" : "s"}</span>
        {t.managerName && <span className="text-xs text-slate-400">Manager: {t.managerName}</span>}
        {t.quoteAmount != null && <span className="text-sm font-semibold text-emerald-300">{rupees(t.quoteAmount)}</span>}
        <span className="ml-auto text-slate-500">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>
      {open && (
        <div className="grid gap-5 border-t border-white/5 p-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4 min-w-0">
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

          <div className="space-y-5 min-w-0">
            <section className="space-y-2 rounded-xl border border-white/5 p-3">
              <p className="text-sm font-semibold text-white">1. Travel manager</p>
              <Label htmlFor={`mgr-${t.id}`} className="text-xs text-slate-400">Staff member</Label>
              <select id={`mgr-${t.id}`} className={select} value={mgr} onChange={(e) => { setMgr(e.target.value); const m = managers.find((x) => String(x.id) === e.target.value); if (m && !mgrName) setMgrName(m.name); }}>
                <option value="">Someone outside the admin</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.role.replace(/_/g, " ")})</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor={`mgrn-${t.id}`} className="text-xs text-slate-400">Name the customer sees</Label><Input id={`mgrn-${t.id}`} className={field} value={mgrName} onChange={(e) => setMgrName(e.target.value)} placeholder="Kiran" /></div>
                <div><Label htmlFor={`mgrp-${t.id}`} className="text-xs text-slate-400">Their phone</Label><Input id={`mgrp-${t.id}`} className={field} value={mgrPhone} onChange={(e) => setMgrPhone(e.target.value)} placeholder="98450 12345" inputMode="tel" /></div>
              </div>
              <Button size="sm" onClick={() => assign.mutate()} disabled={assign.isPending || mgrName.trim().length < 2 || mgrPhone.replace(/\D/g, "").length < 10 || t.status === "cancelled" || t.status === "confirmed"}>
                {t.managerName ? "Change manager" : "Assign and tell the customer"}
              </Button>
            </section>

            <section className="space-y-2 rounded-xl border border-white/5 p-3">
              <p className="text-sm font-semibold text-white">2. Quotation and status</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor={`st-${t.id}`} className="text-xs text-slate-400">Status</Label>
                  <select id={`st-${t.id}`} className={select} value={status} onChange={(e) => setStatus(e.target.value as TripStatus)}>
                    {(Object.keys(TRIP_STATUS_LABEL) as TripStatus[]).map((s) => <option key={s} value={s}>{TRIP_STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div><Label htmlFor={`q-${t.id}`} className="text-xs text-slate-400">Quotation, whole group (₹)</Label><Input id={`q-${t.id}`} className={field} value={quote} onChange={(e) => setQuote(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="42000" /></div>
              </div>
              <div><Label htmlFor={`qn-${t.id}`} className="text-xs text-slate-400">What the quotation covers (the customer sees this)</Label><Input id={`qn-${t.id}`} className={field} value={quoteNote} onChange={(e) => setQuoteNote(e.target.value)} placeholder="Innova for 3 days, 2 rooms × 2 nights, guide at Gokarna" /></div>
              <div><Label htmlFor={`sn-${t.id}`} className="text-xs text-slate-400">Staff note (not shown to the customer)</Label><Input id={`sn-${t.id}`} className={field} value={staffNote} onChange={(e) => setStaffNote(e.target.value)} placeholder="Called at 4 pm; wants a sea-view room" /></div>
              <p className="text-xs text-slate-500">Entering an amount sends the customer a notification and shows it in their app.</p>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
            </section>
            <p className="text-xs text-slate-500">Sent {new Date(t.createdAt).toLocaleString("en-IN")}{t.assignedAt ? ` · assigned ${new Date(t.assignedAt).toLocaleString("en-IN")}` : ""}{t.quotedAt ? ` · quoted ${new Date(t.quotedAt).toLocaleString("en-IN")}` : ""}</p>
          </div>
        </div>
      )}
    </li>
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
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/travel/trips"] });

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-white">Trip requests</h1>
        <p className="max-w-3xl text-sm text-slate-400">Plans customers send from the app's travel planner. Assign a travel manager: the customer is told who will call. The manager calls, agrees the details and sends the quotation; enter the amount here so it shows in the customer's app.</p>
      </header>
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
        <div className={`${panel} p-8 text-center text-slate-400`}>No trips here yet. When customers send a plan from the app's Travel tab, it appears under New.</div>
      ) : (
        <ul className="space-y-3">{data.trips.map((t) => <TripCard key={t.id} t={t} managers={managers} onDone={refresh} />)}</ul>
      )}
    </div>
  );
}
