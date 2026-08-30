/**
 * Customers — connections, ID requests and recharges for this operator.
 *
 * Everything here is scoped server-side by the token's operatorId; nothing on
 * this page sends an operator id.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";

interface ConnectionRow {
  id: number;
  ispConnectionId: string | null;
  status: "pending_id" | "active" | "suspended" | "closed";
  validTill: string | null;
  customerName: string | null;
  installationAddress: string | null;
  planName: string | null;
  speedMbps: number | null;
  userPhone: string | null;
  userName: string | null;
}

interface IdRequestRow {
  id: number;
  claimedName: string;
  claimedPhone: string;
  claimedAddress: string | null;
  claimedIspId: string | null;
  status: string;
  createdAt: string;
  userPhone: string | null;
}

interface RechargeRow {
  id: number;
  planName: string;
  speedMbps: number;
  durationMonths: number;
  youReceive: number;
  customerPaid: number;
  status: string;
  periodEnd: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  ispConnectionId: string | null;
  customerName: string | null;
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "pending", label: "Awaiting ID" },
  { key: "expiring", label: "Expiring soon" },
  { key: "suspended", label: "Suspended" },
];

export default function OperatorCustomers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [assigning, setAssigning] = useState<IdRequestRow | null>(null);
  const [rejecting, setRejecting] = useState<IdRequestRow | null>(null);
  const [ispId, setIspId] = useState("");
  const [reason, setReason] = useState("");

  const { data: connData } = useQuery<{ data: ConnectionRow[] }>({
    queryKey: [`/api/ftth/admin/connections?filter=${filter}`],
  });
  const { data: reqData } = useQuery<{ data: IdRequestRow[] }>({
    queryKey: ["/api/ftth/admin/id-requests?status=pending"],
  });
  const { data: rechargeData } = useQuery<{ data: RechargeRow[] }>({
    queryKey: ["/api/ftth/admin/recharges"],
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/ftth/admin/connections?filter=${filter}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/ftth/admin/id-requests?status=pending"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ftth/admin/recharges"] });
  };

  const approveMutation = useMutation({
    mutationFn: async (vars: { id: number; ispConnectionId: string }) =>
      apiRequest("POST", `/api/ftth/admin/id-requests/${vars.id}/approve`, { ispConnectionId: vars.ispConnectionId }),
    onSuccess: () => {
      refresh(); setAssigning(null); setIspId("");
      toast({ title: "Connection activated", description: "The customer can now recharge in the app." });
    },
    onError: (e: Error) => toast({ title: "Could not activate", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (vars: { id: number; reason: string }) =>
      apiRequest("POST", `/api/ftth/admin/id-requests/${vars.id}/reject`, { reason: vars.reason }),
    onSuccess: () => { refresh(); setRejecting(null); setReason(""); toast({ title: "Request rejected" }); },
    onError: (e: Error) => toast({ title: "Could not reject", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async (vars: { id: number; action: "suspend" | "reactivate" }) =>
      apiRequest("POST", `/api/ftth/admin/connections/${vars.id}/status`, { action: vars.action }),
    onSuccess: (r: any) => { refresh(); toast({ title: "Updated", description: r?.message }); },
    onError: (e: Error) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const fulfilMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/ftth/admin/recharges/${id}/fulfil`, {}),
    onSuccess: () => { refresh(); toast({ title: "Marked as done" }); },
    onError: (e: Error) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const connections = connData?.data ?? [];
  const requests = reqData?.data ?? [];
  const recharges = rechargeData?.data ?? [];
  const unfulfilled = recharges.filter(r => r.status === "success" && !r.fulfilledAt);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white tracking-tight">Customers</h1>
        <p className="text-sm text-[hsl(215,20%,65%)] mt-1">
          Link accounts, track validity, and confirm recharges you've applied on your side.
        </p>
      </header>

      {requests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Account link requests
              <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">{requests.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {requests.map(r => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4 rounded-xl border border-[rgba(255,255,255,0.08)]">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{r.claimedName}</p>
                    <p className="text-sm text-[hsl(215,20%,65%)]">
                      {r.claimedPhone}
                      {r.claimedIspId ? ` · says their ID is ${r.claimedIspId}` : ""}
                    </p>
                    {r.claimedAddress && <p className="text-xs text-[hsl(215,20%,50%)] mt-1">{r.claimedAddress}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { setAssigning(r); setIspId(r.claimedIspId ?? ""); }}>
                      Assign ID
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setRejecting(r)}>Reject</Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {unfulfilled.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Recharges to apply
              <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">{unfulfilled.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[hsl(215,20%,55%)] mb-3">
              These customers have paid. Apply the recharge in your own portal, then mark it done here.
            </p>
            <ul className="space-y-2">
              {unfulfilled.map(r => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-[rgba(255,255,255,0.06)]">
                  <div className="min-w-0">
                    <p className="text-white font-medium">
                      {r.ispConnectionId ?? "—"} · {r.planName}
                    </p>
                    <p className="text-xs text-[hsl(215,20%,55%)]">
                      {r.customerName ?? ""} · ₹{r.youReceive} to you · paid {format(new Date(r.createdAt), "d MMM, HH:mm")}
                    </p>
                  </div>
                  <Button size="sm" disabled={fulfilMutation.isPending} onClick={() => fulfilMutation.mutate(r.id)}>
                    Mark done
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Connections</CardTitle>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                    filter === f.key
                      ? "bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border border-[hsla(160,84%,39%,0.3)]"
                      : "text-[hsl(215,20%,65%)] border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.04)]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <p className="text-sm text-[hsl(215,20%,55%)]">No connections in this view.</p>
          ) : (
            <ul className="space-y-2">
              {connections.map(c => {
                const days = c.validTill
                  ? Math.ceil((new Date(c.validTill).getTime() - Date.now()) / 86_400_000)
                  : null;
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-[rgba(255,255,255,0.06)]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white font-medium">{c.ispConnectionId ?? "Awaiting ID"}</p>
                        <Badge
                          className={
                            c.status === "active"
                              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                              : c.status === "pending_id"
                                ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                                : "bg-red-500/15 text-red-300 border-red-500/30"
                          }
                        >
                          {c.status === "pending_id" ? "awaiting ID" : c.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">
                        {c.customerName ?? c.userName ?? "—"} · {c.userPhone ?? "—"}
                        {c.planName ? ` · ${c.planName}` : ""}
                        {c.validTill
                          ? ` · expires ${format(new Date(c.validTill), "d MMM yyyy")}${days !== null && days >= 0 ? ` (${days}d)` : " (expired)"}`
                          : " · never recharged"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={statusMutation.isPending || c.status === "closed"}
                      onClick={() => statusMutation.mutate({
                        id: c.id, action: c.status === "suspended" ? "reactivate" : "suspend",
                      })}
                    >
                      {c.status === "suspended" ? "Reactivate" : "Suspend"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={assigning !== null} onOpenChange={(o) => !o && setAssigning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link {assigning?.claimedName}</DialogTitle>
            <DialogDescription>
              Enter their customer ID from your own system. They'll be able to recharge immediately.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="isp-id">Your customer ID</Label>
            <Input id="isp-id" value={ispId} onChange={(e) => setIspId(e.target.value)} placeholder="POORVI-9912" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigning(null)}>Cancel</Button>
            <Button
              disabled={approveMutation.isPending || !ispId.trim()}
              onClick={() => assigning && approveMutation.mutate({ id: assigning.id, ispConnectionId: ispId.trim() })}
            >
              {approveMutation.isPending ? "Linking…" : "Link account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject request</DialogTitle>
            <DialogDescription>The customer sees this reason in the app.</DialogDescription>
          </DialogHeader>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="We couldn't find this account" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectMutation.isPending || reason.trim().length < 3}
              onClick={() => rejecting && rejectMutation.mutate({ id: rejecting.id, reason: reason.trim() })}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
