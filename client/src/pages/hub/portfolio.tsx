/**
 * Portfolio — a photographer's pages in the Hub.
 *
 *   Portfolio page   cover, reel, bio, styles, where you travel, booking terms
 *   Albums           one story per event: photos, short clips, linked films;
 *                    star the best to feature them on the front
 *   Dates            your teams' calendar; block days you are away
 * Packages and extras are Events → Packages (tick "extra" for drone, album…).
 */

import { useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useHubMe, hubCan } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty, HubSelect } from "@/components/hub/ui";
import { uploadPhoto } from "@/pages/hub/events-showcase";
import { ListingBanner } from "@/pages/hub/venue";
import { PHOTO_STYLES, ALBUM_CATEGORIES, cancellationText } from "@shared/celebrations";

type Profile = {
  tagline?: string | null; about?: string | null; coverPhoto?: string | null; coverVideoId?: number | null; styles: string[]; travelAreas: string[]; languages: string[];
  since?: number | null; instagram?: string | null; youtube?: string | null; crews: number; deliveryDays?: number | null; holdHours: number; advancePercent: number; balanceDueDays: number;
  cancellation: Array<{ daysBefore: number; refundPercent: number }>;
};
type Album = { id: number; title: string; story: string | null; location: string | null; eventDate: string | null; category: string; cover: string | null; coverUrl: string | null; isPublished: boolean; photos: number; videos: number };
type Media = { id: number; albumId: number; kind: "photo" | "video" | "embed"; url: string; thumb: string | null; embed: string | null; provider: string | null; caption: string | null; featured: boolean; durationSec: number | null };
type State = { profile: Profile; albums: Album[]; clips: Media[]; listing: any; readiness: { ready: boolean; checks: Array<{ label: string; done: boolean }> }; pageUrl: string; commissionPercent: number };

const muted = "text-[hsl(215,20%,62%)]";
const useState2 = () => useQuery<State>({ queryKey: ["/api/hub/portfolio"], queryFn: async () => (await apiRequest("GET", "/api/hub/portfolio")).data });
const csv = (a: string[]) => a.join(", ");
const uncsv = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);

