/**
 * GST desk — the period's figures, due dates and the files the accountant
 * needs: sales and purchase registers, HSN summary, and (Pro) the GSTR-1 JSON
 * for the GST offline tool. Nothing is filed from here.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { inr, downloadAuthed } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty, Stat, HubSelect, Thead } from "@/components/hub/ui";

type Summary = {
  period: { from: string; to: string; label: string; fp: string }; registered: boolean; gstin: string | null; frequency: "monthly" | "quarterly";
  output: { taxable: number; cgst: number; sgst: number; igst: number }; input: { taxable: number; cgst: number; sgst: number; igst: number };
  netPayableEstimate: number; creditCarriedEstimate: number; counts: { invoices: number; creditNotes: number; purchases: number }; irnPending: number;
  dueDates: { gstr1: string; gstr3b: string; note: string | null }; gstExports: boolean;
  hsn: Array<{ hsn: string; rate: number; b2b: boolean; desc: string; uqc: string; qty: number; txval: number; iamt: number; camt: number; samt: number }>;
};

function periods(frequency: "monthly" | "quarterly") {
  const out: Array<[string, string]> = [];
  const now = new Date();
  if (frequency === "quarterly") {
    // FY quarters: Q1 Apr–Jun … Q4 Jan–Mar.
    let fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    let q = Math.floor(((now.getMonth() + 9) % 12) / 3) + 1;
    for (let i = 0; i < 8; i++) {
      out.push([`${fy}-Q${q}`, `Q${q} FY ${fy}-${String(fy + 1).slice(2)}`]);
      q--; if (q === 0) { q = 4; fy--; }
    }
  } else {
    for (let i = 0; i < 15; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push([`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, d.toLocaleString("en-IN", { month: "long", year: "numeric" })]);
    }
  }
  return out;
}

const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function HubGstDesk() {
  const { toast } = useToast();
  const [freq, setFreq] = useState<"monthly" | "quarterly" | null>(null);
  const [period, setPeriod] = useState<string>(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const { data: s, isLoading } = useQuery<Summary>({ queryKey: ["/api/hub/gst/summary", period], queryFn: async () => (await apiRequest("GET", `/api/hub/gst/summary?period=${period}`)).data });
  const frequency = freq ?? s?.frequency ?? "monthly";
  const options = useMemo(() => periods(frequency), [frequency]);
  const dl = (path: string, name: string) => downloadAuthed(`${path}?period=${period}`, name).catch(e => toast({ title: "Could not download", description: apiErrorMessage(e), variant: "destructive" }));

  const switchFreq = (f: "monthly" | "quarterly") => { setFreq(f); setPeriod(periods(f)[f === "quarterly" ? 0 : 1][0]); };

  return (
    <HubPage title="GST desk" subtitle="Your returns, prepared from the invoices and bills in the Hub. Check them, then file on the GST portal yourself or through your CA."
      actions={<div className="flex flex-wrap items-center gap-2">
        <HubSelect aria-label="Filing frequency" value={frequency} onChange={v => switchFreq(v as any)}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></HubSelect>
        <HubSelect aria-label="Period" value={period} onChange={setPeriod}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</HubSelect>
      </div>}>
      {isLoading || !s ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !s.registered ? (
        <Panel><Empty icon="gavel" title="You are not GST-registered">You issue bills of supply and file no GST returns. The sales register below is still useful for your books. Add your GSTIN in <Link href="/partner/settings" className="underline">Business profile</Link> once you register.</Empty>
          <div className="flex justify-center"><Button variant="outline" onClick={() => dl("/api/hub/gst/sales-register.csv", `sales-register-${period}.csv`)}>Sales register (CSV)</Button></div></Panel>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="GST on your sales" value={inr(s.output.cgst + s.output.sgst + s.output.igst)} hint={`${s.counts.invoices} invoice${s.counts.invoices === 1 ? "" : "s"} · ${s.counts.creditNotes} credit note${s.counts.creditNotes === 1 ? "" : "s"}`} />
            <Stat label="GST on your purchases" value={inr(s.input.cgst + s.input.sgst + s.input.igst)} hint={`${s.counts.purchases} bills — claim only what shows in GSTR-2B`} />
            <Stat label="Likely to pay in cash" value={inr(s.netPayableEstimate)} hint={s.creditCarriedEstimate ? `${inr(s.creditCarriedEstimate)} credit carried forward` : "estimate before set-off rules"} />
            <Stat label="Due dates" value={<span className="text-base">GSTR-1 {fmt(s.dueDates.gstr1)}</span>} hint={`GSTR-3B ${fmt(s.dueDates.gstr3b)}`} />
          </div>
          {s.dueDates.note && <p className="text-xs text-[hsl(215,20%,60%)]">{s.dueDates.note}</p>}
          {s.irnPending > 0 && <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">{s.irnPending} B2B invoice(s) this period still need an IRN. <Link href="/partner/sales/invoices" className="underline">Open invoices</Link></div>}

          <Panel title="Tax by head">
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
              <Thead cols={["", ["Value", "right"], ["CGST", "right"], ["SGST", "right"], ["IGST", "right"]]} />
              <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
                <tr><td className="py-2 text-white">Sales (output tax)</td><td className="text-right tabular-nums">{inr(s.output.taxable)}</td><td className="text-right tabular-nums">{inr(s.output.cgst)}</td><td className="text-right tabular-nums">{inr(s.output.sgst)}</td><td className="text-right tabular-nums">{inr(s.output.igst)}</td></tr>
                <tr><td className="py-2 text-white">Purchases (input tax)</td><td className="text-right tabular-nums">{inr(s.input.taxable)}</td><td className="text-right tabular-nums">{inr(s.input.cgst)}</td><td className="text-right tabular-nums">{inr(s.input.sgst)}</td><td className="text-right tabular-nums">{inr(s.input.igst)}</td></tr>
              </tbody>
            </table></div>
          </Panel>

          <Panel title="Files for your return">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => dl("/api/hub/gst/sales-register.csv", `sales-register-${s.period.fp}.csv`)}>Sales register (CSV)</Button>
              <Button variant="outline" onClick={() => dl("/api/hub/gst/purchase-register.csv", `purchase-register-${s.period.fp}.csv`)}>Purchase register (CSV)</Button>
              <Button variant="outline" onClick={() => dl("/api/hub/gst/hsn-summary.csv", `hsn-summary-${s.period.fp}.csv`)}>HSN summary (CSV)</Button>
              {s.gstExports
                ? <Button onClick={() => dl("/api/hub/gst/gstr1.json", `GSTR1-${s.gstin}-${s.period.fp}.json`)}>GSTR-1 JSON</Button>
                : <span className="flex items-center gap-2 text-sm text-[hsl(215,20%,65%)]"><Chip tone="info">Pro</Chip> GSTR-1 JSON for the offline tool comes with Hub Pro.</span>}
            </div>
            <p className="mt-3 text-xs text-[hsl(215,20%,55%)]">The JSON follows the GST offline tool's import format (B2B, B2CL, B2CS, credit notes, nil-rated, HSN split B2B/B2C, documents issued). Open it in the offline tool and check it before uploading.</p>
          </Panel>

          <Panel title="HSN / SAC summary">
            {!s.hsn.length ? <Empty icon="list" title="No sales this period" /> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
                <Thead cols={["Type", "HSN/SAC", "Description", ["Qty", "right"], ["Rate", "right"], ["Value", "right"], ["Tax", "right"]]} />
                <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{s.hsn.map((h, i) => (
                  <tr key={i}><td className="py-2"><Chip tone={h.b2b ? "info" : "muted"}>{h.b2b ? "B2B" : "B2C"}</Chip></td><td className="font-mono">{h.hsn}</td><td className="text-[hsl(215,20%,70%)]">{h.desc}</td>
                    <td className="text-right tabular-nums">{h.qty} {h.uqc}</td><td className="text-right">{h.rate}%</td><td className="text-right tabular-nums">{inr(h.txval)}</td><td className="text-right tabular-nums">{inr(h.iamt + h.camt + h.samt)}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </>
      )}
    </HubPage>
  );
}
