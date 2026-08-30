/**
 * Roles & Access — every dashboard account and every role, in one place.
 *
 * Two tabs:
 *   Accounts — staff and FTTH operators alike. Create, change role, activate,
 *              deactivate, reset password, archive or purge.
 *   Roles    — create your own roles and tick exactly what each may reach.
 *
 * ROLES ARE YOURS TO CREATE; the capability list is not, and cannot be — a
 * capability only means something if server code checks it. The catalogue comes
 * from GET /api/admin/roles/capabilities so this screen can never offer a
 * permission the middleware would not understand.
 *
 * Everything hidden here is also enforced server-side. The lockout guards (no
 * self-edit, never strand the last account manager, Super Admin always holds
 * everything) live in admin-management.routes.ts; this mirrors them so buttons
 * explain themselves rather than failing.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAdminMe } from "@/lib/admin-auth";
import { ShieldCheck, UserPlus, Shield, Router, Plus, Trash2, KeyRound } from "lucide-react";
import { format } from "date-fns";

interface CapabilityArea {
  key: string; label: string; description: string;
  scope: "staff" | "operator"; group: string;
  manageOnly?: boolean; critical?: boolean;
}

interface RoleRow {
  id: number; slug: string; name: string; description: string | null;
  scope: "staff" | "operator"; isSystem: boolean;
  capabilities: string[]; accountCount: number; capabilitiesLocked: boolean;
}

interface AccountRow {
  id: number; username: string; email: string;
  role: string; roleId: number | null; roleName: string | null;
  roleScope: "staff" | "operator" | null;
  isActive: boolean; deletedAt: string | null;
  lastLogin: string | null; createdAt: string;
  operatorId: number | null; operatorCompany: string | null; operatorStatus: string | null;
}

interface DeleteImpact {
  username: string;
  references: {
    auditEntries: number; operatorProfiles: number;
    operatorsApproved: number; rechargesFulfilled: number;
  };
  canPurge: boolean;
  action: "purge" | "archive";
  isLastAccountManager: boolean;
}

export default function AdminsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { admin: me, isSuperAdmin } = useAdminMe();

  const [tab, setTab] = useState<"accounts" | "roles">("accounts");
  const [showArchived, setShowArchived] = useState(false);

  const [creatingAccount, setCreatingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({
    username: "", email: "", password: "", roleId: "",
    companyName: "", contactPhone: "", contactName: "", pincodes: "",
  });
  const [credentials, setCredentials] = useState<{ username: string; password: string | null } | null>(null);
  const [deleting, setDeleting] = useState<AccountRow | null>(null);
  const [resetting, setResetting] = useState<AccountRow | null>(null);

  const [editingRole, setEditingRole] = useState<RoleRow | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);
  const [roleForm, setRoleForm] = useState<{
    name: string; description: string; scope: "staff" | "operator"; caps: Set<string>;
  }>({ name: "", description: "", scope: "staff", caps: new Set() });

  const { data: capData } = useQuery<{ data: { areas: CapabilityArea[] } }>({
    queryKey: ["/api/admin/roles/capabilities"],
  });
  const { data: roleData, isLoading: rolesLoading } = useQuery<{ data: RoleRow[] }>({
    queryKey: ["/api/admin/roles"],
  });
  const { data: accountData, isLoading: accountsLoading } = useQuery<{ data: AccountRow[] }>({
    queryKey: [`/api/admin/admins${showArchived ? "?archived=true" : ""}`],
  });
  const { data: impactData } = useQuery<{ data: DeleteImpact }>({
    queryKey: [`/api/admin/admins/${deleting?.id}/delete-impact`],
    enabled: deleting !== null,
  });

  const areas = capData?.data.areas ?? [];
  const roles = roleData?.data ?? [];
  const accounts = accountData?.data ?? [];
  const impact = impactData?.data;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
    queryClient.invalidateQueries({ queryKey: [`/api/admin/admins${showArchived ? "?archived=true" : ""}`] });
  };

  const selectedRole = roles.find(r => String(r.id) === accountForm.roleId);
  const needsOperatorFields = selectedRole?.scope === "operator";

  // Grouped for the capability matrix, filtered to the role's own side of the
  // staff/operator boundary — an operator role can never be offered staff areas.
  const areasByGroup = useMemo(() => {
    const scoped = areas.filter(a => a.scope === roleForm.scope);
    const map = new Map<string, CapabilityArea[]>();
    for (const a of scoped) map.set(a.group, [...(map.get(a.group) ?? []), a]);
    return Array.from(map.entries());
  }, [areas, roleForm.scope]);

  // ---- mutations ----
  const createAccount = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        username: accountForm.username.trim(),
        email: accountForm.email.trim(),
        roleId: Number(accountForm.roleId),
      };
      if (accountForm.password.trim()) body.password = accountForm.password;
      if (needsOperatorFields) {
        body.operator = {
          companyName: accountForm.companyName.trim(),
          contactPhone: accountForm.contactPhone.trim(),
          ...(accountForm.contactName.trim() ? { contactName: accountForm.contactName.trim() } : {}),
          pincodes: accountForm.pincodes.split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
        };
      }
      return apiRequest("POST", "/api/admin/admins", body);
    },
    onSuccess: (r: any) => {
      refresh();
      setCreatingAccount(false);
      setCredentials({ username: accountForm.username, password: r?.data?.temporaryPassword ?? null });
      setAccountForm({ username: "", email: "", password: "", roleId: "", companyName: "", contactPhone: "", contactName: "", pincodes: "" });
    },
    onError: (e: Error) => toast({ title: "Could not create account", description: e.message, variant: "destructive" }),
  });

  const changeRole = useMutation({
    mutationFn: async (vars: { id: number; roleId: number }) =>
      apiRequest("PATCH", `/api/admin/admins/${vars.id}`, { roleId: vars.roleId }),
    onSuccess: () => { refresh(); toast({ title: "Role changed", description: "It applies on their next request." }); },
    onError: (e: Error) => toast({ title: "Could not change role", description: e.message, variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: async (vars: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/admins/${vars.id}/status`, { isActive: vars.isActive }),
    onSuccess: (r: any) => { refresh(); toast({ title: "Updated", description: r?.message }); },
    onError: (e: Error) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const resetPassword = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/admin/admins/${id}/password`, {}),
    onSuccess: (r: any) => {
      setCredentials({ username: resetting?.username ?? "", password: r?.data?.temporaryPassword ?? null });
      setResetting(null);
    },
    onError: (e: Error) => toast({ title: "Could not reset", description: e.message, variant: "destructive" }),
  });

  const removeAccount = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/admins/${id}`),
    onSuccess: (r: any) => { refresh(); setDeleting(null); toast({ title: "Done", description: r?.message }); },
    onError: (e: Error) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });

  const saveRole = useMutation({
    mutationFn: async () => {
      const body = {
        name: roleForm.name.trim(),
        description: roleForm.description.trim() || null,
        scope: roleForm.scope,
        capabilities: Array.from(roleForm.caps),
      };
      return editingRole
        ? apiRequest("PATCH", `/api/admin/roles/${editingRole.id}`, body)
        : apiRequest("POST", "/api/admin/roles", body);
    },
    onSuccess: (r: any) => {
      refresh(); setEditingRole(null); setCreatingRole(false);
      toast({ title: "Role saved", description: r?.message });
    },
    onError: (e: Error) => toast({ title: "Could not save role", description: e.message, variant: "destructive" }),
  });

  const deleteRole = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/roles/${id}`),
    onSuccess: (r: any) => { refresh(); toast({ title: "Role deleted", description: r?.message }); },
    onError: (e: Error) => toast({ title: "Could not delete", description: e.message, variant: "destructive" }),
  });

  const openRole = (role: RoleRow | null) => {
    if (role) {
      setEditingRole(role);
      setRoleForm({
        name: role.name, description: role.description ?? "",
        scope: role.scope, caps: new Set(role.capabilities),
      });
    } else {
      setCreatingRole(true);
      setRoleForm({ name: "", description: "", scope: "staff", caps: new Set() });
    }
  };

  const toggleCap = (cap: string) => {
    setRoleForm(f => {
      const caps = new Set(f.caps);
      if (caps.has(cap)) {
        caps.delete(cap);
        // Removing view removes manage too — manage without view is a state the
        // server would expand back anyway, so don't let the UI imply otherwise.
        if (cap.endsWith(":view")) caps.delete(cap.replace(":view", ":manage"));
      } else {
        caps.add(cap);
        if (cap.endsWith(":manage")) caps.add(cap.replace(":manage", ":view"));
      }
      return { ...f, caps };
    });
  };

  const roleLocked = editingRole?.capabilitiesLocked;

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden bg-transparent">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight">
            Roles &amp; Access
          </h1>
          <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide mt-1">
            Who can sign in, and exactly what each of them can reach.
          </p>
        </div>
        {isSuperAdmin && (
          <div className="flex gap-2">
            {tab === "accounts" ? (
              <Button onClick={() => setCreatingAccount(true)} className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white">
                <UserPlus className="w-4 h-4 mr-2" /> Add account
              </Button>
            ) : (
              <Button onClick={() => openRole(null)} className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white">
                <Plus className="w-4 h-4 mr-2" /> New role
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-6">
        {(["accounts", "roles"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm capitalize transition-colors ${
              tab === t
                ? "bg-[hsla(217,91%,60%,0.15)] text-[hsl(217,91%,70%)] border border-[hsla(217,91%,60%,0.3)]"
                : "text-[hsl(215,20%,65%)] border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.04)]"
            }`}
          >
            {t} ({t === "accounts" ? accounts.length : roles.length})
          </button>
        ))}
      </div>

      {tab === "accounts" && (
        <Card className="glass-card border-[rgba(255,255,255,0.08)]">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] flex flex-row items-center justify-between">
            <CardTitle className="text-xl text-white">Accounts</CardTitle>
            <label className="flex items-center gap-2 text-xs text-[hsl(215,20%,65%)] cursor-pointer">
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
              Show archived
            </label>
          </CardHeader>
          <CardContent className="p-0">
            {accountsLoading ? (
              <div className="p-8 text-center text-[hsl(215,20%,65%)]">Loading…</div>
            ) : (
              <ul className="divide-y divide-[rgba(255,255,255,0.05)]">
                {accounts.map(row => {
                  const isMe = me?.id === row.id;
                  const archived = row.deletedAt !== null;
                  const isOperator = row.roleScope === "operator" || row.role === "operator";
                  return (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-[hsl(210,20%,90%)]">{row.username}</p>
                          {isMe && <span className="text-xs text-[hsl(217,91%,65%)]">(you)</span>}
                          <Badge
                            variant="outline"
                            className={
                              row.role === "super_admin"
                                ? "bg-[hsla(263,70%,58%,0.15)] text-[hsl(263,70%,72%)] border-[hsla(263,70%,58%,0.3)]"
                                : isOperator
                                  ? "bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)]"
                                  : "bg-[rgba(255,255,255,0.03)] text-[hsl(215,20%,75%)] border-[rgba(255,255,255,0.1)]"
                            }
                          >
                            {isOperator && <Router className="w-3 h-3 mr-1 inline" />}
                            {row.roleName ?? row.role}
                          </Badge>
                          {archived && (
                            <Badge className="bg-[rgba(255,255,255,0.05)] text-[hsl(215,20%,55%)] border-[rgba(255,255,255,0.1)]">
                              archived
                            </Badge>
                          )}
                          {!archived && !row.isActive && (
                            <Badge className="bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border-[hsla(347,77%,50%,0.3)]">
                              disabled
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">
                          {row.email}
                          {row.operatorCompany ? ` · ${row.operatorCompany}` : ""}
                          {" · "}
                          {row.lastLogin ? `last in ${format(new Date(row.lastLogin), "d MMM yyyy")}` : "never signed in"}
                        </p>
                      </div>

                      {isSuperAdmin && !archived && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Select
                            value={row.roleId ? String(row.roleId) : undefined}
                            disabled={isMe || changeRole.isPending}
                            onValueChange={(v) => changeRole.mutate({ id: row.id, roleId: Number(v) })}
                          >
                            <SelectTrigger
                              title={isMe ? "You cannot change your own role" : "Change role"}
                              className="w-44 h-8 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white text-xs disabled:opacity-40"
                            >
                              <SelectValue placeholder="No role" />
                            </SelectTrigger>
                            <SelectContent>
                              {roles
                                // Only roles on the same side of the boundary — the
                                // server refuses a cross-scope move outright.
                                .filter(r => r.scope === (isOperator ? "operator" : "staff"))
                                .map(r => (
                                  <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>

                          <Button
                            size="sm" variant="outline" className="h-8 text-xs"
                            disabled={isMe || setStatus.isPending}
                            title={isMe ? "You cannot deactivate yourself" : undefined}
                            onClick={() => setStatus.mutate({ id: row.id, isActive: !row.isActive })}
                          >
                            {row.isActive ? "Disable" : "Enable"}
                          </Button>

                          <Button
                            size="sm" variant="outline" className="h-8 text-xs"
                            onClick={() => setResetting(row)}
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </Button>

                          <Button
                            size="sm" variant="outline"
                            className="h-8 text-xs text-[hsl(347,77%,65%)] hover:bg-[hsla(347,77%,50%,0.1)]"
                            disabled={isMe}
                            title={isMe ? "You cannot delete your own account" : undefined}
                            onClick={() => setDeleting(row)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "roles" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {rolesLoading ? (
            <p className="text-[hsl(215,20%,65%)]">Loading…</p>
          ) : roles.map(role => (
            <Card key={role.id} className="glass-card border-[rgba(255,255,255,0.08)]">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-lg text-white flex items-center gap-2 flex-wrap">
                      {role.slug === "super_admin" ? <ShieldCheck className="w-4 h-4 text-[hsl(263,70%,70%)]" />
                        : role.scope === "operator" ? <Router className="w-4 h-4 text-[hsl(160,84%,55%)]" />
                          : <Shield className="w-4 h-4 text-[hsl(215,20%,70%)]" />}
                      {role.name}
                      {role.isSystem && (
                        <Badge className="bg-[rgba(255,255,255,0.05)] text-[hsl(215,20%,55%)] border-[rgba(255,255,255,0.1)] text-[10px]">
                          built-in
                        </Badge>
                      )}
                    </CardTitle>
                    <p className="text-xs text-[hsl(215,20%,60%)] mt-1">{role.description}</p>
                  </div>
                  {isSuperAdmin && (
                    <div className="flex gap-1.5 shrink-0">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openRole(role)}>
                        {role.capabilitiesLocked ? "View" : "Edit"}
                      </Button>
                      {!role.isSystem && (
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-xs text-[hsl(347,77%,65%)]"
                          disabled={role.accountCount > 0 || deleteRole.isPending}
                          title={role.accountCount > 0 ? `${role.accountCount} account(s) use this role` : undefined}
                          onClick={() => deleteRole.mutate(role.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-[hsl(215,20%,55%)] mb-2">
                  {role.accountCount} account{role.accountCount === 1 ? "" : "s"} ·{" "}
                  {role.capabilities.length} capabilit{role.capabilities.length === 1 ? "y" : "ies"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {areas
                    .filter(a => a.scope === role.scope && role.capabilities.some(c => c.startsWith(`${a.key}:`)))
                    .map(a => {
                      const canManage = role.capabilities.includes(`${a.key}:manage`);
                      return (
                        <span
                          key={a.key}
                          className={`px-2 py-0.5 rounded text-[11px] border ${
                            canManage
                              ? "bg-[hsla(217,91%,60%,0.12)] text-[hsl(217,91%,72%)] border-[hsla(217,91%,60%,0.25)]"
                              : "bg-[rgba(255,255,255,0.03)] text-[hsl(215,20%,65%)] border-[rgba(255,255,255,0.08)]"
                          }`}
                        >
                          {a.label}{canManage ? "" : " (view)"}
                        </span>
                      );
                    })}
                  {role.capabilities.length === 0 && (
                    <span className="text-xs text-[hsl(215,20%,45%)]">No access granted yet.</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ---- create account ---- */}
      <Dialog open={creatingAccount} onOpenChange={setCreatingAccount}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add an account</DialogTitle>
            <DialogDescription>
              Leave the password blank and one will be generated and shown to you once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="acc-role">Role</Label>
              <Select value={accountForm.roleId} onValueChange={(v) => setAccountForm({ ...accountForm, roleId: v })}>
                <SelectTrigger id="acc-role"><SelectValue placeholder="Choose a role" /></SelectTrigger>
                <SelectContent>
                  {roles.map(r => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}{r.scope === "operator" ? " (operator)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="acc-username">Username</Label>
              <Input id="acc-username" value={accountForm.username}
                onChange={e => setAccountForm({ ...accountForm, username: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="acc-email">Email</Label>
              <Input id="acc-email" type="email" value={accountForm.email}
                onChange={e => setAccountForm({ ...accountForm, email: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="acc-password">Password (optional)</Label>
              <Input id="acc-password" type="password" value={accountForm.password}
                onChange={e => setAccountForm({ ...accountForm, password: e.target.value })}
                placeholder="generate one for me" />
            </div>

            {needsOperatorFields && (
              <div className="pt-2 border-t border-[rgba(255,255,255,0.08)] space-y-3">
                <p className="text-xs text-[hsl(160,84%,55%)]">
                  This is a broadband partner — they'll get their own portal and never see the staff console.
                </p>
                <div>
                  <Label htmlFor="op-company">Company name</Label>
                  <Input id="op-company" value={accountForm.companyName}
                    onChange={e => setAccountForm({ ...accountForm, companyName: e.target.value })}
                    placeholder="Poorvi Computers" />
                </div>
                <div>
                  <Label htmlFor="op-phone">Contact phone</Label>
                  <Input id="op-phone" value={accountForm.contactPhone} maxLength={10}
                    onChange={e => setAccountForm({ ...accountForm, contactPhone: e.target.value.replace(/\D/g, "") })}
                    placeholder="9876500011" />
                </div>
                <div>
                  <Label htmlFor="op-pincodes">Coverage pincodes</Label>
                  <Input id="op-pincodes" value={accountForm.pincodes}
                    onChange={e => setAccountForm({ ...accountForm, pincodes: e.target.value })}
                    placeholder="581359, 581355" />
                  <p className="text-xs text-[hsl(215,20%,55%)] mt-1">
                    Only areas UniteFix already serves. Without any, customers won't see them.
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatingAccount(false)}>Cancel</Button>
            <Button
              disabled={
                createAccount.isPending
                || accountForm.username.trim().length < 3
                || !accountForm.email.trim()
                || !accountForm.roleId
                || (needsOperatorFields && (!accountForm.companyName.trim() || accountForm.contactPhone.length !== 10))
              }
              onClick={() => createAccount.mutate()}
            >
              {createAccount.isPending ? "Creating…" : "Create account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- role editor ---- */}
      <Dialog
        open={editingRole !== null || creatingRole}
        onOpenChange={(o) => { if (!o) { setEditingRole(null); setCreatingRole(false); } }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRole ? editingRole.name : "New role"}</DialogTitle>
            <DialogDescription>
              {roleLocked
                ? "Super Admin always holds every capability — that is what makes it the recovery account, so it cannot be edited down."
                : "Tick what this role may reach. Changes apply on each user's next request."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="role-name">Name</Label>
                <Input id="role-name" value={roleForm.name} disabled={roleLocked}
                  onChange={e => setRoleForm({ ...roleForm, name: e.target.value })}
                  placeholder="Manager" />
              </div>
              <div>
                <Label htmlFor="role-scope">Type</Label>
                <Select
                  value={roleForm.scope}
                  disabled={!!editingRole}
                  onValueChange={(v: "staff" | "operator") => setRoleForm({ ...roleForm, scope: v, caps: new Set() })}
                >
                  <SelectTrigger id="role-scope"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">Staff — UniteFix console</SelectItem>
                    <SelectItem value="operator">Operator — partner portal only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="role-desc">Description</Label>
              <Input id="role-desc" value={roleForm.description} disabled={roleLocked}
                onChange={e => setRoleForm({ ...roleForm, description: e.target.value })}
                placeholder="Day-to-day operations, no money or accounts" />
            </div>

            {!!editingRole && (
              <p className="text-xs text-[hsl(215,20%,55%)]">
                A role's type is fixed after creation — moving accounts across the staff/operator
                boundary is deliberately not possible.
              </p>
            )}

            <div className="space-y-4">
              {areasByGroup.map(([group, groupAreas]) => (
                <div key={group}>
                  <p className="text-xs uppercase tracking-wider text-[hsl(215,20%,55%)] mb-2">{group}</p>
                  <div className="space-y-1.5">
                    {groupAreas.map(area => {
                      const viewCap = `${area.key}:view`;
                      const manageCap = `${area.key}:manage`;
                      const hasView = roleForm.caps.has(viewCap);
                      const hasManage = roleForm.caps.has(manageCap);
                      return (
                        <div
                          key={area.key}
                          className="flex items-start justify-between gap-4 p-2.5 rounded-lg border border-[rgba(255,255,255,0.06)]"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-white">
                              {area.label}
                              {area.critical && (
                                <span className="ml-2 text-[10px] uppercase text-[hsl(38,92%,60%)]">key</span>
                              )}
                            </p>
                            <p className="text-xs text-[hsl(215,20%,55%)]">{area.description}</p>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            {!area.manageOnly && (
                              <button
                                disabled={roleLocked}
                                onClick={() => toggleCap(viewCap)}
                                className={`px-2.5 py-1 rounded text-xs border transition-colors disabled:opacity-50 ${
                                  hasView
                                    ? "bg-[rgba(255,255,255,0.08)] text-white border-[rgba(255,255,255,0.2)]"
                                    : "text-[hsl(215,20%,50%)] border-[rgba(255,255,255,0.08)]"
                                }`}
                              >
                                view
                              </button>
                            )}
                            <button
                              disabled={roleLocked}
                              onClick={() => toggleCap(manageCap)}
                              className={`px-2.5 py-1 rounded text-xs border transition-colors disabled:opacity-50 ${
                                hasManage
                                  ? "bg-[hsla(217,91%,60%,0.2)] text-[hsl(217,91%,75%)] border-[hsla(217,91%,60%,0.4)]"
                                  : "text-[hsl(215,20%,50%)] border-[rgba(255,255,255,0.08)]"
                              }`}
                            >
                              manage
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingRole(null); setCreatingRole(false); }}>
              {roleLocked ? "Close" : "Cancel"}
            </Button>
            {!roleLocked && (
              <Button onClick={() => saveRole.mutate()} disabled={saveRole.isPending || roleForm.name.trim().length < 2}>
                {saveRole.isPending ? "Saving…" : editingRole ? "Save role" : "Create role"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- delete ---- */}
      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.username}?</DialogTitle>
            <DialogDescription>
              {impact?.canPurge
                ? "Nothing references this account, so it can be removed permanently."
                : "This account appears in history, so it will be archived rather than deleted — that keeps past actions attributable to a name."}
            </DialogDescription>
          </DialogHeader>
          {impact && (
            <ul className="text-sm space-y-1">
              <Impact label="Audit entries" n={impact.references.auditEntries} />
              <Impact label="Operator profiles" n={impact.references.operatorProfiles} />
              <Impact label="Operators approved" n={impact.references.operatorsApproved} />
              <Impact label="Recharges fulfilled" n={impact.references.rechargesFulfilled} />
            </ul>
          )}
          {impact?.isLastAccountManager && (
            <p className="text-sm text-[hsl(347,77%,65%)]">
              This is the last account able to manage roles and access — it cannot be removed.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={removeAccount.isPending || impact?.isLastAccountManager}
              onClick={() => deleting && removeAccount.mutate(deleting.id)}
            >
              {removeAccount.isPending ? "Working…" : impact?.canPurge ? "Delete permanently" : "Archive account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- reset password ---- */}
      <Dialog open={resetting !== null} onOpenChange={(o) => !o && setResetting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password for {resetting?.username}?</DialogTitle>
            <DialogDescription>
              They'll be signed out on their next request. The new password is shown to you once.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={resetPassword.isPending}
              onClick={() => resetting && resetPassword.mutate(resetting.id)}>
              {resetPassword.isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- credentials, shown once ---- */}
      <Dialog open={credentials !== null} onOpenChange={(o) => !o && setCredentials(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{credentials?.username}</DialogTitle>
            <DialogDescription>
              {credentials?.password
                ? "Copy this now — it isn't stored and cannot be shown again."
                : "They can sign in with the password you set."}
            </DialogDescription>
          </DialogHeader>
          <div className="font-mono text-sm text-white space-y-1">
            <p>Username: {credentials?.username}</p>
            {credentials?.password && <p>Password: {credentials.password}</p>}
          </div>
          <DialogFooter>
            <Button onClick={() => setCredentials(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Impact({ label, n }: { label: string; n: number }) {
  return (
    <li className="flex justify-between">
      <span className="text-[hsl(215,20%,65%)]">{label}</span>
      <span className={n > 0 ? "text-white font-mono" : "text-[hsl(215,20%,45%)] font-mono"}>{n}</span>
    </li>
  );
}
