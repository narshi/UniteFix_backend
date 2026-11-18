/**
 * Change your own admin password (POST /api/admin/me/password): the current
 * password, then the new one twice. At least 10 characters and not a
 * well-known password; the server checks both.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

export function ChangePasswordDialog({ open, onOpenChange, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; onChanged?: () => void }) {
  const { toast } = useToast();
  const blank = { currentPassword: "", newPassword: "", confirm: "" };
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);
  const close = (o: boolean) => { if (!o) setF(blank); onOpenChange(o); };
  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("POST", "/api/admin/me/password", { currentPassword: f.currentPassword, newPassword: f.newPassword });
      try { localStorage.removeItem("adminPasswordWeak"); } catch { /* storage blocked */ }
      toast({ title: "Password changed", description: "Use the new password next time you sign in." });
      onChanged?.();
      close(false);
    } catch (e) {
      toast({ title: "Not changed", description: apiErrorMessage(e), variant: "destructive" });
    } finally { setSaving(false); }
  };
  const mismatch = !!f.confirm && f.confirm !== f.newPassword;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change your password</DialogTitle>
          <DialogDescription>At least 10 characters. Avoid passwords you use elsewhere.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!saving && f.newPassword.length >= 10 && !mismatch && f.currentPassword) save(); }}>
          <div><Label htmlFor="cp-current">Current password</Label><Input id="cp-current" type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></div>
          <div><Label htmlFor="cp-new">New password</Label><Input id="cp-new" type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></div>
          <div><Label htmlFor="cp-again">New password again</Label><Input id="cp-again" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></div>
          {f.newPassword && f.newPassword.length < 10 && <p className="text-sm text-amber-400">{10 - f.newPassword.length} more character{10 - f.newPassword.length === 1 ? "" : "s"} needed.</p>}
          {mismatch && <p role="alert" className="text-sm text-rose-400">The two new passwords differ.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || f.newPassword.length < 10 || mismatch || !f.confirm || !f.currentPassword}>{saving ? "Saving…" : "Change password"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
