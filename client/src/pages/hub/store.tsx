/**
 * Store — a partner selling its own products through the UniteFix store.
 * Listings (with the compliance fields the law asks for), orders to ship,
 * returns, reviews, and the seller's score and tier.
 */

import { useMemo, useRef, useState } from "react";
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

type Listing = {
  id: number; name: string; description: string | null; categoryId: number | null; categoryName: string | null; price: number; mrp: number | null; stock: number;
  hsnCode: string | null; gstPercent: number | null; countryOfOrigin: string | null; manufacturer: string | null; netQuantity: string | null; returnWindowDays: number;
  warrantyMonths: number | null; warrantyBy: string | null; bisNumber: string | null; wpcEta: string | null; images: string[]; sellerSku: string | null; status: string; rejectionReason: string | null;
};
type Overview = {
  gaps: string[]; metrics: { score: number; tier: string; ratingAvg: number | null; ratingCount: number; onTimeDispatch: number; sellerCancelRate: number; returnRate: number; deliveredOrders: number };
  profile: { grievanceName: string | null; grievancePhone: string | null; grievanceEmail: string | null; returnPolicy: string | null; gstin: string | null; tier: string };
};
type Order = {
  id: number; code: string; status: string; total: number; net: number; commission: number; tcs: number; tds: number; shipName: string | null; shipPhone: string | null; shipAddress: string | null; shipPincode: string | null;
  courier: string | null; trackingId: string | null; createdAt: string; dispatchBy: string | null; late: boolean; returnStatus: string | null; returnReason: string | null; settleAfter: string | null; settledAt: string | null;
  items: Array<{ id: number; name: string; quantity: number; price: number }>;
  gatewayFee: number; penalty: number; penaltyReason: string | null; penaltyWaived: boolean; lateCharge: number; shipmentRef: string | null;
};

