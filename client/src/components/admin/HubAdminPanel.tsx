/**
 * Staff view of a partner's Hub: onboarding checks, documents to review,
 * bank verification, agreement acceptance, team, modules, plan and the
 * e-invoicing flag. Lives as a tab in the Business Partners dialog.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { MODULE_LABEL, HUB_ROLE_LABEL, type HubModule, type HubRole } from "@shared/hub";

type HubDetail = {
  id: number; partnerCode: string; status: string; appliedVia: string | null; submittedAt: string | null; hubPlan: "starter" | "pro"; aatoAbove5cr: boolean;
  gstin: string | null; gstinStatus: string; stateName: string | null; pan: string | null; panStatus: string; coveragePincodes: string[]; hasHubLogin: boolean;
  modules: HubModule[]; moduleOverrides: Array<{ module: string; enabled: boolean }>; verticalModules: HubModule[];
  onboarding: {
    steps: Array<{ key: string; label: string; done: boolean; detail: string }>;
    documents: Array<{ code: string; label: string; required: boolean; document: { id: number; status: string; fileUrl: string; fileName: string | null; reviewNote: string | null; expiresAt: string | null } | null }>;
    agreements: Array<{ code: string; version: string; title: string; accepted: boolean; acceptedAt: string | null }>;
    bank: { beneficiaryName: string | null; last4: string | null; ifsc: string | null; status: string; nameAtBank: string | null };
  };
  team: Array<{ id: number; role: HubRole; status: string; displayName: string | null; email: string; lastLogin: string | null }>;
};

export default function HubAdminPanel({ partnerId }: { partnerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = ["/api/admin/hub/partners", partnerId];
  const { data: d, isLoading } = useQuery<HubDetail>({ queryKey: key, queryFn: async () => (await apiRequest("GET", `/api/admin/hub/partners/${partnerId}`)).data });
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["/api/admin/business-partners"] }); };
  const act = useMutation({
    mutationFn: async (v: { method?: string; path: string; body?: unknown }) => apiRequest(v.method ?? "POST", `/api/admin/hub/partners/${partnerId}${v.path}`, v.body),
    onSuccess: (r: any) => { refresh(); toast({ title: "Done", description: r?.message }); },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const [note, setNote] = useState<Record<number, string>>({});
  const [bankRef, setBankRef] = useState("");
  const [issued, setIssued] = useState<{ username: string; temporaryPassword: string } | null>(null);
  const ownerLogin = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/hub/partners/${partnerId}/owner-login`, {}),
    onSuccess: (r: any) => { refresh(); setIssued(r.data); },
    onError: (e) => toast({ title: "Not created", description: apiErrorMessage(e), variant: "destructive" }),
  });

  if (isLoading || !d) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const override = (m: string) => d.moduleOverrides.find(o => o.module === m);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">applied via {d.appliedVia ?? "admin"}</Badge>
        {d.submittedAt ? <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">submitted {new Date(d.submittedAt).toLocaleDateString("en-IN")}</Badge> : d.status === "pending_approval" && <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">not submitted yet</Badge>}
        {!d.hasHubLogin && <Button size="sm" variant="outline" onClick={() => ownerLogin.mutate()} disabled={ownerLogin.isPending}>Create Hub login</Button>}
      </div>
      {issued && <div className="rounded-md border p-3 font-mono text-xs">Hub login: {issued.username} · temporary password: {issued.temporaryPassword} <span className="font-sans text-muted-foreground">(shown once)</span></div>}

      <div className="grid gap-2 sm:grid-cols-2">
        {d.onboarding.steps.map(s => (
          <div key={s.key} className="rounded-md border p-2.5">
            <div className="flex items-center gap-2"><span className={s.done ? "text-emerald-600" : "text-amber-600"}>{s.done ? "✓" : "•"}</span><b>{s.label}</b></div>
            <div className="text-xs text-muted-foreground break-words">{s.detail}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">GSTIN checked for format, state and check digit{d.gstin ? ` (${d.gstinStatus}, ${d.stateName ?? "?"})` : ""}. Confirm it is active on the GST portal before approving.{d.coveragePincodes.length ? ` Broadband coverage asked for: ${d.coveragePincodes.join(", ")}.` : ""}</p>

      <div className="rounded-md border p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b>Bank</b>
          <span>{d.onboarding.bank.last4 ? `${d.onboarding.bank.beneficiaryName} · ····${d.onboarding.bank.last4} · ${d.onboarding.bank.ifsc}` : "not added"} · <Badge variant="secondary">{d.onboarding.bank.status}</Badge></span>
        </div>
        {d.onboarding.bank.last4 && d.onboarding.bank.status !== "verified" && (
          <div className="flex flex-wrap gap-2">
            <Input className="h-8 flex-1 min-w-[220px]" placeholder="How you checked it, e.g. 'cancelled cheque matched'" value={bankRef} onChange={e => setBankRef(e.target.value)} />
            <Button size="sm" disabled={bankRef.trim().length < 3} onClick={() => act.mutate({ path: "/bank-verified", body: { reference: bankRef } })}>Mark verified</Button>
          </div>
        )}
      </div>

      <div className="rounded-md border">
        <div className="border-b px-3 py-2 font-semibold">Documents</div>
        <ul className="divide-y">
          {d.onboarding.documents.map(doc => (
            <li key={doc.code} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="flex-1 min-w-[180px]">{doc.label}{doc.required && <span className="text-xs text-muted-foreground"> · required</span>}</span>
              {doc.document ? (
                <>
                  <a href={doc.document.fileUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 text-xs">{doc.document.fileName ?? "open"}</a>
                  <Badge variant="secondary">{doc.document.status}</Badge>
                  {doc.document.status !== "verified" && <Button size="sm" variant="outline" onClick={() => act.mutate({ path: `/documents/${doc.document!.id}/review`, body: { status: "verified" } })}>Verify</Button>}
                  <Input className="h-8 w-48" placeholder="Reason to reject" value={note[doc.document.id] ?? ""} onChange={e => setNote({ ...note, [doc.document!.id]: e.target.value })} />
                  <Button size="sm" variant="ghost" disabled={!(note[doc.document.id] ?? "").trim()} onClick={() => act.mutate({ path: `/documents/${doc.document!.id}/review`, body: { status: "rejected", note: note[doc.document!.id] } })}>Reject</Button>
                </>
              ) : <span className="text-xs text-muted-foreground">not uploaded</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-md border p-3">
        <b>Agreements</b>
        <ul className="mt-1 space-y-1">{d.onboarding.agreements.map(a => <li key={a.code}>{a.title} <span className="font-mono text-xs text-muted-foreground">{a.version}</span> — {a.accepted ? `accepted ${a.acceptedAt ? new Date(a.acceptedAt).toLocaleString("en-IN") : ""}` : <span className="text-amber-700">not accepted</span>}</li>)}</ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3 space-y-2">
          <b>Modules</b>
          <ul className="space-y-1">
            {d.verticalModules.map(m => {
              const o = override(m);
              return (
                <li key={m} className="flex items-center justify-between gap-2">
                  <span>{MODULE_LABEL[m]} {d.modules.includes(m) ? <Badge variant="secondary">on</Badge> : <span className="text-xs text-muted-foreground">off</span>}{o && <span className="text-xs text-muted-foreground"> · override</span>}</span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => act.mutate({ method: "PUT", path: "/modules", body: { module: m, enabled: true } })}>On</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => act.mutate({ method: "PUT", path: "/modules", body: { module: m, enabled: false } })}>Off</Button>
                    {o && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => act.mutate({ method: "PUT", path: "/modules", body: { module: m, enabled: null } })}>Default</Button>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="rounded-md border p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <b>Plan</b>
            <select className="h-8 rounded-md border bg-background px-2" value={d.hubPlan} onChange={e => act.mutate({ method: "PUT", path: "/plan", body: { plan: e.target.value } })}>
              <option value="starter">Starter (free)</option><option value="pro">Pro</option>
            </select>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={d.aatoAbove5cr} onChange={e => act.mutate({ method: "PATCH", path: "/flags", body: { aatoAbove5cr: e.target.checked } })} />
            Turnover above ₹5 crore (B2B invoices need an IRN)
          </label>
          <div>
            <b>Team</b>
            <ul className="mt-1 space-y-1">{d.team.map(m => <li key={m.id} className="flex justify-between gap-2"><span>{m.displayName ?? m.email} · {HUB_ROLE_LABEL[m.role]}</span><span className="text-xs text-muted-foreground">{m.status}{m.lastLogin ? ` · ${new Date(m.lastLogin).toLocaleDateString("en-IN")}` : ""}</span></li>)}</ul>
          </div>
        </div>
      </div>
    </div>
  );
}
