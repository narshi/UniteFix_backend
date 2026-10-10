/**
 * Newsroom — a newspaper's pages in the Hub.
 *
 *   Your paper     name, language, masthead; UniteFix's review; the follow link
 *                  and QR code to bring WhatsApp readers across
 *   Editions       upload the day's PDF — the browser makes the half-page
 *                  preview that shared links show; share each edition
 *   Archive plan   3 days are kept free; 30 days on a prepaid plan
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useHubMe, hubCan, inr, openAuthedPdf, razorpayCheckout } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty, Stat, HubSelect, Thead } from "@/components/hub/ui";
import { uploadPhoto } from "@/pages/hub/events-showcase";
import { previewOf } from "@/lib/pdf";

type Paper = { id: number; name: string; language: string; city: string | null; frequency: string; description: string | null; logoUrl: string | null; status: string; reviewNote: string | null; archiveUntil: string | null };
type Price = { months: number; pricePaise: number; gstPaise: number; totalPaise: number; gstRate: number; perMonthPaise: number };
type State = {
  paper: Paper | null; readiness: { ready: boolean; checks: Array<{ label: string; done: boolean }> }; stats: { followers: number; readsThisWeek: number; linkViewsThisWeek: number } | null;
  prices: Price[]; keepsDays: number; freeDays: number; archiveDays: number; archiveUntil: string | null; followUrl: string;
  languages: Array<{ value: string; label: string }>; frequencies: string[]; storage: "cloudinary" | "local" | "none"; maxMb: number;
};
type Edition = { id: number; editionDate: string; title: string; headline: string | null; pageCount: number; fileSize: number; previewUrl: string | null; publicToken: string; status: string; removedReason: string | null; reads: number; linkViews: number; publishedAt: string };
type Plan = { id: number; months: number; amountPaise: number; gstPaise: number; startsAt: string; endsAt: string; paidAt: string; invoiceDocumentId: number | null };

const muted = "text-[hsl(215,20%,62%)]";
const accent = "text-[hsl(174,72%,60%)]";
const KEY = ["/api/hub/news"];
const useNews = () => useQuery<State>({ queryKey: KEY, queryFn: async () => (await apiRequest("GET", "/api/hub/news")).data });
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
const abs = (p: string) => `${window.location.origin}${p}`;
const waShare = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

const STATUS: Record<string, { tone: string; label: string; text: string }> = {
  draft: { tone: "muted", label: "Not live yet", text: "Finish the checklist, then ask UniteFix to put your paper live." },
  submitted: { tone: "info", label: "With UniteFix", text: "UniteFix is reviewing your paper — usually within a working day. You can keep uploading editions meanwhile." },
  live: { tone: "good", label: "Live", text: "Readers can find, follow and read your paper in the UniteFix app." },
  changes_requested: { tone: "warn", label: "Changes needed", text: "UniteFix asked for changes before your paper goes live." },
  paused: { tone: "bad", label: "Paused", text: "UniteFix paused your paper. Readers cannot see it and new editions cannot be published." },
};

async function copy(text: string, toast: ReturnType<typeof useToast>["toast"]) {
  try { await navigator.clipboard.writeText(text); toast({ title: "Link copied" }); }
  catch { toast({ title: "Copy this link", description: text }); }
}

function StatusBanner({ s, onSubmit, busy, manage }: { s: State; onSubmit: () => void; busy: boolean; manage: boolean }) {
  const st = STATUS[s.paper?.status ?? "draft"] ?? STATUS.draft;
  const canSubmit = !!s.paper && ["draft", "changes_requested"].includes(s.paper.status);
  return (
    <Panel>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2"><Chip tone={st.tone}>{st.label}</Chip><span className="text-sm text-white">{st.text}</span></div>
          {s.paper?.reviewNote && ["changes_requested", "paused"].includes(s.paper.status) && <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">UniteFix: {s.paper.reviewNote}</p>}
          {s.paper?.status !== "live" && (
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {s.readiness.checks.map(c => <li key={c.label} className={c.done ? "text-emerald-300" : muted}><span aria-hidden="true">{c.done ? "✓" : "○"}</span> {c.label}</li>)}
            </ul>
          )}
        </div>
        {canSubmit && manage && <Button onClick={onSubmit} disabled={busy || !s.readiness.ready} title={s.readiness.ready ? undefined : "Finish the checklist first"}>Ask UniteFix to go live</Button>}
      </div>
    </Panel>
  );
}

export function HubNewsPaper() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
  const manage = hubCan(me, "settings:manage");
  const s = useNews();
  const [draft, setDraft] = useState<Partial<Paper> | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const followUrl = s.data ? abs(s.data.followUrl) : "";
  useEffect(() => { if (followUrl) QRCode.toDataURL(followUrl, { width: 640, margin: 2, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(null)); }, [followUrl]);
  if (!s.data) return <HubPage title="Your paper"><Panel><p className={muted}>Loading…</p></Panel></HubPage>;
  const p: Partial<Paper> = draft ?? s.data.paper ?? { language: "kannada", frequency: "daily" };
  const set = (x: Partial<Paper>) => setDraft({ ...p, ...x });
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const save = async () => {
    setBusy(true);
    try {
      await apiRequest("PUT", "/api/hub/news/paper", { name: p.name ?? "", language: p.language, city: p.city || null, frequency: p.frequency, description: p.description || null });
      setDraft(null); refresh(); toast({ title: "Saved" });
    } catch (e) { fail("Not saved")(e); } finally { setBusy(false); }
  };
  const submit = async () => { setBusy(true); try { await apiRequest("POST", "/api/hub/news/submit", {}); refresh(); toast({ title: "Sent to UniteFix" }); } catch (e) { fail("Not sent")(e); } finally { setBusy(false); } };
  const upLogo = async (f: File) => { setBusy(true); try { await uploadPhoto("/api/hub/news/logo", f); refresh(); toast({ title: "Masthead updated" }); } catch (e) { fail("Upload failed")(e); } finally { setBusy(false); } };
  const live = s.data.paper?.status === "live";
  const invite = `Read ${s.data.paper?.name ?? "our paper"} every day on the UniteFix app — free. Follow us here and get each new edition the moment it is out: ${followUrl}`;

  return (
    <HubPage title="Your paper" subtitle="How readers find your newspaper in the UniteFix app."
      actions={manage ? <Button onClick={save} disabled={!draft || busy}>{draft ? "Save changes" : "Saved"}</Button> : undefined}>
      {s.data.paper && <StatusBanner s={s.data} onSubmit={submit} busy={busy} manage={manage} />}
      {s.data.storage === "none" && <Panel><p className="text-sm text-amber-200">Edition storage is not set up on UniteFix yet, so uploads will fail. UniteFix has been told.</p></Panel>}
      {live && s.data.stats && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Followers" value={s.data.stats.followers.toLocaleString("en-IN")} hint="Readers who get your new editions" />
          <Stat label="Reads this week" value={s.data.stats.readsThisWeek.toLocaleString("en-IN")} hint="Each reader counted once an edition" />
          <Stat label="Shared-link views" value={s.data.stats.linkViewsThisWeek.toLocaleString("en-IN")} hint="People who opened a link this week" />
        </div>
      )}
      <Panel title="The paper">
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <div>
            <div className="grid aspect-[3/2] place-items-center overflow-hidden rounded-lg border border-white/10 bg-white">
              {s.data.paper?.logoUrl ? <img src={s.data.paper.logoUrl} alt="Masthead" className="max-h-full max-w-full object-contain p-2" /> : <span className="px-3 text-center text-xs text-slate-500">Your masthead, as it appears on page one</span>}
            </div>
            {manage && <Button size="sm" variant="outline" className="mt-2 w-full" disabled={busy || !s.data.paper} title={s.data.paper ? undefined : "Save the paper's name first"} onClick={() => logoRef.current?.click()}>{s.data.paper?.logoUrl ? "Change masthead" : "Upload masthead"}</Button>}
            <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upLogo(f); e.target.value = ""; }} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="n-name">Name, as readers know it</Label><Input id="n-name" maxLength={80} placeholder="ತತ್ತ್ವನಿಷ್ಠ Tattvanishtha" value={p.name ?? ""} onChange={e => set({ name: e.target.value })} disabled={!manage} /></div>
            <div><Label htmlFor="n-lang">Language</Label>
              <HubSelect id="n-lang" value={p.language ?? "kannada"} onChange={v => set({ language: v })} disabled={!manage}>{s.data.languages.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</HubSelect></div>
            <div><Label htmlFor="n-freq">Comes out</Label>
              <HubSelect id="n-freq" value={p.frequency ?? "daily"} onChange={v => set({ frequency: v })} disabled={!manage}>{s.data.frequencies.map(f => <option key={f} value={f}>{f[0].toUpperCase() + f.slice(1)}</option>)}</HubSelect></div>
            <div><Label htmlFor="n-city">City or district</Label><Input id="n-city" maxLength={60} placeholder="Karwar" value={p.city ?? ""} onChange={e => set({ city: e.target.value })} disabled={!manage} /></div>
            <div className="sm:col-span-2"><Label htmlFor="n-desc">About the paper</Label><Textarea id="n-desc" rows={3} maxLength={600} placeholder="Karwar's Kannada daily since 1998 — district news, ports, fisheries and local sport." value={p.description ?? ""} onChange={e => set({ description: e.target.value })} disabled={!manage} /></div>
          </div>
        </div>
      </Panel>
      {s.data.paper && (
        <Panel title="Bring your readers across">
          <div className="grid gap-5 md:grid-cols-[1fr_200px]">
            <div className="min-w-0 space-y-3 text-sm">
              <p className={muted}>Post this link in your WhatsApp groups. Readers who open it in the UniteFix app follow your paper in one tap and are notified of every new edition. {!live && <span className="text-amber-200">It works once your paper is live.</span>}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 max-w-full break-all rounded bg-white/5 px-2 py-1 text-xs text-white">{followUrl}</code>
                <Button size="sm" variant="outline" onClick={() => copy(followUrl, toast)}>Copy</Button>
                <Button size="sm" asChild><a href={waShare(invite)} target="_blank" rel="noreferrer">Share on WhatsApp</a></Button>
              </div>
              <p className={muted}>Print the QR code in your paper — "Scan to read us on UniteFix".</p>
            </div>
            <div className="text-center">
              {qr ? <img src={qr} alt="QR code for your follow link" className="mx-auto w-40 rounded bg-white p-1" /> : <div className={`grid h-40 place-items-center text-xs ${muted}`}>…</div>}
              {qr && <a href={qr} download={`unitefix-follow-${me?.partnerCode ?? "paper"}.png`} className={`mt-2 inline-block text-xs underline ${accent}`}>Download QR (PNG)</a>}
            </div>
          </div>
        </Panel>
      )}
    </HubPage>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Editions
// ══════════════════════════════════════════════════════════════════════════

function uploadWithProgress(fd: FormData, onProgress: (pct: number) => void) {
  return new Promise<any>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/hub/news/editions");
    x.setRequestHeader("Authorization", `Bearer ${localStorage.getItem("adminToken") ?? ""}`);
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    x.onload = () => {
      let body: any = null; try { body = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(body); else reject(new Error(body?.message ?? `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new Error("Upload failed — check your connection and try again."));
    x.send(fd);
  });
}

export function HubNewsEditions() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
  const manage = hubCan(me, "ops:manage");
  const s = useNews();
  const eds = useQuery<Edition[]>({ queryKey: ["/api/hub/news/editions"], queryFn: async () => (await apiRequest("GET", "/api/hub/news/editions")).data });
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [prev, setPrev] = useState<{ blob: Blob; url: string; pages: number } | null>(null);
  const [making, setMaking] = useState(false);
  const [form, setForm] = useState({ editionDate: istToday(), title: "Main edition", headline: "" });
  const [pct, setPct] = useState<number | null>(null);
  const [removing, setRemoving] = useState<Edition | null>(null);
  useEffect(() => () => { if (prev) URL.revokeObjectURL(prev.url); }, [prev]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/hub/news/editions"] }); qc.invalidateQueries({ queryKey: KEY }); };
  const choose = async (f: File) => {
    if (s.data && f.size > s.data.maxMb * 1048576) return toast({ title: "The PDF is too large", description: `It is ${mb(f.size)}. Up to ${s.data.maxMb} MB — export it at a lower image quality.`, variant: "destructive" });
    setFile(f); setPrev(null); setMaking(true);
    try { const r = await previewOf(f); setPrev({ blob: r.preview, url: URL.createObjectURL(r.preview), pages: r.pages }); }
    catch { toast({ title: "Could not read this PDF", description: "It may be damaged or password-protected. Export it again and retry.", variant: "destructive" }); setFile(null); }
    finally { setMaking(false); }
  };
  const publish = async () => {
    if (!file || !prev) return;
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("preview", prev.blob, "preview.jpg");
    fd.append("editionDate", form.editionDate);
    fd.append("title", form.title.trim() || "Main edition");
    if (form.headline.trim()) fd.append("headline", form.headline.trim());
    fd.append("pageCount", String(prev.pages));
    setPct(0);
    try {
      const r = await uploadWithProgress(fd, setPct);
      toast({ title: "Edition uploaded", description: r?.message });
      setFile(null); setPrev(null); setForm(f => ({ ...f, headline: "" })); refresh();
    } catch (e) { fail("Not uploaded")(e); } finally { setPct(null); }
  };
  const remove = async () => {
    if (!removing) return;
    try { await apiRequest("DELETE", `/api/hub/news/editions/${removing.id}`); toast({ title: "Edition removed" }); setRemoving(null); refresh(); }
    catch (e) { fail("Not removed")(e); }
  };
  if (!s.data) return <HubPage title="Editions"><Panel><p className={muted}>Loading…</p></Panel></HubPage>;
  if (!s.data.paper) return <HubPage title="Editions"><Empty icon="newspaper" title="Set up your paper first">Give it a name and language on <Link href="/partner/news" className={`underline ${accent}`}>Your paper</Link>, then upload editions here.</Empty></HubPage>;
  const name = s.data.paper.name;
  const minDate = (() => { const d = new Date(`${istToday()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (s.data.keepsDays - 1)); return d.toISOString().slice(0, 10); })();
  const maxDate = (() => { const d = new Date(`${istToday()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
  const list = eds.data ?? [];
  const uploading = pct !== null;

  return (
    <HubPage title="Editions" subtitle={<>Upload each day's PDF — the same file you send to WhatsApp. Readers can open the last <b className="text-white">{s.data.keepsDays} days</b>{s.data.keepsDays === s.data.freeDays && <> · <Link href="/partner/news/plan" className={`underline ${accent}`}>keep {s.data.archiveDays} days</Link></>}.</>}>
      {manage && (
        <Panel title="Upload an edition">
          <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>The PDF</Label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading || making}>{file ? "Choose another PDF" : "Choose PDF"}</Button>
                  {file && <span className="min-w-0 break-all text-sm text-white">{file.name} <span className={muted}>· {mb(file.size)}{prev ? ` · ${prev.pages} page${prev.pages === 1 ? "" : "s"}` : ""}</span></span>}
                  {!file && <span className={`text-xs ${muted}`}>Up to {s.data.maxMb} MB</span>}
                </div>
                <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) choose(f); e.target.value = ""; }} />
              </div>
              <div><Label htmlFor="e-date">Edition date</Label><Input id="e-date" type="date" min={minDate} max={maxDate} value={form.editionDate} onChange={e => setForm({ ...form, editionDate: e.target.value })} /></div>
              <div><Label htmlFor="e-title">Edition</Label><Input id="e-title" maxLength={60} placeholder="Main edition" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /><p className={`mt-1 text-xs ${muted}`}>Name city editions, e.g. "Sirsi edition".</p></div>
              <div className="sm:col-span-2"><Label htmlFor="e-head">Top headline (optional — shown in the notification and on shared links)</Label><Input id="e-head" maxLength={200} value={form.headline} onChange={e => setForm({ ...form, headline: e.target.value })} /></div>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Button onClick={publish} disabled={!file || !prev || uploading || making}>{uploading ? `Uploading… ${pct}%` : s.data.paper.status === "live" ? "Publish to readers" : "Upload"}</Button>
                {s.data.paper.status === "live" && <span className={`text-xs ${muted}`}>Your followers are notified of the day's first edition.</span>}
              </div>
            </div>
            <div>
              <Label>What a shared link shows</Label>
              <div className="mt-1 overflow-hidden rounded-lg border border-white/10 bg-white">
                {prev ? <img src={prev.url} alt="Top half of page one" className="w-full" /> : <div className="grid aspect-[4/3] place-items-center px-4 text-center text-xs text-slate-500">{making ? "Reading the PDF…" : "Choose the PDF — the top half of page one appears here"}</div>}
              </div>
              <p className={`mt-1 text-xs ${muted}`}>People who open a shared link see this, then are asked to install the app to read the rest.</p>
            </div>
          </div>
        </Panel>
      )}
      <Panel title="Recent editions">
        {eds.isLoading ? <p className={muted}>Loading…</p> : !list.length ? <Empty icon="newspaper" title="No editions yet">Upload today's paper above.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <Thead cols={["Date", "Edition", ["Pages", "right"], ["Reads", "right"], ["Link views", "right"], "", ""]} />
              <tbody className="divide-y divide-white/5">
                {list.map(e => {
                  const link = abs(`/news/e/${e.publicToken}`);
                  return (
                    <tr key={e.id} className="align-top">
                      <td className="whitespace-nowrap py-2 pr-3 text-white">{fmtDay(e.editionDate)}</td>
                      <td className="py-2 pr-3"><div className="text-white">{e.title}</div>{e.headline && <div className={`line-clamp-1 text-xs ${muted}`}>{e.headline}</div>}{e.removedReason && <div className="text-xs text-rose-300">{e.removedReason}</div>}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-white">{e.pageCount}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-white">{e.reads.toLocaleString("en-IN")}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-white">{e.linkViews.toLocaleString("en-IN")}</td>
                      <td className="py-2 pr-3"><Chip tone={e.status === "live" ? "good" : e.status === "removed" ? "bad" : "muted"}>{e.status === "live" ? "Live" : e.status === "removed" ? "Removed" : "Past its days"}</Chip></td>
                      <td className="py-2 text-right">
                        {e.status === "live" && (
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button size="sm" variant="ghost" asChild><a href={waShare(`${name} — ${fmtDay(e.editionDate)}${e.headline ? `\n${e.headline}` : ""}\n\nRead it on UniteFix: ${link}`)} target="_blank" rel="noreferrer">WhatsApp</a></Button>
                            <Button size="sm" variant="ghost" onClick={() => copy(link, toast)}>Copy link</Button>
                            {manage && <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => setRemoving(e)}>Remove</Button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Dialog open={!!removing} onOpenChange={o => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remove this edition?</DialogTitle>
            <DialogDescription>{removing && `${removing.title}, ${fmtDay(removing.editionDate)}. Readers can no longer open it and its shared links stop showing it. To correct a mistake, remove it and upload the fixed PDF.`}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setRemoving(null)}>Keep it</Button><Button variant="destructive" onClick={remove}>Remove edition</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Archive plan
// ══════════════════════════════════════════════════════════════════════════

export function HubNewsPlan() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
  const buyer = hubCan(me, "purchases:manage");
  const s = useNews();
  const plans = useQuery<Plan[]>({ queryKey: ["/api/hub/news/plans"], queryFn: async () => (await apiRequest("GET", "/api/hub/news/plans")).data });
  const [busy, setBusy] = useState<number | null>(null);
  const best = useMemo(() => s.data ? Math.min(...s.data.prices.map(p => p.perMonthPaise)) : 0, [s.data]);
  if (!s.data) return <HubPage title="Archive plan"><Panel><p className={muted}>Loading…</p></Panel></HubPage>;
  if (!s.data.paper) return <HubPage title="Archive plan"><Empty icon="newspaper" title="Set up your paper first">Give it a name on <Link href="/partner/news" className={`underline ${accent}`}>Your paper</Link>.</Empty></HubPage>;
  const refresh = () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["/api/hub/news/plans"] }); };
  const buy = async (months: number) => {
    setBusy(months);
    try {
      const r = (await apiRequest("POST", "/api/hub/news/plans", { months })).data;
      if (r.devActivated) { toast({ title: "Plan active", description: "Test mode — no payment was taken." }); refresh(); return; }
      const paid = await razorpayCheckout({ key: r.keyId, orderId: r.orderId, amountRupees: r.amount, description: r.description, name: me?.business?.contactName ?? undefined, email: me?.business?.contactEmail ?? undefined, phone: me?.business?.contactPhone });
      await apiRequest("POST", `/api/hub/news/plans/${r.planId}/confirm`, paid);
      toast({ title: "Payment received", description: "Your 30-day archive is on." });
      refresh();
    } catch (e) {
      if ((e as Error)?.message === "Payment cancelled.") toast({ title: "Payment cancelled" });
      else fail("Payment not completed")(e);
    } finally { setBusy(null); }
  };
  const on = !!s.data.archiveUntil;

  return (
    <HubPage title="Archive plan" subtitle={`Readers can open the last ${s.data.freeDays} days of your paper, free. A plan keeps ${s.data.archiveDays} days, so readers can catch up on the whole month.`}>
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <Chip tone={on ? "good" : "muted"}>{on ? `${s.data.archiveDays}-day archive` : `${s.data.freeDays} days (free)`}</Chip>
          <span className="text-sm text-white">{on ? <>Your archive runs until <b>{fmtDate(s.data.archiveUntil!)}</b>. Buying again adds on after that date.</> : <>Editions older than {s.data.freeDays} days are removed each day.</>}</span>
        </div>
      </Panel>
      <div className="grid gap-3 md:grid-cols-3">
        {s.data.prices.map(p => (
          <Panel key={p.months}>
            <div className="flex h-full flex-col gap-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold text-white">{p.months} month{p.months === 1 ? "" : "s"}</h3>
                {p.perMonthPaise === best && p.months > 1 && <Chip tone="info">Best value</Chip>}
              </div>
              <div><span className="text-3xl font-semibold tabular-nums text-white">₹{(p.pricePaise / 100).toLocaleString("en-IN")}</span> <span className={`text-sm ${muted}`}>+ {p.gstRate}% GST</span></div>
              <p className={`text-sm ${muted}`}>₹{(p.perMonthPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} a month · you pay {inr(p.totalPaise / 100)} with GST</p>
              <ul className="space-y-1 text-sm text-white"><li>✓ {s.data!.archiveDays} days of editions for readers</li><li>✓ GST invoice from UniteFix</li></ul>
              <div className="mt-auto pt-1">{buyer ? <Button className="w-full" onClick={() => buy(p.months)} disabled={busy !== null}>{busy === p.months ? "Opening payment…" : on ? "Add these months" : "Buy"}</Button> : <p className={`text-xs ${muted}`}>Ask your owner or manager to buy.</p>}</div>
            </div>
          </Panel>
        ))}
      </div>
      <Panel title="Paid plans">
        {!plans.data?.length ? <p className={`text-sm ${muted}`}>None yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <Thead cols={["Paid", "Plan", "Runs", ["Amount", "right"], ""]} />
              <tbody className="divide-y divide-white/5">
                {plans.data.map(pl => (
                  <tr key={pl.id}>
                    <td className="py-2 pr-3 text-white">{fmtDate(pl.paidAt)}</td>
                    <td className="py-2 pr-3 text-white">{pl.months} month{pl.months === 1 ? "" : "s"}</td>
                    <td className={`py-2 pr-3 ${muted}`}>{fmtDate(pl.startsAt)} – {fmtDate(pl.endsAt)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white">{inr((pl.amountPaise + pl.gstPaise) / 100)}</td>
                    <td className="py-2 text-right">{pl.invoiceDocumentId && <Button size="sm" variant="ghost" onClick={() => openAuthedPdf(`/api/hub/tax-documents/${pl.invoiceDocumentId}/pdf`).catch(fail("Could not open"))}>Invoice</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </HubPage>
  );
}
