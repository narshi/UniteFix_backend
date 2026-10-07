/**
 * Field service — a partner running its own technicians in its own pincodes.
 *
 *   Jobs         bookings from the partner's territory; assign before the
 *                assign-by time or UniteFix steps in
 *   Technicians  the partner's people: add, documents, switch on/off
 *   Territory    pincodes served (proposed → approved by UniteFix), pause
 *   Rates        the partner's price per service, inside UniteFix's band
 *   Earnings     job values held, released, and the monthly invoice to UniteFix
 */

import { useMemo, useRef, useState } from "react";
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

type Job = {
  id: number; serviceId: string; status: string; serviceName: string; categoryName: string | null; quantity: number; description: string; urgency: string | null;
  preferredDate: string | null; preferredTimeSlot: string | null; customerName: string | null; customerPhone: string | null; address: string | null; pincode: string | null;
  createdAt: string; assignedAt: string | null; completedAt: string | null; technician: { id: number; name: string | null } | null;
  slaAssignBy: string | null; overdue: boolean; escalatedAt: string | null; price: number | null; yourValue: number | null; paymentMethod: string | null;
};
type Tech = {
  id: number; partnerId: string | null; fullName: string | null; phone: string | null; services: string[]; isActive: boolean; isOnline: boolean;
  verification: string; adminRemarks: string | null; documents: { aadhaar: boolean; pan: boolean; photo: boolean }; completed: number; rating: number; activeJobs: number;
};

