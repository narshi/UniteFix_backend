/**
 * Celebrations — staff side: review halls', photographers' and planners'
 * pages before they go public; feature them and set their commission;
 * follow the bookings that came through UniteFix; moderate reviews.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

type Listing = { businessPartnerId: number; kind: "venue" | "portfolio" | "events"; status: string; reviewNote: string | null; submittedAt: string | null; featured: boolean; commissionPercent: number | null; defaultCommission: number; name: string; code: string; city: string | null; partnerStatus: string; rating: { avg: number; count: number } | null };
type Booking = { id: number; kind: string; origin: string; partner: string; partnerCode: string; title: string; eventDate: string; status: string; total: number; paid: number; commissionPercent: number | null; commission: number | null; commissionChargedAt: string | null; cancelRequested: boolean };
type Review = { id: number; partner: string; kind: string; name: string; rating: number; body: string | null; reply: string | null; status: string; hiddenReason: string | null; eventDate: string | null; createdAt: string };

const KIND: Record<string, string> = { venue: "Hall", portfolio: "Photographer", events: "Planner", hall: "Hall", shoot: "Photography", event: "Event" };
const STATUS: Record<string, { label: string; v: "default" | "secondary" | "destructive" | "outline" }> = {
  submitted: { label: "To review", v: "default" }, live: { label: "Live", v: "secondary" }, changes_requested: { label: "Changes asked", v: "outline" }, paused: { label: "Paused", v: "destructive" }, draft: { label: "Draft", v: "outline" },
};
const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const pageUrl = (l: Listing) => (l.kind === "venue" ? `/halls/${l.code}` : l.kind === "portfolio" ? `/photographers/${l.code}` : `/events/${l.code}`);

export default function CelebrationsAdminPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"listings" | "bookings" | "reviews">("listings");
  const listings = useQuery<{ listings: Listing[]; defaults: Record<string, number> }>({ queryKey: ["/api/admin/hub/celebrations/listings"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/celebrations/listings")).data });
  const bookings = useQuery<Booking[]>({ queryKey: ["/api/admin/hub/celebrations/bookings"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/celebrations/bookings")).data, enabled: tab === "bookings" });
  const reviews = useQuery<Review[]>({ queryKey: ["/api/admin/hub/celebrations/reviews"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/celebrations/reviews")).data, enabled: tab === "reviews" });
  const act = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) => apiRequest("POST", path, body ?? {}),
    onSuccess: (r: any) => { ["/api/admin/hub/celebrations/listings", "/api/admin/hub/celebrations/reviews"].forEach(k => qc.invalidateQueries({ queryKey: [k] })); toast({ title: "Done", description: r?.message }); setNoteFor(null); setNote(""); },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const [noteFor, setNoteFor] = useState<{ l: Listing; decision: "changes" | "pause" } | null>(null);
  const [note, setNote] = useState("");
  const [rate, setRate] = useState<Record<string, string>>({});
  const all = listings.data?.listings ?? [];
  const queue = all.filter(l => l.status === "submitted");
  const rest = all.filter(l => l.status !== "submitted");
  const base = (l: Listing) => `/api/admin/hub/celebrations/listings/${l.businessPartnerId}/${l.kind}`;
  const key = (l: Listing) => `${l.businessPartnerId}:${l.kind}`;

  const Row = ({ l }: { l: Listing }) => (
    <TableRow>
      <TableCell><p className="font-medium">{l.name}</p><p className="text-xs text-muted-foreground">{KIND[l.kind]} · {l.code}{l.city ? ` · ${l.city}` : ""}{l.partnerStatus !== "active" ? ` · business ${l.partnerStatus}` : ""}</p>{l.reviewNote && <p className="mt-1 max-w-sm text-xs text-amber-300">Note: {l.reviewNote}</p>}</TableCell>
      <TableCell><Badge variant={STATUS[l.status]?.v ?? "outline"}>{STATUS[l.status]?.label ?? l.status}</Badge>{l.featured && <Badge className="ml-1" variant="secondary">Featured</Badge>}</TableCell>
      <TableCell className="text-sm">{l.rating ? `★ ${l.rating.avg} (${l.rating.count})` : "—"}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Input aria-label={`Commission for ${l.name}`} className="h-8 w-16" inputMode="decimal" placeholder={String(l.defaultCommission)} value={rate[key(l)] ?? (l.commissionPercent ?? "").toString()} onChange={e => setRate({ ...rate, [key(l)]: e.target.value })} />
          <span className="text-xs text-muted-foreground">%</span>
          <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `${base(l)}/commission`, body: { percent: rate[key(l)] === "" || rate[key(l)] == null ? null : Number(rate[key(l)]) } })}>Set</Button>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap justify-end gap-1">
          <a href={`${pageUrl(l)}?preview=admin&bp=${l.businessPartnerId}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-md border px-3 text-xs hover:bg-accent">Preview ↗</a>
          {(l.status === "submitted" || l.status === "changes_requested") && <Button size="sm" onClick={() => act.mutate({ path: `${base(l)}/review`, body: { decision: "approve" } })}>Approve</Button>}
          {(l.status === "submitted" || l.status === "live") && <Button size="sm" variant="outline" onClick={() => setNoteFor({ l, decision: "changes" })}>Ask for changes</Button>}
          {l.status === "live" && <Button size="sm" variant="outline" onClick={() => act.mutate({ path: `${base(l)}/feature`, body: { featured: !l.featured } })}>{l.featured ? "Unfeature" : "Feature"}</Button>}
          {l.status === "live" && <Button size="sm" variant="ghost" className="text-rose-400" onClick={() => setNoteFor({ l, decision: "pause" })}>Pause</Button>}
          {l.status === "paused" && <Button size="sm" variant="outline" onClick={() => act.mutate({ path: `${base(l)}/review`, body: { decision: "resume" } })}>Resume</Button>}
        </div>
      </TableCell>
    </TableRow>
  );

  const bk = bookings.data ?? [];
  const totals = bk.filter(b => b.status !== "cancelled").reduce((a, b) => ({ value: a.value + b.total, commission: a.commission + (b.commission ?? 0) }), { value: 0, commission: 0 });

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Celebrations</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">Halls, photographers and event planners in UniteFix Celebrations. A partner's page is public only once approved here — check that the photos are of their own property or work, capacities and claims are believable, and prices are clear. Default commission: halls {listings.data?.defaults.venue ?? 5}%, photographers {listings.data?.defaults.portfolio ?? 8}%, planners {listings.data?.defaults.events ?? 0}% (Settings → Business config). A rate set here applies to that partner's new bookings.</p>
      </div>
      <div className="flex gap-2" role="tablist">
        {(["listings", "bookings", "reviews"] as const).map(t => <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>{t === "listings" ? `Pages${queue.length ? ` (${queue.length} to review)` : ""}` : t === "bookings" ? "Bookings" : "Reviews"}</Button>)}
      </div>

      {tab === "listings" && <>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Waiting for review ({queue.length})</CardTitle></CardHeader>
          <CardContent className="p-0"><div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Partner</TableHead><TableHead>Status</TableHead><TableHead>Rating</TableHead><TableHead>Commission</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{queue.length ? queue.map(l => <Row key={key(l)} l={l} />) : <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">Nothing to review.</TableCell></TableRow>}</TableBody>
          </Table></div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base font-medium">All pages ({rest.length})</CardTitle></CardHeader>
          <CardContent className="p-0"><div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Partner</TableHead><TableHead>Status</TableHead><TableHead>Rating</TableHead><TableHead>Commission</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{rest.length ? rest.map(l => <Row key={key(l)} l={l} />) : <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No pages yet.</TableCell></TableRow>}</TableBody>
          </Table></div></CardContent>
        </Card>
      </>}

      {tab === "bookings" && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Bookings through UniteFix — {inr(totals.value)} booked, {inr(totals.commission)} commission charged</CardTitle></CardHeader>
          <CardContent className="p-0"><div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Booking</TableHead><TableHead>Partner</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Value / paid</TableHead><TableHead className="text-right">Commission</TableHead></TableRow></TableHeader>
            <TableBody>{bk.length ? bk.map(b => (
              <TableRow key={b.id}>
                <TableCell><p className="font-medium">{b.title}</p><p className="text-xs text-muted-foreground">{KIND[b.kind]} · #{b.id} · via {b.origin === "app" ? "app" : "web"}</p></TableCell>
                <TableCell className="text-sm">{b.partner}</TableCell>
                <TableCell className="text-sm">{b.eventDate}</TableCell>
                <TableCell><Badge variant={b.status === "cancelled" ? "destructive" : b.status === "pending" ? "outline" : "secondary"}>{b.status === "pending" ? "awaiting advance" : b.status}</Badge>{b.cancelRequested && b.status !== "cancelled" && <Badge className="ml-1" variant="destructive">cancel asked</Badge>}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{inr(b.total)}<span className="block text-xs text-muted-foreground">{inr(b.paid)} paid</span></TableCell>
                <TableCell className="text-right text-sm tabular-nums">{b.commission != null ? inr(b.commission) : b.commissionPercent ? `${b.commissionPercent}% after the event` : "—"}</TableCell>
              </TableRow>
            )) : <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No bookings yet.</TableCell></TableRow>}</TableBody>
          </Table></div></CardContent>
        </Card>
      )}

      {tab === "reviews" && (
        <div className="space-y-3">
          {(reviews.data ?? []).map(r => (
            <Card key={r.id}><CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-amber-400">{"★".repeat(r.rating)}<span className="text-muted-foreground/40">{"★".repeat(5 - r.rating)}</span> <span className="text-sm text-foreground">{r.partner}</span> <span className="text-xs text-muted-foreground">{KIND[r.kind]} · {r.name}{r.eventDate ? ` · ${r.eventDate}` : ""}</span></p>
                {r.body && <p className="mt-1 text-sm">{r.body}</p>}
                {r.reply && <p className="mt-1 text-xs text-muted-foreground">Reply: {r.reply}</p>}
                {r.status === "hidden" && <p className="mt-1 text-xs text-amber-300">Hidden: {r.hiddenReason}</p>}
              </div>
              {r.status === "published"
                ? <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt("Why hide this review? (abuse, personal details, not about the service…)"); if (reason) act.mutate({ path: `/api/admin/hub/celebrations/reviews/${r.id}`, body: { status: "hidden", reason } }); }}>Hide</Button>
                : <Button size="sm" variant="outline" onClick={() => act.mutate({ path: `/api/admin/hub/celebrations/reviews/${r.id}`, body: { status: "published" } })}>Publish again</Button>}
            </CardContent></Card>
          ))}
          {!reviews.data?.length && <p className="text-sm text-muted-foreground">No reviews yet.</p>}
        </div>
      )}

      <Dialog open={!!noteFor} onOpenChange={o => !o && setNoteFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{noteFor?.decision === "pause" ? "Pause this page" : "Ask for changes"}</DialogTitle><DialogDescription>{noteFor?.l.name} sees this note in their Hub.</DialogDescription></DialogHeader>
          <Textarea rows={4} aria-label="Note to the partner" value={note} onChange={e => setNote(e.target.value)} placeholder="The photos of the main hall look like stock images — please upload photos of your own property." />
          <DialogFooter><Button variant="outline" onClick={() => setNoteFor(null)}>Cancel</Button><Button disabled={note.trim().length < 5} onClick={() => noteFor && act.mutate({ path: `${base(noteFor.l)}/review`, body: { decision: noteFor.decision, note } })}>Send</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
