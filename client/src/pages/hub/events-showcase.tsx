/**
 * Events — Your page. What clients see at /events/<code>: the cover and a few
 * words, photos of past events and Instagram posts, themes to choose from.
 * Venues and add-ons (photography, cakes…) come from Packages.
 */

import { useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useHubMe, hubCan, inr } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty, HubSelect } from "@/components/hub/ui";

type Showcase = { profile: { tagline?: string | null; about?: string | null; coverPhoto?: string | null; instagram?: string | null }; pageUrl: string; counts: { photos: number; instagram: number; themes: number; venues: number; addons: number } };
type GalleryItem = { id: number; kind: "photo" | "instagram"; url: string; embed: string | null; caption: string | null; themeId: number | null };
type Theme = { id: number; name: string; description: string | null; suitableFor: string | null; photos: string[]; price: number; gstRate: number; isActive: boolean };

/** Multipart upload with the Hub sign-in. */
export async function uploadPhoto(path: string, file: File, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("file", file);
  Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
  const res = await fetch(path, { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("adminToken") ?? ""}` }, body: fd });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? `Upload failed (${res.status})`);
  return body;
}

const igIcon = (
  <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor" /></svg>
);

export function HubEventShowcase() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
  const manage = hubCan(me, "settings:manage");
  const sc = useQuery<Showcase>({ queryKey: ["/api/hub/events/showcase"], queryFn: async () => (await apiRequest("GET", "/api/hub/events/showcase")).data });
  const gal = useQuery<GalleryItem[]>({ queryKey: ["/api/hub/events/gallery"], queryFn: async () => (await apiRequest("GET", "/api/hub/events/gallery")).data });
  const th = useQuery<Theme[]>({ queryKey: ["/api/hub/events/themes"], queryFn: async () => (await apiRequest("GET", "/api/hub/events/themes")).data });
  const refresh = () => ["/api/hub/events/showcase", "/api/hub/events/gallery", "/api/hub/events/themes"].forEach(k => qc.invalidateQueries({ queryKey: [k] }));

  // profile
  const [prof, setProf] = useState<Showcase["profile"] | null>(null);
  const p = prof ?? sc.data?.profile ?? {};
  const saveProfile = async () => { try { await apiRequest("PUT", "/api/hub/events/showcase", { tagline: p.tagline ?? null, about: p.about ?? null, instagram: p.instagram ?? null }); setProf(null); refresh(); toast({ title: "Saved" }); } catch (e) { fail("Not saved")(e); } };
  const coverRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const upCover = async (f: File) => { setBusy("cover"); try { await uploadPhoto("/api/hub/events/showcase/cover", f); refresh(); toast({ title: "Cover photo updated" }); } catch (e) { fail("Upload failed")(e); } finally { setBusy(null); } };

  // gallery
  const photoRef = useRef<HTMLInputElement>(null);
  const [ig, setIg] = useState("");
  const upPhotos = async (files: FileList) => {
    setBusy("gallery");
    let ok = 0;
    for (const f of Array.from(files).slice(0, 20)) { try { await uploadPhoto("/api/hub/events/gallery/upload", f); ok++; } catch (e) { fail(`${f.name} not added`)(e); } }
    setBusy(null); refresh(); if (ok) toast({ title: `${ok} photo${ok === 1 ? "" : "s"} added` });
  };
  const addIg = async () => { try { await apiRequest("POST", "/api/hub/events/gallery", { kind: "instagram", url: ig.trim() }); setIg(""); refresh(); toast({ title: "Instagram post added" }); } catch (e) { fail("Not added")(e); } };
  const removeItem = async (g: GalleryItem) => { try { await apiRequest("DELETE", `/api/hub/events/gallery/${g.id}`); refresh(); } catch (e) { fail("Not removed")(e); } };
  const tagTheme = async (g: GalleryItem, themeId: string) => { try { await apiRequest("PATCH", `/api/hub/events/gallery/${g.id}`, { themeId: themeId ? Number(themeId) : null }); refresh(); } catch (e) { fail("Not saved")(e); } };
  const move = async (i: number, d: -1 | 1) => {
    const list = [...(gal.data ?? [])]; const j = i + d; if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    try { await apiRequest("POST", "/api/hub/events/gallery/order", { ids: list.map(g => g.id) }); refresh(); } catch (e) { fail("Not moved")(e); }
  };

  // themes
  const blankTheme = { name: "", suitableFor: "", description: "", priceRupees: "0", gstRate: "18" };
  const [tf, setTf] = useState(blankTheme);
  const [editing, setEditing] = useState<Theme | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const themePhotoRef = useRef<HTMLInputElement>(null);
  const saveTheme = async () => {
    const body = { name: tf.name, suitableFor: tf.suitableFor || null, description: tf.description || null, priceRupees: Number(tf.priceRupees || 0), gstRate: Number(tf.gstRate) };
    try {
      const r: any = await apiRequest(editing ? "PATCH" : "POST", editing ? `/api/hub/events/themes/${editing.id}` : "/api/hub/events/themes", body);
      refresh(); setEditing(r.data); toast({ title: editing ? "Theme saved" : "Theme added — now add its photos" });
    } catch (e) { fail("Not saved")(e); }
  };
  const upThemePhoto = async (f: File) => { if (!editing) return; setBusy("theme"); try { const r = await uploadPhoto(`/api/hub/events/themes/${editing.id}/photos`, f); setEditing(r.data); refresh(); } catch (e) { fail("Upload failed")(e); } finally { setBusy(null); } };
  const removeThemePhoto = async (url: string) => { if (!editing) return; try { const r: any = await apiRequest("PATCH", `/api/hub/events/themes/${editing.id}`, { photos: editing.photos.filter(x => x !== url) }); setEditing(r.data); refresh(); } catch (e) { fail("Not removed")(e); } };

  const pageUrl = sc.data ? `${window.location.origin}${sc.data.pageUrl}` : "";
  const c = sc.data?.counts;
  const themes = th.data ?? [];

  return (
    <HubPage title="Your page" subtitle="What clients see when they open your link: your work, your venues and themes, and the add-ons they can include while building their event. Venues and add-ons come from Packages."
      actions={sc.data ? <a href={sc.data.pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-md border border-[rgba(255,255,255,0.15)] px-4 text-sm text-white hover:bg-white/5">Open your page ↗</a> : undefined}>
      {c && (
        <Panel>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <code className="break-all rounded bg-white/5 px-2 py-1 text-white">{pageUrl}</code>
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(pageUrl).catch(() => null); toast({ title: "Link copied" }); }}>Copy link</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip tone={c.photos + c.instagram ? "good" : "warn"}>{c.photos} photos · {c.instagram} Instagram</Chip>
            <Chip tone={c.themes ? "good" : "warn"}>{c.themes} themes</Chip>
            <Chip tone={c.venues ? "good" : "muted"}>{c.venues} venues</Chip>
            <Chip tone={c.addons ? "good" : "warn"}>{c.addons} add-ons</Chip>
            {(!c.venues || !c.addons) && <Link href="/partner/events/packages" className="text-xs text-[hsl(174,72%,60%)] hover:text-white">Add venues and add-ons in Packages →</Link>}
          </div>
        </Panel>
      )}

      <Panel title="Cover and introduction">
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div>
            <div className="aspect-[16/10] overflow-hidden rounded-lg bg-white/5">
              {p.coverPhoto ? <img src={p.coverPhoto} alt="Cover" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xs text-[hsl(215,20%,55%)]">No cover photo</div>}
            </div>
            {manage && <><Button size="sm" variant="outline" className="mt-2 w-full" disabled={busy === "cover"} onClick={() => coverRef.current?.click()}>{busy === "cover" ? "Uploading…" : p.coverPhoto ? "Change cover photo" : "Add cover photo"}</Button>
              <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upCover(f); e.target.value = ""; }} /></>}
          </div>
          <div className="grid gap-3">
            <div><Label htmlFor="sc-t">Tagline</Label><Input id="sc-t" disabled={!manage} placeholder="Weddings and birthdays across Uttara Kannada" value={p.tagline ?? ""} onChange={e => setProf({ ...p, tagline: e.target.value })} /></div>
            <div><Label htmlFor="sc-a">About you</Label><Textarea id="sc-a" disabled={!manage} rows={4} placeholder="How long you have been doing this, what you are known for, the areas you cover." value={p.about ?? ""} onChange={e => setProf({ ...p, about: e.target.value })} /></div>
            <div><Label htmlFor="sc-i">Instagram handle</Label><Input id="sc-i" disabled={!manage} placeholder="@yourbusiness" value={p.instagram ?? ""} onChange={e => setProf({ ...p, instagram: e.target.value })} /></div>
            {manage && <div><Button disabled={!prof} onClick={saveProfile}>Save</Button></div>}
          </div>
        </div>
      </Panel>

      <Panel title="Your work" actions={manage ? <Button size="sm" disabled={busy === "gallery"} onClick={() => photoRef.current?.click()}>{busy === "gallery" ? "Uploading…" : "Add photos"}</Button> : undefined}>
        <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={e => { if (e.target.files?.length) upPhotos(e.target.files); e.target.value = ""; }} />
        {manage && (
          <div className="mb-4 flex flex-wrap gap-2">
            <Input aria-label="Instagram post link" className="min-w-0 flex-1" placeholder="Paste an Instagram post or reel link — https://www.instagram.com/p/…" value={ig} onChange={e => setIg(e.target.value)} />
            <Button variant="outline" disabled={!/instagram\.com\/(.+\/)?(p|reel|reels|tv)\//.test(ig)} onClick={addIg}>Add Instagram post</Button>
          </div>
        )}
        {!(gal.data ?? []).length ? <Empty icon="photo_library" title="No photos yet">Add photos of events you have done, or paste links to your Instagram posts.</Empty> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {gal.data!.map((g, i) => (
              <li key={g.id} className="overflow-hidden rounded-lg border border-[rgba(255,255,255,0.08)]">
                <div className="aspect-square bg-white/5">
                  {g.kind === "photo" ? <img src={g.url} alt={g.caption ?? "Event photo"} className="h-full w-full object-cover" loading="lazy" />
                    : <a href={g.url} target="_blank" rel="noopener noreferrer" className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[hsla(330,70%,45%,0.25)] to-[hsla(38,90%,50%,0.18)] text-white">{igIcon}<span className="px-2 text-center text-xs">Instagram post</span></a>}
                </div>
                {manage && (
                  <div className="flex items-center gap-1 p-2">
                    <HubSelect aria-label="Theme" className="min-w-0 flex-1 text-xs" value={g.themeId ? String(g.themeId) : ""} onChange={v => tagTheme(g, v)}>
                      <option value="">No theme</option>{themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </HubSelect>
                    <button aria-label="Move earlier" className="px-1 text-[hsl(215,20%,65%)] hover:text-white disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>←</button>
                    <button aria-label="Move later" className="px-1 text-[hsl(215,20%,65%)] hover:text-white disabled:opacity-30" disabled={i === gal.data!.length - 1} onClick={() => move(i, 1)}>→</button>
                    <button aria-label="Remove" className="px-1 text-rose-300 hover:text-rose-200" onClick={() => removeItem(g)}>✕</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Themes" actions={manage ? <Button size="sm" onClick={() => { setEditing(null); setTf(blankTheme); setThemeOpen(true); }}>Add theme</Button> : undefined}>
        {!themes.length ? <Empty icon="palette" title="No themes yet">Add the décor themes you offer — Jungle safari, Pastel floral, Royal mandap — with photos and a price. Clients pick one while building their event.</Empty> : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map(t => (
              <li key={t.id} className={`overflow-hidden rounded-lg border border-[rgba(255,255,255,0.08)] ${t.isActive ? "" : "opacity-55"}`}>
                <div className="aspect-[16/10] bg-white/5">{t.photos[0] ? <img src={t.photos[0]} alt={t.name} className="h-full w-full object-cover" loading="lazy" /> : <div className="grid h-full place-items-center text-xs text-[hsl(215,20%,55%)]">No photos yet</div>}</div>
                <div className="p-3">
                  <div className="flex items-baseline justify-between gap-2"><span className="font-medium text-white">{t.name}</span><span className="text-sm tabular-nums text-white">{t.price ? inr(t.price) : "Included"}</span></div>
                  {t.suitableFor && <p className="text-xs text-[hsl(215,20%,60%)]">{t.suitableFor}</p>}
                  <p className="mt-1 text-xs text-[hsl(215,20%,55%)]">{t.photos.length} photo{t.photos.length === 1 ? "" : "s"}</p>
                  {manage && <div className="mt-2 flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(t); setTf({ name: t.name, suitableFor: t.suitableFor ?? "", description: t.description ?? "", priceRupees: String(t.price), gstRate: String(t.gstRate) }); setThemeOpen(true); }}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { try { await apiRequest("PATCH", `/api/hub/events/themes/${t.id}`, { isActive: !t.isActive }); refresh(); } catch (e) { fail("Not changed")(e); } }}>{t.isActive ? "Hide" : "Show"}</Button>
                  </div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Dialog open={themeOpen} onOpenChange={o => { setThemeOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Theme: ${editing.name}` : "Add a theme"}</DialogTitle><DialogDescription>Price is for the décor of this theme, before GST. Use 0 if it is included in your venue or package.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="th-n">Name</Label><Input id="th-n" placeholder="Jungle safari" value={tf.name} onChange={e => setTf({ ...tf, name: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="th-s">Suits</Label><Input id="th-s" placeholder="Kids' birthdays, baby showers" value={tf.suitableFor} onChange={e => setTf({ ...tf, suitableFor: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="th-d">What is included</Label><Textarea id="th-d" rows={3} placeholder="Balloon arch, animal cut-outs, green backdrop with name board, table décor" value={tf.description} onChange={e => setTf({ ...tf, description: e.target.value })} /></div>
            <div><Label htmlFor="th-p">Price ₹</Label><Input id="th-p" inputMode="decimal" value={tf.priceRupees} onChange={e => setTf({ ...tf, priceRupees: e.target.value })} /></div>
            {me?.business?.gstin && <div><Label htmlFor="th-g">GST %</Label><HubSelect id="th-g" className="w-full" value={tf.gstRate} onChange={v => setTf({ ...tf, gstRate: v })}>{[0, 5, 18].map(r => <option key={r} value={r}>{r}%</option>)}</HubSelect></div>}
          </div>
          {editing && (
            <div>
              <Label>Photos</Label>
              <div className="mt-1 grid grid-cols-4 gap-2">
                {editing.photos.map(u => (
                  <div key={u} className="relative aspect-square overflow-hidden rounded bg-white/5">
                    <img src={u} alt="" className="h-full w-full object-cover" />
                    <button aria-label="Remove photo" className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white" onClick={() => removeThemePhoto(u)}>✕</button>
                  </div>
                ))}
                {editing.photos.length < 8 && <button className="grid aspect-square place-items-center rounded border border-dashed border-[rgba(255,255,255,0.25)] text-xs text-[hsl(215,20%,70%)] hover:text-white" disabled={busy === "theme"} onClick={() => themePhotoRef.current?.click()}>{busy === "theme" ? "…" : "+ Photo"}</button>}
              </div>
              <input ref={themePhotoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upThemePhoto(f); e.target.value = ""; }} />
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => { setThemeOpen(false); setEditing(null); }}>Close</Button><Button onClick={saveTheme} disabled={tf.name.trim().length < 2}>{editing ? "Save" : "Add theme"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}
