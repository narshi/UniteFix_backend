/**
 * Parts — order from UniteFix stock on the web: search, a cart, credit or
 * pay-now, and every order with its tracking and GST invoice.
 *
 * The same /api/b2b endpoints the app's partner mode uses. The quote comes
 * from the server for every change; the cart holds only part and quantity.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useHubMe, inr, openAuthedPdf, razorpayCheckout } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty } from "@/components/hub/ui";

type CatalogItem = { id: number; partCode: string; name: string; brand: string | null; specification: string | null; unit: string | null; tradePrice: number; gstPercent: number | null; availability: "in_stock" | "low" | "backorder" };
type Quote = { lines: Array<{ sparePartId: number; name: string; quantity: number; unitPrice: number; gst: number; lineTotal: number; backordered: boolean }>; subtotal: number; gst: number; total: number; backordered: string[] };
type OrderRow = { id: number; orderCode: string; status: string; paymentMode: string; paymentStatus: string; total: number; placedAt: string; tracking: { terminal: boolean; terminalLabel: string | null; steps: Array<{ key: string; label: string; done: boolean; current: boolean }> } };

const AVAIL: Record<string, [string, string]> = { in_stock: ["good", "In stock"], low: ["warn", "Few left"], backorder: ["muted", "Backorder"] };
const CART_KEY = "hub-parts-cart";

function useCart() {
  const [cart, setCart] = useState<Record<number, number>>(() => { try { return JSON.parse(localStorage.getItem(CART_KEY) || "{}"); } catch { return {}; } });
  useEffect(() => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* private mode */ } }, [cart]);
  const set = (id: number, q: number) => setCart(c => { const n = { ...c }; if (q <= 0) delete n[id]; else n[id] = Math.min(10_000, q); return n; });
  return { cart, set, clear: () => setCart({}) };
}

