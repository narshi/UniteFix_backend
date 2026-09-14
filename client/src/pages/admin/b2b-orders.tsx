/**
 * B2B orders — business partners buying from UniteFix stock.
 *
 * The queue is what needs a person: a paid order waiting to be confirmed, a
 * confirmed one waiting to be packed and sent. Stock leaves the warehouse on
 * DISPATCH, so the dispatch button is the one that moves inventory.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { format } from "date-fns";
import { ShoppingCart, Truck, PackageCheck, CheckCircle2, XCircle, Undo2 } from "lucide-react";

type Row = {
    id: number; orderCode: string; status: string; paymentMode: string; paymentStatus: string; total: number | null;
    placedAt: string | null; partnerCode: string; partnerName: string; ageHours: number | null;
};
type Detail = {
    id: number; orderCode: string; status: string; paymentMode: string; paymentStatus: string;
    subtotal: number | null; gst: number | null; total: number | null; deliveryAddress: any; deliveryContact: any; notes: string | null; cancelReason: string | null;
    placedAt: string | null; partner: { code: string; name: string } | null;
    items: Array<{ id: number; partCode: string; name: string; quantity: number; quantityFulfilled: number; backordered: boolean; unitPrice: number | null; lineTotal: number | null }>;
    events: Array<{ id: number; type: string; from: string | null; to: string | null; actor: string; payload: any; at: string }>;
    tracking: { terminal: boolean; terminalLabel: string | null; steps: Array<{ key: string; label: string; done: boolean; current: boolean }> };
};

const STATUS_TONE: Record<string, string> = {
    placed: "bg-amber-100 text-amber-900 hover:bg-amber-100", paid: "bg-blue-100 text-blue-900 hover:bg-blue-100",
    confirmed: "bg-indigo-100 text-indigo-900 hover:bg-indigo-100", packed: "bg-indigo-100 text-indigo-900 hover:bg-indigo-100",
    dispatched: "bg-sky-100 text-sky-900 hover:bg-sky-100", delivered: "bg-emerald-100 text-emerald-900 hover:bg-emerald-100",
    cancelled: "bg-slate-100 text-slate-700 hover:bg-slate-100", returned: "bg-rose-100 text-rose-900 hover:bg-rose-100",
};

/** What needs UniteFix's hand next, or nothing. */
const needsAction = (r: Row) => (r.status === "paid" || (r.status === "placed" && r.paymentMode === "credit") || r.status === "confirmed" || r.status === "packed");

