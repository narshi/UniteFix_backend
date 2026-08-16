/**
 * Permanent deletion of several accounts at once, with a combined impact preview.
 *
 * Same contract as the single-account dialog: the server measures the impact by
 * running the real DELETE statements per account in a transaction and rolling
 * back, so the total shown is the sum of what will actually be deleted rather
 * than an estimate.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, Trash2 } from "lucide-react";

interface Props {
  kind: "user" | "employee";
  ids: number[];
  noun: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

type BulkImpact = {
  accounts: Array<{ id: number; username: string | null; totalRows: number }>;
  counts: Record<string, number>;
  totalRows: number;
  skipped: number;
};

const HEADLINE: Array<[string, string]> = [
  ["service_requests", "Service requests"],
  ["invoices", "Invoices"],
  ["payment_transactions", "Payment transactions"],
  ["partner_wallets", "Wallets"],
  ["wallet_transactions_v2", "Wallet ledger entries"],
  ["withdrawal_requests", "Withdrawal requests"],
  ["product_orders", "Product orders"],
  ["support_tickets", "Support tickets"],
  ["ratings", "Ratings"],
  ["notifications", "Notifications"],
];

export function BulkPurgeDialog({ kind, ids, noun, open, onOpenChange, onDeleted }: Props) {
  const { toast } = useToast();
  const [typed, setTyped] = useState("");

  const { data, isLoading, isError, error } = useQuery<{ data: BulkImpact }>({
    queryKey: [`/api/admin/accounts/${kind}/bulk-deletion-impact`, ids.join(",")],
    // POST because the id list can be long enough to overflow a query string.
    queryFn: () => apiRequest("POST", `/api/admin/accounts/${kind}/bulk-deletion-impact`, { ids }),
    enabled: open && ids.length > 0,
  });

  const impact = data?.data;

  const purge = useMutation({
    mutationFn: async () =>
      apiRequest("DELETE", `/api/admin/accounts/${kind}/bulk?confirm=true`, { ids }),
    onSuccess: (result: any) => {
      toast({ title: "Accounts deleted", description: result?.message });
      close();
      onDeleted();
    },
    onError: (e: any) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const close = () => {
    setTyped("");
    onOpenChange(false);
  };

  const armed = typed.trim().toUpperCase() === "DELETE";
  const nonZero = HEADLINE.filter(([k]) => (impact?.counts?.[k] ?? 0) > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.9)]">
        <DialogHeader>
          <DialogTitle className="text-xl text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-[hsl(347,77%,60%)]" />
            Delete {ids.length} {noun}{ids.length === 1 ? "" : "s"}?
          </DialogTitle>
          <DialogDescription className="text-[hsl(215,20%,60%)]">
            Permanently removes every selected account and everything connected to it. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <div className="py-6 text-center text-sm text-[hsl(215,20%,60%)]">Calculating combined impact…</div>}
        {isError && <div className="py-4 text-sm text-[hsl(347,77%,65%)]">Could not load preview: {(error as any)?.message}</div>}

        {impact && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[hsla(347,77%,50%,0.25)] bg-[hsla(347,77%,50%,0.08)] p-4">
              <div className="text-2xl font-bold text-white">{impact.totalRows} rows</div>
              <div className="text-xs text-[hsl(215,20%,65%)] mt-0.5">
                across {impact.accounts.length} account{impact.accounts.length === 1 ? "" : "s"}
                {impact.skipped > 0 && (
                  <span className="text-[hsl(38,92%,65%)]"> · {impact.skipped} skipped (protected or missing)</span>
                )}
              </div>
            </div>

            {nonZero.length > 0 && (
              <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                {nonZero.map(([key, label]) => (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-[hsl(210,20%,75%)]">{label}</span>
                    <span className="text-white font-semibold">{impact.counts[key]}</span>
                  </div>
                ))}
              </div>
            )}

            {impact.accounts.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-[hsl(215,20%,60%)] hover:text-white">
                  Accounts being deleted
                </summary>
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                  {impact.accounts.map((a) => (
                    <div key={a.id} className="flex justify-between text-[hsl(210,20%,75%)]">
                      <span className="truncate">{a.username ?? `#${a.id}`}</span>
                      <span className="text-[hsl(215,20%,55%)] shrink-0 ml-2">{a.totalRows} rows</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="space-y-2 pt-1">
              <label className="text-xs text-[hsl(215,20%,65%)]">
                Type <span className="font-mono font-bold text-white">DELETE</span> to confirm
              </label>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white font-mono"
              />
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1 border-[rgba(255,255,255,0.1)] text-[hsl(210,20%,85%)]" onClick={close}>
            Cancel
          </Button>
          <Button
            className="flex-1 bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)] text-white disabled:opacity-40"
            disabled={!armed || purge.isPending || !impact}
            onClick={() => purge.mutate()}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {purge.isPending ? "Deleting…" : `Delete ${ids.length}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
