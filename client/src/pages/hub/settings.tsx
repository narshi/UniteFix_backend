/**
 * Business profile — the details printed on every invoice this business
 * issues, the plan, the modules, and the signed-in person's password.
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useHubMe, hubCan } from "@/lib/hub";
import { HubPage, Panel, Chip } from "@/components/hub/ui";
import { MODULE_LABEL, PLAN_LABEL, VERTICAL_MODULES } from "@shared/hub";

export default function HubSettings() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });

  const [p, setP] = useState({ displayName: "", contactName: "", address: "", pincode: "", district: "", gstin: "" });
  useEffect(() => {
    if (me?.business) setP({
      displayName: me.business.displayName ?? "", contactName: me.business.contactName ?? "", address: me.business.address ?? "",
      pincode: me.business.pincode ?? "", district: me.business.district ?? "", gstin: me.business.gstin ?? "",
    });
  }, [me?.business]);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { displayName: p.displayName, contactName: p.contactName, address: p.address || null, pincode: p.pincode || null, district: p.district || null };
      if (me?.status !== "active") body.gstin = p.gstin || null;
      return apiRequest("PATCH", "/api/hub/profile", body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/hub/me"] }); toast({ title: "Saved" }); },
    onError: fail("Not saved"),
  });

  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const changePw = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/hub/password", { currentPassword: pw.currentPassword, newPassword: pw.newPassword }),
    onSuccess: () => { setPw({ currentPassword: "", newPassword: "", confirm: "" }); toast({ title: "Password changed" }); },
    onError: fail("Password not changed"),
  });

  if (!me) return null;
  const canEdit = hubCan(me, "settings:manage");

  return (
    <HubPage title="Business profile" subtitle="These details appear on the invoices your business issues through the Hub.">
      <Panel title="Business" actions={canEdit ? <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button> : undefined}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="bp-display">Trading name</Label><Input id="bp-display" value={p.displayName} disabled={!canEdit} onChange={e => setP({ ...p, displayName: e.target.value })} /></div>
          <div><Label>Legal name</Label><Input value={me.business?.legalName ?? ""} disabled /></div>
          <div><Label htmlFor="bp-gstin">GSTIN</Label><Input id="bp-gstin" value={p.gstin} disabled={!canEdit || me.status === "active"} onChange={e => setP({ ...p, gstin: e.target.value.toUpperCase() })} maxLength={15} />
            <p className="mt-1 text-xs text-[hsl(215,20%,55%)]">{me.business?.stateName ? `State: ${me.business.stateName} (${me.business.stateCode})` : "Sets your state for GST."}{me.status === "active" ? " Locked after approval — ask UniteFix to change it." : ""}</p></div>
          <div><Label>PAN</Label><Input value={me.business?.pan ?? ""} disabled /></div>
          <div><Label htmlFor="bp-contact">Contact person</Label><Input id="bp-contact" value={p.contactName} disabled={!canEdit} onChange={e => setP({ ...p, contactName: e.target.value })} /></div>
          <div><Label>Phone · email</Label><Input value={`${me.business?.contactPhone ?? ""} · ${me.business?.contactEmail ?? ""}`} disabled /></div>
          <div className="sm:col-span-2"><Label htmlFor="bp-address">Address (printed on invoices)</Label><Input id="bp-address" value={p.address} disabled={!canEdit} onChange={e => setP({ ...p, address: e.target.value })} /></div>
          <div><Label htmlFor="bp-pin">Pincode</Label><Input id="bp-pin" value={p.pincode} disabled={!canEdit} inputMode="numeric" maxLength={6} onChange={e => setP({ ...p, pincode: e.target.value })} /></div>
          <div><Label htmlFor="bp-district">District</Label><Input id="bp-district" value={p.district} disabled={!canEdit} onChange={e => setP({ ...p, district: e.target.value })} /></div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Plan">
          <p className="text-white">{PLAN_LABEL[me.plan]}</p>
          <ul className="mt-2 space-y-1 text-sm text-[hsl(215,20%,70%)]">
            <li>Invoices a month: {me.planLimits.invoicesPerMonth ?? "unlimited"}</li>
            <li>Team seats: {me.planLimits.teamMembers ?? "unlimited"}</li>
            <li>GST exports (GSTR-1): {me.planLimits.gstExports ? "included" : "Pro"}</li>
            <li>E-invoicing (IRN): {me.planLimits.eInvoice ? "included" : "Pro"}</li>
          </ul>
          {me.plan === "starter" && <p className="mt-3 text-xs text-[hsl(215,20%,55%)]">To move to Pro, contact UniteFix. Pro is billed monthly on your statement.</p>}
          {me.business?.aatoAbove5cr && <p className="mt-3 text-xs text-amber-300">Your turnover is above ₹5 crore: B2B invoices need an IRN (e-invoice).</p>}
        </Panel>
        <Panel title="Modules">
          <div className="flex flex-wrap gap-2">
            {VERTICAL_MODULES.map(m => <Chip key={m} tone={me.modules.includes(m) ? "good" : "muted"}>{MODULE_LABEL[m]}{me.modules.includes(m) ? "" : " · off"}</Chip>)}
          </div>
          <p className="mt-3 text-xs text-[hsl(215,20%,55%)]">Switched on by what your business does ({me.verticals.join(", ")}). Ask UniteFix to add a vertical to get another module.</p>
        </Panel>
      </div>

      <Panel title="Your password">
        <div className="grid gap-3 sm:grid-cols-3 items-end">
          <div><Label htmlFor="pw-cur">Current password</Label><Input id="pw-cur" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={e => setPw({ ...pw, currentPassword: e.target.value })} /></div>
          <div><Label htmlFor="pw-new">New password</Label><Input id="pw-new" type="password" autoComplete="new-password" value={pw.newPassword} onChange={e => setPw({ ...pw, newPassword: e.target.value })} /></div>
          <div><Label htmlFor="pw-conf">Repeat new password</Label><Input id="pw-conf" type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} /></div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-[hsl(215,20%,55%)]">{pw.newPassword && pw.confirm && pw.newPassword !== pw.confirm ? "The two new passwords don't match." : "At least 8 characters."}</p>
          <Button onClick={() => changePw.mutate()} disabled={changePw.isPending || pw.newPassword.length < 8 || pw.newPassword !== pw.confirm || !pw.currentPassword}>Change password</Button>
        </div>
      </Panel>
    </HubPage>
  );
}
