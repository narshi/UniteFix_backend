/**
 * Permanent account deletion, with an impact preview.
 *
 * Used from both Customer Management (kind="user") and Employees
 * (kind="employee") — an expert has a row in each table, and the backend
 * resolves either id to the same account.
 *
 * The preview is not an estimate: the server runs the real DELETE statements
 * inside a transaction and rolls back, so the numbers shown here are produced by
 * exactly the statements that will run on confirm.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, Trash2 } from "lucide-react";

interface PurgeAccountDialogProps {
  kind: "user" | "employee";
  /** users.id when kind="user", employees.id when kind="employee". */
  id: number;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Query keys to refresh once the account is gone. */
  invalidateKeys?: string[];
}

type Impact = {
  userId: number;
  employeeId: number | null;
  username: string | null;
  totalRows: number;
  counts: Record<string, number>;
};

/** Rows the admin actually cares about, in the order they mean something. */
const HEADLINE_TABLES: Array<[string, string]> = [
  ["service_requests", "Service requests"],
  ["invoices", "Invoices"],
  ["payment_transactions", "Payment transactions"],
  ["partner_wallets", "Wallet"],
  ["wallet_transactions_v2", "Wallet ledger entries"],
  ["withdrawal_requests", "Withdrawal requests"],
  ["ratings", "Ratings"],
  ["product_orders", "Product orders"],
  ["support_tickets", "Support tickets"],
  ["notifications", "Notifications"],
  ["device_tokens", "Device tokens"],
];

export function PurgeAccountDialog({
  kind,
  id,
  name,
  open,
  onOpenChange,
  invalidateKeys = [],
}: PurgeAccountDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");

  const { data, isLoading, isError, error } = useQuery<{ data: Impact }>({
    queryKey: [`/api/admin/accounts/${kind}/${id}/deletion-impact`],
    // Only ask the server once the dialog is actually open — the preview runs a
    // full transaction, so it is not free.
    enabled: open,
  });

  const impact = data?.data;

  const purgeMutation = useMutation({
    mutationFn: async () =>
      apiRequest("DELETE", `/api/admin/accounts/${kind}/${id}?confirm=true`),
    onSuccess: (result: any) => {
      toast({
        title: "Account deleted",
        description: result?.message ?? `${name} and all connected data removed.`,
      });
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      close();
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const close = () => {
    setTyped("");
    onOpenChange(false);
  };

  const armed = typed.trim().toUpperCase() === "DELETE";
  const nonZero = HEADLINE_TABLES.filter(([key]) => (impact?.counts?.[key] ?? 0) > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.9)] shadow-[0_0_40px_rgba(0,0,0,0.5)]">
        <DialogHeader>
          <DialogTitle className="text-xl text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-[hsl(347,77%,60%)]" />
            Delete {name}?
          </DialogTitle>
          <DialogDescription className="text-[hsl(215,20%,60%)]">
            Permanently removes this account and everything connected to it. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-6 text-center text-sm text-[hsl(215,20%,60%)]">
            Calculating impact…
          </div>
        )}

        {isError && (
          <div className="py-4 text-sm text-[hsl(347,77%,65%)]">
            Could not load the impact preview: {(error as any)?.message}
          </div>
        )}

        {impact && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[hsla(347,77%,50%,0.25)] bg-[hsla(347,77%,50%,0.08)] p-4">
              <div className="text-2xl font-bold text-white">
                {impact.totalRows} row{impact.totalRows === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-[hsl(215,20%,65%)] mt-0.5">
                will be permanently deleted across {nonZero.length || 1} area
                {nonZero.length === 1 ? "" : "s"}
              </div>
            </div>

            {nonZero.length > 0 ? (
              <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                {nonZero.map(([key, label]) => (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-[hsl(210,20%,75%)]">{label}</span>
                    <span className="text-white font-semibold">{impact.counts[key]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[hsl(215,20%,60%)]">
                No connected records — only the account itself will be removed.
              </p>
            )}

            {(impact.counts.service_requests ?? 0) > 0 && (
              <p className="text-xs text-[hsl(38,92%,65%)] bg-[hsla(38,92%,50%,0.08)] border border-[hsla(38,92%,50%,0.2)] rounded-lg p-2.5">
                {kind === "employee"
                  ? "These jobs disappear from the customers' history too — a booking cannot exist without its assigned expert."
                  : "These bookings disappear from the assigned experts' history too."}
              </p>
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
          <Button
            variant="outline"
            className="flex-1 border-[rgba(255,255,255,0.1)] text-[hsl(210,20%,85%)] hover:bg-[rgba(255,255,255,0.05)]"
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)] text-white disabled:opacity-40"
            disabled={!armed || purgeMutation.isPending || !impact}
            onClick={() => purgeMutation.mutate()}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {purgeMutation.isPending ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
