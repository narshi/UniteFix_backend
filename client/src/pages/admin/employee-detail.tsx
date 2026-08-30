/**
 * One employee, whole. Jobs, wallet, payouts and ratings in a single place.
 *
 * These lived in three screens before — the Employees list, a transactions
 * modal, and the Withdrawals page — with no way to answer "what has this person
 * actually done, and what are we holding for them?" without cross-referencing by
 * hand. Working out why one expert's payout hadn't arrived meant three tabs and
 * a database query.
 *
 * Money is gated separately from the rest: reaching the page needs
 * employees:view, but Wallet and Payouts additionally need payments:view /
 * withdrawals:view. When a section is withheld the page says so, because an
 * empty table that means "you may not see this" and one that means "there is
 * nothing here" are otherwise indistinguishable.
 */

import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Star, Lock, Wallet, Briefcase, Banknote } from "lucide-react";
import { format } from "date-fns";

interface Detail {
  employee: {
    id: number; fullName: string | null; partnerId: string | null;
    username: string | null; phone: string | null; email: string | null;
    address: string | null; pinCode: string | null;
    documentVerificationStatus: string; isActive: boolean | null; isOnline: boolean | null;
    services: string[] | null; upiId: string | null;
    upiVerifiedAt: string | null; upiVerifiedName: string | null;
    hasPayoutDestination: boolean; payoutAutomationReady: boolean;
    totalServicesCompleted: number | null; createdAt: string;
  };
  stats: {
    jobsTotal: number; jobsCompleted: number;
    ratingCount: number; averageRating: number | null;
    balanceAvailable: string; balanceHold: string; totalEarned: string;
    nextReleaseDate: string | null; nextReleaseAmount: string | null;
  };
  jobs: Array<{
    id: number; serviceId: string | null; serviceType: string | null; status: string;
    totalAmount: string | null; bookingFee: string | null; createdAt: string;
    customerName: string | null; customerPhone: string | null; rating: number | null;
  }>;
  ratings: Array<{
    id: number; rating: number; review: string | null; createdAt: string;
    serviceId: string | null; serviceType: string | null; customerName: string | null;
  }>;
  wallet: Array<{
    id: number; transactionType: string; amount: string; description: string | null;
    balanceAvailableAfter: string | null; isReleased: boolean | null;
    releaseDate: string | null; createdAt: string;
  }> | null;
  withdrawals: Array<{
    id: number; amount: string; method: string; status: string;
    failureReason: string | null; createdAt: string;
  }> | null;
  visibility: { wallet: boolean; withdrawals: boolean };
}

type Tab = "jobs" | "wallet" | "withdrawals" | "ratings";

