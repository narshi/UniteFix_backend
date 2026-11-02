/**
 * Staff end a booking from Service Requests: cancel it (with a refund choice
 * and optional visit pay for the expert) or close it as completed when the
 * customer paid outside the app. The server moves the money; this only asks.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";

type Mode = "cancel" | "close";
type Preview = { status: string; paidOnline: number; hasExpert: boolean; cancellable: boolean };

const CLOSE_METHODS: Array<[string, string]> = [
  ["expert_cash", "Cash to the expert"],
  ["office_cash", "Cash at the UniteFix office"],
  ["upi", "UPI to UniteFix"],
  ["bank", "Bank transfer to UniteFix"],
  ["other", "Other, paid to UniteFix"],
];

const field = "mt-1 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white";
const muted = "text-xs text-[hsl(215,20%,60%)]";

export default function BookingEndModal({ service, mode, onClose }: { service: any; mode: Mode | null; onClose: () => void }) {
  const { toast } = useToast();
  const open = !!service && !!mode;
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState<"full" | "partial" | "none">("full");
  const [refundRupees, setRefundRupees] = useState("");
  const [visitPay, setVisitPay] = useState("");
  const [method, setMethod] = useState("expert_cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");

  const due = Number(service?.pricingSnapshot?.finalTotal ?? NaN);
  useEffect(() => {
    if (!open) return;
    setReason(""); setRefund("full"); setRefundRupees(""); setVisitPay(""); setMethod("expert_cash"); setReference("");
    setAmount(Number.isFinite(due) ? String(due) : "");
  }, [open, service?.id, mode]);

  const preview = useQuery<{ data: Preview }>({
    queryKey: ["/api/admin/services", service?.id, "cancel-preview"],
    enabled: open && mode === "cancel",
    queryFn: async () => apiRequest("GET", `/api/admin/services/${service.id}/cancel-preview`),
  });
  const paid = preview.data?.data?.paidOnline ?? 0;
  useEffect(() => { if (mode === "cancel" && preview.data) setRefund(paid > 0 ? "full" : "none"); }, [preview.data, mode]);

  const done = (r: any, title: string) => {
    toast({ title, description: r?.message });
    queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/admin/services") });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/assignment-queue"] });
    onClose();
  };
  const cancel = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/services/${service.id}/cancel`, {
      reason, refund, refundRupees: refund === "partial" ? Number(refundRupees) : undefined, visitPayRupees: Number(visitPay) || 0,
    }),
    onSuccess: (r) => done(r, "Booking cancelled"),
    onError: (e) => toast({ title: "Not cancelled", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const close = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/services/${service.id}/close`, {
      method, amountRupees: Number(amount), reference: reference || undefined, note: reason,
    }),
    onSuccess: (r) => done(r, "Closed as completed"),
    onError: (e) => toast({ title: "Not closed", description: apiErrorMessage(e), variant: "destructive" }),
  });

  if (!service || !mode) return null;
  const busy = cancel.isPending || close.isPending;
  const needsRef = method === "upi" || method === "bank";

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg glass-panel border-[rgba(255,255,255,0.1)]">
        <DialogHeader>
          <DialogTitle className="text-white">{mode === "cancel" ? "Cancel this booking" : "Close as completed"}</DialogTitle>
          <DialogDescription className="text-[hsl(215,20%,65%)]">
            {service.serviceId} · {service.serviceType} · {String(service.status).replace(/_/g, " ")}.{" "}
            {mode === "cancel"
              ? "The customer and the expert are told why. A refund goes back the way it was paid."
              : "Use this when the work is done but the app could not finish it. The expert is paid exactly as if the app had closed it."}
          </DialogDescription>
        </DialogHeader>

        {mode === "cancel" ? (
          <div className="space-y-4">
            <div>
              <Label htmlFor="be-reason" className="text-[hsl(215,20%,85%)]">Reason</Label>
              <Textarea id="be-reason" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="Customer asked to cancel on the phone" className={field} />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm text-[hsl(215,20%,85%)]">
                Money paid online: {preview.isLoading ? "checking…" : paid > 0 ? `₹${paid}` : "nothing"}
              </legend>
              {paid > 0 && (
                <div className="space-y-2">
                  {([["full", `Refund all ₹${paid}`], ["partial", "Refund part, keep a visit charge"], ["none", "No refund"]] as const).map(([v, l]) => (
                    <label key={v} className="flex items-center gap-2 text-sm text-white">
                      <input type="radio" name="be-refund" value={v} checked={refund === v} onChange={() => setRefund(v)} /> {l}
                    </label>
                  ))}
                  {refund === "partial" && (
                    <div>
                      <Label htmlFor="be-refund-amt" className={muted}>Refund amount (₹, up to {paid})</Label>
                      <Input id="be-refund-amt" inputMode="decimal" value={refundRupees} onChange={e => setRefundRupees(e.target.value.replace(/[^\d.]/g, ""))} className={field} />
                    </div>
                  )}
                </div>
              )}
            </fieldset>
            {preview.data?.data?.hasExpert && (
              <div>
                <Label htmlFor="be-visit" className="text-[hsl(215,20%,85%)]">Pay the expert for the visit (₹, optional)</Label>
                <Input id="be-visit" inputMode="decimal" value={visitPay} placeholder="0" onChange={e => setVisitPay(e.target.value.replace(/[^\d.]/g, ""))} className={field} />
                <p className={`${muted} mt-1`}>Added to their wallet, held like any earning.</p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose} className="border-[rgba(255,255,255,0.15)] text-white bg-transparent">Keep booking</Button>
              <Button disabled={busy || reason.trim().length < 3 || preview.isLoading} onClick={() => cancel.mutate()} className="bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)] text-white">
                {cancel.isPending ? "Cancelling…" : "Cancel booking"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="be-method" className="text-[hsl(215,20%,85%)]">How the customer paid the balance</Label>
              <select id="be-method" value={method} onChange={e => setMethod(e.target.value)} className={`w-full rounded-md border px-3 py-2 text-sm ${field}`}>
                {CLOSE_METHODS.map(([v, l]) => <option key={v} value={v} className="bg-[hsl(222,40%,12%)]">{l}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="be-amount" className="text-[hsl(215,20%,85%)]">Amount paid (₹)</Label>
              <Input id="be-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={field} />
              <p className={`${muted} mt-1`}>{Number.isFinite(due) ? `The balance on the bill is ₹${due}.` : "The expert has not entered the bill yet; it must exist before closing."}</p>
            </div>
            {needsRef && (
              <div>
                <Label htmlFor="be-ref" className="text-[hsl(215,20%,85%)]">UTR / UPI reference</Label>
                <Input id="be-ref" value={reference} onChange={e => setReference(e.target.value)} className={field} />
              </div>
            )}
            <div>
              <Label htmlFor="be-note" className="text-[hsl(215,20%,85%)]">Note</Label>
              <Textarea id="be-note" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="Expert's phone died after the job; customer confirmed cash paid" className={field} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose} className="border-[rgba(255,255,255,0.15)] text-white bg-transparent">Back</Button>
              <Button disabled={busy || reason.trim().length < 3 || amount === "" || (needsRef && reference.trim().length < 4)} onClick={() => close.mutate()} className="bg-[hsl(160,84%,39%)] hover:bg-[hsl(160,84%,34%)] text-white">
                {close.isPending ? "Closing…" : "Close as completed"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
