/**
 * Partner Hub client helpers.
 *
 * `useHubMe` is the one source the shell reads: who is signed in, for which
 * business, in which role, with which modules and plan. Navigation and route
 * guards are built from it; the server enforces the same rules independently.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { HubModule, HubPermission, HubRole } from "@shared/hub";
import { ROLE_PERMISSIONS } from "@shared/hub";

export interface HubMe {
  businessPartnerId: number;
  partnerCode: string;
  displayName: string;
  status: "pending_approval" | "active" | "paused" | "disabled";
  adminUserId: number;
  username: string;
  role: HubRole;
  permissions: HubPermission[];
  verticals: string[];
  modules: HubModule[];
  plan: "starter" | "pro";
  ftthOperatorId: number | null;
  planLimits: { invoicesPerMonth: number | null; teamMembers: number | null; gstExports: boolean; eInvoice: boolean };
  business: {
    legalName: string; displayName: string; gstin: string | null; pan: string | null; stateName: string | null; stateCode: string | null;
    contactName: string | null; contactPhone: string; contactEmail: string | null; address: string | null; pincode: string | null; district: string | null;
    aatoAbove5cr: boolean; approvedAt: string | null;
  } | null;
  onboarding: { steps: Array<{ key: string; label: string; done: boolean; detail: string }>; readyToSubmit: boolean; submittedAt: string | null; rejectionReason: string | null };
}

export function useHubMe() {
  const q = useQuery<HubMe>({
    queryKey: ["/api/hub/me"],
    queryFn: async () => (await apiRequest("GET", "/api/hub/me")).data,
    staleTime: 60_000,
    retry: false,
  });
  return { me: q.data ?? null, isLoading: q.isLoading, error: q.error as Error | null, refetch: q.refetch };
}

export const hubCan = (me: HubMe | null, perm: HubPermission) => !!me && (ROLE_PERMISSIONS[me.role] ?? []).includes(perm);
export const hubHas = (me: HubMe | null, mod: HubModule) => !!me && me.modules.includes(mod);

export const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function signOut() {
  localStorage.removeItem("adminToken");
  localStorage.removeItem("adminUser");
  window.location.href = "/";
}

/** Open a PDF that needs the sign-in token (tax invoices, statements) in a new tab. */
export async function openAuthedPdf(url: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem("adminToken") ?? ""}` } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  window.open(href, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

/** Razorpay web checkout, loaded on first use. Resolves with the signed result. */
export function razorpayCheckout(opts: { key: string; orderId: string; amountRupees: number; description: string; name?: string; email?: string; phone?: string }) {
  return new Promise<{ razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }>((resolve, reject) => {
    const open = () => {
      const Rzp = (window as any).Razorpay;
      if (!Rzp) return reject(new Error("Payment window could not load. Check your connection."));
      const rzp = new Rzp({
        key: opts.key, order_id: opts.orderId, amount: Math.round(opts.amountRupees * 100), currency: "INR",
        name: "UniteFix", description: opts.description,
        prefill: { name: opts.name ?? "", email: opts.email ?? "", contact: opts.phone ?? "" },
        theme: { color: "#0E6B73" },
        handler: (r: any) => resolve(r),
        modal: { ondismiss: () => reject(new Error("Payment cancelled.")) },
      });
      rzp.open();
    };
    if ((window as any).Razorpay) return open();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = open;
    s.onerror = () => reject(new Error("Payment window could not load. Check your connection."));
    document.body.appendChild(s);
  });
}
