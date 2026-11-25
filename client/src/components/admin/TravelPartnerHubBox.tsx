/**
 * On a travel partner's card: their Partner Hub account (or linking one by
 * partner code), and their fleet with each driver's licence and vehicle's
 * papers — checked through Cashfree, or decided by hand by staff with a note.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

type Driver = { id: number; name: string; phone: string; dlNumber: string; dlStatus: string; dlValidUntil: string | null; dlNameAtRto: string | null; dlCheckMethod: string | null; dlCheckNote: string | null; isActive: boolean };
type Vehicle = { id: number; regNo: string; model: string; seats: number; rcStatus: string; rcValidUntil: string | null; insuranceUpto: string | null; permitUpto: string | null; rcOwner: string | null; rcCheckNote: string | null; isActive: boolean };
const TONE: Record<string, string> = { verified: "bg-emerald-500/20 text-emerald-200", failed: "bg-rose-500/20 text-rose-200", needs_review: "bg-amber-500/20 text-amber-200", unverified: "bg-white/10 text-slate-300" };
const WORD: Record<string, string> = { verified: "Checked", failed: "Rejected", needs_review: "Review", unverified: "Not checked" };

export default function TravelPartnerHubBox({ partner, onChange }: { partner: { id: number; businessPartnerId?: number | null }; onChange: () => void }) {
    const { toast } = useToast();
    const qc = useQueryClient();
    const [code, setCode] = useState("");
    const [open, setOpen] = useState(false);
    const [decide, setDecide] = useState<{ kind: "drivers" | "vehicles"; id: number; note: string; until: string } | null>(null);
    const key = ["/api/admin/travel/partners", partner.id, "fleet"];
    const fleet = useQuery<{ drivers: Driver[]; vehicles: Vehicle[] } | null>({ queryKey: key, enabled: open && !!partner.businessPartnerId, queryFn: async () => (await apiRequest("GET", `/api/admin/travel/partners/${partner.id}/fleet`)).data });
    const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
    const link = useMutation({ mutationFn: async () => apiRequest("POST", `/api/admin/travel/partners/${partner.id}/link`, { partnerCode: code }), onSuccess: (r: any) => { toast({ title: r?.message ?? "Linked" }); setCode(""); onChange(); }, onError: fail("Not linked") });
    const act = useMutation({
        mutationFn: async (x: { path: string; body?: unknown }) => apiRequest("POST", x.path, x.body ?? {}),
        onSuccess: () => { toast({ title: "Done" }); setDecide(null); qc.invalidateQueries({ queryKey: key }); },
        onError: fail("Not done"),
    });

    if (!partner.businessPartnerId) {
        return (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-white/10 p-2 text-xs text-slate-400">
                <span>No Hub account.</span>
                <Input className="h-7 w-28 bg-white/5 text-xs text-white" placeholder="BP-0042" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={code.length < 4 || link.isPending} onClick={() => link.mutate()}>Link</Button>
            </div>
        );
    }
    const row = (kind: "drivers" | "vehicles", id: number, status: string, label: string, detail: string, note: string | null) => (
        <li key={`${kind}-${id}`} className="space-y-1 py-1.5">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-200">{label}</span><span className="text-slate-500">{detail}</span>
                <span className={`rounded-full px-2 ${TONE[status] ?? TONE.unverified}`}>{WORD[status] ?? status}</span>
                <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => act.mutate({ path: `/api/admin/travel/fleet/${kind}/${id}/check` })}>Cashfree</Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setDecide({ kind, id, note: "", until: "" })}>By hand</Button>
                </span>
            </div>
            {note && <p className="text-slate-500">{note}</p>}
            {decide?.kind === kind && decide.id === id && (
                <div className="flex flex-wrap items-center gap-1">
                    <Input className="h-7 flex-1 min-w-[160px] bg-white/5 text-xs text-white" placeholder="How you checked it" value={decide.note} onChange={(e) => setDecide({ ...decide, note: e.target.value })} />
                    <Input type="date" className="h-7 w-36 bg-white/5 text-xs text-white" title="Valid until" value={decide.until} onChange={(e) => setDecide({ ...decide, until: e.target.value })} />
                    <Button size="sm" className="h-7 text-xs" disabled={decide.note.trim().length < 5} onClick={() => act.mutate({ path: `/api/admin/travel/fleet/${kind}/${id}/review`, body: { status: "verified", note: decide.note, validUntil: decide.until || null } })}>Verified</Button>
                    <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={decide.note.trim().length < 5} onClick={() => act.mutate({ path: `/api/admin/travel/fleet/${kind}/${id}/review`, body: { status: "failed", note: decide.note } })}>Reject</Button>
                </div>
            )}
        </li>
    );
    return (
        <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-2 text-xs">
            <div className="flex items-center gap-2">
                <span className="rounded-full bg-violet-500/20 px-2 text-violet-200">Hub account</span>
                <span className="text-slate-400">Answers prices and accepts trips in their Hub; paid through Partner Settlements.</span>
                <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-xs" onClick={() => setOpen(!open)}>{open ? "Hide fleet" : "Fleet"}</Button>
            </div>
            {open && fleet.data && (
                <ul className="mt-1 divide-y divide-white/5">
                    {fleet.data.drivers.map((d) => row("drivers", d.id, d.dlStatus, d.name, `${d.phone} · licence ${d.dlNumber}${d.dlValidUntil ? ` to ${d.dlValidUntil}` : ""}${d.dlNameAtRto ? ` · RTO: ${d.dlNameAtRto}` : ""}`, d.dlCheckNote))}
                    {fleet.data.vehicles.map((v) => row("vehicles", v.id, v.rcStatus, v.regNo, `${v.model} · ${v.seats} seats${v.insuranceUpto ? ` · insured to ${v.insuranceUpto}` : ""}${v.permitUpto ? ` · permit to ${v.permitUpto}` : ""}${v.rcOwner ? ` · owner ${v.rcOwner}` : ""}`, v.rcCheckNote))}
                    {!fleet.data.drivers.length && !fleet.data.vehicles.length && <li className="py-1.5 text-slate-500">No drivers or vehicles added yet.</li>}
                </ul>
            )}
        </div>
    );
}
