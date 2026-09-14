/**
 * Parts access — technicians who fit from UniteFix stock, and the deposit
 * that backs them.
 *
 * The deposit proves commitment; approval is where a person decides. Every
 * draw names its cause, and the technician sees the same ledger in their app,
 * so nothing here is done to them silently.
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
import { ShieldCheck, AlertTriangle } from "lucide-react";

type Row = {
    employeeId: number; name: string | null; partsAccess: string; grantedAt: string | null;
    deposit: { status: string; paid: number; drawn: number; remaining: number; paidAt: string | null } | null;
};
type Detail = {
    employeeId: number; name: string | null; partsAccess: string; grantedAt: string | null; required: number; floor: number;
    deposit: { id: number; status: string; paid: number; drawn: number; remaining: number; belowFloor: boolean; topUpNeeded: number; paidAt: string | null; refundedAt: string | null } | null;
    ledger: Array<{ id: number; type: string; amount: number; balanceAfter: number; warrantyClaimId: number | null; notes: string | null; at: string }>;
    refundBlockers: string[];
};

const ACCESS_TONE: Record<string, string> = {
    none: "bg-slate-100 text-slate-700 hover:bg-slate-100",
    requested: "bg-amber-100 text-amber-900 hover:bg-amber-100",
    active: "bg-emerald-100 text-emerald-900 hover:bg-emerald-100",
    suspended: "bg-rose-100 text-rose-900 hover:bg-rose-100",
};
const ENTRY_LABEL: Record<string, string> = {
    paid_in: "Deposit paid", topped_up: "Topped up", drawn_warranty: "Warranty claim", drawn_shortage: "Stock shortage",
    drawn_damage: "Damaged return", refunded: "Refunded", adjustment: "Adjustment",
};

export default function PartsAccessPage() {
    const { toast } = useToast();
    const qc = useQueryClient();
    const fail = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });

    const [filter, setFilter] = useState("all");
    const list = useQuery<Row[]>({
        queryKey: ["/api/admin/parts-access", filter],
        queryFn: async () => (await apiRequest("GET", `/api/admin/parts-access?access=${filter}`)).data,
    });

    const [activeId, setActiveId] = useState<number | null>(null);
    const detail = useQuery<Detail>({
        queryKey: ["/api/admin/parts-access", activeId, "detail"],
        queryFn: async () => (await apiRequest("GET", `/api/admin/parts-access/${activeId}`)).data,
        enabled: activeId !== null,
    });
    const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/admin/parts-access"] }); };

    const act = useMutation({
        mutationFn: async (v: { path: string; body?: unknown }) => apiRequest("POST", `/api/admin/parts-access/${activeId}${v.path}`, v.body),
        onSuccess: (r: any) => { refresh(); toast({ title: "Done", description: r?.message }); },
        onError: fail("Not done"),
    });

    const [reason, setReason] = useState("");
    const [draw, setDraw] = useState({ amountRupees: "", entryType: "drawn_shortage", notes: "" });
    const [manualRef, setManualRef] = useState("");
    const d = detail.data;

    const pendingCount = (list.data ?? []).filter(r => r.partsAccess === "requested").length;

    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Parts Access</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        Technicians who can fit parts from UniteFix stock, and the refundable deposit that stands behind them. A warranty verdict against a technician is drawn from here.
                    </p>
                </div>
                <div className="flex gap-2">
                    {["all", "requested", "active", "suspended"].map(s => (
                        <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>
                            {s[0].toUpperCase() + s.slice(1)}{s === "requested" && pendingCount > 0 && <span className="ml-1.5 rounded bg-background/20 px-1.5 text-xs">{pendingCount}</span>}
                        </Button>
                    ))}
                </div>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>Technician</TableHead><TableHead>Access</TableHead><TableHead>Deposit</TableHead>
                            <TableHead className="text-right">Paid ₹</TableHead><TableHead className="text-right">Drawn ₹</TableHead><TableHead className="text-right">Remaining ₹</TableHead><TableHead className="text-right">Action</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {!list.isLoading && (list.data?.length ?? 0) === 0 && (
                                <TableRow><TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground"><ShieldCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />Nobody has requested spare-parts access yet. Technicians start it from their profile in the app.</TableCell></TableRow>
                            )}
                            {(list.data ?? []).map(r => (
                                <TableRow key={r.employeeId}>
                                    <TableCell className="text-sm font-medium">{r.name ?? `#${r.employeeId}`}</TableCell>
                                    <TableCell><Badge variant="secondary" className={ACCESS_TONE[r.partsAccess]}>{r.partsAccess}</Badge></TableCell>
                                    <TableCell className="text-sm text-muted-foreground">{r.deposit ? r.deposit.status.replace("_", " ") : "—"}</TableCell>
                                    <TableCell className="text-right tabular-nums">{r.deposit?.paid ?? "—"}</TableCell>
                                    <TableCell className="text-right tabular-nums">{r.deposit?.drawn ?? "—"}</TableCell>
                                    <TableCell className="text-right tabular-nums">{r.deposit?.remaining ?? "—"}</TableCell>
                                    <TableCell className="text-right"><Button size="sm" variant={r.partsAccess === "requested" ? "default" : "outline"} onClick={() => setActiveId(r.employeeId)}>{r.partsAccess === "requested" ? "Review" : "Open"}</Button></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={activeId !== null} onOpenChange={o => !o && setActiveId(null)}>
                <DialogContent className="max-w-2xl">
                    {d && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">{d.name ?? `#${d.employeeId}`} <Badge variant="secondary" className={ACCESS_TONE[d.partsAccess]}>{d.partsAccess}</Badge></DialogTitle>
                                <DialogDescription>Deposit required ₹{d.required.toLocaleString("en-IN")} · access suspends below ₹{d.floor.toLocaleString("en-IN")}</DialogDescription>
                            </DialogHeader>

                            {d.deposit ? (
                                <div className="grid grid-cols-3 gap-3 text-sm">
                                    <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Paid</div><div className="text-lg tabular-nums">₹{d.deposit.paid.toLocaleString("en-IN")}</div></div>
                                    <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Drawn</div><div className="text-lg tabular-nums">₹{d.deposit.drawn.toLocaleString("en-IN")}</div></div>
                                    <div className={`rounded-md border p-3 ${d.deposit.belowFloor ? "border-rose-300 bg-rose-50" : ""}`}><div className="text-xs text-muted-foreground">Remaining</div><div className="text-lg tabular-nums">₹{d.deposit.remaining.toLocaleString("en-IN")}</div>{d.deposit.belowFloor && <div className="mt-0.5 flex items-center gap-1 text-xs text-rose-800"><AlertTriangle className="h-3 w-3" /> below floor · top-up ₹{d.deposit.topUpNeeded}</div>}</div>
                                </div>
                            ) : <p className="text-sm text-muted-foreground">No deposit has been paid.</p>}

                            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                                {d.partsAccess === "requested" && <Button size="sm" onClick={() => act.mutate({ path: "/approve" })}>Approve access</Button>}
                                {d.partsAccess === "suspended" && <Button size="sm" onClick={() => act.mutate({ path: "/reinstate" })}>Reinstate</Button>}
                                {d.partsAccess === "active" && (
                                    <>
                                        <Input className="h-8 w-56" placeholder="Reason to suspend" value={reason} onChange={e => setReason(e.target.value)} />
                                        <Button size="sm" variant="outline" disabled={reason.trim().length < 3} onClick={() => act.mutate({ path: "/suspend", body: { reason } })}>Suspend</Button>
                                    </>
                                )}
                                {d.deposit?.status === "refund_requested" && (
                                    <>
                                        <Input className="h-8 w-48" placeholder="Manual ref (optional)" value={manualRef} onChange={e => setManualRef(e.target.value)} />
                                        <Button size="sm" variant="outline" onClick={() => act.mutate({ path: "/refund", body: { manualReference: manualRef || undefined } })}>Refund ₹{d.deposit.remaining} via Cashfree</Button>
                                    </>
                                )}
                            </div>
                            {d.refundBlockers.length > 0 && <p className="text-xs text-muted-foreground">Refund would be blocked: {d.refundBlockers.join("; ")}.</p>}

                            {d.deposit && d.deposit.remaining > 0 && (
                                <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                                    <div><Label className="text-xs">Draw for</Label>
                                        <select className="block h-8 rounded-md border bg-background px-2 text-sm" value={draw.entryType} onChange={e => setDraw({ ...draw, entryType: e.target.value })}>
                                            <option value="drawn_shortage">Stock shortage</option><option value="drawn_damage">Damaged return</option><option value="drawn_warranty">Warranty (manual)</option><option value="adjustment">Adjustment</option>
                                        </select></div>
                                    <div><Label className="text-xs">Amount ₹</Label><Input className="h-8 w-28" inputMode="decimal" value={draw.amountRupees} onChange={e => setDraw({ ...draw, amountRupees: e.target.value })} /></div>
                                    <div className="min-w-[200px] flex-1"><Label className="text-xs">Reason — the technician reads this</Label><Input className="h-8" value={draw.notes} onChange={e => setDraw({ ...draw, notes: e.target.value })} /></div>
                                    <Button size="sm" variant="destructive" disabled={!draw.amountRupees.trim() || draw.notes.trim().length < 3 || act.isPending}
                                        onClick={() => act.mutate({ path: "/draw", body: { amountRupees: Number(draw.amountRupees), entryType: draw.entryType, notes: draw.notes } })}>Draw</Button>
                                </div>
                            )}

                            <Table>
                                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Entry</TableHead><TableHead>Notes</TableHead><TableHead className="text-right">₹</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {d.ledger.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No entries.</TableCell></TableRow>}
                                    {d.ledger.map(l => (
                                        <TableRow key={l.id}>
                                            <TableCell className="text-xs text-muted-foreground">{format(new Date(l.at), "d MMM yyyy")}</TableCell>
                                            <TableCell className="text-sm">{ENTRY_LABEL[l.type] ?? l.type}{l.warrantyClaimId && <span className="text-muted-foreground"> · claim #{l.warrantyClaimId}</span>}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{l.notes}</TableCell>
                                            <TableCell className={`text-right tabular-nums ${l.amount < 0 ? "text-rose-600" : "text-emerald-700"}`}>{l.amount > 0 ? "+" : ""}{l.amount}</TableCell>
                                            <TableCell className="text-right tabular-nums">{l.balanceAfter}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            <DialogFooter><Button variant="outline" onClick={() => setActiveId(null)}>Close</Button></DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
