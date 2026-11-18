/**
 * Safety desk (server/services/safety.service.ts): SOS, help requests and
 * reports about behaviour, from trips and home-service visits. Critical first.
 * Pick a case up, call the person, then close it with what was done.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Phone, MapPin, Radio, ShieldAlert, LifeBuoy, Flag, Clock, ExternalLink, UserX } from "lucide-react";
import { REPORT_CATEGORIES, HELP_CATEGORIES, SAFETY_ACTIONS, SAFETY_ACTION_LABEL, RESPONSE_LABEL, STRIKES_TO_REMOVE, type Severity, type SafetyAction } from "@shared/safety";

type Incident = {
  id: number; code: string; kind: "sos" | "report" | "help"; severity: Severity; category: string | null; context: "trip" | "service";
  tripId: number | null; tripCode: string | null; bookingRef: string | null; reporterName: string | null; reporterPhone: string | null;
  managerName: string | null; managerPhone: string | null; subject: { type: string; name: string | null; employeeId?: number | null; phone?: string | null } | null;
  description: string | null; lat: number | null; lng: number | null; live: boolean; liveUrl: string | null; pings: number; lastPingAt: string | null;
  status: "open" | "acknowledged" | "resolved"; escalatedAt: string | null; acknowledgedAt: string | null; resolvedAt: string | null; action: SafetyAction | null; note: string | null;
  paused: Record<string, unknown> | null; strikes: number; dueAt: string; createdAt: string;
};

const SEV: Record<Severity, string> = {
  critical: "bg-red-500/20 text-red-200 border-red-500/40", high: "bg-amber-500/15 text-amber-200 border-amber-500/40", medium: "bg-sky-500/15 text-sky-200 border-sky-500/30",
};
const KIND = { sos: { label: "SOS", Icon: Radio }, report: { label: "Report", Icon: Flag }, help: { label: "Help", Icon: LifeBuoy } } as const;
const field = "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white";
const select = "h-10 w-full rounded-md border border-[rgba(255,255,255,0.08)] bg-[hsl(222,47%,11%)] px-3 text-sm text-white";
const ago = (d: string | null) => {
  if (!d) return "";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : new Date(d).toLocaleDateString("en-IN");
};
const categoryLabel = (i: Incident) => i.kind === "sos" ? "SOS pressed" : ((REPORT_CATEGORIES as any)[i.category ?? ""] ?? (HELP_CATEGORIES as any)[i.category ?? ""])?.label ?? i.category ?? "";

function Card({ i, onDone }: { i: Incident; onDone: () => void }) {
  const { toast } = useToast();
  const [action, setAction] = useState<SafetyAction>(i.paused && Object.keys(i.paused).length ? "clear" : "none");
  const [note, setNote] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const ack = useMutation({ mutationFn: async () => apiRequest("POST", `/api/admin/safety/incidents/${i.id}/acknowledge`, {}), onSuccess: (r: any) => { toast({ title: r?.message }); onDone(); }, onError: (e) => toast({ title: "Not picked up", description: apiErrorMessage(e), variant: "destructive" }) });
  const resolve = useMutation({ mutationFn: async () => apiRequest("POST", `/api/admin/safety/incidents/${i.id}/resolve`, { action, note }), onSuccess: (r: any) => { toast({ title: r?.message }); onDone(); }, onError: (e) => toast({ title: "Not closed", description: apiErrorMessage(e), variant: "destructive" }) });
  const K = KIND[i.kind];
  const overdue = i.status === "open" && new Date(i.dueAt).getTime() < now;
  const where = i.context === "trip" ? `Trip ${i.tripCode ?? "?"}` : `Booking ${i.bookingRef ?? "?"}`;
  return (
    <li className={`rounded-2xl border p-4 ${i.status === "open" && i.severity === "critical" ? "border-red-500/60 bg-red-500/[0.07]" : "border-white/10 bg-white/[0.03]"}`} data-testid={`incident-${i.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEV[i.severity]}`}><K.Icon className="h-3.5 w-3.5" />{K.label} · {i.severity}</span>
        <span className="font-mono text-sm text-slate-300">{i.code}</span>
        <span className="font-semibold text-white">{categoryLabel(i)}</span>
        <span className="text-sm text-slate-400">{where} · {ago(i.createdAt)}</span>
        {i.status === "open" && <span className={`ml-auto inline-flex items-center gap-1 text-xs ${overdue ? "text-red-300" : "text-amber-200"}`}><Clock className="h-3.5 w-3.5" />{overdue ? "Overdue: " : ""}{RESPONSE_LABEL[i.severity]}</span>}
        {i.status === "acknowledged" && <span className="ml-auto text-xs text-sky-300">Picked up {ago(i.acknowledgedAt)}</span>}
        {i.status === "resolved" && <span className="ml-auto text-xs text-emerald-300">Closed {ago(i.resolvedAt)}: {i.action ? SAFETY_ACTION_LABEL[i.action] : ""}</span>}
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="min-w-0 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            {i.reporterPhone && <a href={`tel:+91${String(i.reporterPhone).slice(-10)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-white hover:bg-white/5"><Phone className="h-4 w-4" />{i.reporterName ?? "Customer"} · {String(i.reporterPhone).slice(-10)}</a>}
            {i.managerPhone && <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-slate-300">Manager {i.managerName} · {i.managerPhone}</span>}
          </div>
          {i.subject?.name && (
            <p className="flex items-center gap-1.5 text-slate-200"><UserX className="h-4 w-4 text-slate-400" />About: <b>{i.subject.name}</b> <span className="text-slate-400">({i.subject.type}{i.subject.phone ? `, ${i.subject.phone}` : ""})</span>
              {i.strikes > 0 && <span className="rounded-full bg-amber-500/20 px-2 text-xs text-amber-200">{i.strikes} strike{i.strikes === 1 ? "" : "s"} of {STRIKES_TO_REMOVE}</span>}
            </p>
          )}
          {i.paused && Object.keys(i.paused).length > 0 && i.status !== "resolved" && <p className="text-xs text-red-200">Paused from new jobs until this case is closed.</p>}
          {i.description && <p className="rounded-lg bg-white/[0.04] p-3 text-slate-200">“{i.description}”</p>}
          <div className="flex flex-wrap gap-3 text-xs">
            {i.lat != null && i.lng != null && <a className="inline-flex items-center gap-1 text-sky-300 underline" href={`https://maps.google.com/?q=${i.lat},${i.lng}`} target="_blank" rel="noreferrer"><MapPin className="h-3.5 w-3.5" />Location on the map</a>}
            {i.liveUrl && <a className="inline-flex items-center gap-1 text-sky-300 underline" href={i.liveUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />{i.live ? "Live location (sharing now)" : "Location page"}</a>}
            {i.pings > 0 && <span className="text-slate-400">{i.pings} location update{i.pings === 1 ? "" : "s"}, last {ago(i.lastPingAt)}</span>}
            {i.escalatedAt && <span className="text-red-300">Escalated to the safety lead {ago(i.escalatedAt)}</span>}
          </div>
          {i.note && <p className="text-xs text-slate-400">Outcome: {i.note}</p>}
        </div>
        {i.status !== "resolved" && (
          <div className="space-y-2">
            {i.status === "open" && <Button className="w-full bg-red-600 hover:bg-red-500" onClick={() => ack.mutate()} disabled={ack.isPending}>Pick up: I'm calling them</Button>}
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <select aria-label="Outcome" className={select} value={action} onChange={(e) => setAction(e.target.value as SafetyAction)}>
                {SAFETY_ACTIONS.map((a) => <option key={a} value={a}>{SAFETY_ACTION_LABEL[a]}</option>)}
              </select>
              <Input aria-label="What was done" className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened and what you did" />
            </div>
            <Button variant="outline" className="w-full" onClick={() => resolve.mutate()} disabled={resolve.isPending || note.trim().length < 3}>Close the case</Button>
          </div>
        )}
      </div>
    </li>
  );
}

export default function SafetyDeskPage() {
  const [status, setStatus] = useState("open");
  const [kind, setKind] = useState("");
  const qs = useMemo(() => new URLSearchParams({ ...(status ? { status } : {}), ...(kind ? { kind } : {}) }).toString(), [status, kind]);
  const { data, isLoading } = useQuery<{ alarm: { critical: unknown[]; open: number }; incidents: Incident[] }>({
    queryKey: ["/api/admin/safety/incidents", qs],
    queryFn: async () => (await apiRequest("GET", `/api/admin/safety/incidents?${qs}`)).data,
    refetchInterval: 15_000,
  });
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/safety/incidents"] }); queryClient.invalidateQueries({ queryKey: ["/api/admin/safety/alarm"] }); };
  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm ${on ? "border-sky-400/50 bg-sky-500/15 text-white" : "border-white/10 text-slate-300 hover:bg-white/5"}`;
  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><ShieldAlert className="h-6 w-6 text-red-400" />Safety desk</h1>
        <p className="max-w-3xl text-sm text-slate-400">SOS, help requests and reports about drivers, hosts, guides and service experts. Critical cases: call within 5 minutes; nobody picking up in 2 minutes alerts the safety lead. A critical report pauses the person from new jobs until you close the case.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        {[["open", "Open"], ["acknowledged", "Picked up"], ["resolved", "Closed"], ["", "All"]].map(([k, l]) => <button key={l} type="button" aria-pressed={status === k} className={chip(status === k)} onClick={() => setStatus(k)}>{l}{k === "open" && data?.alarm.open ? <span className="ml-1.5 text-xs text-slate-400">{data.alarm.open}</span> : null}</button>)}
        <span className="mx-1 w-px bg-white/10" />
        {[["", "Everything"], ["sos", "SOS"], ["report", "Reports"], ["help", "Help"]].map(([k, l]) => <button key={l} type="button" aria-pressed={kind === k} className={chip(kind === k)} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      {isLoading ? <p className="text-sm text-slate-400">Loading…</p> : !data?.incidents.length ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-slate-400">Nothing here. Cases appear when a customer presses SOS, asks for help on a trip, or reports someone.</div>
      ) : <ul className="space-y-3">{data.incidents.map((i) => <Card key={i.id} i={i} onDone={refresh} />)}</ul>}
      <p className="text-xs text-slate-500"><Label className="text-xs text-slate-500">Outcomes:</Label> Warning, Strike ({STRIKES_TO_REMOVE} in 6 months suspends), Suspend, Ban, or Cleared to lift a pause. Every outcome is in the audit trail.</p>
    </div>
  );
}
