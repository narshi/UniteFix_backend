/**
 * Spare parts — the catalogue, technician proposals, and stock.
 *
 * Three prices on every part, three audiences: the CUSTOMER price is billed
 * when a technician fits it on a job; the TRADE price is what a business
 * partner pays to buy it; the COST is what UniteFix paid and is shown nowhere
 * else. All three are entered here and nowhere else.
 *
 * Stock is a ledger. Receive, issue and count are the only three ways a
 * quantity changes by hand, and each writes a movement that says why.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { format } from "date-fns";
import { Package, Plus, Search, Inbox, Boxes, ArrowDownToLine, ArrowUpFromLine, ClipboardCheck } from "lucide-react";

type Part = {
    id: number; partCode: string; name: string; brand: string | null; specification: string | null; unit: string;
    unitPrice: number | null; tradePrice: number | null; costPrice: number | null; warrantyDays: number;
    status: string; isActive: boolean; categoryIds: number[]; warehouseQty: number;
};
type Category = { id: number; name: string };
type Proposal = {
    id: number; name: string; brand: string | null; specification: string | null; categoryId: number | null; unit: string;
    indicativePrice: number | null; vendorName: string | null; photoUrl: string | null; status: string;
    proposerName: string | null; categoryName: string | null; jobRef: string | null; createdAt: string;
};
type Movement = {
    id: number; movementType: string; quantity: number; fromLocation: string | null; toLocation: string | null;
    fromHolderEmployeeId: number | null; toHolderEmployeeId: number | null; stockBefore: number; stockAfter: number;
    notes: string | null; createdAt: string; part: { partCode: string; name: string }; unitCost: number | null;
};
type Technician = { id: number; partnerName: string; partsAccess?: string };

const MOVEMENT_LABEL: Record<string, string> = {
    purchase_in: "Received", transfer_to_technician: "Issued to technician", return_to_warehouse: "Returned",
    consumed: "Fitted on a job", sold_to_partner: "Sold to partner", partner_return: "Partner return",
    adjustment: "Count adjustment", write_off: "Written off",
};

const emptyForm = {
    name: "", brand: "", specification: "", unit: "piece", unitPriceRupees: "", tradePriceRupees: "", costPriceRupees: "",
    warrantyDays: "0", gstPercent: "", categoryIds: [] as number[],
};

export default function SparePartsPage() {
    const { toast } = useToast();
    const qc = useQueryClient();
    const fail = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });

    const { data: categories = [] } = useQuery<Category[]>({
        queryKey: ["/api/admin/catalog/categories"],
        select: (res: any) => res?.data ?? [],
    });
    const { data: technicians = [] } = useQuery<Technician[]>({
        queryKey: ["/api/business/partners"],
        select: (res: any) => (Array.isArray(res) ? res : []).map((p: any) => ({ id: p.id, partnerName: p.partnerName, partsAccess: p.partsAccess })),
    });
    const catName = (id: number) => categories.find(c => c.id === id)?.name ?? `#${id}`;
    const techName = (id: number | null) => id == null ? "" : (technicians.find(t => t.id === id)?.partnerName ?? `#${id}`);

    // ── catalogue ───────────────────────────────────────────────────────────
    const [q, setQ] = useState("");
    const [includeInactive, setIncludeInactive] = useState(false);
    const parts = useQuery<Part[]>({
        queryKey: ["/api/admin/spare-parts", q, includeInactive],
        queryFn: async () => (await apiRequest("GET", `/api/admin/spare-parts?q=${encodeURIComponent(q)}&includeInactive=${includeInactive}&limit=200`)).data,
    });
    const [editing, setEditing] = useState<Part | "new" | null>(null);
    const [form, setForm] = useState(emptyForm);
    const openNew = () => { setForm(emptyForm); setEditing("new"); };
    const openEdit = (p: Part) => {
        setForm({
            name: p.name, brand: p.brand ?? "", specification: p.specification ?? "", unit: p.unit,
            unitPriceRupees: String(p.unitPrice ?? ""), tradePriceRupees: p.tradePrice != null ? String(p.tradePrice) : "",
            costPriceRupees: p.costPrice != null ? String(p.costPrice) : "", warrantyDays: String(p.warrantyDays), gstPercent: "",
            categoryIds: p.categoryIds,
        });
        setEditing(p);
    };
    const savePart = useMutation({
        mutationFn: async () => {
            const body = {
                name: form.name.trim(), brand: form.brand.trim() || null, specification: form.specification.trim() || null, unit: form.unit.trim() || "piece",
                unitPriceRupees: Number(form.unitPriceRupees),
                tradePriceRupees: form.tradePriceRupees.trim() ? Number(form.tradePriceRupees) : null,
                costPriceRupees: form.costPriceRupees.trim() ? Number(form.costPriceRupees) : null,
                warrantyDays: Number(form.warrantyDays) || 0,
                gstPercent: form.gstPercent.trim() ? Number(form.gstPercent) : null,
                categoryIds: form.categoryIds,
            };
            return editing === "new"
                ? apiRequest("POST", "/api/admin/spare-parts", body)
                : apiRequest("PATCH", `/api/admin/spare-parts/${(editing as Part).id}`, body);
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/admin/spare-parts"] }); setEditing(null); toast({ title: "Part saved" }); },
        onError: fail("Not saved"),
    });
    const toggleActive = useMutation({
        mutationFn: async (p: Part) => apiRequest("PATCH", `/api/admin/spare-parts/${p.id}`, { isActive: !p.isActive, status: p.isActive ? "discontinued" : "active" }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/spare-parts"] }),
        onError: fail("Not updated"),
    });

    // ── proposals ───────────────────────────────────────────────────────────
    const [propStatus, setPropStatus] = useState("pending");
    const proposals = useQuery<Proposal[]>({
        queryKey: ["/api/admin/spare-parts/proposals", propStatus],
        queryFn: async () => (await apiRequest("GET", `/api/admin/spare-parts/proposals?status=${propStatus}`)).data,
    });
    const [reviewing, setReviewing] = useState<Proposal | null>(null);
    const [reviewMode, setReviewMode] = useState<"approve" | "merge" | "reject">("approve");
    const [reviewForm, setReviewForm] = useState({ unitPriceRupees: "", tradePriceRupees: "", costPriceRupees: "", warrantyDays: "0", categoryIds: [] as number[], notes: "", mergeInto: "", reason: "" });
    const openReview = (p: Proposal, mode: "approve" | "merge" | "reject") => {
        setReviewForm({ unitPriceRupees: p.indicativePrice != null ? String(p.indicativePrice) : "", tradePriceRupees: "", costPriceRupees: "", warrantyDays: "0", categoryIds: p.categoryId ? [p.categoryId] : [], notes: "", mergeInto: "", reason: "" });
        setReviewMode(mode); setReviewing(p);
    };
    const review = useMutation({
        mutationFn: async () => {
            if (!reviewing) return;
            if (reviewMode === "approve") {
                return apiRequest("POST", `/api/admin/spare-parts/proposals/${reviewing.id}/approve`, {
                    unitPriceRupees: Number(reviewForm.unitPriceRupees),
                    tradePriceRupees: reviewForm.tradePriceRupees.trim() ? Number(reviewForm.tradePriceRupees) : null,
                    costPriceRupees: reviewForm.costPriceRupees.trim() ? Number(reviewForm.costPriceRupees) : null,
                    warrantyDays: Number(reviewForm.warrantyDays) || 0, categoryIds: reviewForm.categoryIds, notes: reviewForm.notes || null,
                });
            }
            if (reviewMode === "merge") return apiRequest("POST", `/api/admin/spare-parts/proposals/${reviewing.id}/merge`, { sparePartId: Number(reviewForm.mergeInto), notes: reviewForm.notes || null });
            return apiRequest("POST", `/api/admin/spare-parts/proposals/${reviewing.id}/reject`, { reason: reviewForm.reason });
        },
        onSuccess: (r: any) => {
            qc.invalidateQueries({ queryKey: ["/api/admin/spare-parts"] });
            qc.invalidateQueries({ queryKey: ["/api/admin/spare-parts/proposals"] });
            setReviewing(null);
            toast({ title: reviewMode === "reject" ? "Proposal rejected" : "Done", description: r?.message });
        },
        onError: fail("Not done"),
    });

    // ── stock ───────────────────────────────────────────────────────────────
    const movements = useQuery<Movement[]>({
        queryKey: ["/api/admin/spare-parts/stock/movements"],
        queryFn: async () => (await apiRequest("GET", "/api/admin/spare-parts/stock/movements?limit=100")).data,
    });
    const [stockMode, setStockMode] = useState<"receive" | "issue" | "count" | null>(null);
    const [stockForm, setStockForm] = useState({ sparePartId: "", quantity: "", unitCostRupees: "", employeeId: "", location: "warehouse", actualQuantity: "", notes: "" });
    const stockAction = useMutation({
        mutationFn: async () => {
            const partId = Number(stockForm.sparePartId);
            if (stockMode === "receive") return apiRequest("POST", "/api/admin/spare-parts/stock/receive", { sparePartId: partId, quantity: Number(stockForm.quantity), unitCostRupees: stockForm.unitCostRupees.trim() ? Number(stockForm.unitCostRupees) : null, notes: stockForm.notes || null });
            if (stockMode === "issue") return apiRequest("POST", "/api/admin/spare-parts/stock/issue", { sparePartId: partId, quantity: Number(stockForm.quantity), employeeId: Number(stockForm.employeeId), notes: stockForm.notes || null });
            return apiRequest("POST", "/api/admin/spare-parts/stock/count", { sparePartId: partId, location: stockForm.location, holderEmployeeId: stockForm.location === "technician" ? Number(stockForm.employeeId) : null, actualQuantity: Number(stockForm.actualQuantity), notes: stockForm.notes || null });
        },
        onSuccess: (r: any) => {
            qc.invalidateQueries({ queryKey: ["/api/admin/spare-parts"] });
            qc.invalidateQueries({ queryKey: ["/api/admin/spare-parts/stock/movements"] });
            setStockMode(null);
            toast({ title: "Recorded", description: r?.message });
        },
        onError: fail("Not recorded"),
    });
    const openStock = (mode: "receive" | "issue" | "count") => { setStockForm({ sparePartId: "", quantity: "", unitCostRupees: "", employeeId: "", location: "warehouse", actualQuantity: "", notes: "" }); setStockMode(mode); };

    const activeParts = useMemo(() => (parts.data ?? []).filter(p => p.isActive), [parts.data]);
    const enabledTechs = useMemo(() => technicians.filter(t => t.partsAccess === "active"), [technicians]);

    const CategoryPicker = ({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) => (
        <div className="flex flex-wrap gap-1.5">
            {categories.map(c => {
                const on = value.includes(c.id);
                return (
                    <button key={c.id} type="button" onClick={() => onChange(on ? value.filter(x => x !== c.id) : [...value, c.id])}
                        className={`rounded-md border px-2 py-1 text-xs transition ${on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50"}`}>
                        {c.name}
                    </button>
                );
            })}
            {categories.length === 0 && <span className="text-xs text-muted-foreground">No service categories yet.</span>}
        </div>
    );

    const PartSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger><SelectValue placeholder="Choose a part" /></SelectTrigger>
            <SelectContent>
                {activeParts.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.partCode} — {p.name} (warehouse {p.warehouseQty})</SelectItem>)}
            </SelectContent>
        </Select>
    );

    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Spare Parts</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        What technicians fit from UniteFix stock and what business partners buy. Customer price, trade price and cost live here and nowhere else.
                    </p>
                </div>
                <Button onClick={openNew}><Plus className="mr-1.5 h-4 w-4" /> New part</Button>
            </div>

            <Tabs defaultValue="catalogue">
                <TabsList>
                    <TabsTrigger value="catalogue"><Package className="mr-1.5 h-3.5 w-3.5" /> Catalogue</TabsTrigger>
                    <TabsTrigger value="proposals"><Inbox className="mr-1.5 h-3.5 w-3.5" /> Proposals{(proposals.data?.length ?? 0) > 0 && propStatus === "pending" && <span className="ml-1.5 rounded bg-primary/15 px-1.5 text-xs text-primary">{proposals.data!.length}</span>}</TabsTrigger>
                    <TabsTrigger value="stock"><Boxes className="mr-1.5 h-3.5 w-3.5" /> Stock</TabsTrigger>
                </TabsList>

                {/* ── Catalogue ─────────────────────────────────────────────── */}
                <TabsContent value="catalogue" className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-72">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search code, name, brand, spec" className="pl-8" />
                        </div>
                        <Button size="sm" variant={includeInactive ? "default" : "outline"} onClick={() => setIncludeInactive(v => !v)}>
                            {includeInactive ? "Showing retired" : "Show retired"}
                        </Button>
                    </div>
                    <Card>
                        <CardHeader className="pb-3"><CardTitle className="text-base font-medium">{parts.isLoading ? "Loading…" : `${parts.data?.length ?? 0} part${parts.data?.length === 1 ? "" : "s"}`}</CardTitle></CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader><TableRow>
                                        <TableHead>Code</TableHead><TableHead>Part</TableHead><TableHead>Categories</TableHead>
                                        <TableHead className="text-right">Customer ₹</TableHead><TableHead className="text-right">Trade ₹</TableHead><TableHead className="text-right">Cost ₹</TableHead>
                                        <TableHead className="text-right">Warehouse</TableHead><TableHead>Warranty</TableHead><TableHead className="text-right">Action</TableHead>
                                    </TableRow></TableHeader>
                                    <TableBody>
                                        {!parts.isLoading && (parts.data?.length ?? 0) === 0 && (
                                            <TableRow><TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">No parts yet. Add one, or approve a technician's proposal.</TableCell></TableRow>
                                        )}
                                        {(parts.data ?? []).map(p => (
                                            <TableRow key={p.id} className={!p.isActive ? "opacity-60" : ""}>
                                                <TableCell className="font-mono text-xs">{p.partCode}</TableCell>
                                                <TableCell>
                                                    <div className="text-sm font-medium">{p.name}{p.brand && <span className="ml-1.5 font-normal text-muted-foreground">{p.brand}</span>}</div>
                                                    {p.specification && <div className="text-xs text-muted-foreground">{p.specification}</div>}
                                                    {!p.isActive && <Badge variant="outline" className="mt-1 text-[10px]">Retired</Badge>}
                                                </TableCell>
                                                <TableCell><div className="flex flex-wrap gap-1">{p.categoryIds.map(id => <Badge key={id} variant="secondary" className="text-[10px] font-normal">{catName(id)}</Badge>)}</div></TableCell>
                                                <TableCell className="text-right tabular-nums">{p.unitPrice ?? "—"}</TableCell>
                                                <TableCell className="text-right tabular-nums">{p.tradePrice ?? <span className="text-muted-foreground">not B2B</span>}</TableCell>
                                                <TableCell className="text-right tabular-nums text-muted-foreground">{p.costPrice ?? "—"}</TableCell>
                                                <TableCell className="text-right tabular-nums">{p.warehouseQty}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground">{p.warrantyDays ? `${p.warrantyDays} d` : "none"}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button size="sm" variant="outline" onClick={() => openEdit(p)}>Edit</Button>
                                                    <Button size="sm" variant="ghost" className="ml-1" onClick={() => toggleActive.mutate(p)}>{p.isActive ? "Retire" : "Restore"}</Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Proposals ─────────────────────────────────────────────── */}
                <TabsContent value="proposals" className="space-y-4">
                    <div className="flex gap-2">
                        {["pending", "approved", "merged", "rejected", "all"].map(s => (
                            <Button key={s} size="sm" variant={propStatus === s ? "default" : "outline"} onClick={() => setPropStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</Button>
                        ))}
                    </div>
                    <Card>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader><TableRow>
                                    <TableHead>Proposed</TableHead><TableHead>Part</TableHead><TableHead>Bought from</TableHead><TableHead className="text-right">Indicative ₹</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
                                </TableRow></TableHeader>
                                <TableBody>
                                    {!proposals.isLoading && (proposals.data?.length ?? 0) === 0 && (
                                        <TableRow><TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">Nothing {propStatus === "all" ? "" : propStatus}. Technicians propose a part when they cannot find it in the catalogue.</TableCell></TableRow>
                                    )}
                                    {(proposals.data ?? []).map(p => (
                                        <TableRow key={p.id}>
                                            <TableCell className="text-xs">
                                                <div>{p.proposerName ?? "—"}</div>
                                                <div className="text-muted-foreground">{format(new Date(p.createdAt), "d MMM yyyy")}{p.jobRef && ` · ${p.jobRef}`}</div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-sm font-medium">{p.name}{p.brand && <span className="ml-1.5 font-normal text-muted-foreground">{p.brand}</span>}</div>
                                                <div className="text-xs text-muted-foreground">{[p.specification, p.categoryName].filter(Boolean).join(" · ")}</div>
                                                {p.photoUrl && <a href={p.photoUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Photo</a>}
                                            </TableCell>
                                            <TableCell className="text-sm">{p.vendorName ?? "—"}</TableCell>
                                            <TableCell className="text-right tabular-nums">{p.indicativePrice ?? "—"}</TableCell>
                                            <TableCell><Badge variant="secondary">{p.status}</Badge></TableCell>
                                            <TableCell className="text-right">
                                                {p.status === "pending" && (
                                                    <div className="flex justify-end gap-1">
                                                        <Button size="sm" onClick={() => openReview(p, "approve")}>Approve</Button>
                                                        <Button size="sm" variant="outline" onClick={() => openReview(p, "merge")}>Merge</Button>
                                                        <Button size="sm" variant="ghost" onClick={() => openReview(p, "reject")}>Reject</Button>
                                                    </div>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Stock ─────────────────────────────────────────────────── */}
                <TabsContent value="stock" className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => openStock("receive")}><ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" /> Receive purchase</Button>
                        <Button size="sm" variant="outline" onClick={() => openStock("issue")}><ArrowUpFromLine className="mr-1.5 h-3.5 w-3.5" /> Issue to technician</Button>
                        <Button size="sm" variant="outline" onClick={() => openStock("count")}><ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Record a count</Button>
                    </div>
                    <Card>
                        <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Movements</CardTitle></CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader><TableRow>
                                    <TableHead>When</TableHead><TableHead>Part</TableHead><TableHead>What</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Before → after</TableHead><TableHead>Notes</TableHead>
                                </TableRow></TableHeader>
                                <TableBody>
                                    {!movements.isLoading && (movements.data?.length ?? 0) === 0 && (
                                        <TableRow><TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">No stock movements yet. Receive a purchase to start.</TableCell></TableRow>
                                    )}
                                    {(movements.data ?? []).map(m => (
                                        <TableRow key={m.id}>
                                            <TableCell className="text-xs text-muted-foreground">{format(new Date(m.createdAt), "d MMM, HH:mm")}</TableCell>
                                            <TableCell className="text-sm"><span className="font-mono text-xs">{m.part.partCode}</span> {m.part.name}</TableCell>
                                            <TableCell className="text-sm">
                                                {MOVEMENT_LABEL[m.movementType] ?? m.movementType}
                                                {(m.toHolderEmployeeId || m.fromHolderEmployeeId) && <span className="text-muted-foreground"> · {techName(m.toHolderEmployeeId ?? m.fromHolderEmployeeId)}</span>}
                                            </TableCell>
                                            <TableCell className={`text-right tabular-nums ${m.quantity < 0 ? "text-rose-600" : "text-emerald-700"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity}</TableCell>
                                            <TableCell className="text-right tabular-nums text-muted-foreground">{m.stockBefore} → {m.stockAfter}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{m.notes}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* ── Part dialog ───────────────────────────────────────────────── */}
            <Dialog open={editing !== null} onOpenChange={o => !o && setEditing(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editing === "new" ? "New part" : `Edit ${(editing as Part)?.partCode ?? ""}`}</DialogTitle>
                        <DialogDescription>Customer price is billed on jobs. Trade price is what partners pay — leave it blank to keep the part off the B2B catalogue. Cost is never shown outside this screen.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2"><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Capacitor 2.5 µF" /></div>
                            <div><Label>Brand</Label><Input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="Havells" /></div>
                            <div><Label>Unit</Label><Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="piece" /></div>
                            <div className="col-span-2"><Label>Specification</Label><Input value={form.specification} onChange={e => setForm({ ...form, specification: e.target.value })} placeholder="2.5 µF, 440 V" /></div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div><Label>Customer ₹</Label><Input inputMode="decimal" value={form.unitPriceRupees} onChange={e => setForm({ ...form, unitPriceRupees: e.target.value })} /></div>
                            <div><Label>Trade ₹</Label><Input inputMode="decimal" value={form.tradePriceRupees} onChange={e => setForm({ ...form, tradePriceRupees: e.target.value })} placeholder="not B2B" /></div>
                            <div><Label>Cost ₹</Label><Input inputMode="decimal" value={form.costPriceRupees} onChange={e => setForm({ ...form, costPriceRupees: e.target.value })} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div><Label>Warranty (days)</Label><Input inputMode="numeric" value={form.warrantyDays} onChange={e => setForm({ ...form, warrantyDays: e.target.value })} /></div>
                            <div><Label>GST % (blank = default)</Label><Input inputMode="decimal" value={form.gstPercent} onChange={e => setForm({ ...form, gstPercent: e.target.value })} placeholder="18" /></div>
                        </div>
                        <div><Label className="mb-1.5 block">Categories — searched first on those jobs</Label><CategoryPicker value={form.categoryIds} onChange={ids => setForm({ ...form, categoryIds: ids })} /></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                        <Button disabled={!form.name.trim() || !form.unitPriceRupees.trim() || savePart.isPending} onClick={() => savePart.mutate()}>{savePart.isPending ? "Saving…" : "Save part"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Proposal review dialog ────────────────────────────────────── */}
            <Dialog open={!!reviewing} onOpenChange={o => !o && setReviewing(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{reviewMode === "approve" ? "Add to the catalogue" : reviewMode === "merge" ? "Merge into an existing part" : "Reject proposal"}</DialogTitle>
                        <DialogDescription>
                            {reviewing?.name}{reviewing?.brand && ` · ${reviewing.brand}`} — proposed by {reviewing?.proposerName ?? "a technician"}
                            {reviewing?.vendorName && `, bought from ${reviewing.vendorName}`}.
                            {reviewMode !== "reject" && " Their fitted line is re-pointed at the catalogue part without changing what the customer paid."}
                        </DialogDescription>
                    </DialogHeader>
                    {reviewMode === "approve" && (
                        <div className="grid gap-3">
                            <div className="grid grid-cols-3 gap-3">
                                <div><Label>Customer ₹</Label><Input inputMode="decimal" value={reviewForm.unitPriceRupees} onChange={e => setReviewForm({ ...reviewForm, unitPriceRupees: e.target.value })} /></div>
                                <div><Label>Trade ₹</Label><Input inputMode="decimal" value={reviewForm.tradePriceRupees} onChange={e => setReviewForm({ ...reviewForm, tradePriceRupees: e.target.value })} placeholder="not B2B" /></div>
                                <div><Label>Cost ₹</Label><Input inputMode="decimal" value={reviewForm.costPriceRupees} onChange={e => setReviewForm({ ...reviewForm, costPriceRupees: e.target.value })} /></div>
                            </div>
                            <div><Label>Warranty (days)</Label><Input inputMode="numeric" value={reviewForm.warrantyDays} onChange={e => setReviewForm({ ...reviewForm, warrantyDays: e.target.value })} /></div>
                            <div><Label className="mb-1.5 block">Categories</Label><CategoryPicker value={reviewForm.categoryIds} onChange={ids => setReviewForm({ ...reviewForm, categoryIds: ids })} /></div>
                        </div>
                    )}
                    {reviewMode === "merge" && (
                        <div>
                            <Label>Existing part</Label>
                            <Select value={reviewForm.mergeInto} onValueChange={v => setReviewForm({ ...reviewForm, mergeInto: v })}>
                                <SelectTrigger><SelectValue placeholder="Choose the part this already is" /></SelectTrigger>
                                <SelectContent>{activeParts.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.partCode} — {p.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    )}
                    {reviewMode === "reject" && (
                        <div><Label>Reason — the technician reads this</Label><Textarea rows={3} value={reviewForm.reason} onChange={e => setReviewForm({ ...reviewForm, reason: e.target.value })} /></div>
                    )}
                    {reviewMode !== "reject" && <div><Label>Notes (optional)</Label><Input value={reviewForm.notes} onChange={e => setReviewForm({ ...reviewForm, notes: e.target.value })} /></div>}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReviewing(null)}>Cancel</Button>
                        <Button
                            variant={reviewMode === "reject" ? "destructive" : "default"}
                            disabled={review.isPending || (reviewMode === "approve" && !reviewForm.unitPriceRupees.trim()) || (reviewMode === "merge" && !reviewForm.mergeInto) || (reviewMode === "reject" && reviewForm.reason.trim().length < 3)}
                            onClick={() => review.mutate()}
                        >
                            {review.isPending ? "Working…" : reviewMode === "approve" ? "Approve & add" : reviewMode === "merge" ? "Merge" : "Reject"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Stock dialog ──────────────────────────────────────────────── */}
            <Dialog open={!!stockMode} onOpenChange={o => !o && setStockMode(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{stockMode === "receive" ? "Receive a purchase" : stockMode === "issue" ? "Issue to a technician" : "Record a count"}</DialogTitle>
                        <DialogDescription>
                            {stockMode === "receive" && "Stock arriving at the warehouse."}
                            {stockMode === "issue" && "Moves stock from the warehouse into a parts-enabled technician's kit. It is consumed from their kit as they fit it."}
                            {stockMode === "count" && "Enter what is actually on the shelf. The difference is written down; a shortage on a technician's kit is suggested as a deposit draw."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                        <div><Label>Part</Label><PartSelect value={stockForm.sparePartId} onChange={v => setStockForm({ ...stockForm, sparePartId: v })} /></div>
                        {stockMode === "count" && (
                            <div><Label>Where</Label>
                                <Select value={stockForm.location} onValueChange={v => setStockForm({ ...stockForm, location: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent><SelectItem value="warehouse">Warehouse</SelectItem><SelectItem value="technician">A technician's kit</SelectItem></SelectContent>
                                </Select>
                            </div>
                        )}
                        {(stockMode === "issue" || (stockMode === "count" && stockForm.location === "technician")) && (
                            <div><Label>Technician</Label>
                                <Select value={stockForm.employeeId} onValueChange={v => setStockForm({ ...stockForm, employeeId: v })}>
                                    <SelectTrigger><SelectValue placeholder={enabledTechs.length ? "Choose" : "No parts-enabled technicians yet"} /></SelectTrigger>
                                    <SelectContent>{enabledTechs.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.partnerName}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        )}
                        {stockMode !== "count"
                            ? <div><Label>Quantity</Label><Input inputMode="numeric" value={stockForm.quantity} onChange={e => setStockForm({ ...stockForm, quantity: e.target.value })} /></div>
                            : <div><Label>Counted quantity</Label><Input inputMode="numeric" value={stockForm.actualQuantity} onChange={e => setStockForm({ ...stockForm, actualQuantity: e.target.value })} /></div>}
                        {stockMode === "receive" && <div><Label>Unit cost ₹ (optional)</Label><Input inputMode="decimal" value={stockForm.unitCostRupees} onChange={e => setStockForm({ ...stockForm, unitCostRupees: e.target.value })} /></div>}
                        <div><Label>Notes</Label><Input value={stockForm.notes} onChange={e => setStockForm({ ...stockForm, notes: e.target.value })} placeholder={stockMode === "receive" ? "Supplier, invoice no." : ""} /></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setStockMode(null)}>Cancel</Button>
                        <Button disabled={stockAction.isPending || !stockForm.sparePartId || (stockMode !== "count" ? !stockForm.quantity : !stockForm.actualQuantity) || ((stockMode === "issue" || (stockMode === "count" && stockForm.location === "technician")) && !stockForm.employeeId)} onClick={() => stockAction.mutate()}>
                            {stockAction.isPending ? "Recording…" : "Record"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
