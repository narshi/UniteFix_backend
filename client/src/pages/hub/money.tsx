/**
 * Money — what UniteFix owes this business and what it owes UniteFix, never
 * netted on screen; the next settlement and how an offset would apply; every
 * settlement with its statement; UniteFix's fee invoices; the full statement.
 */

import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { inr, openAuthedPdf } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty, Stat } from "@/components/hub/ui";

type Money = {
  owedToYou: number; youOwe: number; nextPayout: number; offsetNext: number;
  credit: { limit: number; outstanding: number; available: number };
  lines: Array<{ id: string; source: "b2b" | "ftth"; entryType: string; amount: number; description: string | null; createdAt: string }>;
  settlements: Array<{ id: number; runCode: string; status: string; payout: number; offset: number; method: string | null; payoutReference: string | null; createdAt: string; paidAt: string | null }>;
  feeInvoices: Array<{ id: number; number: string; periodFrom: string | null; total: number; issuedAt: string }>;
};

const ENTRY: Record<string, string> = {
  order_invoice: "Parts order", payment_received: "Payment received", credit_note: "Credit note", refund: "Refund", adjustment: "Adjustment",
  settlement_paid: "Settlement", settlement_received: "Settlement received", fee_charge: "UniteFix fee", settlement_offset: "Offset against earnings",
  recharge_collected: "Recharge collected for you", platform_fee: "Convenience fee (customer)", lead_fee: "Lead fee",
  service_value: "Field job value", cash_collected: "Cash your technician collected",
  marketplace_sale: "Store sale", marketplace_commission: "Store commission (with GST)", tcs: "GST TCS (claim in GSTR-3B)", tds: "TDS u/s 194-O (see 26AS)",
};

export default function HubMoney() {
  const { toast } = useToast();
  const { data: m, isLoading } = useQuery<Money>({ queryKey: ["/api/hub/money"], queryFn: async () => (await apiRequest("GET", "/api/hub/money")).data });
  const pdf = (url: string) => openAuthedPdf(url).catch(e => toast({ title: "Could not open", description: apiErrorMessage(e), variant: "destructive" }));

  if (isLoading || !m) return <HubPage title="Money"><p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p></HubPage>;

  return (
    <HubPage title="Money" subtitle="Two balances, shown separately. At settlement, anything you owe for parts is taken from what UniteFix owes you — on its own line — and the rest is paid to your bank.">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="UniteFix owes you" value={inr(m.owedToYou)} />
        <Stat label="You owe UniteFix" value={inr(m.youOwe)} hint={m.credit.limit > 0 ? `${inr(m.credit.available)} of ${inr(m.credit.limit)} credit free` : "Prepaid account"} />
        <Stat label="Next settlement" value={inr(m.nextPayout)} hint={m.offsetNext > 0 ? `after ${inr(m.offsetNext)} offset` : "paid weekly"} />
        <Stat label="Settlements so far" value={m.settlements.filter(s => s.status === "paid").length} />
      </div>

      <Panel title="Settlements">
        {m.settlements.length === 0 ? <Empty icon="account_balance" title="No settlements yet" /> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">
            {m.settlements.map(s => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-mono text-white">{s.runCode}</span>
                <Chip tone={s.status === "paid" ? "good" : s.status === "failed" ? "bad" : s.status === "cancelled" ? "muted" : "warn"}>{s.status}</Chip>
                <span className="text-[hsl(215,20%,70%)]">{inr(s.payout)} paid{s.offset > 0 ? ` · ${inr(s.offset)} offset` : ""}{s.payoutReference ? ` · ref ${s.payoutReference}` : ""}</span>
                <span className="ml-auto text-xs text-[hsl(215,20%,55%)]">{new Date(s.paidAt ?? s.createdAt).toLocaleDateString("en-IN")}</span>
                <Button size="sm" variant="ghost" onClick={() => pdf(`/api/hub/settlements/${s.id}/pdf`)}>Statement</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="UniteFix fee invoices">
        {m.feeInvoices.length === 0 ? <p className="text-sm text-[hsl(215,20%,60%)]">Issued at the start of each month for the month before, when there are fees.</p> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">
            {m.feeInvoices.map(d => (
              <li key={d.id} className="flex items-center gap-3 py-2"><span className="font-mono text-white">{d.number}</span><span className="text-[hsl(215,20%,70%)]">{d.periodFrom?.slice(0, 7)}</span><span className="ml-auto tabular-nums text-white">{inr(d.total)}</span><Button size="sm" variant="ghost" onClick={() => pdf(`/api/hub/tax-documents/${d.id}/pdf`)}>PDF</Button></li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Statement">
        {m.lines.length === 0 ? <Empty icon="list_alt" title="No entries yet" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-[hsl(215,20%,55%)]"><th className="py-2">Date</th><th>Account</th><th>Entry</th><th className="text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{m.lines.map(l => (
              <tr key={l.id}>
                <td className="py-2 text-[hsl(215,20%,70%)] whitespace-nowrap">{new Date(l.createdAt).toLocaleDateString("en-IN")}</td>
                <td><Chip tone={l.source === "ftth" ? "info" : "muted"}>{l.source === "ftth" ? "Broadband" : "Parts & fees"}</Chip></td>
                <td className="text-white">{ENTRY[l.entryType] ?? l.entryType}<span className="block text-xs text-[hsl(215,20%,55%)]">{l.description}</span></td>
                {/* Statement convention: positive = you owe UniteFix. Shown from your side. */}
                <td className={`text-right tabular-nums ${l.amount > 0 ? "text-rose-300" : l.amount < 0 ? "text-emerald-300" : "text-[hsl(215,20%,60%)]"}`}>{l.amount > 0 ? "−" : l.amount < 0 ? "+" : ""}{inr(Math.abs(l.amount))}</td>
              </tr>
            ))}</tbody></table></div>
        )}
        <p className="mt-2 text-xs text-[hsl(215,20%,55%)]">+ is money coming to you; − is money you owe.</p>
      </Panel>
    </HubPage>
  );
}
