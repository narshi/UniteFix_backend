/**
 * One operator, from UniteFix's side.
 *
 * Super admin oversight: what they sell, who their customers are, what they owe
 * us and we owe them, plus the controls that outlive approval — commercial
 * terms, coverage, and a password reset for when they phone up locked out.
 *
 * Their CATALOGUE is read-only here on purpose. Repricing someone else's product
 * on their behalf is a liability, not a convenience, and every plan edit should
 * be attributable to the operator who made it. Fixing a bad price is a phone
 * call, not a button.
 */

import { useState } from "react";
import { useRoute, Link } from "wouter";
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
import { ArrowLeft, KeyRound, Pencil, MapPin } from "lucide-react";
import { format } from "date-fns";

interface OperatorDetail {
  id: number;
  companyName: string;
  legalName: string | null;
  gstin: string | null;
  contactName: string | null;
  contactEmail: string;
  contactPhone: string;
  status: string;
  adminUserId: number | null;
  logoUrl: string | null;
  brandColor: string | null;
  leadFee: number | null;
  convenienceFee: number | null;
  approvedAt: string | null;
  pincodes: Array<{ pincode: string; isActive: boolean }>;
}

interface Activity {
  plans: Array<{
    id: number; name: string; speedMbps: number; durationMonths: number;
    finalPrice: number; isActive: boolean;
  }>;
  connections: Array<{
    id: number; ispConnectionId: string | null; status: string; validTill: string | null;
    customerName: string | null; userPhone: string | null; planName: string | null;
  }>;
  leads: Array<{ id: number; name: string; phone: string; status: string; leadFee: number | null; createdAt: string }>;
  recharges: Array<{
    id: number; planName: string; customerPaid: number; operatorShare: number; unitefixShare: number;
    status: string; fulfilledAt: string | null; createdAt: string; ispConnectionId: string | null;
  }>;
  ledger: Array<{ id: number; entryType: string; amount: number; description: string | null; createdAt: string }>;
  summary: {
    balance: number; activePlans: number; connections: number; activeConnections: number;
    openLeads: number; convertedLeads: number; successfulRecharges: number;
    grossCollected: number; unitefixRevenue: number; awaitingFulfilment: number;
  };
}

