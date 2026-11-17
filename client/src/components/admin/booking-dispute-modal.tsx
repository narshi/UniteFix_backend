/**
 * Disputes on a booking, from Service Requests.
 *
 *   open     Staff mark a booking as under dispute (the customer or the expert
 *            has complained). The expert's earning for the job stays on hold
 *            while it is disputed.
 *   resolve  Staff settle it: refund the customer, release the expert's held
 *            earning, or both. The booking then goes back to completed.
 *
 * The server moves the money and records who decided what; this only asks.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";

export type DisputeMode = "open" | "resolve";
type Resolution = "customer_right" | "shared_fault" | "expert_right";

const field = "mt-1 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white";
const muted = "text-xs text-[hsl(215,20%,60%)]";

/** Bookings a dispute can be opened on (the states the booking flow allows it from). */
export const DISPUTABLE_STATES = ["in_progress", "pending_payment", "completed"];

export default function BookingDisputeModal({ service, mode, onClose }: { service: any; mode: DisputeMode | null; onClose: () => void }) {
  const { toast } = useToast();
  const open = !!service && !!mode;
  const [reason, setReason] = useState("");
  const [resolution, setResolution] = useState<Resolution>("customer_right");
  const [refundRupees, setRefundRupees] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason(""); setResolution("customer_right"); setRefundRupees("");
  }, [open, service?.id, mode]);

  // What the customer paid online and what is held for the expert, so staff decide on real figures.
  const billing = useQuery<any>({
    queryKey: ["/api/admin/bookings", service?.id, "billing"],
    enabled: open && mode === "resolve",
    queryFn: async () => apiRequest("GET", `/api/admin/bookings/${service.id}/billing`),
  });
  const { paid, held } = useMemo(() => {
    const d = billing.data?.data;
    const rows: any[] = Array.isArray(d?.payments) ? d.payments : (d?.payments?.rows ?? []);
    // One figure per Razorpay payment: the app and the webhook can each record the same capture.
    const byPayment = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== "captured" || !r.razorpay_payment_id) continue;
      byPayment.set(r.razorpay_payment_id, Math.max(byPayment.get(r.razorpay_payment_id) ?? 0, Number(r.amount) || 0));
    }
    const paidPaise = Array.from(byPayment.values()).reduce((a, b) => a + b, 0);
    const heldRupees = (d?.walletTransactions ?? [])
      .filter((t: any) => (t.transactionType === "hold_credit" && !t.isReleased) || t.transactionType === "dispute_hold")
      .reduce((a: number, t: any) => a + (Number(t.amount) || 0), 0);
    return { paid: paidPaise / 100, held: heldRupees };
  }, [billing.data]);

  const done = (title: string, description?: string) => {
    toast({ title, description });
    queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && ((q.queryKey[0] as string).startsWith("/api/admin/services") || (q.queryKey[0] as string).startsWith("/api/admin/bookings")) });
    onClose();
  };

  const openDispute = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/bookings/${service.id}/override`, { newState: "disputed", reason: `Dispute: ${reason.trim()}` }),
    onSuccess: (r: any) => {
      const eh = r?.data?.earningHeld;
      const short = Number(eh?.shortfall) || 0;
      if (eh?.error) {
        toast({ title: "Marked as disputed, but the expert's earning was not put on hold", description: `${eh.error}. Check the expert's wallet by hand before paying anything out.`, variant: "destructive" });
        queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/admin/services") });
        onClose();
        return;
      }
      done(
        "Marked as disputed",
        short > 0
          ? `The expert's earning is back on hold, except ₹${short} they had already withdrawn. Settle that part by hand.`
          : "The expert's earning for this job is on hold until the dispute is resolved.",
      );
    },
    onError: (e) => toast({ title: "Not marked", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const resolve = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/bookings/${service.id}/resolve-dispute`, {
      resolution,
      remarks: reason.trim(),
      // Full refund sends no amount: the server returns everything captured.
      ...(resolution === "shared_fault" ? { refundAmount: Number(refundRupees) } : {}),
    }),
    onSuccess: (r: any) => {
      const refundFailed = r?.data?.refund && r.data.refund.success === false;
      if (refundFailed) {
        toast({ title: "Dispute closed, but the refund did not go through", description: `${r.data.refund.error ?? "Razorpay refused it."} Refund the customer by hand.`, variant: "destructive" });
        queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/admin/services") });
        onClose();
        return;
      }
      done("Dispute resolved", (r?.data?.actionsTaken ?? []).join(". ") || undefined);
    },
    onError: (e) => toast({ title: "Not resolved", description: apiErrorMessage(e), variant: "destructive" }),
  });

  if (!service || !mode) return null;
  const busy = openDispute.isPending || resolve.isPending;
  const refundNumber = Number(refundRupees);
  const splitInvalid = resolution === "shared_fault" && (!(refundNumber > 0) || (paid > 0 && refundNumber > paid));
  const nothingToRefund = !billing.isLoading && paid <= 0;

  const options: Array<[Resolution, string, string]> = [
    ["customer_right", paid > 0 ? `The customer was right: refund ₹${paid}` : "The customer was right: refund in full", "Everything they paid goes back. The expert loses the held earning for this job, up to the refund. UniteFix covers anything the held earning does not."],
    ["shared_fault", "Both were partly at fault", "The customer gets the amount you enter back. The expert loses that amount from the held earning and keeps the rest."],
    ["expert_right", "The expert was right: no refund", "The complaint is not upheld. Nothing is refunded and the expert's held earning is released to them."],
  ];

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg glass-panel border-[rgba(255,255,255,0.1)]">
        <DialogHeader>
          <DialogTitle className="text-white">{mode === "open" ? "Mark as disputed" : "Resolve this dispute"}</DialogTitle>
          <DialogDescription className="text-[hsl(215,20%,65%)]">
            {service.serviceId} · {service.serviceType} · {String(service.status).replace(/_/g, " ")}.{" "}
            {mode === "open"
              ? "Use this when the customer or the expert disputes the job or the bill. The expert's earning for it stays on hold until you resolve it."
              : "Decide who gets the money. The booking goes back to completed and the decision is recorded in the audit trail."}
          </DialogDescription>
        </DialogHeader>

        {mode === "open" ? (
          <div className="space-y-4">
            <div>
              <Label htmlFor="bd-reason" className="text-[hsl(215,20%,85%)]">What is disputed</Label>
              <Textarea id="bd-reason" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Customer says the AC stopped cooling the next day; wants a refund" className={field} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose} className="border-[rgba(255,255,255,0.15)] text-white bg-transparent">Back</Button>
              <Button disabled={busy || reason.trim().length < 5} onClick={() => openDispute.mutate()} className="bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)] text-white" data-testid="dispute-open-confirm">
                {openDispute.isPending ? "Marking…" : "Mark as disputed"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[hsl(215,20%,85%)]" data-testid="dispute-figures">
              {billing.isLoading ? "Checking what was paid…"
                : billing.isError ? "Could not load the payment figures. You can still resolve the dispute."
                : `Paid online by the customer: ${paid > 0 ? `₹${paid}` : "nothing"}. On hold for the expert: ${held > 0 ? `₹${held}` : "nothing"}.`}
            </p>
            <fieldset className="space-y-2">
              <legend className="text-sm text-[hsl(215,20%,85%)] mb-1">Decision</legend>
              {options.map(([v, label, hint]) => (
                <label key={v} className="flex items-start gap-2 text-sm text-white">
                  <input type="radio" name="bd-resolution" className="mt-1" value={v} checked={resolution === v} onChange={() => setResolution(v)} />
                  <span>{label}<span className={`block ${muted}`}>{hint}</span></span>
                </label>
              ))}
            </fieldset>
            {resolution === "shared_fault" && (
              <div>
                <Label htmlFor="bd-refund" className="text-[hsl(215,20%,85%)]">Refund amount (₹{paid > 0 ? `, up to ${paid}` : ""})</Label>
                <Input id="bd-refund" inputMode="decimal" value={refundRupees} onChange={e => setRefundRupees(e.target.value.replace(/[^\d.]/g, ""))} className={field} />
              </div>
            )}
            {resolution !== "expert_right" && nothingToRefund && (
              <p className="text-sm text-[hsl(38,92%,60%)]">Nothing was paid online on this booking, so there is nothing the app can refund. Cash is returned outside the app.</p>
            )}
            <div>
              <Label htmlFor="bd-remarks" className="text-[hsl(215,20%,85%)]">Why (recorded, and sent to the customer and the expert)</Label>
              <Textarea id="bd-remarks" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="Expert revisited and confirmed a faulty part; refunding labour" className={field} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose} className="border-[rgba(255,255,255,0.15)] text-white bg-transparent">Back</Button>
              <Button disabled={busy || reason.trim().length < 5 || splitInvalid} onClick={() => resolve.mutate()} className="bg-[hsl(160,84%,39%)] hover:bg-[hsl(160,84%,34%)] text-white" data-testid="dispute-resolve-confirm">
                {resolve.isPending ? "Resolving…" : "Resolve dispute"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