export default function B2bOrdersPage() {
    const { toast } = useToast();
    const qc = useQueryClient();
    const fail = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });

    const [status, setStatus] = useState("all");
    const list = useQuery<Row[]>({
        queryKey: ["/api/admin/b2b-orders", status],
        queryFn: async () => (await apiRequest("GET", `/api/admin/b2b-orders?status=${status}`)).data,
    });
    const [activeId, setActiveId] = useState<number | null>(null);
    const detail = useQuery<Detail>({
        queryKey: ["/api/admin/b2b-orders", activeId, "detail"],
        queryFn: async () => (await apiRequest("GET", `/api/admin/b2b-orders/${activeId}`)).data,
        enabled: activeId !== null,
    });
    const refresh = () => qc.invalidateQueries({ queryKey: ["/api/admin/b2b-orders"] });

    const act = useMutation({
        mutationFn: async (v: { path: string; body?: unknown }) => apiRequest("POST", `/api/admin/b2b-orders/${activeId}${v.path}`, v.body ?? {}),
        onSuccess: (r: any) => { refresh(); toast({ title: "Done", description: r?.message }); setDispatch({ courier: "", trackingId: "" }); setReason(""); },
        onError: fail("Not done"),
    });
    const [dispatch, setDispatch] = useState({ courier: "", trackingId: "" });
    const [reason, setReason] = useState("");
    const [note, setNote] = useState("");
    const d = detail.data;
    const actionCount = (list.data ?? []).filter(needsAction).length;

    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">B2B Orders</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Business partners buying spare parts at trade price. Stock leaves the warehouse when you dispatch.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {["all", "placed", "paid", "confirmed", "packed", "dispatched", "delivered", "cancelled", "returned"].map(s => (
                        <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</Button>
                    ))}
                </div>
            </div>

            <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base font-medium">{list.isLoading ? "Loading…" : `${list.data?.length ?? 0} order${list.data?.length === 1 ? "" : "s"}${actionCount ? ` · ${actionCount} waiting on you` : ""}`}</CardTitle></CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>Order</TableHead><TableHead>Partner</TableHead><TableHead>Payment</TableHead><TableHead className="text-right">Total ₹</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Age</TableHead><TableHead className="text-right">Action</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {!list.isLoading && (list.data?.length ?? 0) === 0 && (
                                <TableRow><TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground"><ShoppingCart className="mx-auto mb-2 h-8 w-8 opacity-40" />No orders{status !== "all" ? ` that are ${status}` : ""}.</TableCell></TableRow>
                            )}
                            {(list.data ?? []).map(r => (
                                <TableRow key={r.id} className={needsAction(r) ? "bg-amber-50/40" : ""}>
                                    <TableCell><div className="font-mono text-xs">{r.orderCode}</div><div className="text-xs text-muted-foreground">{r.placedAt && format(new Date(r.placedAt), "d MMM, HH:mm")}</div></TableCell>
                                    <TableCell><div className="text-sm font-medium">{r.partnerName}</div><div className="font-mono text-xs text-muted-foreground">{r.partnerCode}</div></TableCell>
                                    <TableCell className="text-sm">{r.paymentMode} · <span className={r.paymentStatus === "paid" ? "text-emerald-700" : "text-muted-foreground"}>{r.paymentStatus.replace("_", " ")}</span></TableCell>
                                    <TableCell className="text-right tabular-nums">{r.total?.toLocaleString("en-IN")}</TableCell>
                                    <TableCell><Badge variant="secondary" className={STATUS_TONE[r.status]}>{r.status}</Badge></TableCell>
                                    <TableCell className={`text-right text-xs tabular-nums ${needsAction(r) && (r.ageHours ?? 0) > 24 ? "text-rose-600" : "text-muted-foreground"}`}>{r.ageHours != null ? `${r.ageHours} h` : ""}</TableCell>
                                    <TableCell className="text-right"><Button size="sm" variant={needsAction(r) ? "default" : "outline"} onClick={() => setActiveId(r.id)}>Open</Button></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={activeId !== null} onOpenChange={o => !o && setActiveId(null)}>
                <DialogContent className="max-w-3xl">
                    {d && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2"><span className="font-mono">{d.orderCode}</span> <Badge variant="secondary" className={STATUS_TONE[d.status]}>{d.status}</Badge></DialogTitle>
                                <DialogDescription>{d.partner?.name} ({d.partner?.code}) · {d.paymentMode}, {d.paymentStatus.replace("_", " ")} · placed {d.placedAt && format(new Date(d.placedAt), "d MMM yyyy, HH:mm")}</DialogDescription>
                            </DialogHeader>

                            {/* tracking stages */}
                            <div className="flex items-center gap-1 overflow-x-auto py-1">
                                {d.tracking.steps.map((s, i) => (
                                    <div key={s.key} className="flex items-center gap-1">
                                        <div className={`rounded-full px-2.5 py-1 text-xs ${s.current ? "bg-primary text-primary-foreground" : s.done ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground"}`}>{s.label}</div>
                                        {i < d.tracking.steps.length - 1 && <div className={`h-px w-4 ${s.done ? "bg-emerald-400" : "bg-border"}`} />}
                                    </div>
                                ))}
                                {d.tracking.terminal && <Badge variant="secondary" className={STATUS_TONE[d.status]}>{d.tracking.terminalLabel}</Badge>}
                            </div>

                            <div className="grid grid-cols-3 gap-3 text-sm">
                                <div className="col-span-2 rounded-md border">
                                    <Table>
                                        <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">₹/unit</TableHead><TableHead className="text-right">Line ₹</TableHead></TableRow></TableHeader>
                                        <TableBody>
                                            {d.items.map(it => (
                                                <TableRow key={it.id}>
                                                    <TableCell><span className="font-mono text-xs">{it.partCode}</span> {it.name}{it.backordered && <Badge variant="outline" className="ml-1.5 text-[10px] text-amber-700">backorder</Badge>}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{it.quantity}{it.quantityFulfilled > 0 && it.quantityFulfilled < it.quantity && <span className="text-muted-foreground"> ({it.quantityFulfilled} sent)</span>}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{it.unitPrice}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{it.lineTotal}</TableCell>
                                                </TableRow>
                                            ))}
                                            <TableRow><TableCell colSpan={3} className="text-right text-muted-foreground">Subtotal + GST ₹{d.gst}</TableCell><TableCell className="text-right font-semibold tabular-nums">{d.total}</TableCell></TableRow>
                                        </TableBody>
                                    </Table>
                                </div>
                                <div className="space-y-2">
                                    <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">Deliver to</div><div className="mt-1 text-sm">{d.deliveryContact?.name}{d.deliveryContact?.phone && ` · ${d.deliveryContact.phone}`}</div><div className="text-xs text-muted-foreground">{[d.deliveryAddress?.address, d.deliveryAddress?.district, d.deliveryAddress?.pincode].filter(Boolean).join(", ")}</div></div>
                                    {d.notes && <div className="rounded-md border p-3 text-xs text-muted-foreground">{d.notes}</div>}
                                    {d.cancelReason && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">{d.cancelReason}</div>}
                                </div>
                            </div>

                            {/* actions */}
                            {!d.tracking.terminal && (
                                <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                                    {(d.status === "placed" || d.status === "paid") && <Button size="sm" disabled={d.paymentMode === "prepaid" && d.paymentStatus !== "paid"} onClick={() => act.mutate({ path: "/confirm" })}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Confirm</Button>}
                                    {d.status === "confirmed" && <Button size="sm" variant="outline" onClick={() => act.mutate({ path: "/pack" })}><PackageCheck className="mr-1.5 h-3.5 w-3.5" /> Packed</Button>}
                                    {(d.status === "confirmed" || d.status === "packed") && (
                                        <>
                                            <div><Label className="text-xs">Courier</Label><Input className="h-8 w-32" value={dispatch.courier} onChange={e => setDispatch({ ...dispatch, courier: e.target.value })} /></div>
                                            <div><Label className="text-xs">Tracking id</Label><Input className="h-8 w-40" value={dispatch.trackingId} onChange={e => setDispatch({ ...dispatch, trackingId: e.target.value })} /></div>
                                            <Button size="sm" onClick={() => act.mutate({ path: "/dispatch", body: dispatch })}><Truck className="mr-1.5 h-3.5 w-3.5" /> Dispatch — moves stock</Button>
                                        </>
                                    )}
                                    {d.status === "dispatched" && <Button size="sm" onClick={() => act.mutate({ path: "/deliver" })}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Delivered</Button>}
                                    {(d.status === "dispatched" || d.status === "delivered") && <Button size="sm" variant="outline" onClick={() => act.mutate({ path: "/accept-return", body: { reason: "Return accepted" } })}><Undo2 className="mr-1.5 h-3.5 w-3.5" /> Accept return</Button>}
                                    {!["dispatched", "delivered"].includes(d.status) && (
                                        <>
                                            <Input className="h-8 w-48" placeholder="Reason to cancel" value={reason} onChange={e => setReason(e.target.value)} />
                                            <Button size="sm" variant="destructive" disabled={reason.trim().length < 3} onClick={() => act.mutate({ path: "/cancel", body: { reason } })}><XCircle className="mr-1.5 h-3.5 w-3.5" /> Cancel</Button>
                                        </>
                                    )}
                                </div>
                            )}
                            {d.paymentMode === "prepaid" && d.paymentStatus !== "paid" && !d.tracking.terminal && <p className="text-xs text-muted-foreground">Waiting for the partner's payment before this can be confirmed.</p>}

                            {/* timeline */}
                            <div className="space-y-1.5 border-t pt-3">
                                {d.events.map(ev => (
                                    <div key={ev.id} className="flex gap-3 text-xs">
                                        <span className="w-28 shrink-0 text-muted-foreground">{format(new Date(ev.at), "d MMM, HH:mm")}</span>
                                        <span className="font-medium">{ev.type.replace(/_/g, " ")}</span>
                                        <span className="text-muted-foreground">{ev.actor}{ev.payload?.courier && ` · ${ev.payload.courier} ${ev.payload.trackingId ?? ""}`}{ev.payload?.reason && ` · ${ev.payload.reason}`}{ev.payload?.note && ` · ${ev.payload.note}`}{ev.payload?.refundFailed && ` · REFUND FAILED: ${ev.payload.refundFailed}`}</span>
                                    </div>
                                ))}
                                <div className="flex gap-2 pt-1">
                                    <Input className="h-8" placeholder="Add a note to the timeline" value={note} onChange={e => setNote(e.target.value)} />
                                    <Button size="sm" variant="outline" disabled={note.trim().length < 2} onClick={() => { act.mutate({ path: "/note", body: { note } }); setNote(""); }}>Note</Button>
                                </div>
                            </div>
                            <DialogFooter><Button variant="outline" onClick={() => setActiveId(null)}>Close</Button></DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
