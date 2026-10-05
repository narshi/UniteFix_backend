/**
 * Purchases — every bill this business can claim input tax credit on:
 * UniteFix's GST invoices and credit notes (issued automatically), and the
 * bills from other suppliers the partner records here. Exports the purchase
 * register as CSV for the accountant.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { inr, openAuthedPdf } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty, Stat } from "@/components/hub/ui";

type Doc = { id: number; docKind: string; number: string; purpose: string; issuedAt: string; taxable: number; cgst: number; sgst: number; igst: number; total: number; periodFrom: string | null };
type Bill = { id: number; supplierName: string; supplierGstin: string | null; billNumber: string; billDate: string; taxable: number; cgst: number; sgst: number; igst: number; total: number; fileUrl: string | null };
const PURPOSE: Record<string, string> = { b2b_order: "Parts order", fee: "UniteFix fees" };

export default function HubPurchases() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ documents: Doc[]; bills: Bill[]; itc: { cgst: number; sgst: number; igst: number } }>({ queryKey: ["/api/hub/purchases"], queryFn: async () => (await apiRequest("GET", "/api/hub/purchases")).data });
  const [open, setOpen] = useState(false);
  const blank = { supplierName: "", supplierGstin: "", billNumber: "", billDate: new Date().toISOString().slice(0, 10), taxableRupees: "", cgstRupees: "", sgstRupees: "", igstRupees: "" };
  const [f, setF] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });

  const save = async () => {
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => { if (String(v).trim()) fd.append(k, String(v).trim()); });
      if (file) fd.append("file", file);
      const res = await fetch("/api/hub/purchases/bills", { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("adminToken") ?? ""}` }, body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body)}`);
      qc.invalidateQueries({ queryKey: ["/api/hub/purchases"] });
      setOpen(false); setF(blank); setFile(null);
      toast({ title: "Bill recorded" });
    } catch (e) { fail("Bill not saved")(e); } finally { setSaving(false); }
  };
  const remove = async (id: number) => {
    if (!window.confirm("Remove this bill from your purchase register?")) return;
    try { await apiRequest("DELETE", `/api/hub/purchases/bills/${id}`); qc.invalidateQueries({ queryKey: ["/api/hub/purchases"] }); } catch (e) { fail("Not removed")(e); }
  };
  const downloadCsv = async () => {
    try {
      const res = await fetch("/api/hub/purchases/register.csv", { headers: { Authorization: `Bearer ${localStorage.getItem("adminToken") ?? ""}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "purchase-register.csv"; a.click();
    } catch (e) { fail("Could not export")(e); }
  };

  const taxable = Number(f.taxableRupees) || 0;
  const hint = taxable ? `18% would be ${inr(taxable * 0.09)} each as CGST/SGST, or ${inr(taxable * 0.18)} IGST` : "";

  return (
    <HubPage title="Purchases" subtitle="Bills you can claim input tax credit on. UniteFix's invoices appear here by themselves; add your other suppliers' bills."
      actions={<><Button variant="outline" onClick={downloadCsv}>Export register (CSV)</Button><Button onClick={() => setOpen(true)}>Add a supplier bill</Button></>}>
      {data && (
        <div className="grid gap-3 grid-cols-3">
          <Stat label="CGST you paid" value={inr(data.itc.cgst)} />
          <Stat label="SGST you paid" value={inr(data.itc.sgst)} />
          <Stat label="IGST you paid" value={inr(data.itc.igst)} hint="Net of credit notes" />
        </div>
      )}
      <Panel title="From UniteFix">
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !data?.documents.length ? <Empty icon="receipt_long" title="No UniteFix invoices yet">Parts orders get a tax invoice at dispatch; fees are invoiced monthly.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-[hsl(215,20%,55%)]"><th className="py-2">Document</th><th>For</th><th>Date</th><th className="text-right">Taxable</th><th className="text-right">GST</th><th className="text-right">Total</th><th /></tr></thead>
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{data.documents.map(d => (
              <tr key={d.id}>
                <td className="py-2"><span className="font-mono text-white">{d.number}</span> {d.docKind === "credit_note" && <Chip tone="info">credit note</Chip>}</td>
                <td className="text-[hsl(215,20%,70%)]">{PURPOSE[d.purpose] ?? d.purpose}{d.periodFrom ? ` · ${d.periodFrom.slice(0, 7)}` : ""}</td>
                <td className="text-[hsl(215,20%,70%)]">{new Date(d.issuedAt).toLocaleDateString("en-IN")}</td>
                <td className="text-right tabular-nums">{inr(d.taxable)}</td>
                <td className="text-right tabular-nums">{inr(d.cgst + d.sgst + d.igst)}</td>
                <td className="text-right tabular-nums text-white">{d.docKind === "credit_note" ? "−" : ""}{inr(d.total)}</td>
                <td className="text-right"><Button size="sm" variant="ghost" onClick={() => openAuthedPdf(`/api/hub/tax-documents/${d.id}/pdf`).catch(fail("Could not open"))}>PDF</Button></td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
      <Panel title="Other suppliers">
        {!data?.bills.length ? <Empty icon="upload_file" title="No supplier bills recorded" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-[hsl(215,20%,55%)]"><th className="py-2">Supplier</th><th>Bill</th><th>Date</th><th className="text-right">Taxable</th><th className="text-right">GST</th><th className="text-right">Total</th><th /></tr></thead>
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{data.bills.map(b => (
              <tr key={b.id}>
                <td className="py-2 text-white">{b.supplierName}<span className="block font-mono text-[11px] text-[hsl(215,20%,55%)]">{b.supplierGstin ?? "unregistered"}</span></td>
                <td className="font-mono">{b.billNumber}</td><td className="text-[hsl(215,20%,70%)]">{b.billDate}</td>
                <td className="text-right tabular-nums">{inr(b.taxable)}</td><td className="text-right tabular-nums">{inr(b.cgst + b.sgst + b.igst)}</td><td className="text-right tabular-nums text-white">{inr(b.total)}</td>
                <td className="text-right whitespace-nowrap">{b.fileUrl && <a className="text-xs underline underline-offset-2 mr-2" href={b.fileUrl} target="_blank" rel="noreferrer">file</a>}<Button size="sm" variant="ghost" className="text-rose-300" onClick={() => remove(b.id)}>Remove</Button></td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add a supplier bill</DialogTitle><DialogDescription>Copy the figures from the bill. A bill has either CGST + SGST (same state) or IGST (another state).</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="pb-sup">Supplier</Label><Input id="pb-sup" value={f.supplierName} onChange={e => setF({ ...f, supplierName: e.target.value })} /></div>
            <div><Label htmlFor="pb-gstin">Supplier GSTIN</Label><Input id="pb-gstin" maxLength={15} value={f.supplierGstin} onChange={e => setF({ ...f, supplierGstin: e.target.value.toUpperCase() })} /></div>
            <div><Label htmlFor="pb-no">Bill number</Label><Input id="pb-no" value={f.billNumber} onChange={e => setF({ ...f, billNumber: e.target.value })} /></div>
            <div><Label htmlFor="pb-date">Bill date</Label><Input id="pb-date" type="date" value={f.billDate} onChange={e => setF({ ...f, billDate: e.target.value })} /></div>
            <div><Label htmlFor="pb-tax">Taxable value ₹</Label><Input id="pb-tax" inputMode="decimal" value={f.taxableRupees} onChange={e => setF({ ...f, taxableRupees: e.target.value })} /></div>
            <div><Label htmlFor="pb-cgst">CGST ₹</Label><Input id="pb-cgst" inputMode="decimal" value={f.cgstRupees} onChange={e => setF({ ...f, cgstRupees: e.target.value })} /></div>
            <div><Label htmlFor="pb-sgst">SGST ₹</Label><Input id="pb-sgst" inputMode="decimal" value={f.sgstRupees} onChange={e => setF({ ...f, sgstRupees: e.target.value })} /></div>
            <div><Label htmlFor="pb-igst">IGST ₹</Label><Input id="pb-igst" inputMode="decimal" value={f.igstRupees} onChange={e => setF({ ...f, igstRupees: e.target.value })} /></div>
            <div><Label htmlFor="pb-file">Copy of the bill</Label><Input id="pb-file" type="file" accept="application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} /></div>
            {hint && <p className="sm:col-span-2 text-xs text-[hsl(215,20%,60%)]">{hint}</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving || !f.supplierName.trim() || !f.billNumber.trim() || !f.taxableRupees}>{saving ? "Saving…" : "Save bill"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}
