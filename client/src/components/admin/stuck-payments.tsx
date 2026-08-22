/**
 * Stuck Payments — reconciliation safety net.
 *
 * A dynamic QR is paid from the customer's own UPI app, so nothing reports the
 * outcome back to either mobile client. The partner app polls Razorpay while the
 * QR is on screen, and the webhook settles it otherwise — but if webhook delivery
 * fails AND the partner closed the app, a genuinely paid booking sits in
 * pending_payment with no automatic way out.
 *
 * "Check Razorpay" asks Razorpay directly whether that QR was captured, and
 * settles the booking only if it was. It cannot mark an unpaid booking as paid.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { RefreshCw, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { useState } from "react";

interface StuckBooking {
  id: number;
  serviceId: string | null;
  serviceType: string | null;
  amountDue: number;
  customerName: string | null;
  customerPhone: string | null;
  partnerName: string | null;
  qrCodeId: string | null;
  waitingSinceMinutes: number | null;
}

export function StuckPayments() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checkingId, setCheckingId] = useState<number | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<any>({
    queryKey: ["/api/admin/payments/stuck"],
  });

  const bookings: StuckBooking[] = data?.data ?? [];

  const reconcile = useMutation({
    mutationFn: async (serviceId: number) => {
      const res = await apiRequest("POST", `/api/admin/services/${serviceId}/reconcile-payment`);
      return res;
    },
    onSuccess: (result: any) => {
      const d = result?.data ?? {};
      toast({
        title: d.paid ? "Payment confirmed" : "No payment found",
        description: d.message,
        variant: d.paid ? undefined : "destructive",
      });
      if (d.paid) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/payments/stuck"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/services"] });
      }
    },
    onError: (err: any) => {
      toast({ title: "Check failed", description: err.message, variant: "destructive" });
    },
    onSettled: () => setCheckingId(null),
  });

  // Nothing stuck is the normal state — stay quiet rather than showing an empty card.
  if (!isLoading && !isError && bookings.length === 0) return null;

  return (
    <Card className="glass-card border-[hsla(38,92%,50%,0.25)] relative z-10 stagger-enter mb-6">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0 border-b border-[rgba(255,255,255,0.06)] bg-[hsla(38,92%,50%,0.04)] rounded-t-xl">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-[hsl(38,92%,60%)] shrink-0" />
          <div>
            <CardTitle className="text-xl text-white">Awaiting Payment</CardTitle>
            <p className="text-sm text-[hsl(215,20%,60%)] mt-0.5">
              Bookings where the bill was submitted but payment has not settled.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="border-[rgba(255,255,255,0.12)] text-[hsl(210,20%,85%)] hover:bg-[rgba(255,255,255,0.06)] w-full sm:w-auto"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="pt-6">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 skeleton-shimmer rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-[hsl(347,77%,65%)] py-4">
            Could not load pending payments. This is a loading failure, not an empty list.
          </p>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full glass-table">
              <thead>
                <tr className="text-left border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                  <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Booking</th>
                  <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Customer</th>
                  <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Service Expert</th>
                  <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Amount Due</th>
                  <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Waiting</th>
                  <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider text-right">Action</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {bookings.map((b) => {
                  const waited = b.waitingSinceMinutes ?? 0;
                  const stale = waited > 30;
                  return (
                    <tr
                      key={b.id}
                      className="border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)]"
                    >
                      <td className="p-4">
                        <p className="font-medium text-[hsl(210,20%,90%)]">{b.serviceId || `#${b.id}`}</p>
                        <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5 capitalize">
                          {(b.serviceType || "").replace(/_/g, " ")}
                        </p>
                      </td>
                      <td className="p-4">
                        <p className="text-[hsl(210,20%,85%)]">{b.customerName || "—"}</p>
                        <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">{b.customerPhone || ""}</p>
                      </td>
                      <td className="p-4 text-[hsl(215,20%,70%)]">{b.partnerName || "—"}</td>
                      <td className="p-4">
                        <p className="font-mono font-medium text-[hsl(160,84%,65%)]">
                          ₹{Number(b.amountDue || 0).toLocaleString()}
                        </p>
                      </td>
                      <td className="p-4">
                        <Badge
                          variant="outline"
                          className={
                            stale
                              ? "bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,65%)] border-[hsla(38,92%,50%,0.3)]"
                              : "bg-[rgba(255,255,255,0.03)] text-[hsl(215,20%,70%)] border-[rgba(255,255,255,0.1)]"
                          }
                        >
                          <Clock className="w-3 h-3 mr-1" />
                          {waited < 60 ? `${waited}m` : `${Math.floor(waited / 60)}h`}
                        </Badge>
                        {!b.qrCodeId && (
                          <p className="text-xs text-[hsl(215,20%,50%)] mt-1">no QR issued</p>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!b.qrCodeId || checkingId === b.id}
                          title={
                            b.qrCodeId
                              ? "Ask Razorpay whether this QR was paid"
                              : "No QR was generated for this booking"
                          }
                          onClick={() => {
                            setCheckingId(b.id);
                            reconcile.mutate(b.id);
                          }}
                          className="border-[hsla(217,91%,60%,0.3)] text-[hsl(217,91%,70%)] hover:bg-[hsla(217,91%,60%,0.1)] disabled:opacity-40"
                        >
                          {checkingId === b.id ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                              Checking…
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                              Check Razorpay
                            </>
                          )}
                        </Button>
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
  );
}
