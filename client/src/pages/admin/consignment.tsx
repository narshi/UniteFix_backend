/**
 * Partners' consignment stock: offers to receive into the warehouse, lots on
 * the shelf, and unsold stock to send back.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

type Lot = { id: number; partner: string; partName: string | null; partCode: string | null; tradePrice: number | null; offered: number; received: number; sold: number; returned: number; inStock: number; unitPayout: number; status: string; notes: string | null; createdAt: string };

export default function ConsignmentPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const lots = useQuery<Lot[]>({ queryKey: ["/api/admin/hub/consignment"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/consignment")).data });
  const [qty, setQty] = useState<Record<number, string>>({});
  const act = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) => apiRequest("POST", path, body ?? {}),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ["/api/admin/hub/consignment"] }); toast({ title: "Done", description: r?.message }); },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const offers = (lots.data ?? []).filter(l => l.status === "proposed");
  const shelf = (lots.data ?? []).filter(l => l.status === "received");
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Consignment stock</h1>
        <p className="text-sm text-muted-foreground">Partners' parts held on sale-or-return. Consigned units leave the warehouse first (B2B sales, technician kits, write-offs); the partner is credited its price per unit at once and invoices UniteFix monthly. Receiving books the stock in at the partner's price.</p>
      </div>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Offers waiting for stock ({offers.length})</CardTitle></CardHeader>
        <CardContent className="p-0"><div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Partner</TableHead><TableHead>Part</TableHead><TableHead className="text-right">Offered</TableHead><TableHead className="text-right">Their price / UniteFix trade price</TableHead><TableHead>Received</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {!offers.length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No offers.</TableCell></TableRow>}
            {offers.map(l => (
              <TableRow key={l.id}>
                <TableCell>{l.partner}</TableCell>
                <TableCell>{l.partName}<span className="block font-mono text-xs text-muted-foreground">{l.partCode}</span>{l.notes && <span className="block text-xs text-muted-foreground">{l.notes}</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{l.offered}</TableCell>
                <TableCell className="text-right tabular-nums">₹{l.unitPayout} / {l.tradePrice != null ? `₹${l.tradePrice}` : "—"}</TableCell>
                <TableCell><Input aria-label={`Quantity received for lot ${l.id}`} className="h-8 w-20" inputMode="numeric" value={qty[l.id] ?? String(l.offered)} onChange={e => setQty({ ...qty, [l.id]: e.target.value.replace(/\D/g, "") })} /></TableCell>
                <TableCell className="space-x-1 whitespace-nowrap text-right">
                  <Button size="sm" onClick={() => act.mutate({ path: `/api/admin/hub/consignment/${l.id}/receive`, body: { quantity: Number(qty[l.id] ?? l.offered) } })}>Receive</Button>
                  <Button size="sm" variant="ghost" onClick={() => { const note = window.prompt("Why reject? The partner sees this."); if (note && note.trim().length >= 3) act.mutate({ path: `/api/admin/hub/consignment/${l.id}/reject`, body: { note } }); }}>Reject</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></div></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base font-medium">On the shelf ({shelf.reduce((a, l) => a + l.inStock, 0)} units)</CardTitle></CardHeader>
        <CardContent className="p-0"><div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Partner</TableHead><TableHead>Part</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Left</TableHead><TableHead className="text-right">Price</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {!shelf.length && <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Nothing on consignment.</TableCell></TableRow>}
            {shelf.map(l => (
              <TableRow key={l.id}>
                <TableCell>{l.partner}</TableCell>
                <TableCell>{l.partName}<span className="block font-mono text-xs text-muted-foreground">{l.partCode}</span></TableCell>
                <TableCell className="text-right tabular-nums">{l.received}</TableCell>
                <TableCell className="text-right tabular-nums">{l.sold}</TableCell>
                <TableCell className="text-right tabular-nums">{l.inStock > 0 ? l.inStock : <Badge variant="secondary">sold out</Badge>}</TableCell>
                <TableCell className="text-right tabular-nums">₹{l.unitPayout}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Send the ${l.inStock} unsold unit(s) back to ${l.partner} and close the lot?`)) act.mutate({ path: `/api/admin/hub/consignment/${l.id}/return`, body: {} }); }}>Return unsold</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></div></CardContent>
      </Card>
    </div>
  );
}
