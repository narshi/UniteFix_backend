/**
 * Line items for invoices and quotations: description, HSN/SAC, quantity,
 * unit, rate and GST rate, with live totals. A business without a GSTIN
 * charges no GST, so the GST columns disappear and the total is the value.
 * The server recomputes and validates everything; this is only the preview.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inr } from "@/lib/hub";
import { HubSelect } from "@/components/hub/ui";

export interface LineDraft { description: string; hsnSac: string; quantity: string; unit: string; rateRupees: string; gstRate: string }

export const blankLine = (gstRate = "18"): LineDraft => ({ description: "", hsnSac: "", quantity: "1", unit: "", rateRupees: "", gstRate });

export function linesToPayload(lines: LineDraft[], registered: boolean) {
  return lines.filter(l => l.description.trim() || Number(l.rateRupees)).map(l => ({
    description: l.description.trim(), hsnSac: l.hsnSac.trim() || null, quantity: Number(l.quantity) || 0, unit: l.unit.trim() || null,
    rateRupees: Number(l.rateRupees) || 0, gstRate: registered ? Number(l.gstRate) : 0,
  }));
}

export function lineTotals(lines: LineDraft[], registered: boolean) {
  let taxable = 0, tax = 0;
  for (const l of lines) {
    const t = Math.round((Number(l.rateRupees) || 0) * 100 * (Number(l.quantity) || 0));
    taxable += t;
    if (registered) tax += Math.round(t * Number(l.gstRate) / 100);
  }
  return { taxable: taxable / 100, tax: tax / 100, total: (taxable + tax) / 100 };
}

export function LineEditor({ lines, onChange, registered, rates }: { lines: LineDraft[]; onChange: (l: LineDraft[]) => void; registered: boolean; rates: number[] }) {
  const set = (i: number, patch: Partial<LineDraft>) => onChange(lines.map((l, j) => j === i ? { ...l, ...patch } : l));
  const t = lineTotals(lines, registered);
  return (
    <div className="space-y-2">
      <div className="hidden md:grid grid-cols-[1fr_96px_72px_64px_104px_80px_32px] gap-2 text-[11px] uppercase tracking-wider text-[hsl(215,20%,55%)]">
        <span>Item or service</span><span>HSN/SAC</span><span>Qty</span><span>Unit</span><span>Rate ₹</span><span>{registered ? "GST" : ""}</span><span />
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-2 md:grid-cols-[1fr_96px_72px_64px_104px_80px_32px] gap-2 rounded-lg md:rounded-none border md:border-0 border-[rgba(255,255,255,0.08)] p-2 md:p-0">
          <Input className="col-span-2 md:col-span-1" aria-label={`Line ${i + 1} description`} placeholder="e.g. Laptop service" value={l.description} onChange={e => set(i, { description: e.target.value })} />
          <Input aria-label={`Line ${i + 1} HSN or SAC`} inputMode="numeric" maxLength={8} placeholder={registered ? "998713" : "optional"} value={l.hsnSac} onChange={e => set(i, { hsnSac: e.target.value.replace(/\D/g, "") })} />
          <Input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={e => set(i, { quantity: e.target.value })} />
          <Input aria-label={`Line ${i + 1} unit`} placeholder="pcs" value={l.unit} onChange={e => set(i, { unit: e.target.value })} />
          <Input aria-label={`Line ${i + 1} rate in rupees`} inputMode="decimal" placeholder="0.00" value={l.rateRupees} onChange={e => set(i, { rateRupees: e.target.value })} />
          {registered
            ? <HubSelect aria-label={`Line ${i + 1} GST rate`} value={l.gstRate} onChange={v => set(i, { gstRate: v })}>{rates.map(r => <option key={r} value={String(r)}>{r}%</option>)}</HubSelect>
            : <span className="hidden md:block" />}
          <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
            <span className="material-icons text-base" style={{ fontFamily: "Material Icons" }}>close</span>
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...lines, blankLine(lines[lines.length - 1]?.gstRate ?? "18")])}>Add line</Button>
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-sm">
          <dt className="text-[hsl(215,20%,60%)]">Value</dt><dd className="text-right tabular-nums">{inr(t.taxable)}</dd>
          {registered && <><dt className="text-[hsl(215,20%,60%)]">GST</dt><dd className="text-right tabular-nums">{inr(t.tax)}</dd></>}
          <dt className="font-semibold text-white">Total</dt><dd className="text-right font-semibold tabular-nums text-white">{inr(t.total)}</dd>
        </dl>
      </div>
      {!registered && <p className="text-xs text-[hsl(215,20%,55%)]">You have no GSTIN on file, so you issue a bill of supply and charge no GST.</p>}
      {registered && <p className="text-xs text-[hsl(215,20%,55%)]">CGST + SGST or IGST is decided by the customer's state when the invoice is issued.</p>}
    </div>
  );
}
