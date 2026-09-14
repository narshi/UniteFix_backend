/**
 * Add-ons on one plan — attached from the operator's catalogue.
 *
 * Distinct from the plan's "benefits", which are marketing bullets printed on
 * the card and cost nothing. Everything here is CHARGED, appears as its own
 * line on the customer's bill, and is settled to the operator in full.
 *
 * The price comes from the catalogue, derived through its basis for THIS
 * plan's term (Rs.118/month × 12 on an annual plan). A row can override that
 * for this plan alone; leaving the override blank means "follow the
 * catalogue". Creating a new add-on happens on the catalogue page — one place
 * to define, many places to attach.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { Plus, X, Pin, PinOff } from "lucide-react";

type LinkRow = {
    id: number; planId: number; catalogId: number | null; label: string; kind: string; description: string | null;
    amount: number; unitAmount: number; pricingBasis: "flat" | "per_month"; months: number;
    catalogDefault: number | null; overridden: boolean; priceOverride: number | null;
    isOptional: boolean; exclusiveGroup: string | null; sortOrder: number; isActive: boolean; catalogRetired: boolean; legacy: boolean;
};
type Item = { id: number; name: string; kind: string; pricingBasis: "flat" | "per_month"; defaultPrice: number; defaultOptional: boolean; isActive: boolean };

export default function PlanAddonsEditor({ planId, planPrice }: { planId: number; planPrice: number }) {
    const { toast } = useToast();
    const qc = useQueryClient();
    const key = ["/api/ftth/admin/plans", planId, "addons"];
    const fail = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });
    const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["/api/ftth/admin/addons"] }); };

    const { data, isLoading } = useQuery<{ data: LinkRow[] }>({ queryKey: key, queryFn: async () => apiRequest("GET", `/api/ftth/admin/plans/${planId}/addons`) });
    const { data: catalogue } = useQuery<{ data: Item[] }>({ queryKey: ["/api/ftth/admin/addons"], queryFn: async () => apiRequest("GET", "/api/ftth/admin/addons") });
    const links = data?.data ?? [];
    const available = (catalogue?.data ?? []).filter(i => i.isActive && !links.some(l => l.catalogId === i.id));

    const [pick, setPick] = useState("");
    const [overrideDraft, setOverrideDraft] = useState<Record<number, string>>({});

    const attach = useMutation({
        mutationFn: async () => apiRequest("POST", `/api/ftth/admin/plans/${planId}/addons`, { catalogId: Number(pick) }),
        onSuccess: () => { refresh(); setPick(""); toast({ title: "Attached" }); },
        onError: fail("Not attached"),
    });
    const patch = useMutation({
        mutationFn: async (v: { id: number; body: Record<string, unknown> }) => apiRequest("PATCH", `/api/ftth/admin/plans/${planId}/addons/${v.id}`, v.body),
        onSuccess: () => refresh(),
        onError: fail("Not updated"),
    });
    const detach = useMutation({
        mutationFn: async (id: number) => apiRequest("DELETE", `/api/ftth/admin/plans/${planId}/addons/${id}`),
        onSuccess: (r: any) => { refresh(); toast({ title: "Detached", description: r?.message }); },
        onError: fail("Not detached"),
    });

    const mandatoryTotal = links.filter(l => l.isActive && !l.isOptional).reduce((s, l) => s + l.amount, 0);

    return (
        <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-3.5">
            <div className="mb-1 flex items-center justify-between">
                <Label className="text-sm font-semibold">Add-ons on this plan</Label>
                {mandatoryTotal > 0 && (
                    <span className="text-xs text-[hsl(215,20%,65%)]">
                        Card price ₹{planPrice} + ₹{mandatoryTotal} = <b className="text-white">₹{planPrice + mandatoryTotal}</b>
                    </span>
                )}
            </div>
            <p className="mb-3 text-xs text-[hsl(215,20%,65%)]">
                Priced from your <Link href="/operator/addons" className="underline">add-on catalogue</Link>. Set an override to pin a different price on this plan only.
            </p>

            {isLoading ? (
                <p className="text-xs text-[hsl(215,20%,55%)]">Loading…</p>
            ) : links.length === 0 ? (
                <p className="text-xs text-[hsl(215,20%,55%)]">None. This plan bills as a single broadband line.</p>
            ) : (
                <div className="space-y-1.5">
                    {links.map(l => (
                        <div key={l.id} className={`rounded-md border p-2 text-sm ${l.isActive ? "border-[rgba(255,255,255,0.08)]" : "border-[rgba(255,255,255,0.05)] opacity-50"}`}>
                            <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="truncate font-medium">{l.label}</span>
                                        <Badge variant="outline" className="shrink-0 text-[10px]">{l.isOptional ? "Optional" : "Always billed"}</Badge>
                                        {l.overridden && <Badge variant="outline" className="shrink-0 text-[10px] text-sky-300"><Pin className="mr-0.5 h-2.5 w-2.5" />custom</Badge>}
                                        {l.legacy && <Badge variant="outline" className="shrink-0 text-[10px] text-amber-400">not in catalogue</Badge>}
                                        {l.catalogRetired && <Badge variant="outline" className="shrink-0 text-[10px] text-amber-400">retired</Badge>}
                                    </div>
                                    <div className="text-xs text-[hsl(215,20%,55%)]">
                                        {l.overridden
                                            ? `Override ₹${l.amount}${l.catalogDefault != null ? ` (catalogue would be ₹${l.catalogDefault})` : ""}`
                                            : l.pricingBasis === "per_month" ? `₹${l.unitAmount} × ${l.months} months` : l.legacy ? "self-priced" : "catalogue price"}
                                    </div>
                                </div>
                                <span className="shrink-0 font-semibold">₹{l.amount}</span>
                                <Button size="sm" variant="ghost" className="h-7 px-2" title={l.isOptional ? "Make it always billed" : "Make it optional"}
                                    onClick={() => patch.mutate({ id: l.id, body: { isOptional: !l.isOptional } })}>{l.isOptional ? "opt" : "req"}</Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2" title="Detach from this plan" onClick={() => detach.mutate(l.id)}><X className="h-3.5 w-3.5" /></Button>
                            </div>
                            {!l.legacy && (
                                <div className="mt-1.5 flex items-center gap-2">
                                    <Input className="h-7 w-28 text-xs" inputMode="decimal" placeholder="override ₹" value={overrideDraft[l.id] ?? ""} onChange={e => setOverrideDraft({ ...overrideDraft, [l.id]: e.target.value })} />
                                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!(overrideDraft[l.id] ?? "").trim()}
                                        onClick={() => { patch.mutate({ id: l.id, body: { priceOverrideRupees: Number(overrideDraft[l.id]) } }); setOverrideDraft({ ...overrideDraft, [l.id]: "" }); }}><Pin className="mr-1 h-3 w-3" />Pin price</Button>
                                    {l.overridden && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => patch.mutate({ id: l.id, body: { priceOverrideRupees: null } })}><PinOff className="mr-1 h-3 w-3" />Follow catalogue</Button>}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-3 flex items-center gap-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
                <Select value={pick} onValueChange={setPick}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={available.length ? "Attach from catalogue" : (catalogue?.data?.length ? "Everything is attached" : "Catalogue is empty")} /></SelectTrigger>
                    <SelectContent>
                        {available.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name} — ₹{i.defaultPrice}{i.pricingBasis === "per_month" ? "/mo" : ""}{i.defaultOptional ? "" : " · always billed"}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Button size="sm" className="h-8" disabled={!pick || attach.isPending} onClick={() => attach.mutate()}><Plus className="mr-1 h-3.5 w-3.5" />{attach.isPending ? "…" : "Attach"}</Button>
            </div>
            {(catalogue?.data?.length ?? 0) === 0 && (
                <p className="mt-2 text-xs text-[hsl(215,20%,55%)]">Create add-ons on the <Link href="/operator/addons" className="underline">catalogue page</Link> first.</p>
            )}
        </div>
    );
}
