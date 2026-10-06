/**
 * Marketplace — partner sellers in the UniteFix store: listings to review,
 * orders past their dispatch deadline, commission by category, the TCS/TDS
 * working for GSTR-8 and 26Q, and settling delivered orders now.
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
import { downloadAuthed } from "@/lib/hub";

type Pending = { id: number; name: string; sellerName: string; sellerCode: string; categoryName: string | null; price: number; mrp: number | null; hsnCode: string | null; gstPercent: number | null; countryOfOrigin: string | null; manufacturer: string | null; bisNumber: string | null; wpcEta: string | null; images: string[]; description: string | null; submittedAt: string | null };
type Late = { id: number; code: string; seller: string; status: string; total: number; createdAt: string };
type Rate = { categoryId: number; name: string; percent: number | null; minRupees: number | null };

export default function MarketplacePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pending = useQuery<Pending[]>({ queryKey: ["/api/admin/hub/store/listings/pending"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/store/listings/pending")).data });
  const late = useQuery<Late[]>({ queryKey: ["/api/admin/hub/store/late"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/store/late")).data });
  const rates = useQuery<Rate[]>({ queryKey: ["/api/admin/hub/store/commission"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/store/commission")).data });
  const act = useMutation({
    mutationFn: async (v: { method?: string; path: string; body?: unknown }) => apiRequest(v.method ?? "POST", v.path, v.body),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ["/api/admin/hub/store"] }); ["listings/pending", "late", "commission"].forEach(k => qc.invalidateQueries({ queryKey: [`/api/admin/hub/store/${k}`] })); toast({ title: "Done", description: r?.message }); },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const ids = (pending.data ?? []).filter(p => sel[p.id]).map(p => p.id);
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [month, setMonth] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Marketplace</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Partners selling their own products in the UniteFix store. The app's Shop is still "Coming Soon" (AI_CONTEXT §3.K); everything here is ready for when it opens. New sellers' listings are checked here before going live — check MRP ≥ price, HSN, origin, manufacturer, and BIS/WPC where the product needs them.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base font-medium">Listings to review ({pending.data?.length ?? 0})</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" disabled={!ids.length} onClick={() => act.mutate({ path: "/api/admin/hub/store/listings/review", body: { ids, approve: true } })}>Approve {ids.length || ""}</Button>
            <Button size="sm" variant="outline" disabled={!ids.length} onClick={() => { const reason = window.prompt("Why? The seller sees this."); if (reason) act.mutate({ path: "/api/admin/hub/store/listings/review", body: { ids, approve: false, reason } }); }}>Reject</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="w-10" /><TableHead>Product</TableHead><TableHead>Seller</TableHead><TableHead className="text-right">Price / MRP</TableHead><TableHead>HSN · GST</TableHead><TableHead>Origin · maker</TableHead><TableHead>BIS / WPC</TableHead></TableRow></TableHeader>
            <TableBody>
              {!(pending.data ?? []).length && <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Nothing to review.</TableCell></TableRow>}
              {(pending.data ?? []).map(p => (
                <TableRow key={p.id}>
                  <TableCell><input type="checkbox" aria-label={`Select ${p.name}`} checked={!!sel[p.id]} onChange={e => setSel({ ...sel, [p.id]: e.target.checked })} /></TableCell>
                  <TableCell><div className="flex items-center gap-2">{p.images[0] && <img src={p.images[0]} alt="" className="h-9 w-9 rounded object-cover" />}<div><b>{p.name}</b><div className="max-w-[260px] truncate text-xs text-muted-foreground">{p.categoryName} · {p.description}</div></div></div></TableCell>
                  <TableCell>{p.sellerName} <span className="font-mono text-xs text-muted-foreground">{p.sellerCode}</span></TableCell>
                  <TableCell className={`text-right tabular-nums ${p.mrp != null && p.price > p.mrp ? "text-rose-700" : ""}`}>₹{p.price} / ₹{p.mrp ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{p.hsnCode} · {p.gstPercent}%</TableCell>
                  <TableCell className="text-xs">{p.countryOfOrigin} · {p.manufacturer}</TableCell>
                  <TableCell className="text-xs">{p.bisNumber ?? "—"} / {p.wpcEta ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Past the dispatch deadline ({late.data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Seller</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Placed</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {!(late.data ?? []).length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Every order is within its deadline.</TableCell></TableRow>}
              {(late.data ?? []).map(o => (
                <TableRow key={o.id}><TableCell className="font-mono text-xs">{o.code}</TableCell><TableCell>{o.seller}</TableCell><TableCell><Badge variant="secondary">{o.status}</Badge></TableCell><TableCell className="text-right tabular-nums">₹{o.total}</TableCell><TableCell className="text-xs">{new Date(o.createdAt).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Cancel ${o.code} and refund the customer? It counts against the seller.`)) act.mutate({ path: `/api/admin/hub/store/orders/${o.id}/cancel`, body: { reason: "Not dispatched in time" } }); }}>Cancel & refund</Button></TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Commission by category</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">On the pre-tax item price, never on GST. Blank uses the platform default (BUSINESS_CONFIG.MARKETPLACE_COMMISSION_PERCENT). Preferred sellers pay 2 points less.</p>
            <ul className="divide-y">{(rates.data ?? []).map(r => (
              <li key={r.categoryId} className="flex items-center gap-2 py-1.5"><span className="flex-1">{r.name}</span>
                <Input aria-label={`Commission for ${r.name}`} className="h-8 w-20" inputMode="decimal" placeholder="default" value={edit[r.categoryId] ?? (r.percent == null ? "" : String(r.percent))} onChange={e => setEdit({ ...edit, [r.categoryId]: e.target.value })} /><span>%</span>
                <Button size="sm" variant="ghost" disabled={edit[r.categoryId] === undefined} onClick={() => act.mutate({ method: "PUT", path: `/api/admin/hub/store/commission/${r.categoryId}`, body: { percent: edit[r.categoryId] === "" ? null : Number(edit[r.categoryId]) } })}>Save</Button></li>
            ))}</ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Tax collected and deducted</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">As e-commerce operator UniteFix collects GST TCS (s.52, GSTR-8) and deducts TDS (s.194-O) on orders as they settle. This is the per-seller working for the month. Rates are configurable — confirm them with the CA.</p>
            <div className="flex items-center gap-2"><Input type="month" className="h-9 w-44" value={month} onChange={e => setMonth(e.target.value)} />
              <Button variant="outline" onClick={() => downloadAuthed(`/api/admin/hub/store/tcs.csv?month=${month}`, `store-tcs-tds-${month}.csv`).catch(e => toast({ title: "Could not download", description: apiErrorMessage(e), variant: "destructive" }))}>Download CSV</Button></div>
            <p className="text-muted-foreground">Delivered orders settle automatically after their return window. To run it now:</p>
            <Button variant="outline" onClick={() => act.mutate({ path: "/api/admin/hub/store/settle" })}>Settle due orders now</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
