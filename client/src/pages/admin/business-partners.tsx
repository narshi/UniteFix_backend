/**
 * Business partners — the companies that trade with UniteFix.
 *
 * Not technicians. An ISP, a CCTV installer, a computer shop, a consultant:
 * one row each, with the verticals they work in, the terms they are on, and
 * the two logins they may hold (web portal, mobile app).
 *
 * The payout account is edited only here, by a super admin. A compromised
 * partner login that could change its own bank details would redirect the
 * next settlement to whoever held it.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { format } from "date-fns";
import { Building2, Plus, Search, Smartphone, Globe } from "lucide-react";

type BP = {
    id: number; partnerCode: string; legalName: string; displayName: string; gstin: string | null; pan: string | null;
    contactName: string | null; contactPhone: string; contactEmail: string | null; address: string | null; pincode: string | null; district: string | null;
    status: string; verticals: string[]; hasPortalLogin: boolean; hasMobileLogin: boolean; ftthOperatorId: number | null;
    credit: { limit: number; outstanding: number; available: number; paymentTermsDays: number };
    payout: { beneficiaryName: string | null; bankLast4: string | null; bankIfsc: string | null; upiId: string | null; automationReady: boolean };
    approvedAt: string | null; rejectionReason: string | null; notes: string | null; createdAt: string;
};
type Vertical = { id: number; code: string; name: string };
type LedgerLine = { id: string; source: "b2b" | "ftth"; entryType: string; amount: number; description: string | null; b2bOrderId: number | null; createdAt: string };

const STATUS_TONE: Record<string, string> = {
    pending_approval: "bg-amber-100 text-amber-900 hover:bg-amber-100",
    active: "bg-emerald-100 text-emerald-900 hover:bg-emerald-100",
    paused: "bg-slate-100 text-slate-700 hover:bg-slate-100",
    disabled: "bg-rose-100 text-rose-900 hover:bg-rose-100",
};

const blank = {
    legalName: "", displayName: "", gstin: "", pan: "", contactName: "", contactPhone: "", contactEmail: "", address: "", pincode: "", district: "",
    verticalCodes: [] as string[], creditLimitRupees: "0", paymentTermsDays: "0", notes: "",
    beneficiaryName: "", bankAccountNumber: "", bankIfsc: "", upiId: "",
};

export default function BusinessPartnersPage() {
    const { toast } = useToast();
    const qc = useQueryClient();
    const fail = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });
    const refresh = () => qc.invalidateQueries({ queryKey: ["/api/admin/business-partners"] });

    const [status, setStatus] = useState("all");
    const [q, setQ] = useState("");
    const list = useQuery<BP[]>({
        queryKey: ["/api/admin/business-partners", status, q],
        queryFn: async () => (await apiRequest("GET", `/api/admin/business-partners?status=${status}&q=${encodeURIComponent(q)}`)).data,
    });
    const { data: verticals = [] } = useQuery<Vertical[]>({
        queryKey: ["/api/admin/business-partners/verticals"],
        queryFn: async () => (await apiRequest("GET", "/api/admin/business-partners/verticals")).data,
    });

    // ── create / edit ───────────────────────────────────────────────────────
    const [editing, setEditing] = useState<BP | "new" | null>(null);
    const [form, setForm] = useState(blank);
    const openNew = () => { setForm(blank); setEditing("new"); };
    const openEdit = (bp: BP) => {
        setForm({
            legalName: bp.legalName, displayName: bp.displayName, gstin: bp.gstin ?? "", pan: bp.pan ?? "", contactName: bp.contactName ?? "",
            contactPhone: bp.contactPhone, contactEmail: bp.contactEmail ?? "", address: bp.address ?? "", pincode: bp.pincode ?? "", district: bp.district ?? "",
            verticalCodes: bp.verticals, creditLimitRupees: String(bp.credit.limit), paymentTermsDays: String(bp.credit.paymentTermsDays), notes: bp.notes ?? "",
            beneficiaryName: bp.payout.beneficiaryName ?? "", bankAccountNumber: "", bankIfsc: bp.payout.bankIfsc ?? "", upiId: bp.payout.upiId ?? "",
        });
        setEditing(bp);
    };
    const save = useMutation({
        mutationFn: async () => {
            const body: Record<string, unknown> = {
                legalName: form.legalName.trim(), displayName: form.displayName.trim() || undefined,
                gstin: form.gstin.trim() || null, pan: form.pan.trim() || null, contactName: form.contactName.trim() || null,
                contactPhone: form.contactPhone.trim(), contactEmail: form.contactEmail.trim() || null,
                address: form.address.trim() || null, pincode: form.pincode.trim() || null, district: form.district.trim() || null,
                verticalCodes: form.verticalCodes, creditLimitRupees: Number(form.creditLimitRupees) || 0, paymentTermsDays: Number(form.paymentTermsDays) || 0,
                notes: form.notes.trim() || null,
            };
            if (editing !== "new") {
                // Payout fields only when actually entered — a blank must not wipe the account.
                if (form.beneficiaryName.trim()) body.beneficiaryName = form.beneficiaryName.trim();
                if (form.bankAccountNumber.trim()) body.bankAccountNumber = form.bankAccountNumber.trim();
                if (form.bankIfsc.trim()) body.bankIfsc = form.bankIfsc.trim();
                if (form.upiId.trim()) body.upiId = form.upiId.trim();
                return apiRequest("PATCH", `/api/admin/business-partners/${(editing as BP).id}`, body);
            }
            return apiRequest("POST", "/api/admin/business-partners", body);
        },
        onSuccess: (r: any) => { refresh(); setEditing(null); toast({ title: "Saved", description: r?.message }); },
        onError: fail("Not saved"),
    });

    // ── detail ──────────────────────────────────────────────────────────────
    const [active, setActive] = useState<BP | null>(null);
    const detail = useQuery<BP>({
        queryKey: ["/api/admin/business-partners", active?.id],
        queryFn: async () => (await apiRequest("GET", `/api/admin/business-partners/${active!.id}`)).data,
        enabled: !!active,
    });
    const ledger = useQuery<{ b2bBalance: number; ftthBalance: number; lines: LedgerLine[] }>({
        queryKey: ["/api/admin/business-partners", active?.id, "ledger"],
        queryFn: async () => (await apiRequest("GET", `/api/admin/business-partners/${active!.id}/ledger`)).data,
        enabled: !!active,
    });
    const refreshDetail = () => { refresh(); qc.invalidateQueries({ queryKey: ["/api/admin/business-partners", active?.id] }); };

    const act = useMutation({
        mutationFn: async (v: { path: string; body?: unknown; method?: string }) => apiRequest(v.method ?? "POST", `/api/admin/business-partners/${active!.id}${v.path}`, v.body),
        onSuccess: (r: any) => { refreshDetail(); toast({ title: "Done", description: r?.message }); },
        onError: fail("Not done"),
    });
    const [reason, setReason] = useState("");
    const [pay, setPay] = useState({ entryType: "payment_received", amountRupees: "", description: "", reference: "" });

    const bp = detail.data ?? active;

    const VerticalPicker = ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
        <div className="flex flex-wrap gap-1.5">
            {verticals.map(v => {
                const on = value.includes(v.code);
                return <button key={v.code} type="button" onClick={() => onChange(on ? value.filter(c => c !== v.code) : [...value, v.code])}
                    className={`rounded-md border px-2 py-1 text-xs transition ${on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50"}`}>{v.name}</button>;
            })}
        </div>
    );

    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Business Partners</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        ISPs, CCTV installers, computer shops, consultants — companies that trade with UniteFix. Technicians are under Employees.
                    </p>
                </div>
                <Button onClick={openNew}><Plus className="mr-1.5 h-4 w-4" /> New partner</Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-72">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, code, phone, GSTIN" className="pl-8" />
                </div>
                {["all", "pending_approval", "active", "paused", "disabled"].map(s => (
                    <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>{s === "all" ? "All" : s.replace("_", " ")}</Button>
                ))}
            </div>

            <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base font-medium">{list.isLoading ? "Loading…" : `${list.data?.length ?? 0} partner${list.data?.length === 1 ? "" : "s"}`}</CardTitle></CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>Code</TableHead><TableHead>Partner</TableHead><TableHead>Verticals</TableHead><TableHead>Logins</TableHead>
                            <TableHead className="text-right">Credit ₹</TableHead><TableHead className="text-right">Owes ₹</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {!list.isLoading && (list.data?.length ?? 0) === 0 && (
                                <TableRow><TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground"><Building2 className="mx-auto mb-2 h-8 w-8 opacity-40" />No business partners{status !== "all" ? ` that are ${status.replace("_", " ")}` : ""}.</TableCell></TableRow>
                            )}
                            {(list.data ?? []).map(p => (
                                <TableRow key={p.id}>
                                    <TableCell className="font-mono text-xs">{p.partnerCode}</TableCell>
                                    <TableCell>
                                        <div className="text-sm font-medium">{p.displayName}</div>
                                        <div className="text-xs text-muted-foreground">{p.contactPhone}{p.gstin && ` · ${p.gstin}`}</div>
                                    </TableCell>
                                    <TableCell><div className="flex flex-wrap gap-1">{p.verticals.map(v => <Badge key={v} variant="secondary" className="text-[10px] font-normal">{v}</Badge>)}</div></TableCell>
                                    <TableCell className="text-muted-foreground">
                                        <div className="flex gap-1.5">{p.hasPortalLogin && <Globe className="h-4 w-4" />}{p.hasMobileLogin && <Smartphone className="h-4 w-4" />}{!p.hasPortalLogin && !p.hasMobileLogin && <span className="text-xs">none</span>}</div>
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">{p.credit.limit > 0 ? p.credit.limit.toLocaleString("en-IN") : <span className="text-muted-foreground">prepaid</span>}</TableCell>
                                    <TableCell className="text-right tabular-nums">{p.credit.outstanding > 0 ? p.credit.outstanding.toLocaleString("en-IN") : "—"}</TableCell>
                                    <TableCell><Badge variant="secondary" className={STATUS_TONE[p.status]}>{p.status.replace("_", " ")}</Badge></TableCell>
                                    <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setActive(p)}>Open</Button></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* ── detail ─────────────────────────────────────────────────────── */}
            <Dialog open={!!active} onOpenChange={o => !o && setActive(null)}>
                <DialogContent className="max-w-3xl">
                    {bp && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">{bp.displayName} <span className="font-mono text-sm font-normal text-muted-foreground">{bp.partnerCode}</span> <Badge variant="secondary" className={STATUS_TONE[bp.status]}>{bp.status.replace("_", " ")}</Badge></DialogTitle>
                                <DialogDescription>{bp.legalName}{bp.gstin && ` · GSTIN ${bp.gstin}`} · {bp.contactPhone}{bp.contactEmail && ` · ${bp.contactEmail}`}</DialogDescription>
                            </DialogHeader>
                            <Tabs defaultValue="account">
                                <TabsList><TabsTrigger value="account">Account</TabsTrigger><TabsTrigger value="ledger">Transactions</TabsTrigger></TabsList>

                                <TabsContent value="account" className="space-y-4">
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div className="rounded-md border p-3">
                                            <div className="text-xs uppercase tracking-wide text-muted-foreground">Verticals</div>
                                            <div className="mt-1 flex flex-wrap gap-1">{bp.verticals.length ? bp.verticals.map(v => <Badge key={v} variant="secondary">{v}</Badge>) : <span className="text-muted-foreground">none yet</span>}</div>
                                            {bp.ftthOperatorId && <div className="mt-2 text-xs text-muted-foreground">FTTH operator #{bp.ftthOperatorId} — plans, coverage and recharges under FTTH Operators.</div>}
                                        </div>
                                        <div className="rounded-md border p-3">
                                            <div className="text-xs uppercase tracking-wide text-muted-foreground">Credit</div>
                                            <div className="mt-1">{bp.credit.limit > 0 ? <>Limit ₹{bp.credit.limit.toLocaleString("en-IN")} · outstanding ₹{bp.credit.outstanding.toLocaleString("en-IN")} · available <b>₹{bp.credit.available.toLocaleString("en-IN")}</b> · {bp.credit.paymentTermsDays} days</> : "Prepaid only"}</div>
                                        </div>
                                        <div className="rounded-md border p-3">
                                            <div className="text-xs uppercase tracking-wide text-muted-foreground">Logins</div>
                                            <div className="mt-1 flex items-center gap-3">
                                                <span className={bp.hasPortalLogin ? "" : "text-muted-foreground"}><Globe className="mr-1 inline h-3.5 w-3.5" />Portal {bp.hasPortalLogin ? "✓" : "—"}</span>
                                                <span className={bp.hasMobileLogin ? "" : "text-muted-foreground"}><Smartphone className="mr-1 inline h-3.5 w-3.5" />App {bp.hasMobileLogin ? "✓" : "—"}</span>
                                                {!bp.hasMobileLogin && bp.status === "active" && <Button size="sm" variant="outline" onClick={() => act.mutate({ path: "/mobile-login" })}>Create app login on {bp.contactPhone}</Button>}
                                            </div>
                                        </div>
                                        <div className="rounded-md border p-3">
                                            <div className="text-xs uppercase tracking-wide text-muted-foreground">Payout account</div>
                                            <div className="mt-1">{bp.payout.bankLast4 ? `Bank ····${bp.payout.bankLast4} (${bp.payout.bankIfsc})` : bp.payout.upiId ? `UPI ${bp.payout.upiId}` : <span className="text-muted-foreground">none — edit to add</span>}</div>
                                        </div>
                                    </div>
                                    {bp.rejectionReason && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{bp.rejectionReason}</div>}
                                    {bp.notes && <div className="text-sm text-muted-foreground">{bp.notes}</div>}

                                    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                                        <Button size="sm" variant="outline" onClick={() => openEdit(bp)}>Edit details & terms</Button>
                                        {bp.status === "pending_approval" && (
                                            <>
                                                <Button size="sm" onClick={() => act.mutate({ path: "/approve", body: {} })}>Approve</Button>
                                                <Input className="h-8 w-56" placeholder="Reason to reject" value={reason} onChange={e => setReason(e.target.value)} />
                                                <Button size="sm" variant="destructive" disabled={reason.trim().length < 3} onClick={() => act.mutate({ path: "/reject", body: { reason } })}>Reject</Button>
                                            </>
                                        )}
                                        {bp.status === "active" && <Button size="sm" variant="outline" onClick={() => act.mutate({ path: "/status", method: "PATCH", body: { status: "paused", reason: "Paused by admin" } })}>Pause</Button>}
                                        {bp.status === "paused" && <Button size="sm" onClick={() => act.mutate({ path: "/status", method: "PATCH", body: { status: "active" } })}>Resume</Button>}
                                        {(bp.status === "active" || bp.status === "paused") && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: "/status", method: "PATCH", body: { status: "disabled", reason: "Disabled by admin" } })}>Disable</Button>}
                                    </div>
                                </TabsContent>

                                <TabsContent value="ledger" className="space-y-4">
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">Parts & orders</div><div className="mt-1 text-lg tabular-nums">{(ledger.data?.b2bBalance ?? 0) >= 0 ? `They owe ₹${(ledger.data?.b2bBalance ?? 0).toLocaleString("en-IN")}` : `We owe ₹${(-(ledger.data?.b2bBalance ?? 0)).toLocaleString("en-IN")}`}</div></div>
                                        <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">FTTH settlements</div><div className="mt-1 text-lg tabular-nums">{bp.ftthOperatorId ? ((ledger.data?.ftthBalance ?? 0) >= 0 ? `They owe ₹${(ledger.data?.ftthBalance ?? 0).toLocaleString("en-IN")}` : `We owe ₹${(-(ledger.data?.ftthBalance ?? 0)).toLocaleString("en-IN")}`) : <span className="text-muted-foreground">not an ISP</span>}</div></div>
                                    </div>
                                    <p className="text-xs text-muted-foreground">Shown side by side, not netted. Positive means the partner owes UniteFix.</p>

                                    <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                                        <div><Label className="text-xs">Record</Label>
                                            <select className="block h-8 rounded-md border bg-background px-2 text-sm" value={pay.entryType} onChange={e => setPay({ ...pay, entryType: e.target.value })}>
                                                <option value="payment_received">Payment received</option><option value="settlement_paid">Settlement paid to them</option><option value="credit_note">Credit note</option><option value="adjustment">Adjustment</option>
                                            </select></div>
                                        <div><Label className="text-xs">Amount ₹</Label><Input className="h-8 w-28" inputMode="decimal" value={pay.amountRupees} onChange={e => setPay({ ...pay, amountRupees: e.target.value })} /></div>
                                        <div className="min-w-[200px] flex-1"><Label className="text-xs">Description</Label><Input className="h-8" value={pay.description} onChange={e => setPay({ ...pay, description: e.target.value })} placeholder="NEFT ref, cheque no., reason" /></div>
                                        <Button size="sm" disabled={!pay.amountRupees.trim() || pay.description.trim().length < 2 || act.isPending}
                                            onClick={() => act.mutate({ path: "/ledger", body: { entryType: pay.entryType, amountRupees: Number(pay.amountRupees), description: pay.description, reference: pay.reference || undefined } })}>Record</Button>
                                    </div>

                                    <Table>
                                        <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Entry</TableHead><TableHead>Description</TableHead><TableHead className="text-right">₹</TableHead></TableRow></TableHeader>
                                        <TableBody>
                                            {(ledger.data?.lines ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">No transactions yet.</TableCell></TableRow>}
                                            {(ledger.data?.lines ?? []).map(l => (
                                                <TableRow key={l.id}>
                                                    <TableCell className="text-xs text-muted-foreground">{format(new Date(l.createdAt), "d MMM yyyy")}</TableCell>
                                                    <TableCell><Badge variant="outline" className="text-[10px] font-normal">{l.source}</Badge> <span className="text-sm">{l.entryType.replace(/_/g, " ")}</span></TableCell>
                                                    <TableCell className="text-sm text-muted-foreground">{l.description}</TableCell>
                                                    <TableCell className={`text-right tabular-nums ${l.amount < 0 ? "text-emerald-700" : ""}`}>{l.amount.toLocaleString("en-IN")}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TabsContent>
                            </Tabs>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* ── create / edit ──────────────────────────────────────────────── */}
            <Dialog open={editing !== null} onOpenChange={o => !o && setEditing(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editing === "new" ? "New business partner" : `Edit ${(editing as BP)?.displayName ?? ""}`}</DialogTitle>
                        <DialogDescription>{editing === "new" ? "Created by an admin, so it is active on save." : "Payout account fields are applied only when filled in."}</DialogDescription>
                    </DialogHeader>
                    <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1">
                        <div className="grid grid-cols-2 gap-3">
                            <div><Label>Legal name</Label><Input value={form.legalName} onChange={e => setForm({ ...form, legalName: e.target.value })} /></div>
                            <div><Label>Display name</Label><Input value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} placeholder="as the legal name" /></div>
                            <div><Label>GSTIN</Label><Input value={form.gstin} onChange={e => setForm({ ...form, gstin: e.target.value.toUpperCase() })} placeholder="required for credit" /></div>
                            <div><Label>PAN</Label><Input value={form.pan} onChange={e => setForm({ ...form, pan: e.target.value.toUpperCase() })} /></div>
                            <div><Label>Contact name</Label><Input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} /></div>
                            <div><Label>Contact phone</Label><Input value={form.contactPhone} onChange={e => setForm({ ...form, contactPhone: e.target.value })} placeholder="10 digits" /></div>
                            <div className="col-span-2"><Label>Email</Label><Input value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} /></div>
                            <div className="col-span-2"><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
                            <div><Label>Pincode</Label><Input value={form.pincode} onChange={e => setForm({ ...form, pincode: e.target.value })} /></div>
                            <div><Label>District</Label><Input value={form.district} onChange={e => setForm({ ...form, district: e.target.value })} /></div>
                        </div>
                        <div><Label className="mb-1.5 block">Verticals</Label><VerticalPicker value={form.verticalCodes} onChange={v => setForm({ ...form, verticalCodes: v })} /></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div><Label>Credit limit ₹ (0 = prepaid only)</Label><Input inputMode="decimal" value={form.creditLimitRupees} onChange={e => setForm({ ...form, creditLimitRupees: e.target.value })} /></div>
                            <div><Label>Payment terms (days)</Label><Input inputMode="numeric" value={form.paymentTermsDays} onChange={e => setForm({ ...form, paymentTermsDays: e.target.value })} /></div>
                        </div>
                        {editing !== "new" && (
                            <div className="rounded-md border p-3">
                                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Payout account — for settlements UniteFix pays them</div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div><Label>Beneficiary name</Label><Input value={form.beneficiaryName} onChange={e => setForm({ ...form, beneficiaryName: e.target.value })} /></div>
                                    <div><Label>UPI id</Label><Input value={form.upiId} onChange={e => setForm({ ...form, upiId: e.target.value })} /></div>
                                    <div><Label>Bank account</Label><Input value={form.bankAccountNumber} onChange={e => setForm({ ...form, bankAccountNumber: e.target.value })} placeholder="leave blank to keep" /></div>
                                    <div><Label>IFSC</Label><Input value={form.bankIfsc} onChange={e => setForm({ ...form, bankIfsc: e.target.value.toUpperCase() })} /></div>
                                </div>
                            </div>
                        )}
                        <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                        <Button disabled={save.isPending || !form.legalName.trim() || !form.contactPhone.trim() || form.verticalCodes.length === 0} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
