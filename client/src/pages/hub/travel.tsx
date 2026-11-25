/**
 * Travel partners' Hub pages.
 *
 *   Trips            assignments from UniteFix (accept, put a driver and vehicle
 *                    on a cab, name the contact for a stay or guide, send the
 *                    driver the trip link) and prices UniteFix asked for.
 *   Fleet & services drivers and vehicles, checked by UniteFix before they can
 *                    take a trip, and what the partner provides and where.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { inr } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty, Stat, HubSelect } from "@/components/hub/ui";

type Brief = {
  code: string; status: string; startDate: string | null; endDate: string | null; days: number | null; people: number; adults: number; children: number;
  from: string | null; to: string | null; tripType: string; stay: string; needsCab: boolean; needsGuide: boolean;
  plan: Array<{ day: number; stayNear: string | null; km: number; stops: string[] }>; totalKm: number | null; manager: { name: string; phone: string | null } | null;
};
type Assignment = {
  id: number; role: "driver" | "stay" | "guide" | "activity"; day: number | null; time: string | null; place: string | null; status: "offered" | "accepted" | "declined";
  declineReason: string | null; pay: number | null; paidToStatement: boolean; driver: { name: string; phone: string | null } | null; vehicle: { model: string | null; plate: string | null } | null;
  contact: { name: string; phone: string | null } | null; driverLink: string | null; accepted: boolean; verified: boolean; trip: Brief;
};
type Request = { id: number; status: "asked" | "quoted" | "declined"; amount: number | null; covers: string | null; note: string | null; askedAt: string; respondedAt: string | null; chosen: boolean; open: boolean; canChange: boolean; trip: Brief };
type Driver = { id: number; name: string; phone: string; photoUrl: string | null; dlNumber: string; dlStatus: string; dlValidUntil: string | null; dlNameAtRto: string | null; dlCheckMethod: string | null; dlCheckNote: string | null; isActive: boolean; ready: boolean };
type Vehicle = { id: number; regNo: string; model: string; seats: number; rcStatus: string; rcValidUntil: string | null; insuranceUpto: string | null; permitUpto: string | null; rcOwner: string | null; rcCheckNote: string | null; isActive: boolean; ready: boolean };

const ROLE: Record<string, string> = { driver: "Cab", stay: "Stay", guide: "Guide", activity: "Activity" };
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "date to confirm");
const CHECK_TONE: Record<string, string> = { verified: "good", failed: "bad", needs_review: "warn", unverified: "muted" };
const CHECK_WORD: Record<string, string> = { verified: "Checked", failed: "Not accepted", needs_review: "UniteFix is reviewing", unverified: "Waiting for check" };
const field = "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white";
const useFail = () => { const { toast } = useToast(); return (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" }); };

function TripBrief({ t }: { t: Brief }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm text-[hsl(215,20%,75%)] space-y-1">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span className="font-mono text-white">{t.code}</span>
        <span>{day(t.startDate)}{t.days && t.days > 1 ? ` → ${day(t.endDate)} (${t.days} days)` : ""}</span>
        <span>{t.people} {t.people === 1 ? "person" : "people"}{t.children ? ` (${t.children} child${t.children > 1 ? "ren" : ""})` : ""}</span>
        <span>{t.from}{t.to && t.to !== t.from ? ` → ${t.to}` : t.tripType === "round_trip" ? " (round trip)" : ""}</span>
        {t.totalKm != null && <span>about {t.totalKm} km</span>}
      </div>
      {t.manager && <div className="text-xs">Travel manager: <span className="text-white">{t.manager.name}</span>{t.manager.phone ? ` · ${t.manager.phone}` : ""}</div>}
      {t.plan.length > 0 && (
        <button className="text-xs underline text-[hsl(217,91%,70%)]" onClick={() => setOpen(!open)}>{open ? "Hide the plan" : "See the day-by-day plan"}</button>
      )}
      {open && (
        <ol className="text-xs space-y-1 pl-4 list-decimal">
          {t.plan.map((d) => <li key={d.day}><span className="text-white">Day {d.day}</span>: {d.stops.join(" → ")} · {d.km} km{d.stayNear ? ` · night near ${d.stayNear}` : ""}</li>)}
        </ol>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Trips
// ═══════════════════════════════════════════════════════════

export function HubTravelTrips() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = useFail();
  const { data: jobs = [] } = useQuery<Assignment[]>({ queryKey: ["/api/hub/travel/assignments"], queryFn: async () => (await apiRequest("GET", "/api/hub/travel/assignments")).data });
  const { data: reqs = [] } = useQuery<Request[]>({ queryKey: ["/api/hub/travel/requests"], queryFn: async () => (await apiRequest("GET", "/api/hub/travel/requests")).data });
  const { data: fleet } = useQuery<{ drivers: Driver[]; vehicles: Vehicle[] }>({ queryKey: ["/api/hub/travel/fleet"], queryFn: async () => (await apiRequest("GET", "/api/hub/travel/fleet")).data });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/hub/travel/assignments"] }); qc.invalidateQueries({ queryKey: ["/api/hub/travel/requests"] }); };
  const act = useMutation({
    mutationFn: async (v: { path: string; body: unknown }) => apiRequest("POST", v.path, v.body),
    onSuccess: (r: any) => { toast({ title: r?.message ?? "Done" }); refresh(); },
    onError: fail("Not done"),
  });
  const [price, setPrice] = useState<Record<number, { amount: string; covers: string; note: string }>>({});
  const [pick, setPick] = useState<Record<number, { driverId: string; vehicleId: string; time: string }>>({});
  const [contact, setContact] = useState<Record<number, { name: string; phone: string; place: string; time: string }>>({});
  const [decline, setDecline] = useState<Record<number, string>>({});
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast({ title: "Driver link copied" }); } catch { window.prompt("Copy the driver link:", text); } };

  const active = jobs.filter((j) => !["completed", "cancelled"].includes(j.trip.status) && j.status !== "declined");
  const done = jobs.filter((j) => j.trip.status === "completed");
  const openReqs = reqs.filter((r) => r.open || r.canChange);
  const readyDrivers = fleet?.drivers.filter((d) => d.ready) ?? [];
  const readyVehicles = fleet?.vehicles.filter((v) => v.ready) ?? [];

  return (
    <HubPage title="Trips" subtitle="UniteFix sells the trip and assigns the work to you at the agreed price. Accept it, put a checked driver and vehicle on it, and send the driver the trip link. Your pay goes on your statement when the trip ends.">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="To accept" value={active.filter((j) => j.status === "offered").length} />
        <Stat label="Upcoming and on the road" value={active.length} />
        <Stat label="Prices asked" value={reqs.filter((r) => r.open).length} />
        <Stat label="Earned (finished trips)" value={inr(done.reduce((a, j) => a + (j.pay ?? 0), 0))} />
      </div>

      <Panel title="Assigned to you">
        {active.length === 0 ? <Empty icon="directions_car" title="No trips assigned right now">When UniteFix assigns you a cab, stay or guide, it appears here and you are alerted.</Empty> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)]">
            {active.map((j) => {
              const p = pick[j.id] ?? { driverId: "", vehicleId: "", time: j.time ?? "" };
              const c = contact[j.id] ?? { name: j.contact?.name ?? "", phone: j.contact?.phone ?? "", place: j.place ?? "", time: j.time ?? "" };
              return (
                <li key={j.id} className="py-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone="info">{ROLE[j.role]}{j.day ? ` · day ${j.day}` : " · all days"}</Chip>
                    <Chip tone={j.status === "offered" ? "warn" : "good"}>{j.status === "offered" ? "Waiting for you" : "Accepted"}</Chip>
                    {j.trip.status === "started" && <Chip tone="good">On the road</Chip>}
                    {j.pay != null && <span className="ml-auto text-white font-semibold">{inr(j.pay)}</span>}
                  </div>
                  <TripBrief t={j.trip} />
                  {j.status === "offered" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={() => act.mutate({ path: `/api/hub/travel/assignments/${j.id}/respond`, body: { accept: true } })}>Accept</Button>
                      <Input className={`${field} h-9 max-w-xs`} placeholder="Why you cannot (to decline)" value={decline[j.id] ?? ""} onChange={(e) => setDecline({ ...decline, [j.id]: e.target.value })} />
                      <Button size="sm" variant="ghost" disabled={!(decline[j.id] ?? "").trim()} onClick={() => act.mutate({ path: `/api/hub/travel/assignments/${j.id}/respond`, body: { accept: false, reason: decline[j.id] } })}>Decline</Button>
                    </div>
                  )}
                  {j.role === "driver" && j.status !== "declined" && (
                    j.driver ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-white">{j.driver.name}</span><span className="text-[hsl(215,20%,65%)]">{j.driver.phone} · {j.vehicle?.model} · {j.vehicle?.plate}{j.time ? ` · pickup ${j.time}` : ""}</span>
                        {j.accepted ? <Chip tone="good">Driver accepted on the link</Chip> : <Chip tone="muted">Driver has not opened the link yet</Chip>}
                        {j.driverLink && <Button size="sm" variant="outline" onClick={() => copy(j.driverLink!)}>Copy driver link</Button>}
                        {j.driverLink && j.driver.phone && <a className="text-xs underline text-emerald-300" target="_blank" rel="noreferrer" href={`https://wa.me/91${j.driver.phone}?text=${encodeURIComponent(`UniteFix trip ${j.trip.code} on ${j.trip.startDate ?? ""}${j.time ? ` at ${j.time}` : ""}, pickup ${j.trip.from ?? ""}. Open this link, accept the trip, and at pickup ask the traveller for the 4-digit code: ${j.driverLink}`)}`}>Send on WhatsApp</a>}
                      </div>
                    ) : null
                  )}
                  {j.role === "driver" && j.status !== "declined" && j.trip.status !== "started" && (
                    <div className="grid gap-2 sm:grid-cols-4 items-end">
                      <div><Label className="text-xs">Driver</Label><HubSelect value={p.driverId} onChange={(v) => setPick({ ...pick, [j.id]: { ...p, driverId: v } })}><option value="">Choose a checked driver</option>{readyDrivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</HubSelect></div>
                      <div><Label className="text-xs">Vehicle</Label><HubSelect value={p.vehicleId} onChange={(v) => setPick({ ...pick, [j.id]: { ...p, vehicleId: v } })}><option value="">Choose a checked vehicle</option>{readyVehicles.map((v) => <option key={v.id} value={v.id} disabled={v.seats < j.trip.people}>{v.model} · {v.regNo} · {v.seats} seats</option>)}</HubSelect></div>
                      <div><Label className="text-xs">Pickup time</Label><Input className={field} type="time" value={p.time} onChange={(e) => setPick({ ...pick, [j.id]: { ...p, time: e.target.value } })} /></div>
                      <Button size="sm" disabled={!p.driverId || !p.vehicleId} onClick={() => act.mutate({ path: `/api/hub/travel/assignments/${j.id}/fleet`, body: { driverId: Number(p.driverId), vehicleId: Number(p.vehicleId), time: p.time || null } })}>{j.driver ? "Change driver" : "Put on the trip"}</Button>
                      {(readyDrivers.length === 0 || readyVehicles.length === 0) && <p className="sm:col-span-4 text-xs text-amber-300">Add drivers and vehicles under Fleet. UniteFix checks the licence and papers before they can take a trip.</p>}
                    </div>
                  )}
                  {j.role !== "driver" && j.status !== "declined" && j.trip.status !== "started" && (
                    <div className="grid gap-2 sm:grid-cols-5 items-end">
                      <Input className={field} placeholder={j.role === "stay" ? "Property name" : "Guide or person to meet"} value={c.name} onChange={(e) => setContact({ ...contact, [j.id]: { ...c, name: e.target.value } })} />
                      <Input className={field} placeholder="Mobile" inputMode="tel" value={c.phone} onChange={(e) => setContact({ ...contact, [j.id]: { ...c, phone: e.target.value } })} />
                      <Input className={field} placeholder="Address or meeting point" value={c.place} onChange={(e) => setContact({ ...contact, [j.id]: { ...c, place: e.target.value } })} />
                      <Input className={field} type="time" value={c.time} onChange={(e) => setContact({ ...contact, [j.id]: { ...c, time: e.target.value } })} />
                      <Button size="sm" disabled={c.name.trim().length < 2} onClick={() => act.mutate({ path: `/api/hub/travel/assignments/${j.id}/details`, body: { name: c.name, phone: c.phone || null, place: c.place || null, time: c.time || null } })}>Save</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Prices asked">
        {openReqs.length === 0 ? <Empty icon="request_quote" title="No price requests">When a travel manager wants your price for a trip, it appears here.</Empty> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)]">
            {openReqs.map((r) => {
              const f = price[r.id] ?? { amount: r.amount ? String(r.amount) : "", covers: r.covers ?? "", note: r.note ?? "" };
              return (
                <li key={r.id} className="py-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={r.status === "asked" ? "warn" : r.status === "quoted" ? "info" : "muted"}>{r.status === "asked" ? "Price wanted" : r.status === "quoted" ? `You quoted ${inr(r.amount)}` : "You declined"}</Chip>
                    {r.covers && <span className="text-sm text-[hsl(215,20%,75%)]">For: {r.covers}</span>}
                  </div>
                  <TripBrief t={r.trip} />
                  <div className="grid gap-2 sm:grid-cols-4 items-end">
                    <div><Label className="text-xs">Your price (₹)</Label><Input className={field} type="number" value={f.amount} onChange={(e) => setPrice({ ...price, [r.id]: { ...f, amount: e.target.value } })} /></div>
                    <div className="sm:col-span-2"><Label className="text-xs">What it covers, or a note</Label><Input className={field} value={f.note} onChange={(e) => setPrice({ ...price, [r.id]: { ...f, note: e.target.value } })} placeholder="Innova, driver bata and tolls included" /></div>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={!(Number(f.amount) > 0)} onClick={() => act.mutate({ path: `/api/hub/travel/requests/${r.id}`, body: { amount: Number(f.amount), note: f.note || null } })}>{r.status === "quoted" ? "Update" : "Send price"}</Button>
                      {r.status === "asked" && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/api/hub/travel/requests/${r.id}`, body: { decline: true, note: f.note || null } })}>Can't do it</Button>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {done.length > 0 && (
        <Panel title="Finished trips">
          <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">
            {done.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-mono text-white">{j.trip.code}</span><span className="text-[hsl(215,20%,70%)]">{ROLE[j.role]} · {day(j.trip.startDate)}</span>
                <span className="ml-auto text-white">{inr(j.pay)}</span>{j.paidToStatement ? <Chip tone="good">On your statement</Chip> : <Chip tone="muted">No agreed pay recorded</Chip>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════
// Fleet & services
// ═══════════════════════════════════════════════════════════

export function HubTravelFleet() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = useFail();
  const { data: fleet } = useQuery<{ drivers: Driver[]; vehicles: Vehicle[] }>({ queryKey: ["/api/hub/travel/fleet"], queryFn: async () => (await apiRequest("GET", "/api/hub/travel/fleet")).data });
  const { data: profile } = useQuery<{ kinds: string[]; baseTown: string | null; regionIds: number[]; contactName: string | null; phone: string | null; regions: Array<{ id: number; name: string }>; allKinds: string[] }>({ queryKey: ["/api/hub/travel/profile"], queryFn: async () => (await apiRequest("GET", "/api/hub/travel/profile")).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/hub/travel/fleet"] });
  const [d, setD] = useState({ name: "", phone: "", dlNumber: "", dob: "", photoUrl: "" });
  const [v, setV] = useState({ regNo: "", model: "", seats: "" });
  const [p, setP] = useState<{ kinds: string[]; baseTown: string; regionIds: number[] } | null>(null);
  const prof = p ?? (profile ? { kinds: profile.kinds, baseTown: profile.baseTown ?? "", regionIds: profile.regionIds } : null);
  const call = useMutation({
    mutationFn: async (x: { method: string; path: string; body?: unknown }) => apiRequest(x.method, x.path, x.body),
    onSuccess: (r: any, x) => { toast({ title: r?.message ?? (x.method === "POST" && x.path.endsWith("/check") ? "Checked" : "Saved") }); refresh(); qc.invalidateQueries({ queryKey: ["/api/hub/travel/profile"] }); },
    onError: fail("Not saved"),
  });
  const KIND: Record<string, string> = { cab: "Cabs", stay: "Hotels", homestay: "Homestays", guide: "Guides", boating: "Boating", activity: "Rafting & activities", bus: "Tempo / bus" };

  return (
    <HubPage title="Fleet & services" subtitle="Only drivers and vehicles UniteFix has checked can be put on a trip: a valid licence, and a vehicle with valid registration, insurance and permit. Checks run as you add them.">
      <Panel title="Drivers">
        {(fleet?.drivers ?? []).length === 0 ? <Empty icon="badge" title="No drivers yet" /> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">
            {fleet!.drivers.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-white">{x.name}</span><span className="text-[hsl(215,20%,65%)]">{x.phone} · licence {x.dlNumber}{x.dlValidUntil ? ` · valid to ${x.dlValidUntil}` : ""}</span>
                <Chip tone={CHECK_TONE[x.dlStatus] ?? "muted"}>{CHECK_WORD[x.dlStatus] ?? x.dlStatus}</Chip>
                {!x.isActive && <Chip tone="muted">Inactive</Chip>}
                {x.dlCheckNote && <span className="w-full text-xs text-[hsl(215,20%,60%)]">{x.dlCheckNote}</span>}
                <div className="ml-auto flex gap-2">
                  {x.dlStatus !== "verified" && <Button size="sm" variant="outline" onClick={() => call.mutate({ method: "POST", path: `/api/hub/travel/fleet/drivers/${x.id}/check` })}>Check again</Button>}
                  <Button size="sm" variant="ghost" onClick={() => call.mutate({ method: "PATCH", path: `/api/hub/travel/fleet/drivers/${x.id}`, body: { isActive: !x.isActive } })}>{x.isActive ? "Remove" : "Bring back"}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-5 items-end">
          <Input className={field} placeholder="Driver's name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          <Input className={field} placeholder="Mobile" inputMode="tel" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} />
          <Input className={field} placeholder="Licence number" value={d.dlNumber} onChange={(e) => setD({ ...d, dlNumber: e.target.value.toUpperCase() })} />
          <div><Label className="text-xs">Date of birth</Label><Input className={field} type="date" value={d.dob} onChange={(e) => setD({ ...d, dob: e.target.value })} /></div>
          <Button size="sm" disabled={!d.name || !d.phone || !d.dlNumber || !d.dob || call.isPending} onClick={() => { call.mutate({ method: "POST", path: "/api/hub/travel/fleet/drivers", body: { name: d.name, phone: d.phone, dlNumber: d.dlNumber, dob: d.dob } }); setD({ name: "", phone: "", dlNumber: "", dob: "", photoUrl: "" }); }}>Add driver</Button>
        </div>
      </Panel>

      <Panel title="Vehicles">
        {(fleet?.vehicles ?? []).length === 0 ? <Empty icon="directions_car" title="No vehicles yet" /> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">
            {fleet!.vehicles.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-mono text-white">{x.regNo}</span><span className="text-[hsl(215,20%,65%)]">{x.model} · {x.seats} seats{x.insuranceUpto ? ` · insured to ${x.insuranceUpto}` : ""}{x.permitUpto ? ` · permit to ${x.permitUpto}` : ""}</span>
                <Chip tone={CHECK_TONE[x.rcStatus] ?? "muted"}>{CHECK_WORD[x.rcStatus] ?? x.rcStatus}</Chip>
                {!x.isActive && <Chip tone="muted">Inactive</Chip>}
                {x.rcCheckNote && <span className="w-full text-xs text-[hsl(215,20%,60%)]">{x.rcCheckNote}</span>}
                <div className="ml-auto flex gap-2">
                  {x.rcStatus !== "verified" && <Button size="sm" variant="outline" onClick={() => call.mutate({ method: "POST", path: `/api/hub/travel/fleet/vehicles/${x.id}/check` })}>Check again</Button>}
                  <Button size="sm" variant="ghost" onClick={() => call.mutate({ method: "PATCH", path: `/api/hub/travel/fleet/vehicles/${x.id}`, body: { isActive: !x.isActive } })}>{x.isActive ? "Remove" : "Bring back"}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-4 items-end">
          <Input className={field} placeholder="Registration, e.g. KA31AB1234" value={v.regNo} onChange={(e) => setV({ ...v, regNo: e.target.value.toUpperCase() })} />
          <Input className={field} placeholder="Model and colour" value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} />
          <Input className={field} type="number" placeholder="Passenger seats" value={v.seats} onChange={(e) => setV({ ...v, seats: e.target.value })} />
          <Button size="sm" disabled={!v.regNo || !v.model || !(Number(v.seats) > 0) || call.isPending} onClick={() => { call.mutate({ method: "POST", path: "/api/hub/travel/fleet/vehicles", body: { regNo: v.regNo, model: v.model, seats: Number(v.seats) } }); setV({ regNo: "", model: "", seats: "" }); }}>Add vehicle</Button>
        </div>
      </Panel>

      {prof && profile && (
        <Panel title="What you provide and where">
          <div className="flex flex-wrap gap-2">
            {profile.allKinds.map((k) => {
              const on = prof.kinds.includes(k);
              return <button key={k} className={`rounded-full border px-3 py-1 text-xs ${on ? "border-sky-400/50 bg-sky-500/20 text-white" : "border-white/10 text-slate-400"}`} onClick={() => setP({ ...prof, kinds: on ? prof.kinds.filter((x) => x !== k) : [...prof.kinds, k] })}>{KIND[k] ?? k}</button>;
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {profile.regions.map((r) => {
              const on = prof.regionIds.includes(r.id);
              return <button key={r.id} className={`rounded-full border px-3 py-1 text-xs ${on ? "border-emerald-400/50 bg-emerald-500/20 text-white" : "border-white/10 text-slate-400"}`} onClick={() => setP({ ...prof, regionIds: on ? prof.regionIds.filter((x) => x !== r.id) : [...prof.regionIds, r.id] })}>{r.name}</button>;
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div><Label className="text-xs">Based in</Label><Input className={field} value={prof.baseTown} onChange={(e) => setP({ ...prof, baseTown: e.target.value })} placeholder="Sirsi" /></div>
            <Button size="sm" disabled={!prof.kinds.length} onClick={() => call.mutate({ method: "PUT", path: "/api/hub/travel/profile", body: { kinds: prof.kinds, baseTown: prof.baseTown || null, regionIds: prof.regionIds } })}>Save</Button>
          </div>
        </Panel>
      )}
    </HubPage>
  );
}
