/**
 * Enquiries (Free quotes band): what customers asked for that is not booked —
 * travel, hotels, catering, loans, real estate... Partners in the area get them
 * first; "Needs staff" is what nobody took in time or nobody could be sent.
 * Staff call the customer, forward it to a partner, or close it.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { LIVE } from "@/lib/live";
import { queryClient, apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Enquiry = {
  id: number; ref: string; serviceName: string; details: string; pincode: string | null; address: string | null;
  preferredDate: string | null; budget: string | null; status: string; partnerId: number | null; partnerName: string | null;
  customerName: string | null; customerPhone: string | null; createdAt: string; staffDueAt: string | null; staffNote: string | null;
  needsStaff: boolean; notifiedCount: number; closedReason: string | null;
};
type Partner = { id: number; displayName: string; partnerCode: string; status: string };

const FILTERS = [["needs_staff", "Needs staff"], ["open", "Open"], ["all", "All"]] as const;
const STATUS: Record<string, string> = { new: "New", taken: "Taken by partner", forwarded: "Forwarded", contacted: "Called", closed: "Closed" };

export default function EnquiriesPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("needs_staff");
  const [open, setOpen] = useState<number | null>(null);
  const [forwardTo, setForwardTo] = useState<Record<number, string>>({});
  const [note, setNote] = useState<Record<number, string>>({});
  const list = useQuery<Enquiry[]>({ queryKey: ["/api/admin/enquiries", filter], queryFn: async () => (await apiRequest("GET", `/api/admin/enquiries?filter=${filter}`)).data, ...LIVE });
  const partners = useQuery<Partner[]>({ queryKey: ["/api/admin/business-partners", "active"], queryFn: async () => (await apiRequest("GET", "/api/admin/business-partners?status=active")).data });
  const refresh = () => queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/admin/enquiries") });
  const forward = useMutation({
    mutationFn: async ({ id, bp }: { id: number; bp: number }) => apiRequest("POST", `/api/admin/enquiries/${id}/forward`, { businessPartnerId: bp }),
    onSuccess: (r: any) => { toast({ title: "Forwarded", description: r?.message }); refresh(); },
    onError: e => toast({ title: "Not forwarded", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const update = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "contacted" | "closed" }) => apiRequest("PATCH", `/api/admin/enquiries/${id}`, { status, note: note[id] ?? "" }),
    onSuccess: (_r, v) => { toast({ title: v.status === "closed" ? "Closed" : "Marked as called" }); refresh(); },
    onError: e => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const rows = list.data ?? [];

  return (
    <main className="min-w-0 flex-1 space-y-6 p-4 sm:p-6 xl:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Enquiries</h1>
        <p className="mt-1 max-w-3xl text-sm text-[hsl(215,20%,65%)]">Free-quote requests from the app (travel, hotels, catering, loans and other services set to "Free quotes"). Partners who take the service in the customer's pincode get them first; ones nobody takes in time, or with no partner to send to, come here.</p>
      </div>
      <div className="flex gap-1" role="tablist">
        {FILTERS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={`rounded-lg px-3 py-1.5 text-sm ${filter === k ? "bg-[rgba(255,255,255,0.08)] text-white" : "text-[hsl(215,20%,65%)] hover:text-white"}`}>{l}</button>
        ))}
      </div>
      <div className="glass-card divide-y divide-[rgba(255,255,255,0.06)]">
        {list.isLoading ? <p className="p-6 text-sm text-[hsl(215,20%,65%)]">Loading…</p>
          : !rows.length ? <p className="p-6 text-sm text-[hsl(215,20%,65%)]">{filter === "needs_staff" ? "Nothing waiting for staff." : "No enquiries."}</p>
          : rows.map(e => (
            <div key={e.id} className="p-4">
              <button className="flex w-full flex-wrap items-start justify-between gap-3 text-left" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{e.serviceName} <span className="font-mono text-[11px] text-[hsl(215,20%,55%)]">{e.ref}</span></p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-[hsl(210,20%,80%)]">{e.details}</p>
                  <p className="mt-1 text-xs text-[hsl(215,20%,55%)]">{e.customerName ?? "Customer"} · {e.customerPhone ?? "—"}{e.pincode ? ` · ${e.pincode}` : ""} · {new Date(e.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  {e.needsStaff && <Badge className="border-0 bg-amber-500/15 text-amber-300">Needs staff</Badge>}
                  <Badge variant="outline" className="border-[rgba(255,255,255,0.15)] text-[hsl(215,20%,75%)]">{STATUS[e.status] ?? e.status}{e.partnerName ? ` · ${e.partnerName}` : ""}</Badge>
                </div>
              </button>
              {open === e.id && (
                <div className="mt-3 space-y-3 rounded-lg bg-[rgba(255,255,255,0.03)] p-3 text-sm">
                  <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    <div><dt className="text-xs text-[hsl(215,20%,55%)]">When</dt><dd className="text-white">{e.preferredDate ?? "Not given"}</dd></div>
                    <div><dt className="text-xs text-[hsl(215,20%,55%)]">Budget</dt><dd className="text-white">{e.budget ?? "Not given"}</dd></div>
                    <div><dt className="text-xs text-[hsl(215,20%,55%)]">Address</dt><dd className="text-white">{e.address ?? "—"}</dd></div>
                    <div><dt className="text-xs text-[hsl(215,20%,55%)]">Sent to</dt><dd className="text-white">{e.notifiedCount} partner(s)</dd></div>
                  </dl>
                  <p className="whitespace-pre-wrap text-[hsl(210,20%,85%)]">{e.details}</p>
                  {e.staffNote && <p className="text-xs text-[hsl(215,20%,60%)]">Staff note: {e.staffNote}</p>}
                  {e.status !== "closed" && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <label className="grid flex-1 gap-1 text-xs text-[hsl(215,20%,60%)]">Forward to a partner
                        <select value={forwardTo[e.id] ?? ""} onChange={ev => setForwardTo({ ...forwardTo, [e.id]: ev.target.value })} className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-2 py-1.5 text-sm text-white">
                          <option value="" className="bg-[hsl(222,47%,11%)]">Choose a partner…</option>
                          {(partners.data ?? []).map(p => <option key={p.id} value={p.id} className="bg-[hsl(222,47%,11%)]">{p.displayName} ({p.partnerCode})</option>)}
                        </select>
                      </label>
                      <Button size="sm" disabled={!forwardTo[e.id] || forward.isPending} onClick={() => forward.mutate({ id: e.id, bp: Number(forwardTo[e.id]) })}>Forward</Button>
                    </div>
                  )}
                  {e.status !== "closed" && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <label className="grid flex-1 gap-1 text-xs text-[hsl(215,20%,60%)]">Note (what was said, or why it is closed)
                        <Input value={note[e.id] ?? ""} onChange={ev => setNote({ ...note, [e.id]: ev.target.value })} className="bg-[rgba(255,255,255,0.03)] text-white" />
                      </label>
                      <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ id: e.id, status: "contacted" })}>Mark called</Button>
                      <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ id: e.id, status: "closed" })}>Close</Button>
                    </div>
                  )}
                  {e.closedReason && <p className="text-xs text-[hsl(215,20%,60%)]">Closed: {e.closedReason}</p>}
                </div>
              )}
            </div>
          ))}
      </div>
    </main>
  );
}