export function HubPortfolioPage() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
  const manage = hubCan(me, "settings:manage");
  const s = useState2();
  const [draft, setDraft] = useState<(Profile & { travel?: string; langs?: string }) | null>(null);
  const p = draft ?? (s.data ? { ...s.data.profile, travel: csv(s.data.profile.travelAreas), langs: csv(s.data.profile.languages) } : null);
  const set = (x: Partial<NonNullable<typeof p>>) => setDraft({ ...(p as any), ...x });
  const [busy, setBusy] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);
  if (!s.data || !p) return <HubPage title="Portfolio page"><Panel><p className={muted}>Loading…</p></Panel></HubPage>;
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/hub/portfolio"] });
  const save = async () => {
    setBusy(true);
    try {
      await apiRequest("PUT", "/api/hub/portfolio/profile", {
        tagline: p.tagline ?? null, about: p.about ?? null, coverVideoId: p.coverVideoId ?? null, styles: p.styles, travelAreas: uncsv(p.travel ?? ""), languages: uncsv(p.langs ?? ""),
        since: p.since ? Number(p.since) : null, instagram: p.instagram || null, youtube: p.youtube || null, crews: Number(p.crews), deliveryDays: p.deliveryDays ? Number(p.deliveryDays) : null,
        holdHours: Number(p.holdHours), advancePercent: Number(p.advancePercent), balanceDueDays: Number(p.balanceDueDays), cancellation: p.cancellation,
      });
      setDraft(null); refresh(); toast({ title: "Saved" });
    } catch (e) { fail("Not saved")(e); } finally { setBusy(false); }
  };
  const submit = async () => { setBusy(true); try { await apiRequest("POST", "/api/hub/portfolio/listing/submit", {}); refresh(); toast({ title: "Sent for review" }); } catch (e) { fail("Not submitted")(e); } finally { setBusy(false); } };
  const upCover = async (f: File) => { setBusy(true); try { await uploadPhoto("/api/hub/portfolio/cover", f); setDraft(null); refresh(); } catch (e) { fail("Upload failed")(e); } finally { setBusy(false); } };
  const tiers = [...p.cancellation].sort((a, b) => b.daysBefore - a.daysBefore);

  return (
    <HubPage title="Portfolio page" subtitle="Your page in UniteFix Celebrations. Albums carry your work; star your best shots there to feature them on the front. Packages and extras come from Events → Packages."
      actions={manage ? <Button onClick={save} disabled={!draft || busy}>{draft ? "Save changes" : "Saved"}</Button> : undefined}>
      <ListingBanner listing={s.data.listing} readiness={s.data.readiness} onSubmit={submit} busy={busy} pageUrl={s.data.pageUrl} previewUrl={`/photographers/${me?.partnerCode}?preview=1`} commission={s.data.commissionPercent} />
      <Panel title="Cover">
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div>
            <div className="aspect-[16/10] overflow-hidden rounded-lg bg-white/5">{p.coverPhoto ? <img src={p.coverPhoto} alt="Cover" className="h-full w-full object-cover" /> : <div className={`grid h-full place-items-center text-xs ${muted}`}>Your signature shot</div>}</div>
            {manage && <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => coverRef.current?.click()}>{p.coverPhoto ? "Change cover photo" : "Upload cover photo"}</Button>}
            <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upCover(f); e.target.value = ""; }} />
          </div>
          <div className="grid gap-3">
            <div><Label htmlFor="p-cv">Cover reel (plays silently behind your name)</Label>
              <HubSelect id="p-cv" value={String(p.coverVideoId ?? "")} onChange={x => set({ coverVideoId: x ? Number(x) : null })} disabled={!manage}>
                <option value="">No reel — show the cover photo</option>
                {s.data.clips.map(c => <option key={c.id} value={c.id}>{c.caption ?? `Clip #${c.id}`}{c.durationSec ? ` (${c.durationSec}s)` : ""}</option>)}
              </HubSelect>
              {!s.data.clips.length && <p className={`mt-1 text-xs ${muted}`}>Upload a short clip into any album to use it here.</p>}
            </div>
            <div><Label htmlFor="p-tag">Tagline</Label><Input id="p-tag" maxLength={120} placeholder="Candid weddings across coastal Karnataka" value={p.tagline ?? ""} onChange={e => set({ tagline: e.target.value })} disabled={!manage} /></div>
            <div><Label htmlFor="p-ab">About you</Label><Textarea id="p-ab" rows={4} maxLength={2000} value={p.about ?? ""} onChange={e => set({ about: e.target.value })} disabled={!manage} /></div>
          </div>
        </div>
      </Panel>
      <Panel title="What you shoot, and where">
        <div className="flex flex-wrap gap-2">
          {PHOTO_STYLES.map(st => { const on = p.styles.includes(st); return <button key={st} type="button" disabled={!manage} aria-pressed={on} onClick={() => set({ styles: on ? p.styles.filter(x => x !== st) : [...p.styles, st] })} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-[hsl(174,72%,45%)] bg-[hsla(174,72%,40%,0.15)] text-white" : `border-white/15 ${muted}`}`}>{on ? "✓ " : ""}{st}</button>; })}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="p-tr">Places you travel to (comma separated)</Label><Input id="p-tr" placeholder="Karwar, Goa, Udupi" value={p.travel ?? ""} onChange={e => set({ travel: e.target.value })} disabled={!manage} /></div>
          <div><Label htmlFor="p-la">Languages</Label><Input id="p-la" placeholder="Kannada, Konkani, English" value={p.langs ?? ""} onChange={e => set({ langs: e.target.value })} disabled={!manage} /></div>
          <div><Label htmlFor="p-si">Shooting since (year)</Label><Input id="p-si" inputMode="numeric" value={p.since ?? ""} onChange={e => set({ since: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null })} disabled={!manage} /></div>
          <div><Label htmlFor="p-cr">Teams that can shoot at the same time</Label><Input id="p-cr" inputMode="numeric" value={p.crews} onChange={e => set({ crews: Number(e.target.value.replace(/\D/g, "")) || 1 })} disabled={!manage} /></div>
          <div><Label htmlFor="p-ig">Instagram</Label><Input id="p-ig" placeholder="@yourstudio" value={p.instagram ?? ""} onChange={e => set({ instagram: e.target.value })} disabled={!manage} /></div>
          <div><Label htmlFor="p-yt">YouTube channel</Label><Input id="p-yt" placeholder="https://www.youtube.com/@yourstudio" value={p.youtube ?? ""} onChange={e => set({ youtube: e.target.value })} disabled={!manage} /></div>
        </div>
      </Panel>
      <Panel title="Booking terms">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="p-h">Hold a date while you quote (hours)</Label><Input id="p-h" inputMode="numeric" value={p.holdHours} onChange={e => set({ holdHours: Number(e.target.value.replace(/\D/g, "")) })} disabled={!manage} /></div>
            <div><Label htmlFor="p-d">Photos delivered within (days)</Label><Input id="p-d" inputMode="numeric" value={p.deliveryDays ?? ""} onChange={e => set({ deliveryDays: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null })} disabled={!manage} /></div>
            <div><Label htmlFor="p-a">Advance to confirm (%)</Label><Input id="p-a" inputMode="numeric" value={p.advancePercent} onChange={e => set({ advancePercent: Number(e.target.value.replace(/\D/g, "")) })} disabled={!manage} /></div>
            <div><Label htmlFor="p-b">Balance due (days before)</Label><Input id="p-b" inputMode="numeric" value={p.balanceDueDays} onChange={e => set({ balanceDueDays: Number(e.target.value.replace(/\D/g, "")) })} disabled={!manage} /></div>
          </div>
          <div>
            <Label>Cancellation</Label>
            <div className="mt-1 space-y-2">{tiers.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm text-white">
                <Input aria-label="Days before" className="w-20" inputMode="numeric" value={t.daysBefore} disabled={!manage || t.daysBefore === 0} onChange={e => set({ cancellation: tiers.map((x, j) => j === i ? { ...x, daysBefore: Number(e.target.value.replace(/\D/g, "")) } : x) })} />
                <span className={muted}>{t.daysBefore === 0 ? "days or later" : "+ days before:"}</span>
                <Input aria-label="Refund percent" className="w-20" inputMode="numeric" value={t.refundPercent} disabled={!manage} onChange={e => set({ cancellation: tiers.map((x, j) => j === i ? { ...x, refundPercent: Number(e.target.value.replace(/\D/g, "")) } : x) })} />
                <span className={muted}>% refund</span>
              </div>
            ))}</div>
            <ul className={`mt-2 list-disc pl-5 text-xs ${muted}`}>{cancellationText(tiers).map(t => <li key={t}>{t}</li>)}</ul>
          </div>
        </div>
      </Panel>
    </HubPage>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Albums
// ══════════════════════════════════════════════════════════════════════════

export function HubPortfolioAlbums() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const manage = hubCan(me, "settings:manage");
  const s = useState2();
  const [, go] = useLocation();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", category: "wedding", location: "", eventDate: "", story: "" });
  const create = async () => {
    try { const r: any = await apiRequest("POST", "/api/hub/portfolio/albums", { title: f.title, category: f.category, location: f.location || null, eventDate: f.eventDate || null, story: f.story || null }); qc.invalidateQueries({ queryKey: ["/api/hub/portfolio"] }); setOpen(false); go(`/partner/portfolio/albums/${r.data.id}`); }
    catch (e) { toast({ title: "Not created", description: apiErrorMessage(e), variant: "destructive" }); }
  };
  return (
    <HubPage title="Albums" subtitle="Tell each event as a story. Upload your best photos (not the whole shoot — 20 to 40 tells it beautifully), short clips up to a minute, and link longer films from YouTube or Vimeo."
      actions={manage ? <Button onClick={() => { setF({ title: "", category: "wedding", location: "", eventDate: "", story: "" }); setOpen(true); }}>New album</Button> : undefined}>
      {!s.data?.albums.length ? <Empty icon="photo_library" title="No albums yet">Start with your favourite wedding of the last year.</Empty> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {s.data.albums.map(a => (
            <Link key={a.id} href={`/partner/portfolio/albums/${a.id}`} className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] hover:border-white/25">
              <div className="aspect-[4/3] bg-white/5">{a.cover ? <img src={a.cover} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className={`grid h-full place-items-center text-xs ${muted}`}>Empty album</div>}</div>
              <div className="p-3">
                <p className="truncate font-medium text-white">{a.title}</p>
                <p className={`text-xs ${muted}`}>{ALBUM_CATEGORIES.find(c => c[0] === a.category)?.[1]}{a.location ? ` · ${a.location}` : ""} · {a.photos} photos{a.videos ? ` · ${a.videos} films` : ""}</p>
                {!a.isPublished && <Chip tone="muted">Hidden</Chip>}
              </div>
            </Link>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New album</DialogTitle><DialogDescription>One event, one story.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="a-t">Title</Label><Input id="a-t" maxLength={100} placeholder="Priya & Arjun, Gokarna" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
            <div><Label htmlFor="a-c">Category</Label><HubSelect id="a-c" value={f.category} onChange={x => setF({ ...f, category: x })}>{ALBUM_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</HubSelect></div>
            <div><Label htmlFor="a-l">Place</Label><Input id="a-l" maxLength={100} value={f.location} onChange={e => setF({ ...f, location: e.target.value })} /></div>
            <div><Label htmlFor="a-d">Date</Label><Input id="a-d" type="date" value={f.eventDate} onChange={e => setF({ ...f, eventDate: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="a-s">The story</Label><Textarea id="a-s" rows={3} maxLength={3000} value={f.story} onChange={e => setF({ ...f, story: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={f.title.trim().length < 2} onClick={create}>Create and add photos</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

export function HubPortfolioAlbum() {
  const [, params] = useRoute("/partner/portfolio/albums/:id");
  const id = Number(params?.id);
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
  const manage = hubCan(me, "settings:manage");
  const [, go] = useLocation();
  const q = useQuery<{ album: Album; media: Media[] }>({ queryKey: ["/api/hub/portfolio/albums", id], queryFn: async () => (await apiRequest("GET", `/api/hub/portfolio/albums/${id}/media`)).data, enabled: !!id });
  const [edit, setEdit] = useState<Partial<Album> | null>(null);
  const [film, setFilm] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const clipRef = useRef<HTMLInputElement>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/hub/portfolio/albums", id] }); qc.invalidateQueries({ queryKey: ["/api/hub/portfolio"] }); };
  const a = edit ? { ...q.data?.album, ...edit } as Album : q.data?.album;
  const media = q.data?.media ?? [];
  const featuredCount = useMemo(() => media.filter(m => m.featured).length, [media]);
  if (!a) return <HubPage title="Album"><Panel><p className={muted}>Loading…</p></Panel></HubPage>;

  const upPhotos = async (files: FileList) => {
    const list = Array.from(files).slice(0, 60); let ok = 0;
    for (let i = 0; i < list.length; i++) {
      setProgress(`Uploading ${i + 1} of ${list.length}…`);
      try { await uploadPhoto(`/api/hub/portfolio/albums/${id}/photos`, list[i]); ok++; } catch (e) { fail(`${list[i].name} not added`)(e); if (/Up to/.test(String((e as Error).message))) break; }
    }
    setProgress(null); refresh(); if (ok) toast({ title: `${ok} photo${ok === 1 ? "" : "s"} added` });
  };
  const upClip = async (file: File) => {
    if (file.size > 60 * 1024 * 1024) { toast({ title: "That clip is too big", description: "Up to 60 MB and a minute long. Put longer films on YouTube or Vimeo and add the link.", variant: "destructive" }); return; }
    setProgress("Uploading clip — this can take a minute…");
    try { await uploadPhoto(`/api/hub/portfolio/albums/${id}/clips`, file); toast({ title: "Clip added" }); refresh(); } catch (e) { fail("Clip not added")(e); } finally { setProgress(null); }
  };
  const addFilm = async () => { try { await apiRequest("POST", `/api/hub/portfolio/albums/${id}/films`, { url: film.trim() }); setFilm(""); refresh(); toast({ title: "Film added" }); } catch (e) { fail("Not added")(e); } };
  const patchMedia = async (m: Media, body: Record<string, unknown>) => { try { await apiRequest("PATCH", `/api/hub/portfolio/media/${m.id}`, body); refresh(); } catch (e) { fail("Not saved")(e); } };
  const remove = async (m: Media) => { try { await apiRequest("DELETE", `/api/hub/portfolio/media/${m.id}`); refresh(); } catch (e) { fail("Not removed")(e); } };
  const move = async (i: number, d: -1 | 1) => { const l = [...media]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; try { await apiRequest("POST", `/api/hub/portfolio/albums/${id}/order`, { ids: l.map(x => x.id) }); refresh(); } catch (e) { fail("Not moved")(e); } };
  const saveAlbum = async (body: Record<string, unknown>) => { try { await apiRequest("PATCH", `/api/hub/portfolio/albums/${id}`, body); setEdit(null); refresh(); toast({ title: "Saved" }); } catch (e) { fail("Not saved")(e); } };
  const delAlbum = async () => { if (!window.confirm(`Delete "${a.title}" and everything in it?`)) return; try { await apiRequest("DELETE", `/api/hub/portfolio/albums/${id}`); qc.invalidateQueries({ queryKey: ["/api/hub/portfolio"] }); go("/partner/portfolio/albums"); } catch (e) { fail("Not deleted")(e); } };

  return (
    <HubPage title={a.title} subtitle={`${media.filter(m => m.kind === "photo").length} photos · ${media.filter(m => m.kind !== "photo").length} films · ${featuredCount} featured on your front page`}
      actions={<><Link href="/partner/portfolio/albums" className="self-center text-sm text-[hsl(174,72%,60%)] hover:text-white">← Albums</Link>{manage && <Button variant="ghost" className="text-rose-300" onClick={delAlbum}>Delete album</Button>}</>}>
      <Panel title="The story">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor="al-t">Title</Label><Input id="al-t" value={a.title} disabled={!manage} onChange={e => setEdit({ ...edit, title: e.target.value })} /></div>
          <div><Label htmlFor="al-c">Category</Label><HubSelect id="al-c" value={a.category} disabled={!manage} onChange={x => setEdit({ ...edit, category: x })}>{ALBUM_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</HubSelect></div>
          <div><Label htmlFor="al-l">Place</Label><Input id="al-l" value={a.location ?? ""} disabled={!manage} onChange={e => setEdit({ ...edit, location: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label htmlFor="al-s">Story</Label><Textarea id="al-s" rows={3} value={a.story ?? ""} disabled={!manage} onChange={e => setEdit({ ...edit, story: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm text-white"><input type="checkbox" checked={a.isPublished} disabled={!manage} onChange={e => saveAlbum({ isPublished: e.target.checked })} /> Show on your page</label>
          {edit && <div className="flex justify-end sm:col-span-1"><Button onClick={() => saveAlbum({ title: a.title, category: a.category, location: a.location || null, story: a.story || null })}>Save</Button></div>}
        </div>
      </Panel>
      {manage && (
        <Panel title="Add to this album">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => photoRef.current?.click()} disabled={!!progress}>Upload photos</Button>
            <Button variant="outline" onClick={() => clipRef.current?.click()} disabled={!!progress}>Upload a short clip</Button>
            <Input aria-label="Film link" className="w-80" placeholder="YouTube / Vimeo / Instagram link to a film" value={film} onChange={e => setFilm(e.target.value)} />
            <Button variant="outline" disabled={!film.trim()} onClick={addFilm}>Add film</Button>
            {progress && <span className="text-sm text-amber-200">{progress}</span>}
          </div>
          <p className={`mt-2 text-xs ${muted}`}>Photos: JPG, PNG or WebP, up to 12 MB each — we resize them for every screen. Clips: up to a minute and 60 MB. Full films: link them.</p>
          <input ref={photoRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { if (e.target.files?.length) upPhotos(e.target.files); e.target.value = ""; }} />
          <input ref={clipRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={e => { const x = e.target.files?.[0]; if (x) upClip(x); e.target.value = ""; }} />
        </Panel>
      )}
      {!media.length ? <Empty icon="add_photo_alternate" title="Nothing here yet">Upload the photos that tell this day best.</Empty> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((m, i) => (
            <div key={m.id} className={`overflow-hidden rounded-lg border ${m.featured ? "border-amber-400/60" : "border-white/10"} bg-white/[0.02]`}>
              <div className="relative aspect-square bg-black/30">
                {m.kind === "photo" ? <img src={m.url} alt={m.caption ?? ""} className="h-full w-full object-cover" loading="lazy" />
                  : m.thumb ? <img src={m.thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className={`grid h-full place-items-center text-xs ${muted}`}>{m.provider ?? "clip"}</div>}
                {m.kind !== "photo" && <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 text-[10px] text-white">▶ {m.kind === "video" ? `Clip${m.durationSec ? ` ${m.durationSec}s` : ""}` : m.provider}</span>}
                {a.coverUrl === m.url && <span className="absolute right-1 top-1 rounded bg-black/70 px-1.5 text-[10px] text-white">Album cover</span>}
              </div>
              {manage && (
                <div className="space-y-1 p-2">
                  <Input aria-label="Caption" className="h-8 text-xs" placeholder="Caption" defaultValue={m.caption ?? ""} onBlur={e => e.target.value !== (m.caption ?? "") && patchMedia(m, { caption: e.target.value || null })} />
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    <button className={`rounded px-1.5 py-0.5 ${m.featured ? "bg-amber-400/20 text-amber-200" : "bg-white/5 text-white"}`} aria-pressed={m.featured} onClick={() => patchMedia(m, { featured: !m.featured })}>★ {m.featured ? "Featured" : "Feature"}</button>
                    {m.kind === "photo" && a.coverUrl !== m.url && <button className="rounded bg-white/5 px-1.5 py-0.5 text-white" onClick={() => saveAlbum({ coverUrl: m.url })}>Cover</button>}
                    <button aria-label="Move earlier" className="rounded bg-white/5 px-1.5 py-0.5 text-white" onClick={() => move(i, -1)}>←</button>
                    <button aria-label="Move later" className="rounded bg-white/5 px-1.5 py-0.5 text-white" onClick={() => move(i, 1)}>→</button>
                    <button aria-label="Remove" className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-rose-300" onClick={() => remove(m)}>✕</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </HubPage>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Dates
// ══════════════════════════════════════════════════════════════════════════

type PCal = { month: string; crews: number; days: Array<{ day: string; closed: boolean; am: number; pm: number }>; entries: Array<{ id: number; crew: number; day: string; part: string; status: string; note: string | null; bookingId: number | null; enquiryId: number | null; holdExpiresAt: string | null }> };
const monthAdd = (m: string, n: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export function HubPortfolioDates() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const manage = hubCan(me, "ops:manage");
  const [month, setMonth] = useState(today().slice(0, 7));
  const q = useQuery<PCal>({ queryKey: ["/api/hub/portfolio/calendar", month], queryFn: async () => (await apiRequest("GET", `/api/hub/portfolio/calendar?month=${month}`)).data });
  const [block, setBlock] = useState<{ from: string; to: string; slot: string; note: string } | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/hub/portfolio/calendar"] });
  const doBlock = async () => { if (!block) return; try { await apiRequest("POST", "/api/hub/portfolio/calendar/block", { ...block, to: block.to || block.from, note: block.note || null }); setBlock(null); refresh(); toast({ title: "Blocked" }); } catch (e) { toast({ title: "Not blocked", description: apiErrorMessage(e), variant: "destructive" }); } };
  const unblock = async (ids: number[]) => { try { await apiRequest("POST", "/api/hub/portfolio/calendar/unblock", { ids }); refresh(); setDay(null); } catch (e) { toast({ title: "Not unblocked", description: apiErrorMessage(e), variant: "destructive" }); } };
  const d = q.data;
  const lead = d?.days[0] ? new Date(`${d.days[0].day}T00:00:00Z`).getUTCDay() : 0;
  const ofDay = (x: string) => (d?.entries ?? []).filter(e => e.day === x);
  return (
    <HubPage title="Dates" subtitle={`Your ${d?.crews ?? 1} team${(d?.crews ?? 1) === 1 ? "" : "s"}' calendar. A request holds a team for the date while you quote; confirming the booking books it. Block days you are away or booked elsewhere.`}
      actions={manage ? <Button onClick={() => setBlock({ from: today(), to: "", slot: "full", note: "" })}>Block dates</Button> : undefined}>
      <Panel>
        <div className="mb-4 flex items-center gap-2">
          <Button size="sm" variant="outline" aria-label="Previous month" onClick={() => setMonth(monthAdd(month, -1))}>‹</Button>
          <p className="w-40 text-center font-medium text-white">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
          <Button size="sm" variant="outline" aria-label="Next month" onClick={() => setMonth(monthAdd(month, 1))}>›</Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(x => <div key={x} className={`py-1 ${muted}`}>{x}</div>)}
          {Array.from({ length: lead }).map((_, i) => <div key={i} />)}
          {(d?.days ?? []).map(x => {
            const es = ofDay(x.day); const booked = es.filter(e => e.status === "booked").length, held = es.filter(e => e.status === "hold").length, blocked = es.filter(e => e.status === "blocked").length;
            return (
              <button key={x.day} onClick={() => setDay(x.day)} className={`min-h-[64px] rounded-md border border-white/10 p-1 text-left ${x.day < today() ? "opacity-50" : "hover:bg-white/5"}`}>
                <span className="text-white">{Number(x.day.slice(8))}</span>
                <div className="mt-1 flex flex-wrap gap-0.5">
                  {booked > 0 && <span className="rounded bg-emerald-500/70 px-1 text-[10px] text-white">{booked} booked</span>}
                  {held > 0 && <span className="rounded bg-amber-400/70 px-1 text-[10px] text-black">{held} held</span>}
                  {blocked > 0 && <span className="rounded bg-slate-500/70 px-1 text-[10px] text-white">away</span>}
                </div>
              </button>
            );
          })}
        </div>
        <p className={`mt-2 text-xs ${muted}`}>Counts are half-days (morning / evening) across your teams.</p>
      </Panel>
      <Dialog open={!!day} onOpenChange={o => !o && setDay(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{day}</DialogTitle><DialogDescription>Who has your teams that day.</DialogDescription></DialogHeader>
          {day && (ofDay(day).length ? <ul className="space-y-1 text-sm text-white">{ofDay(day).map(e => <li key={e.id} className="flex items-center justify-between gap-2"><span>Team {e.crew} · {e.part === "am" ? "Morning" : "Evening"} · {e.status}{e.note ? ` — ${e.note}` : ""}</span>{e.bookingId ? <Link href={`/partner/events/bookings/${e.bookingId}`} className="text-[hsl(174,72%,60%)]">Booking</Link> : e.status === "blocked" && manage ? <button className="text-xs text-rose-300" onClick={() => unblock([e.id])}>Unblock</button> : null}</li>)}</ul> : <p className={muted}>Free.</p>)}
          <DialogFooter>{manage && day && <Button onClick={() => { setBlock({ from: day, to: "", slot: "full", note: "" }); setDay(null); }}>Block this day</Button>}</DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!block} onOpenChange={o => !o && setBlock(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Block dates</DialogTitle><DialogDescription>Every team is blocked; clients see the dates as taken.</DialogDescription></DialogHeader>
          {block && <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="pb-f">From</Label><Input id="pb-f" type="date" value={block.from} onChange={e => setBlock({ ...block, from: e.target.value })} /></div>
            <div><Label htmlFor="pb-t">To (optional)</Label><Input id="pb-t" type="date" min={block.from} value={block.to} onChange={e => setBlock({ ...block, to: e.target.value })} /></div>
            <div><Label htmlFor="pb-s">Part of day</Label><HubSelect id="pb-s" value={block.slot} onChange={x => setBlock({ ...block, slot: x })}><option value="full">Full day</option><option value="am">Morning</option><option value="pm">Evening</option></HubSelect></div>
            <div><Label htmlFor="pb-n">Note</Label><Input id="pb-n" maxLength={200} value={block.note} onChange={e => setBlock({ ...block, note: e.target.value })} /></div>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setBlock(null)}>Cancel</Button><Button onClick={doBlock}>Block</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}