const fail = (toast: ReturnType<typeof useToast>["toast"], t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
const when = (d: string | null) => d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
function timeLeft(d: string | null) {
  if (!d) return "";
  const ms = new Date(d).getTime() - Date.now();
  const m = Math.round(Math.abs(ms) / 60000);
  const txt = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  return ms >= 0 ? `${txt} left to assign` : `${txt} overdue`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Jobs
// ═══════════════════════════════════════════════════════════════════════════

export function HubFieldJobs() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [view, setView] = useState<"queue" | "active" | "done">("queue");
  const [q, setQ] = useState("");
  const jobs = useQuery<Job[]>({ queryKey: ["/api/hub/field/jobs", view], queryFn: async () => (await apiRequest("GET", `/api/hub/field/jobs?view=${view}`)).data, refetchInterval: 60_000 });
  const techs = useQuery<Tech[]>({ queryKey: ["/api/hub/field/technicians"], queryFn: async () => (await apiRequest("GET", "/api/hub/field/technicians")).data });
  const ready = (techs.data ?? []).filter(t => t.isActive && t.verification === "verified");
  const [pick, setPick] = useState<Record<number, string>>({});
  const canAssign = hubCan(me, "ops:manage");
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (jobs.data ?? []).filter(j => !t || [j.serviceId, j.serviceName, j.customerName, j.customerPhone, j.pincode, j.address, j.technician?.name].some(v => (v ?? "").toLowerCase().includes(t)));
  }, [jobs.data, q]);
  const assign = async (job: Job) => {
    const employeeId = Number(pick[job.id]);
    if (!employeeId) return;
    try { await apiRequest("POST", `/api/hub/field/jobs/${job.id}/assign`, { employeeId }); qc.invalidateQueries({ queryKey: ["/api/hub/field/jobs"] }); toast({ title: "Assigned", description: "The technician has been notified." }); }
    catch (e) { fail(toast, "Not assigned")(e); }
  };
  const overdue = (jobs.data ?? []).filter(j => j.overdue).length;

  return (
    <HubPage title="Jobs" subtitle="UniteFix bookings in your territory. Assign a technician before the assign-by time — after it, UniteFix may send its own expert.">
      {view === "queue" && overdue > 0 && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{overdue} job(s) are past their assign-by time and now show in UniteFix's queue too.</div>}
      <Panel actions={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1" role="tablist">{([["queue", "To assign"], ["active", "In progress"], ["done", "Done"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`rounded-md px-3 py-1.5 text-sm ${view === k ? "bg-white/10 text-white" : "text-[hsl(215,20%,65%)] hover:text-white"}`}>{l}</button>
          ))}</div>
          <Input aria-label="Search jobs" placeholder="Job, customer, phone, pincode, technician…" className="h-9 w-72" value={q} onChange={e => setQ(e.target.value)} />
        </div>}>
        {jobs.isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !rows.length ? (
          <Empty icon="handyman" title={view === "queue" ? "Nothing to assign" : view === "active" ? "No jobs in progress" : "No finished jobs yet"}>{view === "queue" ? "New bookings in your pincodes land here." : null}</Empty>
        ) : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)]">{rows.map(j => (
            <li key={j.id} className="grid gap-3 py-3 lg:grid-cols-[1fr_auto]">
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-white">{j.serviceId}</span>
                  <span className="text-white">{j.serviceName}{j.quantity > 1 ? ` × ${j.quantity}` : ""}</span>
                  {j.urgency === "urgent" && <Chip tone="bad">urgent</Chip>}
                  {view !== "queue" && <Chip tone={j.status === "completed" ? "good" : j.status === "cancelled" ? "muted" : "info"}>{j.status.replace("_", " ")}</Chip>}
                  {view === "queue" && j.slaAssignBy && <Chip tone={j.overdue ? "bad" : "warn"}>{timeLeft(j.slaAssignBy)}</Chip>}
                </div>
                <p className="mt-1 text-[hsl(215,20%,70%)]">{j.customerName ?? "Customer"}{j.customerPhone ? ` · ${j.customerPhone}` : ""} · {j.address ?? `pincode ${j.pincode ?? "—"}`}</p>
                <p className="mt-0.5 text-xs text-[hsl(215,20%,55%)]">{j.description}{j.preferredDate ? ` · wants ${j.preferredDate}${j.preferredTimeSlot ? ` ${j.preferredTimeSlot}` : ""}` : ""} · booked {when(j.createdAt)}</p>
                {j.yourValue != null && <p className="mt-0.5 text-xs text-[hsl(215,20%,55%)]">Customer pays {inr(j.price)} · your value {inr(j.yourValue)}{j.paymentMethod && j.paymentMethod !== "pending" ? ` · paid ${j.paymentMethod}` : ""}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {j.technician && <span className="text-sm text-white">{j.technician.name}</span>}
                {canAssign && ["queue", "active"].includes(view) && ["created", "assigned"].includes(j.status) && (
                  <>
                    <HubSelect aria-label={`Technician for ${j.serviceId}`} value={pick[j.id] ?? ""} onChange={v => setPick({ ...pick, [j.id]: v })}>
                      <option value="">{ready.length ? (j.technician ? "Reassign to…" : "Choose technician…") : "No technician ready"}</option>
                      {ready.filter(t => t.id !== j.technician?.id).map(t => <option key={t.id} value={t.id}>{t.fullName} · {t.activeJobs} active{t.isOnline ? " · online" : ""}</option>)}
                    </HubSelect>
                    <Button size="sm" disabled={!pick[j.id]} onClick={() => assign(j)}>{j.technician ? "Reassign" : "Assign"}</Button>
                  </>
                )}
              </div>
            </li>
          ))}</ul>
        )}
      </Panel>
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Technicians
// ═══════════════════════════════════════════════════════════════════════════

const VER: Record<string, string> = { verified: "good", pending: "warn", rejected: "bad" };

