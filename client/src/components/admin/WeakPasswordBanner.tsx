/**
 * Shown after signing in with a well-known password (such as the old seed
 * default). Changing it here clears the banner.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

const read = () => { try { return localStorage.getItem("adminPasswordWeak") === "1"; } catch { return false; } };

export function WeakPasswordBanner() {
  const [weak, setWeak] = useState(read);
  const [open, setOpen] = useState(false);
  if (!weak) return null;
  return (
    <>
      <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-rose-500/30 bg-rose-500/15 px-4 py-2.5 text-sm text-rose-100">
        <span className="font-medium">You signed in with a well-known password.</span>
        <span className="text-rose-200/80">Anyone could guess it. Change it now.</span>
        <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>Change password</Button>
      </div>
      <ChangePasswordDialog open={open} onOpenChange={setOpen} onChanged={() => setWeak(false)} />
    </>
  );
}
