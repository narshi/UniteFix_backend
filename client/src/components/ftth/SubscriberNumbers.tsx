/**
 * A subscriber's mobile numbers: the current one, every earlier one, and the
 * three things a partner can do — change the number (it must belong to a
 * UniteFix member), suspend the current one (lost or stolen phone), or make a
 * previous number current again. Nothing is deleted: old numbers stay in the
 * history with when and why they stopped.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

type PhoneRow = { id: number; phone: string; status: "active" | "suspended"; memberName: string | null; linked: boolean; reason: string | null; addedAt: string | null; endedAt: string | null; endedReason: string | null };
type Numbers = { connectionId: number; status: string; ispConnectionId: string | null; current: string | null; linked: boolean; history: PhoneRow[] };

const muted = "text-[hsl(215,20%,60%)]";
const pretty = (p: string) => (p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p);
const day = (d: string | null) => (d ? format(new Date(d), "d MMM yyyy") : "—");

export function SubscriberNumbers({ connectionId, title, onClose, onChanged }: { connectionId: number; title: string; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = [`/api/ftth/admin/connections/${connectionId}/phones`];
  const q = useQuery<{ data: Numbers }>({ queryKey: key });
  const n = q.data?.data;
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [suspendWhy, setSuspendWhy] = useState("");
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [busy, setBusy] = useState(false);
  const closed = n?.status === "closed";
  const current = n?.history.find(h => h.status === "active") ?? null;
  const digits = phone.replace(/\D/g, "");
  const phoneOk = /^[6-9]\d{9}$/.test(digits.length > 10 ? digits.slice(-10) : digits);

  const run = async (fn: () => Promise<any>, done: string) => {
    setBusy(true);
    try {
      const r: any = await fn();
      toast({ title: done, description: r?.message });
      await qc.invalidateQueries({ queryKey: key });
      onChanged();
      return true;
    } catch (e) {
      toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" });
      return false;
    } finally { setBusy(false); }
  };
  const change = async () => {
    if (await run(() => apiRequest("POST", `/api/ftth/admin/connections/${connectionId}/phone`, { phone: digits, reason: reason.trim() || null }), "Number changed")) { setPhone(""); setReason(""); }
  };
  const suspend = async () => {
    if (await run(() => apiRequest("POST", `/api/ftth/admin/connections/${connectionId}/phone/suspend`, { reason: suspendWhy.trim() }), "Number suspended")) { setSuspendWhy(""); setConfirmSuspend(false); }
  };
  const reactivate = (h: PhoneRow) => run(() => apiRequest("POST", `/api/ftth/admin/connections/${connectionId}/phones/${h.id}/reactivate`, {}), "Number reactivated");

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mobile numbers — {title}</DialogTitle>
          <DialogDescription>The subscriber, their ID and recharges stay the same; only the number — and so the UniteFix account it belongs to — changes. Old numbers are kept in the history.</DialogDescription>
        </DialogHeader>
        {!n ? <p className={`text-sm ${muted}`}>{q.isError ? "Could not load the numbers." : "Loading…"}</p> : (
          <div className="space-y-5">
            <section className="rounded-lg border border-[rgba(255,255,255,0.08)] p-3">
              <p className={`text-xs uppercase tracking-wide ${muted}`}>Current number</p>
              {current ? (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-lg text-white">{pretty(current.phone)}</p>
                    <p className={`text-xs ${current.linked ? "text-emerald-300" : "text-amber-300"}`}>{current.linked ? `UniteFix member${current.memberName ? ` — ${current.memberName}` : ""}` : "Not on the UniteFix app"}</p>
                  </div>
                  {!closed && !confirmSuspend && <Button size="sm" variant="outline" className="text-rose-300" onClick={() => setConfirmSuspend(true)} disabled={busy}>Suspend number</Button>}
                </div>
              ) : <p className="mt-1 text-sm text-amber-300">No number — the customer has no app access until one is added.</p>}
              {confirmSuspend && (
                <div className="mt-3 space-y-2 rounded-md bg-rose-500/10 p-3">
                  <p className="text-sm text-rose-200">The customer loses this connection in the UniteFix app until a new number is added. The subscriber, ID and recharges stay.</p>
                  <Label htmlFor="sn-why">Why</Label>
                  <Input id="sn-why" placeholder="e.g. phone lost" value={suspendWhy} onChange={e => setSuspendWhy(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" disabled={busy || suspendWhy.trim().length < 3} onClick={suspend}>Suspend number</Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmSuspend(false)} disabled={busy}>Cancel</Button>
                  </div>
                </div>
              )}
            </section>

            {closed ? (
              <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-200">This subscriber is closed. Reopen them to change the number.</p>
            ) : (
              <section className="space-y-2">
                <p className="text-sm font-medium text-white">Change to a new number</p>
                <p className={`text-xs ${muted}`}>The new number must belong to someone signed up in the UniteFix app. The connection moves to their account straight away and both numbers are told.</p>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                  <div><Label htmlFor="sn-phone">New mobile number</Label><Input id="sn-phone" inputMode="tel" placeholder="98765 43210" value={phone} onChange={e => setPhone(e.target.value)} /></div>
                  <div><Label htmlFor="sn-reason">Reason (optional)</Label><Input id="sn-reason" placeholder="e.g. customer changed SIM" value={reason} onChange={e => setReason(e.target.value)} /></div>
                </div>
                {phone && !phoneOk && <p className="text-xs text-amber-300">Enter a 10-digit Indian mobile number.</p>}
                <Button size="sm" disabled={busy || !phoneOk} onClick={change}>{busy ? "Checking…" : "Change number"}</Button>
              </section>
            )}

            <section>
              <p className="text-sm font-medium text-white">History</p>
              {!n.history.length ? <p className={`text-xs ${muted}`}>No numbers yet.</p> : (
                <ul className="mt-2 divide-y divide-[rgba(255,255,255,0.06)]">
                  {n.history.map((h, i) => (
                    <li key={`${h.id}-${i}`} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <span className="font-mono text-white">{pretty(h.phone)}</span>
                      <Badge className={h.status === "active" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-slate-500/15 text-slate-300 border-slate-500/30"}>{h.status === "active" ? "current" : "suspended"}</Badge>
                      <span className={`min-w-0 flex-1 text-xs ${muted}`}>
                        {h.memberName ? `${h.memberName} · ` : ""}{day(h.addedAt)} – {h.endedAt ? day(h.endedAt) : "now"}{h.endedReason ? ` · ${h.endedReason}` : ""}{h.reason ? ` · ${h.reason}` : ""}
                      </span>
                      {h.status === "suspended" && h.id > 0 && !closed && <Button size="sm" variant="ghost" disabled={busy} onClick={() => reactivate(h)}>Make current</Button>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