export default function FtthOperatorDetailPage() {
  const [, params] = useRoute("/admin/ftth-operators/:id");
  const id = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // `ftth:view` reads this page. Editing terms, resetting the password and
  // changing coverage need `ftth:manage`, enforced by the capability guard.
  const { can } = useAdminMe();

  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [editingCoverage, setEditingCoverage] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [pincodeDraft, setPincodeDraft] = useState("");

  const { data: opData, isLoading } = useQuery<{ data: OperatorDetail }>({
    queryKey: [`/api/admin/ftth/operators/${id}`],
    enabled: Number.isInteger(id),
  });
  const { data: actData } = useQuery<{ data: Activity }>({
    queryKey: [`/api/admin/ftth/operators/${id}/activity`],
    enabled: Number.isInteger(id),
  });

  const operator = opData?.data;
  const activity = actData?.data;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/admin/ftth/operators/${id}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/admin/ftth/operators/${id}/activity`] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/ftth/operators"] });
  };

  const editMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (form.companyName?.trim()) body.companyName = form.companyName.trim();
      if (form.contactName !== undefined) body.contactName = form.contactName.trim() || null;
      if (form.contactEmail?.trim()) body.contactEmail = form.contactEmail.trim();
      if (form.contactPhone?.trim()) body.contactPhone = form.contactPhone.trim();
      if (form.gstin !== undefined) body.gstin = form.gstin.trim() || null;
      // Blank means "use the platform default", which is a real, different intent
      // from leaving the field alone.
      body.leadFeeRupees = form.leadFee?.trim() ? Number(form.leadFee) : null;
      body.convenienceFeeRupees = form.convenienceFee?.trim() ? Number(form.convenienceFee) : null;
      return apiRequest("PATCH", `/api/admin/ftth/operators/${id}`, body);
    },
    onSuccess: () => { refresh(); setEditing(false); toast({ title: "Operator updated" }); },
    onError: (e: Error) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const resetMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/ftth/operators/${id}/reset-password`, {}),
    onSuccess: (r: any) => {
      setResetting(false);
      setNewPassword(r?.data?.temporaryPassword ?? null);
      toast({ title: "Password reset" });
    },
    onError: (e: Error) => toast({ title: "Could not reset", description: e.message, variant: "destructive" }),
  });

  const coverageMutation = useMutation({
    mutationFn: async () => apiRequest("PUT", `/api/admin/ftth/operators/${id}/coverage`, {
      pincodes: pincodeDraft.split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
    }),
    onSuccess: (r: any) => {
      refresh(); setEditingCoverage(false);
      toast({ title: "Coverage saved", description: r?.message });
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const openEdit = () => {
    if (!operator) return;
    setForm({
      companyName: operator.companyName,
      contactName: operator.contactName ?? "",
      contactEmail: operator.contactEmail,
      contactPhone: operator.contactPhone,
      gstin: operator.gstin ?? "",
      leadFee: operator.leadFee !== null ? String(operator.leadFee) : "",
      convenienceFee: operator.convenienceFee !== null ? String(operator.convenienceFee) : "",
    });
    setEditing(true);
  };

  if (isLoading) return <div className="p-8 text-[hsl(215,20%,65%)]">Loading…</div>;
  if (!operator) return <div className="p-8 text-[hsl(215,20%,65%)]">Operator not found.</div>;

  const s = activity?.summary;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <Link href="/admin/ftth-operators">
        <a className="inline-flex items-center gap-1.5 text-sm text-[hsl(215,20%,65%)] hover:text-white">
          <ArrowLeft className="w-4 h-4" /> All operators
        </a>
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white tracking-tight">{operator.companyName}</h1>
            <Badge className="bg-[rgba(255,255,255,0.05)] text-[hsl(215,20%,70%)] border-[rgba(255,255,255,0.12)]">
              {operator.status}
            </Badge>
          </div>
          <p className="text-sm text-[hsl(215,20%,65%)] mt-1">
            {operator.contactName ? `${operator.contactName} · ` : ""}
            {operator.contactPhone} · {operator.contactEmail}
            {operator.gstin ? ` · GSTIN ${operator.gstin}` : ""}
          </p>
        </div>
        {can('ftth:manage') && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={openEdit}>
              <Pencil className="w-4 h-4 mr-1.5" /> Edit terms
            </Button>
            <Button size="sm" variant="outline" onClick={() => setResetting(true)} disabled={!operator.adminUserId}>
              <KeyRound className="w-4 h-4 mr-1.5" /> Reset password
            </Button>
          </div>
        )}
      </header>

      {s && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Balance due to them" value={`₹${s.balance.toLocaleString("en-IN")}`} tone={s.balance > 0 ? "good" : "muted"} />
          <Stat label="UniteFix earned" value={`₹${s.unitefixRevenue.toLocaleString("en-IN")}`} tone="good" />
          <Stat label="Gross collected" value={`₹${s.grossCollected.toLocaleString("en-IN")}`} />
          <Stat
            label="Awaiting fulfilment"
            value={String(s.awaitingFulfilment)}
            tone={s.awaitingFulfilment > 0 ? "warn" : "muted"}
          />
          <Stat label="Active connections" value={`${s.activeConnections} / ${s.connections}`} />
          <Stat label="Active plans" value={String(s.activePlans)} />
          <Stat label="Open leads" value={String(s.openLeads)} tone={s.openLeads > 0 ? "warn" : "muted"} />
          <Stat label="Converted leads" value={String(s.convertedLeads)} />
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Coverage
            </CardTitle>
            {can('ftth:manage') && (
              <Button
                size="sm" variant="outline"
                onClick={() => {
                  setPincodeDraft(operator.pincodes.map(p => p.pincode).join(", "));
                  setEditingCoverage(true);
                }}
              >
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {operator.pincodes.length === 0 ? (
            <p className="text-sm text-amber-300">
              No pincodes — customers cannot see this operator anywhere in the app.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {operator.pincodes.map(p => (
                <span key={p.pincode} className="px-2.5 py-1 rounded-lg text-sm font-mono text-[hsl(210,20%,85%)] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)]">
                  {p.pincode}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Their plans</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-[hsl(215,20%,55%)] mb-3">
            Read-only. Prices are the operator's to set — ask them to change it from their portal.
          </p>
          {!activity?.plans.length ? (
            <p className="text-sm text-[hsl(215,20%,55%)]">No plans published yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {activity.plans.map(p => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="text-white">
                    {p.speedMbps} Mbps · {p.durationMonths} month{p.durationMonths === 1 ? "" : "s"}
                    <span className="text-[hsl(215,20%,55%)]"> — {p.name}</span>
                  </span>
                  <span className={p.isActive ? "text-white" : "text-[hsl(215,20%,45%)] line-through"}>
                    ₹{p.finalPrice}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Customers</CardTitle></CardHeader>
          <CardContent>
            {!activity?.connections.length ? (
              <p className="text-sm text-[hsl(215,20%,55%)]">No customers yet.</p>
            ) : (
              <ul className="space-y-2">
                {activity.connections.slice(0, 25).map(cn => (
                  <li key={cn.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white">{cn.ispConnectionId ?? "Awaiting ID"}</span>
                      <span className="text-xs text-[hsl(215,20%,55%)]">{cn.status}</span>
                    </div>
                    <p className="text-xs text-[hsl(215,20%,50%)]">
                      {cn.customerName ?? "—"} · {cn.userPhone ?? "—"}
                      {cn.validTill ? ` · till ${format(new Date(cn.validTill), "d MMM yyyy")}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent recharges</CardTitle></CardHeader>
          <CardContent>
            {!activity?.recharges.length ? (
              <p className="text-sm text-[hsl(215,20%,55%)]">No recharges yet.</p>
            ) : (
              <ul className="space-y-2">
                {activity.recharges.slice(0, 25).map(r => (
                  <li key={r.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white">{r.ispConnectionId ?? "—"} · {r.planName}</span>
                      <span className="text-white">₹{r.customerPaid}</span>
                    </div>
                    <p className="text-xs text-[hsl(215,20%,50%)]">
                      {format(new Date(r.createdAt), "d MMM, HH:mm")} · them ₹{r.operatorShare} · us ₹{r.unitefixShare}
                      {r.status === "success" && !r.fulfilledAt ? " · not yet applied by operator" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Statement</CardTitle></CardHeader>
        <CardContent>
          {!activity?.ledger.length ? (
            <p className="text-sm text-[hsl(215,20%,55%)]">No entries yet.</p>
          ) : (
            <ul className="divide-y divide-[rgba(255,255,255,0.05)]">
              {activity.ledger.slice(0, 40).map(e => (
                <li key={e.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="text-white">{e.entryType.replace(/_/g, " ")}</p>
                    {e.description && <p className="text-xs text-[hsl(215,20%,55%)]">{e.description}</p>}
                    <p className="text-xs text-[hsl(215,20%,40%)]">
                      {format(new Date(e.createdAt), "d MMM yyyy, HH:mm")}
                    </p>
                  </div>
                  <span className={`shrink-0 font-mono ${
                    e.amount > 0 ? "text-[hsl(160,84%,60%)]" : e.amount < 0 ? "text-[hsl(347,77%,65%)]" : "text-[hsl(215,20%,50%)]"
                  }`}>
                    {e.amount > 0 ? "+" : ""}₹{Math.abs(e.amount).toLocaleString("en-IN")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Edit terms */}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {operator.companyName}</DialogTitle>
            <DialogDescription>
              Commercial terms take effect on the next recharge or lead conversion — history keeps
              the rate it was priced at.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field id="companyName" label="Company name" form={form} setForm={setForm} />
            <Field id="contactName" label="Contact person" form={form} setForm={setForm} />
            <Field id="contactEmail" label="Email (also their login email)" form={form} setForm={setForm} />
            <Field id="contactPhone" label="Phone" form={form} setForm={setForm} />
            <Field id="gstin" label="GSTIN" form={form} setForm={setForm} />
            <div className="grid grid-cols-2 gap-3">
              <Field id="leadFee" label="Lead fee (₹)" form={form} setForm={setForm} placeholder="platform default" />
              <Field id="convenienceFee" label="Convenience fee (₹)" form={form} setForm={setForm} placeholder="platform default" />
            </div>
            <p className="text-xs text-[hsl(215,20%,55%)]">
              Leave a fee blank to fall back to the platform default.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>
              {editMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Coverage */}
      <Dialog open={editingCoverage} onOpenChange={setEditingCoverage}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Coverage for {operator.companyName}</DialogTitle>
            <DialogDescription>
              Comma or space separated. Only pincodes UniteFix already serves are accepted.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={pincodeDraft}
            onChange={(e) => setPincodeDraft(e.target.value)}
            rows={4}
            className="w-full rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] p-3 text-sm text-white font-mono"
            placeholder="581359, 581355"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCoverage(false)}>Cancel</Button>
            <Button onClick={() => coverageMutation.mutate()} disabled={coverageMutation.isPending}>
              {coverageMutation.isPending ? "Saving…" : "Save coverage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={resetting} onOpenChange={setResetting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password?</DialogTitle>
            <DialogDescription>
              {operator.companyName} will be signed out on their next request. A new password is
              generated and shown to you once.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetting(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>
              {resetMutation.isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newPassword !== null} onOpenChange={(o) => !o && setNewPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New password</DialogTitle>
            <DialogDescription>
              Copy it now — it isn't stored and cannot be shown again.
            </DialogDescription>
          </DialogHeader>
          <p className="font-mono text-white text-sm">{newPassword}</p>
          <DialogFooter>
            <Button onClick={() => setNewPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "muted" }) {
  const color =
    tone === "good" ? "text-[hsl(160,84%,60%)]"
      : tone === "warn" ? "text-[hsl(38,92%,60%)]"
        : "text-white";
  return (
    <div className="glass-card border border-[rgba(255,255,255,0.08)] rounded-xl p-4">
      <p className="text-xs uppercase tracking-wider text-[hsl(215,20%,55%)]">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function Field({ id, label, form, setForm, placeholder }: {
  id: string; label: string;
  form: Record<string, string>;
  setForm: (f: Record<string, string>) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={form[id] ?? ""}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [id]: e.target.value })}
      />
    </div>
  );
}