const S_TONE: Record<string, string> = { live: "good", pending_review: "warn", draft: "muted", rejected: "bad", paused: "muted" };
const O_TONE: Record<string, string> = { placed: "warn", confirmed: "info", packed: "info", dispatched: "info", delivered: "good", cancelled: "muted", returned: "bad" };
const NEXT: Record<string, [string, string][]> = { placed: [["confirmed", "Confirm"]], confirmed: [["packed", "Packed"], ["dispatched", "Dispatch"]], packed: [["dispatched", "Dispatch"]], dispatched: [["delivered", "Delivered"]] };
const fail = (toast: any, t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
const when = (d: string | null) => d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
const blank = { name: "", description: "", categoryId: "", priceRupees: "", mrpRupees: "", stock: "0", hsnCode: "", gstPercent: "18", countryOfOrigin: "India", manufacturer: "", netQuantity: "1 unit", returnWindowDays: "7", warrantyMonths: "", warrantyBy: "manufacturer", bisNumber: "", wpcEta: "", sellerSku: "" };

export function HubStoreListings() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const ov = useQuery<Overview>({ queryKey: ["/api/hub/store/overview"], queryFn: async () => (await apiRequest("GET", "/api/hub/store/overview")).data });
  const { data, isLoading } = useQuery<Listing[]>({ queryKey: ["/api/hub/store/listings"], queryFn: async () => (await apiRequest("GET", "/api/hub/store/listings")).data });
  const cats = useQuery<Array<{ id: number; name: string }>>({ queryKey: ["/api/hub/store/categories"], queryFn: async () => (await apiRequest("GET", "/api/hub/store/categories")).data });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Listing | null>(null);
  const [f, setF] = useState(blank);
  const [prof, setProf] = useState<Overview["profile"] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [imgFor, setImgFor] = useState<number | null>(null);
  const manage = hubCan(me, "sales:manage");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/hub/store/listings"] }); qc.invalidateQueries({ queryKey: ["/api/hub/store/overview"] }); };
  const p = prof ?? ov.data?.profile ?? null;

  const edit = (l: Listing | null) => {
    setEditing(l);
    setF(l ? { name: l.name, description: l.description ?? "", categoryId: String(l.categoryId ?? ""), priceRupees: String(l.price), mrpRupees: String(l.mrp ?? ""), stock: String(l.stock ?? 0), hsnCode: l.hsnCode ?? "", gstPercent: String(l.gstPercent ?? 18), countryOfOrigin: l.countryOfOrigin ?? "", manufacturer: l.manufacturer ?? "", netQuantity: l.netQuantity ?? "", returnWindowDays: String(l.returnWindowDays), warrantyMonths: l.warrantyMonths == null ? "" : String(l.warrantyMonths), warrantyBy: l.warrantyBy ?? "manufacturer", bisNumber: l.bisNumber ?? "", wpcEta: l.wpcEta ?? "", sellerSku: l.sellerSku ?? "" } : blank);
    setOpen(true);
  };
  const save = async () => {
    const body: Record<string, unknown> = {
      name: f.name, description: f.description || null, categoryId: Number(f.categoryId), priceRupees: Number(f.priceRupees), mrpRupees: Number(f.mrpRupees), stock: Number(f.stock),
      hsnCode: f.hsnCode, gstPercent: Number(f.gstPercent), countryOfOrigin: f.countryOfOrigin, manufacturer: f.manufacturer, netQuantity: f.netQuantity || null,
      returnWindowDays: Number(f.returnWindowDays), warrantyMonths: f.warrantyMonths ? Number(f.warrantyMonths) : null, warrantyBy: f.warrantyBy || null,
      bisNumber: f.bisNumber || null, wpcEta: f.wpcEta || null, sellerSku: f.sellerSku || null,
    };
    try { const r: any = await apiRequest(editing ? "PATCH" : "POST", editing ? `/api/hub/store/listings/${editing.id}` : "/api/hub/store/listings", body); refresh(); setOpen(false); toast({ title: "Saved", description: r.message }); }
    catch (e) { fail(toast, "Not saved")(e); }
  };
  const act = async (l: Listing, a: "submit" | "pause") => { try { const r: any = await apiRequest("POST", `/api/hub/store/listings/${l.id}/${a}`, {}); refresh(); toast({ title: r.message }); } catch (e) { fail(toast, "Not done")(e); } };
  const saveProfile = async () => { try { await apiRequest("PUT", "/api/hub/store/profile", { grievanceName: p?.grievanceName ?? "", grievancePhone: p?.grievancePhone ?? "", grievanceEmail: p?.grievanceEmail ?? "", returnPolicy: p?.returnPolicy ?? "" }); setProf(null); refresh(); toast({ title: "Seller details saved" }); } catch (e) { fail(toast, "Not saved")(e); } };
  const upload = async (file: File) => {
    if (!imgFor) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await fetch(`/api/hub/store/listings/${imgFor}/images`, { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("adminToken") ?? ""}` }, body: fd });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      refresh(); toast({ title: "Image added" });
    } catch (e) { fail(toast, "Upload failed")(e); } finally { setImgFor(null); if (fileRef.current) fileRef.current.value = ""; }
  };
  const m = ov.data?.metrics;

  return (
    <HubPage title="Store listings" subtitle="Sell your products in the UniteFix store. You ship; UniteFix collects payment and settles to you after the return window, less commission, GST TCS and TDS."
      actions={manage ? <Button onClick={() => edit(null)}>New listing</Button> : undefined}>
      <div role="note" className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200">The UniteFix app's Shop is not open to customers yet. Prepare your listings now; they go on sale when the store opens.</div>
      {m && <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Seller tier" value={<span className="capitalize">{ov.data!.profile.tier}</span>} hint={ov.data!.profile.tier === "new" ? "listings are reviewed before they go live" : undefined} />
        <Stat label="Score" value={m.score} hint="rating, on-time dispatch, cancels, returns" />
        <Stat label="Rating" value={m.ratingAvg ?? "—"} hint={`${m.ratingCount} review(s)`} />
        <Stat label="On-time dispatch" value={`${m.onTimeDispatch}%`} hint={`returns ${m.returnRate}% · cancels ${m.sellerCancelRate}%`} />
      </div>}
      {!!ov.data?.gaps.length && <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200"><p className="font-medium">Before your listings can go live:</p><ul className="mt-1 list-disc pl-5">{ov.data.gaps.map(g => <li key={g}>{g}</li>)}</ul></div>}
      {p && hubCan(me, "settings:manage") && (
        <Panel title="Seller details shown to customers" actions={prof ? <Button size="sm" onClick={saveProfile}>Save</Button> : undefined}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label htmlFor="g-n">Grievance officer</Label><Input id="g-n" value={p.grievanceName ?? ""} onChange={e => setProf({ ...p, grievanceName: e.target.value })} /></div>
            <div><Label htmlFor="g-p">Phone</Label><Input id="g-p" inputMode="tel" value={p.grievancePhone ?? ""} onChange={e => setProf({ ...p, grievancePhone: e.target.value })} /></div>
            <div><Label htmlFor="g-e">Email</Label><Input id="g-e" type="email" value={p.grievanceEmail ?? ""} onChange={e => setProf({ ...p, grievanceEmail: e.target.value })} /></div>
            <div className="sm:col-span-3"><Label htmlFor="g-r">Return and refund policy</Label><Textarea id="g-r" rows={2} value={p.returnPolicy ?? ""} onChange={e => setProf({ ...p, returnPolicy: e.target.value })} /></div>
          </div>
          <p className="mt-2 text-xs text-[hsl(215,20%,55%)]">The Consumer Protection (E-Commerce) Rules 2020 require these on every listing and order. Your GSTIN: {p.gstin ?? <span className="text-rose-300">missing — sellers of goods must be GST-registered</span>}.</p>
        </Panel>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) upload(file); }} />
      <Panel>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !data?.length ? <Empty icon="storefront" title="No listings yet">MRP, HSN, GST rate, country of origin and manufacturer are required.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
            <Thead cols={["Product", "Status", ["Price", "right"], ["MRP", "right"], ["Stock", "right"], "HSN · GST", ""]} />
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">{data.map(l => (
              <tr key={l.id}>
                <td className="py-2 pr-2"><div className="flex items-center gap-2">{l.images[0] ? <img src={l.images[0]} alt="" className="h-9 w-9 rounded object-cover" /> : <div className="h-9 w-9 rounded bg-white/5" />}<div><span className="text-white">{l.name}</span><span className="block text-xs text-[hsl(215,20%,55%)]">{l.categoryName}{l.sellerSku ? ` · ${l.sellerSku}` : ""}</span></div></div></td>
                <td className="pr-2"><Chip tone={S_TONE[l.status]}>{l.status.replace("_", " ")}</Chip>{l.rejectionReason && <span className="mt-1 block max-w-[220px] text-xs text-rose-300">{l.rejectionReason}</span>}</td>
                <td className="pr-2 text-right tabular-nums">₹{l.price.toLocaleString("en-IN")}</td>
                <td className="pr-2 text-right tabular-nums text-[hsl(215,20%,60%)]">{l.mrp != null ? `₹${l.mrp.toLocaleString("en-IN")}` : "—"}</td>
                <td className={`pr-2 text-right tabular-nums ${l.stock === 0 ? "text-rose-300" : ""}`}>{l.stock}</td>
                <td className="pr-2 font-mono text-xs">{l.hsnCode} · {l.gstPercent}%</td>
                <td className="text-right whitespace-nowrap">{manage && <>
                  <Button size="sm" variant="ghost" onClick={() => edit(l)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setImgFor(l.id); setTimeout(() => fileRef.current?.click(), 0); }}>Photo</Button>
                  {["draft", "rejected", "paused"].includes(l.status) && <Button size="sm" onClick={() => act(l, "submit")}>{l.status === "paused" ? "Resume" : "Submit"}</Button>}
                  {l.status === "live" && <Button size="sm" variant="ghost" onClick={() => act(l, "pause")}>Pause</Button>}
                </>}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit listing" : "New listing"}</DialogTitle><DialogDescription>Prices are what the customer pays, GST included. The price can never be above the MRP.</DialogDescription></DialogHeader>
          <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
            <div className="sm:col-span-2"><Label htmlFor="l-n">Product name</Label><Input id="l-n" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
            <div><Label htmlFor="l-c">Category</Label><HubSelect id="l-c" className="w-full" value={f.categoryId} onChange={v => setF({ ...f, categoryId: v })}><option value="">Choose…</option>{(cats.data ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</HubSelect></div>
            <div className="sm:col-span-3"><Label htmlFor="l-d">Description</Label><Textarea id="l-d" rows={3} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></div>
            <div><Label htmlFor="l-p">Price ₹ (incl. GST)</Label><Input id="l-p" inputMode="numeric" value={f.priceRupees} onChange={e => setF({ ...f, priceRupees: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="l-m">MRP ₹</Label><Input id="l-m" inputMode="numeric" value={f.mrpRupees} onChange={e => setF({ ...f, mrpRupees: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="l-s">Stock</Label><Input id="l-s" inputMode="numeric" value={f.stock} onChange={e => setF({ ...f, stock: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="l-h">HSN</Label><Input id="l-h" inputMode="numeric" maxLength={8} value={f.hsnCode} onChange={e => setF({ ...f, hsnCode: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="l-g">GST %</Label><HubSelect id="l-g" className="w-full" value={f.gstPercent} onChange={v => setF({ ...f, gstPercent: v })}>{[0, 0.25, 3, 5, 18, 40].map(r => <option key={r} value={r}>{r}%</option>)}</HubSelect></div>
            <div><Label htmlFor="l-q">Net quantity</Label><Input id="l-q" value={f.netQuantity} onChange={e => setF({ ...f, netQuantity: e.target.value })} /></div>
            <div><Label htmlFor="l-o">Country of origin</Label><Input id="l-o" value={f.countryOfOrigin} onChange={e => setF({ ...f, countryOfOrigin: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="l-mf">Manufacturer / importer</Label><Input id="l-mf" value={f.manufacturer} onChange={e => setF({ ...f, manufacturer: e.target.value })} /></div>
            <div><Label htmlFor="l-r">Return window (days)</Label><Input id="l-r" inputMode="numeric" value={f.returnWindowDays} onChange={e => setF({ ...f, returnWindowDays: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="l-w">Warranty (months)</Label><Input id="l-w" inputMode="numeric" value={f.warrantyMonths} onChange={e => setF({ ...f, warrantyMonths: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="l-wb">Warranty by</Label><HubSelect id="l-wb" className="w-full" value={f.warrantyBy} onChange={v => setF({ ...f, warrantyBy: v })}><option value="manufacturer">Manufacturer</option><option value="seller">You (seller)</option><option value="none">None</option></HubSelect></div>
            <div><Label htmlFor="l-b">BIS registration (if required)</Label><Input id="l-b" value={f.bisNumber} onChange={e => setF({ ...f, bisNumber: e.target.value })} /></div>
            <div><Label htmlFor="l-wp">WPC ETA (wireless)</Label><Input id="l-wp" value={f.wpcEta} onChange={e => setF({ ...f, wpcEta: e.target.value })} /></div>
            <div><Label htmlFor="l-sku">Your SKU</Label><Input id="l-sku" value={f.sellerSku} onChange={e => setF({ ...f, sellerSku: e.target.value })} /></div>
          </div>
          {f.priceRupees && f.mrpRupees && Number(f.priceRupees) > Number(f.mrpRupees) && <p role="alert" className="text-sm text-rose-300">The price is above the MRP — that is not allowed.</p>}
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={!f.name.trim() || !f.categoryId || !f.priceRupees || !f.mrpRupees || !f.hsnCode || !f.manufacturer.trim() || !f.countryOfOrigin.trim()}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

export function HubStoreOrders() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [view, setView] = useState<"open" | "returns" | "done">("open");
  const q = useQuery<{ data: Order[]; shipping: { mode: "mock" | "live"; ratePer500g: number; gstPercent: number } }>({ queryKey: ["/api/hub/store/orders"], queryFn: async () => (await apiRequest("GET", "/api/hub/store/orders")) as any, refetchInterval: 60_000 });
  const data = q.data?.data, shipping = q.data?.shipping, isLoading = q.isLoading;
  const rows = useMemo(() => (data ?? []).filter(o => view === "open" ? ["placed", "confirmed", "packed", "dispatched"].includes(o.status) : view === "returns" ? ["requested", "approved"].includes(o.returnStatus ?? "") : ["delivered", "cancelled", "returned"].includes(o.status) && !["requested", "approved"].includes(o.returnStatus ?? "")), [data, view]);
  const [ship, setShip] = useState<{ o: Order; courier: string; trackingId: string } | null>(null);
  const [book, setBook] = useState<{ o: Order; weightGrams: string; lengthCm: string; widthCm: string; heightCm: string } | null>(null);
  const bookCourier = async () => {
    if (!book) return;
    try { const r: any = await apiRequest("POST", `/api/hub/store/orders/${book.o.id}/courier`, { weightGrams: Number(book.weightGrams), lengthCm: Number(book.lengthCm), widthCm: Number(book.widthCm), heightCm: Number(book.heightCm) }); setBook(null); refresh(); toast({ title: "Courier booked", description: r.message }); }
    catch (e) { fail(toast, "Not booked")(e); }
  };
  const manage = hubCan(me, "ops:manage");
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/hub/store/orders"] });
  const move = async (o: Order, to: string, extra: Record<string, unknown> = {}) => {
    if (to === "dispatched" && !extra.courier && !o.trackingId) { setShip({ o, courier: "", trackingId: "" }); return; }
    try { const r: any = await apiRequest("POST", `/api/hub/store/orders/${o.id}/transition`, { to, ...extra }); refresh(); setShip(null); toast({ title: r.message }); } catch (e) { fail(toast, "Not changed")(e); }
  };
  const cancel = async (o: Order) => { const reason = window.prompt("Why cancel? The customer is refunded, a cancellation charge is taken from your settlement, and cancellations lower your score."); if (reason) move(o, "cancelled", { reason }); };
  const ret = async (o: Order, decision: "approve" | "reject" | "received") => {
    const note = decision === "reject" ? window.prompt("Why reject the return? The customer sees this.") : null;
    if (decision === "reject" && !note) return;
    try { const r: any = await apiRequest("POST", `/api/hub/store/orders/${o.id}/return`, { decision, note }); refresh(); toast({ title: r.message }); } catch (e) { fail(toast, "Not changed")(e); }
  };
  const toShip = (data ?? []).filter(o => ["placed", "confirmed", "packed"].includes(o.status));
  return (
    <HubPage title="Store orders" subtitle="Ship within the dispatch deadline. Dispatching issues your GST invoice to the customer. You are paid after delivery plus the return window.">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="To ship" value={toShip.length} hint={toShip.some(o => o.late) ? `${toShip.filter(o => o.late).length} late` : undefined} />
        <Stat label="Return requests" value={(data ?? []).filter(o => o.returnStatus === "requested").length} />
        <Stat label="Awaiting settlement" value={inr((data ?? []).filter(o => o.status === "delivered" && !o.settledAt).reduce((a, o) => a + o.net, 0))} hint="net, after the return window" />
      </div>
      <Panel actions={<div className="flex gap-1" role="tablist">{([["open", "Open"], ["returns", "Returns"], ["done", "Done"]] as const).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`rounded-md px-3 py-1.5 text-sm ${view === k ? "bg-white/10 text-white" : "text-[hsl(215,20%,65%)] hover:text-white"}`}>{l}</button>
      ))}</div>}>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !rows.length ? <Empty icon="local_shipping" title="Nothing here" /> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)]">{rows.map(o => (
            <li key={o.id} className="grid gap-2 py-3 lg:grid-cols-[1fr_auto]">
              <div className="text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-white">{o.code}</span><Chip tone={O_TONE[o.status]}>{o.status}</Chip>{o.late && <Chip tone="bad">past dispatch deadline{o.lateCharge ? ` — ₹${o.lateCharge} charge when dispatched` : ""}</Chip>}{o.penalty > 0 && <Chip tone="bad">charge {inr(o.penalty)}</Chip>}{o.penaltyWaived && <Chip>charge waived</Chip>}{o.returnStatus && <Chip tone="warn">return {o.returnStatus}</Chip>}{o.settledAt && <Chip tone="good">settled</Chip>}</div>
                <p className="mt-0.5 text-white">{o.items.map(i => `${i.quantity} × ${i.name}`).join(", ")}</p>
                <p className="mt-0.5 text-[hsl(215,20%,70%)]">{o.shipName ? `${o.shipName}${o.shipPhone ? ` · ${o.shipPhone}` : ""} · ${o.shipAddress ?? ""} ${o.shipPincode ?? ""}` : "Customer details hidden after settlement"}</p>
                <p className="mt-0.5 text-xs text-[hsl(215,20%,55%)]">{inr(o.total)} · commission {inr(o.commission)}{o.gatewayFee ? ` · payment collection ${inr(o.gatewayFee)}` : ""} · TCS {inr(o.tcs)} · TDS {inr(o.tds)} · <span className="text-white">you get {inr(o.net)}</span>{o.courier ? ` · ${o.courier} ${o.trackingId}` : ""}{["placed", "confirmed", "packed"].includes(o.status) ? ` · ship by ${when(o.dispatchBy)}` : ""}</p>
                {o.returnReason && <p className="mt-0.5 text-xs text-amber-200">Return: “{o.returnReason}”</p>}
                {o.penaltyReason && o.penalty > 0 && <p className="mt-0.5 text-xs text-rose-200">{o.penaltyReason}</p>}
              </div>
              {manage && <div className="flex flex-wrap items-center gap-1 lg:justify-end">
                {(NEXT[o.status] ?? []).map(([to, label]) => <Button key={to} size="sm" variant={to === "dispatched" ? "default" : "outline"} onClick={() => move(o, to)}>{label}</Button>)}
                {["confirmed", "packed"].includes(o.status) && !o.shipmentRef && <Button size="sm" variant="outline" onClick={() => setBook({ o, weightGrams: "500", lengthCm: "20", widthCm: "15", heightCm: "10" })}>Book courier</Button>}
                {["confirmed", "packed", "dispatched"].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => openAuthedPdf(`/api/hub/store/orders/${o.id}/label.pdf`).catch(fail(toast, "No label"))}>Label</Button>}
                {["placed", "confirmed", "packed"].includes(o.status) && <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => cancel(o)}>Cancel</Button>}
                {o.returnStatus === "requested" && <><Button size="sm" onClick={() => ret(o, "approve")}>Approve return</Button><Button size="sm" variant="ghost" onClick={() => ret(o, "reject")}>Reject</Button></>}
                {o.returnStatus === "approved" && <Button size="sm" onClick={() => ret(o, "received")}>Received back</Button>}
              </div>}
            </li>
          ))}</ul>
        )}
      </Panel>
      <Dialog open={!!book} onOpenChange={o => !o && setBook(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Book a courier for {book?.o.code}</DialogTitle><DialogDescription>Delhivery collects from your pickup address. Pack it, print the label, stick it on, then dispatch.{" "}
            {shipping?.ratePer500g ? `Courier charge: ₹${shipping.ratePer500g} per 500 g + ${shipping.gstPercent}% GST, taken from your settlement (returned if the order is cancelled).` : "No courier charge is set."}
            {shipping?.mode === "mock" && " The courier account is not live yet — this makes a test booking."}</DialogDescription></DialogHeader>
          {book && <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label htmlFor="b-w">Packed weight (grams)</Label><Input id="b-w" inputMode="numeric" value={book.weightGrams} onChange={e => setBook({ ...book, weightGrams: e.target.value })} /></div>
            <div><Label htmlFor="b-l">Length cm</Label><Input id="b-l" inputMode="numeric" value={book.lengthCm} onChange={e => setBook({ ...book, lengthCm: e.target.value })} /></div>
            <div><Label htmlFor="b-wd">Width cm</Label><Input id="b-wd" inputMode="numeric" value={book.widthCm} onChange={e => setBook({ ...book, widthCm: e.target.value })} /></div>
            <div><Label htmlFor="b-h">Height cm</Label><Input id="b-h" inputMode="numeric" value={book.heightCm} onChange={e => setBook({ ...book, heightCm: e.target.value })} /></div>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setBook(null)}>Cancel</Button><Button onClick={bookCourier}>Book</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!ship} onOpenChange={o => !o && setShip(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Dispatch {ship?.o.code}</DialogTitle><DialogDescription>Your GST invoice to the customer is issued now.</DialogDescription></DialogHeader>
          {ship && <div className="grid gap-3">
            <div><Label htmlFor="d-c">Courier</Label><Input id="d-c" placeholder="DTDC, Delhivery, India Post…" value={ship.courier} onChange={e => setShip({ ...ship, courier: e.target.value })} /></div>
            <div><Label htmlFor="d-t">Tracking id</Label><Input id="d-t" value={ship.trackingId} onChange={e => setShip({ ...ship, trackingId: e.target.value })} /></div>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setShip(null)}>Cancel</Button><Button disabled={!ship?.courier.trim() || !ship?.trackingId.trim()} onClick={() => ship && move(ship.o, "dispatched", { courier: ship.courier, trackingId: ship.trackingId })}>Dispatch</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

export function HubStoreReviews() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Array<{ id: number; productName: string; rating: number; review: string | null; sellerReply: string | null; createdAt: string; isVisible: boolean }>>({ queryKey: ["/api/hub/store/reviews"], queryFn: async () => (await apiRequest("GET", "/api/hub/store/reviews")).data });
  const [text, setText] = useState<Record<number, string>>({});
  const reply = async (id: number) => { try { await apiRequest("POST", `/api/hub/store/reviews/${id}/reply`, { reply: text[id] }); qc.invalidateQueries({ queryKey: ["/api/hub/store/reviews"] }); toast({ title: "Reply posted" }); } catch (e) { fail(toast, "Not posted")(e); } };
  return (
    <HubPage title="Reviews" subtitle="Only customers who bought and received an item can review it. You can reply once, publicly.">
      <Panel>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !data?.length ? <Empty icon="reviews" title="No reviews yet" /> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)]">{data.map(r => (
            <li key={r.id} className="py-3 text-sm">
              <div className="flex items-center gap-2"><span className="text-amber-300" aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span><span className="text-white">{r.productName}</span><span className="ml-auto text-xs text-[hsl(215,20%,55%)]">{new Date(r.createdAt).toLocaleDateString("en-IN")}</span></div>
              {r.review && <p className="mt-1 text-[hsl(215,20%,75%)]">{r.review}</p>}
              {r.sellerReply ? <p className="mt-1 border-l-2 border-[hsl(174,72%,45%)] pl-2 text-xs text-[hsl(215,20%,70%)]">You replied: {r.sellerReply}</p> : (
                <div className="mt-2 flex gap-2"><Input aria-label="Reply" className="h-8" placeholder="Reply publicly" value={text[r.id] ?? ""} onChange={e => setText({ ...text, [r.id]: e.target.value })} /><Button size="sm" disabled={!(text[r.id] ?? "").trim()} onClick={() => reply(r.id)}>Reply</Button></div>
              )}
            </li>
          ))}</ul>
        )}
      </Panel>
    </HubPage>
  );
}
