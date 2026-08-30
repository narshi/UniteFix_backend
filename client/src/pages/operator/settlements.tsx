/**
 * Settlements — the operator's running account with UniteFix.
 *
 * A positive balance is money UniteFix owes the operator. Recharges add to it,
 * lead-acquisition fees subtract, and a settlement zeroes it down. Read-only:
 * only UniteFix records a payment, so an operator cannot mark themselves paid.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

interface LedgerEntry {
  id: number;
  entryType: "recharge_collected" | "platform_fee" | "lead_fee" | "settlement_paid" | "adjustment";
  amount: number;
  amountPaise: number;
  description: string | null;
  createdAt: string;
}

const LABEL: Record<LedgerEntry["entryType"], string> = {
  recharge_collected: "Recharge collected",
  platform_fee: "UniteFix convenience fee",
  lead_fee: "Lead acquisition fee",
  settlement_paid: "Settlement paid to you",
  adjustment: "Adjustment",
};

export default function OperatorSettlements() {
  const { data, isLoading } = useQuery<{ data: { balance: number; entries: LedgerEntry[] } }>({
    queryKey: ["/api/ftth/admin/ledger"],
  });

  const balance = data?.data.balance ?? 0;
  const entries = data?.data.entries ?? [];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white tracking-tight">Settlements</h1>
        <p className="text-sm text-[hsl(215,20%,65%)] mt-1">
          What UniteFix has collected on your behalf, and what's been paid out.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <p className="text-xs uppercase tracking-wider text-[hsl(215,20%,55%)]">Current balance</p>
          <p className={`text-4xl font-bold mt-1 ${balance >= 0 ? "text-[hsl(160,84%,55%)]" : "text-[hsl(347,77%,65%)]"}`}>
            ₹{Math.abs(balance).toLocaleString("en-IN")}
          </p>
          <p className="text-sm text-[hsl(215,20%,65%)] mt-1">
            {balance >= 0 ? "Due to you from UniteFix" : "Owed by you to UniteFix"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Statement</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-[hsl(215,20%,55%)]">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-[hsl(215,20%,55%)]">Nothing here yet — it fills up as customers recharge.</p>
          ) : (
            <ul className="divide-y divide-[rgba(255,255,255,0.05)]">
              {entries.map(e => (
                <li key={e.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-white text-sm">{LABEL[e.entryType]}</p>
                    {e.description && (
                      <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">{e.description}</p>
                    )}
                    <p className="text-xs text-[hsl(215,20%,40%)] mt-0.5">
                      {format(new Date(e.createdAt), "d MMM yyyy, HH:mm")}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-mono text-sm ${
                      e.amount > 0
                        ? "text-[hsl(160,84%,60%)]"
                        : e.amount < 0
                          ? "text-[hsl(347,77%,65%)]"
                          : "text-[hsl(215,20%,50%)]"
                    }`}
                  >
                    {e.amount > 0 ? "+" : ""}₹{Math.abs(e.amount).toLocaleString("en-IN")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