export function HubFieldTechnicians() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Tech[]>({ queryKey: ["/api/hub/field/technicians"], queryFn: async () => (await apiRequest("GET", "/api/hub/field/technicians")).data });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fullName: "", phone: "", services: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<{ id: number; kind: string } | null>(null);
  const manage = hubCan(me, "ops:manage");
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/hub/field/technicians"] });

  const add = async () => {
    try {
      const r: any = await apiRequest("POST", "/api/hub/field/technicians", { fullName: f.fullName, phone: f.phone, services: f.services.split(",").map(s => s.trim()).filter(Boolean) });
      refresh(); setOpen(false); setF({ fullName: "", phone: "", services: "" }); toast({ title: "Technician added", description: r.message });
    } catch (e) { fail(toast, "Not added")(e); }
  };
  const toggle = async (t: Tech) => {
    try { await apiRequest("PATCH", `/api/hub/field/technicians/${t.id}`, { isActive: !t.isActive }); refresh(); } catch (e) { fail(toast, "Not changed")(e); }
  };
  const upload = async (file: File) => {
    if (!uploadFor) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await fetch(`/api/hub/field/technicians/${uploadFor.id}/documents/${uploadFor.kind}`, { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("adminToken") ?? ""}` }, body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body)}`);
      refresh(); toast({ title: "Uploaded", description: "UniteFix will verify it." });
    } catch (e) { fail(toast, "Upload failed")(e); } finally { setUploadFor(null); if (fileRef.current) fileRef.current.value = ""; }
  };
  const pickFile = (id: number, kind: string) => { setUploadFor({ id, kind }); setTimeout(() => fileRef.current?.click(), 0); };

  return (
    <HubPage title="Technicians" subtitle="Your people, working UniteFix jobs in your territory. You employ and pay them; UniteFix verifies each one before their first job."
      actions={manage ? <Button onClick={() => setOpen(true)}>Add technician</Button> : undefined}>
      <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) upload(file); }} />
      <Panel>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !data?.length ? <Empty icon="engineering" title="No technicians yet">Add them with their mobile number — it is their login to the UniteFix app.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
            <Thead cols={["Technician", "Verification", "Documents", ["Jobs", "right"], ["Rating", "right"], "Status", ""]} />
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{data.map(t => (
              <tr key={t.id}>
                <td className="py-2 pr-2"><span className="text-white">{t.fullName}</span><span className="block text-xs text-[hsl(215,20%,55%)]">{t.phone} · {t.partnerId}{t.services.length ? ` · ${t.services.join(", ")}` : ""}</span></td>
                <td className="pr-2"><Chip tone={VER[t.verification] ?? "muted"}>{t.verification}</Chip>{t.adminRemarks && t.verification === "rejected" && <span className="mt-1 block max-w-[220px] text-xs text-rose-300">{t.adminRemarks}</span>}</td>
                <td className="pr-2">
                  <div className="flex flex-wrap gap-1">{(["aadhaar", "pan", "photo"] as const).map(k => (
                    <button key={k} disabled={!manage} onClick={() => pickFile(t.id, k)} className={`rounded border px-2 py-0.5 text-[11px] ${t.documents[k] ? "border-emerald-500/30 text-emerald-300" : "border-[rgba(255,255,255,0.15)] text-[hsl(215,20%,70%)] hover:text-white"}`}>
                      {t.documents[k] ? "✓ " : "+ "}{k === "aadhaar" ? "ID" : k === "pan" ? "PAN" : "Photo"}
                    </button>
                  ))}</div>
                </td>
                <td className="pr-2 text-right tabular-nums">{t.completed}<span className="block text-[11px] text-[hsl(215,20%,55%)]">{t.activeJobs} active</span></td>
                <td className="pr-2 text-right tabular-nums">{t.rating ? t.rating.toFixed(1) : "—"}</td>
                <td className="pr-2">{t.isActive ? <Chip tone="good">{t.isOnline ? "online" : "active"}</Chip> : <Chip>off</Chip>}</td>
                <td className="text-right">{manage && <Button size="sm" variant="ghost" disabled={!t.isActive && t.verification !== "verified"} onClick={() => toggle(t)}>{t.isActive ? "Switch off" : "Switch on"}</Button>}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add a technician</DialogTitle><DialogDescription>They sign in to the UniteFix app with this mobile number (OTP). Upload their ID next; UniteFix verifies before they can take a job.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="t-name">Full name</Label><Input id="t-name" value={f.fullName} onChange={e => setF({ ...f, fullName: e.target.value })} /></div>
            <div><Label htmlFor="t-phone">Mobile</Label><Input id="t-phone" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></div>
            <div><Label htmlFor="t-skills">Trades (comma separated)</Label><Input id="t-skills" placeholder="Laptop, Desktop, CCTV" value={f.services} onChange={e => setF({ ...f, services: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={add} disabled={f.fullName.trim().length < 2 || f.phone.replace(/\D/g, "").length < 10}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Territory
// ═══════════════════════════════════════════════════════════════════════════

type Territory = { id: number; pincode: string; mode: string; status: string; area: string | null; district: string | null; serviceable: boolean; openJobs: number; pausedReason: string | null; reviewNote: string | null };
const T_TONE: Record<string, string> = { active: "good", proposed: "warn", paused: "muted", withdrawn: "muted", rejected: "bad" };

export function HubFieldTerritory() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Territory[]>({ queryKey: ["/api/hub/field/territories"], queryFn: async () => (await apiRequest("GET", "/api/hub/field/territories")).data });
  const [pins, setPins] = useState("");
  const [area, setArea] = useState("");
  const [phone, setPhone] = useState("");
  const manage = hubCan(me, "settings:manage");
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/hub/field/territories"] });
  const propose = async () => {
    try { const r: any = await apiRequest("POST", "/api/hub/field/territories", { pincodes: pins, area: area || null }); refresh(); setPins(""); toast({ title: "Sent for approval", description: r.message }); }
    catch (e) { fail(toast, "Not sent")(e); }
  };
  const act = async (t: Territory, action: "pause" | "resume" | "withdraw") => {
    if (action === "withdraw" && !window.confirm(`Stop serving ${t.pincode}? New bookings there go back to UniteFix.`)) return;
    const reason = action === "pause" ? window.prompt("Why pause? (shown to UniteFix)", "Holiday") : null;
    if (action === "pause" && reason === null) return;
    try { const r: any = await apiRequest("POST", `/api/hub/field/territories/${t.id}/${action}`, { reason }); refresh(); toast({ title: r.message }); } catch (e) { fail(toast, "Not changed")(e); }
  };
  const savePhone = async () => {
    try { await apiRequest("PUT", "/api/hub/field/settings", { fieldSupportPhone: phone || null }); toast({ title: "Saved" }); } catch (e) { fail(toast, "Not saved")(e); }
  };
  const counts = (s: string) => (data ?? []).filter(t => t.status === s).length;

  return (
    <HubPage title="Territory" subtitle="The pincodes where UniteFix bookings come to you. UniteFix approves each pincode; one where it has no presence of its own is usually yours exclusively.">
      <div className="grid gap-3 grid-cols-3">
        <Stat label="Active pincodes" value={counts("active")} />
        <Stat label="Awaiting approval" value={counts("proposed")} />
        <Stat label="Paused" value={counts("paused")} />
      </div>
      {manage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Propose pincodes">
            <div className="space-y-3">
              <div><Label htmlFor="p-pins">Pincodes</Label><Textarea id="p-pins" rows={3} placeholder="581401, 581402, 581403" value={pins} onChange={e => setPins(e.target.value)} /></div>
              <div><Label htmlFor="p-area">Area name (for new pincodes)</Label><Input id="p-area" placeholder="Sirsi town" value={area} onChange={e => setArea(e.target.value)} /></div>
              <Button onClick={propose} disabled={!pins.trim()}>Send to UniteFix</Button>
            </div>
          </Panel>
          <Panel title="Your number on bookings">
            <p className="text-sm text-[hsl(215,20%,65%)]">Customers in your territory see "Serviced by {me?.displayName}, a UniteFix partner" and this number for first-line help. Defaults to your contact number.</p>
            <div className="mt-3 flex gap-2"><Input aria-label="Support phone" inputMode="tel" placeholder={me?.business?.contactPhone ?? "10-digit number"} value={phone} onChange={e => setPhone(e.target.value)} className="max-w-[220px]" /><Button variant="outline" onClick={savePhone}>Save</Button></div>
          </Panel>
        </div>
      )}
      <Panel title="Pincodes">
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !data?.length ? <Empty icon="map" title="No pincodes yet" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm">
            <Thead cols={["Pincode", "Area", "Status", "Mode", ["Open jobs", "right"], ""]} />
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{data.map(t => (
              <tr key={t.id}>
                <td className="py-2 pr-2 font-mono text-white">{t.pincode}</td>
                <td className="pr-2 text-[hsl(215,20%,70%)]">{[t.area, t.district].filter(Boolean).join(", ") || "—"}</td>
                <td className="pr-2"><Chip tone={T_TONE[t.status]}>{t.status}</Chip>{(t.pausedReason || t.reviewNote) && <span className="block text-xs text-[hsl(215,20%,55%)]">{t.status === "paused" ? t.pausedReason : t.reviewNote}</span>}</td>
                <td className="pr-2">{t.status === "active" || t.status === "paused" ? <Chip tone={t.mode === "exclusive" ? "info" : "muted"}>{t.mode}</Chip> : "—"}</td>
                <td className="pr-2 text-right tabular-nums">{t.openJobs}</td>
                <td className="text-right whitespace-nowrap">{manage && <>
                  {t.status === "active" && <Button size="sm" variant="ghost" onClick={() => act(t, "pause")}>Pause</Button>}
                  {t.status === "paused" && <Button size="sm" variant="ghost" onClick={() => act(t, "resume")}>Resume</Button>}
                  {["active", "paused", "proposed"].includes(t.status) && <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => act(t, "withdraw")}>Withdraw</Button>}
                </>}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Rates
// ═══════════════════════════════════════════════════════════════════════════

type RateRow = {
  catalogServiceId: number; name: string; category: string | null; nationalPrice: number; floor: number; ceiling: number;
  live: { id: number; price: number; since: string } | null; upcoming: { id: number; price: number; from: string; status: string } | null; rejected: { price: number; note: string | null } | null;
};

export function HubFieldRates() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ guardrailPercent: number; services: RateRow[] }>({ queryKey: ["/api/hub/field/rates"], queryFn: async () => (await apiRequest("GET", "/api/hub/field/rates")).data });
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [q, setQ] = useState("");
  const manage = hubCan(me, "settings:manage");
  const rows = (data?.services ?? []).filter(r => !q.trim() || `${r.name} ${r.category}`.toLowerCase().includes(q.trim().toLowerCase()));
  const save = async (r: RateRow) => {
    try { const res: any = await apiRequest("PUT", `/api/hub/field/rates/${r.catalogServiceId}`, { price: Number(edit[r.catalogServiceId]) }); qc.invalidateQueries({ queryKey: ["/api/hub/field/rates"] }); setEdit({ ...edit, [r.catalogServiceId]: "" }); toast({ title: "Saved", description: res.message }); }
    catch (e) { fail(toast, "Not saved")(e); }
  };
  const clear = async (r: RateRow) => {
    try { await apiRequest("DELETE", `/api/hub/field/rates/${r.catalogServiceId}`); qc.invalidateQueries({ queryKey: ["/api/hub/field/rates"] }); toast({ title: "Back to the national price from tomorrow" }); }
    catch (e) { fail(toast, "Not changed")(e); }
  };
  return (
    <HubPage title="Rates" subtitle={`The all-in price customers in your territory pay (GST included). Within ±${data?.guardrailPercent ?? 25}% of UniteFix's national price; a change goes live no sooner than 24 hours ahead, and new partners' changes are reviewed first.`}
      actions={<Input aria-label="Search services" placeholder="Search services…" className="h-9 w-60" value={q} onChange={e => setQ(e.target.value)} />}>
      <Panel>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !rows.length ? <Empty icon="sell" title="No services" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
            <Thead cols={["Service", ["National", "right"], ["Allowed", "right"], ["Your price", "right"], "Next change", ...(manage ? [""] : [])]} />
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{rows.map(r => (
              <tr key={r.catalogServiceId}>
                <td className="py-2 pr-2 text-white">{r.name}<span className="block text-xs text-[hsl(215,20%,55%)]">{r.category}</span></td>
                <td className="pr-2 text-right tabular-nums">₹{r.nationalPrice}</td>
                <td className="pr-2 text-right text-xs tabular-nums text-[hsl(215,20%,60%)]">₹{r.floor}–₹{r.ceiling}</td>
                <td className="pr-2 text-right tabular-nums">{r.live ? <span className="text-white">₹{r.live.price}</span> : <span className="text-[hsl(215,20%,55%)]">national</span>}</td>
                <td className="pr-2 text-xs">{r.upcoming ? <><Chip tone={r.upcoming.status === "live" ? "info" : "warn"}>{r.upcoming.status === "live" ? "scheduled" : "in review"}</Chip> ₹{r.upcoming.price} from {when(r.upcoming.from)}</> : r.rejected ? <span className="text-rose-300">₹{r.rejected.price} not approved{r.rejected.note ? `: ${r.rejected.note}` : ""}</span> : "—"}</td>
                {manage && <td className="text-right whitespace-nowrap">
                  <Input aria-label={`New price for ${r.name}`} className="inline-flex h-8 w-24" inputMode="numeric" placeholder="₹" value={edit[r.catalogServiceId] ?? ""} onChange={e => setEdit({ ...edit, [r.catalogServiceId]: e.target.value.replace(/\D/g, "") })} />
                  <Button size="sm" className="ml-1" disabled={!edit[r.catalogServiceId]} onClick={() => save(r)}>Set</Button>
                  {r.live && <Button size="sm" variant="ghost" onClick={() => clear(r)}>Use national</Button>}
                </td>}
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Warranty — partner first
// ═══════════════════════════════════════════════════════════════════════════

type Claim = { id: number; claimId: string; status: string; description: string; createdAt: string; serviceId: string; serviceType: string; address: string | null; customerName: string | null; customerPhone: string | null; respondBy: string | null; takenAt: string | null; technician: string | null; note: string | null; missed: boolean; verdict: string | null; chargedRupees: number | null };

export function HubFieldWarranty() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Claim[]>({ queryKey: ["/api/hub/field/warranty"], queryFn: async () => (await apiRequest("GET", "/api/hub/field/warranty")).data });
  const techs = useQuery<Tech[]>({ queryKey: ["/api/hub/field/technicians"], queryFn: async () => (await apiRequest("GET", "/api/hub/field/technicians")).data });
  const ready = (techs.data ?? []).filter(t => t.isActive && t.verification === "verified");
  const [pick, setPick] = useState<Record<number, string>>({});
  const take = async (c: Claim) => {
    try { const r: any = await apiRequest("POST", `/api/hub/field/warranty/${c.id}/take`, { employeeId: Number(pick[c.id]) }); qc.invalidateQueries({ queryKey: ["/api/hub/field/warranty"] }); toast({ title: "Taken", description: r.message }); }
    catch (e) { fail(toast, "Not taken")(e); }
  };
  const waiting = (data ?? []).filter(c => c.status === "open" && !c.takenAt && !c.missed);
  return (
    <HubPage title="Warranty" subtitle="Claims on jobs your technicians did come to you first. Take one within 48 hours and send a technician; otherwise UniteFix sends its own. If the fault was workmanship or a part bought without a bill, the cost of the fix is charged to you.">
      {waiting.length > 0 && <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">{waiting.length} claim(s) waiting for you.</div>}
      <Panel>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !data?.length ? <Empty icon="verified" title="No warranty claims" /> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)]">{data.map(c => (
            <li key={c.id} className="grid gap-2 py-3 lg:grid-cols-[1fr_auto]">
              <div className="text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-white">{c.claimId}</span><span className="text-[hsl(215,20%,70%)]">job {c.serviceId} · {c.serviceType}</span>
                  <Chip tone={c.status === "resolved" ? "good" : c.missed ? "bad" : c.takenAt ? "info" : "warn"}>{c.status === "resolved" ? `resolved — ${(c.verdict ?? "").replace(/_/g, " ")}` : c.missed ? "missed — UniteFix handling" : c.takenAt ? `taken · ${c.technician ?? ""}` : `respond by ${when(c.respondBy)}`}</Chip>
                  {c.chargedRupees != null && <Chip tone="bad">charged {inr(c.chargedRupees)}</Chip>}</div>
                <p className="mt-1 text-white">{c.description}</p>
                <p className="mt-0.5 text-xs text-[hsl(215,20%,60%)]">{c.customerName}{c.customerPhone ? ` · ${c.customerPhone}` : ""}{c.address ? ` · ${c.address}` : ""}</p>
              </div>
              {hubCan(me, "ops:manage") && c.status === "open" && !c.takenAt && !c.missed && (
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <HubSelect aria-label={`Technician for ${c.claimId}`} value={pick[c.id] ?? ""} onChange={v => setPick({ ...pick, [c.id]: v })}><option value="">Send technician…</option>{ready.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}</HubSelect>
                  <Button size="sm" disabled={!pick[c.id]} onClick={() => take(c)}>Take it</Button>
                </div>
              )}
            </li>
          ))}</ul>
        )}
      </Panel>
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Earnings
// ═══════════════════════════════════════════════════════════════════════════

type Earnings = {
  held: number; released: number;
  jobs: Array<{ id: number; serviceId: string; technician: string | null; amount: number; status: string; releaseAt: string; completedAt: string | null }>;
  invoices: Array<{ id: number; number: string; periodFrom: string | null; total: number; issuedAt: string; docKind: string }>;
};

export function HubFieldEarnings() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Earnings>({ queryKey: ["/api/hub/field/earnings"], queryFn: async () => (await apiRequest("GET", "/api/hub/field/earnings")).data });
  return (
    <HubPage title="Field earnings" subtitle="Each job's value is held for 7 days (the dispute window), then added to what UniteFix owes you and paid at settlement. On cash jobs, the cash your technician kept is charged against it. Each month UniteFix generates your invoice to it for the work.">
      {isLoading || !data ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
            <Stat label="Held (dispute window)" value={inr(data.held)} />
            <Stat label="Released to your account" value={inr(data.released)} hint="see Money for settlements" />
            <Stat label="Jobs" value={data.jobs.length} />
          </div>
          <Panel title="Your monthly invoices to UniteFix">
            {!data.invoices.length ? <p className="text-sm text-[hsl(215,20%,60%)]">Generated at the start of each month for the month before.</p> : (
              <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">{data.invoices.map(d => (
                <li key={d.id} className="flex items-center gap-3 py-2"><span className="font-mono text-white">{d.number}</span><span className="text-[hsl(215,20%,70%)]">{d.periodFrom?.slice(0, 7)}</span><span className="ml-auto tabular-nums text-white">{inr(d.total)}</span>
                  <Button size="sm" variant="ghost" onClick={() => openAuthedPdf(`/api/hub/tax-documents/${d.id}/pdf`).catch(fail(toast, "Could not open"))}>PDF</Button></li>
              ))}</ul>
            )}
          </Panel>
          <Panel title="Jobs">
            {!data.jobs.length ? <Empty icon="handyman" title="No completed jobs yet" /> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
                <Thead cols={["Job", "Technician", "Completed", "Status", ["Value", "right"]]} />
                <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{data.jobs.map(j => (
                  <tr key={j.id}><td className="py-2 font-mono text-white">{j.serviceId}</td><td className="text-[hsl(215,20%,70%)]">{j.technician}</td><td className="text-[hsl(215,20%,70%)]">{when(j.completedAt)}</td>
                    <td><Chip tone={j.status === "released" ? "good" : j.status === "held" ? "warn" : "muted"}>{j.status === "held" ? `held until ${new Date(j.releaseAt).toLocaleDateString("en-IN")}` : j.status}</Chip></td>
                    <td className="text-right tabular-nums">{inr(j.amount)}</td></tr>
                ))}</tbody></table></div>
            )}
          </Panel>
        </>
      )}
    </HubPage>
  );
}

