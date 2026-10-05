/**
 * Team — everyone who signs in to this business's Hub, each with their own
 * login and role. The owner invites, changes roles and removes access;
 * removal takes effect on the person's next click.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useHubMe, hubCan } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty } from "@/components/hub/ui";
import { HUB_ROLES, HUB_ROLE_LABEL, ROLE_PERMISSIONS, type HubRole } from "@shared/hub";

type Member = { id: number; role: HubRole; status: string; displayName: string | null; phone: string | null; username: string; email: string; lastLogin: string | null; createdAt: string };

const ROLE_SUMMARY: Record<HubRole, string> = {
  owner: "Everything, including team, bank and agreements",
  manager: "Runs the business day to day; no team or GST filing",
  accountant: "Sales, purchases, money and the GST desk",
  dispatcher: "Customers and operations — jobs, bookings, subscribers",
  technician: "Sees operations; works from the app",
};

export default function HubTeam() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data = [] } = useQuery<Member[]>({ queryKey: ["/api/hub/team"], queryFn: async () => (await apiRequest("GET", "/api/hub/team")).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/hub/team"] });
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "accountant" as HubRole });
  const [issued, setIssued] = useState<{ username: string; temporaryPassword: string } | null>(null);
  const invite = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/hub/team", { ...form, phone: form.phone || null }),
    onSuccess: (r: any) => { refresh(); setOpen(false); setIssued({ username: r.data.username, temporaryPassword: r.data.temporaryPassword }); setForm({ name: "", email: "", phone: "", role: "accountant" }); },
    onError: fail("Not invited"),
  });
  const update = useMutation({
    mutationFn: async (v: { id: number; role?: HubRole; status?: string }) => apiRequest("PATCH", `/api/hub/team/${v.id}`, v),
    onSuccess: (r: any) => { refresh(); toast({ title: r?.message ?? "Updated" }); },
    onError: fail("Not changed"),
  });

  if (!me) return null;
  const manage = hubCan(me, "team:manage");
  const active = data.filter(m => m.status === "active").length;
  const limit = me.planLimits.teamMembers;

  return (
    <HubPage
      title="Team"
      subtitle={<>Each person signs in with their own email and password, so every invoice and payout shows who did it. {limit !== null ? `${active} of ${limit} seats on your plan.` : `${active} people.`}</>}
      actions={manage ? <Button onClick={() => setOpen(true)} disabled={limit !== null && active >= limit}>Invite someone</Button> : undefined}
    >
      <Panel>
        {data.length === 0 ? <Empty icon="group" title="Just you so far" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-[hsl(215,20%,55%)]"><th className="py-2">Person</th><th>Role</th><th>Status</th><th>Last sign-in</th><th className="text-right">{manage ? "Manage" : ""}</th></tr></thead>
              <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
                {data.map(m => (
                  <tr key={m.id}>
                    <td className="py-3"><p className="text-white">{m.displayName ?? m.username}</p><p className="text-xs text-[hsl(215,20%,60%)]">{m.email}{m.phone ? ` · ${m.phone}` : ""}</p></td>
                    <td>
                      {manage && m.role !== "owner" && m.status === "active" ? (
                        <select aria-label={`Role for ${m.displayName ?? m.email}`} className="h-8 rounded-md border border-[rgba(255,255,255,0.12)] bg-transparent px-2 text-white" value={m.role}
                          onChange={e => update.mutate({ id: m.id, role: e.target.value as HubRole })}>
                          {HUB_ROLES.filter(r => r !== "owner").map(r => <option key={r} value={r} className="bg-[hsl(222,40%,12%)]">{HUB_ROLE_LABEL[r]}</option>)}
                        </select>
                      ) : <span className="text-white">{HUB_ROLE_LABEL[m.role]}</span>}
                    </td>
                    <td><Chip tone={m.status === "active" ? "good" : "muted"}>{m.status}</Chip></td>
                    <td className="text-[hsl(215,20%,65%)]">{m.lastLogin ? new Date(m.lastLogin).toLocaleString("en-IN") : "never"}</td>
                    <td className="text-right">
                      {manage && m.role !== "owner" && (
                        m.status === "active"
                          ? <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => { if (window.confirm(`Remove ${m.displayName ?? m.email}'s access? They are signed out on their next click.`)) update.mutate({ id: m.id, status: "revoked" }); }}>Remove access</Button>
                          : <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: m.id, status: "active" })}>Restore</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="What each role can do">
        <ul className="grid gap-2 sm:grid-cols-2">
          {HUB_ROLES.map(r => (
            <li key={r} className="rounded-lg bg-[rgba(255,255,255,0.03)] p-3">
              <p className="text-sm text-white">{HUB_ROLE_LABEL[r]}</p>
              <p className="text-xs text-[hsl(215,20%,60%)]">{ROLE_SUMMARY[r]}</p>
              <p className="mt-1 text-[10px] font-mono text-[hsl(215,20%,45%)]">{ROLE_PERMISSIONS[r].join(" · ")}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite someone</DialogTitle><DialogDescription>They get their own login. You will see a temporary password once, to pass on.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div><Label htmlFor="inv-name">Name</Label><Input id="inv-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label htmlFor="inv-email">Email (their login)</Label><Input id="inv-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label htmlFor="inv-phone">Mobile (optional)</Label><Input id="inv-phone" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label htmlFor="inv-role">Role</Label>
              <select id="inv-role" className="mt-1 h-9 w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-transparent px-2 text-white" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as HubRole })}>
                {HUB_ROLES.filter(r => r !== "owner").map(r => <option key={r} value={r} className="bg-[hsl(222,40%,12%)]">{HUB_ROLE_LABEL[r]} — {ROLE_SUMMARY[r]}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => invite.mutate()} disabled={invite.isPending || form.name.trim().length < 2 || !form.email.includes("@")}>Invite</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!issued} onOpenChange={o => !o && setIssued(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Login created</DialogTitle><DialogDescription>Share this with them now — the password is not shown again. They should change it after signing in.</DialogDescription></DialogHeader>
          <div className="rounded-lg bg-[rgba(255,255,255,0.04)] p-3 font-mono text-sm text-white space-y-1">
            <p>Sign-in: {window.location.origin}</p>
            <p>Email: {issued?.username}</p>
            <p>Temporary password: {issued?.temporaryPassword}</p>
          </div>
          <DialogFooter><Button onClick={() => { navigator.clipboard?.writeText(`Sign-in: ${window.location.origin}\nEmail: ${issued?.username}\nPassword: ${issued?.temporaryPassword}`); toast({ title: "Copied" }); }}>Copy</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}
