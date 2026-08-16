/**
 * Administrators — create admins, promote/demote, enable/disable.
 *
 * Super admin only, gated at three levels: the sidebar hides the link, the
 * route wrapper in App.tsx refuses to render it, and every endpoint below is
 * behind requireSuperAdmin.
 *
 * The lockout guards (no self-edit, never strand the last super admin) are
 * enforced server-side. The UI mirrors them so the buttons are disabled rather
 * than failing, but the server is the authority.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAdminMe } from "@/lib/admin-auth";
import { ShieldCheck, UserPlus, Shield } from "lucide-react";
import { format } from "date-fns";

interface AdminRow {
  id: number;
  username: string;
  email: string;
  role: "admin" | "super_admin";
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
}

export default function AdminsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { admin: me } = useAdminMe();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "admin" });
  const [roleChange, setRoleChange] = useState<{ row: AdminRow; nextRole: string } | null>(null);

  const { data, isLoading } = useQuery<{ data: AdminRow[] }>({
    queryKey: ["/api/admin/admins"],
  });

  const admins = data?.data ?? [];
  const activeSuperAdmins = admins.filter((a) => a.role === "super_admin" && a.isActive).length;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/admins"] });

  const createMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/auth/register", form),
    onSuccess: () => {
      toast({ title: "Administrator created", description: `${form.username} can now sign in.` });
      setForm({ username: "", email: "", password: "", role: "admin" });
      setIsCreateOpen(false);
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not create admin", description: e.message, variant: "destructive" }),
  });

  const roleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) =>
      apiRequest("PATCH", `/api/admin/admins/${id}/role`, { role }),
    onSuccess: (r: any) => {
      toast({ title: "Role updated", description: r?.message });
      setRoleChange(null);
      refresh();
    },
    onError: (e: any) => {
      toast({ title: "Could not change role", description: e.message, variant: "destructive" });
      setRoleChange(null);
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/admins/${id}/status`, { isActive }),
    onSuccess: (r: any) => {
      toast({ title: "Status updated", description: r?.message });
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not change status", description: e.message, variant: "destructive" }),
  });

  /** Mirrors the server guards so the UI explains itself instead of erroring. */
  const blockReason = (row: AdminRow, action: "role" | "status"): string | null => {
    if (me && row.id === me.id) {
      return action === "role" ? "You cannot change your own role" : "You cannot deactivate yourself";
    }
    if (row.role === "super_admin" && activeSuperAdmins <= 1) {
      return "This is the last active super admin";
    }
    return null;
  };

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden bg-transparent">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-8 relative z-10 stagger-enter">
        <div>
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]">
            Administrators
          </h1>
          <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide mt-1">
            Who can sign in to this dashboard, and what they're allowed to do.
          </p>
        </div>
        <Button
          onClick={() => setIsCreateOpen(true)}
          className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Add administrator
        </Button>
      </div>

      {/* What each role can do — otherwise "super admin" is just a word. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 relative z-10">
        <div className="glass-card border border-[hsla(263,70%,58%,0.25)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-4 h-4 text-[hsl(263,70%,70%)]" />
            <span className="font-semibold text-white">Super Admin</span>
          </div>
          <p className="text-xs text-[hsl(215,20%,65%)]">
            Everything an administrator can do, plus the Database Console, the Audit Trail,
            permanent account deletion, and this page.
          </p>
        </div>
        <div className="glass-card border border-[rgba(255,255,255,0.08)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-[hsl(215,20%,70%)]" />
            <span className="font-semibold text-white">Administrator</span>
          </div>
          <p className="text-xs text-[hsl(215,20%,65%)]">
            Day-to-day operations: bookings, assignments, catalog, orders, payments,
            withdrawals and support. No console, audit trail, or permanent deletes.
          </p>
        </div>
      </div>

      <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
        <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
          <CardTitle className="text-xl text-white">
            All administrators {admins.length > 0 && <span className="text-[hsl(215,20%,55%)] text-sm font-normal">({admins.length})</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-[hsl(215,20%,65%)]">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full glass-table">
                <thead>
                  <tr className="text-left border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Administrator</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Role</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Status</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Last login</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {admins.map((row) => {
                    const isMe = me?.id === row.id;
                    const roleBlock = blockReason(row, "role");
                    const statusBlock = blockReason(row, "status");
                    return (
                      <tr key={row.id} className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.03)] transition-colors">
                        <td className="p-4">
                          <p className="font-medium text-[hsl(210,20%,90%)]">
                            {row.username}
                            {isMe && <span className="ml-2 text-xs text-[hsl(217,91%,65%)]">(you)</span>}
                          </p>
                          <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">{row.email}</p>
                        </td>
                        <td className="p-4">
                          <Badge
                            variant="outline"
                            className={row.role === "super_admin"
                              ? "bg-[hsla(263,70%,58%,0.15)] text-[hsl(263,70%,72%)] border-[hsla(263,70%,58%,0.3)]"
                              : "bg-[rgba(255,255,255,0.03)] text-[hsl(215,20%,75%)] border-[rgba(255,255,255,0.1)]"}
                          >
                            {row.role === "super_admin" ? "Super Admin" : "Administrator"}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <Badge
                            variant="outline"
                            className={row.isActive
                              ? "bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)]"
                              : "bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border-[hsla(347,77%,50%,0.3)]"}
                          >
                            {row.isActive ? "Active" : "Disabled"}
                          </Badge>
                        </td>
                        <td className="p-4 text-[hsl(215,20%,65%)]">
                          {row.lastLogin ? format(new Date(row.lastLogin), "dd MMM yyyy, HH:mm") : "Never"}
                        </td>
                        <td className="p-4">
                          <div className="flex justify-end items-center gap-2">
                            <Select
                              value={row.role}
                              onValueChange={(next) => next !== row.role && setRoleChange({ row, nextRole: next })}
                              disabled={!!roleBlock || roleMutation.isPending}
                            >
                              <SelectTrigger
                                title={roleBlock ?? "Change role"}
                                className="w-40 h-8 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white text-xs disabled:opacity-40"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Administrator</SelectItem>
                                <SelectItem value="super_admin">Super Admin</SelectItem>
                              </SelectContent>
                            </Select>

                            <Button
                              size="sm"
                              variant="outline"
                              title={statusBlock ?? (row.isActive ? "Disable sign-in" : "Re-enable sign-in")}
                              disabled={!!statusBlock || statusMutation.isPending}
                              className={`h-8 text-xs border-[rgba(255,255,255,0.1)] disabled:opacity-40 ${
                                row.isActive
                                  ? "text-[hsl(347,77%,65%)] hover:bg-[hsla(347,77%,50%,0.1)]"
                                  : "text-[hsl(160,84%,65%)] hover:bg-[hsla(160,84%,39%,0.1)]"
                              }`}
                              onClick={() => statusMutation.mutate({ id: row.id, isActive: !row.isActive })}
                            >
                              {row.isActive ? "Disable" : "Enable"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.9)]">
          <DialogHeader>
            <DialogTitle className="text-xl text-white">New administrator</DialogTitle>
            <DialogDescription className="text-[hsl(215,20%,60%)]">
              They'll sign in at the admin login with this username and password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[hsl(210,20%,80%)]">Username</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[hsl(210,20%,80%)]">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[hsl(210,20%,80%)]">Password</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[hsl(210,20%,80%)]">Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrator</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1 border-[rgba(255,255,255,0.1)] text-[hsl(210,20%,85%)]" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white"
              disabled={!form.username || !form.email || form.password.length < 6 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Role change confirmation — promoting grants console + delete access. */}
      <AlertDialog open={!!roleChange} onOpenChange={(o) => !o && setRoleChange(null)}>
        <AlertDialogContent className="glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.9)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {roleChange?.nextRole === "super_admin" ? "Promote to Super Admin?" : "Demote to Administrator?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[hsl(215,20%,65%)]">
              {roleChange?.nextRole === "super_admin"
                ? `${roleChange?.row.username} will gain the Database Console (arbitrary SQL), the Audit Trail, permanent account deletion, and the ability to manage administrators.`
                : `${roleChange?.row.username} will lose the Database Console, the Audit Trail, permanent deletion, and administrator management. This takes effect on their next request.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="border-t border-[rgba(255,255,255,0.08)] pt-4 mt-4">
            <AlertDialogCancel className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.1)]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white"
              onClick={() => roleChange && roleMutation.mutate({ id: roleChange.row.id, role: roleChange.nextRole })}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
