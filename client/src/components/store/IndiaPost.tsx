/**
 * India Post for a store order, shared by staff (UniteFix's own orders) and
 * partners (their Hub): book the parcel — pickup from the sender's address or
 * drop at the post office — with the postage quoted first, and see where it is.
 *
 * `base` is the order's API root: /api/admin/store/orders or /api/hub/store/orders.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ParcelInfo = { suggested: { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number; complete: boolean }; events: Array<{ at: string; description: string; office: string | null; status: string | null }>; indiaPost: "live" | "mock" | "off" };
type Form = { product: "SP" | "BP"; weightGrams: string; lengthCm: string; widthCm: string; heightCm: string; handover: "dropoff" | "pickup"; pickupDate: string; slot: "10:00-13:00" | "13:00-16:00" };

export const TRACKING_TONE: Record<string, string> = {
  booked: "bg-sky-500/15 text-sky-300", handed_over: "bg-violet-500/15 text-violet-300", in_transit: "bg-violet-500/15 text-violet-300",
  on_hold: "bg-amber-500/15 text-amber-300", out_for_delivery: "bg-indigo-500/15 text-indigo-300", delivered: "bg-emerald-500/15 text-emerald-300",
  returning: "bg-rose-500/15 text-rose-300", returned: "bg-rose-500/15 text-rose-300", pickup_cancelled: "bg-amber-500/15 text-amber-300",
};
export const TRACKING_WORD: Record<string, string> = {
  booked: "Booked", handed_over: "With India Post", in_transit: "In transit", on_hold: "Held at post office", out_for_delivery: "Out for delivery",
  delivered: "Delivered", returning: "Returning to sender", returned: "Returned", pickup_cancelled: "Pickup cancelled",
};

const istToday = (plusDays = 0) => new Date(Date.now() + 330 * 60_000 + plusDays * 86_400_000).toISOString().slice(0, 10);
const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function IndiaPostBookDialog({ base, order, onClose, onBooked, contentClassName }: { base: string; order: { id: number; code: string } | null; onClose: () => void; onBooked: () => void; contentClassName?: string }) {
  const { toast } = useToast();
  const [f, setF] = useState<Form | null>(null);
  const [quote, setQuote] = useState<{ total: number; deliveryType: string | null; assuredBy: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const info = useQuery<ParcelInfo>({ queryKey: [base, order?.id, "parcel"], enabled: !!order, queryFn: async () => (await apiRequest("GET", `${base}/${order!.id}/parcel`)).data });

  useEffect(() => { if (!order) { setF(null); setQuote(null); } }, [order]);
  useEffect(() => {
    if (order && info.data && !f) {
      const s = info.data.suggested;
      setF({ product: "SP", weightGrams: String(s.weightGrams), lengthCm: String(s.lengthCm), widthCm: String(s.widthCm), heightCm: String(s.heightCm), handover: "dropoff", pickupDate: istToday(1), slot: "10:00-13:00" });
    }
  }, [order, info.data, f]);

  const body = () => f && ({ product: f.product, weightGrams: Number(f.weightGrams), lengthCm: Number(f.lengthCm), widthCm: Number(f.widthCm), heightCm: Number(f.heightCm), handover: f.handover, pickupDate: f.handover === "pickup" ? f.pickupDate : null, slot: f.handover === "pickup" ? f.slot : null });
  const set = (patch: Partial<Form>) => { if (f) { setF({ ...f, ...patch }); setQuote(null); } };
  const getQuote = async () => {
    try { setBusy(true); const r: any = await apiRequest("POST", `${base}/${order!.id}/india-post/quote`, body()); setQuote(r.data); }
    catch (e) { toast({ title: "No postage quote", description: apiErrorMessage(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const book = async () => {
    try { setBusy(true); const r: any = await apiRequest("POST", `${base}/${order!.id}/india-post`, body()); toast({ title: "Booked with India Post", description: r.message }); onBooked(); onClose(); }
    catch (e) { toast({ title: "Not booked", description: apiErrorMessage(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const mode = info.data?.indiaPost;
  const valid = !!f && [f.weightGrams, f.lengthCm, f.widthCm, f.heightCm].every(v => /^\d+$/.test(v) && Number(v) > 0) && (f.handover === "dropoff" || !!f.pickupDate);

  return (
    <Dialog open={!!order} onOpenChange={o => !o && onClose()}>
      <DialogContent className={contentClassName ?? "max-w-md"}>
        <DialogHeader>
          <DialogTitle>India Post for {order?.code}</DialogTitle>
          <DialogDescription>
            Speed Post with an article number from UniteFix's contract. Pack it, book, print the label and stick it on. The order is marked shipped (and its invoice issued) when India Post takes the parcel.
            {mode === "mock" && " India Post is not live yet: this makes a test booking."}
            {mode === "off" && " India Post is not switched on."}
          </DialogDescription>
        </DialogHeader>
        {!f ? <p className="text-sm opacity-70">Loading…</p> : (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2 flex gap-2">
              {(["SP", "BP"] as const).map(p => <Button key={p} type="button" size="sm" variant={f.product === p ? "default" : "outline"} onClick={() => set({ product: p })}>{p === "SP" ? "Speed Post" : "Business Parcel"}</Button>)}
            </div>
            <div className="col-span-2"><Label htmlFor="ip-w">Packed weight (grams)</Label><Input id="ip-w" inputMode="numeric" value={f.weightGrams} onChange={e => set({ weightGrams: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="ip-l">Length cm</Label><Input id="ip-l" inputMode="numeric" value={f.lengthCm} onChange={e => set({ lengthCm: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="ip-b">Width cm</Label><Input id="ip-b" inputMode="numeric" value={f.widthCm} onChange={e => set({ widthCm: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="ip-h">Height cm</Label><Input id="ip-h" inputMode="numeric" value={f.heightCm} onChange={e => set({ heightCm: e.target.value.replace(/\D/g, "") })} /></div>
            <div className="col-span-2 text-xs opacity-70">{info.data?.suggested.complete ? "Filled from the products' packed weight and size. Weigh the box if you can." : "Some products have no packed weight or size yet: weigh and measure the box."}</div>
            <div className="col-span-2 flex gap-2">
              <Button type="button" size="sm" variant={f.handover === "dropoff" ? "default" : "outline"} onClick={() => set({ handover: "dropoff" })}>I'll drop it at the post office</Button>
              <Button type="button" size="sm" variant={f.handover === "pickup" ? "default" : "outline"} onClick={() => set({ handover: "pickup" })}>Postman picks up</Button>
            </div>
            {f.handover === "pickup" && <>
              <div><Label htmlFor="ip-d">Pickup day</Label><Input id="ip-d" type="date" min={istToday()} max={istToday(7)} value={f.pickupDate} onChange={e => set({ pickupDate: e.target.value })} /></div>
              <div><Label>Slot</Label><div className="flex gap-1 pt-1">{(["10:00-13:00", "13:00-16:00"] as const).map(s => <Button key={s} type="button" size="sm" variant={f.slot === s ? "default" : "outline"} onClick={() => set({ slot: s })}>{s}</Button>)}</div></div>
            </>}
            <div className="col-span-2 flex items-center gap-2 rounded-md border border-white/10 p-2">
              <Button type="button" size="sm" variant="outline" disabled={!valid || busy} onClick={getQuote}>Get postage</Button>
              {quote ? <span>₹{quote.total.toLocaleString("en-IN")} incl. GST{quote.deliveryType ? ` · ${quote.deliveryType}` : ""}{quote.assuredBy ? ` · by ${quote.assuredBy}` : ""}</span> : <span className="text-xs opacity-60">Postage is worked out from weight, size and both pincodes.</span>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Back</Button>
          <Button disabled={!valid || busy || mode === "off"} onClick={book}>{busy ? "Working…" : "Book India Post"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Where the parcel is: its India Post events, newest first. Loads when opened. */
export function ParcelTrail({ base, orderId }: { base: string; orderId: number }) {
  const [open, setOpen] = useState(false);
  const q = useQuery<ParcelInfo>({ queryKey: [base, orderId, "parcel"], enabled: open, queryFn: async () => (await apiRequest("GET", `${base}/${orderId}/parcel`)).data });
  return (
    <div className="text-xs">
      <button type="button" className="underline decoration-dotted opacity-80 hover:opacity-100" onClick={() => setOpen(!open)}>{open ? "Hide tracking" : "Tracking events"}</button>
      {open && (
        <ol className="mt-1 space-y-0.5 border-l border-white/10 pl-3">
          {q.isLoading && <li className="opacity-60">Loading…</li>}
          {q.data?.events.length === 0 && <li className="opacity-60">No events yet.</li>}
          {q.data?.events.map((e, i) => <li key={i}><span className="opacity-60">{when(e.at)}</span> · {e.description}{e.office ? <span className="opacity-60"> · {e.office}</span> : null}</li>)}
        </ol>
      )}
    </div>
  );
}
