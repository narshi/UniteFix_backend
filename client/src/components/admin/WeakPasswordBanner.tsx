/**
 * Shown after signing in with a well-known password (such as the old seed
 * default). Changing it here clears the banner.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

const read = () => { try { return localStorage.getItem("adminPasswordWeak") === "1"; } catch { return false; } };

export function WeakPasswordBanner() {
  const { toast } = useToast();
  const [weak, setWeak] = useState(read);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  if (!weak) return null;
  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("POST", "/api/admin/me/password", { currentPassword: f.currentPassword, newPassword: f.newPassword });
      try { localStorage.removeItem("adminPasswordWeak"); } catch { /* storage blocked */ }
      setWeak(false); setOpen(false);
      toast({ title: "Password changed" });
    } catch (e) { toast({ title: "Not changed", description: apiErrorMessage(e), variant: "destructive" }); } finally { setSaving(false); }
  };
  return (
    <>
      <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-rose-500/30 bg-rose-500/15 px-4 py-2.5 text-sm text-rose-100">
        <span className="font-medium">You signed in with a well-known password.</span>
        <span className="text-rose-200/80">Anyone could guess it. Change it now.</span>
        <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>Change password</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Change your password</DialogTitle><DialogDescription>At least 10 characters.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="wp-c">Current password</Label><Input id="wp-c" type="password" autoComplete="current-password" value={f.currentPassword} onChange={e => setF({ ...f, currentPassword: e.target.value })} /></div>
            <div><Label htmlFor="wp-n">New password</Label><Input id="wp-n" type="password" autoComplete="new-password" value={f.newPassword} onChange={e => setF({ ...f, newPassword: e.target.value })} /></div>
            <div><Label htmlFor="wp-r">New password again</Label><Input id="wp-r" type="password" autoComplete="new-password" value={f.confirm} onChange={e => setF({ ...f, confirm: e.target.value })} /></div>
            {f.confirm && f.confirm !== f.newPassword && <p role="alert" className="text-sm text-rose-400">The two new passwords differ.</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Later</Button><Button disabled={saving || f.newPassword.length < 10 || f.newPassword !== f.confirm || !f.currentPassword} onClick={save}>{saving ? "Saving…" : "Change password"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
