/**
 * Payment links: a button that makes (or reuses) the link for an invoice or
 * an event milestone and shows it ready to copy or send on WhatsApp, and the
 * list of every link the business has sent.
 */

import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { inr } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty, Thead } from "@/components/hub/ui";

export type PayLinkView = { id: number; kind: "invoice" | "milestone"; refId: number; description: string; amount: number; status: "open" | "paid" | "cancelled"; url: string; paidAt: string | null; method: string | null; paymentId: string | null; fee: number; net: number; note: string | null; createdAt: string; customer?: string | null; gateway?: boolean };

const full = (u: string) => `${window.location.origin}${u}`;

export function PayLinkButton({ kind, refId, label = "Payment link", size = "sm", variant = "outline", prepare }: {
  kind: "invoice" | "milestone"; refId?: number; label?: string; size?: "sm" | "default"; variant?: "outline" | "default" | "ghost";
  /** Runs first and returns the id to link (e.g. bill an appointment upfront and return the invoice id). */
  prepare?: () => Promise<number>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [link, setLink] = useState<PayLinkView | null>(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const id = prepare ? await prepare() : refId!;
      const r: any = await apiRequest("POST", "/api/hub/pay-links", { kind, refId: id });
      setLink(r.data);
      qc.invalidateQueries({ queryKey: ["/api/hub/pay-links"] });
    } catch (e) { toast({ title: "No link", description: apiErrorMessage(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(full(link!.url)); toast({ title: "Link copied" }); }
    catch { toast({ title: "Copy it from the box", description: full(link!.url) }); }
  };
  const cancel = async () => {
    try { await apiRequest("POST", `/api/hub/pay-links/${link!.id}/cancel`, {}); setLink(null); qc.invalidateQueries({ queryKey: ["/api/hub/pay-links"] }); toast({ title: "Link cancelled" }); }
    catch (e) { toast({ title: "Not cancelled", description: apiErrorMessage(e), variant: "destructive" }); }
  };
  const wa = link ? `https://wa.me/?text=${encodeURIComponent(`${link.description}: please pay ${inr(link.amount)} here — ${full(link.url)}`)}` : "#";
  return (
    <>
      <Button size={size} variant={variant} disabled={busy} onClick={open}>{busy ? "Preparing…" : label}</Button>
      <Dialog open={!!link} onOpenChange={o => { if (!o) setLink(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Payment link — {link && inr(link.amount)}</DialogTitle>
            <DialogDescription>{link?.description}. The customer pays by UPI, card or net banking on a UniteFix page; you are told the moment it is paid, and it is recorded for you.</DialogDescription>
          </DialogHeader>
          {link && <>
            <input readOnly value={full(link.url)} onFocus={e => e.currentTarget.select()} aria-label="Payment link"
              className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-white/5 px-3 py-2 font-mono text-xs text-white" />
            {link.gateway === false && <p className="text-xs text-amber-300">Online payment is not switched on yet on UniteFix's side — the link opens, but the customer cannot pay through it until it is.</p>}
            <p className="text-xs text-[hsl(215,20%,60%)]">The money comes to you in your next UniteFix settlement, less the collection fee shown on your statement.</p>
          </>}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="ghost" onClick={cancel}>Cancel link</Button>
            <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-md border border-[rgba(255,255,255,0.15)] px-4 text-sm text-white hover:bg-white/5">Send on WhatsApp</a>
            <Button onClick={copy}>Copy link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const TONE: Record<string, "good" | "warn" | "bad" | undefined> = { paid: "good", open: "warn", cancelled: undefined };

export function HubPayLinksPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ gateway: boolean; fee: { percent: number }; links: PayLinkView[] }>({ queryKey: ["/api/hub/pay-links"], queryFn: async () => (await apiRequest("GET", "/api/hub/pay-links")).data });
  const links = data?.links ?? [];
  const copy = async (u: string) => { try { await navigator.clipboard.writeText(full(u)); toast({ title: "Link copied" }); } catch { toast({ title: "Copy it", description: full(u) }); } };
  const cancel = async (l: PayLinkView) => {
    try { await apiRequest("POST", `/api/hub/pay-links/${l.id}/cancel`, {}); qc.invalidateQueries({ queryKey: ["/api/hub/pay-links"] }); toast({ title: "Link cancelled" }); }
    catch (e) { toast({ title: "Not cancelled", description: apiErrorMessage(e), variant: "destructive" }); }
  };
  const received = links.filter(l => l.status === "paid");
  return (
    <HubPage title="Online payments" subtitle={`Links your customers pay through. Make one from an invoice, an event's payment plan or a consulting appointment. UniteFix keeps ${data ? data.fee.percent : "a small"}% + GST as the collection fee and pays you the rest in your settlement.`}>
      {data && !data.gateway && <Panel><p className="text-sm text-amber-300">Online payment is not switched on yet on UniteFix's side. You can make links now; customers can pay through them once it is.</p></Panel>}
      <Panel title={`${links.length} link${links.length === 1 ? "" : "s"} · ${inr(received.reduce((a, l) => a + l.amount, 0))} received online`}>
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !links.length ? <Empty icon="link" title="No payment links yet" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <Thead cols={["For", "Customer", ["Amount", "right"], "Status", ["To you", "right"], ""]} />
            <tbody>{links.map(l => (
              <tr key={l.id} className="border-t border-[rgba(255,255,255,0.06)] align-top">
                <td className="py-2 pr-2 text-white">{l.kind === "invoice" ? <Link href={`/partner/sales/invoices/${l.refId}`} className="hover:underline">{l.description}</Link> : l.description}
                  {l.note && <span className="block text-[11px] text-amber-300">{l.note}</span>}</td>
                <td className="pr-2">{l.customer ?? "—"}</td>
                <td className="pr-2 text-right tabular-nums">{inr(l.amount)}</td>
                <td className="pr-2"><Chip tone={TONE[l.status]}>{l.status === "paid" && l.paidAt ? `paid ${new Date(l.paidAt).toLocaleDateString("en-IN")}` : l.status}</Chip></td>
                <td className="pr-2 text-right tabular-nums">{l.status === "paid" ? <>{inr(l.net)}<span className="block text-[11px] text-[hsl(215,20%,55%)]">fee {inr(l.fee)}</span></> : "—"}</td>
                <td className="whitespace-nowrap text-right">{l.status === "open" && <><Button size="sm" variant="ghost" onClick={() => copy(l.url)}>Copy</Button><Button size="sm" variant="ghost" onClick={() => cancel(l)}>Cancel</Button></>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </HubPage>
  );
}
