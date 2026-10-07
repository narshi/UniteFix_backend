/**
 * /pay/<token> — a partner's customer pays an invoice or an event advance.
 * No login: the token in the link is the key. The payment goes through
 * UniteFix's gateway and is recorded on the partner's books automatically.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { razorpayCheckout } from "@/lib/hub";

type View = { business: string; businessPhone: string | null; description: string; amount: number; status: "open" | "paid" | "cancelled"; paidAt: string | null; paymentId: string | null; customerName: string | null; gateway: boolean };

const rs = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-0 noise-overlay px-4 py-10">
      <div className="mx-auto max-w-md">{children}<p className="mt-10 text-center text-xs text-[hsl(215,20%,50%)]">Secure payment through UniteFix · UPI, cards and net banking</p></div>
    </div>
  );
}

export default function PayLinkPage() {
  const token = window.location.pathname.split("/").filter(Boolean)[1] ?? "";
  const q = useQuery<View>({ queryKey: ["/api/public/pay", token], queryFn: async () => (await apiRequest("GET", `/api/public/pay/${encodeURIComponent(token)}`)).data, retry: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (q.isError) return <Shell><h1 className="text-2xl font-semibold text-white">This payment link is not valid.</h1><p className="mt-2 text-[hsl(215,20%,70%)]">Please check the link, or ask the business to send it again.</p></Shell>;
  if (!q.data) return <Shell><p className="text-[hsl(215,20%,65%)]">Loading…</p></Shell>;
  const v = q.data;

  const pay = async () => {
    setBusy(true); setErr(null);
    try {
      const o: any = (await apiRequest("POST", `/api/public/pay/${encodeURIComponent(token)}/order`, {})).data;
      const r = await razorpayCheckout({ key: o.keyId, orderId: o.orderId, amountRupees: o.amount, description: o.description, name: o.prefill?.name, email: o.prefill?.email, phone: o.prefill?.phone });
      await apiRequest("POST", `/api/public/pay/${encodeURIComponent(token)}/confirm`, r);
      await q.refetch();
    } catch (e) {
      setErr(apiErrorMessage(e));
      q.refetch();
    } finally { setBusy(false); }
  };

  if (v.status === "paid") return (
    <Shell>
      <p className="text-xs font-mono uppercase tracking-widest text-emerald-300">Paid</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">{rs(v.amount)} received</h1>
      <p className="mt-2 text-[hsl(215,20%,75%)]">{v.business} · {v.description}</p>
      {v.paidAt && <p className="mt-4 text-sm text-[hsl(215,20%,65%)]">Paid on {new Date(v.paidAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}</p>}
      {v.paymentId && <p className="mt-1 font-mono text-xs text-[hsl(215,20%,55%)]">Payment reference {v.paymentId}</p>}
      <p className="mt-6 text-sm text-[hsl(215,20%,65%)]">Thank you. {v.business} has been told.</p>
    </Shell>
  );
  if (v.status === "cancelled") return (
    <Shell>
      <h1 className="text-2xl font-semibold text-white">This link is no longer active.</h1>
      <p className="mt-2 text-[hsl(215,20%,70%)]">{v.business} may have sent a newer one, or this was settled another way.{v.businessPhone ? ` Call ${v.businessPhone} if you are unsure.` : ""}</p>
    </Shell>
  );
  return (
    <Shell>
      <p className="text-xs font-mono uppercase tracking-widest text-[hsl(174,72%,55%)]">Payment to {v.business}</p>
      <h1 className="mt-2 text-4xl font-semibold tabular-nums text-white">{rs(v.amount)}</h1>
      <p className="mt-2 text-[hsl(215,20%,75%)]">{v.description}</p>
      {v.customerName && <p className="mt-1 text-sm text-[hsl(215,20%,60%)]">For {v.customerName}</p>}
      <div className="mt-8">
        {v.gateway ? <Button className="w-full" size="lg" disabled={busy} onClick={pay}>{busy ? "Opening payment…" : `Pay ${rs(v.amount)}`}</Button>
          : <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">Online payment is not available right now. Please pay {v.business} directly{v.businessPhone ? ` (${v.businessPhone})` : ""}.</p>}
        {err && <p role="alert" className="mt-3 text-sm text-rose-300">{err}</p>}
      </div>
      {v.businessPhone && <p className="mt-6 text-sm text-[hsl(215,20%,65%)]">Questions about this payment? Call {v.businessPhone}.</p>}
    </Shell>
  );
}
