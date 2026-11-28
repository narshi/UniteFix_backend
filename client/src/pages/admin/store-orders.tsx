/**
 * Store orders: staff fulfil UniteFix's own sales (confirm, pack, book
 * India Post or dispatch with any courier's tracking id, mark delivered) and decide their
 * returns. Partners' orders are listed read-only: partners fulfil them in
 * their Hub. Every step issues the GST document that belongs to it.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, FileText, Truck, PackageCheck, CheckCircle2, XCircle, RotateCcw, Mail, Printer, Settings2 } from "lucide-react";
import { IndiaPostBookDialog, ParcelTrail, TRACKING_TONE, TRACKING_WORD } from "@/components/store/IndiaPost";
import ShippingSetup from "@/components/store/ShippingSetup";

type Order = {
  id: number; code: string; status: string; statusLabel: string; createdAt: string; total: number; tax: number; seller: string; soldByUnitefix: boolean;
  shipTo: { name: string | null; phone: string | null; address: string | null; pincode: string | null };
  shipment: { courier: string | null; trackingId: string | null; status?: string | null; statusLabel?: string | null } | null;
  refund: { amount: number; status: string | null } | null;
  cancel: { by: string | null; reason: string | null } | null;
  return: { windowDays: number; until: string | null; status: string | null; reason: string | null };
  documents: Array<{ id: number; number: string; kind: string }>;
  items: Array<{ id: number; name: string; quantity: number; price: number; total: number; kind: string }>;
  timeline?: Array<{ status: string; label: string; at: string; note: string | null }>;
};
type Page = { items: Order[]; page: number; hasMore: boolean; counts: { toShip: number; returns: number } };
type Act = { order: Order; kind: "dispatch" | "cancel" | "reject" } | null;

const panel = "rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]";
const field = "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white";
const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-sky-400/50 bg-sky-500/20 text-white" : "border-white/10 text-slate-400 hover:text-white"}`;
const TONE: Record<string, string> = {
  placed: "bg-sky-500/15 text-sky-300", confirmed: "bg-sky-500/15 text-sky-300", packed: "bg-indigo-500/15 text-indigo-300",
  dispatched: "bg-violet-500/15 text-violet-300", delivered: "bg-emerald-500/15 text-emerald-300", cancelled: "bg-rose-500/15 text-rose-300", returned: "bg-amber-500/15 text-amber-300",
};
const DOC: Record<string, string> = { tax_invoice: "Invoice", credit_note: "Credit note", receipt_voucher: "Receipt voucher", refund_voucher: "Refund voucher" };
const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default function StoreOrdersPage() {
  const { toast } = useToast();
  const [scope, setScope] = useState<"unitefix" | "partners">("unitefix");
  const [status, setStatus] = useState<string>("to_ship");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [act, setAct] = useState<Act>(null);
  const [courier, setCourier] = useState("India Post (Speed Post)");
  const [tracking, setTracking] = useState("");
  const [reason, setReason] = useState("");
  const [book, setBook] = useState<{ id: number; code: string } | null>(null);
  const [setup, setSetup] = useState(false);

  const key = ["/api/admin/store/orders", scope, status, search];
  const { data, isLoading } = useQuery<Page>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/admin/store/orders?scope=${scope}&status=${status}&search=${encodeURIComponent(search)}`)).data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/store/orders"] });

  const move = useMutation({
    mutationFn: async (v: { id: number; to: string; courier?: string; trackingId?: string; reason?: string }) => apiRequest("POST", `/api/admin/store/orders/${v.id}/transition`, v),
    onSuccess: (r: any) => { toast({ title: r?.message ?? "Done" }); setAct(null); refresh(); },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const decide = useMutation({
    mutationFn: async (v: { id: number; decision: "approve" | "reject" | "received"; note?: string }) => apiRequest("POST", `/api/admin/store/orders/${v.id}/return`, v),
    onSuccess: (r: any) => { toast({ title: r?.message ?? "Done" }); setAct(null); refresh(); },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const openDoc = async (orderId: number, docId: number) => {
    try {
      const res = await fetch(`/api/admin/store/orders/${orderId}/documents/${docId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("adminToken") ?? ""}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch { toast({ title: "Could not open the document", variant: "destructive" }); }
  };
  const openLabel = async (orderId: number) => {
    try {
      const res = await fetch(`/api/admin/store/orders/${orderId}/label.pdf`, { headers: { Authorization: `Bearer ${localStorage.getItem("adminToken") ?? ""}` } });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as any)?.message ?? `${res.status}`);
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch (e) { toast({ title: "No label", description: e instanceof Error ? e.message : undefined, variant: "destructive" }); }
  };

  const ours = scope === "unitefix";
  const orders = data?.items ?? [];

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold text-white">Store orders</h1>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setSetup(!setup)}><Settings2 className="mr-1 h-4 w-4" />{setup ? "Hide shipping setup" : "Shipping setup"}</Button></div>
        <p className="max-w-3xl text-sm text-slate-400">
          UniteFix's own sales: confirm, book India Post (or dispatch with another courier's tracking number), and mark delivered. India Post parcels move by themselves: shipped when India Post takes them (the tax invoice is issued then), delivered when India Post delivers. A received return issues the credit note and refunds the customer.
        </p>
      </header>
      {setup && <ShippingSetup />}

      <div className="flex flex-wrap items-center gap-2">
        <button className={chip(ours)} onClick={() => { setScope("unitefix"); setStatus("to_ship"); }}>UniteFix orders</button>
        <button className={chip(!ours)} onClick={() => { setScope("partners"); setStatus(""); }}>Partner orders (view only)</button>
        <span className="mx-2 h-5 w-px bg-white/10" />
        {ours && <button className={chip(status === "to_ship")} onClick={() => setStatus("to_ship")}>To ship{data ? ` (${data.counts.toShip})` : ""}</button>}
        {ours && <button className={chip(status === "returns")} onClick={() => setStatus("returns")}>Returns{data ? ` (${data.counts.returns})` : ""}</button>}
        <button className={chip(status === "dispatched")} onClick={() => setStatus("dispatched")}>Shipped</button>
        <button className={chip(status === "")} onClick={() => setStatus("")}>All</button>
        <form className="ml-auto flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order, name, phone, tracking" className={`${field} w-64 pl-8`} />
          </div>
        </form>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {!isLoading && orders.length === 0 && <div className={`${panel} p-8 text-center text-sm text-slate-400`}>No orders here.</div>}

      <div className="space-y-3">
        {orders.map((o) => (
          <div key={o.id} className={`${panel} p-4`}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-white">{o.code}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[o.status] ?? "bg-white/10 text-slate-300"}`}>{o.statusLabel}</span>
                  {o.return.status && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">Return {o.return.status}</span>}
                  {!ours && <span className="text-xs text-slate-500">· {o.seller}</span>}
                  <span className="text-xs text-slate-500">· {when(o.createdAt)}</span>
                </div>
                <p className="text-sm text-slate-300">{o.shipTo.name} · {o.shipTo.phone}</p>
                <p className="text-xs text-slate-500">{o.shipTo.address}</p>
                <ul className="pt-1 text-sm text-slate-300">
                  {o.items.map((i) => <li key={i.id}>{i.quantity} × {i.name} <span className="text-slate-500">· {inr(i.total)}</span></li>)}
                </ul>
                {o.shipment && <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400"><Truck className="h-3.5 w-3.5" />{o.shipment.courier} · <span className="font-mono">{o.shipment.trackingId}</span>
                  {o.shipment.status && <span className={`rounded-full px-2 py-0.5 ${TRACKING_TONE[o.shipment.status] ?? "bg-white/10 text-slate-300"}`}>{TRACKING_WORD[o.shipment.status] ?? o.shipment.status}</span>}
                  {o.shipment.status && <ParcelTrail base="/api/admin/store/orders" orderId={o.id} />}</div>}
                {o.return.reason && <p className="text-xs text-amber-300/90">Return reason: "{o.return.reason}"</p>}
                {o.cancel?.reason && <p className="text-xs text-rose-300/90">Cancelled by {o.cancel.by}: {o.cancel.reason}</p>}
                {o.refund && <p className="text-xs text-emerald-300/90">Refund {inr(o.refund.amount)}: {o.refund.status}</p>}
                {o.documents.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {o.documents.map((d) => (
                      <button key={d.id} onClick={() => openDoc(o.id, d.id)} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:text-white">
                        <FileText className="h-3.5 w-3.5" />{DOC[d.kind] ?? d.kind} {d.number}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold text-white">{inr(o.total)}</p>
                <p className="text-xs text-slate-500">incl. GST {inr(o.tax)}</p>
              </div>
            </div>

            {ours && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
                {o.status === "placed" && <Button size="sm" onClick={() => move.mutate({ id: o.id, to: "confirmed" })} disabled={move.isPending}><CheckCircle2 className="mr-1 h-4 w-4" />Confirm</Button>}
                {o.status === "confirmed" && <Button size="sm" variant="outline" onClick={() => move.mutate({ id: o.id, to: "packed" })} disabled={move.isPending}><PackageCheck className="mr-1 h-4 w-4" />Packed</Button>}
                {["confirmed", "packed"].includes(o.status) && !o.shipment?.trackingId && <Button size="sm" onClick={() => setBook({ id: o.id, code: o.code })}><Mail className="mr-1 h-4 w-4" />Book India Post</Button>}
                {["confirmed", "packed"].includes(o.status) && <Button size="sm" variant="outline" onClick={() => { setTracking(o.shipment?.trackingId ?? ""); if (o.shipment?.courier) setCourier(o.shipment.courier); setAct({ order: o, kind: "dispatch" }); }}><Truck className="mr-1 h-4 w-4" />{o.shipment?.trackingId ? "Mark shipped now" : "Other courier"}</Button>}
                {["confirmed", "packed", "dispatched"].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => openLabel(o.id)}><Printer className="mr-1 h-4 w-4" />Label</Button>}
                {o.status === "dispatched" && <Button size="sm" onClick={() => move.mutate({ id: o.id, to: "delivered" })} disabled={move.isPending}><CheckCircle2 className="mr-1 h-4 w-4" />Mark delivered</Button>}
                {["placed", "confirmed", "packed"].includes(o.status) && <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => { setReason(""); setAct({ order: o, kind: "cancel" }); }}><XCircle className="mr-1 h-4 w-4" />Cancel and refund</Button>}
                {o.return.status === "requested" && <Button size="sm" onClick={() => decide.mutate({ id: o.id, decision: "approve" })} disabled={decide.isPending}><RotateCcw className="mr-1 h-4 w-4" />Approve return</Button>}
                {o.return.status === "requested" && <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => { setReason(""); setAct({ order: o, kind: "reject" }); }}>Reject return</Button>}
                {o.return.status === "approved" && <Button size="sm" onClick={() => decide.mutate({ id: o.id, decision: "received" })} disabled={decide.isPending}><PackageCheck className="mr-1 h-4 w-4" />Item received: refund</Button>}
              </div>
            )}
          </div>
        ))}
      </div>

      <IndiaPostBookDialog base="/api/admin/store/orders" order={book} onClose={() => setBook(null)} onBooked={refresh} contentClassName="glass-panel border-[rgba(255,255,255,0.1)] text-white max-w-md" />

      <Dialog open={!!act} onOpenChange={(v) => !v && setAct(null)}>
        <DialogContent className="glass-panel border-[rgba(255,255,255,0.1)]">
          <DialogHeader>
            <DialogTitle className="text-white">
              {act?.kind === "dispatch" ? `Dispatch ${act.order.code}` : act?.kind === "cancel" ? `Cancel ${act?.order.code}` : `Reject the return of ${act?.order.code}`}
            </DialogTitle>
          </DialogHeader>
          {act?.kind === "dispatch" ? (
            <div className="space-y-3">
              <div><Label className="text-slate-300">Courier</Label><Input value={courier} onChange={(e) => setCourier(e.target.value)} className={field} /></div>
              <div>
                <Label className="text-slate-300">Tracking / article number</Label>
                <Input value={tracking} onChange={(e) => setTracking(e.target.value.toUpperCase())} placeholder="EE123456789IN" className={`${field} font-mono`} />
                <p className="mt-1 text-xs text-slate-500">A Speed Post article number is 13 characters, like EE123456789IN. Dispatching issues the GST invoice to the customer.</p>
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-slate-300">{act?.kind === "cancel" ? "Reason (the customer sees it)" : "Why (the customer sees it)"}</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAct(null)}>Back</Button>
            {act?.kind === "dispatch" && <Button disabled={!courier.trim() || tracking.trim().length < 5 || move.isPending} onClick={() => move.mutate({ id: act.order.id, to: "dispatched", courier: courier.trim(), trackingId: tracking.trim() })}>Dispatch and issue invoice</Button>}
            {act?.kind === "cancel" && <Button variant="destructive" disabled={reason.trim().length < 3 || move.isPending} onClick={() => move.mutate({ id: act.order.id, to: "cancelled", reason: reason.trim() })}>Cancel and refund {inr(act.order.total)}</Button>}
            {act?.kind === "reject" && <Button variant="destructive" disabled={reason.trim().length < 3 || decide.isPending} onClick={() => decide.mutate({ id: act.order.id, decision: "reject", note: reason.trim() })}>Reject return</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
