/**
 * Newspapers — staff side: review papers before readers see them, pause one
 * that breaks the rules, read and take down editions, and see archive plans
 * paid for.
 */

import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

type Paper = {
  id: number; name: string; language: string; city: string | null; logoUrl: string | null; status: string; reviewNote: string | null; partner: string; code: string; partnerStatus: string;
  archiveUntil: string | null; keepsDays: number; liveEditions: number; lastEdition: string | null; followers: number; readsThisWeek: number; linkViewsThisWeek: number;
};
type Edition = { id: number; editionDate: string; title: string; headline: string | null; pageCount: number; fileSize: number; publicToken: string; status: string; removedReason: string | null; reads: number; linkViews: number };
type PlanRow = { plan: { id: number; months: number; amountPaise: number; gstPaise: number; startsAt: string; endsAt: string; paidAt: string; razorpayPaymentId: string | null }; paper: string };

const STATUS: Record<string, { label: string; v: "default" | "secondary" | "destructive" | "outline" }> = {
  submitted: { label: "To review", v: "default" }, live: { label: "Live", v: "secondary" }, changes_requested: { label: "Changes asked", v: "outline" }, paused: { label: "Paused", v: "destructive" }, draft: { label: "Draft", v: "outline" },
};
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const date = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function NewsAdminPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"papers" | "plans">("papers");
  const [open, setOpen] = useState<number | null>(null);
  const [noteFor, setNoteFor] = useState<{ p: Paper; decision: "changes" | "pause" } | null>(null);
  const [takedown, setTakedown] = useState<Edition | null>(null);
  const [text, setText] = useState("");
  const papers = useQuery<{ papers: Paper[]; storage: string }>({ queryKey: ["/api/admin/hub/news/papers"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/news/papers")).data });
  const editions = useQuery<Edition[]>({ queryKey: ["/api/admin/hub/news/papers", open, "editions"], queryFn: async () => (await apiRequest("GET", `/api/admin/hub/news/papers/${open}/editions`)).data, enabled: open !== null });
  const plans = useQuery<PlanRow[]>({ queryKey: ["/api/admin/hub/news/plans"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/news/plans")).data, enabled: tab === "plans" });
  const act = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) => apiRequest("POST", path, body ?? {}),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ["/api/admin/hub/news/papers"] }); toast({ title: "Done", description: r?.message }); setNoteFor(null); setTakedown(null); setText(""); },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const read = async (e: Edition) => {
    try { const r = (await apiRequest("POST", `/api/admin/hub/news/editions/${e.id}/read`, {})).data; window.open(r.url, "_blank", "noopener"); }
    catch (err) { toast({ title: "Could not open", description: apiErrorMessage(err), variant: "destructive" }); }
  };
  const all = papers.data?.papers ?? [];
  const queue = all.filter(p => p.status === "submitted");
  const review = (p: Paper, decision: string) => act.mutate({ path: `/api/admin/hub/news/papers/${p.id}/review`, body: { decision } });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Newspapers</h1>
          <p className="text-sm text-muted-foreground">Local papers publishing to UniteFix readers. Approve a paper before readers see it; take down an edition that breaks the law or the media annex.</p>
        </div>
        <div className="flex gap-1">
          {(["papers", "plans"] as const).map(t => <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>{t === "papers" ? `Papers${queue.length ? ` (${queue.length} to review)` : ""}` : "Archive plans"}</Button>)}
        </div>
      </div>
      {papers.data?.storage === "none" && <Card className="border-amber-500/40"><CardContent className="py-4 text-sm text-amber-300">Edition storage is not configured (Cloudinary keys missing). Papers cannot upload editions until it is.</CardContent></Card>}

      {tab === "papers" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Papers</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {!all.length ? <p className="text-sm text-muted-foreground">{papers.isLoading ? "Loading…" : "No papers yet. A newspaper joins as a business partner of type \"Newspapers & Media\"."}</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Paper</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Editions</TableHead><TableHead className="text-right">Followers</TableHead><TableHead className="text-right">Reads (7 days)</TableHead><TableHead>Keeps</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {[...queue, ...all.filter(p => p.status !== "submitted")].map(p => (
                    <Fragment key={p.id}>
                      <TableRow>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {p.logoUrl ? <img src={p.logoUrl} alt="" className="h-9 w-14 rounded bg-white object-contain p-0.5" /> : <div className="h-9 w-14 rounded bg-muted" />}
                            <div className="min-w-0"><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.partner} · {p.code} · {p.language}{p.city ? ` · ${p.city}` : ""}{p.partnerStatus !== "active" ? ` · business ${p.partnerStatus}` : ""}</p>
                              {p.reviewNote && <p className="mt-1 max-w-sm text-xs text-amber-300">Note: {p.reviewNote}</p>}</div>
                          </div>
                        </TableCell>
                        <TableCell><Badge variant={STATUS[p.status]?.v ?? "outline"}>{STATUS[p.status]?.label ?? p.status}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{p.liveEditions}{p.lastEdition && <span className="block text-xs text-muted-foreground">last {day(p.lastEdition)}</span>}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.followers.toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.readsThisWeek.toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-sm">{p.keepsDays} days{p.archiveUntil && p.keepsDays > 3 && <span className="block text-xs text-muted-foreground">plan to {date(p.archiveUntil)}</span>}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "Hide editions" : "Editions"}</Button>
                            {["submitted", "changes_requested", "draft"].includes(p.status) && <Button size="sm" onClick={() => review(p, "approve")} disabled={act.isPending}>Approve</Button>}
                            {p.status === "submitted" && <Button size="sm" variant="outline" onClick={() => setNoteFor({ p, decision: "changes" })}>Ask for changes</Button>}
                            {p.status === "live" && <Button size="sm" variant="outline" className="text-red-400" onClick={() => setNoteFor({ p, decision: "pause" })}>Pause</Button>}
                            {p.status === "paused" && <Button size="sm" variant="outline" onClick={() => review(p, "resume")} disabled={act.isPending}>Resume</Button>}
                          </div>
                        </TableCell>
                      </TableRow>
                      {open === p.id && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/30">
                            {!editions.data ? <p className="text-sm text-muted-foreground">Loading…</p> : !editions.data.length ? <p className="text-sm text-muted-foreground">No editions.</p> : (
                              <ul className="divide-y divide-border">
                                {editions.data.map(e => (
                                  <li key={e.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                                    <span className="w-16 tabular-nums">{day(e.editionDate)}</span>
                                    <span className="min-w-0 flex-1">{e.title}{e.headline && <span className="block truncate text-xs text-muted-foreground">{e.headline}</span>}{e.removedReason && <span className="block text-xs text-red-400">{e.removedReason}</span>}</span>
                                    <span className="text-xs text-muted-foreground">{e.pageCount} pp · {(e.fileSize / 1048576).toFixed(1)} MB · {e.reads} reads · {e.linkViews} link views</span>
                                    <Badge variant={e.status === "live" ? "secondary" : "outline"}>{e.status}</Badge>
                                    {e.status === "live" && <>
                                      <Button size="sm" variant="ghost" onClick={() => read(e)}>Read</Button>
                                      <Button size="sm" variant="ghost" asChild><a href={`/news/e/${e.publicToken}`} target="_blank" rel="noreferrer">Shared view</a></Button>
                                      <Button size="sm" variant="ghost" className="text-red-400" onClick={() => setTakedown(e)}>Take down</Button>
                                    </>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "plans" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Archive plans paid</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {!plans.data?.length ? <p className="text-sm text-muted-foreground">{plans.isLoading ? "Loading…" : "None yet."}</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Paid</TableHead><TableHead>Paper</TableHead><TableHead>Plan</TableHead><TableHead>Runs</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">GST</TableHead><TableHead>Payment</TableHead></TableRow></TableHeader>
                <TableBody>
                  {plans.data.map(r => (
                    <TableRow key={r.plan.id}>
                      <TableCell>{date(r.plan.paidAt)}</TableCell><TableCell>{r.paper}</TableCell><TableCell>{r.plan.months} month{r.plan.months === 1 ? "" : "s"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{date(r.plan.startsAt)} – {date(r.plan.endsAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupees(r.plan.amountPaise)}</TableCell><TableCell className="text-right tabular-nums">{rupees(r.plan.gstPaise)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.plan.razorpayPaymentId ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!noteFor} onOpenChange={o => { if (!o) { setNoteFor(null); setText(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{noteFor?.decision === "pause" ? `Pause ${noteFor?.p.name}?` : `Ask ${noteFor?.p.name} for changes`}</DialogTitle>
            <DialogDescription>{noteFor?.decision === "pause" ? "Readers stop seeing the paper and it cannot publish until you resume it. The paper sees your note." : "The paper sees your note in its Hub and can ask again once it has made the changes."}</DialogDescription></DialogHeader>
          <Textarea rows={4} maxLength={500} placeholder={noteFor?.decision === "pause" ? "Why it is paused, and what would let it resume" : "What to change"} value={text} onChange={e => setText(e.target.value)} />
          <DialogFooter><Button variant="outline" onClick={() => setNoteFor(null)}>Cancel</Button>
            <Button variant={noteFor?.decision === "pause" ? "destructive" : "default"} disabled={!text.trim() || act.isPending} onClick={() => noteFor && act.mutate({ path: `/api/admin/hub/news/papers/${noteFor.p.id}/review`, body: { decision: noteFor.decision, note: text.trim() } })}>{noteFor?.decision === "pause" ? "Pause paper" : "Send"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!takedown} onOpenChange={o => { if (!o) { setTakedown(null); setText(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Take this edition down?</DialogTitle>
            <DialogDescription>{takedown && `${takedown.title}, ${day(takedown.editionDate)}. The file is deleted, readers can no longer open it, and the paper is told why.`}</DialogDescription></DialogHeader>
          <Textarea rows={3} maxLength={300} placeholder="The reason the paper will see" value={text} onChange={e => setText(e.target.value)} />
          <DialogFooter><Button variant="outline" onClick={() => setTakedown(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!text.trim() || act.isPending} onClick={() => takedown && act.mutate({ path: `/api/admin/hub/news/editions/${takedown.id}/takedown`, body: { reason: text.trim() } })}>Take down</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
