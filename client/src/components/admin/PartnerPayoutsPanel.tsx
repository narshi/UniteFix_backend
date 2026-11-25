/**
 * A partner's payouts: what is owed, their schedule and automatic limit (set
 * per partner), an open request, recent payouts, and "Pay now" for when a
 * partner calls and asks to be paid.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

type Overview = {
    settings: { schedule: string; scheduleLabel: string; nextDue: string | null; autoLimit: number | null; minimum: number; onHold: boolean; holdReason: string | null };
    owed: number; offset: number; bankReady: boolean; bankLast4: string | null;
    openRequest: { id: number; at: string; note: string | null } | null;
    runs: Array<{ id: number; code: string; status: string; amount: number; origin: string; reference: string | null; at: string; failure: string | null }>;
};
const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);

export default function PartnerPayoutsPanel({ partnerId }: { partnerId: number }) {
    const { toast } = useToast();
    const qc = useQueryClient();
    const key = ["/api/admin/hub/partners", partnerId, "payouts"];
    const { data } = useQuery<Overview>({ queryKey: key, queryFn: async () => (await apiRequest("GET", `/api/admin/hub/partners/${partnerId}/payouts`)).data });
    const [form, setForm] = useState({ schedule: "weekly", autoLimit: "", minimum: "100", onHold: false, holdReason: "" });
    const [utr, setUtr] = useState("");
    useEffect(() => {
        if (!data) return;
        setForm({ schedule: data.settings.schedule, autoLimit: data.settings.autoLimit == null ? "" : String(data.settings.autoLimit), minimum: String(data.settings.minimum ?? 0), onHold: data.settings.onHold, holdReason: data.settings.holdReason ?? "" });
    }, [data]);
    const refresh = () => qc.invalidateQueries({ queryKey: key });

    const save = useMutation({
        mutationFn: async () => apiRequest("PUT", `/api/admin/hub/partners/${partnerId}/payout-settings`, {
            schedule: form.schedule, autoLimitRupees: form.autoLimit.trim() === "" ? null : Number(form.autoLimit), minimumRupees: Number(form.minimum || 0),
            onHold: form.onHold, holdReason: form.onHold ? form.holdReason : null,
        }),
        onSuccess: () => { toast({ title: "Payout settings saved" }); refresh(); },
        onError: (e) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
    });
    const pay = useMutation({
        mutationFn: async (how: { method: "cashfree" } | { method: "manual"; reference: string }) => apiRequest("POST", `/api/admin/hub/partners/${partnerId}/payouts/pay-now`, how),
        onSuccess: (r: any) => { toast({ title: r?.message ?? "Paid" }); setUtr(""); refresh(); },
        onError: (e) => toast({ title: "Not paid", description: apiErrorMessage(e), variant: "destructive" }),
    });

    if (!data) return <p className="text-sm text-muted-foreground">Loading payouts…</p>;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">Owed now</div><div className="text-xl font-semibold">{inr(data.owed)}</div>{data.offset > 0 && <div className="text-xs text-muted-foreground">after {inr(data.offset)} set off against dues</div>}</div>
                <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">Schedule</div><div className="font-medium">{data.settings.scheduleLabel}</div><div className="text-xs text-muted-foreground">{data.settings.nextDue ? `Next: ${data.settings.nextDue}` : "Paid when asked"}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">Bank</div><div className="font-medium">{data.bankReady ? `Verified · ending ${data.bankLast4}` : "Not verified"}</div>{!data.bankReady && <div className="text-xs text-rose-700">No payout until the bank account is verified (Checks tab).</div>}</div>
            </div>

            {data.openRequest && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                    The partner asked to be paid on {new Date(data.openRequest.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{data.openRequest.note ? `: "${data.openRequest.note}"` : "."}
                </div>
            )}

            <div className="rounded-md border p-3 space-y-3">
                <div className="font-medium">Pay now</div>
                <div className="flex flex-wrap items-end gap-2">
                    <Button disabled={pay.isPending || data.owed <= 0 || !data.bankReady} onClick={() => pay.mutate({ method: "cashfree" })}>Pay {inr(data.owed)} through Cashfree</Button>
                    <span className="text-xs text-muted-foreground">or, if you already transferred it:</span>
                    <Input className="w-48" placeholder="Bank UTR" value={utr} onChange={(e) => setUtr(e.target.value)} />
                    <Button variant="outline" disabled={pay.isPending || data.owed <= 0 || utr.trim().length < 4} onClick={() => pay.mutate({ method: "manual", reference: utr.trim() })}>Record manual payment</Button>
                </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
                <div className="font-medium">Payout settings for this partner</div>
                <div className="grid grid-cols-3 gap-3">
                    <div>
                        <Label className="text-xs">Schedule</Label>
                        <Select value={form.schedule} onValueChange={(v) => setForm({ ...form, schedule: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="weekly">Every Monday</SelectItem>
                                <SelectItem value="fortnightly">1st and 16th</SelectItem>
                                <SelectItem value="monthly">1st of the month</SelectItem>
                                <SelectItem value="on_request">Only when asked</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="text-xs">Pay automatically up to (₹)</Label>
                        <Input type="number" value={form.autoLimit} onChange={(e) => setForm({ ...form, autoLimit: e.target.value })} placeholder="Empty: always ask staff" />
                    </div>
                    <div>
                        <Label className="text-xs">Minimum payout (₹)</Label>
                        <Input type="number" value={form.minimum} onChange={(e) => setForm({ ...form, minimum: e.target.value })} />
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.onHold} onChange={(e) => setForm({ ...form, onHold: e.target.checked })} /> Hold payouts</label>
                    {form.onHold && <Input className="flex-1" placeholder="Why (the partner sees this)" value={form.holdReason} onChange={(e) => setForm({ ...form, holdReason: e.target.value })} />}
                    <Button className="ml-auto" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save settings</Button>
                </div>
                <p className="text-xs text-muted-foreground">On schedule, a payout within the automatic limit goes out through Cashfree by itself; anything above it waits in Partner Payouts for approval. A partner can always ask to be paid early.</p>
            </div>

            <div>
                <div className="mb-2 font-medium text-sm">Recent payouts</div>
                {data.runs.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
                    <div className="divide-y rounded-md border text-sm">
                        {data.runs.map((r) => (
                            <div key={r.id} className="flex flex-wrap items-center gap-2 p-2">
                                <span className="font-mono text-xs">{r.code}</span>
                                <Badge variant="secondary">{r.status}</Badge>
                                <span className="text-xs text-muted-foreground">{r.origin === "schedule" ? "scheduled" : r.origin === "request" ? "on request" : "by staff"}</span>
                                <span className="ml-auto font-medium">{inr(r.amount)}</span>
                                {r.reference && <span className="text-xs text-muted-foreground">UTR {r.reference}</span>}
                                {r.failure && <span className="w-full text-xs text-rose-700">{r.failure}</span>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
