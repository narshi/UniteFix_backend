/**
 * Customers — the business's own customer book. A GST-registered customer's
 * state comes from its GSTIN (that decides CGST+SGST vs IGST); for others it
 * is chosen. Broadband partners can bring their subscribers in once.
 */

import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useHubMe, hubCan, hubHas, inr } from "@/lib/hub";
import { GST_STATES } from "@shared/hub";
import { HubPage, Panel, Chip, Empty, HubSelect, Thead } from "@/components/hub/ui";

export type Customer = {
  id: number; name: string; phone: string | null; email: string | null; gstin: string | null; stateCode: string | null; stateName: string | null;
  address: string | null; pincode: string | null; tags: string[]; notes: string | null; archived: boolean; fromBroadband: boolean; outstanding?: number;
};

const blank = { name: "", phone: "", email: "", gstin: "", stateCode: "", address: "", pincode: "", tags: "", notes: "" };

export function CustomerDialog({ open, onOpenChange, editing, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; editing: Customer | null; onSaved?: (c: Customer) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(editing ? { name: editing.name, phone: editing.phone ?? "", email: editing.email ?? "", gstin: editing.gstin ?? "", stateCode: editing.stateCode ?? "", address: editing.address ?? "", pincode: editing.pincode ?? "", tags: editing.tags.join(", "), notes: editing.notes ?? "" } : blank);
  }, [open, editing]);
  const save = async () => {
    setSaving(true);
    try {
      const body = { name: f.name, phone: f.phone || null, email: f.email || null, gstin: f.gstin || null, stateCode: f.gstin ? undefined : (f.stateCode || null), address: f.address || null, pincode: f.pincode || null, tags: f.tags.split(",").map(t => t.trim()).filter(Boolean), notes: f.notes || null };
      const r: any = editing ? await apiRequest("PATCH", `/api/hub/customers/${editing.id}`, body) : await apiRequest("POST", "/api/hub/customers", body);
      qc.invalidateQueries({ queryKey: ["/api/hub/customers"] });
      if (editing) qc.invalidateQueries({ queryKey: ["/api/hub/customers", editing.id] });
      toast({ title: editing ? "Saved" : "Customer added" });
      onOpenChange(false);
      onSaved?.(r.data);
    } catch (e) { toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? "Edit customer" : "Add a customer"}</DialogTitle><DialogDescription>A business customer with a GSTIN gets a B2B invoice and can claim the GST you charge.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor="c-name">Name</Label><Input id="c-name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
          <div><Label htmlFor="c-phone">Mobile</Label><Input id="c-phone" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></div>
          <div><Label htmlFor="c-email">Email</Label><Input id="c-email" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
          <div><Label htmlFor="c-gstin">GSTIN (business customers)</Label><Input id="c-gstin" maxLength={15} value={f.gstin} onChange={e => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></div>
          <div><Label htmlFor="c-state">State</Label>
            <HubSelect id="c-state" className="w-full" value={f.gstin ? f.gstin.slice(0, 2) : f.stateCode} onChange={v => setF({ ...f, stateCode: v })} disabled={!!f.gstin}>
              <option value="">Same as my business</option>
              {Object.entries(GST_STATES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </HubSelect>
          </div>
          <div className="sm:col-span-2"><Label htmlFor="c-addr">Address</Label><Input id="c-addr" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></div>
          <div><Label htmlFor="c-pin">Pincode</Label><Input id="c-pin" inputMode="numeric" maxLength={6} value={f.pincode} onChange={e => setF({ ...f, pincode: e.target.value.replace(/\D/g, "") })} /></div>
          <div><Label htmlFor="c-tags">Tags</Label><Input id="c-tags" placeholder="amc, corporate" value={f.tags} onChange={e => setF({ ...f, tags: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label htmlFor="c-notes">Notes</Label><Textarea id="c-notes" rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !f.name.trim()}>{saving ? "Saving…" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useCustomers(q = "", archived = false) {
  return useQuery<Customer[]>({ queryKey: ["/api/hub/customers", q, archived], queryFn: async () => (await apiRequest("GET", `/api/hub/customers?${new URLSearchParams({ ...(q ? { q } : {}), ...(archived ? { archived: "1" } : {}) })}`)).data });
}

export default function HubCustomers() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const [archived, setArchived] = useState(false);
  const list = useCustomers(dq, archived);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [importing, setImporting] = useState(false);
  const sales = hubCan(me, "sales:manage");

  const importBroadband = async () => {
    setImporting(true);
    try { const r: any = await apiRequest("POST", "/api/hub/customers/import-broadband"); qc.invalidateQueries({ queryKey: ["/api/hub/customers"] }); toast({ title: "Subscribers imported", description: r.message }); }
    catch (e) { toast({ title: "Not imported", description: apiErrorMessage(e), variant: "destructive" }); } finally { setImporting(false); }
  };

  return (
    <HubPage title="Customers" subtitle="Everyone you sell to. Invoices, quotations and what each customer owes are kept against them."
      actions={<>
        {hubHas(me, "broadband") && <Button variant="outline" disabled={importing} onClick={importBroadband}>{importing ? "Importing…" : "Import broadband subscribers"}</Button>}
        <Button onClick={() => { setEditing(null); setOpen(true); }}>Add customer</Button>
      </>}>
      <Panel title={<span>{list.data?.length ?? 0} customers</span>} actions={
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[hsl(215,20%,65%)]"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Show archived</label>
          <Input aria-label="Search customers" placeholder="Name, phone, email, GSTIN…" className="h-9 w-64" value={q} onChange={e => setQ(e.target.value)} />
        </div>}>
        {list.isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !list.data?.length ? (
          <Empty icon="people" title={dq ? "No customer matches" : "No customers yet"}>{dq ? null : "Add your first customer, then raise a quotation or an invoice."}</Empty>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <Thead cols={["Customer", "Contact", "State", ...(sales ? [["Owes you", "right"] as [string, "right"]] : []), ""]} />
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{list.data.map(c => (
              <tr key={c.id}>
                <td className="py-2 pr-2">
                  <Link href={`/partner/customers/${c.id}`} className="font-medium text-[hsl(174,72%,60%)] hover:text-white">{c.name}</Link>
                  <div className="mt-0.5 flex flex-wrap gap-1">{c.gstin && <Chip tone="info">B2B · {c.gstin}</Chip>}{c.fromBroadband && <Chip>broadband</Chip>}{c.archived && <Chip tone="warn">archived</Chip>}{c.tags.filter(t => t !== "broadband").map(t => <Chip key={t}>{t}</Chip>)}</div>
                </td>
                <td className="pr-2 text-[hsl(215,20%,70%)]">{c.phone ?? "—"}{c.email && <span className="block text-xs">{c.email}</span>}</td>
                <td className="pr-2 text-[hsl(215,20%,70%)]">{c.stateName ?? "—"}</td>
                {sales && <td className={`pr-2 text-right tabular-nums ${c.outstanding ? "text-amber-300" : "text-[hsl(215,20%,60%)]"}`}>{c.outstanding ? inr(c.outstanding) : "—"}</td>}
                <td className="text-right"><Button size="sm" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }}>Edit</Button></td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
      <CustomerDialog open={open} onOpenChange={setOpen} editing={editing} />
    </HubPage>
  );
}

type CustomerDetail = {
  customer: Customer;
  invoices: Array<{ id: number; number: string; docKind: string; issuedAt: string; total: number; outstanding: number; overdue: boolean; dueDate: string | null }>;
  quotations: Array<{ id: number; number: string; version: number; status: string; total: number; createdAt: string }>;
};

export function HubCustomerDetail() {
  const [, params] = useRoute("/partner/customers/:id");
  const id = Number(params?.id);
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<CustomerDetail>({ queryKey: ["/api/hub/customers", id], queryFn: async () => (await apiRequest("GET", `/api/hub/customers/${id}`)).data, enabled: !!id });
  const [open, setOpen] = useState(false);
  const sales = hubCan(me, "sales:manage");
  if (isLoading || !data) return <HubPage title="Customer"><p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p></HubPage>;
  const c = data.customer;
  const archive = async () => {
    try { await apiRequest("PATCH", `/api/hub/customers/${c.id}`, { archived: !c.archived }); qc.invalidateQueries({ queryKey: ["/api/hub/customers"] }); }
    catch (e) { toast({ title: "Not changed", description: apiErrorMessage(e), variant: "destructive" }); }
  };
  return (
    <HubPage title={c.name} subtitle={[c.gstin ? `GSTIN ${c.gstin}` : "Unregistered", c.stateName, c.phone].filter(Boolean).join(" · ")}
      actions={<>
        <Link href="/partner/customers" className="self-center text-sm text-[hsl(174,72%,60%)] hover:text-white">← Customers</Link>
        <Button variant="outline" onClick={() => setOpen(true)}>Edit</Button>
        <Button variant="ghost" onClick={archive}>{c.archived ? "Restore" : "Archive"}</Button>
        {sales && <Link href={`/partner/sales/quotations/new?customer=${c.id}`} className="inline-flex h-9 items-center rounded-md border border-[rgba(255,255,255,0.15)] px-3 text-sm text-white hover:bg-white/5">New quotation</Link>}
        {sales && <Link href={`/partner/sales/invoices/new?customer=${c.id}`} className="inline-flex h-9 items-center rounded-md bg-[hsl(174,72%,40%)] px-3 text-sm font-medium text-white hover:bg-[hsl(174,72%,35%)]">New invoice</Link>}
      </>}>
      {sales && (
        <>
          <Panel title={`Invoices · ${inr(c.outstanding ?? 0)} outstanding`}>
            {!data.invoices.length ? <Empty icon="receipt" title="No invoices yet" /> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
                <Thead cols={["Number", "Date", ["Total", "right"], ["Outstanding", "right"], ""]} />
                <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{data.invoices.map(i => (
                  <tr key={i.id}>
                    <td className="py-2"><Link href={`/partner/sales/invoices/${i.id}`} className="font-mono text-[hsl(174,72%,60%)] hover:text-white">{i.number}</Link> {i.docKind === "credit_note" && <Chip tone="info">credit note</Chip>}</td>
                    <td className="text-[hsl(215,20%,70%)]">{new Date(i.issuedAt).toLocaleDateString("en-IN")}</td>
                    <td className="text-right tabular-nums">{i.docKind === "credit_note" ? "−" : ""}{inr(i.total)}</td>
                    <td className="text-right tabular-nums">{i.docKind === "credit_note" ? "" : i.outstanding ? <span className={i.overdue ? "text-rose-300" : "text-amber-300"}>{inr(i.outstanding)}</span> : <Chip tone="good">paid</Chip>}</td>
                    <td className="text-right text-xs text-rose-300">{i.overdue ? "overdue" : ""}</td>
                  </tr>
                ))}</tbody></table></div>
            )}
          </Panel>
          <Panel title="Quotations">
            {!data.quotations.length ? <Empty icon="request_quote" title="No quotations yet" /> : (
              <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">{data.quotations.map(q => (
                <li key={q.id} className="flex items-center gap-3 py-2">
                  <Link href={`/partner/sales/quotations/${q.id}`} className="font-mono text-[hsl(174,72%,60%)] hover:text-white">{q.number}{q.version > 1 ? ` v${q.version}` : ""}</Link>
                  <Chip tone={q.status === "accepted" || q.status === "invoiced" ? "good" : q.status === "declined" || q.status === "expired" ? "bad" : "muted"}>{q.status}</Chip>
                  <span className="ml-auto tabular-nums">{inr(q.total)}</span>
                </li>
              ))}</ul>
            )}
          </Panel>
        </>
      )}
      <Panel title="Details">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-[hsl(215,20%,55%)]">Email</dt><dd>{c.email ?? "—"}</dd></div>
          <div><dt className="text-xs text-[hsl(215,20%,55%)]">Address</dt><dd>{[c.address, c.pincode].filter(Boolean).join(", ") || "—"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-[hsl(215,20%,55%)]">Notes</dt><dd className="whitespace-pre-wrap">{c.notes ?? "—"}</dd></div>
        </dl>
      </Panel>
      <CustomerDialog open={open} onOpenChange={setOpen} editing={c} />
    </HubPage>
  );
}