export function HubPartsCatalogue() {
  const { me } = useHubMe();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const { cart, set, clear } = useCart();
  const items = Object.entries(cart).map(([id, quantity]) => ({ sparePartId: Number(id), quantity }));

  const catalog = useQuery<CatalogItem[]>({ queryKey: ["/api/b2b/catalog", dq], queryFn: async () => (await apiRequest("GET", `/api/b2b/catalog?limit=100${dq ? `&q=${encodeURIComponent(dq)}` : ""}`)).data });
  const credit = useQuery<{ creditLimit: number; outstanding: number; creditAvailable: number; prepaidOnly: boolean }>({ queryKey: ["/api/b2b/ledger/summary"], queryFn: async () => (await apiRequest("GET", "/api/b2b/ledger/summary")).data });
  const quote = useQuery<Quote>({
    queryKey: ["/api/b2b/orders/quote", items],
    queryFn: async () => (await apiRequest("POST", "/api/b2b/orders/quote", { items })).data,
    enabled: items.length > 0, retry: false,
  });
  const creditOk = !!credit.data && !credit.data.prepaidOnly && !!quote.data && credit.data.creditAvailable >= quote.data.total;
  const [mode, setMode] = useState<"credit" | "prepaid">("prepaid");
  useEffect(() => { setMode(creditOk ? "credit" : "prepaid"); }, [creditOk]);
  const [notes, setNotes] = useState("");

  const place = useMutation({
    mutationFn: async () => {
      const r: any = await apiRequest("POST", "/api/b2b/orders", { items, paymentMode: mode, notes: notes.trim() || null });
      const order = r.data.order;
      if (mode === "prepaid" && r.data.razorpay) {
        try {
          const pay = await razorpayCheckout({ key: r.data.razorpay.keyId, orderId: r.data.razorpay.orderId, amountRupees: r.data.razorpay.amount, description: `Parts order ${order.orderCode}`, name: me?.business?.contactName ?? undefined, email: me?.business?.contactEmail ?? undefined, phone: me?.business?.contactPhone });
          await apiRequest("POST", `/api/b2b/orders/${order.id}/verify-payment`, pay);
          return { order, message: `Order ${order.orderCode} paid. UniteFix will confirm and dispatch it.` };
        } catch (e: any) {
          return { order, message: `Order ${order.orderCode} placed but not paid (${e?.message ?? "payment not completed"}). Pay from the order page.` };
        }
      }
      return { order, message: r.message };
    },
    onSuccess: (r) => { clear(); setNotes(""); qc.invalidateQueries({ queryKey: ["/api/b2b/orders"] }); qc.invalidateQueries({ queryKey: ["/api/b2b/ledger/summary"] }); toast({ title: "Order placed", description: r.message }); navigate(`/partner/parts/orders/${r.order.id}`); },
    onError: (e) => toast({ title: "Order not placed", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const count = items.reduce((a, i) => a + i.quantity, 0);

  return (
    <HubPage title="Order parts" subtitle="Trade prices from UniteFix stock. GST is added per line; you get a GST tax invoice when the order is dispatched."
      actions={<Link href="/partner/parts/orders" className="text-sm text-[hsl(174,72%,60%)] hover:text-white">My orders →</Link>}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title={<Input aria-label="Search parts" placeholder="Search name, part code or brand" value={q} onChange={e => setQ(e.target.value)} className="h-9 w-72 max-w-full" />}>
          {catalog.isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : (catalog.data ?? []).length === 0 ? <Empty icon="inventory_2" title={dq ? "Nothing matches" : "No parts for trade yet"} /> : (
            <ul className="divide-y divide-[rgba(255,255,255,0.06)]">
              {catalog.data!.map(p => {
                const qty = cart[p.id] ?? 0; const [tone, label] = AVAIL[p.availability] ?? AVAIL.backorder;
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-[220px] flex-1">
                      <p className="text-sm text-white">{p.name}{p.brand && <span className="text-[hsl(215,20%,60%)]"> · {p.brand}</span>}</p>
                      <p className="text-xs text-[hsl(215,20%,60%)]">{p.partCode}{p.specification ? ` · ${p.specification}` : ""}</p>
                    </div>
                    <Chip tone={tone}>{label}</Chip>
                    <p className="w-32 text-right text-sm text-white tabular-nums">{inr(p.tradePrice)}<span className="text-xs text-[hsl(215,20%,60%)]">/{p.unit || "unit"}</span><br /><span className="text-[10px] text-[hsl(215,20%,55%)]">+{p.gstPercent ?? 18}% GST</span></p>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="outline" className="h-8 w-8 p-0" aria-label={`One fewer ${p.name}`} onClick={() => set(p.id, qty - 1)} disabled={!qty}>−</Button>
                      <Input aria-label={`Quantity of ${p.name}`} className="h-8 w-14 text-center" inputMode="numeric" value={qty || ""} onChange={e => set(p.id, Number(e.target.value.replace(/\D/g, "")) || 0)} />
                      <Button size="sm" variant="outline" className="h-8 w-8 p-0" aria-label={`One more ${p.name}`} onClick={() => set(p.id, qty + 1)}>+</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title={`Cart · ${count} item${count === 1 ? "" : "s"}`} className="self-start lg:sticky lg:top-4">
          {items.length === 0 ? <p className="text-sm text-[hsl(215,20%,60%)]">Add parts with + to build an order.</p> : (
            <div className="space-y-3 text-sm">
              {quote.isError && <p className="text-rose-300">{apiErrorMessage(quote.error)}</p>}
              {quote.data?.lines.map(l => (
                <div key={l.sparePartId} className="flex justify-between gap-2"><span className="text-[hsl(210,20%,85%)]">{l.name} × {l.quantity}{l.backordered && <span className="text-amber-300"> · backorder</span>}</span><span className="tabular-nums text-white">{inr(l.lineTotal)}</span></div>
              ))}
              {quote.data && (
                <div className="border-t border-[rgba(255,255,255,0.08)] pt-2 space-y-1">
                  <div className="flex justify-between text-[hsl(215,20%,65%)]"><span>Subtotal</span><span className="tabular-nums">{inr(quote.data.subtotal)}</span></div>
                  <div className="flex justify-between text-[hsl(215,20%,65%)]"><span>GST</span><span className="tabular-nums">{inr(quote.data.gst)}</span></div>
                  <div className="flex justify-between font-semibold text-white"><span>Total</span><span className="tabular-nums">{inr(quote.data.total)}</span></div>
                </div>
              )}
              <fieldset className="space-y-2">
                <legend className="text-xs text-[hsl(215,20%,60%)]">Pay with</legend>
                <label className={`flex items-center gap-2 rounded-md border p-2 ${creditOk ? "border-[rgba(255,255,255,0.12)]" : "opacity-50 border-[rgba(255,255,255,0.06)]"}`}>
                  <input type="radio" name="pay-mode" checked={mode === "credit"} disabled={!creditOk} onChange={() => setMode("credit")} />
                  <span>UniteFix credit <span className="block text-xs text-[hsl(215,20%,60%)]">{credit.data?.prepaidOnly ? "No credit terms on this account" : `${inr(credit.data?.creditAvailable)} available`}</span></span>
                </label>
                <label className="flex items-center gap-2 rounded-md border border-[rgba(255,255,255,0.12)] p-2">
                  <input type="radio" name="pay-mode" checked={mode === "prepaid"} onChange={() => setMode("prepaid")} />
                  <span>Pay now <span className="block text-xs text-[hsl(215,20%,60%)]">UPI, card or netbanking</span></span>
                </label>
              </fieldset>
              <Textarea aria-label="Note for UniteFix" placeholder="Delivery note or PO number (optional)" value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} rows={2} />
              <Button className="w-full" onClick={() => place.mutate()} disabled={!quote.data || quote.isError || place.isPending}>{place.isPending ? "Placing…" : mode === "credit" ? "Place on credit" : "Place & pay"}</Button>
              <button type="button" className="w-full text-xs text-[hsl(215,20%,60%)] underline underline-offset-2" onClick={clear}>Empty cart</button>
            </div>
          )}
        </Panel>
      </div>
    </HubPage>
  );
}

function statusTone(o: OrderRow): [string, string] {
  if (o.tracking.terminal) return ["muted", o.tracking.terminalLabel ?? o.status];
  if (o.paymentMode === "prepaid" && o.paymentStatus !== "paid" && o.status === "placed") return ["warn", "Awaiting payment"];
  if (o.status === "delivered") return ["good", "Delivered"];
  return ["info", o.tracking.steps.find(s => s.current)?.label ?? o.status];
}

export function HubPartsOrders() {
  const { data = [], isLoading } = useQuery<OrderRow[]>({ queryKey: ["/api/b2b/orders"], queryFn: async () => (await apiRequest("GET", "/api/b2b/orders")).data });
  return (
    <HubPage title="Parts orders" actions={<Link href="/partner/parts" className="text-sm text-[hsl(174,72%,60%)] hover:text-white">Order parts →</Link>}>
      <Panel>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : data.length === 0 ? <Empty icon="local_shipping" title="No orders yet" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-[hsl(215,20%,55%)]"><th className="py-2">Order</th><th>Placed</th><th>Payment</th><th className="text-right">Total</th><th>Status</th></tr></thead>
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
              {data.map(o => { const [tone, label] = statusTone(o); return (
                <tr key={o.id}><td className="py-3"><Link href={`/partner/parts/orders/${o.id}`} className="font-mono text-[hsl(174,72%,60%)] hover:text-white">{o.orderCode}</Link></td>
                  <td className="text-[hsl(215,20%,70%)]">{new Date(o.placedAt).toLocaleDateString("en-IN")}</td>
                  <td className="text-[hsl(215,20%,70%)]">{o.paymentMode === "credit" ? "Credit" : "Prepaid"}</td>
                  <td className="text-right tabular-nums text-white">{inr(o.total)}</td>
                  <td><Chip tone={tone}>{label}</Chip></td></tr>
              ); })}
            </tbody></table></div>
        )}
      </Panel>
    </HubPage>
  );
}

export function HubPartsOrderDetail() {
  const [, params] = useRoute("/partner/parts/orders/:id");
  const id = Number(params?.id);
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: o, isLoading } = useQuery<any>({ queryKey: ["/api/b2b/orders", id], queryFn: async () => (await apiRequest("GET", `/api/b2b/orders/${id}`)).data, enabled: Number.isFinite(id) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/b2b/orders", id] }); qc.invalidateQueries({ queryKey: ["/api/b2b/orders"] }); };
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
  const [reason, setReason] = useState("");

  const pay = useMutation({
    mutationFn: async () => {
      const info: any = await apiRequest("GET", `/api/b2b/orders/${id}/payment`);
      const r = await razorpayCheckout({ key: info.data.keyId, orderId: info.data.orderId, amountRupees: info.data.amount, description: `Parts order ${o.orderCode}`, email: me?.business?.contactEmail ?? undefined, phone: me?.business?.contactPhone });
      return apiRequest("POST", `/api/b2b/orders/${id}/verify-payment`, r);
    },
    onSuccess: () => { refresh(); toast({ title: "Payment received" }); },
    onError: fail("Not paid"),
  });
  const cancel = useMutation({ mutationFn: async () => apiRequest("POST", `/api/b2b/orders/${id}/cancel`, { reason: "Cancelled by partner" }), onSuccess: (r: any) => { refresh(); toast({ title: r?.message ?? "Cancelled" }); }, onError: fail("Not cancelled") });
  const ret = useMutation({ mutationFn: async () => apiRequest("POST", `/api/b2b/orders/${id}/return`, { reason }), onSuccess: (r: any) => { refresh(); setReason(""); toast({ title: r?.message ?? "Return requested" }); }, onError: fail("Not requested") });

  if (isLoading || !o) return <HubPage title="Order"><p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p></HubPage>;
  const unpaid = o.paymentMode === "prepaid" && o.paymentStatus !== "paid" && o.status === "placed";

  return (
    <HubPage title={o.orderCode} subtitle={`Placed ${new Date(o.placedAt).toLocaleString("en-IN")} · ${o.paymentMode === "credit" ? "on credit" : "prepaid"}`}
      actions={<>
        {unpaid && <Button onClick={() => pay.mutate()} disabled={pay.isPending}>Pay {inr(o.total)}</Button>}
        {(o.status === "placed" || o.status === "paid") && <Button variant="outline" onClick={() => { if (window.confirm(`Cancel ${o.orderCode}?`)) cancel.mutate(); }}>Cancel order</Button>}
      </>}>
      <Panel title="Tracking">
        {o.tracking.terminal ? <p className="text-sm text-[hsl(215,20%,70%)]">{o.tracking.terminalLabel}{o.cancelReason ? ` — ${o.cancelReason}` : ""}</p> : (
          <ol className="flex flex-wrap gap-2">{o.tracking.steps.map((s: any) => <li key={s.key}><Chip tone={s.current ? "info" : s.done ? "good" : "muted"}>{s.label}</Chip></li>)}</ol>
        )}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Items">
          <ul className="divide-y divide-[rgba(255,255,255,0.06)] text-sm">
            {o.items.map((it: any) => <li key={it.id} className="flex justify-between gap-3 py-2"><span className="text-white">{it.name} <span className="text-[hsl(215,20%,60%)]">· {it.partCode} · {inr(it.unitPrice)} × {it.quantity}</span></span><span className="tabular-nums text-white">{inr(it.lineTotal)}</span></li>)}
          </ul>
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between text-[hsl(215,20%,65%)]"><span>Subtotal</span><span>{inr(o.subtotal)}</span></div>
            <div className="flex justify-between text-[hsl(215,20%,65%)]"><span>GST</span><span>{inr(o.gst)}</span></div>
            <div className="flex justify-between font-semibold text-white"><span>Total</span><span>{inr(o.total)}</span></div>
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel title="GST documents">
            {(o.documents ?? []).length === 0 ? <p className="text-sm text-[hsl(215,20%,60%)]">The tax invoice is issued when the order is dispatched.</p> : (
              <ul className="space-y-2">{o.documents.map((d: any) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-white">{d.kind === "credit_note" ? "Credit note" : "Tax invoice"} <span className="font-mono text-[hsl(215,20%,65%)]">{d.number}</span></span>
                  <Button size="sm" variant="outline" onClick={() => openAuthedPdf(`/api/hub/tax-documents/${d.id}/pdf`).catch(fail("Could not open"))}>PDF</Button>
                </li>
              ))}</ul>
            )}
          </Panel>
          {o.status === "delivered" && (
            <Panel title="Problem with the delivery?">
              <Textarea aria-label="What is wrong" placeholder="Wrong item, damaged, short quantity…" value={reason} onChange={e => setReason(e.target.value)} rows={3} />
              <Button className="mt-2 w-full" variant="outline" disabled={reason.trim().length < 5 || ret.isPending} onClick={() => ret.mutate()}>Request return</Button>
            </Panel>
          )}
          <Panel title="History">
            <ul className="space-y-2 text-xs">{[...(o.events ?? [])].reverse().map((e: any) => (
              <li key={e.id} className="flex justify-between gap-2"><span className="text-[hsl(210,20%,85%)]">{e.type.replace(/_/g, " ")}{e.payload?.taxInvoice ? ` · ${e.payload.taxInvoice}` : ""}{e.payload?.courier ? ` · ${e.payload.courier}` : ""}{e.payload?.trackingId ? ` ${e.payload.trackingId}` : ""}</span><span className="text-[hsl(215,20%,55%)]">{new Date(e.at).toLocaleString("en-IN")}</span></li>
            ))}</ul>
          </Panel>
        </div>
      </div>
    </HubPage>
  );
}
