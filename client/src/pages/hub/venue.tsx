/**
 * Venue — a hall partner's pages in the Hub.
 *
 *   Hall page & policies   what clients see, and the booking terms
 *   Spaces & rates         main hall, mini hall, lawn: capacity, photos, rents
 *   Calendar               who has which date; block your own
 *   Requests               confirm-first halls answer requests here
 *   Reviews                (shared with photographers and planners)
 */

import { useMemo, useRef, useState } from "react";
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
import { uploadPhoto } from "@/pages/hub/events-showcase";
import { AMENITIES, SPACE_KINDS, SLOT_LABEL, cancellationText } from "@shared/celebrations";

type Slot = "am" | "pm" | "full";
type DayType = "weekday" | "weekend" | "peak";
type Profile = {
  tagline?: string | null; about?: string | null; coverPhoto?: string | null; videoUrl?: string | null; address?: string | null; mapUrl?: string | null;
  amenities: string[]; rooms?: number | null; parking?: number | null; catering?: "in_house" | "outside" | "both" | null;
  rules?: { vegOnly?: boolean; alcohol?: "no" | "allowed" | "licensed"; outsideCaterers?: boolean; outsideDecorators?: boolean; musicUntil?: string | null; notes?: string | null } | null;
  slots: { am: { from: string; to: string }; pm: { from: string; to: string } }; weekendDays: number[]; peakDates: Array<{ date: string; label: string | null }>;
  advancePercent: number; balanceDueDays: number; depositRupees: number; cancellation: Array<{ daysBefore: number; refundPercent: number }>; instantBooking: boolean; holdHours: number;
};
type Space = {
  id: number; name: string; kind: string; description: string | null; seated: number | null; floating: number | null; areaSqft: number | null; photos: string[]; videoUrl: string | null;
  features: string[]; included: string | null; sac: string; gstRate: number; isActive: boolean; offered: Slot[]; from: number | null; ratesRupees: Partial<Record<DayType, Partial<Record<Slot, number>>>>;
};
type Listing = { status: "draft" | "submitted" | "live" | "changes_requested" | "paused"; reviewNote: string | null; submittedAt: string | null; featured: boolean };
type VenueState = { profile: Profile; spaces: Space[]; pageUrl: string; listing: Listing; readiness: { ready: boolean; checks: Array<{ label: string; done: boolean }> }; commissionPercent: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const muted = "text-[hsl(215,20%,62%)]";
const useVenue = () => useQuery<VenueState>({ queryKey: ["/api/hub/venue"], queryFn: async () => (await apiRequest("GET", "/api/hub/venue")).data });
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export function ListingBanner({ listing, readiness, onSubmit, pageUrl, previewUrl, commission, busy }: {
  listing: Listing; readiness: { ready: boolean; checks: Array<{ label: string; done: boolean }> }; onSubmit: () => void; pageUrl: string; previewUrl: string; commission: number; busy?: boolean;
}) {
  const tone = listing.status === "live" ? "good" : listing.status === "submitted" ? "info" : listing.status === "draft" ? "muted" : "warn";
  const label = { draft: "Not submitted", submitted: "With UniteFix for review", live: "Live in Celebrations", changes_requested: "Changes requested", paused: "Paused by UniteFix" }[listing.status];
  const full = `${window.location.origin}${pageUrl}`;
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2"><Chip tone={tone}>{label}</Chip>{listing.featured && <Chip tone="info">Featured</Chip>}<span className={`text-xs ${muted}`}>Commission {commission}% on bookings that come through UniteFix</span></div>
          {listing.reviewNote && listing.status !== "live" && <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm text-amber-200">UniteFix: “{listing.reviewNote}”</p>}
          {listing.status === "live"
            ? <div className="flex flex-wrap items-center gap-2 text-sm"><code className="break-all rounded bg-white/5 px-2 py-1 text-white">{full}</code><Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(full).catch(() => null)}>Copy link</Button></div>
            : <ul className="grid gap-1 text-sm sm:grid-cols-2">{readiness.checks.map(c => <li key={c.label} className={c.done ? "text-emerald-300" : muted}>{c.done ? "✓" : "○"} {c.label}</li>)}</ul>}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center rounded-md border border-[rgba(255,255,255,0.15)] px-3 text-sm text-white hover:bg-white/5">Preview ↗</a>
          {(listing.status === "draft" || listing.status === "changes_requested") && <Button size="sm" disabled={!readiness.ready || busy} onClick={onSubmit}>Submit for review</Button>}
        </div>
      </div>
    </Panel>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Hall page & policies
// ══════════════════════════════════════════════════════════════════════════

export function HubVenuePage() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
  const manage = hubCan(me, "settings:manage");
  const v = useVenue();
  const [draft, setDraft] = useState<Profile | null>(null);
  const p = draft ?? v.data?.profile;
  const set = (patch: Partial<Profile>) => setDraft({ ...(p as Profile), ...patch });
  const [busy, setBusy] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);
  const [peak, setPeak] = useState({ date: "", label: "" });

  if (!v.data || !p) return <HubPage title="Hall page & policies"><Panel><p className={muted}>Loading…</p></Panel></HubPage>;
  const save = async () => {
    setBusy(true);
    try {
      await apiRequest("PUT", "/api/hub/venue/profile", {
        tagline: p.tagline ?? null, about: p.about ?? null, address: p.address ?? null, mapUrl: p.mapUrl || null, videoUrl: p.videoUrl || null, amenities: p.amenities,
        rooms: p.rooms ?? null, parking: p.parking ?? null, catering: p.catering ?? null, rules: p.rules ?? {}, slots: p.slots, weekendDays: p.weekendDays, peakDates: p.peakDates,
        advancePercent: Number(p.advancePercent), balanceDueDays: Number(p.balanceDueDays), depositRupees: Number(p.depositRupees || 0), cancellation: p.cancellation, instantBooking: p.instantBooking, holdHours: Number(p.holdHours),
      });
      setDraft(null); qc.invalidateQueries({ queryKey: ["/api/hub/venue"] }); toast({ title: "Saved" });
    } catch (e) { fail("Not saved")(e); } finally { setBusy(false); }
  };
  const submit = async () => { setBusy(true); try { await apiRequest("POST", "/api/hub/venue/listing/submit", {}); qc.invalidateQueries({ queryKey: ["/api/hub/venue"] }); toast({ title: "Sent for review", description: "UniteFix checks new pages within two working days." }); } catch (e) { fail("Not submitted")(e); } finally { setBusy(false); } };
  const upCover = async (f: File) => { setBusy(true); try { await uploadPhoto("/api/hub/venue/cover", f); qc.invalidateQueries({ queryKey: ["/api/hub/venue"] }); setDraft(null); toast({ title: "Cover photo updated" }); } catch (e) { fail("Upload failed")(e); } finally { setBusy(false); } };
  const rules = p.rules ?? {};
  const tiers = [...p.cancellation].sort((a, b) => b.daysBefore - a.daysBefore);
  const dirty = !!draft;

  return (
    <HubPage title="Hall page & policies" subtitle="Your page in UniteFix Celebrations — what clients see, and the terms every booking follows. Spaces and their rents are on Spaces & rates; add-ons (catering per plate, décor, generator) come from Events → Packages."
      actions={manage ? <Button onClick={save} disabled={!dirty || busy}>{dirty ? "Save changes" : "Saved"}</Button> : undefined}>
      <ListingBanner listing={v.data.listing} readiness={v.data.readiness} onSubmit={submit} busy={busy} pageUrl={v.data.pageUrl} previewUrl={`/halls/${me?.partnerCode}?preview=1`} commission={v.data.commissionPercent} />

      <Panel title="Cover and introduction">
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <div>
            <div className="aspect-[16/10] overflow-hidden rounded-lg bg-white/5">
              {p.coverPhoto ? <img src={p.coverPhoto} alt="Cover" className="h-full w-full object-cover" /> : <div className={`grid h-full place-items-center text-xs ${muted}`}>No cover photo — your best wide shot of the hall</div>}
            </div>
            {manage && <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => coverRef.current?.click()}>{p.coverPhoto ? "Change cover" : "Upload cover"}</Button>}
            <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upCover(f); e.target.value = ""; }} />
          </div>
          <div className="grid gap-3">
            <div><Label htmlFor="v-tag">Tagline</Label><Input id="v-tag" maxLength={120} placeholder="A 600-guest AC hall with a garden lawn, 2 km from the bus stand" value={p.tagline ?? ""} onChange={e => set({ tagline: e.target.value })} disabled={!manage} /></div>
            <div><Label htmlFor="v-about">About the property</Label><Textarea id="v-about" rows={4} maxLength={2000} placeholder="What makes it special, how many weddings you have hosted, what is nearby…" value={p.about ?? ""} onChange={e => set({ about: e.target.value })} disabled={!manage} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="v-addr">Address</Label><Input id="v-addr" maxLength={300} value={p.address ?? ""} onChange={e => set({ address: e.target.value })} disabled={!manage} /></div>
              <div><Label htmlFor="v-map">Google Maps link</Label><Input id="v-map" placeholder="https://maps.app.goo.gl/…" value={p.mapUrl ?? ""} onChange={e => set({ mapUrl: e.target.value })} disabled={!manage} /></div>
            </div>
            <div><Label htmlFor="v-vid">Video tour (YouTube, Vimeo or Instagram link)</Label><Input id="v-vid" placeholder="https://www.youtube.com/watch?v=…" value={p.videoUrl ?? ""} onChange={e => set({ videoUrl: e.target.value })} disabled={!manage} /></div>
          </div>
        </div>
      </Panel>

      <Panel title="Amenities">
        <div className="flex flex-wrap gap-2">
          {AMENITIES.map(a => {
            const on = p.amenities.includes(a);
            return <button key={a} type="button" disabled={!manage} aria-pressed={on} onClick={() => set({ amenities: on ? p.amenities.filter(x => x !== a) : [...p.amenities, a] })}
              className={`rounded-full border px-3 py-1 text-sm ${on ? "border-[hsl(174,72%,45%)] bg-[hsla(174,72%,40%,0.15)] text-white" : `border-white/15 ${muted} hover:text-white`}`}>{on ? "✓ " : ""}{a}</button>;
          })}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div><Label htmlFor="v-rooms">Guest rooms</Label><Input id="v-rooms" inputMode="numeric" value={p.rooms ?? ""} onChange={e => set({ rooms: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null })} disabled={!manage} /></div>
          <div><Label htmlFor="v-park">Car parking (cars)</Label><Input id="v-park" inputMode="numeric" value={p.parking ?? ""} onChange={e => set({ parking: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null })} disabled={!manage} /></div>
          <div><Label htmlFor="v-cat">Catering</Label>
            <HubSelect id="v-cat" value={p.catering ?? ""} onChange={x => set({ catering: (x || null) as Profile["catering"] })} disabled={!manage}>
              <option value="">Not said</option><option value="in_house">In-house only</option><option value="outside">Bring your own caterer</option><option value="both">In-house or your own</option>
            </HubSelect>
          </div>
        </div>
      </Panel>

      <Panel title="House rules">
        <div className="grid gap-3 sm:grid-cols-2">
          {([["vegOnly", "Vegetarian food only"], ["outsideCaterers", "Outside caterers allowed"], ["outsideDecorators", "Outside decorators allowed"]] as const).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm text-white"><input type="checkbox" checked={!!rules[k]} disabled={!manage} onChange={e => set({ rules: { ...rules, [k]: e.target.checked } })} /> {l}</label>
          ))}
          <div className="flex items-center gap-2"><Label htmlFor="v-alc" className="shrink-0">Alcohol</Label>
            <HubSelect id="v-alc" value={rules.alcohol ?? "no"} onChange={x => set({ rules: { ...rules, alcohol: x as "no" } })} disabled={!manage}><option value="no">Not allowed</option><option value="allowed">Allowed</option><option value="licensed">With a licence only</option></HubSelect>
          </div>
          <div><Label htmlFor="v-music">Music until</Label><Input id="v-music" type="time" value={rules.musicUntil ?? ""} onChange={e => set({ rules: { ...rules, musicUntil: e.target.value || null } })} disabled={!manage} /></div>
          <div className="sm:col-span-2"><Label htmlFor="v-rn">Other rules</Label><Textarea id="v-rn" rows={2} maxLength={600} placeholder="No firecrackers inside the premises. Decoration set-up from 6 am." value={rules.notes ?? ""} onChange={e => set({ rules: { ...rules, notes: e.target.value } })} disabled={!manage} /></div>
        </div>
      </Panel>

      <Panel title="Time slots and kinds of day">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {(["am", "pm"] as const).map(s => (
              <div key={s}><Label>{SLOT_LABEL[s]} slot</Label>
                <div className="flex items-center gap-2"><Input type="time" aria-label={`${SLOT_LABEL[s]} from`} value={p.slots[s].from} disabled={!manage} onChange={e => set({ slots: { ...p.slots, [s]: { ...p.slots[s], from: e.target.value } } })} /><span className={muted}>to</span><Input type="time" aria-label={`${SLOT_LABEL[s]} to`} value={p.slots[s].to} disabled={!manage} onChange={e => set({ slots: { ...p.slots, [s]: { ...p.slots[s], to: e.target.value } } })} /></div>
              </div>
            ))}
            <p className={`text-xs sm:col-span-2 ${muted}`}>A full day runs from the morning start to the evening end.</p>
          </div>
          <div>
            <Label>Weekend days (charged at your weekend rent)</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d, i) => { const on = p.weekendDays.includes(i); return <button key={d} type="button" disabled={!manage} aria-pressed={on} onClick={() => set({ weekendDays: on ? p.weekendDays.filter(x => x !== i) : [...p.weekendDays, i].sort() })} className={`h-9 w-12 rounded-md border text-sm ${on ? "border-[hsl(174,72%,45%)] bg-[hsla(174,72%,40%,0.15)] text-white" : `border-white/15 ${muted}`}`}>{d}</button>; })}
            </div>
          </div>
        </div>
        <div className="mt-5">
          <Label>Peak dates — muhurtham days, festivals (charged at your peak rent)</Label>
          {manage && (
            <div className="mt-1 flex flex-wrap items-end gap-2">
              <Input type="date" aria-label="Peak date" className="w-44" min={istToday()} value={peak.date} onChange={e => setPeak({ ...peak, date: e.target.value })} />
              <Input aria-label="What day it is" className="w-56" placeholder="Muhurtham, Diwali…" maxLength={60} value={peak.label} onChange={e => setPeak({ ...peak, label: e.target.value })} />
              <Button size="sm" variant="outline" disabled={!peak.date || p.peakDates.some(x => x.date === peak.date)} onClick={() => { set({ peakDates: [...p.peakDates, { date: peak.date, label: peak.label || null }].sort((a, b) => a.date.localeCompare(b.date)) }); setPeak({ date: "", label: "" }); }}>Add</Button>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.peakDates.filter(x => x.date >= istToday()).length === 0 && <span className={`text-sm ${muted}`}>No peak dates ahead.</span>}
            {p.peakDates.filter(x => x.date >= istToday()).map(x => (
              <span key={x.date} className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-200">
                {new Date(`${x.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}{x.label ? ` · ${x.label}` : ""}
                {manage && <button aria-label={`Remove ${x.date}`} className="ml-1 text-amber-100 hover:text-white" onClick={() => set({ peakDates: p.peakDates.filter(y => y.date !== x.date) })}>✕</button>}
              </span>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Booking terms">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm text-white">
              <input type="checkbox" className="mt-1" checked={p.instantBooking} disabled={!manage} onChange={e => set({ instantBooking: e.target.checked })} />
              <span>Instant booking<span className={`block text-xs ${muted}`}>{p.instantBooking ? "Clients book a free date and pay the advance straight away. Keep your calendar current." : "Clients send a request; you accept or decline while the date is held for them."}</span></span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="v-hold">Hold a date for (hours)</Label><Input id="v-hold" inputMode="numeric" value={p.holdHours} disabled={!manage} onChange={e => set({ holdHours: Number(e.target.value.replace(/\D/g, "")) })} /><p className={`mt-1 text-xs ${muted}`}>{p.instantBooking ? "Time to pay the advance." : "Time for you to answer."}</p></div>
              <div><Label htmlFor="v-adv">Advance to confirm (%)</Label><Input id="v-adv" inputMode="numeric" value={p.advancePercent} disabled={!manage} onChange={e => set({ advancePercent: Number(e.target.value.replace(/\D/g, "")) })} /></div>
              <div><Label htmlFor="v-bal">Balance due (days before)</Label><Input id="v-bal" inputMode="numeric" value={p.balanceDueDays} disabled={!manage} onChange={e => set({ balanceDueDays: Number(e.target.value.replace(/\D/g, "")) })} /></div>
              <div><Label htmlFor="v-dep">Refundable deposit (₹)</Label><Input id="v-dep" inputMode="numeric" value={p.depositRupees} disabled={!manage} onChange={e => set({ depositRupees: Number(e.target.value.replace(/\D/g, "")) })} /><p className={`mt-1 text-xs ${muted}`}>You collect and return it yourself; it is recorded on each booking.</p></div>
            </div>
          </div>
          <div>
            <Label>Cancellation</Label>
            <div className="mt-1 space-y-2">
              {tiers.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm text-white">
                  <span className={muted}>If cancelled</span>
                  <Input aria-label="Days before" className="w-20" inputMode="numeric" value={t.daysBefore} disabled={!manage || t.daysBefore === 0} onChange={e => set({ cancellation: tiers.map((x, j) => j === i ? { ...x, daysBefore: Number(e.target.value.replace(/\D/g, "")) } : x) })} />
                  <span className={muted}>{t.daysBefore === 0 ? "days (or later)" : "+ days before:"}</span>
                  <Input aria-label="Refund percent" className="w-20" inputMode="numeric" value={t.refundPercent} disabled={!manage} onChange={e => set({ cancellation: tiers.map((x, j) => j === i ? { ...x, refundPercent: Number(e.target.value.replace(/\D/g, "")) } : x) })} />
                  <span className={muted}>% refund</span>
                  {manage && t.daysBefore !== 0 && <button className="text-xs text-rose-300 hover:text-white" onClick={() => set({ cancellation: tiers.filter((_, j) => j !== i) })}>Remove</button>}
                </div>
              ))}
              {manage && tiers.length < 6 && <Button size="sm" variant="outline" onClick={() => set({ cancellation: [...tiers, { daysBefore: (tiers[0]?.daysBefore ?? 30) + 30, refundPercent: 100 }] })}>Add a rule</Button>}
              <ul className={`mt-2 list-disc pl-5 text-xs ${muted}`}>{cancellationText(tiers).map(t => <li key={t}>{t}</li>)}</ul>
            </div>
          </div>
        </div>
      </Panel>
      {manage && dirty && <div className="sticky bottom-4 flex justify-end"><Button onClick={save} disabled={busy} className="shadow-lg">Save changes</Button></div>}
    </HubPage>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Spaces & rates
// ══════════════════════════════════════════════════════════════════════════

const blankSpace = { name: "", kind: "hall", description: "", seated: "", floating: "", areaSqft: "", videoUrl: "", features: "", included: "", gstRate: "18", sac: "997212", isActive: true,
  rates: { weekday: { am: "", pm: "", full: "" }, weekend: { am: "", pm: "", full: "" }, peak: { am: "", pm: "", full: "" } } as Record<DayType, Record<Slot, string>> };

export function HubVenueSpaces() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
  const manage = hubCan(me, "settings:manage");
  const v = useVenue();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [f, setF] = useState(blankSpace);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const live = editId ? v.data?.spaces.find(s => s.id === editId) ?? null : null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/hub/venue"] });

  const edit = (s: Space | null) => {
    setEditId(s?.id ?? null);
    const r = (t: DayType, sl: Slot) => (s?.ratesRupees?.[t]?.[sl] != null ? String(s.ratesRupees[t]![sl]) : "");
    setF(s ? {
      name: s.name, kind: s.kind, description: s.description ?? "", seated: s.seated ? String(s.seated) : "", floating: s.floating ? String(s.floating) : "", areaSqft: s.areaSqft ? String(s.areaSqft) : "",
      videoUrl: s.videoUrl ?? "", features: s.features.join(", "), included: s.included ?? "", gstRate: String(s.gstRate), sac: s.sac, isActive: s.isActive,
      rates: { weekday: { am: r("weekday", "am"), pm: r("weekday", "pm"), full: r("weekday", "full") }, weekend: { am: r("weekend", "am"), pm: r("weekend", "pm"), full: r("weekend", "full") }, peak: { am: r("peak", "am"), pm: r("peak", "pm"), full: r("peak", "full") } },
    } : blankSpace);
    setOpen(true);
  };
  const save = async () => {
    setBusy(true);
    const num = (x: string) => (x.trim() ? Number(x.replace(/[^\d.]/g, "")) : null);
    const body = {
      name: f.name, kind: f.kind, description: f.description || null, seated: num(f.seated), floating: num(f.floating), areaSqft: num(f.areaSqft), videoUrl: f.videoUrl || null,
      features: f.features.split(",").map(x => x.trim()).filter(Boolean), included: f.included || null, gstRate: Number(f.gstRate), sac: f.sac, isActive: f.isActive,
      ratesRupees: Object.fromEntries((["weekday", "weekend", "peak"] as DayType[]).map(t => [t, Object.fromEntries((["am", "pm", "full"] as Slot[]).map(sl => [sl, num(f.rates[t][sl])]))])),
    };
    try {
      const r: any = await apiRequest(editId ? "PATCH" : "POST", editId ? `/api/hub/venue/spaces/${editId}` : "/api/hub/venue/spaces", body);
      refresh(); if (!editId) { setEditId(r.data.id); toast({ title: "Space added — now add at least 3 photos" }); } else { toast({ title: "Saved" }); setOpen(false); }
    } catch (e) { fail("Not saved")(e); } finally { setBusy(false); }
  };
  const addPhotos = async (files: FileList) => {
    if (!editId) return; setBusy(true); let ok = 0;
    for (const file of Array.from(files).slice(0, 12)) { try { await uploadPhoto(`/api/hub/venue/spaces/${editId}/photos`, file); ok++; } catch (e) { fail(`${file.name} not added`)(e); break; } }
    refresh(); setBusy(false); if (ok) toast({ title: `${ok} photo${ok === 1 ? "" : "s"} added` });
  };
  const removePhoto = async (url: string) => { if (!live) return; try { await apiRequest("PATCH", `/api/hub/venue/spaces/${live.id}`, { photos: live.photos.filter(x => x !== url) }); refresh(); } catch (e) { fail("Not removed")(e); } };
  const cover = async (url: string) => { if (!live) return; try { await apiRequest("PATCH", `/api/hub/venue/spaces/${live.id}`, { photos: [url, ...live.photos.filter(x => x !== url)] }); refresh(); } catch (e) { fail("Not saved")(e); } };

  return (
    <HubPage title="Spaces & rates" subtitle="Each space clients can book on its own — main hall, mini hall, lawn. Rents are before GST. A weekend rent left blank uses the weekday rent; a peak rent left blank uses the weekend rent; a full day left blank is morning + evening."
      actions={manage ? <Button onClick={() => edit(null)}>Add a space</Button> : undefined}>
      {!v.data?.spaces.length ? <Empty icon="meeting_room" title="No spaces yet">Add your main hall first — its capacity, photos and rents.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {v.data.spaces.map(s => (
            <div key={s.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
              <div className="aspect-[16/9] bg-white/5">{s.photos[0] ? <img src={s.photos[0]} alt={s.name} className="h-full w-full object-cover" loading="lazy" /> : <div className={`grid h-full place-items-center text-xs ${muted}`}>No photos yet</div>}</div>
              <div className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-white">{s.name} <span className={`text-xs ${muted}`}>· {SPACE_KINDS.find(k => k[0] === s.kind)?.[1]}</span></p>
                  <div className="flex gap-1.5">{!s.isActive && <Chip tone="muted">Hidden</Chip>}<Chip tone={s.photos.length >= 3 ? "good" : "warn"}>{s.photos.length} photos</Chip></div>
                </div>
                <p className={`text-sm ${muted}`}>{[s.seated && `${s.seated} seated`, s.floating && `${s.floating} floating`, s.areaSqft && `${s.areaSqft.toLocaleString("en-IN")} sq ft`].filter(Boolean).join(" · ") || "Capacity not set"}</p>
                <p className="text-sm text-white">{s.offered.length ? <>From {inr(s.from)} · {s.offered.map(x => SLOT_LABEL[x]).join(", ")}</> : <span className="text-amber-300">No rent set — clients cannot book it yet</span>}</p>
                {manage && <Button size="sm" variant="outline" onClick={() => edit(s)}>Edit</Button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? `Edit ${f.name || "space"}` : "Add a space"}</DialogTitle><DialogDescription>Capacity, rents and photos clients see on your page.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="s-n">Name</Label><Input id="s-n" maxLength={80} placeholder="Main hall" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
            <div><Label htmlFor="s-k">Kind</Label><HubSelect id="s-k" value={f.kind} onChange={x => setF({ ...f, kind: x })}>{SPACE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</HubSelect></div>
            <div><Label htmlFor="s-se">Seated guests</Label><Input id="s-se" inputMode="numeric" value={f.seated} onChange={e => setF({ ...f, seated: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="s-fl">Floating guests</Label><Input id="s-fl" inputMode="numeric" value={f.floating} onChange={e => setF({ ...f, floating: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="s-ar">Area (sq ft)</Label><Input id="s-ar" inputMode="numeric" value={f.areaSqft} onChange={e => setF({ ...f, areaSqft: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="s-v">Video tour link</Label><Input id="s-v" placeholder="YouTube / Vimeo / Instagram" value={f.videoUrl} onChange={e => setF({ ...f, videoUrl: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="s-d">Description</Label><Textarea id="s-d" rows={2} maxLength={1000} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="s-f">Highlights (comma separated)</Label><Input id="s-f" placeholder="Central AC, Stage 30 × 20 ft, Dining hall for 250" value={f.features} onChange={e => setF({ ...f, features: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="s-i">What the rent includes</Label><Input id="s-i" maxLength={600} placeholder="500 chairs, AC for 8 hours, 2 changing rooms, cleaning" value={f.included} onChange={e => setF({ ...f, included: e.target.value })} /></div>
          </div>
          <div className="mt-2">
            <Label>Rent before GST (₹)</Label>
            <div className="mt-1 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr className={muted}><th className="py-1 text-left font-normal"></th>{(["am", "pm", "full"] as Slot[]).map(sl => <th key={sl} className="py-1 text-left font-normal">{SLOT_LABEL[sl]}</th>)}</tr></thead>
                <tbody>
                  {(["weekday", "weekend", "peak"] as DayType[]).map(t => (
                    <tr key={t}>
                      <td className="pr-2 text-white">{t === "weekday" ? "Weekday" : t === "weekend" ? "Weekend" : "Peak date"}</td>
                      {(["am", "pm", "full"] as Slot[]).map(sl => (
                        <td key={sl} className="py-1 pr-2"><Input aria-label={`${t} ${SLOT_LABEL[sl]} rent`} inputMode="numeric" placeholder={t === "weekday" ? (sl === "full" ? "am + pm" : "not let") : "same as above"} value={f.rates[t][sl]} onChange={e => setF({ ...f, rates: { ...f.rates, [t]: { ...f.rates[t], [sl]: e.target.value.replace(/[^\d]/g, "") } } })} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div><Label htmlFor="s-g">GST %</Label><HubSelect id="s-g" value={f.gstRate} onChange={x => setF({ ...f, gstRate: x })}>{["0", "5", "12", "18", "28"].map(r => <option key={r} value={r}>{r}%</option>)}</HubSelect></div>
              <div><Label htmlFor="s-sac">SAC</Label><Input id="s-sac" value={f.sac} onChange={e => setF({ ...f, sac: e.target.value.replace(/\D/g, "").slice(0, 8) })} /></div>
              <label className="flex items-end gap-2 pb-2 text-sm text-white"><input type="checkbox" checked={f.isActive} onChange={e => setF({ ...f, isActive: e.target.checked })} /> Bookable on your page</label>
            </div>
            <p className={`mt-1 text-xs ${muted}`}>Renting a hall for an event is usually SAC 997212 at 18% GST. Confirm with your CA.</p>
          </div>
          {live && (
            <div>
              <Label>Photos <span className={muted}>(the first is the cover; 3 or more)</span></Label>
              <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {live.photos.map((u, i) => (
                  <div key={u} className="group relative aspect-square overflow-hidden rounded bg-white/5">
                    <img src={u} alt="" className="h-full w-full object-cover" />
                    {i === 0 && <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] text-white">Cover</span>}
                    <div className="absolute inset-x-1 bottom-1 flex justify-between">
                      {i > 0 ? <button className="rounded bg-black/60 px-1.5 text-[11px] text-white" onClick={() => cover(u)}>Make cover</button> : <span />}
                      <button aria-label="Remove photo" className="rounded bg-black/60 px-1.5 text-xs text-white" onClick={() => removePhoto(u)}>✕</button>
                    </div>
                  </div>
                ))}
                {live.photos.length < 12 && <button className={`grid aspect-square place-items-center rounded border border-dashed border-white/25 text-xs ${muted} hover:text-white`} disabled={busy} onClick={() => photoRef.current?.click()}>{busy ? "Uploading…" : "+ Photos"}</button>}
              </div>
              <input ref={photoRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { if (e.target.files?.length) addPhotos(e.target.files); e.target.value = ""; }} />
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Close</Button><Button disabled={busy || f.name.trim().length < 2} onClick={save}>{editId ? "Save" : "Add space"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Calendar
// ══════════════════════════════════════════════════════════════════════════

type CalEntry = { id: number; spaceId: number; day: string; part: "am" | "pm"; status: "hold" | "booked" | "blocked"; holdExpiresAt: string | null; note: string | null; enquiryId: number | null; bookingId: number | null; who: string | null };
type Cal = { month: string; days: Array<{ day: string; type: DayType; label: string | null }>; spaces: Array<{ id: number; name: string; isActive: boolean }>; entries: CalEntry[] };
const monthAdd = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const STATUS_STYLE: Record<string, string> = { booked: "bg-emerald-500/70 text-white", hold: "bg-amber-400/70 text-black", blocked: "bg-slate-500/70 text-white", free: "bg-white/[0.04] text-[hsl(215,20%,55%)] hover:bg-white/10" };

export function HubVenueCalendar() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
  const manage = hubCan(me, "ops:manage");
  const [month, setMonth] = useState(istToday().slice(0, 7));
  const cal = useQuery<Cal>({ queryKey: ["/api/hub/venue/calendar", month], queryFn: async () => (await apiRequest("GET", `/api/hub/venue/calendar?month=${month}`)).data });
  const [spaceId, setSpaceId] = useState<number | null>(null);
  const sid = spaceId ?? cal.data?.spaces[0]?.id ?? null;
  const [block, setBlock] = useState<{ from: string; to: string; slot: Slot; note: string } | null>(null);
  const [pick, setPick] = useState<CalEntry | null>(null);
  const byKey = useMemo(() => new Map((cal.data?.entries ?? []).filter(e => e.spaceId === sid).map(e => [`${e.day}:${e.part}`, e])), [cal.data, sid]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/hub/venue/calendar"] });
  const doBlock = async () => {
    if (!block || !sid) return;
    try { const r: any = await apiRequest("POST", "/api/hub/venue/calendar/block", { spaceId: sid, from: block.from, to: block.to || block.from, slot: block.slot, note: block.note || null }); toast({ title: r.message }); setBlock(null); refresh(); }
    catch (e) { fail("Not blocked")(e); }
  };
  const unblock = async (e: CalEntry) => { try { await apiRequest("POST", "/api/hub/venue/calendar/unblock", { ids: [e.id] }); setPick(null); refresh(); toast({ title: "Unblocked" }); } catch (x) { fail("Not unblocked")(x); } };

  const first = cal.data?.days[0]?.day;
  const lead = first ? new Date(`${first}T00:00:00Z`).getUTCDay() : 0;
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const counts = (cal.data?.entries ?? []).filter(e => e.spaceId === sid).reduce((a, e) => { a[e.status] = (a[e.status] ?? 0) + 1; return a; }, {} as Record<string, number>);

  return (
    <HubPage title="Calendar" subtitle="Every half-day of every space. Green is booked, amber is held for a client (waiting for the advance or your answer), grey is blocked by you. Click a free half-day to block it."
      actions={manage && sid ? <Button onClick={() => setBlock({ from: istToday(), to: "", slot: "full", note: "" })}>Block dates</Button> : undefined}>
      {!cal.data?.spaces.length ? <Empty icon="calendar_month" title="No spaces yet"><Link href="/partner/venue/spaces" className="text-[hsl(174,72%,60%)]">Add a space</Link> to see its calendar.</Empty> : (
        <Panel>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" aria-label="Previous month" onClick={() => setMonth(monthAdd(month, -1))}>‹</Button>
              <p className="w-40 text-center font-medium text-white">{monthName}</p>
              <Button size="sm" variant="outline" aria-label="Next month" onClick={() => setMonth(monthAdd(month, 1))}>›</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {cal.data.spaces.length > 1 && <HubSelect aria-label="Space" value={String(sid)} onChange={x => setSpaceId(Number(x))}>{cal.data.spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</HubSelect>}
              <Chip tone="good">{counts.booked ?? 0} half-days booked</Chip><Chip tone="warn">{counts.hold ?? 0} held</Chip><Chip tone="muted">{counts.blocked ?? 0} blocked</Chip>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {WEEKDAYS.map(d => <div key={d} className={`py-1 ${muted}`}>{d}</div>)}
            {Array.from({ length: lead }).map((_, i) => <div key={`l${i}`} />)}
            {cal.data.days.map(d => {
              const past = d.day < istToday();
              return (
                <div key={d.day} className={`min-h-[76px] rounded-md border p-1 text-left ${d.type === "peak" ? "border-amber-500/40" : "border-white/10"} ${past ? "opacity-50" : ""}`}>
                  <div className="flex items-center justify-between"><span className="text-white">{Number(d.day.slice(8))}</span>{d.type !== "weekday" && <span className={`text-[10px] ${d.type === "peak" ? "text-amber-300" : muted}`} title={d.label ?? undefined}>{d.type === "peak" ? (d.label ?? "Peak") : "Wknd"}</span>}</div>
                  <div className="mt-1 grid gap-0.5">
                    {(["am", "pm"] as const).map(part => {
                      const e = byKey.get(`${d.day}:${part}`);
                      const st = e?.status ?? "free";
                      return <button key={part} disabled={past && !e} title={e?.who ?? e?.note ?? undefined}
                        onClick={() => (e ? setPick(e) : manage && !past ? setBlock({ from: d.day, to: d.day, slot: part, note: "" }) : null)}
                        className={`truncate rounded px-1 py-0.5 text-[10px] ${STATUS_STYLE[st]}`}>{part === "am" ? "AM" : "PM"}{e ? ` · ${e.status === "blocked" ? e.note ?? "Blocked" : e.who ?? ""}` : ""}</button>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Dialog open={!!block} onOpenChange={o => !o && setBlock(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Block dates</DialogTitle><DialogDescription>For a booking you took outside UniteFix, maintenance, or a family function. Clients will see these dates as taken.</DialogDescription></DialogHeader>
          {block && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="b-f">From</Label><Input id="b-f" type="date" value={block.from} onChange={e => setBlock({ ...block, from: e.target.value })} /></div>
              <div><Label htmlFor="b-t">To (optional)</Label><Input id="b-t" type="date" min={block.from} value={block.to} onChange={e => setBlock({ ...block, to: e.target.value })} /></div>
              <div><Label htmlFor="b-s">Part of day</Label><HubSelect id="b-s" value={block.slot} onChange={x => setBlock({ ...block, slot: x as Slot })}><option value="full">Full day</option><option value="am">Morning</option><option value="pm">Evening</option></HubSelect></div>
              <div><Label htmlFor="b-n">Note</Label><Input id="b-n" maxLength={200} placeholder="Ramesh wedding (walk-in)" value={block.note} onChange={e => setBlock({ ...block, note: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setBlock(null)}>Cancel</Button><Button onClick={doBlock}>Block</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!pick} onOpenChange={o => !o && setPick(null)}>
        <DialogContent>
          {pick && (
            <>
              <DialogHeader><DialogTitle>{pick.day} · {pick.part === "am" ? "Morning" : "Evening"}</DialogTitle><DialogDescription>{pick.status === "booked" ? "Booked" : pick.status === "hold" ? `Held for a client until ${pick.holdExpiresAt ? new Date(pick.holdExpiresAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}` : "Blocked by you"}</DialogDescription></DialogHeader>
              <p className="text-sm text-white">{pick.who ?? pick.note ?? ""}</p>
              <DialogFooter>
                {pick.bookingId && <Link href={`/partner/events/bookings/${pick.bookingId}`} className="inline-flex h-10 items-center rounded-md border border-white/15 px-4 text-sm text-white">Open the booking</Link>}
                {!pick.bookingId && pick.enquiryId && <Link href="/partner/venue/requests" className="inline-flex h-10 items-center rounded-md border border-white/15 px-4 text-sm text-white">Open requests</Link>}
                {pick.status === "blocked" && manage && <Button onClick={() => unblock(pick)}>Unblock</Button>}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Requests (confirm-first halls)
// ══════════════════════════════════════════════════════════════════════════

type Req = { id: number; name: string; phone: string; occasion: string; date: string; guests: number | null; source: string; selection: any; createdAt: string; heldUntil: string | null; held: boolean };

export function HubVenueRequests() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: apiErrorMessage(e), variant: "destructive" });
  const can = hubCan(me, "sales:manage");
  const q = useQuery<Req[]>({ queryKey: ["/api/hub/venue/requests"], queryFn: async () => (await apiRequest("GET", "/api/hub/venue/requests")).data, refetchInterval: 60_000 });
  const v = useVenue();
  const [decline, setDecline] = useState<Req | null>(null);
  const [reason, setReason] = useState("");
  const answer = async (r: Req, decision: "accept" | "decline") => {
    try {
      const x: any = await apiRequest("POST", `/api/hub/venue/requests/${r.id}/answer`, { decision, reason: decision === "decline" ? reason || null : null });
      toast({ title: x.message }); setDecline(null); setReason("");
      ["/api/hub/venue/requests", "/api/hub/venue/calendar", "/api/hub/events/bookings"].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e) { fail("Not done")(e); }
  };
  return (
    <HubPage title="Requests" subtitle={v.data?.profile.instantBooking ? "Instant booking is on: clients book free dates and pay the advance themselves — those go straight to Bookings. Requests appear here only if you switch to confirm-first." : "Clients asked for these dates. Each is held for them until you answer — accept and they are sent the advance to pay; decline and the date is free again."}>
      {!q.data?.length ? <Empty icon="inbox" title="No requests waiting">New requests appear here and on your alerts.</Empty> : (
        <div className="space-y-3">
          {q.data.map(r => {
            const s = r.selection ?? {};
            return (
              <Panel key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-white">{r.occasion} · {r.date} · {s.space} — {s.slotName}</p>
                    <p className={`text-sm ${muted}`}>{r.name} · {r.phone}{r.guests ? ` · ${r.guests} guests` : ""} · via {r.source === "app" ? "the UniteFix app" : "your page"}</p>
                    <p className="text-sm text-white">Price shown {inr(s.estimate?.total)} incl. GST · advance {inr(s.estimate?.advance)}</p>
                    {(s.items ?? []).filter((i: any) => i.kind === "addon").length > 0 && <p className={`text-xs ${muted}`}>Add-ons: {(s.items ?? []).filter((i: any) => i.kind === "addon").map((i: any) => `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ""}`).join(", ")}</p>}
                    {s.notes && <p className={`text-xs ${muted}`}>“{s.notes}”</p>}
                    {r.heldUntil ? <Chip tone="warn">Held until {new Date(r.heldUntil).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</Chip> : <Chip tone="bad">Hold lapsed — accepting re-takes the date if it is free</Chip>}
                  </div>
                  {can && <div className="flex gap-2"><Button variant="outline" onClick={() => setDecline(r)}>Decline</Button><Button onClick={() => answer(r, "accept")}>Accept</Button></div>}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
      <Dialog open={!!decline} onOpenChange={o => !o && setDecline(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Decline this request</DialogTitle><DialogDescription>The date is released and the client told.</DialogDescription></DialogHeader>
          <div><Label htmlFor="d-r">Reason (the client sees it)</Label><Input id="d-r" maxLength={300} placeholder="Sorry, the hall is under renovation that week." value={reason} onChange={e => setReason(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setDecline(null)}>Back</Button><Button onClick={() => decline && answer(decline, "decline")}>Decline</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </HubPage>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Reviews (halls, photographers, planners)
// ══════════════════════════════════════════════════════════════════════════

type Review = { id: number; kind: string; name: string; occasion: string | null; eventDate: string | null; rating: number; body: string | null; reply: string | null; status: string; hiddenReason: string | null; createdAt: string };

export function HubReviews() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const can = hubCan(me, "sales:manage");
  const q = useQuery<Review[]>({ queryKey: ["/api/hub/reviews"], queryFn: async () => (await apiRequest("GET", "/api/hub/reviews")).data });
  const [replying, setReplying] = useState<number | null>(null);
  const [text, setText] = useState("");
  const list = q.data ?? [];
  const pub = list.filter(r => r.status === "published");
  const avg = pub.length ? Math.round(pub.reduce((a, r) => a + r.rating, 0) / pub.length * 10) / 10 : null;
  const send = async (id: number) => {
    try { await apiRequest("POST", `/api/hub/reviews/${id}/reply`, { reply: text }); setReplying(null); setText(""); qc.invalidateQueries({ queryKey: ["/api/hub/reviews"] }); toast({ title: "Reply posted" }); }
    catch (e) { toast({ title: "Not posted", description: apiErrorMessage(e), variant: "destructive" }); }
  };
  return (
    <HubPage title="Reviews" subtitle="Only clients who booked you through UniteFix can review, once their event has taken place — every review here is real. A short, kind reply to each one shows future clients you care.">
      <div className="flex flex-wrap gap-2">{avg != null && <Chip tone="good">★ {avg} average</Chip>}<Chip tone="muted">{pub.length} published</Chip></div>
      {!list.length ? <Empty icon="reviews" title="No reviews yet">Clients are asked for a review the day after their event.</Empty> : (
        <div className="space-y-3">
          {list.map(r => (
            <Panel key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-amber-300" aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}<span className="text-white/20">{"★".repeat(5 - r.rating)}</span></p>
                  <p className="mt-1 text-sm text-white">{r.body ?? <span className={muted}>No comment</span>}</p>
                  <p className={`mt-1 text-xs ${muted}`}>{r.name}{r.occasion ? ` · ${r.occasion}` : ""}{r.eventDate ? ` · ${r.eventDate}` : ""}</p>
                  {r.status === "hidden" && <p className="mt-1 text-xs text-amber-300">Hidden by UniteFix: {r.hiddenReason}</p>}
                  {r.reply && <p className="mt-2 rounded-md bg-white/5 p-2 text-sm text-[hsl(215,20%,80%)]">Your reply: {r.reply}</p>}
                </div>
                {can && replying !== r.id && <Button size="sm" variant="outline" onClick={() => { setReplying(r.id); setText(r.reply ?? ""); }}>{r.reply ? "Edit reply" : "Reply"}</Button>}
              </div>
              {replying === r.id && (
                <div className="mt-3 space-y-2">
                  <Textarea rows={2} maxLength={1000} aria-label="Your reply" value={text} onChange={e => setText(e.target.value)} />
                  <div className="flex gap-2"><Button size="sm" onClick={() => send(r.id)} disabled={text.trim().length < 2}>Post reply</Button><Button size="sm" variant="outline" onClick={() => setReplying(null)}>Cancel</Button></div>
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </HubPage>
  );
}
