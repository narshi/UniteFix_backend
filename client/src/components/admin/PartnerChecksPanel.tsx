/**
 * A partner's identity checks: what their partner types need, where each
 * stands, and the two ways to do one — run it through Cashfree, or record a
 * check done by hand (with a note, and the document compared).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

type Check = { id: number; check: string; status: string; method: string; subject: string | null; nameFound: string | null; nameMatch: string | null; validUntil: string | null; reference: string | null; note: string | null; createdAt: string };
type Item = { code: string; label: string; required: boolean; automatic: boolean; passed: boolean; expired: boolean; latest: Check | null };
type Summary = { automaticConfigured: boolean; items: Item[]; allRequiredPassed: boolean; history: Check[] };

const TONE: Record<string, string> = {
    verified: "bg-emerald-100 text-emerald-800", failed: "bg-rose-100 text-rose-800", needs_review: "bg-amber-100 text-amber-800", manual_required: "bg-slate-100 text-slate-700",
};
const WORD: Record<string, string> = { verified: "Verified", failed: "Not verified", needs_review: "Needs review", manual_required: "Check by hand" };
const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function PartnerChecksPanel({ partnerId }: { partnerId: number }) {
    const { toast } = useToast();
    const qc = useQueryClient();
    const key = ["/api/admin/hub/partners", partnerId, "checks"];
    const { data, isLoading } = useQuery<Summary>({ queryKey: key, queryFn: async () => (await apiRequest("GET", `/api/admin/hub/partners/${partnerId}/checks`)).data });
    const [manual, setManual] = useState<{ code: string; status: "verified" | "failed"; note: string; validUntil: string } | null>(null);
    const [extra, setExtra] = useState<{ code: string; dlNumber: string; dob: string; rcNumber: string } | null>(null);
    const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["/api/admin/business-partners"] }); };

    const run = useMutation({
        mutationFn: async (body: Record<string, unknown>) => apiRequest("POST", `/api/admin/hub/partners/${partnerId}/checks/run`, body),
        onSuccess: (r: any) => { toast({ title: r?.message ?? "Done" }); setExtra(null); refresh(); },
        onError: (e) => toast({ title: "Check did not run", description: apiErrorMessage(e), variant: "destructive" }),
    });
    const record = useMutation({
        mutationFn: async () => apiRequest("POST", `/api/admin/hub/partners/${partnerId}/checks/manual`, { check: manual!.code, status: manual!.status, note: manual!.note, validUntil: manual!.validUntil || null }),
        onSuccess: (r: any) => { toast({ title: r?.message ?? "Recorded" }); setManual(null); refresh(); },
        onError: (e) => toast({ title: "Not recorded", description: apiErrorMessage(e), variant: "destructive" }),
    });

    if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading checks…</p>;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className={data.allRequiredPassed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
                    {data.allRequiredPassed ? "Every required check passed" : "Checks outstanding"}
                </Badge>
                {!data.automaticConfigured && <span className="text-xs text-muted-foreground">Automatic checks are off (no Cashfree verification keys): record checks by hand.</span>}
                <Button size="sm" variant="outline" className="ml-auto" disabled={run.isPending || !data.automaticConfigured} onClick={() => run.mutate({})}>Run all automatic checks</Button>
            </div>

            <div className="divide-y rounded-md border">
                {data.items.map((i) => (
                    <div key={i.code} className="space-y-2 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{i.label}</span>
                            {i.required ? <span className="text-xs text-muted-foreground">required</span> : <span className="text-xs text-muted-foreground">optional</span>}
                            {i.latest ? <Badge variant="secondary" className={TONE[i.expired ? "failed" : i.latest.status]}>{i.expired ? "Expired" : WORD[i.latest.status] ?? i.latest.status}</Badge> : <Badge variant="secondary">Not checked</Badge>}
                            <div className="ml-auto flex gap-2">
                                {i.automatic && (
                                    <Button size="sm" variant="outline" disabled={run.isPending || !data.automaticConfigured}
                                        onClick={() => (i.code === "driving_licence" || i.code === "vehicle_rc") ? setExtra({ code: i.code, dlNumber: "", dob: "", rcNumber: "" }) : run.mutate({ check: i.code })}>
                                        Check with Cashfree
                                    </Button>
                                )}
                                <Button size="sm" variant="ghost" onClick={() => setManual({ code: i.code, status: "verified", note: "", validUntil: "" })}>Record by hand</Button>
                            </div>
                        </div>
                        {i.latest && (
                            <div className="text-xs text-muted-foreground">
                                {i.latest.method === "cashfree" ? "Cashfree" : "By hand"} · {when(i.latest.createdAt)}
                                {i.latest.subject && <> · {i.latest.subject}</>}
                                {i.latest.nameFound && <> · registered to <span className="font-medium text-foreground">{i.latest.nameFound}</span>{i.latest.nameMatch && ` (${i.latest.nameMatch})`}</>}
                                {i.latest.validUntil && <> · valid until {i.latest.validUntil}</>}
                                {i.latest.note && <div className="mt-1 text-foreground">{i.latest.note}</div>}
                            </div>
                        )}
                        {extra?.code === i.code && (
                            <div className="grid grid-cols-3 gap-2">
                                {i.code === "driving_licence" ? (
                                    <>
                                        <div><Label className="text-xs">Licence number</Label><Input value={extra.dlNumber} onChange={(e) => setExtra({ ...extra, dlNumber: e.target.value })} placeholder="KA0120198900984" /></div>
                                        <div><Label className="text-xs">Date of birth</Label><Input type="date" value={extra.dob} onChange={(e) => setExtra({ ...extra, dob: e.target.value })} /></div>
                                    </>
                                ) : (
                                    <div className="col-span-2"><Label className="text-xs">Vehicle number</Label><Input value={extra.rcNumber} onChange={(e) => setExtra({ ...extra, rcNumber: e.target.value })} placeholder="KA31AB1234" /></div>
                                )}
                                <div className="flex items-end gap-2">
                                    <Button size="sm" disabled={run.isPending} onClick={() => run.mutate(i.code === "driving_licence" ? { check: i.code, dlNumber: extra.dlNumber, dob: extra.dob } : { check: i.code, rcNumber: extra.rcNumber })}>Check</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setExtra(null)}>Cancel</Button>
                                </div>
                            </div>
                        )}
                        {manual?.code === i.code && (
                            <div className="space-y-2 rounded-md bg-muted/40 p-3">
                                <div className="flex gap-2">
                                    <Button size="sm" variant={manual.status === "verified" ? "default" : "outline"} onClick={() => setManual({ ...manual, status: "verified" })}>Verified</Button>
                                    <Button size="sm" variant={manual.status === "failed" ? "destructive" : "outline"} onClick={() => setManual({ ...manual, status: "failed" })}>Not verified</Button>
                                    {(i.code === "fssai" || i.code === "driving_licence" || i.code === "vehicle_rc") && (
                                        <div className="ml-auto flex items-center gap-2"><Label className="text-xs">Valid until</Label><Input type="date" className="h-8 w-40" value={manual.validUntil} onChange={(e) => setManual({ ...manual, validUntil: e.target.value })} /></div>
                                    )}
                                </div>
                                <Textarea rows={2} value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })}
                                    placeholder={i.code === "fssai" ? "How you checked it, e.g. FSSAI number matched on FoSCoS, name and address match" : "How you checked it, e.g. PAN card matched the name on the GST certificate"} />
                                <div className="flex justify-end gap-2">
                                    <Button size="sm" variant="ghost" onClick={() => setManual(null)}>Cancel</Button>
                                    <Button size="sm" disabled={record.isPending || manual.note.trim().length < 5} onClick={() => record.mutate()}>Record</Button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {data.history.length > data.items.filter((i) => i.latest).length && (
                <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">All {data.history.length} checks</summary>
                    <ul className="mt-2 space-y-1">
                        {data.history.map((h) => <li key={h.id}>{when(h.createdAt)} · {h.check} · {WORD[h.status] ?? h.status} · {h.method === "cashfree" ? "Cashfree" : "by hand"}{h.note ? ` · ${h.note}` : ""}</li>)}
                    </ul>
                </details>
            )}
        </div>
    );
}
