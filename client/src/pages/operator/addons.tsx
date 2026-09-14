/**
 * Add-on catalogue — the operator's master price list.
 *
 * Telephone rental, OTT packs, static IPs: priced ONCE here. Every plan that
 * links an item derives its own figure through the pricing basis (a per-month
 * item is multiplied by the plan's term), unless that plan carries an override.
 * Change the price here and every plan without an override follows — the
 * response says how many, so the blast radius is visible before it lands.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { Plus, Link2, RotateCcw, Archive, Pencil } from "lucide-react";

type Item = {
    id: number; name: string; kind: string; description: string | null; pricingBasis: "flat" | "per_month";
    defaultPrice: number; defaultOptional: boolean; exclusiveGroup: string | null; sortOrder: number; isActive: boolean;
    usedByPlans: number; overriddenOn: number;
};
type PlanRow = { id: number; name: string; speedMbps: number; durationMonths: number; isActive: boolean };

const KINDS = [
    { value: "telephone", label: "Telephone" }, { value: "ott", label: "OTT pack" }, { value: "iptv", label: "IPTV" },
    { value: "static_ip", label: "Static IP" }, { value: "installation", label: "Installation" }, { value: "other", label: "Other" },
];
const blank = { name: "", kind: "telephone", description: "", pricingBasis: "flat" as "flat" | "per_month", defaultPriceRupees: "", defaultOptional: true, exclusiveGroup: "" };

export default function OperatorAddons() {
    const { toast } = useToast();
    const qc = useQueryClient();
    const fail = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });
    const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/ftth/admin/addons"] }); qc.invalidateQueries({ queryKey: ["/api/ftth/admin/plans"] }); };

    const items = useQuery<Item[]>({ queryKey: ["/api/ftth/admin/addons"], queryFn: async () => (await apiRequest("GET", "/api/ftth/admin/addons")).data });
    const { data: plansRes } = useQuery<{ data: PlanRow[] }>({ queryKey: ["/api/ftth/admin/plans"] });
    const plans = plansRes?.data ?? [];
    const speeds = Array.from(new Set(plans.filter(p => p.isActive).map(p => p.speedMbps))).sort((a, b) => a - b);

    const [editing, setEditing] = useState<Item | "new" | null>(null);
    const [form, setForm] = useState(blank);
    const openNew = () => { setForm(blank); setEditing("new"); };
    const openEdit = (i: Item) => {
        setForm({ name: i.name, kind: i.kind, description: i.description ?? "", pricingBasis: i.pricingBasis, defaultPriceRupees: String(i.defaultPrice), defaultOptional: i.defaultOptional, exclusiveGroup: i.exclusiveGroup ?? "" });
        setEditing(i);
    };
    const save = useMutation({
        mutationFn: async () => {
            const body = { name: form.name.trim(), kind: form.kind, description: form.description.trim() || null, pricingBasis: form.pricingBasis, defaultPriceRupees: Number(form.defaultPriceRupees), defaultOptional: form.defaultOptional, exclusiveGroup: form.exclusiveGroup.trim() || null };
            return editing === "new" ? apiRequest("POST", "/api/ftth/admin/addons", body) : apiRequest("PATCH", `/api/ftth/admin/addons/${(editing as Item).id}`, body);
        },
        onSuccess: (r: any) => { refresh(); setEditing(null); toast({ title: "Saved", description: r?.message }); },
        onError: fail("Not saved"),
    });
    const toggle = useMutation({
        mutationFn: async (i: Item) => i.isActive ? apiRequest("DELETE", `/api/ftth/admin/addons/${i.id}`) : apiRequest("PATCH", `/api/ftth/admin/addons/${i.id}`, { isActive: true }),
        onSuccess: (r: any) => { refresh(); toast({ title: "Done", description: r?.message }); },
        onError: fail("Not done"),
    });

    const [attaching, setAttaching] = useState<Item | null>(null);
    const [attachMode, setAttachMode] = useState<"all" | "speed" | "plans">("all");
    const [attachSpeed, setAttachSpeed] = useState("");
    const [attachPlans, setAttachPlans] = useState<number[]>([]);
    const attach = useMutation({
        mutationFn: async () => apiRequest("POST", `/api/ftth/admin/addons/${attaching!.id}/attach`,
            attachMode === "all" ? { all: true } : attachMode === "speed" ? { speedMbps: Number(attachSpeed) } : { planIds: attachPlans }),
        onSuccess: (r: any) => { refresh(); setAttaching(null); toast({ title: "Attached", description: r?.message }); },
        onError: fail("Not attached"),
    });

    return (
        <div className="p-6 lg:p-8 space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white tracking-tight">Add-on catalogue</h1>
                    <p className="text-sm text-[hsl(215,20%,65%)] mt-1 max-w-2xl">
                        Telephone rental, OTT packs, static IPs — priced once. Plans link to these and follow the price; a plan can override it for itself.
                    </p>
                </div>
                <Button onClick={openNew}><Plus className="mr-1.5 h-4 w-4" /> New add-on</Button>
            </header>

            <Card className="bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.08)]">
                <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-white">{items.isLoading ? "Loading…" : `${items.data?.length ?? 0} add-on${items.data?.length === 1 ? "" : "s"}`}</CardTitle></CardHeader>
                <CardContent className="p-0">
                    <table className="w-full text-sm">
                        <thead className="text-xs uppercase tracking-wide text-[hsl(215,20%,55%)]">
                            <tr className="border-b border-[rgba(255,255,255,0.08)]">
                                <th className="px-4 py-2 text-left">Add-on</th><th className="px-4 py-2 text-left">Basis</th><th className="px-4 py-2 text-right">Price ₹</th>
                                <th className="px-4 py-2 text-left">Default</th><th className="px-4 py-2 text-right">Used by</th><th className="px-4 py-2 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!items.isLoading && (items.data?.length ?? 0) === 0 && (
                                <tr><td colSpan={6} className="px-4 py-12 text-center text-[hsl(215,20%,55%)]">No add-ons yet. Create "Telephone" once and attach it to every plan.</td></tr>
                            )}
                            {(items.data ?? []).map(i => (
                                <tr key={i.id} className={`border-b border-[rgba(255,255,255,0.05)] ${!i.isActive ? "opacity-50" : ""}`}>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-white">{i.name} <span className="text-xs font-normal text-[hsl(215,20%,55%)]">{KINDS.find(k => k.value === i.kind)?.label}</span></div>
                                        {i.description && <div className="text-xs text-[hsl(215,20%,55%)]">{i.description}</div>}
                                        {i.exclusiveGroup && <Badge variant="outline" className="mt-1 text-[10px]">pick one: {i.exclusiveGroup}</Badge>}
                                        {!i.isActive && <Badge variant="outline" className="ml-1 mt-1 text-[10px] text-amber-400">Retired</Badge>}
                                    </td>
                                    <td className="px-4 py-3 text-[hsl(215,20%,75%)]">{i.pricingBasis === "per_month" ? "per month" : "flat"}</td>
                                    <td className="px-4 py-3 text-right tabular-nums text-white">{i.defaultPrice}</td>
                                    <td className="px-4 py-3 text-[hsl(215,20%,75%)]">{i.defaultOptional ? "Optional" : "Always billed"}</td>
                                    <td className="px-4 py-3 text-right tabular-nums text-[hsl(215,20%,75%)]">{i.usedByPlans} plan{i.usedByPlans === 1 ? "" : "s"}{i.overriddenOn > 0 && <span className="text-xs"> · {i.overriddenOn} override</span>}</td>
                                    <td className="px-4 py-3 text-right">
                                        <Button size="sm" variant="ghost" className="h-7 px-2" title="Attach to plans" disabled={!i.isActive} onClick={() => { setAttaching(i); setAttachMode("all"); setAttachPlans([]); setAttachSpeed(speeds[0] ? String(speeds[0]) : ""); }}><Link2 className="h-3.5 w-3.5" /></Button>
                                        <Button size="sm" variant="ghost" className="h-7 px-2" title="Edit" onClick={() => openEdit(i)}><Pencil className="h-3.5 w-3.5" /></Button>
                                        <Button size="sm" variant="ghost" className="h-7 px-2" title={i.isActive ? "Retire" : "Restore"} onClick={() => toggle.mutate(i)}>{i.isActive ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}</Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </CardContent>
            </Card>

            <Dialog open={editing !== null} onOpenChange={o => !o && setEditing(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editing === "new" ? "New add-on" : `Edit ${(editing as Item)?.name ?? ""}`}</DialogTitle>
                        <DialogDescription>
                            {editing !== "new" && (editing as Item)?.usedByPlans > 0
                                ? `Changing the price reaches ${(editing as Item).usedByPlans - (editing as Item).overriddenOn} plan(s) that follow it${(editing as Item).overriddenOn ? `; ${(editing as Item).overriddenOn} keep their own override` : ""}.`
                                : "Per-month items are multiplied by each plan's term; flat items are charged once."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                        <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Telephone" /></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div><Label>Type</Label>
                                <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{KINDS.map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent></Select></div>
                            <div><Label>Basis</Label>
                                <Select value={form.pricingBasis} onValueChange={v => setForm({ ...form, pricingBasis: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="flat">Flat — charged once</SelectItem><SelectItem value="per_month">Per month × plan term</SelectItem></SelectContent></Select></div>
                        </div>
                        <div><Label>{form.pricingBasis === "per_month" ? "Price per month ₹" : "Price ₹"}</Label><Input inputMode="decimal" value={form.defaultPriceRupees} onChange={e => setForm({ ...form, defaultPriceRupees: e.target.value })} placeholder="118" /></div>
                        <div><Label>Description (shown to customers)</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                        <div><Label>Pick-one group (optional)</Label><Input value={form.exclusiveGroup} onChange={e => setForm({ ...form, exclusiveGroup: e.target.value })} placeholder="e.g. hotstar — Basic and Premium can't both be chosen" /></div>
                        <div className="flex items-center gap-2"><Switch id="opt" checked={form.defaultOptional} onCheckedChange={v => setForm({ ...form, defaultOptional: v })} /><Label htmlFor="opt" className="text-sm">{form.defaultOptional ? "Optional — customer chooses at recharge" : "Always billed with the plan"}</Label></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                        <Button disabled={!form.name.trim() || !form.defaultPriceRupees.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!attaching} onOpenChange={o => !o && setAttaching(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Attach "{attaching?.name}" to plans</DialogTitle>
                        <DialogDescription>Plans that already have it are skipped. Each plan follows the catalogue price until you override it on that plan.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                        <div className="flex gap-2">
                            {(["all", "speed", "plans"] as const).map(m => <Button key={m} size="sm" variant={attachMode === m ? "default" : "outline"} onClick={() => setAttachMode(m)}>{m === "all" ? "Every plan" : m === "speed" ? "One speed" : "Pick plans"}</Button>)}
                        </div>
                        {attachMode === "speed" && (
                            <Select value={attachSpeed} onValueChange={setAttachSpeed}><SelectTrigger><SelectValue placeholder="Speed" /></SelectTrigger><SelectContent>{speeds.map(s => <SelectItem key={s} value={String(s)}>{s} Mbps — {plans.filter(p => p.speedMbps === s && p.isActive).length} plan(s)</SelectItem>)}</SelectContent></Select>
                        )}
                        {attachMode === "plans" && (
                            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                                {plans.filter(p => p.isActive).map(p => (
                                    <label key={p.id} className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={attachPlans.includes(p.id)} onChange={e => setAttachPlans(e.target.checked ? [...attachPlans, p.id] : attachPlans.filter(x => x !== p.id))} />
                                        {p.speedMbps} Mbps · {p.durationMonths} mo — {p.name}
                                    </label>
                                ))}
                            </div>
                        )}
                        {attaching?.pricingBasis === "per_month" && <p className="text-xs text-[hsl(215,20%,65%)]">₹{attaching.defaultPrice}/month: a 12-month plan will show ₹{attaching.defaultPrice * 12}.</p>}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAttaching(null)}>Cancel</Button>
                        <Button disabled={attach.isPending || (attachMode === "speed" && !attachSpeed) || (attachMode === "plans" && attachPlans.length === 0)} onClick={() => attach.mutate()}>{attach.isPending ? "Attaching…" : "Attach"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
