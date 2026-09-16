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
import { FileSpreadsheet, UserPlus, Pencil, Trash2 } from "lucide-react";
import { BulkCustomerImporter } from "@/components/ftth/BulkCustomerImporter";
import { ListSearch, useListSearch } from "@/components/admin/ListSearch";

interface ConnectionRow {
  id: number;
  ispConnectionId: string | null;
  status: "pending_id" | "active" | "suspended" | "closed";
  validTill: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  installationAddress: string | null;
  currentPlanId: number | null;
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
  const [showImporter, setShowImporter] = useState(false);
  const [ispId, setIspId] = useState("");
  const [reason, setReason] = useState("");

  // One customer at a time: the walk-in, the correction, the closed account.
  type CustomerForm = { ispConnectionId: string; customerName: string; customerPhone: string; customerEmail: string; installationAddress: string; validTill: string; currentPlanId: string };
  const EMPTY_FORM: CustomerForm = { ispConnectionId: "", customerName: "", customerPhone: "", customerEmail: "", installationAddress: "", validTill: "", currentPlanId: "" };
  const [editing, setEditing] = useState<{ id: number | null; form: CustomerForm } | null>(null);
  const { data: planData } = useQuery<{ data: Array<{ id: number; name: string; speedMbps: number; durationMonths: number; isActive: boolean }> }>({
    queryKey: ["/api/ftth/admin/plans"],
  });
  const plans = planData?.data ?? [];

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

  const saveCustomer = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const f = editing.form;
      const body = {
        ispConnectionId: f.ispConnectionId.trim(),
        customerName: f.customerName.trim(),
        customerPhone: f.customerPhone.trim() || null,
        customerEmail: f.customerEmail.trim() || null,
        installationAddress: f.installationAddress.trim() || null,
        validTill: f.validTill || null,
        currentPlanId: f.currentPlanId ? Number(f.currentPlanId) : null,
      };
      return editing.id === null
        ? apiRequest("POST", "/api/ftth/admin/connections", body)
        : apiRequest("PATCH", `/api/ftth/admin/connections/${editing.id}`, body);
    },
    onSuccess: (r: any) => { refresh(); setEditing(null); toast({ title: editing?.id === null ? "Customer added" : "Customer updated", description: r?.message }); },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const deleteCustomer = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/ftth/admin/connections/${id}`),
    onSuccess: (r: any) => { refresh(); toast({ title: "Done", description: r?.message }); },
    onError: (e: Error) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });

  const openNew = () => setEditing({ id: null, form: EMPTY_FORM });
  const openEdit = (c: ConnectionRow) => setEditing({
    id: c.id,
    form: {
      ispConnectionId: c.ispConnectionId ?? "",
      customerName: c.customerName ?? c.userName ?? "",
      customerPhone: c.customerPhone ?? c.userPhone ?? "",
      customerEmail: c.customerEmail ?? "",
      installationAddress: c.installationAddress ?? "",
      validTill: c.validTill ? c.validTill.slice(0, 10) : "",
      currentPlanId: c.currentPlanId ? String(c.currentPlanId) : "",
    },
  });
  const confirmDelete = (c: ConnectionRow) => {
    const who = c.customerName ?? c.ispConnectionId ?? `#${c.id}`;
    if (window.confirm(`Remove ${who}?\n\nIf they have recharged through UniteFix the account is closed and the history kept; otherwise it is deleted.`)) {
      deleteCustomer.mutate(c.id);
    }
  };

  const fulfilMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/ftth/admin/recharges/${id}/fulfil`, {}),
    onSuccess: () => { refresh(); toast({ title: "Marked as done" }); },
    onError: (e: Error) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const search = useListSearch(connData?.data, c => [c.customerName, c.ispConnectionId, c.installationAddress, c.planName, c.speedMbps, c.status]);
  const connections = search.filtered;
  const requests = reqData?.data ?? [];
  const recharges = rechargeData?.data ?? [];
  const unfulfilled = recharges.filter(r => r.status === "success" && !r.fulfilledAt);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Customers</h1>
          <p className="text-sm text-[hsl(215,20%,65%)] mt-1">
            Link accounts, track validity, and confirm recharges you've applied on your side.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={openNew} className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2 font-medium">
            <UserPlus className="w-4 h-4" />
            Add customer
          </Button>
          <Button
            onClick={() => setShowImporter(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white gap-2 font-medium"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Import Customer Roster (Excel / CSV)
          </Button>
        </div>
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
          <ListSearch value={search.q} onChange={search.setQ} placeholder="Customer, ISP ID, address, plan…" className="mt-3 max-w-sm" />
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <p className="text-sm text-[hsl(215,20%,55%)]">{search.active ? `No connection matches "${search.q}".` : "No connections in this view."}</p>
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
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => openEdit(c)} title="Edit customer">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
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
                      <Button size="sm" variant="ghost" className="text-rose-400 hover:text-rose-300" disabled={deleteCustomer.isPending || c.status === "closed"} onClick={() => confirmDelete(c)} title="Remove customer">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id === null ? "Add a customer" : "Edit customer"}</DialogTitle>
            <DialogDescription>
              {editing?.id === null
                ? "Their ID from your own system, and the number they use. If they already have the UniteFix app on that number, they are linked at once and can recharge."
                : "Changing the phone does not unlink an app account that is already connected."}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Customer ID (your system) *</Label><Input value={editing.form.ispConnectionId} onChange={e => setEditing({ ...editing, form: { ...editing.form, ispConnectionId: e.target.value } })} placeholder="e.g. POORVI-9912" /></div>
              <div><Label>Name *</Label><Input value={editing.form.customerName} onChange={e => setEditing({ ...editing, form: { ...editing.form, customerName: e.target.value } })} /></div>
              <div><Label>Mobile</Label><Input inputMode="tel" value={editing.form.customerPhone} onChange={e => setEditing({ ...editing, form: { ...editing.form, customerPhone: e.target.value } })} placeholder="10 digits" /></div>
              <div><Label>Email</Label><Input inputMode="email" value={editing.form.customerEmail} onChange={e => setEditing({ ...editing, form: { ...editing.form, customerEmail: e.target.value } })} /></div>
              <div className="sm:col-span-2"><Label>Installation address</Label><Input value={editing.form.installationAddress} onChange={e => setEditing({ ...editing, form: { ...editing.form, installationAddress: e.target.value } })} /></div>
              <div><Label>Current plan</Label>
                <select className="mt-1 block h-9 w-full rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-2 text-sm text-white" value={editing.form.currentPlanId} onChange={e => setEditing({ ...editing, form: { ...editing.form, currentPlanId: e.target.value } })}>
                  <option value="">— none —</option>
                  {plans.map(p => <option key={p.id} value={String(p.id)}>{p.name} · {p.speedMbps} Mbps · {p.durationMonths} mo{p.isActive ? "" : " (hidden)"}</option>)}
                </select>
              </div>
              <div><Label>Valid till</Label><Input type="date" value={editing.form.validTill} onChange={e => setEditing({ ...editing, form: { ...editing.form, validTill: e.target.value } })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={!editing || !editing.form.ispConnectionId.trim() || !editing.form.customerName.trim() || saveCustomer.isPending} onClick={() => saveCustomer.mutate()}>
              {saveCustomer.isPending ? "Saving…" : editing?.id === null ? "Add customer" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <BulkCustomerImporter
        open={showImporter}
        onOpenChange={setShowImporter}
        onSuccess={refresh}
      />
    </div>
  );
}
