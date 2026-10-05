/**
 * Partner settlements — who UniteFix owes, and paying them.
 *
 * The worklist shows every active partner with money due, with any parts dues
 * offset explicitly. Draft a run to freeze the figures, then pay it: by hand
 * (enter the UTR of the transfer you made) or through Cashfree Payouts. Also
 * the monthly fee-invoice run and the one-off invoice backfill for orders
 * dispatched before GST invoicing existed.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { openAuthedPdf } from "@/lib/hub";
import { ListSearch, useListSearch } from "@/components/admin/ListSearch";

type Work = { businessPartnerId: number; partnerCode: string; displayName: string; bankReady: boolean; ftthOwed: number; b2bBalance: number; offset: number; payout: number; openRun: { id: number; runCode: string; status: string } | null };
type Run = { id: number; runCode: string; status: string; ftthOwed: number; b2bBalance: number; offset: number; payout: number; method: string | null; payoutReference: string | null; failureReason: string | null; createdAt: string; paidAt: string | null; partnerCode: string; displayName: string; businessPartnerId: number };

const rs = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE: Record<string, string> = {
  draft: "bg-amber-100 text-amber-900 hover:bg-amber-100", processing: "bg-sky-100 text-sky-900 hover:bg-sky-100",
  paid: "bg-emerald-100 text-emerald-900 hover:bg-emerald-100", failed: "bg-rose-100 text-rose-900 hover:bg-rose-100", cancelled: "bg-slate-100 text-slate-700 hover:bg-slate-100",
};

export default function PartnerSettlementsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const work = useQuery<Work[]>({ queryKey: ["/api/admin/hub/settlements/worklist"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/settlements/worklist")).data });
  const runs = useQuery<Run[]>({ queryKey: ["/api/admin/hub/settlements"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/settlements")).data });
  const search = useListSearch(runs.data, r => [r.runCode, r.partnerCode, r.displayName, r.status, r.payoutReference]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/admin/hub/settlements/worklist"] }); qc.invalidateQueries({ queryKey: ["/api/admin/hub/settlements"] }); };
  const act = useMutation({
    mutationFn: async (v: { path: string; body?: unknown }) => apiRequest("POST", v.path, v.body),
    onSuccess: (r: any) => { refresh(); toast({ title: "Done", description: r?.message }); },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const [utr, setUtr] = useState<Record<number, string>>({});
  const [month, setMonth] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); });
  const pdf = (url: string) => openAuthedPdf(url).catch(e => toast({ title: "Could not open", description: apiErrorMessage(e), variant: "destructive" }));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Partner Settlements</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Money UniteFix owes business partners — broadband recharges today; field service and store sales as those modules go live. Parts dues are offset on their own line; the rest is paid to the partner's verified bank account.</p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Due now</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Partner</TableHead><TableHead className="text-right">Owed to them</TableHead><TableHead className="text-right">Their parts dues</TableHead><TableHead className="text-right">Offset</TableHead><TableHead className="text-right">To pay</TableHead><TableHead>Bank</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {!work.isLoading && (work.data?.length ?? 0) === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Nobody is owed anything right now.</TableCell></TableRow>}
              {(work.data ?? []).map(w => (
                <TableRow key={w.businessPartnerId}>
                  <TableCell><b>{w.displayName}</b> <span className="font-mono text-xs text-muted-foreground">{w.partnerCode}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{rs(w.ftthOwed + Math.max(0, -w.b2bBalance))}</TableCell>
                  <TableCell className="text-right tabular-nums">{rs(Math.max(0, w.b2bBalance))}</TableCell>
                  <TableCell className="text-right tabular-nums">{w.offset ? rs(w.offset) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{rs(w.payout)}</TableCell>
                  <TableCell>{w.bankReady ? <Badge className={TONE.paid}>verified</Badge> : <Badge className={TONE.failed}>not verified</Badge>}</TableCell>
                  <TableCell className="text-right">{w.openRun ? <span className="text-xs text-muted-foreground">{w.openRun.runCode} · {w.openRun.status}</span> : <Button size="sm" onClick={() => act.mutate({ path: "/api/admin/hub/settlements", body: { businessPartnerId: w.businessPartnerId } })}>Draft settlement</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base font-medium">Settlement runs</CardTitle>
          <ListSearch value={search.q} onChange={search.setQ} placeholder="Run, partner, status, UTR…" className="w-72" />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Run</TableHead><TableHead>Partner</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Offset</TableHead><TableHead>Status</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {search.filtered.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">{search.active ? "No run matches." : "No settlement runs yet."}</TableCell></TableRow>}
              {search.filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.runCode}<div className="font-sans text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("en-IN")}</div></TableCell>
                  <TableCell>{r.displayName}</TableCell>
                  <TableCell className="text-right tabular-nums">{rs(r.payout)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.offset ? rs(r.offset) : "—"}</TableCell>
                  <TableCell><Badge className={TONE[r.status]}>{r.status}</Badge>{r.failureReason && <div className="mt-1 max-w-[220px] text-xs text-rose-700">{r.failureReason}</div>}</TableCell>
                  <TableCell className="text-xs">{r.payoutReference ?? "—"}{r.method ? ` · ${r.method}` : ""}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {(r.status === "draft" || r.status === "failed") && (
                        <>
                          <Input className="h-8 w-36" placeholder="UTR of your transfer" value={utr[r.id] ?? ""} onChange={e => setUtr({ ...utr, [r.id]: e.target.value })} />
                          <Button size="sm" disabled={r.payout > 0 && (utr[r.id] ?? "").trim().length < 4} onClick={() => act.mutate({ path: `/api/admin/hub/settlements/${r.id}/pay`, body: { method: "manual", reference: utr[r.id] ?? "" } })}>{r.payout > 0 ? "Mark paid" : "Apply offset"}</Button>
                          {r.status === "draft" && r.payout > 0 && <Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Send ${rs(r.payout)} to ${r.displayName} through Cashfree?`)) act.mutate({ path: `/api/admin/hub/settlements/${r.id}/pay`, body: { method: "cashfree" } }); }}>Pay via Cashfree</Button>}
                          {r.status === "draft" && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/api/admin/hub/settlements/${r.id}/cancel` })}>Cancel</Button>}
                        </>
                      )}
                      {r.status === "processing" && <Button size="sm" variant="outline" onClick={() => act.mutate({ path: `/api/admin/hub/settlements/${r.id}/sync` })}>Check status</Button>}
                      <Button size="sm" variant="ghost" onClick={() => pdf(`/api/admin/hub/settlements/${r.id}/pdf`)}>Statement</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Monthly fee invoices</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">Issued automatically on the 1st–3rd of each month: broadband lead fees (GST carved out of the amount already deducted) and the Hub Pro plan. Run a month by hand if needed — it never issues twice.</p>
            <div className="flex items-center gap-2"><Input type="month" className="h-9 w-44" value={month} onChange={e => setMonth(e.target.value)} /><Button onClick={() => act.mutate({ path: "/api/admin/hub/fee-invoices/run", body: { month } })}>Run for {month}</Button></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Parts invoices for earlier orders</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">Every parts order now gets its GST invoice at dispatch. Orders dispatched before that have none; this issues them now, noted as issued after dispatch.</p>
            <Button variant="outline" onClick={() => { if (window.confirm("Issue tax invoices for every dispatched order that has none?")) act.mutate({ path: "/api/admin/hub/b2b-invoices/backfill" }); }}>Issue missing invoices</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
