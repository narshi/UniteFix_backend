/**
 * Partner territories — pincodes partners serve with their own technicians.
 *
 * Approve proposed pincodes (a new pincode becomes serviceable in the same
 * step), set exclusive/shared, pause; review partners' rate changes; run the
 * partners' monthly invoices to UniteFix for field work.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { ListSearch, useListSearch } from "@/components/admin/ListSearch";

type Territory = { id: number; pincode: string; mode: string; status: string; area: string | null; proposedDistrict: string | null; partnerName: string; partnerCode: string; serviceable: boolean; proposedAt: string; pausedReason: string | null };
type Rate = { id: number; partnerName: string; partnerCode: string; serviceName: string; nationalPrice: number; price: number; effectiveFrom: string; submittedAt: string };

const TONE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-900 hover:bg-emerald-100", proposed: "bg-amber-100 text-amber-900 hover:bg-amber-100",
  paused: "bg-slate-100 text-slate-700 hover:bg-slate-100", withdrawn: "bg-slate-100 text-slate-500 hover:bg-slate-100", rejected: "bg-rose-100 text-rose-900 hover:bg-rose-100",
};

export default function PartnerTerritoriesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const terr = useQuery<Territory[]>({ queryKey: ["/api/admin/hub/territories"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/territories")).data });
  const rates = useQuery<Rate[]>({ queryKey: ["/api/admin/hub/rates/pending"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/rates/pending")).data });
  const act = useMutation({
    mutationFn: async (v: { method?: string; path: string; body?: unknown }) => apiRequest(v.method ?? "POST", v.path, v.body),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ["/api/admin/hub/territories"] }); qc.invalidateQueries({ queryKey: ["/api/admin/hub/rates/pending"] }); toast({ title: "Done", description: r?.message }); },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const proposed = useMemo(() => (terr.data ?? []).filter(t => t.status === "proposed"), [terr.data]);
  const others = useMemo(() => (terr.data ?? []).filter(t => t.status !== "proposed"), [terr.data]);
  const search = useListSearch(others, t => [t.pincode, t.partnerName, t.partnerCode, t.area, t.status, t.mode]);
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const [mode, setMode] = useState<"" | "exclusive" | "shared">("");
  const ids = proposed.filter(t => sel[t.id]).map(t => t.id);
  const [rateSel, setRateSel] = useState<Record<number, boolean>>({});
  const rateIds = (rates.data ?? []).filter(r => rateSel[r.id]).map(r => r.id);
  const [month, setMonth] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Partner Territories</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Bookings in a partner's active pincodes go to that partner's own queue; if they are not assigned in time they appear in the assignment queue marked "from partner". Approving a pincode UniteFix has never served makes it serviceable at once.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base font-medium">Proposed pincodes ({proposed.length})</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Mode on approval" className="h-9 rounded-md border px-2 text-sm" value={mode} onChange={e => setMode(e.target.value as any)}>
              <option value="">Mode: automatic (exclusive if new)</option><option value="exclusive">Exclusive</option><option value="shared">Shared</option>
            </select>
            <Button size="sm" disabled={!ids.length} onClick={() => act.mutate({ path: "/api/admin/hub/territories/review", body: { ids, decision: "approve", ...(mode ? { mode } : {}) } })}>Approve {ids.length || ""}</Button>
            <Button size="sm" variant="outline" disabled={!ids.length} onClick={() => { const note = window.prompt("Reason (shown to the partner)"); if (note !== null) act.mutate({ path: "/api/admin/hub/territories/review", body: { ids, decision: "reject", note } }); }}>Reject</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="w-10"><input type="checkbox" aria-label="Select all" checked={proposed.length > 0 && ids.length === proposed.length} onChange={e => setSel(Object.fromEntries(proposed.map(t => [t.id, e.target.checked])))} /></TableHead><TableHead>Pincode</TableHead><TableHead>Partner</TableHead><TableHead>Area</TableHead><TableHead>UniteFix serves it today</TableHead><TableHead>Proposed</TableHead></TableRow></TableHeader>
            <TableBody>
              {!proposed.length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No proposals waiting.</TableCell></TableRow>}
              {proposed.map(t => (
                <TableRow key={t.id}>
                  <TableCell><input type="checkbox" aria-label={`Select ${t.pincode}`} checked={!!sel[t.id]} onChange={e => setSel({ ...sel, [t.id]: e.target.checked })} /></TableCell>
                  <TableCell className="font-mono">{t.pincode}</TableCell>
                  <TableCell>{t.partnerName} <span className="font-mono text-xs text-muted-foreground">{t.partnerCode}</span></TableCell>
                  <TableCell>{[t.area, t.proposedDistrict].filter(Boolean).join(", ") || "—"}</TableCell>
                  <TableCell>{t.serviceable ? <Badge className={TONE.active}>yes — default shared</Badge> : <Badge className={TONE.proposed}>no — default exclusive</Badge>}</TableCell>
                  <TableCell className="text-xs">{new Date(t.proposedAt).toLocaleDateString("en-IN")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base font-medium">Rate changes to review ({rates.data?.length ?? 0})</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" disabled={!rateIds.length} onClick={() => act.mutate({ path: "/api/admin/hub/rates/review", body: { ids: rateIds, approve: true } })}>Approve {rateIds.length || ""}</Button>
            <Button size="sm" variant="outline" disabled={!rateIds.length} onClick={() => { const note = window.prompt("Reason (shown to the partner)"); if (note !== null) act.mutate({ path: "/api/admin/hub/rates/review", body: { ids: rateIds, approve: false, note } }); }}>Reject</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="w-10" /><TableHead>Partner</TableHead><TableHead>Service</TableHead><TableHead className="text-right">National</TableHead><TableHead className="text-right">Proposed</TableHead><TableHead className="text-right">Change</TableHead><TableHead>From</TableHead></TableRow></TableHeader>
            <TableBody>
              {!(rates.data ?? []).length && <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Nothing to review.</TableCell></TableRow>}
              {(rates.data ?? []).map(r => (
                <TableRow key={r.id}>
                  <TableCell><input type="checkbox" aria-label={`Select rate ${r.id}`} checked={!!rateSel[r.id]} onChange={e => setRateSel({ ...rateSel, [r.id]: e.target.checked })} /></TableCell>
                  <TableCell>{r.partnerName}</TableCell><TableCell>{r.serviceName}</TableCell>
                  <TableCell className="text-right tabular-nums">₹{r.nationalPrice}</TableCell><TableCell className="text-right tabular-nums font-medium">₹{r.price}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.price > r.nationalPrice ? "text-rose-700" : "text-emerald-700"}`}>{r.price >= r.nationalPrice ? "+" : ""}{Math.round((r.price - r.nationalPrice) / r.nationalPrice * 100)}%</TableCell>
                  <TableCell className="text-xs">{new Date(r.effectiveFrom).toLocaleString("en-IN")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base font-medium">All territories</CardTitle>
          <ListSearch value={search.q} onChange={search.setQ} placeholder="Pincode, partner, status…" className="w-72" />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Pincode</TableHead><TableHead>Partner</TableHead><TableHead>Area</TableHead><TableHead>Status</TableHead><TableHead>Mode</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {!search.filtered.length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">{search.active ? "Nothing matches." : "No territories yet."}</TableCell></TableRow>}
              {search.filtered.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono">{t.pincode}</TableCell>
                  <TableCell>{t.partnerName}</TableCell>
                  <TableCell>{t.area ?? "—"}</TableCell>
                  <TableCell><Badge className={TONE[t.status]}>{t.status}</Badge>{t.pausedReason && <span className="ml-2 text-xs text-muted-foreground">{t.pausedReason}</span>}</TableCell>
                  <TableCell>{t.mode}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {["active", "paused"].includes(t.status) && <Button size="sm" variant="ghost" onClick={() => act.mutate({ method: "PATCH", path: `/api/admin/hub/territories/${t.id}`, body: { mode: t.mode === "exclusive" ? "shared" : "exclusive" } })}>Make {t.mode === "exclusive" ? "shared" : "exclusive"}</Button>}
                      {t.status === "active" && <Button size="sm" variant="ghost" onClick={() => { const note = window.prompt("Why pause?"); if (note !== null) act.mutate({ method: "PATCH", path: `/api/admin/hub/territories/${t.id}`, body: { status: "paused", note } }); }}>Pause</Button>}
                      {t.status === "paused" && <Button size="sm" variant="ghost" onClick={() => act.mutate({ method: "PATCH", path: `/api/admin/hub/territories/${t.id}`, body: { status: "active" } })}>Resume</Button>}
                      {["active", "paused"].includes(t.status) && <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => { if (window.confirm(`Withdraw ${t.pincode} from ${t.partnerName}? New bookings go to UniteFix.`)) act.mutate({ method: "PATCH", path: `/api/admin/hub/territories/${t.id}`, body: { status: "withdrawn" } }); }}>Withdraw</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Partners' monthly invoices for field work</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">Generated automatically on the 1st–3rd for the month before: each partner's invoice to UniteFix for the jobs its technicians completed (subcontract), with GST on top for registered partners. Run a month by hand if needed — it never issues twice.</p>
          <div className="flex items-center gap-2"><Input type="month" className="h-9 w-44" value={month} onChange={e => setMonth(e.target.value)} /><Button onClick={() => act.mutate({ path: "/api/admin/hub/subcontract-invoices/run", body: { month } })}>Run for {month}</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}
