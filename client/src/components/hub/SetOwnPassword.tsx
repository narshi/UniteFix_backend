/**
 * Shown instead of the Hub while the login is on a temporary password (made by
 * UniteFix or the business owner). The server refuses every other Hub call
 * until this is done, so it cannot be skipped.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { signOut } from "@/lib/hub";
const Icon = ({ name, className = "" }: { name: string; className?: string }) => (
  <span className={`material-icons ${className}`} style={{ fontFamily: "Material Icons" }} aria-hidden="true">{name}</span>
);

export default function SetOwnPassword({ username }: { username: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mismatch = !!f.confirm && f.next !== f.confirm;
  const ready = f.current.length > 0 && f.next.length >= 8 && f.next === f.confirm && !saving;

  const save = async () => {
    setError(null); setSaving(true);
    try {
      await apiRequest("POST", "/api/hub/password", { currentPassword: f.current, newPassword: f.next });
      // Everything the Hub loads comes after this; start it fresh.
      await qc.invalidateQueries();
    } catch (e) { setError(apiErrorMessage(e, "Not changed")); }
    finally { setSaving(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 noise-overlay p-6">
      <form className="glass-card w-full max-w-md space-y-4 rounded-xl border border-[rgba(255,255,255,0.08)] p-8" onSubmit={(e) => { e.preventDefault(); if (ready) save(); }}>
        <div className="text-center">
          <Icon name="lock_reset" className="text-4xl text-[hsl(174,72%,55%)]" />
          <h2 className="mt-2 text-xl font-bold text-white">Choose your own password</h2>
          <p className="mt-1 text-sm text-[hsl(215,20%,65%)]">You signed in as {username} with a temporary password. Set one only you know before using the Partner Hub.</p>
        </div>
        <div><Label htmlFor="sp-cur">Temporary password</Label><Input id="sp-cur" type="password" autoComplete="current-password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} /></div>
        <div><Label htmlFor="sp-new">New password</Label><Input id="sp-new" type="password" autoComplete="new-password" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} /></div>
        <div><Label htmlFor="sp-conf">Repeat new password</Label><Input id="sp-conf" type="password" autoComplete="new-password" value={f.confirm} onChange={e => setF({ ...f, confirm: e.target.value })} /></div>
        <p className="text-xs text-[hsl(215,20%,55%)]">{mismatch ? "The two new passwords don't match." : "At least 8 characters, different from the temporary one."}</p>
        {error && <p className="text-sm text-rose-300">{error}</p>}
        <Button type="submit" className="w-full" disabled={!ready}>{saving ? "Saving…" : "Save and open my Hub"}</Button>
        <button type="button" onClick={signOut} className="block w-full text-center text-sm text-[hsl(210,20%,75%)] underline underline-offset-4 hover:text-white">Sign out</button>
      </form>
    </div>
  );
}