export default function EmployeeDetailPage() {
  const [, params] = useRoute("/partners/:id");
  const id = Number(params?.id);
  const [tab, setTab] = useState<Tab>("jobs");

  const { data, isLoading, isError } = useQuery<{ data: Detail }>({
    queryKey: [`/api/admin/servicemen/${id}/detail`],
    enabled: Number.isInteger(id),
  });

  if (isLoading) return <div className="p-8 text-[hsl(215,20%,65%)]">Loading…</div>;
  if (isError || !data) return <div className="p-8 text-[hsl(215,20%,65%)]">Could not load this employee.</div>;

  const { employee: e, stats, jobs, ratings, wallet, withdrawals, visibility } = data.data;

  const tabs: Array<{ key: Tab; label: string; count: number | null }> = [
    { key: "jobs", label: "Jobs", count: jobs.length },
    { key: "wallet", label: "Wallet", count: wallet?.length ?? null },
    { key: "withdrawals", label: "Payouts", count: withdrawals?.length ?? null },
    { key: "ratings", label: "Ratings", count: ratings.length },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <Link href="/partners">
        <a className="inline-flex items-center gap-1.5 text-sm text-[hsl(215,20%,65%)] hover:text-white">
          <ArrowLeft className="w-4 h-4" /> All employees
        </a>
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              {e.fullName || e.username || `Employee #${e.id}`}
            </h1>
            <Badge
              className={
                e.documentVerificationStatus === "verified"
                  ? "bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)]"
                  : e.documentVerificationStatus === "suspended"
                    ? "bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border-[hsla(347,77%,50%,0.3)]"
                    : "bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,65%)] border-[hsla(38,92%,50%,0.3)]"
              }
            >
              {e.documentVerificationStatus}
            </Badge>
            {e.isOnline && (
              <Badge className="bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)]">
                online
              </Badge>
            )}
          </div>
          <p className="text-sm text-[hsl(215,20%,65%)] mt-1">
            {e.partnerId ? `${e.partnerId} · ` : ""}{e.phone ?? "—"}
            {e.email ? ` · ${e.email}` : ""}
            {e.pinCode ? ` · PIN ${e.pinCode}` : ""}
          </p>
          {e.services?.length ? (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {e.services.map(s => (
                <Badge key={s} variant="outline" className="text-[10px] bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,75%)]">
                  {s}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Briefcase className="w-4 h-4" />} label="Jobs completed"
          value={`${stats.jobsCompleted} / ${stats.jobsTotal}`} />
        <Stat icon={<Star className="w-4 h-4" />} label="Rating"
          value={stats.averageRating !== null ? `${stats.averageRating} ★` : "Not rated yet"}
          sub={stats.ratingCount ? `${stats.ratingCount} review${stats.ratingCount === 1 ? "" : "s"}` : undefined}
          tone={stats.averageRating !== null && stats.averageRating < 3 ? "warn" : undefined} />
        <Stat icon={<Wallet className="w-4 h-4" />} label="Available to withdraw"
          value={`₹${stats.balanceAvailable}`} tone="good" />
        <Stat icon={<Banknote className="w-4 h-4" />} label="On hold"
          value={`₹${stats.balanceHold}`}
          // The same answer the expert app now gives them, so support and the
          // expert are never reading two different stories.
          sub={stats.nextReleaseDate
            ? `₹${stats.nextReleaseAmount} frees ${format(new Date(stats.nextReleaseDate), "d MMM")}`
            : undefined}
          tone={parseFloat(stats.balanceHold) > 0 ? "warn" : undefined} />
      </div>

      {/* Payout readiness, because "why hasn't this person been paid" usually
          ends here rather than in the wallet. */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Payout details</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <p className="text-white font-mono">{e.upiId || "No UPI ID saved"}</p>
          {!e.hasPayoutDestination ? (
            <p className="text-[hsl(38,92%,65%)]">
              No payout destination — they cannot request a payout at all.
            </p>
          ) : e.upiVerifiedAt ? (
            <p className="text-[hsl(160,84%,65%)]">
              Verified{e.upiVerifiedName ? ` — registered to ${e.upiVerifiedName}` : ""}
            </p>
          ) : (
            <p className="text-[hsl(38,92%,65%)]">
              Not verified — nobody has confirmed this UPI ID exists.
            </p>
          )}
          {e.hasPayoutDestination && !e.payoutAutomationReady && (
            <p className="text-[hsl(215,20%,60%)]">
              No RazorpayX fund account — payouts must be settled manually with a proof screenshot.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              tab === t.key
                ? "bg-[hsla(217,91%,60%,0.15)] text-[hsl(217,91%,70%)] border border-[hsla(217,91%,60%,0.3)]"
                : "text-[hsl(215,20%,65%)] border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.04)]"
            }`}
          >
            {t.label}{t.count !== null ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {tab === "jobs" && (
            jobs.length === 0 ? <Empty>No jobs assigned yet.</Empty> : (
              <ul className="divide-y divide-[rgba(255,255,255,0.05)]">
                {jobs.map(j => (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-white">
                        {j.serviceId ?? `#${j.id}`}
                        <span className="text-[hsl(215,20%,60%)]"> · {j.serviceType ?? "Service"}</span>
                      </p>
                      <p className="text-xs text-[hsl(215,20%,55%)]">
                        {j.customerName ?? "—"} · {format(new Date(j.createdAt), "d MMM yyyy")}
                        {j.rating ? ` · ${j.rating}★` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-[hsl(215,20%,60%)]">{j.status}</span>
                      <span className="font-mono text-white">
                        ₹{j.totalAmount ?? j.bookingFee ?? "0"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}

          {tab === "wallet" && (
            !visibility.wallet ? <Restricted need="Payments" /> :
              !wallet?.length ? <Empty>No wallet movements yet.</Empty> : (
                <ul className="divide-y divide-[rgba(255,255,255,0.05)]">
                  {wallet.map(w => {
                    // hold_credit is money earned but NOT yet withdrawable. Showing
                    // it as a plain credit is what let an expert believe he could
                    // withdraw it.
                    const held = w.transactionType === "hold_credit" && !w.isReleased;
                    return (
                      <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                        <div className="min-w-0">
                          <p className="text-white">
                            {w.description || w.transactionType}
                            {held && (
                              <span className="ml-2 text-xs text-[hsl(38,92%,65%)]">
                                on hold{w.releaseDate ? ` till ${format(new Date(w.releaseDate), "d MMM")}` : ""}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-[hsl(215,20%,55%)]">
                            {w.transactionType} · {format(new Date(w.createdAt), "d MMM yyyy, HH:mm")}
                          </p>
                        </div>
                        <span className="font-mono text-white shrink-0">₹{w.amount}</span>
                      </li>
                    );
                  })}
                </ul>
              )
          )}

          {tab === "withdrawals" && (
            !visibility.withdrawals ? <Restricted need="Withdrawals" /> :
              !withdrawals?.length ? <Empty>No payout requests yet.</Empty> : (
                <ul className="divide-y divide-[rgba(255,255,255,0.05)]">
                  {withdrawals.map(w => (
                    <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="text-white">₹{w.amount} via {w.method}</p>
                        <p className="text-xs text-[hsl(215,20%,55%)]">
                          {format(new Date(w.createdAt), "d MMM yyyy, HH:mm")}
                          {w.failureReason ? ` · ${w.failureReason}` : ""}
                        </p>
                      </div>
                      <Badge
                        className={
                          w.status === "completed"
                            ? "bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)]"
                            : w.status === "failed" || w.status === "rejected"
                              ? "bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border-[hsla(347,77%,50%,0.3)]"
                              : "bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,65%)] border-[hsla(38,92%,50%,0.3)]"
                        }
                      >
                        {w.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )
          )}

          {tab === "ratings" && (
            ratings.length === 0 ? <Empty>No customer ratings yet.</Empty> : (
              <ul className="divide-y divide-[rgba(255,255,255,0.05)]">
                {ratings.map(r => (
                  <li key={r.id} className="py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-white">
                        {"★".repeat(r.rating)}<span className="text-[hsl(215,20%,35%)]">{"★".repeat(5 - r.rating)}</span>
                      </span>
                      <span className="text-xs text-[hsl(215,20%,55%)]">
                        {format(new Date(r.createdAt), "d MMM yyyy")}
                      </span>
                    </div>
                    {r.review && <p className="text-[hsl(210,20%,85%)] mt-1">"{r.review}"</p>}
                    <p className="text-xs text-[hsl(215,20%,50%)] mt-1">
                      {r.customerName ?? "Customer"} · {r.serviceId ?? ""} {r.serviceType ?? ""}
                    </p>
                  </li>
                ))}
              </ul>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  tone?: "good" | "warn";
}) {
  const color = tone === "good" ? "text-[hsl(160,84%,60%)]"
    : tone === "warn" ? "text-[hsl(38,92%,60%)]" : "text-white";
  return (
    <div className="glass-card border border-[rgba(255,255,255,0.08)] rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-[hsl(215,20%,55%)]">
        {icon}
        <p className="text-xs uppercase tracking-wider">{label}</p>
      </div>
      <p className={`text-xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">{sub}</p>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[hsl(215,20%,55%)] py-4">{children}</p>;
}

/**
 * Withheld, not empty. Left as a blank table this reads like missing data and
 * sends someone hunting for a bug that isn't there.
 */
function Restricted({ need }: { need: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[hsl(215,20%,60%)] py-4">
      <Lock className="w-4 h-4" />
      <span>Your role can't see this. It needs {need} access.</span>
    </div>
  );
}
