/**
 * Account deletion requests — customers and experts ask from the app; staff
 * approve (the account is closed and signed out everywhere) or deny with a
 * note the person sees. Open bookings, wallet money and payouts are shown so
 * nothing is left hanging; approving over them needs a deliberate second step.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

type Req = {
  id: number; status: "pending" | "approved" | "denied" | "cancelled"; reasonCategory: string | null; reasonLabel: string | null; reason: string; adminNote: string | null;
  createdAt: string; decidedAt: string | null; userId: number; role: string; source: string; name: string | null; phone: string | null; email: string | null; joined: string | null;
  impact: null | { openBookings: number; openJobs: number; openOrders: number; walletAvailable: number; walletHeld: number; payoutsInFlight: number; blockers: string[] };
};
const ROLE: Record<string, string> = { user: "Customer", serviceman: "Expert", business_partner: "Business partner" };
const TABS = [["pending", "To review"], ["approved", "Approved"], ["denied", "Denied"], ["cancelled", "Withdrawn"]] as const;
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function AccountDeletionsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("pending");
  const q = useQuery<{ requests: Req[]; pending: number }>({
    queryKey: ["/api/admin/accounts/deletion-requests", tab],
    queryFn: async () => (await apiRequest("GET", `/api/admin/accounts/deletion-requests?status=${tab}`)).data,
  });
  const [decide, setDecide] = useState<{ r: Req; kind: "approve" | "deny" } | null>(null);
  const [note, setNote] = useState("");
  const [force, setForce] = useState(false);
  const act = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/accounts/deletion-requests/${decide!.r.id}/${decide!.kind}`, decide!.kind === "approve" ? { note: note || null, force } : { note }),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ["/api/admin/accounts/deletion-requests"] }); toast({ title: "Done", description: r?.message }); setDecide(null); setNote(""); setForce(false); },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const list = q.data?.requests ?? [];
  const blockers = decide?.r.impact?.blockers ?? [];

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Account deletion requests</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">Customers and experts ask from the app, with their reason. Approving closes the account and signs it out on every device (records and invoices are kept; signing up again with the same number starts a fresh account). Denying sends them your note. Reply within 2 working days — that is what the app promises.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map(([k, l]) => <Button key={k} size="sm" role="tab" aria-selected={tab === k} variant={tab === k ? "default" : "outline"} onClick={() => setTab(k)}>{l}{k === "pending" && q.data?.pending ? ` (${q.data.pending})` : ""}</Button>)}
      </div>
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!q.isLoading && !list.length && <p className="text-sm text-muted-foreground">{tab === "pending" ? "No requests waiting." : "Nothing here."}</p>}
      <div className="space-y-3">
        {list.map(r => (
          <Card key={r.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.name || "Unnamed"} <span className="text-xs text-muted-foreground">· {ROLE[r.role] ?? r.role} #{r.userId}{r.phone ? ` · ${r.phone}` : ""}{r.email ? ` · ${r.email}` : ""}</span></p>
                  <p className="text-xs text-muted-foreground">Asked {when(r.createdAt)}{r.joined ? ` · member since ${new Date(r.joined).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}` : ""}{r.source === "legacy_app" ? " · from an older app version" : ""}</p>
                </div>
                <Badge variant={r.status === "pending" ? "default" : r.status === "approved" ? "destructive" : "secondary"}>{r.status === "cancelled" ? "withdrawn" : r.status}</Badge>
              </div>
              <div className="rounded-md bg-muted/40 p-3 text-sm">
                {r.reasonLabel && <p className="font-medium">{r.reasonLabel}</p>}
                <p className="whitespace-pre-wrap text-muted-foreground">{r.reason}</p>
              </div>
              {r.impact && (r.impact.blockers.length
                ? <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"><p className="font-medium">Still open on this account</p><ul className="mt-1 list-disc pl-5">{r.impact.blockers.map(b => <li key={b}>{b}</li>)}</ul></div>
                : <p className="text-xs text-emerald-400">Nothing open — no bookings, jobs, orders, wallet money or payouts.</p>)}
              {r.status !== "pending" && (r.adminNote || r.decidedAt) && <p className="text-xs text-muted-foreground">Decided {when(r.decidedAt)}{r.adminNote ? ` — “${r.adminNote}”` : ""}</p>}
              {r.status === "pending" && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="destructive" onClick={() => { setDecide({ r, kind: "approve" }); setNote(""); setForce(false); }}>Approve deletion</Button>
                  <Button size="sm" variant="outline" onClick={() => { setDecide({ r, kind: "deny" }); setNote(""); }}>Deny</Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!decide} onOpenChange={o => !o && setDecide(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decide?.kind === "approve" ? `Delete ${decide.r.name || "this account"}?` : "Deny this request"}</DialogTitle>
            <DialogDescription>{decide?.kind === "approve" ? "The account is closed and signed out on every device. They are told by notification." : "They see your note in the app and as a notification. Say what they need to do — for example, finish an open booking first."}</DialogDescription>
          </DialogHeader>
          {decide?.kind === "approve" && blockers.length > 0 && (
            <label className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={force} onChange={e => setForce(e.target.checked)} />
              <span>Approve anyway, although {blockers.join("; ")}. This is recorded in the audit trail.</span>
            </label>
          )}
          <Textarea rows={3} aria-label={decide?.kind === "approve" ? "Internal note (optional)" : "Note to the customer"} placeholder={decide?.kind === "approve" ? "Internal note (optional)" : "Your booking on 12 Oct is still open — please complete or cancel it, then ask again."} value={note} onChange={e => setNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecide(null)}>Back</Button>
            <Button variant={decide?.kind === "approve" ? "destructive" : "default"} disabled={act.isPending || (decide?.kind === "deny" && note.trim().length < 5) || (decide?.kind === "approve" && blockers.length > 0 && !force)} onClick={() => act.mutate()}>
              {decide?.kind === "approve" ? "Delete account" : "Send denial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