type FieldSettings = { hours: Array<{ weekday: number; startTime: string; endTime: string }> | null; autoAssign: boolean; autoAssignMinutes: number; holidays: Array<{ id: number; day: string; reason: string | null }>; assignWithinHours: number; assignWithinHoursUrgent: number };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Working hours and holidays (they pause the assign-by clock) and auto-assign. */
export function HubFieldSettings() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canSet = hubCan(me, "settings:manage");
  const { data } = useQuery<FieldSettings>({ queryKey: ["/api/hub/field/settings"], queryFn: async () => (await apiRequest("GET", "/api/hub/field/settings")).data });
  const [draft, setDraft] = useState<{ allDay: boolean; days: Array<{ open: boolean; start: string; end: string }>; auto: boolean; minutes: string } | null>(null);
  const [hol, setHol] = useState({ day: "", reason: "" });
  const d = draft ?? (data ? {
    allDay: !data.hours?.length,
    days: WEEKDAYS.map((_, i) => { const w = data.hours?.find(x => x.weekday === i); return { open: data.hours?.length ? !!w : i !== 0, start: w?.startTime ?? "09:00", end: w?.endTime ?? "19:00" }; }),
    auto: data.autoAssign, minutes: String(data.autoAssignMinutes),
  } : null);
  const done = (r: any) => { qc.setQueryData(["/api/hub/field/settings"], r.data); setDraft(null); toast({ title: r.message ?? "Saved" }); };
  const failed = (e: unknown) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" });
  const save = async () => {
    if (!d) return;
    try {
      done(await apiRequest("PUT", "/api/hub/field/settings", {
        hours: d.allDay ? null : d.days.map((x, i) => ({ weekday: i, startTime: x.start, endTime: x.end, open: x.open })).filter(x => x.open).map(({ open, ...w }) => w),
        autoAssign: d.auto, autoAssignMinutes: Number(d.minutes),
      }));
    } catch (e) { failed(e); }
  };
  const addHoliday = async () => { try { done(await apiRequest("POST", "/api/hub/field/holidays", { day: hol.day, reason: hol.reason || null })); setHol({ day: "", reason: "" }); } catch (e) { failed(e); } };
  const removeHoliday = async (id: number) => { try { done(await apiRequest("DELETE", `/api/hub/field/holidays/${id}`)); } catch (e) { failed(e); } };
  if (!d || !data) return <HubPage title="Hours & auto-assign"><p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p></HubPage>;
  const set = (patch: Partial<typeof d>) => setDraft({ ...d, ...patch });
  return (
    <HubPage title="Hours & auto-assign" subtitle={`Assign each job within ${data.assignWithinHours} working hour${data.assignWithinHours === 1 ? "" : "s"} (${data.assignWithinHoursUrgent} for urgent ones). The clock only runs in your working hours and stops on your holidays.`}
      actions={canSet ? <Button disabled={!draft} onClick={save}>Save</Button> : undefined}>
      <Panel title="Working hours">
        <label className="flex items-center gap-2 text-sm text-white"><input type="checkbox" disabled={!canSet} checked={d.allDay} onChange={e => set({ allDay: e.target.checked })} /> Round the clock, every day</label>
        {!d.allDay && <ul className="mt-3 grid gap-2">{d.days.map((x, i) => (
          <li key={i} className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex w-32 items-center gap-2 text-white"><input type="checkbox" disabled={!canSet} checked={x.open} onChange={e => set({ days: d.days.map((y, j) => j === i ? { ...y, open: e.target.checked } : y) })} />{WEEKDAYS[i]}</label>
            {x.open ? <>
              <Input aria-label={`${WEEKDAYS[i]} opens`} type="time" className="h-9 w-32" disabled={!canSet} value={x.start} onChange={e => set({ days: d.days.map((y, j) => j === i ? { ...y, start: e.target.value } : y) })} />
              <span className="text-[hsl(215,20%,60%)]">to</span>
              <Input aria-label={`${WEEKDAYS[i]} closes`} type="time" className="h-9 w-32" disabled={!canSet} value={x.end} onChange={e => set({ days: d.days.map((y, j) => j === i ? { ...y, end: e.target.value } : y) })} />
            </> : <span className="text-[hsl(215,20%,55%)]">closed</span>}
          </li>
        ))}</ul>}
        <p className="mt-3 text-xs text-[hsl(215,20%,55%)]">Times in IST. A job booked at night is due the next working morning.</p>
      </Panel>
      <Panel title="Auto-assign">
        <label className="flex items-center gap-2 text-sm text-white"><input type="checkbox" disabled={!canSet} checked={d.auto} onChange={e => set({ auto: e.target.checked })} /> Assign jobs automatically if nobody picks one</label>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[hsl(215,20%,75%)]">
          After <Input aria-label="Minutes before auto-assign" inputMode="numeric" className="h-9 w-20" disabled={!canSet || !d.auto} value={d.minutes} onChange={e => set({ minutes: e.target.value })} /> working minutes
        </div>
        <p className="mt-2 text-xs text-[hsl(215,20%,55%)]">Picks an active, verified technician whose trades match the job — online ones first, then whoever has the fewest open jobs. You are alerted and can reassign from Jobs. Use 0 to assign the moment a job arrives (checked every 15 minutes).</p>
      </Panel>
      <Panel title="Holidays">
        {!data.holidays.length ? <p className="text-sm text-[hsl(215,20%,65%)]">None coming up.</p> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">{data.holidays.map(h => (
            <li key={h.id} className="flex items-center gap-3 py-2"><span className="tabular-nums text-white">{new Date(`${h.day}T00:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</span><span className="flex-1 text-[hsl(215,20%,70%)]">{h.reason}</span>{canSet && <Button size="sm" variant="ghost" onClick={() => removeHoliday(h.id)}>Remove</Button>}</li>
          ))}</ul>
        )}
        {canSet && <div className="mt-3 flex flex-wrap items-end gap-2">
          <div><Label htmlFor="h-d">Date</Label><Input id="h-d" type="date" className="h-9 w-44" value={hol.day} onChange={e => setHol({ ...hol, day: e.target.value })} /></div>
          <div className="min-w-0 flex-1"><Label htmlFor="h-r">Reason (optional)</Label><Input id="h-r" className="h-9" placeholder="Diwali" value={hol.reason} onChange={e => setHol({ ...hol, reason: e.target.value })} /></div>
          <Button variant="outline" disabled={!hol.day} onClick={addHoliday}>Add holiday</Button>
        </div>}
      </Panel>
    </HubPage>
  );
}
