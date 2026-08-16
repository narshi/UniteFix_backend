/**
 * Manual Bill — counter sales for in-house visits.
 *
 * A walk-in brings a device to the shop: pick or create the customer, add lines,
 * issue a UF/25-26/NNNN invoice. No booking, no technician, no state machine.
 *
 * A walk-in who isn't in the system gets a real customer account from their name
 * and phone — which is deliberate, not a workaround: they can sign in with that
 * number later and find this invoice in the app.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  useTableQuery, DataToolbar, DataPagination, SortableHeader,
} from "@/components/admin/table";
import { Plus, Trash2, Receipt, UserPlus, Search, Download, Check } from "lucide-react";
import { downloadAdminFile } from "@/lib/admin-auth";
import { format } from "date-fns";

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

interface CustomerHit {
  id: number;
  username: string | null;
  phone: string | null;
  email: string | null;
}

const emptyLine = (): LineItem => ({ description: "", quantity: "1", unitPrice: "" });
const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ManualBillPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("");
  const [issued, setIssued] = useState<{ invoiceId: string; invoiceRowId: number; total: number } | null>(null);

  // Customer: either an existing account, or a new walk-in.
  const [customerSearch, setCustomerSearch] = useState("");
  const [picked, setPicked] = useState<CustomerHit | null>(null);
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");

  const { data: gstConfig } = useQuery<any>({ queryKey: ["/api/config/public"] });
  const gstPercent = gstConfig?.data?.gstRate ?? 18;

  const { data: customerHits } = useQuery<{ data: CustomerHit[] }>({
    queryKey: [`/api/admin/manual-bills/customers?q=${encodeURIComponent(customerSearch)}`],
    enabled: customerSearch.trim().length >= 2 && !picked,
  });

  const historyQuery = useTableQuery("/api/admin/manual-bills", { defaultSort: "createdAt", defaultLimit: 10 });
  const { data: history } = useQuery<any>({ queryKey: [historyQuery.key] });

  // Mirrors the server's arithmetic so the preview and the issued invoice agree.
  const totals = useMemo(() => {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const subtotal = round2(lines.reduce((sum, l) => {
      const q = Number(l.quantity) || 0;
      const p = Number(l.unitPrice) || 0;
      return sum + q * p;
    }, 0));
    const disc = round2(Math.max(0, Number(discount) || 0));
    const taxable = round2(Math.max(0, subtotal - disc));
    const gst = round2((taxable * gstPercent) / 100);
    return { subtotal, discount: disc, taxable, gst, total: round2(taxable + gst) };
  }, [lines, discount, gstPercent]);

  const validLines = lines.filter(
    (l) => l.description.trim() && Number(l.quantity) > 0 && l.unitPrice !== "" && Number(l.unitPrice) >= 0,
  );
  const hasCustomer = !!picked || (walkInName.trim() && walkInPhone.replace(/\D/g, "").length === 10);
  const canIssue = hasCustomer && validLines.length > 0 && totals.total > 0;

  const createBill = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/admin/manual-bills", {
        userId: picked?.id,
        customerName: picked ? undefined : walkInName.trim(),
        customerPhone: picked ? undefined : walkInPhone,
        items: validLines.map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
        })),
        discount: Number(discount) || 0,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (r: any) => {
      const d = r?.data ?? {};
      setIssued({ invoiceId: d.invoiceId, invoiceRowId: d.invoiceRowId, total: d.total });
      toast({ title: "Invoice created", description: r?.message });
      queryClient.invalidateQueries({ queryKey: [historyQuery.key] });
    },
    onError: (e: any) => toast({ title: "Could not create bill", description: e.message, variant: "destructive" }),
  });

  const startNewBill = () => {
    setLines([emptyLine()]);
    setNotes("");
    setDiscount("");
    setPicked(null);
    setCustomerSearch("");
    setWalkInName("");
    setWalkInPhone("");
    setIssued(null);
  };

  const updateLine = (i: number, patch: Partial<LineItem>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const rows = history?.data ?? [];

  // ── Issued confirmation ────────────────────────────────────────────────
  if (issued) {
    return (
      <div className="flex-1 p-4 sm:p-6 xl:p-8 min-h-screen flex items-center justify-center">
        <Card className="glass-card border-[hsla(160,84%,39%,0.25)] max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-[hsla(160,84%,39%,0.15)] border border-[hsla(160,84%,39%,0.3)] flex items-center justify-center mx-auto">
              <Check className="w-7 h-7 text-[hsl(160,84%,60%)]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Invoice issued</h2>
              <p className="font-mono text-lg text-[hsl(160,84%,65%)] mt-2">{issued.invoiceId}</p>
              <p className="text-sm text-[hsl(215,20%,65%)] mt-1">{money(issued.total)}</p>
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1 border-[rgba(255,255,255,0.1)] text-[hsl(210,20%,85%)]"
                onClick={() => downloadAdminFile(`/api/admin/invoices/${issued.invoiceRowId}/pdf`, `${issued.invoiceId}.pdf`).catch((e) => toast({ title: "Download failed", description: e.message, variant: "destructive" }))}
              >
                <Download className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
              <Button className="flex-1 bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white" onClick={startNewBill}>
                New bill
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden bg-transparent">
      <div className="mb-8 relative z-10 stagger-enter">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]">
          Manual Bill
        </h1>
        <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide mt-1">
          Counter sales for in-house visits — no booking, no technician assignment.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 relative z-10">
        <Card className="glass-card border-[rgba(255,255,255,0.08)] xl:col-span-2 stagger-enter">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">New bill</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {/* Customer */}
            <div className="space-y-2">
              <Label className="text-[hsl(210,20%,80%)]">Customer</Label>
              {picked ? (
                <div className="flex items-center justify-between rounded-xl border border-[hsla(160,84%,39%,0.25)] bg-[hsla(160,84%,39%,0.06)] px-4 py-3">
                  <div>
                    <p className="text-white font-medium">{picked.username ?? `#${picked.id}`}</p>
                    <p className="text-xs text-[hsl(215,20%,65%)]">{picked.phone}{picked.email ? ` · ${picked.email}` : ""}</p>
                  </div>
                  <Button size="sm" variant="ghost" className="text-[hsl(215,20%,65%)] hover:text-white" onClick={() => { setPicked(null); setCustomerSearch(""); }}>
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-[hsl(215,20%,50%)]" />
                    <Input
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Search existing customer by name, phone or email…"
                      className="pl-9 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
                    />
                  </div>

                  {(customerHits?.data?.length ?? 0) > 0 && (
                    <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] divide-y divide-[rgba(255,255,255,0.05)] max-h-44 overflow-y-auto custom-scrollbar">
                      {customerHits!.data.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { setPicked(c); setCustomerSearch(""); }}
                          className="w-full text-left px-4 py-2.5 hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                        >
                          <p className="text-sm text-white">{c.username ?? `#${c.id}`}</p>
                          <p className="text-xs text-[hsl(215,20%,60%)]">{c.phone}</p>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-1">
                    <span className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
                    <span className="text-xs text-[hsl(215,20%,50%)]">or new walk-in</span>
                    <span className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      value={walkInName}
                      onChange={(e) => setWalkInName(e.target.value)}
                      placeholder="Customer name"
                      className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
                    />
                    <Input
                      value={walkInPhone}
                      onChange={(e) => setWalkInPhone(e.target.value)}
                      placeholder="10-digit phone"
                      inputMode="numeric"
                      className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
                    />
                  </div>
                  <p className="text-xs text-[hsl(215,20%,55%)] flex items-center gap-1.5">
                    <UserPlus className="w-3 h-3 shrink-0" />
                    Creates a customer account, so they can sign in with this number and see the invoice.
                  </p>
                </>
              )}
            </div>

            {/* Lines */}
            <div className="space-y-2">
              <Label className="text-[hsl(210,20%,80%)]">Items</Label>
              <div className="space-y-2">
                {lines.map((line, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <Input
                      value={line.description}
                      onChange={(e) => updateLine(i, { description: e.target.value })}
                      placeholder="Service or part"
                      className="flex-1 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
                    />
                    <Input
                      value={line.quantity}
                      onChange={(e) => updateLine(i, { quantity: e.target.value })}
                      inputMode="decimal"
                      className="w-16 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white text-center"
                      aria-label="Quantity"
                    />
                    <Input
                      value={line.unitPrice}
                      onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="w-28 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white text-right"
                      aria-label="Unit price"
                    />
                    <div className="w-24 h-10 flex items-center justify-end text-sm text-[hsl(210,20%,80%)] tabular-nums shrink-0">
                      {money((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={lines.length === 1}
                      onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                      className="h-10 w-9 shrink-0 text-[hsl(215,20%,60%)] hover:text-[hsl(347,77%,65%)] disabled:opacity-25"
                      aria-label="Remove line"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
                className="border-[rgba(255,255,255,0.1)] text-[hsl(210,20%,80%)] hover:bg-[rgba(255,255,255,0.05)] gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add line
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[hsl(210,20%,80%)]">Discount (₹)</Label>
                <Input
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[hsl(210,20%,80%)]">Notes (optional)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={1}
                  placeholder="Serial number, warranty note…"
                  className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white min-h-10"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <Card className="glass-card border-[rgba(255,255,255,0.08)] stagger-enter h-fit sticky top-6">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white flex items-center gap-2">
              <Receipt className="w-5 h-5 text-[hsl(217,91%,65%)]" /> Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            {[
              ["Subtotal", totals.subtotal],
              ...(totals.discount > 0 ? [["Discount", -totals.discount] as [string, number]] : []),
              ["Taxable", totals.taxable],
              [`GST @ ${gstPercent}%`, totals.gst],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between text-sm">
                <span className="text-[hsl(215,20%,65%)]">{label}</span>
                <span className="text-[hsl(210,20%,85%)] tabular-nums">{money(value as number)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-3 border-t border-[rgba(255,255,255,0.08)]">
              <span className="text-white font-semibold">Total</span>
              <span className="text-white font-bold text-lg tabular-nums">{money(totals.total)}</span>
            </div>
            <p className="text-xs text-[hsl(215,20%,50%)]">
              GST splits evenly into CGST {money(totals.gst / 2)} + SGST {money(totals.gst / 2)}.
            </p>

            <Button
              className="w-full mt-2 bg-[hsl(160,84%,39%)] hover:bg-[hsl(160,84%,34%)] text-white"
              disabled={!canIssue || createBill.isPending}
              onClick={() => createBill.mutate()}
            >
              {createBill.isPending ? "Creating…" : "Generate invoice"}
            </Button>
            {!canIssue && (
              <p className="text-xs text-[hsl(38,92%,65%)] text-center">
                {!hasCustomer ? "Pick or enter a customer" : "Add at least one priced line"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 mt-6 stagger-enter">
        <CardHeader className="flex flex-col gap-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
          <CardTitle className="text-xl text-white">Past manual bills</CardTitle>
          <DataToolbar query={historyQuery} searchPlaceholder="Invoice no, customer, phone…" />
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-[hsl(215,20%,65%)]">No manual bills yet.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full glass-table text-sm">
                  <thead>
                    <tr className="text-left border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                      <SortableHeader query={historyQuery} field="invoiceId">Invoice</SortableHeader>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Customer</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Items</th>
                      <SortableHeader query={historyQuery} field="totalAmount" align="right">Total</SortableHeader>
                      <SortableHeader query={historyQuery} field="createdAt">Date</SortableHeader>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider text-right">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any) => (
                      <tr key={r.id} className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.03)]">
                        <td className="p-4 font-mono text-[hsl(160,84%,65%)]">{r.invoiceId}</td>
                        <td className="p-4">
                          <p className="text-[hsl(210,20%,88%)]">{r.customerName ?? "—"}</p>
                          <p className="text-xs text-[hsl(215,20%,55%)]">{r.customerPhone}</p>
                        </td>
                        <td className="p-4">
                          <Badge variant="outline" className="border-[rgba(255,255,255,0.12)] text-[hsl(215,20%,75%)]">
                            {Array.isArray(r.items) ? r.items.length : 0} line{Array.isArray(r.items) && r.items.length === 1 ? "" : "s"}
                          </Badge>
                        </td>
                        <td className="p-4 text-right text-white tabular-nums">{money(Number(r.totalAmount))}</td>
                        <td className="p-4 text-[hsl(215,20%,65%)]">
                          {r.createdAt ? format(new Date(r.createdAt), "dd MMM yyyy, HH:mm") : "—"}
                        </td>
                        <td className="p-4 text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-[hsl(215,20%,65%)] hover:text-white"
                            onClick={() => downloadAdminFile(`/api/admin/invoices/${r.invoiceRowId}/pdf`, `${r.invoiceId}.pdf`).catch((e) => toast({ title: "Download failed", description: e.message, variant: "destructive" }))}
                            aria-label="Download PDF"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <DataPagination query={historyQuery} pagination={history?.pagination} rowCount={rows.length} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
