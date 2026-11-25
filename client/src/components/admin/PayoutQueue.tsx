/**
 * Payouts waiting for a person: partners who asked to be paid, and scheduled
 * payouts above a partner's automatic limit. Pay through Cashfree or decline
 * with a reason the partner sees.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

type Item = { kind: "request" | "draft"; id: number; businessPartnerId: number; partner: string; code: string; owed: number | null; note: string | null; at: string; origin?: string };

export default function PayoutQueue() {
    const { toast } = useToast();
    const qc = useQueryClient();
    const { data = [] } = useQuery<Item[]>({ queryKey: ["/api/admin/hub/payouts/queue"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/payouts/queue")).data });
    const [declining, setDeclining] = useState<{ id: number; note: string } | null>(null);
    const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/admin/hub/payouts/queue"] }); qc.invalidateQueries({ queryKey: ["/api/admin/hub/settlements"] }); qc.invalidateQueries({ queryKey: ["/api/admin/hub/settlements/worklist"] }); };
    const pay = useMutation({
        mutationFn: async (bpId: number) => apiRequest("POST", `/api/admin/hub/partners/${bpId}/payouts/pay-now`, { method: "cashfree" }),
        onSuccess: (r: any) => { toast({ title: r?.message ?? "Paid" }); refresh(); },
        onError: (e) => toast({ title: "Not paid", description: apiErrorMessage(e), variant: "destructive" }),
    });
    const decline = useMutation({
        mutationFn: async () => apiRequest("POST", `/api/admin/hub/payouts/requests/${declining!.id}/decline`, { note: declining!.note }),
        onSuccess: () => { toast({ title: "Declined; the partner is told why" }); setDeclining(null); refresh(); },
        onError: (e) => toast({ title: "Not declined", description: apiErrorMessage(e), variant: "destructive" }),
    });
    if (!data.length) return null;
    return (
        <Card>
            <CardHeader><CardTitle className="text-base">Waiting for approval ({data.length})</CardTitle></CardHeader>
            <CardContent className="divide-y p-0">
                {data.map((i) => (
                    <div key={`${i.kind}-${i.id}`} className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">
                        <Badge variant="secondary" className={i.kind === "request" ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900"}>{i.kind === "request" ? "Asked to be paid" : "Scheduled, above limit"}</Badge>
                        <span className="font-medium">{i.partner}</span><span className="font-mono text-xs text-muted-foreground">{i.code}</span>
                        {i.note && <span className="text-xs text-muted-foreground">"{i.note}"</span>}
                        <span className="ml-auto font-semibold">₹{(i.owed ?? 0).toLocaleString("en-IN")}</span>
                        <Button size="sm" disabled={pay.isPending} onClick={() => pay.mutate(i.businessPartnerId)}>Pay through Cashfree</Button>
                        {i.kind === "request" && <Button size="sm" variant="ghost" onClick={() => setDeclining({ id: i.id, note: "" })}>Decline</Button>}
                        {declining?.id === i.id && i.kind === "request" && (
                            <div className="flex w-full gap-2">
                                <Input placeholder="Why (the partner sees this)" value={declining.note} onChange={(e) => setDeclining({ ...declining, note: e.target.value })} />
                                <Button size="sm" variant="destructive" disabled={declining.note.trim().length < 3 || decline.isPending} onClick={() => decline.mutate()}>Decline</Button>
                            </div>
                        )}
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
