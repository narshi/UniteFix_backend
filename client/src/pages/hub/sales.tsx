/**
 * Sales — the business's own invoices (or bills of supply), quotations,
 * payments received and credit notes. Every document is numbered in the
 * business's own series and laid out as a GST document; corrections are
 * credit notes, never edits.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useHubMe, hubCan, inr, openAuthedPdf } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty, Stat, HubSelect, Thead } from "@/components/hub/ui";
import { LineEditor, blankLine, linesToPayload, type LineDraft } from "@/components/hub/LineEditor";
import { CustomerDialog, useCustomers, type Customer } from "@/pages/hub/customers";
import { PayLinkButton } from "@/components/hub/PayLink";

type Settings = {
  invoicePrefix: string | null; prefixLocked: boolean; invoiceTerms: string | null; gstFilingFrequency: "monthly" | "quarterly";
  registered: boolean; gstin: string | null; eInvoiceRequired: boolean; gstRates: number[]; plan: "starter" | "pro";
  invoicesThisMonth: number; invoiceLimit: number | null; gstExports: boolean;
};
type InvoiceRow = {
  id: number; docKind: string; number: string; issuedAt: string; recipient: { name: string; gstin: string | null }; customerId: number | null;
  taxable: number; cgst: number; sgst: number; igst: number; total: number; paid: number; credited: number; outstanding: number; overdue: boolean;
  dueDate: string | null; irnStatus: string | null; irn: string | null; status: string; placeOfSupply: string | null; notes: string | null;
};
type Quote = {
  id: number; number: string; version: number; status: string; customerId: number; customerName?: string; validUntil: string | null;
  lines: Array<{ description: string; hsnSac: string | null; quantity: number; unit: string | null; ratePaise: number; gstRate: number; taxablePaise: number }>;
  taxable: number; tax: number; total: number; notes: string | null; terms: string | null; invoiceDocumentId: number | null; createdAt: string;
};

const KIND: Record<string, string> = { tax_invoice: "Tax invoice", bill_of_supply: "Bill of supply", credit_note: "Credit note" };
const Q_TONE: Record<string, string> = { draft: "muted", sent: "info", accepted: "good", invoiced: "good", declined: "bad", expired: "bad", superseded: "muted" };
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const linkBtn = "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium";

export function useSalesSettings() {
  return useQuery<Settings>({ queryKey: ["/api/hub/sales/settings"], queryFn: async () => (await apiRequest("GET", "/api/hub/sales/settings")).data });
}

function SettingsDialog({ open, onOpenChange, s }: { open: boolean; onOpenChange: (o: boolean) => void; s: Settings }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({ invoicePrefix: s.invoicePrefix ?? "", invoiceTerms: s.invoiceTerms ?? "", gstFilingFrequency: s.gstFilingFrequency });
  useEffect(() => { if (open) setF({ invoicePrefix: s.invoicePrefix ?? "", invoiceTerms: s.invoiceTerms ?? "", gstFilingFrequency: s.gstFilingFrequency }); }, [open, s]);
  const save = async () => {
    try {
      await apiRequest("PUT", "/api/hub/sales/settings", { ...(s.prefixLocked || !f.invoicePrefix ? {} : { invoicePrefix: f.invoicePrefix }), invoiceTerms: f.invoiceTerms || null, gstFilingFrequency: f.gstFilingFrequency });
      qc.invalidateQueries({ queryKey: ["/api/hub/sales/settings"] });
      toast({ title: "Saved" }); onOpenChange(false);
    } catch (e) { toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Invoice settings</DialogTitle><DialogDescription>Your invoices are numbered PREFIX/FY/0001, restarting each April.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="s-prefix">Number prefix (1–4 letters or digits)</Label><Input id="s-prefix" maxLength={4} disabled={s.prefixLocked} value={f.invoicePrefix} onChange={e => setF({ ...f, invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
            {s.prefixLocked && <p className="mt-1 text-xs text-[hsl(215,20%,55%)]">Fixed now that invoices have been issued in this series.</p>}</div>
          <div><Label htmlFor="s-terms">Terms printed on every invoice</Label><Textarea id="s-terms" rows={3} placeholder="Payment within 15 days. Goods once sold…" value={f.invoiceTerms} onChange={e => setF({ ...f, invoiceTerms: e.target.value })} /></div>
          {s.registered && <div><Label htmlFor="s-freq">GST return filing</Label>
            <HubSelect id="s-freq" className="w-full" value={f.gstFilingFrequency} onChange={v => setF({ ...f, gstFilingFrequency: v as any })}><option value="monthly">Monthly</option><option value="quarterly">Quarterly (QRMP)</option></HubSelect></div>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Invoices list
// ═══════════════════════════════════════════════════════════════════════════

export function HubInvoices() {
  const settings = useSalesSettings();
  const { data, isLoading } = useQuery<InvoiceRow[]>({ queryKey: ["/api/hub/invoices"], queryFn: async () => (await apiRequest("GET", "/api/hub/invoices")).data });
  const [tab, setTab] = useState<"all" | "unpaid" | "overdue" | "credit">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data ?? []).filter(r =>
      (tab === "all" || (tab === "unpaid" && r.outstanding > 0) || (tab === "overdue" && r.overdue) || (tab === "credit" && r.docKind === "credit_note")) &&
      (!t || r.number.toLowerCase().includes(t) || r.recipient?.name?.toLowerCase().includes(t) || (r.recipient?.gstin ?? "").toLowerCase().includes(t)));
  }, [data, tab, q]);
  const s = settings.data;
  const owed = (data ?? []).reduce((a, r) => a + r.outstanding, 0);
  const overdue = (data ?? []).filter(r => r.overdue);
  const irnPending = (data ?? []).filter(r => r.irnStatus === "pending_provider").length;

  return (
    <HubPage title="Invoices" subtitle={s?.registered ? "GST tax invoices to your customers, numbered in your own series." : "Bills of supply to your customers — without a GSTIN you charge no GST."}
      actions={<>
        {s && <Button variant="outline" onClick={() => setOpen(true)}>Invoice settings</Button>}
        <Link href="/partner/sales/invoices/new" className={`${linkBtn} bg-[hsl(174,72%,40%)] text-white hover:bg-[hsl(174,72%,35%)]`}>New invoice</Link>
      </>}>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Customers owe you" value={inr(owed)} />
        <Stat label="Overdue" value={inr(overdue.reduce((a, r) => a + r.outstanding, 0))} hint={`${overdue.length} invoice(s)`} />
        <Stat label="Issued this month" value={s ? (s.invoiceLimit ? `${s.invoicesThisMonth} / ${s.invoiceLimit}` : s.invoicesThisMonth) : "—"} hint={s?.invoiceLimit ? "Starter plan limit — Pro is unlimited" : undefined} />
        <Stat label="Need an IRN" value={irnPending} hint={irnPending ? "Generate on the IRP portal, then record it" : "e-invoice above ₹5 crore"} />
      </div>
      <Panel actions={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1" role="tablist">{([["all", "All"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["credit", "Credit notes"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? "bg-white/10 text-white" : "text-[hsl(215,20%,65%)] hover:text-white"}`}>{l}</button>
          ))}</div>
          <Input aria-label="Search invoices" placeholder="Number, customer, GSTIN…" className="h-9 w-64" value={q} onChange={e => setQ(e.target.value)} />
        </div>}>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !rows.length ? (
          <Empty icon="receipt" title={data?.length ? "Nothing matches" : "No invoices yet"}>{data?.length ? null : "Issue one directly, or from an accepted quotation."}</Empty>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
            <Thead cols={["Number", "Customer", "Date", ["Total", "right"], ["Outstanding", "right"], "Due"]} />
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{rows.map(r => (
              <tr key={r.id}>
                <td className="py-2 pr-2"><Link href={`/partner/sales/invoices/${r.id}`} className="font-mono text-[hsl(174,72%,60%)] hover:text-white">{r.number}</Link>
                  <div className="mt-0.5 flex gap-1">{r.docKind !== "tax_invoice" && <Chip tone={r.docKind === "credit_note" ? "info" : "muted"}>{KIND[r.docKind]}</Chip>}{r.irnStatus === "pending_provider" && <Chip tone="warn">IRN needed</Chip>}</div></td>
                <td className="pr-2 text-white">{r.recipient?.name}{r.recipient?.gstin && <span className="block font-mono text-[11px] text-[hsl(215,20%,55%)]">{r.recipient.gstin}</span>}</td>
                <td className="pr-2 text-[hsl(215,20%,70%)]">{new Date(r.issuedAt).toLocaleDateString("en-IN")}</td>
                <td className="pr-2 text-right tabular-nums">{r.docKind === "credit_note" ? "−" : ""}{inr(r.total)}</td>
                <td className="pr-2 text-right tabular-nums">{r.docKind === "credit_note" ? "" : r.outstanding > 0 ? <span className={r.overdue ? "text-rose-300" : "text-amber-300"}>{inr(r.outstanding)}</span> : <Chip tone="good">paid</Chip>}</td>
                <td className={`text-xs ${r.overdue ? "text-rose-300" : "text-[hsl(215,20%,60%)]"}`}>{r.dueDate ? new Date(r.dueDate).toLocaleDateString("en-IN") : "—"}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
      {s && <SettingsDialog open={open} onOpenChange={setOpen} s={s} />}
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// New invoice / new quotation / revise quotation — one editor
// ═══════════════════════════════════════════════════════════════════════════

function CustomerPicker({ value, onChange }: { value: number | null; onChange: (id: number) => void }) {
  const list = useCustomers();
  const [open, setOpen] = useState(false);
  const picked = list.data?.find(c => c.id === value) ?? null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[260px] flex-1">
        <Label htmlFor="doc-customer">Customer</Label>
        <HubSelect id="doc-customer" className="w-full" value={value ? String(value) : ""} onChange={v => v && onChange(Number(v))}>
          <option value="">Choose a customer…</option>
          {(list.data ?? []).map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}{c.gstin ? ` · ${c.gstin}` : ""}</option>)}
        </HubSelect>
      </div>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>New customer</Button>
      {picked && <p className="w-full text-xs text-[hsl(215,20%,60%)]">{picked.gstin ? `Registered (B2B) · ${picked.stateName}` : `Unregistered · ${picked.stateName ?? "state as your business"}`}</p>}
      <CustomerDialog open={open} onOpenChange={setOpen} editing={null} onSaved={(c: Customer) => onChange(c.id)} />
    </div>
  );
}

function DocEditor({ mode }: { mode: "invoice" | "quotation" | "revise" }) {
  const [, navigate] = useLocation();
  const [, rp] = useRoute("/partner/sales/quotations/:id/edit");
  const reviseId = mode === "revise" ? Number(rp?.id) : null;
  const qc = useQueryClient();
  const { toast } = useToast();
  const settings = useSalesSettings();
  const existing = useQuery<Quote>({ queryKey: ["/api/hub/quotations", reviseId], queryFn: async () => (await apiRequest("GET", `/api/hub/quotations/${reviseId}`)).data, enabled: !!reviseId });
  const initialCustomer = Number(new URLSearchParams(window.location.search).get("customer")) || null;
  const [customerId, setCustomerId] = useState<number | null>(initialCustomer);
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [date, setDate] = useState(mode === "invoice" ? plusDays(15) : plusDays(30));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const q = existing.data;
    if (!q) return;
    setCustomerId(q.customerId);
    setLines(q.lines.map(l => ({ description: l.description, hsnSac: l.hsnSac ?? "", quantity: String(l.quantity), unit: l.unit ?? "", rateRupees: String(l.ratePaise / 100), gstRate: String(l.gstRate) })));
    setDate(q.validUntil ?? plusDays(30)); setNotes(q.notes ?? "");
  }, [existing.data]);
  const s = settings.data;
  const registered = !!s?.registered;

  const submit = async () => {
    if (!customerId) return toast({ title: "Choose a customer", variant: "destructive" });
    setSaving(true);
    try {
      const payload = linesToPayload(lines, registered);
      let r: any;
      if (mode === "invoice") {
        r = await apiRequest("POST", "/api/hub/invoices", { customerId, lines: payload, dueDate: date || null, notes: notes || null });
        qc.invalidateQueries({ queryKey: ["/api/hub/invoices"] }); qc.invalidateQueries({ queryKey: ["/api/hub/sales/settings"] });
        toast({ title: "Issued", description: r.message });
        navigate(`/partner/sales/invoices/${r.data.id}`);
      } else if (mode === "quotation") {
        r = await apiRequest("POST", "/api/hub/quotations", { customerId, lines: payload, validUntil: date || null, notes: notes || null });
        qc.invalidateQueries({ queryKey: ["/api/hub/quotations"] });
        toast({ title: "Saved", description: r.message });
        navigate(`/partner/sales/quotations/${r.data.id}`);
      } else {
        r = await apiRequest("PUT", `/api/hub/quotations/${reviseId}`, { lines: payload, validUntil: date || null, notes: notes || null });
        qc.invalidateQueries({ queryKey: ["/api/hub/quotations"] });
        toast({ title: "Saved", description: r.message });
        navigate(`/partner/sales/quotations/${r.data.id}`);
      }
      qc.invalidateQueries({ queryKey: ["/api/hub/customers"] });
    } catch (e) { toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }); } finally { setSaving(false); }
  };

  const title = mode === "invoice" ? (registered ? "New tax invoice" : "New bill of supply") : mode === "quotation" ? "New quotation" : `Revise ${existing.data?.number ?? "quotation"}`;
  const atLimit = mode === "invoice" && !!s?.invoiceLimit && s.invoicesThisMonth >= s.invoiceLimit;
  return (
    <HubPage title={title} subtitle={mode === "invoice" ? "Once issued, an invoice cannot be edited — correct it with a credit note." : mode === "revise" && existing.data?.status !== "draft" ? "This quotation has been sent, so your changes are saved as a new version; the old one is kept." : "A quotation is not a tax document. Turn it into an invoice when the customer accepts."}
      actions={<Link href={mode === "invoice" ? "/partner/sales/invoices" : "/partner/sales/quotations"} className="self-center text-sm text-[hsl(174,72%,60%)] hover:text-white">← Back</Link>}>
      {atLimit && <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">You have issued {s!.invoicesThisMonth} invoices this month — the Starter plan's limit. Ask UniteFix to move you to Pro for unlimited invoicing.</div>}
      <Panel>
        <div className="space-y-5">
          {mode === "revise" ? <p className="text-sm">Customer: <span className="text-white">{existing.data?.customerName}</span></p> : <CustomerPicker value={customerId} onChange={setCustomerId} />}
          <LineEditor lines={lines} onChange={setLines} registered={registered} rates={s?.gstRates ?? [0, 5, 18]} />
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <div><Label htmlFor="doc-date">{mode === "invoice" ? "Payment due" : "Valid until"}</Label><Input id="doc-date" type="date" min={today()} value={date} onChange={e => setDate(e.target.value)} /></div>
            <div><Label htmlFor="doc-notes">Notes on the document</Label><Input id="doc-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder={mode === "invoice" ? "e.g. Job card 1042" : "e.g. Includes installation"} /></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={submit} disabled={saving || atLimit || (mode !== "revise" && !customerId)}>{saving ? "Saving…" : mode === "invoice" ? "Issue invoice" : "Save quotation"}</Button>
          </div>
        </div>
      </Panel>
    </HubPage>
  );
}

export const HubInvoiceNew = () => <DocEditor mode="invoice" />;
export const HubQuotationNew = () => <DocEditor mode="quotation" />;
export const HubQuotationRevise = () => <DocEditor mode="revise" />;

// ═══════════════════════════════════════════════════════════════════════════
// Invoice detail — payments, credit notes, IRN
// ═══════════════════════════════════════════════════════════════════════════

type InvoiceDetail = InvoiceRow & {
  lines: Array<{ lineNo: number; description: string; hsnSac: string | null; quantity: number; unit: string | null; rate: number; taxable: number; gstRate: number; tax: number; total: number }>;
  payments: Array<{ id: number; amount: number; method: string; reference: string | null; receivedOn: string; notes: string | null }>;
  creditNotes: Array<{ id: number; number: string; total: number; issuedAt: string; notes: string | null }>;
};

export function HubInvoiceDetail() {
  const [, params] = useRoute("/partner/sales/invoices/:id");
  const id = Number(params?.id);
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: d, isLoading } = useQuery<InvoiceDetail>({ queryKey: ["/api/hub/invoices", id], queryFn: async () => (await apiRequest("GET", `/api/hub/invoices/${id}`)).data, enabled: !!id });
  const [payOpen, setPayOpen] = useState(false);
  const [cnOpen, setCnOpen] = useState(false);
  const [pay, setPay] = useState({ amountRupees: "", method: "upi", reference: "", receivedOn: today() });
  const [cn, setCn] = useState<{ reason: string; qty: Record<number, string> }>({ reason: "", qty: {} });
  const [irn, setIrn] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/hub/invoices"] }); qc.invalidateQueries({ queryKey: ["/api/hub/customers"] }); };
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });

  if (isLoading || !d) return <HubPage title="Invoice"><p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p></HubPage>;
  const isCn = d.docKind === "credit_note";

  const recordPayment = async () => {
    try { await apiRequest("POST", `/api/hub/invoices/${id}/payments`, { ...pay, amountRupees: Number(pay.amountRupees), reference: pay.reference || null }); refresh(); setPayOpen(false); toast({ title: "Payment recorded" }); }
    catch (e) { fail("Not recorded")(e); }
  };
  const issueCn = async () => {
    try {
      const r: any = await apiRequest("POST", `/api/hub/invoices/${id}/credit-note`, { reason: cn.reason, lines: Object.entries(cn.qty).map(([lineNo, q]) => ({ lineNo: Number(lineNo), quantity: Number(q) || 0 })).filter(l => l.quantity > 0) });
      refresh(); setCnOpen(false); setCn({ reason: "", qty: {} }); toast({ title: "Credit note issued", description: r.message });
    } catch (e) { fail("Not issued")(e); }
  };
  const recordIrn = async () => {
    try { await apiRequest("POST", `/api/hub/invoices/${id}/irn`, { irn }); refresh(); setIrn(""); toast({ title: "IRN recorded" }); } catch (e) { fail("Not recorded")(e); }
  };

  return (
    <HubPage title={`${KIND[d.docKind] ?? "Document"} ${d.number}`} subtitle={`${d.recipient?.name}${d.recipient?.gstin ? ` · ${d.recipient.gstin}` : ""} · ${new Date(d.issuedAt).toLocaleDateString("en-IN")}${d.placeOfSupply ? ` · place of supply ${d.placeOfSupply}` : ""}`}
      actions={<>
        <Link href="/partner/sales/invoices" className="self-center text-sm text-[hsl(174,72%,60%)] hover:text-white">← Invoices</Link>
        <Button variant="outline" onClick={() => openAuthedPdf(`/api/hub/tax-documents/${d.id}/pdf`).catch(fail("Could not open"))}>PDF</Button>
        {!isCn && d.outstanding > 0 && <Button variant="outline" onClick={() => { setPay({ ...pay, amountRupees: String(d.outstanding) }); setPayOpen(true); }}>Record payment</Button>}
        {!isCn && d.outstanding >= 1 && <PayLinkButton kind="invoice" refId={d.id} size="default" />}
        {!isCn && d.total - d.credited > 0 && <Button variant="ghost" onClick={() => setCnOpen(true)}>Credit note</Button>}
      </>}>
      {!isCn && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Stat label="Total" value={inr(d.total)} />
          <Stat label="Paid" value={inr(d.paid)} />
          <Stat label="Credited" value={inr(d.credited)} />
          <Stat label="Outstanding" value={inr(d.outstanding)} hint={d.dueDate ? `${d.overdue ? "was due" : "due"} ${new Date(d.dueDate).toLocaleDateString("en-IN")}` : undefined} />
        </div>
      )}
      {d.irnStatus === "pending_provider" && hubCan(me, "gst:manage") && (
        <Panel title="e-Invoice (IRN) needed">
          <p className="text-sm text-[hsl(215,20%,70%)]">Your turnover is above ₹5 crore, so this B2B invoice must be registered on the Invoice Registration Portal. UniteFix has not connected an e-invoice provider yet: generate the IRN on einvoice1.gst.gov.in and record it here.</p>
          <div className="mt-3 flex flex-wrap gap-2"><Input aria-label="IRN" className="h-9 max-w-xl font-mono" placeholder="64-character IRN" value={irn} onChange={e => setIrn(e.target.value.trim())} /><Button onClick={recordIrn} disabled={irn.length !== 64}>Record IRN</Button></div>
        </Panel>
      )}
      {d.irn && <p className="text-xs text-[hsl(215,20%,60%)]">IRN <span className="font-mono">{d.irn}</span></p>}
      <Panel title="Lines">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <Thead cols={["#", "Item", "HSN/SAC", ["Qty", "right"], ["Rate", "right"], ["Value", "right"], ["GST", "right"], ["Total", "right"]]} />
          <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{d.lines.map(l => (
            <tr key={l.lineNo}><td className="py-2 pr-2 text-[hsl(215,20%,60%)]">{l.lineNo}</td><td className="pr-2 text-white">{l.description}</td><td className="pr-2 font-mono text-xs">{l.hsnSac ?? "—"}</td>
              <td className="pr-2 text-right tabular-nums">{l.quantity}{l.unit ? ` ${l.unit}` : ""}</td><td className="pr-2 text-right tabular-nums">{inr(l.rate)}</td><td className="pr-2 text-right tabular-nums">{inr(l.taxable)}</td>
              <td className="pr-2 text-right tabular-nums">{inr(l.tax)} <span className="text-[11px] text-[hsl(215,20%,55%)]">{l.gstRate}%</span></td><td className="text-right tabular-nums text-white">{inr(l.total)}</td></tr>
          ))}</tbody>
        </table></div>
        <p className="mt-3 text-right text-sm">{d.igst ? `IGST ${inr(d.igst)}` : `CGST ${inr(d.cgst)} · SGST ${inr(d.sgst)}`} · <span className="font-semibold text-white">Total {inr(d.total)}</span></p>
        {d.notes && <p className="mt-2 text-xs text-[hsl(215,20%,60%)]">{d.notes}</p>}
      </Panel>
      {!isCn && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Payments received">
            {!d.payments.length ? <p className="text-sm text-[hsl(215,20%,60%)]">None yet.</p> : (
              <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">{d.payments.map(p => (
                <li key={p.id} className="flex items-center gap-3 py-2"><span className="tabular-nums text-white">{inr(p.amount)}</span><Chip>{p.method}</Chip><span className="text-xs text-[hsl(215,20%,60%)]">{p.reference}</span><span className="ml-auto text-xs text-[hsl(215,20%,60%)]">{new Date(p.receivedOn).toLocaleDateString("en-IN")}</span></li>
              ))}</ul>
            )}
          </Panel>
          <Panel title="Credit notes">
            {!d.creditNotes.length ? <p className="text-sm text-[hsl(215,20%,60%)]">None.</p> : (
              <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">{d.creditNotes.map(c => (
                <li key={c.id} className="flex items-center gap-3 py-2"><Link href={`/partner/sales/invoices/${c.id}`} className="font-mono text-[hsl(174,72%,60%)] hover:text-white">{c.number}</Link><span className="ml-auto tabular-nums">−{inr(c.total)}</span></li>
              ))}</ul>
            )}
          </Panel>
        </div>
      )}

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record a payment</DialogTitle><DialogDescription>Money the customer paid you directly. {inr(d.outstanding)} is outstanding.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="p-amt">Amount ₹</Label><Input id="p-amt" inputMode="decimal" value={pay.amountRupees} onChange={e => setPay({ ...pay, amountRupees: e.target.value })} /></div>
            <div><Label htmlFor="p-method">Method</Label><HubSelect id="p-method" className="w-full" value={pay.method} onChange={v => setPay({ ...pay, method: v })}>{["upi", "cash", "bank", "card", "cheque", "other"].map(m => <option key={m} value={m}>{m.toUpperCase() === "UPI" ? "UPI" : m[0].toUpperCase() + m.slice(1)}</option>)}</HubSelect></div>
            <div><Label htmlFor="p-ref">Reference</Label><Input id="p-ref" placeholder="UTR / cheque no." value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} /></div>
            <div><Label htmlFor="p-date">Received on</Label><Input id="p-date" type="date" max={today()} value={pay.receivedOn} onChange={e => setPay({ ...pay, receivedOn: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button><Button onClick={recordPayment} disabled={!(Number(pay.amountRupees) > 0)}>Record</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cnOpen} onOpenChange={setCnOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Issue a credit note</DialogTitle><DialogDescription>For returns, discounts after the sale or mistakes. Choose how much of each line to credit.</DialogDescription></DialogHeader>
          <div className="space-y-2">
            {d.lines.map(l => (
              <div key={l.lineNo} className="flex items-center gap-3 text-sm">
                <span className="flex-1 text-white">{l.description} <span className="text-xs text-[hsl(215,20%,55%)]">({l.quantity} × {inr(l.rate)})</span></span>
                <Input aria-label={`Quantity to credit for line ${l.lineNo}`} className="h-8 w-24" inputMode="decimal" placeholder="0" value={cn.qty[l.lineNo] ?? ""} onChange={e => setCn({ ...cn, qty: { ...cn.qty, [l.lineNo]: e.target.value } })} />
              </div>
            ))}
            <div><Label htmlFor="cn-reason">Reason (printed on the note)</Label><Input id="cn-reason" value={cn.reason} onChange={e => setCn({ ...cn, reason: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCnOpen(false)}>Cancel</Button><Button onClick={issueCn} disabled={cn.reason.trim().length < 3 || !Object.values(cn.qty).some(v => Number(v) > 0)}>Issue credit note</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Quotations
// ═══════════════════════════════════════════════════════════════════════════

export function HubQuotations() {
  const { data, isLoading } = useQuery<Quote[]>({ queryKey: ["/api/hub/quotations"], queryFn: async () => (await apiRequest("GET", "/api/hub/quotations")).data });
  const [showOld, setShowOld] = useState(false);
  const [q, setQ] = useState("");
  const rows = (data ?? []).filter(r => (showOld || r.status !== "superseded") && (!q.trim() || `${r.number} ${r.customerName}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <HubPage title="Quotations" subtitle="Price a job before you do it. Sent quotations are never overwritten — revising one makes a new version."
      actions={<Link href="/partner/sales/quotations/new" className={`${linkBtn} bg-[hsl(174,72%,40%)] text-white hover:bg-[hsl(174,72%,35%)]`}>New quotation</Link>}>
      <Panel actions={<div className="flex w-full flex-wrap items-center justify-end gap-3">
        <label className="flex items-center gap-2 text-xs text-[hsl(215,20%,65%)]"><input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} /> Show earlier versions</label>
        <Input aria-label="Search quotations" placeholder="Number or customer…" className="h-9 w-56" value={q} onChange={e => setQ(e.target.value)} />
      </div>}>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !rows.length ? <Empty icon="request_quote" title="No quotations" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-sm">
            <Thead cols={["Number", "Customer", "Status", "Valid until", ["Total", "right"]]} />
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{rows.map(r => (
              <tr key={r.id}>
                <td className="py-2 pr-2"><Link href={`/partner/sales/quotations/${r.id}`} className="font-mono text-[hsl(174,72%,60%)] hover:text-white">{r.number}{r.version > 1 ? ` v${r.version}` : ""}</Link></td>
                <td className="pr-2 text-white">{r.customerName}</td>
                <td className="pr-2"><Chip tone={Q_TONE[r.status]}>{r.status}</Chip></td>
                <td className="pr-2 text-[hsl(215,20%,70%)]">{r.validUntil ? new Date(r.validUntil).toLocaleDateString("en-IN") : "—"}</td>
                <td className="text-right tabular-nums">{inr(r.total)}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
    </HubPage>
  );
}

export function HubQuotationDetail() {
  const [, params] = useRoute("/partner/sales/quotations/:id");
  const id = Number(params?.id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: q, isLoading } = useQuery<Quote & { history: Quote[] }>({ queryKey: ["/api/hub/quotations", id], queryFn: async () => (await apiRequest("GET", `/api/hub/quotations/${id}`)).data, enabled: !!id });
  const [due, setDue] = useState(plusDays(15));
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
  if (isLoading || !q) return <HubPage title="Quotation"><p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p></HubPage>;
  const status = async (s: string) => {
    try { await apiRequest("POST", `/api/hub/quotations/${id}/status`, { status: s }); qc.invalidateQueries({ queryKey: ["/api/hub/quotations"] }); } catch (e) { fail("Not changed")(e); }
  };
  const invoice = async () => {
    try {
      const r: any = await apiRequest("POST", `/api/hub/quotations/${id}/invoice`, { dueDate: due });
      qc.invalidateQueries({ queryKey: ["/api/hub/quotations"] }); qc.invalidateQueries({ queryKey: ["/api/hub/invoices"] });
      toast({ title: "Invoiced", description: r.message }); navigate(`/partner/sales/invoices/${r.data.id}`);
    } catch (e) { fail("Not invoiced")(e); }
  };
  const open = !["invoiced", "superseded", "declined", "expired"].includes(q.status);
  return (
    <HubPage title={`Quotation ${q.number}${q.version > 1 ? ` v${q.version}` : ""}`} subtitle={`${q.customerName} · ${new Date(q.createdAt).toLocaleDateString("en-IN")}${q.validUntil ? ` · valid until ${new Date(q.validUntil).toLocaleDateString("en-IN")}` : ""}`}
      actions={<>
        <Link href="/partner/sales/quotations" className="self-center text-sm text-[hsl(174,72%,60%)] hover:text-white">← Quotations</Link>
        <Button variant="outline" onClick={() => openAuthedPdf(`/api/hub/quotations/${id}/pdf`).catch(fail("Could not open"))}>PDF</Button>
        {open && <Link href={`/partner/sales/quotations/${id}/edit`} className={`${linkBtn} border border-[rgba(255,255,255,0.15)] text-white hover:bg-white/5`}>Revise</Link>}
      </>}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={Q_TONE[q.status]}>{q.status}</Chip>
        {q.status === "draft" && <Button size="sm" variant="outline" onClick={() => status("sent")}>Mark sent</Button>}
        {(q.status === "draft" || q.status === "sent") && <Button size="sm" variant="outline" onClick={() => status("accepted")}>Customer accepted</Button>}
        {open && <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => status("declined")}>Declined</Button>}
        {q.invoiceDocumentId && <Link href={`/partner/sales/invoices/${q.invoiceDocumentId}`} className="text-sm text-[hsl(174,72%,60%)] hover:text-white">View invoice →</Link>}
      </div>
      <Panel title="Lines">
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
          <Thead cols={["Item", "HSN/SAC", ["Qty", "right"], ["Rate", "right"], ["GST", "right"], ["Value", "right"]]} />
          <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{q.lines.map((l, i) => (
            <tr key={i}><td className="py-2 pr-2 text-white">{l.description}</td><td className="pr-2 font-mono text-xs">{l.hsnSac ?? "—"}</td><td className="pr-2 text-right">{l.quantity}{l.unit ? ` ${l.unit}` : ""}</td>
              <td className="pr-2 text-right tabular-nums">{inr(l.ratePaise / 100)}</td><td className="pr-2 text-right">{l.gstRate}%</td><td className="text-right tabular-nums">{inr(l.taxablePaise / 100)}</td></tr>
          ))}</tbody>
        </table></div>
        <p className="mt-3 text-right text-sm">Value {inr(q.taxable)} · GST {inr(q.tax)} · <span className="font-semibold text-white">Total {inr(q.total)}</span></p>
        {(q.notes || q.terms) && <p className="mt-2 text-xs text-[hsl(215,20%,60%)]">{[q.notes, q.terms].filter(Boolean).join(" · ")}</p>}
      </Panel>
      {open && (
        <Panel title="Turn into an invoice">
          <div className="flex flex-wrap items-end gap-3">
            <div><Label htmlFor="q-due">Payment due</Label><Input id="q-due" type="date" min={today()} value={due} onChange={e => setDue(e.target.value)} /></div>
            <Button onClick={invoice}>Issue invoice for {inr(q.total)}</Button>
          </div>
          <p className="mt-2 text-xs text-[hsl(215,20%,55%)]">GST is worked out again at issue from the customer's state; the invoice may differ slightly if the customer's details changed.</p>
        </Panel>
      )}
      {q.history.length > 1 && (
        <Panel title="Versions">
          <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">{q.history.map(h => (
            <li key={h.id} className="flex items-center gap-3 py-2">
              <Link href={`/partner/sales/quotations/${h.id}`} className={`font-mono ${h.id === q.id ? "text-white" : "text-[hsl(174,72%,60%)] hover:text-white"}`}>v{h.version}</Link>
              <Chip tone={Q_TONE[h.status]}>{h.status}</Chip><span className="ml-auto tabular-nums">{inr(h.total)}</span>
            </li>
          ))}</ul>
        </Panel>
      )}
    </HubPage>
  );
}
