/**
 * FTTH Operators — review applications, approve, suspend.
 *
 * Reading needs `ftth:view`; approving, suspending and settling need
 * `ftth:manage`. Gated at three levels: the sidebar hides the link, the route
 * wrapper in App.tsx refuses to render the page, and the capability guard
 * mounted on /api/admin enforces it on every request.
 *
 * Suspension lives here rather than on Roles & Access because
 * `admin_users.isActive` and `ftth_operators.status` must move together — these
 * endpoints own both.
 */

import { useState } from "react";
import { Link } from "wouter";
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
import { useAdminMe } from "@/lib/admin-auth";
import { Router as RouterIcon, Check, X, Pause, Play, FileSpreadsheet } from "lucide-react";
import { format } from "date-fns";
import { BulkCustomerImporter } from "@/components/ftth/BulkCustomerImporter";

type OperatorStatus = "pending_approval" | "active" | "paused" | "disabled";

interface OperatorRow {
  id: number;
  companyName: string;
  legalName: string | null;
  gstin: string | null;
  contactName: string | null;
  contactEmail: string;
  contactPhone: string;
  status: OperatorStatus;
  leadFee: number | null;
  convenienceFee: number | null;
  adminUserId: number | null;
  username: string | null;
  loginActive: boolean | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  pincodeCount: number;
}

const STATUS_STYLE: Record<OperatorStatus, string> = {
  pending_approval: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  paused: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  disabled: "bg-red-500/15 text-red-300 border-red-500/30",
};

const STATUS_LABEL: Record<OperatorStatus, string> = {
  pending_approval: "Pending review",
  active: "Active",
  paused: "Paused",
  disabled: "Disabled",
};

