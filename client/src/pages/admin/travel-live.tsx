/**
 * Live trips (server/services/trip-live.service.ts): trips on the road today
 * and those starting today. Where each one is, how far along, the driver,
 * and any open safety cases. Refreshes every 30 seconds.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Phone, MapPin, Radio, ExternalLink, Car, AlertTriangle, CheckCircle2 } from "lucide-react";

type Row = {
  id: number; code: string; status: "started" | "confirmed"; startDate: string | null; days: number | null; contactName: string; contactPhone: string;
  managerName: string | null; from: string | null; people: number;
  last: { lat: number; lng: number; at: string; source: string; minutes: number | null } | null;
  progress: { done: number; total: number; next: string | null; nextDay: number | null };
  drivers: Array<{ name: string; phone: string | null; plate: string | null; time: string | null; day: number | null; accepted: boolean }>;
  cases: Array<{ code: string; category: string | null; severity: string; kind: string }>; familyUrl: string | null;
};

const CASE: Record<string, string> = {
  sos: "SOS", no_signal: "No signal", off_route: "Off route", long_stop: "Long stop", night_driving: "Night driving", driver_late: "Driver late",
  breakdown: "Breakdown", medical: "Medical", stay: "Stay problem", low_rating: "Low rating",
};

export default function TravelLivePage() {
  const { data = [], isLoading, dataUpdatedAt } = useQuery<Row[]>({
    queryKey: ["/api/admin/travel/live"], queryFn: async () => (await apiRequest("GET", "/api/admin/travel/live")).data, refetchInterval: 30_000,
  });
  const onRoad = data.filter((r) => r.status === "started");
  const starting = data.filter((r) => r.status === "confirmed");
  const card = (r: Row) => {
    const stale = !r.last || (r.last.minutes ?? 999) > 20;
    const pct = r.progress.total ? Math.round((r.progress.done / r.progress.total) * 100) : 0;
    return (
      <li key={r.id} className={`rounded-2xl border p-4 ${r.cases.length ? "border-red-500/50 bg-red-500/[0.05]" : "border-white/10 bg-white/[0.03]"}`} data-testid={`live-${r.code}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-sky-300">{r.code}</span>
          {r.status === "started" ? <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/20 px-2.5 py-0.5 text-xs font-semibold text-orange-200"><Radio className="h-3 w-3" />On trip</span>
            : <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-200">Starts today</span>}
          <b className="text-white">{r.contactName}</b>
          <span className="text-sm text-slate-400">{r.people} people · from {r.from ?? "?"} · {r.days ?? "?"} day{r.days === 1 ? "" : "s"}{r.managerName ? ` · ${r.managerName}` : ""}</span>
          <a href={`tel:+91${r.contactPhone}`} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-sm text-white hover:bg-white/5"><Phone className="h-3.5 w-3.5" />{r.contactPhone}</a>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="space-y-1 text-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500">Last location</p>
            {r.last ? (
              <>
                <a className="inline-flex items-center gap-1 text-sky-300 underline" href={`https://maps.google.com/?q=${r.last.lat},${r.last.lng}`} target="_blank" rel="noreferrer"><MapPin className="h-3.5 w-3.5" />Open on the map</a>
                <p className={stale ? "text-amber-300" : "text-slate-300"}>{r.last.minutes === 0 ? "just now" : `${r.last.minutes} min ago`} · {r.last.source === "driver" ? "driver's phone" : "traveller's app"}</p>
              </>
            ) : <p className="text-slate-500">{r.status === "started" ? "Nothing shared yet: the traveller's app or the driver's link shares it." : "Shares once the trip starts."}</p>}
            {r.familyUrl && <a className="inline-flex items-center gap-1 text-xs text-slate-400 underline" href={r.familyUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" />Family view</a>}
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500">Progress</p>
            <p className="text-slate-200">{r.progress.done} of {r.progress.total} places{r.progress.next ? ` · next ${r.progress.next}` : r.progress.total ? " · all visited" : ""}</p>
            <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-orange-400" style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500">Driver</p>
            {r.drivers.length ? r.drivers.map((d, i) => (
              <p key={i} className="flex flex-wrap items-center gap-1.5 text-slate-200"><Car className="h-3.5 w-3.5 text-slate-400" />{d.name}{d.plate ? ` · ${d.plate}` : ""}{d.time ? ` · ${d.time}` : ""}
                {d.accepted ? <span className="inline-flex items-center gap-0.5 text-xs text-emerald-300"><CheckCircle2 className="h-3 w-3" />accepted</span> : <span className="text-xs text-amber-300">not accepted</span>}
                {d.phone && <a href={`tel:+91${d.phone}`} className="text-xs text-sky-300 underline">{d.phone}</a>}
              </p>
            )) : <p className="text-amber-300">No driver on the team yet.</p>}
          </div>
        </div>
        {r.cases.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-300" />
            {r.cases.map((c) => <Link key={c.code} href="/admin/safety" className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.severity === "critical" ? "bg-red-600 text-white" : "bg-amber-500/20 text-amber-200"}`}>{c.kind === "sos" ? "SOS" : CASE[c.category ?? ""] ?? c.category} · {c.code}</Link>)}
          </div>
        )}
      </li>
    );
  };
  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-white">Live trips</h1>
        <p className="max-w-3xl text-sm text-slate-400">Trips on the road and those starting today. Locations come from the traveller's app in Trip mode and the driver's link. The system opens a Safety desk case for no signal for 20 minutes, 15 km off the route, a 45-minute unplanned stop, and driving after 10 pm. Updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN") : "—"}.</p>
      </header>
      {isLoading ? <p className="text-sm text-slate-400">Loading…</p> : !data.length ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-slate-400">No trips on the road or starting today.</div>
      ) : (
        <>
          {onRoad.length > 0 && <section className="space-y-3"><h2 className="font-semibold text-white">On the road · {onRoad.length}</h2><ul className="space-y-3">{onRoad.map(card)}</ul></section>}
          {starting.length > 0 && <section className="space-y-3"><h2 className="font-semibold text-white">Starting today · {starting.length}</h2><ul className="space-y-3">{starting.map(card)}</ul></section>}
        </>
      )}
    </div>
  );
}
