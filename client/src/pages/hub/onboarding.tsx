/**
 * Onboarding & KYC — everything UniteFix needs before a business goes live,
 * on one page: identity checks, bank account, documents, the agreement, and
 * the submit button that sends it for review.
 *
 * After approval the same page is the record: what was verified, when, and
 * which agreement version was accepted.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useHubMe, hubCan } from "@/lib/hub";
import { HubPage, Panel, Chip } from "@/components/hub/ui";

type Onboarding = {
  status: string; submittedAt: string | null; rejectionReason: string | null; verticals: string[]; readyToSubmit: boolean;
  steps: Array<{ key: string; label: string; done: boolean; detail: string }>;
  documents: Array<{ code: string; label: string; hint: string; required: boolean; hasExpiry?: boolean; done: boolean; document: { id: number; status: string; fileUrl: string; fileName: string | null; reviewNote: string | null; expiresAt: string | null; createdAt: string } | null }>;
  agreements: Array<{ code: string; version: string; title: string; sections: Array<[string, string]>; accepted: boolean; acceptedAt: string | null }>;
  bank: { beneficiaryName: string | null; last4: string | null; ifsc: string | null; status: string; nameAtBank: string | null };
};

const DOC_TONE: Record<string, string> = { uploaded: "info", verified: "good", rejected: "bad" };

export default function HubOnboarding() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: o } = useQuery<Onboarding>({ queryKey: ["/api/hub/onboarding"], queryFn: async () => (await apiRequest("GET", "/api/hub/onboarding")).data });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/hub/onboarding"] }); qc.invalidateQueries({ queryKey: ["/api/hub/me"] }); };
  const fail = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });

  const [bank, setBank] = useState({ beneficiaryName: "", accountNumber: "", ifsc: "" });
  const saveBank = useMutation({
    mutationFn: async () => apiRequest("PUT", "/api/hub/onboarding/bank", bank),
    onSuccess: (r: any) => { refresh(); setBank({ beneficiaryName: "", accountNumber: "", ifsc: "" }); toast({ title: "Bank account saved", description: r?.message }); },
    onError: fail("Bank account not saved"),
  });

  const [uploading, setUploading] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const upload = async (code: string, file: File | undefined) => {
    if (!file) return;
    setUploading(code);
    try {
      const fd = new FormData();
      fd.append("docType", code);
      fd.append("file", file);
      if (expiry[code]) fd.append("expiresAt", expiry[code]);
      const res = await fetch("/api/hub/documents", { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("adminToken") ?? ""}` }, body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body)}`);
      toast({ title: "Uploaded" });
      refresh();
    } catch (e) { fail("Upload failed")(e); } finally { setUploading(null); }
  };

  const [agree, setAgree] = useState(false);
  const accept = useMutation({ mutationFn: async () => apiRequest("POST", "/api/hub/agreements/accept"), onSuccess: () => { refresh(); toast({ title: "Agreement accepted" }); }, onError: fail("Not accepted") });
  const submit = useMutation({ mutationFn: async () => apiRequest("POST", "/api/hub/onboarding/submit"), onSuccess: (r: any) => { refresh(); toast({ title: "Submitted", description: r?.message }); }, onError: fail("Not submitted") });

  if (!me || !o) return <HubPage title="Onboarding & KYC"><p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p></HubPage>;
  const owner = hubCan(me, "team:manage");
  const canDocs = hubCan(me, "docs:manage");
  const pending = o.status === "pending_approval";

  return (
    <HubPage
      title="Onboarding & KYC"
      subtitle={pending
        ? "UniteFix checks what it can automatically. A person reviews the rest within 48 hours of submission."
        : "Your verified business details. Changes to the GSTIN or bank account go through UniteFix support."}
      actions={pending && owner ? (
        <Button onClick={() => submit.mutate()} disabled={!o.readyToSubmit || submit.isPending || !!o.submittedAt}>
          {o.submittedAt ? "Submitted — under review" : "Submit for review"}
        </Button>
      ) : undefined}
    >
      {o.rejectionReason && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">UniteFix asked for changes: {o.rejectionReason}</div>}

      <Panel title="Checks">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {o.steps.map(s => (
            <li key={s.key} className="flex items-start gap-3 rounded-lg bg-[rgba(255,255,255,0.03)] p-3">
              <span className={`material-icons text-[20px] ${s.done ? "text-emerald-400" : "text-amber-400"}`} style={{ fontFamily: "Material Icons" }}>{s.done ? "check_circle" : "pending"}</span>
              <div className="min-w-0"><p className="text-sm text-white">{s.label}</p><p className="text-xs text-[hsl(215,20%,60%)] break-words">{s.detail}</p></div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-[hsl(215,20%,55%)]">The GSTIN is checked for its format, state code and check digit, and the PAN must match the one inside it. A GST-portal lookup is done by UniteFix during review.</p>
      </Panel>

      <Panel title="Bank account for settlements" actions={<Chip tone={o.bank.status === "verified" ? "good" : o.bank.status === "failed" ? "bad" : "warn"}>{o.bank.status}</Chip>}>
        {o.bank.last4 && <p className="mb-3 text-sm text-[hsl(210,20%,85%)]">{o.bank.beneficiaryName} · A/c ending {o.bank.last4} · {o.bank.ifsc}{o.bank.nameAtBank ? ` · bank says: ${o.bank.nameAtBank}` : ""}</p>}
        {owner && !(o.status === "active" && o.bank.status === "verified") ? (
          <div className="grid gap-3 sm:grid-cols-4 items-end">
            <div className="sm:col-span-2"><Label htmlFor="bank-name">Account holder name</Label><Input id="bank-name" value={bank.beneficiaryName} onChange={e => setBank({ ...bank, beneficiaryName: e.target.value })} /></div>
            <div><Label htmlFor="bank-acct">Account number</Label><Input id="bank-acct" inputMode="numeric" value={bank.accountNumber} onChange={e => setBank({ ...bank, accountNumber: e.target.value })} /></div>
            <div><Label htmlFor="bank-ifsc">IFSC</Label><Input id="bank-ifsc" value={bank.ifsc} onChange={e => setBank({ ...bank, ifsc: e.target.value.toUpperCase() })} maxLength={11} /></div>
            <div className="sm:col-span-4 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-[hsl(215,20%,55%)]">Settlements are paid only to this account. After approval it can be changed only through UniteFix, so a stolen password cannot redirect your money.</p>
              <Button onClick={() => saveBank.mutate()} disabled={saveBank.isPending || !bank.beneficiaryName || !bank.accountNumber || bank.ifsc.length !== 11}>{o.bank.last4 ? "Replace account" : "Save account"}</Button>
            </div>
          </div>
        ) : !owner ? <p className="text-xs text-[hsl(215,20%,55%)]">Only the owner can change bank details.</p> : null}
      </Panel>

      <Panel title="Documents">
        <ul className="divide-y divide-[rgba(255,255,255,0.06)]">
          {o.documents.map(d => (
            <li key={d.code} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-[220px] flex-1">
                <p className="text-sm text-white">{d.label} {d.required ? <Chip tone="warn">required</Chip> : <Chip>optional</Chip>}</p>
                <p className="text-xs text-[hsl(215,20%,60%)]">{d.hint}</p>
                {d.document?.reviewNote && <p className="text-xs text-rose-300 mt-1">UniteFix: {d.document.reviewNote}</p>}
              </div>
              {d.document && (
                <div className="flex items-center gap-2">
                  <Chip tone={DOC_TONE[d.document.status] ?? "muted"}>{d.document.status}</Chip>
                  <a href={d.document.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-[hsl(174,72%,60%)] underline underline-offset-2">{d.document.fileName ?? "view"}</a>
                  {d.document.expiresAt && <span className="text-xs text-[hsl(215,20%,60%)]">expires {d.document.expiresAt}</span>}
                </div>
              )}
              {canDocs && (
                <div className="flex items-center gap-2">
                  {d.hasExpiry && <Input type="date" aria-label={`${d.label} expiry date`} className="h-8 w-40" value={expiry[d.code] ?? ""} onChange={e => setExpiry({ ...expiry, [d.code]: e.target.value })} />}
                  <label className="cursor-pointer rounded-md border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-white hover:bg-[rgba(255,255,255,0.05)]">
                    {uploading === d.code ? "Uploading…" : d.document ? "Replace" : "Upload"}
                    <input type="file" accept="application/pdf,image/*" className="hidden" disabled={uploading !== null} onChange={e => upload(d.code, e.target.files?.[0])} />
                  </label>
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-[hsl(215,20%,55%)]">PDF, JPG or PNG, up to 8 MB. A new upload replaces the previous one; the old one is kept on record.</p>
      </Panel>

      <Panel title="Partner agreement">
        <div className="space-y-4">
          {o.agreements.map(a => (
            <details key={a.code} className="rounded-lg bg-[rgba(255,255,255,0.03)] p-3" open={!a.accepted && pending}>
              <summary className="cursor-pointer text-sm text-white flex items-center gap-2">
                {a.title} <span className="font-mono text-[11px] text-[hsl(215,20%,55%)]">{a.version}</span>
                {a.accepted ? <Chip tone="good">accepted {a.acceptedAt ? new Date(a.acceptedAt).toLocaleDateString("en-IN") : ""}</Chip> : <Chip tone="warn">to accept</Chip>}
              </summary>
              <dl className="mt-3 space-y-2">
                {a.sections.map(([h, t]) => (<div key={h}><dt className="text-xs font-semibold text-[hsl(210,20%,85%)]">{h}</dt><dd className="text-sm text-[hsl(215,20%,70%)]">{t}</dd></div>))}
              </dl>
            </details>
          ))}
        </div>
        {o.agreements.some(a => !a.accepted) && owner && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-white">
              <input id="agree" type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
              I accept these terms on behalf of {me.business?.legalName ?? me.displayName}.
            </label>
            <Button onClick={() => accept.mutate()} disabled={!agree || accept.isPending}>Accept</Button>
          </div>
        )}
        <p className="mt-3 text-xs text-[hsl(215,20%,55%)]">Acceptance is recorded with the version, date and the login that accepted. If the terms change you will be asked again.</p>
      </Panel>
    </HubPage>
  );
}
