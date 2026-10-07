/**
 * Consulting — services, working hours, appointments and retainers.
 * Bills go out as ordinary invoices from Sales; retainers bill themselves.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useHubMe, hubCan, inr } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty, Stat, HubSelect, Thead } from "@/components/hub/ui";
import { useCustomers } from "@/pages/hub/customers";
import { PayLinkButton } from "@/components/hub/PayLink";

type Svc = { id: number; name: string; description: string | null; kind: "fixed" | "hourly" | "retainer"; price: number; durationMinutes: number; mode: string; sac: string; gstRate: number; sessionsIncluded: number | null; hoursIncluded: number | null; isPublic: boolean; isActive: boolean };
type Appt = {
  id: number; status: string; source: string; startsAt: string; endsAt: string; mode: string; location: string | null; meetingLink: string | null; customerId: number; customerName: string;
  customerPhone: string | null; serviceId: number; serviceName: string; serviceKind: string; retainerId: number | null; price: number; invoiceDocumentId: number | null; clientMessage: string | null;
  privateNotes: string | null; clientNotes: string | null; cancelledReason: string | null; clientLink: string;
};
type Retainer = { id: number; title: string; customerId: number; customerName: string; monthlyFee: number; sac: string; gstRate: number; hoursIncluded: number | null; hoursUsedThisMonth: number; billingDay: number; startDate: string; endDate: string | null; status: string; lastBilledPeriod: string | null; lastBillError: string | null; notes: string | null };

const KIND: Record<string, string> = { fixed: "Fixed session / package", hourly: "Hourly", retainer: "Monthly retainer" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const A_TONE: Record<string, string> = { requested: "warn", confirmed: "info", completed: "good", cancelled: "muted", no_show: "bad" };
const fmt = (s: string) => new Date(s).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const useFail = () => { const { toast } = useToast(); return (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" }); };

export function useConsultServices() {
  return useQuery<Svc[]>({ queryKey: ["/api/hub/consulting/services"], queryFn: async () => (await apiRequest("GET", "/api/hub/consulting/services")).data });
}

// ═══════════════════════════════════════════════════════════════════════════
// Services
// ═══════════════════════════════════════════════════════════════════════════

const blankSvc = { name: "", description: "", kind: "fixed", priceRupees: "", durationMinutes: "60", mode: "online", sac: "998311", gstRate: "18", hoursIncluded: "", isPublic: true };

export function HubConsultServices() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = useFail();
  const { data, isLoading } = useConsultServices();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Svc | null>(null);
  const [f, setF] = useState(blankSvc);
  const manage = hubCan(me, "settings:manage");
  const registered = !!me?.business?.gstin;
  const edit = (s: Svc | null) => {
    setEditing(s);
    setF(s ? { name: s.name, description: s.description ?? "", kind: s.kind, priceRupees: String(s.price), durationMinutes: String(s.durationMinutes), mode: s.mode, sac: s.sac, gstRate: String(s.gstRate), hoursIncluded: s.hoursIncluded == null ? "" : String(s.hoursIncluded), isPublic: s.isPublic } : blankSvc);
    setOpen(true);
  };
  const save = async () => {
    const body = { name: f.name, description: f.description || null, kind: f.kind, priceRupees: Number(f.priceRupees), durationMinutes: Number(f.durationMinutes), mode: f.mode, sac: f.sac, gstRate: Number(f.gstRate), hoursIncluded: f.hoursIncluded ? Number(f.hoursIncluded) : null, isPublic: f.isPublic };
    try { await apiRequest(editing ? "PATCH" : "POST", editing ? `/api/hub/consulting/services/${editing.id}` : "/api/hub/consulting/services", body); qc.invalidateQueries({ queryKey: ["/api/hub/consulting/services"] }); setOpen(false); toast({ title: "Saved" }); }
    catch (e) { fail("Not saved")(e); }
  };
  const toggle = async (s: Svc) => { try { await apiRequest("PATCH", `/api/hub/consulting/services/${s.id}`, { isActive: !s.isActive }); qc.invalidateQueries({ queryKey: ["/api/hub/consulting/services"] }); } catch (e) { fail("Not changed")(e); } };
  const link = me ? `${window.location.origin}/book/${me.partnerCode}` : "";

  return (
    <HubPage title="Services" subtitle="What you sell: fixed sessions or packages, hourly advice, or monthly retainers. Each carries its SAC and GST rate, so every bill is a proper invoice."
      actions={manage ? <Button onClick={() => edit(null)}>Add service</Button> : undefined}>
      <Panel title="Your public booking page">
        <p className="text-sm text-[hsl(215,20%,65%)]">Share this link: clients pick a service and a free time from your hours, and you confirm. Retainers are not bookable online.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2"><code className="break-all rounded bg-white/5 px-2 py-1 text-sm text-white">{link}</code>
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(link); toast({ title: "Link copied" }); }}>Copy</Button>
          <a href={link} target="_blank" rel="noreferrer" className="text-sm text-[hsl(174,72%,60%)] hover:text-white">Open</a></div>
      </Panel>
      <Panel>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !data?.length ? <Empty icon="psychology" title="No services yet">Add your first service — e.g. "Tax planning session, 60 min, ₹2,000".</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm">
            <Thead cols={["Service", "Kind", ["Price", "right"], "Length", "Where", "SAC", ""]} />
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{data.map(s => (
              <tr key={s.id} className={s.isActive ? "" : "opacity-60"}>
                <td className="py-2 pr-2 text-white">{s.name}<div className="mt-0.5 flex gap-1">{!s.isActive && <Chip>off</Chip>}{s.isPublic && s.kind !== "retainer" && s.isActive && <Chip tone="info">online booking</Chip>}</div></td>
                <td className="pr-2 text-[hsl(215,20%,70%)]">{KIND[s.kind]}</td>
                <td className="pr-2 text-right tabular-nums">{inr(s.price)}{s.kind === "hourly" ? "/hr" : s.kind === "retainer" ? "/mo" : ""}{s.gstRate ? <span className="block text-[11px] text-[hsl(215,20%,55%)]">+{s.gstRate}% GST</span> : null}</td>
                <td className="pr-2">{s.durationMinutes} min{s.hoursIncluded ? <span className="block text-[11px] text-[hsl(215,20%,55%)]">{s.hoursIncluded} h/month</span> : null}</td>
                <td className="pr-2">{s.mode === "both" ? "online / on-site" : s.mode}</td>
                <td className="pr-2 font-mono text-xs">{s.sac}</td>
                <td className="text-right whitespace-nowrap">{manage && <><Button size="sm" variant="ghost" onClick={() => edit(s)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => toggle(s)}>{s.isActive ? "Switch off" : "Switch on"}</Button></>}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit service" : "Add a service"}</DialogTitle><DialogDescription>Prices are before GST; GST is added on the invoice{registered ? "" : " (you have no GSTIN, so none is charged)"}.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="cs-name">Name</Label><Input id="cs-name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
            <div><Label htmlFor="cs-kind">Kind</Label><HubSelect id="cs-kind" className="w-full" value={f.kind} onChange={v => setF({ ...f, kind: v })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</HubSelect></div>
            <div><Label htmlFor="cs-price">Price ₹ {f.kind === "hourly" ? "per hour" : f.kind === "retainer" ? "per month" : "per session"}</Label><Input id="cs-price" inputMode="decimal" value={f.priceRupees} onChange={e => setF({ ...f, priceRupees: e.target.value })} /></div>
            <div><Label htmlFor="cs-dur">Session length (minutes)</Label><Input id="cs-dur" inputMode="numeric" value={f.durationMinutes} onChange={e => setF({ ...f, durationMinutes: e.target.value })} /></div>
            <div><Label htmlFor="cs-mode">Where</Label><HubSelect id="cs-mode" className="w-full" value={f.mode} onChange={v => setF({ ...f, mode: v })}><option value="online">Online</option><option value="onsite">On-site</option><option value="both">Either</option></HubSelect></div>
            <div><Label htmlFor="cs-sac">SAC</Label><Input id="cs-sac" maxLength={6} value={f.sac} onChange={e => setF({ ...f, sac: e.target.value.replace(/\D/g, "") })} /></div>
            {registered && <div><Label htmlFor="cs-gst">GST %</Label><HubSelect id="cs-gst" className="w-full" value={f.gstRate} onChange={v => setF({ ...f, gstRate: v })}>{[0, 5, 18].map(r => <option key={r} value={r}>{r}%</option>)}</HubSelect></div>}
            {f.kind === "retainer" && <div><Label htmlFor="cs-hrs">Hours included per month</Label><Input id="cs-hrs" inputMode="decimal" value={f.hoursIncluded} onChange={e => setF({ ...f, hoursIncluded: e.target.value })} /></div>}
            <div className="sm:col-span-2"><Label htmlFor="cs-desc">Description</Label><Textarea id="cs-desc" rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></div>
            {f.kind !== "retainer" && <label className="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isPublic} onChange={e => setF({ ...f, isPublic: e.target.checked })} /> Clients can book it from your public page</label>}
          </div>
          <p className="text-xs text-[hsl(215,20%,55%)]">SAC 998311 is management consulting; 998221 accounting; 998212 legal advisory. Check with your CA.</p>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={!f.name.trim() || !(Number(f.priceRupees) >= 0) || !f.priceRupees}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Calendar — working hours, days off, the week's appointments
// ═══════════════════════════════════════════════════════════════════════════

type Avail = { windows: Array<{ id: number; weekday: number; startTime: string; endTime: string }>; timeOff: Array<{ id: number; day: string; reason: string | null }> };

export function HubConsultCalendar() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = useFail();
  const avail = useQuery<Avail>({ queryKey: ["/api/hub/consulting/availability"], queryFn: async () => (await apiRequest("GET", "/api/hub/consulting/availability")).data });
  const [weekStart, setWeekStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return istDay(d); });
  const weekEnd = istDay(new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 7 * 86_400_000));
  const appts = useQuery<Appt[]>({ queryKey: ["/api/hub/consulting/appointments", weekStart], queryFn: async () => (await apiRequest("GET", `/api/hub/consulting/appointments?from=${weekStart}&to=${weekEnd}`)).data });
  const [draft, setDraft] = useState<Array<{ weekday: number; startTime: string; endTime: string }> | null>(null);
  const windows = draft ?? (avail.data?.windows ?? []).map(w => ({ weekday: w.weekday, startTime: w.startTime, endTime: w.endTime }));
  const [off, setOff] = useState({ day: "", reason: "" });
  const manage = hubCan(me, "ops:manage");
  const saveHours = async () => {
    try { await apiRequest("PUT", "/api/hub/consulting/availability", { windows }); setDraft(null); qc.invalidateQueries({ queryKey: ["/api/hub/consulting/availability"] }); toast({ title: "Hours saved" }); } catch (e) { fail("Not saved")(e); }
  };
  const addOff = async () => {
    try { await apiRequest("POST", "/api/hub/consulting/time-off", { day: off.day, reason: off.reason || null }); setOff({ day: "", reason: "" }); qc.invalidateQueries({ queryKey: ["/api/hub/consulting/availability"] }); } catch (e) { fail("Not added")(e); }
  };
  const days = Array.from({ length: 7 }, (_, i) => istDay(new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + i * 86_400_000)));
  const shift = (n: number) => setWeekStart(istDay(new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + n * 7 * 86_400_000)));

  return (
    <HubPage title="Calendar" subtitle="Your working hours decide the free times clients see. Days off and booked appointments are taken out automatically. Times are IST.">
      <Panel title="This week" actions={<div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => shift(-1)}>← Prev</Button><Button size="sm" variant="ghost" onClick={() => shift(1)}>Next →</Button></div>}>
        <div className="grid gap-2 sm:grid-cols-7">{days.map(d => {
          const list = (appts.data ?? []).filter(a => istDay(new Date(a.startsAt)) === d && a.status !== "cancelled");
          const isOff = (avail.data?.timeOff ?? []).some(t => String(t.day).slice(0, 10) === d);
          return (
            <div key={d} className={`min-h-[110px] rounded-lg border p-2 ${d === istDay(new Date()) ? "border-[hsl(174,72%,45%)]" : "border-[rgba(255,255,255,0.08)]"}`}>
              <p className="text-xs text-[hsl(215,20%,60%)]">{new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</p>
              {isOff && <Chip tone="muted">day off</Chip>}
              <ul className="mt-1 space-y-1">{list.map(a => (
                <li key={a.id} className="rounded bg-white/5 px-1.5 py-1 text-[11px]"><span className="tabular-nums text-white">{new Date(a.startsAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}</span> <span className="text-[hsl(215,20%,70%)]">{a.customerName}</span>{a.status === "requested" && <span className="text-amber-300"> ·?</span>}</li>
              ))}</ul>
            </div>
          );
        })}</div>
        <p className="mt-2 text-xs text-[hsl(215,20%,55%)]"><Link href="/partner/consulting/appointments" className="underline">Open appointments</Link> to book, confirm or bill.</p>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Working hours" actions={manage && draft ? <Button size="sm" onClick={saveHours}>Save hours</Button> : undefined}>
          <ul className="space-y-2">{windows.map((w, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <HubSelect aria-label="Day" value={String(w.weekday)} disabled={!manage} onChange={v => setDraft(windows.map((x, j) => j === i ? { ...x, weekday: Number(v) } : x))}>{DAYS.map((d, k) => <option key={k} value={k}>{d}</option>)}</HubSelect>
              <Input aria-label="From" type="time" className="h-9 w-28" disabled={!manage} value={w.startTime} onChange={e => setDraft(windows.map((x, j) => j === i ? { ...x, startTime: e.target.value } : x))} />
              <span className="text-[hsl(215,20%,60%)]">to</span>
              <Input aria-label="To" type="time" className="h-9 w-28" disabled={!manage} value={w.endTime} onChange={e => setDraft(windows.map((x, j) => j === i ? { ...x, endTime: e.target.value } : x))} />
              {manage && <Button size="sm" variant="ghost" onClick={() => setDraft(windows.filter((_, j) => j !== i))}>Remove</Button>}
            </li>
          ))}</ul>
          {!windows.length && <p className="text-sm text-[hsl(215,20%,60%)]">No hours yet — clients cannot book online until you add some.</p>}
          {manage && <Button size="sm" variant="outline" className="mt-3" onClick={() => setDraft([...windows, { weekday: 1, startTime: "10:00", endTime: "13:00" }])}>Add hours</Button>}
        </Panel>
        <Panel title="Days off">
          <ul className="space-y-1 text-sm">{(avail.data?.timeOff ?? []).map(t => (
            <li key={t.id} className="flex items-center gap-2"><span className="text-white">{String(t.day).slice(0, 10)}</span><span className="text-[hsl(215,20%,60%)]">{t.reason}</span>
              {manage && <Button size="sm" variant="ghost" className="ml-auto" onClick={async () => { try { await apiRequest("DELETE", `/api/hub/consulting/time-off/${t.id}`); qc.invalidateQueries({ queryKey: ["/api/hub/consulting/availability"] }); } catch (e) { fail("Not removed")(e); } }}>Remove</Button>}</li>
          ))}</ul>
          {manage && <div className="mt-3 flex flex-wrap gap-2"><Input aria-label="Day off" type="date" className="h-9 w-40" value={off.day} onChange={e => setOff({ ...off, day: e.target.value })} /><Input aria-label="Reason" placeholder="Reason" className="h-9 w-36" value={off.reason} onChange={e => setOff({ ...off, reason: e.target.value })} /><Button size="sm" disabled={!off.day} onClick={addOff}>Add</Button></div>}
        </Panel>
      </div>
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Appointments
// ═══════════════════════════════════════════════════════════════════════════

export function HubConsultAppointments() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = useFail();
  const [view, setView] = useState<"upcoming" | "requests" | "past">("upcoming");
  const today = istDay(new Date());
  const appts = useQuery<Appt[]>({ queryKey: ["/api/hub/consulting/appointments", "list"], queryFn: async () => (await apiRequest("GET", "/api/hub/consulting/appointments")).data });
  const services = useConsultServices();
  const customers = useCustomers();
  const retainers = useQuery<Retainer[]>({ queryKey: ["/api/hub/consulting/retainers"], queryFn: async () => (await apiRequest("GET", "/api/hub/consulting/retainers")).data, enabled: hubCan(me, "sales:manage") });
  const now = Date.now();
  const rows = useMemo(() => (appts.data ?? []).filter(a =>
    view === "requests" ? a.status === "requested" : view === "upcoming" ? ["confirmed", "requested"].includes(a.status) && new Date(a.endsAt).getTime() >= now - 86_400_000 : !["requested"].includes(a.status) && (new Date(a.endsAt).getTime() < now || ["completed", "cancelled", "no_show"].includes(a.status)),
  ).sort((x, y) => view === "past" ? +new Date(y.startsAt) - +new Date(x.startsAt) : +new Date(x.startsAt) - +new Date(y.startsAt)), [appts.data, view, now]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/hub/consulting/appointments"] }); qc.invalidateQueries({ queryKey: ["/api/hub/invoices"] }); };
  const manage = hubCan(me, "ops:manage");
  const canBill = hubCan(me, "sales:manage");

  // new appointment
  const [open, setOpen] = useState(false);
  const [n, setN] = useState({ customerId: "", serviceId: "", day: today, time: "", mode: "online", meetingLink: "", location: "", retainerId: "" });
  const slots = useQuery<Array<{ startsAt: string; day: string; time: string }>>({ queryKey: ["/api/hub/consulting/slots", n.serviceId], queryFn: async () => (await apiRequest("GET", `/api/hub/consulting/slots?serviceId=${n.serviceId}&days=30`)).data, enabled: !!n.serviceId && open });
  const svc = (services.data ?? []).find(s => String(s.id) === n.serviceId);
  const book = async () => {
    try {
      await apiRequest("POST", "/api/hub/consulting/appointments", {
        customerId: Number(n.customerId), serviceId: Number(n.serviceId), startsAt: new Date(`${n.day}T${n.time}:00+05:30`).toISOString(),
        mode: svc?.mode === "both" ? n.mode : undefined, meetingLink: n.meetingLink || null, location: n.location || null, retainerId: n.retainerId ? Number(n.retainerId) : null,
      });
      refresh(); setOpen(false); toast({ title: "Booked" });
    } catch (e) { fail("Not booked")(e); }
  };

  // edit / notes
  const [sel, setSel] = useState<Appt | null>(null);
  const [notes, setNotes] = useState({ privateNotes: "", clientNotes: "", meetingLink: "", location: "" });
  const openAppt = (a: Appt) => { setSel(a); setNotes({ privateNotes: a.privateNotes ?? "", clientNotes: a.clientNotes ?? "", meetingLink: a.meetingLink ?? "", location: a.location ?? "" }); };
  const patch = async (a: Appt, body: Record<string, unknown>, ok = "Saved") => {
    try { await apiRequest("PATCH", `/api/hub/consulting/appointments/${a.id}`, body); refresh(); toast({ title: ok }); return true; } catch (e) { fail("Not changed")(e); return false; }
  };
  const bill = async (a: Appt) => {
    try { const r: any = await apiRequest("POST", `/api/hub/consulting/appointments/${a.id}/bill`, {}); refresh(); toast({ title: "Invoiced", description: r.message }); } catch (e) { fail("Not billed")(e); }
  };
  const requests = (appts.data ?? []).filter(a => a.status === "requested").length;

  return (
    <HubPage title="Appointments" subtitle="Book sessions, confirm online requests, keep notes, and bill completed sessions as invoices."
      actions={manage ? <Button onClick={() => { setN({ customerId: "", serviceId: "", day: today, time: "", mode: "online", meetingLink: "", location: "", retainerId: "" }); setOpen(true); }}>Book appointment</Button> : undefined}>
      <Panel actions={<div className="flex gap-1" role="tablist">{([["upcoming", "Upcoming"], ["requests", `Requests${requests ? ` (${requests})` : ""}`], ["past", "Past"]] as const).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`rounded-md px-3 py-1.5 text-sm ${view === k ? "bg-white/10 text-white" : "text-[hsl(215,20%,65%)] hover:text-white"}`}>{l}</button>
      ))}</div>}>
        {appts.isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !rows.length ? <Empty icon="event" title={view === "requests" ? "No booking requests" : view === "upcoming" ? "Nothing coming up" : "No past appointments"} /> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)]">{rows.map(a => (
            <li key={a.id} className="grid gap-2 py-3 lg:grid-cols-[1fr_auto]">
              <div className="text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="tabular-nums text-white">{fmt(a.startsAt)}</span><span className="text-white">{a.serviceName}</span><Chip tone={A_TONE[a.status]}>{a.status.replace("_", " ")}</Chip>{a.source === "public" && <Chip tone="info">online request</Chip>}{a.retainerId && <Chip>retainer</Chip>}</div>
                <p className="mt-0.5 text-[hsl(215,20%,70%)]">{a.customerName}{a.customerPhone ? ` · ${a.customerPhone}` : ""} · {a.mode === "online" ? "online" : "on-site"}{a.price ? ` · ${inr(a.price)}` : ""}{a.invoiceDocumentId ? " · invoiced" : ""}</p>
                {a.clientMessage && <p className="mt-0.5 text-xs text-[hsl(215,20%,60%)]">“{a.clientMessage}”</p>}
              </div>
              <div className="flex flex-wrap items-center gap-1 lg:justify-end">
                {manage && a.status === "requested" && <Button size="sm" onClick={() => patch(a, { status: "confirmed" }, "Confirmed")}>Confirm</Button>}
                {manage && a.status === "confirmed" && <Button size="sm" variant="outline" onClick={() => patch(a, { status: "completed" }, "Completed")}>Done</Button>}
                {canBill && ["completed", "no_show"].includes(a.status) && !a.invoiceDocumentId && !a.retainerId && a.price > 0 && <Button size="sm" onClick={() => bill(a)}>Bill {inr(a.price)}</Button>}
                {canBill && a.status === "confirmed" && !a.invoiceDocumentId && !a.retainerId && a.price > 0 && <PayLinkButton kind="invoice" label={`Ask to pay ${inr(a.price)}`}
                  prepare={async () => { const r: any = await apiRequest("POST", `/api/hub/consulting/appointments/${a.id}/bill`, { upfront: true }); refresh(); return r.data.id; }} />}
                {canBill && a.invoiceDocumentId && <PayLinkButton kind="invoice" refId={a.invoiceDocumentId} />}
                {a.invoiceDocumentId && <Link href={`/partner/sales/invoices/${a.invoiceDocumentId}`} className="text-sm text-[hsl(174,72%,60%)] hover:text-white">Invoice →</Link>}
                <Button size="sm" variant="ghost" onClick={() => openAppt(a)}>Details</Button>
              </div>
            </li>
          ))}</ul>
        )}
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Book an appointment</DialogTitle><DialogDescription>Free times come from your working hours; you can also type any time.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="na-c">Client</Label><HubSelect id="na-c" className="w-full" value={n.customerId} onChange={v => setN({ ...n, customerId: v })}><option value="">Choose…</option>{(customers.data ?? []).map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}</HubSelect></div>
            <div className="sm:col-span-2"><Label htmlFor="na-s">Service</Label><HubSelect id="na-s" className="w-full" value={n.serviceId} onChange={v => setN({ ...n, serviceId: v, time: "" })}><option value="">Choose…</option>{(services.data ?? []).filter(s => s.isActive).map(s => <option key={s.id} value={s.id}>{s.name} · {s.durationMinutes} min</option>)}</HubSelect></div>
            <div><Label htmlFor="na-d">Day</Label><Input id="na-d" type="date" value={n.day} onChange={e => setN({ ...n, day: e.target.value, time: "" })} /></div>
            <div><Label htmlFor="na-t">Time (IST)</Label><Input id="na-t" type="time" value={n.time} onChange={e => setN({ ...n, time: e.target.value })} /></div>
            {!!n.serviceId && <div className="sm:col-span-2 flex flex-wrap gap-1">{(slots.data ?? []).filter(s => s.day === n.day).map(s => <button key={s.startsAt} onClick={() => setN({ ...n, time: s.time })} className={`rounded border px-2 py-0.5 text-xs tabular-nums ${n.time === s.time ? "border-[hsl(174,72%,45%)] text-white" : "border-[rgba(255,255,255,0.12)] text-[hsl(215,20%,70%)]"}`}>{s.time}</button>)}{!(slots.data ?? []).some(s => s.day === n.day) && <span className="text-xs text-[hsl(215,20%,55%)]">No free times that day in your hours.</span>}</div>}
            {svc?.mode === "both" && <div><Label htmlFor="na-m">Where</Label><HubSelect id="na-m" className="w-full" value={n.mode} onChange={v => setN({ ...n, mode: v })}><option value="online">Online</option><option value="onsite">On-site</option></HubSelect></div>}
            <div className="sm:col-span-2"><Label htmlFor="na-l">{(svc?.mode === "onsite" || n.mode === "onsite") && svc?.mode !== "online" ? "Address" : "Meeting link"}</Label><Input id="na-l" value={(svc?.mode === "onsite" || n.mode === "onsite") && svc?.mode !== "online" ? n.location : n.meetingLink} onChange={e => (svc?.mode === "onsite" || n.mode === "onsite") && svc?.mode !== "online" ? setN({ ...n, location: e.target.value }) : setN({ ...n, meetingLink: e.target.value })} /></div>
            {(retainers.data ?? []).some(r => String(r.customerId) === n.customerId && r.status === "active") && <div className="sm:col-span-2"><Label htmlFor="na-r">Covered by retainer</Label><HubSelect id="na-r" className="w-full" value={n.retainerId} onChange={v => setN({ ...n, retainerId: v })}><option value="">No — bill this session</option>{(retainers.data ?? []).filter(r => String(r.customerId) === n.customerId && r.status === "active").map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</HubSelect></div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={book} disabled={!n.customerId || !n.serviceId || !n.day || !n.time}>Book</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sel} onOpenChange={o => !o && setSel(null)}>
        <DialogContent className="max-w-lg">
          {sel && <>
            <DialogHeader><DialogTitle>{sel.serviceName} · {sel.customerName}</DialogTitle><DialogDescription>{fmt(sel.startsAt)} · {sel.status}</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <div><Label htmlFor="ad-link">Meeting link</Label><Input id="ad-link" value={notes.meetingLink} onChange={e => setNotes({ ...notes, meetingLink: e.target.value })} /></div>
              <div><Label htmlFor="ad-loc">Address (on-site)</Label><Input id="ad-loc" value={notes.location} onChange={e => setNotes({ ...notes, location: e.target.value })} /></div>
              <div><Label htmlFor="ad-cn">Notes for the client (shown on their booking page)</Label><Textarea id="ad-cn" rows={3} value={notes.clientNotes} onChange={e => setNotes({ ...notes, clientNotes: e.target.value })} /></div>
              <div><Label htmlFor="ad-pn">Private notes</Label><Textarea id="ad-pn" rows={3} value={notes.privateNotes} onChange={e => setNotes({ ...notes, privateNotes: e.target.value })} /></div>
              <p className="text-xs text-[hsl(215,20%,55%)]">Client's page: <a className="underline" href={sel.clientLink} target="_blank" rel="noreferrer">{window.location.origin}{sel.clientLink}</a></p>
            </div>
            <DialogFooter className="flex-wrap gap-2">
              {manage && ["requested", "confirmed"].includes(sel.status) && <Button variant="ghost" className="text-rose-300" onClick={async () => { const r = window.prompt("Reason for cancelling"); if (r !== null && await patch(sel, { status: "cancelled", cancelledReason: r }, "Cancelled")) setSel(null); }}>Cancel appointment</Button>}
              {manage && sel.status === "confirmed" && <Button variant="ghost" onClick={async () => { if (await patch(sel, { status: "no_show" }, "Marked no-show")) setSel(null); }}>No-show</Button>}
              <Button onClick={async () => { if (await patch(sel, { ...notes, meetingLink: notes.meetingLink || null, location: notes.location || null })) setSel(null); }}>Save</Button>
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Retainers
// ═══════════════════════════════════════════════════════════════════════════

export function HubConsultRetainers() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = useFail();
  const { data, isLoading } = useQuery<Retainer[]>({ queryKey: ["/api/hub/consulting/retainers"], queryFn: async () => (await apiRequest("GET", "/api/hub/consulting/retainers")).data });
  const services = useConsultServices();
  const customers = useCustomers();
  const [open, setOpen] = useState(false);
  const today = istDay(new Date());
  const [f, setF] = useState({ customerId: "", serviceId: "", title: "", monthlyFeeRupees: "", billingDay: "1", startDate: today, hoursIncluded: "" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/hub/consulting/retainers"] }); qc.invalidateQueries({ queryKey: ["/api/hub/invoices"] }); };
  const create = async () => {
    try {
      const r: any = await apiRequest("POST", "/api/hub/consulting/retainers", { customerId: Number(f.customerId), serviceId: f.serviceId ? Number(f.serviceId) : null, title: f.title || undefined, monthlyFeeRupees: f.monthlyFeeRupees ? Number(f.monthlyFeeRupees) : undefined, billingDay: Number(f.billingDay), startDate: f.startDate, hoursIncluded: f.hoursIncluded ? Number(f.hoursIncluded) : null });
      refresh(); setOpen(false); toast({ title: "Retainer set up", description: r.message });
    } catch (e) { fail("Not set up")(e); }
  };
  const act = async (r: Retainer, body: Record<string, unknown>) => { try { await apiRequest("PATCH", `/api/hub/consulting/retainers/${r.id}`, body); refresh(); } catch (e) { fail("Not changed")(e); } };
  const billNow = async (r: Retainer) => { try { const res: any = await apiRequest("POST", `/api/hub/consulting/retainers/${r.id}/bill`, {}); refresh(); toast({ title: "Invoiced", description: res.message }); } catch (e) { fail("Not billed")(e); } };
  const svcRet = (services.data ?? []).filter(s => s.kind === "retainer" && s.isActive);
  const mrr = (data ?? []).filter(r => r.status === "active").reduce((a, r) => a + r.monthlyFee, 0);

  return (
    <HubPage title="Retainers" subtitle="Monthly fees that invoice themselves on their billing day — once a month, never twice. Sessions booked under a retainer are not billed separately."
      actions={<Button onClick={() => setOpen(true)}>New retainer</Button>}>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3"><Stat label="Active retainers" value={(data ?? []).filter(r => r.status === "active").length} /><Stat label="Monthly, before GST" value={inr(mrr)} /></div>
      <Panel>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !data?.length ? <Empty icon="autorenew" title="No retainers yet" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
            <Thead cols={["Retainer", "Client", ["Monthly", "right"], "Bills on", "Hours this month", "Status", ""]} />
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{data.map(r => (
              <tr key={r.id}>
                <td className="py-2 pr-2 text-white">{r.title}<span className="block text-[11px] text-[hsl(215,20%,55%)]">from {r.startDate}{r.endDate ? ` to ${r.endDate}` : ""}</span></td>
                <td className="pr-2">{r.customerName}</td>
                <td className="pr-2 text-right tabular-nums">{inr(r.monthlyFee)}</td>
                <td className="pr-2">day {r.billingDay}<span className="block text-[11px] text-[hsl(215,20%,55%)]">{r.lastBilledPeriod ? `last: ${r.lastBilledPeriod}` : "not billed yet"}</span>{r.lastBillError && <span className="block max-w-[220px] text-[11px] text-rose-300">{r.lastBillError}</span>}</td>
                <td className="pr-2 tabular-nums">{r.hoursUsedThisMonth}{r.hoursIncluded ? ` / ${r.hoursIncluded} h` : " h"}{r.hoursIncluded && r.hoursUsedThisMonth > r.hoursIncluded ? <Chip tone="warn">over</Chip> : null}</td>
                <td className="pr-2"><Chip tone={r.status === "active" ? "good" : r.status === "paused" ? "warn" : "muted"}>{r.status}</Chip></td>
                <td className="text-right whitespace-nowrap">
                  {r.status === "active" && r.lastBilledPeriod !== today.slice(0, 7) && <Button size="sm" variant="outline" onClick={() => billNow(r)}>Bill this month</Button>}
                  {r.status === "active" && <Button size="sm" variant="ghost" onClick={() => act(r, { status: "paused" })}>Pause</Button>}
                  {r.status === "paused" && <Button size="sm" variant="ghost" onClick={() => act(r, { status: "active" })}>Resume</Button>}
                  {r.status !== "ended" && <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => { if (window.confirm(`End ${r.title}? It stops billing.`)) act(r, { status: "ended", endDate: today }); }}>End</Button>}
                </td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New retainer</DialogTitle><DialogDescription>Invoiced automatically each month on the billing day (1–28).</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="r-c">Client</Label><HubSelect id="r-c" className="w-full" value={f.customerId} onChange={v => setF({ ...f, customerId: v })}><option value="">Choose…</option>{(customers.data ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</HubSelect></div>
            <div className="sm:col-span-2"><Label htmlFor="r-s">From a retainer service (optional)</Label><HubSelect id="r-s" className="w-full" value={f.serviceId} onChange={v => { const s = svcRet.find(x => String(x.id) === v); setF({ ...f, serviceId: v, title: s?.name ?? f.title, monthlyFeeRupees: s ? String(s.price) : f.monthlyFeeRupees, hoursIncluded: s?.hoursIncluded ? String(s.hoursIncluded) : f.hoursIncluded }); }}><option value="">None — custom</option>{svcRet.map(s => <option key={s.id} value={s.id}>{s.name} · {inr(s.price)}/mo</option>)}</HubSelect></div>
            <div className="sm:col-span-2"><Label htmlFor="r-t">Title on the invoice</Label><Input id="r-t" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
            <div><Label htmlFor="r-f">Monthly fee ₹ (before GST)</Label><Input id="r-f" inputMode="decimal" value={f.monthlyFeeRupees} onChange={e => setF({ ...f, monthlyFeeRupees: e.target.value })} /></div>
            <div><Label htmlFor="r-h">Hours included</Label><Input id="r-h" inputMode="decimal" value={f.hoursIncluded} onChange={e => setF({ ...f, hoursIncluded: e.target.value })} /></div>
            <div><Label htmlFor="r-d">Billing day</Label><Input id="r-d" type="number" min={1} max={28} value={f.billingDay} onChange={e => setF({ ...f, billingDay: e.target.value })} /></div>
            <div><Label htmlFor="r-sd">Starts</Label><Input id="r-sd" type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create} disabled={!f.customerId || !f.monthlyFeeRupees}>Set up</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}
