/**
 * Billed extras on one plan — telephone rental, an OTT pack, a static IP.
 *
 * Distinct from the plan's "benefits", which are marketing bullets printed on
 * the card and cost nothing. Everything here is CHARGED, appears as its own line
 * on the customer's bill, and is settled to the operator in full.
 *
 * Two kinds, and the difference is the whole point:
 *   - Always billed  — part of the package. The customer cannot decline it, and
 *                      it is inside the price shown on the plan card.
 *   - Optional       — the customer ticks it at recharge. NOT in the card price,
 *                      because quoting a price for something nobody has agreed
 *                      to would overstate what the plan costs.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { Plus, Trash2, RotateCcw } from "lucide-react";

type Addon = {
    id: number;
    planId: number;
    label: string;
    kind: string;
    amount: number;
    isOptional: boolean;
    description: string | null;
    sortOrder: number;
    isActive: boolean;
};

const KINDS: Array<{ value: string; label: string }> = [
    { value: "telephone", label: "Telephone" },
    { value: "ott", label: "OTT pack" },
    { value: "iptv", label: "IPTV" },
    { value: "static_ip", label: "Static IP" },
    { value: "installation", label: "Installation" },
    { value: "other", label: "Other" },
];

export default function PlanAddonsEditor({ planId, planPrice }: { planId: number; planPrice: number }) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const key = ["/api/ftth/admin/plans", planId, "addons"];

    const [label, setLabel] = useState("");
    const [kind, setKind] = useState("telephone");
    const [amount, setAmount] = useState("");
    const [isOptional, setIsOptional] = useState(false);

    const { data, isLoading } = useQuery<{ data: Addon[] }>({
        queryKey: key,
        queryFn: async () => {
            return apiRequest("GET", `/api/ftth/admin/plans/${planId}/addons`);
        },
    });

    const addons = data?.data ?? [];
    const refresh = () => queryClient.invalidateQueries({ queryKey: key });

    const create = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/ftth/admin/plans/${planId}/addons`, {
                label: label.trim(),
                kind,
                amountRupees: Number(amount),
                isOptional,
                sortOrder: addons.length,
            });
            return res;
        },
        onSuccess: () => {
            refresh();
            setLabel("");
            setAmount("");
            setIsOptional(false);
            toast({ title: "Add-on saved" });
        },
        onError: (e: Error) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
    });

    const update = useMutation({
        mutationFn: async (vars: { id: number; body: Record<string, unknown> }) => {
            const res = await apiRequest("PATCH", `/api/ftth/admin/plans/${planId}/addons/${vars.id}`, vars.body);
            return res;
        },
        onSuccess: () => refresh(),
        onError: (e: Error) => toast({ title: "Not updated", description: apiErrorMessage(e), variant: "destructive" }),
    });

    // Retire rather than delete: an operator pulling an OTT pack for the season
    // almost always wants it back with the same price. The DELETE route supports
    // a hard removal, but nothing here needs to offer it.

    // What a customer pays with nothing optional ticked — the figure the plan
    // card shows. Worth printing here because it is the number the operator is
    // actually deciding when they mark something "always billed".
    const mandatoryTotal = addons
        .filter(a => a.isActive && !a.isOptional)
        .reduce((sum, a) => sum + a.amount, 0);

    return (
        <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-3.5">
            <div className="mb-1 flex items-center justify-between">
                <Label className="text-sm font-semibold">Billed add-ons</Label>
                {mandatoryTotal > 0 && (
                    <span className="text-xs text-[hsl(215,20%,65%)]">
                        Card price ₹{planPrice} + ₹{mandatoryTotal} = <b className="text-white">₹{planPrice + mandatoryTotal}</b>
                    </span>
                )}
            </div>
            <p className="mb-3 text-xs text-[hsl(215,20%,65%)]">
                Charged on top of the plan and shown as their own lines on the bill. Settled to
                you in full — UniteFix takes nothing from them.
            </p>

            {isLoading ? (
                <p className="text-xs text-[hsl(215,20%,55%)]">Loading…</p>
            ) : addons.length === 0 ? (
                <p className="text-xs text-[hsl(215,20%,55%)]">
                    No add-ons. This plan bills as a single broadband line.
                </p>
            ) : (
                <div className="space-y-1.5">
                    {addons.map(a => (
                        <div
                            key={a.id}
                            className={`flex items-center gap-2 rounded-md border p-2 text-sm ${
                                a.isActive
                                    ? "border-[rgba(255,255,255,0.08)]"
                                    : "border-[rgba(255,255,255,0.05)] opacity-50"
                            }`}
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="truncate font-medium">{a.label}</span>
                                    <Badge variant="outline" className="shrink-0 text-[10px]">
                                        {a.isOptional ? "Optional" : "Always billed"}
                                    </Badge>
                                    {!a.isActive && (
                                        <Badge variant="outline" className="shrink-0 text-[10px] text-amber-400">
                                            Retired
                                        </Badge>
                                    )}
                                </div>
                            </div>
                            <span className="shrink-0 font-semibold">₹{a.amount}</span>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                title={a.isActive ? "Stop offering this" : "Offer it again"}
                                onClick={() => update.mutate({ id: a.id, body: { isActive: !a.isActive } })}
                            >
                                {a.isActive
                                    ? <Trash2 className="h-3.5 w-3.5" />
                                    : <RotateCcw className="h-3.5 w-3.5" />}
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            {/* Add a new one */}
            <div className="mt-3 space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
                <div className="grid grid-cols-[1fr_110px_90px] gap-2">
                    <Input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Telephone"
                        className="h-8 text-sm"
                    />
                    <Select value={kind} onValueChange={setKind}>
                        <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {KINDS.map(k => (
                                <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Input
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        inputMode="decimal"
                        placeholder="₹118"
                        className="h-8 text-sm"
                    />
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Switch id={`opt-${planId}`} checked={isOptional} onCheckedChange={setIsOptional} />
                        <Label htmlFor={`opt-${planId}`} className="text-xs text-[hsl(215,20%,75%)]">
                            {isOptional
                                ? "Customer chooses this at recharge"
                                : "Always billed with this plan"}
                        </Label>
                    </div>
                    <Button
                        size="sm"
                        className="h-8"
                        disabled={!label.trim() || !amount.trim() || create.isPending}
                        onClick={() => create.mutate()}
                    >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        {create.isPending ? "Adding…" : "Add"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