export default function FtthOperatorsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Approve / reject / suspend / settle need ftth:manage. Hiding them is a
  // courtesy so a view-only role isn't offered buttons that 403 — the capability
  // guard on /api/admin is what actually enforces it.
  const { can } = useAdminMe();

  const [approving, setApproving] = useState<OperatorRow | null>(null);
  const [rejecting, setRejecting] = useState<OperatorRow | null>(null);
  const [settling, setSettling] = useState<OperatorRow | null>(null);
  const [importingForOperator, setImportingForOperator] = useState<OperatorRow | null>(null);
  const [approveForm, setApproveForm] = useState({ username: "", leadFee: "", convenienceFee: "" });
  const [settleForm, setSettleForm] = useState({ amount: "", reference: "", note: "" });
  const [rejectReason, setRejectReason] = useState("");
  // Shown once, after approval. Never retrievable again — the server only ever
  // stored the hash.
  const [credentials, setCredentials] = useState<{ company: string; username: string; password: string | null } | null>(null);

  const { data, isLoading } = useQuery<{ data: OperatorRow[] }>({
    queryKey: ["/api/admin/ftth/operators"],
  });

  // What UniteFix owes each operator. Positive = due to them.
  const { data: ledgerData } = useQuery<{ data: Array<{ operatorId: number; balance: number }> }>({
    queryKey: ["/api/admin/ftth/ledger"],
  });
  const balanceFor = (id: number) =>
    ledgerData?.data.find(l => l.operatorId === id)?.balance ?? 0;

  const operators = data?.data ?? [];
  const pending = operators.filter((o) => o.status === "pending_approval");
  const live = operators.filter((o) => o.status !== "pending_approval");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/ftth/operators"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/ftth/ledger"] });
  };

  const settleMutation = useMutation({
    mutationFn: async (vars: { id: number; body: Record<string, unknown> }) =>
      apiRequest("POST", `/api/admin/ftth/operators/${vars.id}/settle`, vars.body),
    onSuccess: (r: any) => {
      invalidate();
      setSettling(null);
      setSettleForm({ amount: "", reference: "", note: "" });
      toast({ title: "Settlement recorded", description: r?.message });
    },
    onError: (e: Error) => toast({ title: "Could not record", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async (vars: { id: number; body: Record<string, unknown> }) =>
      apiRequest("POST", `/api/admin/ftth/operators/${vars.id}/approve`, vars.body),
    onSuccess: (res, vars) => {
      invalidate();
      const company = approving?.companyName ?? "Operator";
      setApproving(null);
      setCredentials({
        company,
        username: res?.data?.username ?? "",
        password: res?.data?.temporaryPassword ?? null,
      });
      toast({ title: "Operator approved", description: `${company} can now sign in.` });
      void vars;
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (vars: { id: number; reason: string }) =>
      apiRequest("POST", `/api/admin/ftth/operators/${vars.id}/reject`, { reason: vars.reason }),
    onSuccess: () => {
      invalidate();
      setRejecting(null);
      setRejectReason("");
      toast({ title: "Application rejected" });
    },
    onError: (e: Error) => toast({ title: "Could not reject", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async (vars: { id: number; status: "active" | "paused" | "disabled" }) =>
      apiRequest("PATCH", `/api/admin/ftth/operators/${vars.id}/status`, { status: vars.status }),
    onSuccess: (_res, vars) => {
      invalidate();
      toast({ title: `Operator ${vars.status}` });
    },
    onError: (e: Error) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const openApprove = (row: OperatorRow) => {
    setApproving(row);
    // A sensible default the super_admin can override: lowercase company name,
    // non-alphanumerics collapsed.
    setApproveForm({
      username: row.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "operator",
      leadFee: "",
      convenienceFee: "",
    });
  };

  const submitApprove = () => {
    if (!approving) return;
    const body: Record<string, unknown> = { username: approveForm.username.trim() };
    if (approveForm.leadFee.trim()) body.leadFeePaise = Math.round(Number(approveForm.leadFee) * 100);
    if (approveForm.convenienceFee.trim()) body.convenienceFeePaise = Math.round(Number(approveForm.convenienceFee) * 100);
    approveMutation.mutate({ id: approving.id, body });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <header className="flex items-center gap-3">
        <RouterIcon className="w-6 h-6 text-[hsl(160,84%,45%)]" />
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">FTTH Operators</h1>
          <p className="text-sm text-[hsl(215,20%,65%)]">
            Broadband partners selling recharges through UniteFix.
          </p>
        </div>
      </header>

      {isLoading ? (
        <p className="text-[hsl(215,20%,65%)]">Loading…</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Applications
                {pending.length > 0 && (
                  <Badge className={STATUS_STYLE.pending_approval}>{pending.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pending.length === 0 ? (
                <p className="text-sm text-[hsl(215,20%,55%)]">No applications waiting.</p>
              ) : (
                <ul className="space-y-3">
                  {pending.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-start justify-between gap-4 p-4 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-white">{row.companyName}</p>
                        <p className="text-sm text-[hsl(215,20%,65%)] mt-0.5">
                          {row.contactName ? `${row.contactName} · ` : ""}
                          {row.contactPhone} · {row.contactEmail}
                        </p>
                        <p className="text-xs text-[hsl(215,20%,50%)] mt-1">
                          {row.pincodeCount} pincode{row.pincodeCount === 1 ? "" : "s"}
                          {row.gstin ? ` · GSTIN ${row.gstin}` : ""}
                          {" · applied "}
                          {format(new Date(row.createdAt), "d MMM yyyy")}
                        </p>
                      </div>
                      {can('ftth:manage') ? (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => openApprove(row)}>
                            <Check className="w-4 h-4 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setRejecting(row)}>
                            <X className="w-4 h-4 mr-1" /> Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-[hsl(215,20%,50%)]">
                          A super admin reviews applications
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Operators</CardTitle>
            </CardHeader>
            <CardContent>
              {live.length === 0 ? (
                <p className="text-sm text-[hsl(215,20%,55%)]">No operators yet.</p>
              ) : (
                <ul className="space-y-3">
                  {live.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-start justify-between gap-4 p-4 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/admin/ftth-operators/${row.id}`}>
                            <a className="font-semibold text-white hover:text-[hsl(160,84%,65%)] underline-offset-4 hover:underline">
                              {row.companyName}
                            </a>
                          </Link>
                          <Badge className={STATUS_STYLE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                        </div>
                        <p className="text-sm text-[hsl(215,20%,65%)] mt-0.5">
                          {row.username ? `@${row.username} · ` : "no login · "}
                          {row.contactPhone}
                        </p>
                        <p className="text-xs text-[hsl(215,20%,50%)] mt-1">
                          {row.pincodeCount} pincode{row.pincodeCount === 1 ? "" : "s"}
                          {row.leadFee !== null ? ` · lead fee ₹${row.leadFee}` : ""}
                          {row.convenienceFee !== null ? ` · convenience ₹${row.convenienceFee}` : ""}
                          {row.rejectionReason ? ` · ${row.rejectionReason}` : ""}
                        </p>
                        {row.adminUserId && (
                          <p className={`text-xs mt-1 font-medium ${
                            balanceFor(row.id) > 0 ? "text-[hsl(160,84%,60%)]" : "text-[hsl(215,20%,50%)]"
                          }`}>
                            Balance due: ₹{balanceFor(row.id).toLocaleString("en-IN")}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Link href={`/admin/ftth-operators/${row.id}`}>
                          <Button size="sm" variant="outline">Manage</Button>
                        </Link>
                        {can('ftth:manage') && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setImportingForOperator(row)}
                            className="border-[rgba(255,255,255,0.15)] hover:bg-indigo-500/20 text-indigo-300"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Import Roster
                          </Button>
                        )}
                        {can('ftth:manage') && row.adminUserId && (
                          <Button size="sm" variant="outline" onClick={() => setSettling(row)}>
                            Record payout
                          </Button>
                        )}
                        {!can('ftth:manage') ? null : row.status === "active" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={statusMutation.isPending}
                            onClick={() => statusMutation.mutate({ id: row.id, status: "paused" })}
                          >
                            <Pause className="w-4 h-4 mr-1" /> Pause
                          </Button>
                        ) : row.adminUserId ? (
                          <Button
                            size="sm"
                            disabled={statusMutation.isPending}
                            onClick={() => statusMutation.mutate({ id: row.id, status: "active" })}
                          >
                            <Play className="w-4 h-4 mr-1" /> Reactivate
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Approve */}
      <Dialog open={approving !== null} onOpenChange={(o) => !o && setApproving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve {approving?.companyName}</DialogTitle>
            <DialogDescription>
              This creates their dashboard login. Leave the password blank and one will be generated and
              shown to you once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="op-username">Username</Label>
              <Input
                id="op-username"
                value={approveForm.username}
                onChange={(e) => setApproveForm({ ...approveForm, username: e.target.value })}
                placeholder="poorvicomputers"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="op-lead-fee">Lead fee (₹)</Label>
                <Input
                  id="op-lead-fee"
                  inputMode="decimal"
                  value={approveForm.leadFee}
                  onChange={(e) => setApproveForm({ ...approveForm, leadFee: e.target.value })}
                  placeholder="platform default"
                />
              </div>
              <div>
                <Label htmlFor="op-conv-fee">Convenience fee (₹)</Label>
                <Input
                  id="op-conv-fee"
                  inputMode="decimal"
                  value={approveForm.convenienceFee}
                  onChange={(e) => setApproveForm({ ...approveForm, convenienceFee: e.target.value })}
                  placeholder="platform default"
                />
              </div>
            </div>
            <p className="text-xs text-[hsl(215,20%,55%)]">
              Blank uses the platform default. Both are negotiated per operator and can be changed later.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproving(null)}>Cancel</Button>
            <Button
              onClick={submitApprove}
              disabled={approveMutation.isPending || approveForm.username.trim().length < 3}
            >
              {approveMutation.isPending ? "Approving…" : "Approve & create login"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject */}
      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejecting?.companyName}</DialogTitle>
            <DialogDescription>The reason is recorded in the audit trail.</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="reject-reason">Reason</Label>
            <Input
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Outside our service area"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectMutation.isPending || rejectReason.trim().length < 3}
              onClick={() => rejecting && rejectMutation.mutate({ id: rejecting.id, reason: rejectReason.trim() })}
            >
              {rejectMutation.isPending ? "Rejecting…" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record a settlement */}
      <Dialog open={settling !== null} onOpenChange={(o) => !o && setSettling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay {settling?.companyName}</DialogTitle>
            <DialogDescription>
              Records money you've actually remitted. Current balance due: ₹
              {settling ? balanceFor(settling.id).toLocaleString("en-IN") : 0}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="settle-amount">Amount (₹)</Label>
              <Input
                id="settle-amount" inputMode="decimal" value={settleForm.amount}
                onChange={(e) => setSettleForm({ ...settleForm, amount: e.target.value })}
                placeholder={settling ? String(balanceFor(settling.id)) : "0"}
              />
            </div>
            <div>
              <Label htmlFor="settle-ref">Reference (UTR / cheque no.)</Label>
              <Input
                id="settle-ref" value={settleForm.reference}
                onChange={(e) => setSettleForm({ ...settleForm, reference: e.target.value })}
                placeholder="NEFT-2026-0830-114"
              />
            </div>
            <div>
              <Label htmlFor="settle-note">Note (optional)</Label>
              <Input
                id="settle-note" value={settleForm.note}
                onChange={(e) => setSettleForm({ ...settleForm, note: e.target.value })}
                placeholder="August settlement"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettling(null)}>Cancel</Button>
            <Button
              disabled={
                settleMutation.isPending ||
                !Number(settleForm.amount) ||
                settleForm.reference.trim().length < 2
              }
              onClick={() => settling && settleMutation.mutate({
                id: settling.id,
                body: {
                  amountRupees: Number(settleForm.amount),
                  reference: settleForm.reference.trim(),
                  ...(settleForm.note.trim() ? { note: settleForm.note.trim() } : {}),
                },
              })}
            >
              {settleMutation.isPending ? "Recording…" : "Record payout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credentials — shown once */}
      <Dialog open={credentials !== null} onOpenChange={(o) => !o && setCredentials(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{credentials?.company} is live</DialogTitle>
            <DialogDescription>
              {credentials?.password
                ? "Copy these now — the password is not stored and cannot be shown again."
                : "They can sign in with the password you set."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 font-mono text-sm">
            <p className="text-white">Username: {credentials?.username}</p>
            {credentials?.password && <p className="text-white">Password: {credentials.password}</p>}
          </div>
          <DialogFooter>
            <Button onClick={() => setCredentials(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {importingForOperator && (
        <BulkCustomerImporter
          open={importingForOperator !== null}
          onOpenChange={(o) => !o && setImportingForOperator(null)}
          operatorId={importingForOperator.id}
          operatorName={importingForOperator.companyName}
          isStaffAdmin={true}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/ftth/operators"] });
          }}
        />
      )}
    </div>
  );
}
