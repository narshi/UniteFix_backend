/**
 * Home screen: which four cards the app's Home shows under "Home Services",
 * and when. Staff keep sets of up to four cards and schedule each set
 * always, every year between two days (Monsoon: 1 Jun – 30 Sep), or on dates
 * (a one-off campaign). The live set with the highest priority wins; gaps are
 * filled from the next live set, then the app's built-in four. See
 * shared/home-cards.ts.
 *
 * Photos: "Auto" uses the same rules the app uses (mobile/src/utils/servicePhotoRules.ts),
 * so the preview here is what customers see.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, CalendarDays, Plus, Trash2, Pencil, Sparkles } from "lucide-react";
import {
  MAX_HOME_CARDS, DEFAULT_HEADING, HOME_CARD_SCREENS, PHOTO_LIBRARY, describeSchedule,
  type HomeCard, type HomeCardPhoto, type HomeCardSchedule, type ResolvedHome,
} from "@shared/home-cards";
import { photoKeyForCategory, photoKeyForService } from "../../../../mobile/src/utils/servicePhotoRules";

// The app's own photos, bundled into this page by Vite (no copies in the repo).
const SERVICE_PHOTOS = import.meta.glob("../../../../mobile/assets/services/*.jpg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const HOME_PHOTOS = import.meta.glob("../../../../mobile/assets/home/{recharge,photo-shoots}.jpg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const photoUrl = (key: string) => SERVICE_PHOTOS[`../../../../mobile/assets/services/${key}.jpg`];
const SCREEN_PHOTO: Record<string, string | undefined> = {
  recharge: HOME_PHOTOS["../../../../mobile/assets/home/recharge.jpg"],
  celebrate: HOME_PHOTOS["../../../../mobile/assets/home/photo-shoots.jpg"],
  all_services: photoUrl("house"),
};
/** The app's built-in four, used when no set fills the row. */
const BUILT_IN = [["Plumbing", "plumbing"], ["Electrical", "electrical"], ["AC Service", "ac"], ["Painting", "painting"]] as const;

type Item = { id: number; name: string; status: string; categoryId: number; bannerImage?: string | null };
type Category = { id: number; name: string; isActive: boolean; items: Item[] };
type CardSet = {
  id: number; name: string; heading: string | null; schedule: HomeCardSchedule; fromMmdd: string | null; toMmdd: string | null;
  startsOn: string | null; endsOn: string | null; priority: number; isActive: boolean; cards: HomeCard[];
  when: string; liveToday: boolean; showingToday: boolean; updatedAt: string;
};
type Draft = Omit<CardSet, "id" | "when" | "liveToday" | "showingToday" | "updatedAt"> & { id?: number };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad = (n: number) => String(n).padStart(2, "0");
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const blank = (over: Partial<Draft> = {}): Draft => ({ name: "", heading: null, schedule: "yearly", fromMmdd: "06-01", toMmdd: "09-30", startsOn: null, endsOn: null, priority: 0, isActive: true, cards: [], ...over });
const QUICK_STARTS: { label: string; draft: Partial<Draft> }[] = [
  { label: "Everyday (always)", draft: { name: "Everyday", schedule: "always", heading: null, priority: 0 } },
  { label: "Monsoon · 1 Jun – 30 Sep", draft: { name: "Monsoon", heading: "Monsoon care", schedule: "yearly", fromMmdd: "06-01", toMmdd: "09-30", priority: 5 } },
  { label: "Tax season · 1 Mar – 31 Jul", draft: { name: "Tax season", heading: "Tax season", schedule: "yearly", fromMmdd: "03-01", toMmdd: "07-31", priority: 5 } },
  { label: "Summer · 1 Mar – 31 May", draft: { name: "Summer", heading: "Beat the heat", schedule: "yearly", fromMmdd: "03-01", toMmdd: "05-31", priority: 4 } },
  { label: "Festive · 1 Oct – 15 Nov", draft: { name: "Festive", heading: "Festive season", schedule: "yearly", fromMmdd: "10-01", toMmdd: "11-15", priority: 5 } },
  { label: "Holidays · 15 Dec – 10 Jan", draft: { name: "Holidays", heading: "Holiday plans", schedule: "yearly", fromMmdd: "12-15", toMmdd: "01-10", priority: 5 } },
];

const field = "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white";
const select = "h-9 rounded-md border border-[rgba(255,255,255,0.08)] bg-[hsl(222,47%,11%)] px-2 text-sm text-white";

export default function HomeScreenPage() {
  const { toast } = useToast();
  const [date, setDate] = useState(todayIst());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CardSet | null>(null);

  const sets = useQuery<CardSet[]>({ queryKey: ["/api/admin/catalog/home-cards/sets", date], queryFn: async () => (await apiRequest("GET", `/api/admin/catalog/home-cards/sets?date=${date}`)).data });
  const preview = useQuery<ResolvedHome>({ queryKey: ["/api/admin/catalog/home-cards/preview", date], queryFn: async () => (await apiRequest("GET", `/api/admin/catalog/home-cards/preview?date=${date}`)).data });
  const catalog = useQuery<Category[]>({ queryKey: ["/api/admin/catalog/categories"], queryFn: async () => (await apiRequest("GET", "/api/admin/catalog/categories")).data });
  const cats = catalog.data ?? [];
  const catById = useMemo(() => new Map(cats.map(c => [c.id, c])), [cats]);
  const svcById = useMemo(() => new Map(cats.flatMap(c => c.items.map(s => [s.id, s] as const))), [cats]);
  const refresh = () => queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/admin/catalog/home-cards") });

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const { id, ...body } = d;
      return id ? apiRequest("PATCH", `/api/admin/catalog/home-cards/sets/${id}`, body) : apiRequest("POST", "/api/admin/catalog/home-cards/sets", body);
    },
    onSuccess: () => { toast({ title: "Saved", description: "The app picks it up within a few minutes." }); setDraft(null); refresh(); },
    onError: e => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const toggle = useMutation({
    mutationFn: async (s: CardSet) => apiRequest("PATCH", `/api/admin/catalog/home-cards/sets/${s.id}`, { isActive: !s.isActive }),
    onSuccess: () => refresh(),
    onError: e => toast({ title: "Not changed", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (s: CardSet) => apiRequest("DELETE", `/api/admin/catalog/home-cards/sets/${s.id}`),
    onSuccess: () => { toast({ title: "Deleted" }); setConfirmDelete(null); refresh(); },
    onError: e => toast({ title: "Not deleted", description: apiErrorMessage(e), variant: "destructive" }),
  });

  /** The photo a card shows, as the app would pick it. */
  const cardPhoto = (c: { target: string; id?: number | null; screen?: string | null; photo?: HomeCardPhoto }) => {
    if (c.photo?.kind === "library") return photoUrl(c.photo.key);
    if (c.photo?.kind === "link") return c.photo.url;
    if (c.target === "screen") return SCREEN_PHOTO[c.screen ?? ""];
    if (c.target === "category") { const cat = catById.get(c.id ?? 0); return photoUrl(photoKeyForCategory(cat?.name) ?? "house"); }
    const s = svcById.get(c.id ?? 0);
    return photoUrl(photoKeyForService(s?.name) ?? photoKeyForCategory(catById.get(s?.categoryId ?? 0)?.name) ?? "house");
  };
  const cardName = (c: HomeCard) => c.label || (c.target === "screen" ? HOME_CARD_SCREENS.find(s => s.key === c.screen)?.label.replace(/ \(.*\)$/, "") : c.target === "category" ? catById.get(c.id)?.name : svcById.get(c.id)?.name) || "—";

  const shown = preview.data;
  const builtInFill = BUILT_IN.slice(0, Math.max(0, MAX_HOME_CARDS - (shown?.cards.length ?? 0)));
  const list = sets.data ?? [];

  return (
    <main className="min-w-0 flex-1 space-y-6 p-4 sm:p-6 xl:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Home screen</h1>
          <p className="mt-1 max-w-3xl text-sm text-[hsl(215,20%,65%)]">
            The four cards under "Home Services" on the app's Home. Make a set of cards for a season (Monsoon: electrical and plumbing; March: taxes, cabs, events) and say when it shows. When sets overlap, the higher priority wins; a set with fewer than four cards is topped up from the next one, then from the app's built-in four.
          </p>
        </div>
        <Button onClick={() => setDraft(blank())} className="gap-2"><Plus className="h-4 w-4" /> New set</Button>
      </div>

      {/* What the app shows on a day */}
      <section className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4 sm:p-5" aria-label="Preview">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">On the app {date === todayIst() ? "today" : "on " + new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</h2>
            <p className="text-xs text-[hsl(215,20%,60%)]">{shown?.setName ? <>From <span className="text-white">{shown.setName}</span></> : "No set is live: the app shows its built-in four."}</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-[hsl(215,20%,70%)]">
            <CalendarDays className="h-4 w-4" /> Preview a date
            <input aria-label="Preview date" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} className={`${select} [color-scheme:dark]`} />
          </label>
        </div>
        <div className="mt-4 max-w-xl rounded-2xl bg-[#F5F7FA] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-lg font-extrabold text-[#14243B]" data-testid="preview-heading">{shown?.heading ?? DEFAULT_HEADING}</span>
            <span className="text-sm font-bold text-[#FF8A00]">View All →</span>
          </div>
          <div className="grid grid-cols-4 gap-2.5" data-testid="preview-cards">
            {(shown?.cards ?? []).map(c => (
              <PhoneCard key={c.key} label={c.label} photo={cardPhoto(c)} note={c.fromSetId !== shown?.setId ? "filled in" : undefined} />
            ))}
            {builtInFill.map(([label, key]) => <PhoneCard key={label} label={label} photo={photoUrl(key)} note="built-in" />)}
          </div>
        </div>
      </section>

      {/* Sets */}
      <section className="space-y-3" aria-label="Card sets">
        <h2 className="text-base font-semibold text-white">Card sets</h2>
        {sets.isLoading ? <p className="text-sm text-[hsl(215,20%,60%)]">Loading…</p> : list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[rgba(255,255,255,0.12)] p-5">
            <p className="text-sm text-[hsl(215,20%,70%)]">No sets yet, so the app shows its built-in four (Plumbing, Electrical, AC Service, Painting). Start from one of these:</p>
            <QuickStarts onPick={d => setDraft(blank(d))} />
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {list.map(s => (
              <div key={s.id} className={`rounded-2xl border p-4 ${s.showingToday ? "border-[rgba(255,138,0,0.5)] bg-[rgba(255,138,0,0.06)]" : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]"}`} data-testid={`set-${s.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold text-white">{s.name}</h3>
                      {s.showingToday && <Badge className="bg-[#FF8A00] text-white hover:bg-[#FF8A00]">Showing {date === todayIst() ? "today" : "that day"}</Badge>}
                      {!s.showingToday && s.liveToday && <Badge variant="outline" className="border-amber-400/50 text-amber-300">Live, lower priority</Badge>}
                      {!s.isActive && <Badge variant="outline" className="text-[hsl(215,20%,60%)]">Off</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm text-[hsl(215,20%,70%)]">{s.when} · priority {s.priority}{s.heading ? ` · heading "${s.heading}"` : ""}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch checked={s.isActive} onCheckedChange={() => toggle.mutate(s)} aria-label={`${s.name} on`} />
                    <Button size="icon" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setDraft({ ...s, cards: s.cards.map(c => ({ ...c })) })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => setConfirmDelete(s)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.cards.length === 0 && <span className="text-xs text-[hsl(215,20%,55%)]">No cards yet.</span>}
                  {s.cards.map((c, i) => (
                    <span key={i} className="inline-flex items-center gap-2 rounded-full bg-[rgba(255,255,255,0.06)] py-1 pl-1 pr-3 text-xs text-white">
                      <img src={cardPhoto(c)} alt="" className="h-6 w-6 rounded-full object-cover" referrerPolicy="no-referrer" />{cardName(c)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {list.length > 0 && (
          <details className="text-sm text-[hsl(215,20%,65%)]">
            <summary className="cursor-pointer">Start a new set from a season</summary>
            <QuickStarts onPick={d => setDraft(blank(d))} />
          </details>
        )}
      </section>

      {draft && (
        <SetEditor
          draft={draft} setDraft={setDraft} cats={cats} saving={save.isPending}
          onSave={() => save.mutate(draft)} cardPhoto={cardPhoto}
        />
      )}

      <Dialog open={!!confirmDelete} onOpenChange={o => !o && setConfirmDelete(null)}>
        <DialogContent className="glass-panel border-[rgba(255,255,255,0.1)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Delete "{confirmDelete?.name}"?</DialogTitle>
            <DialogDescription>It stops showing on the app. To pause it instead, switch it off.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Keep it</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => confirmDelete && remove.mutate(confirmDelete)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function QuickStarts({ onPick }: { onPick: (d: Partial<Draft>) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {QUICK_STARTS.map(q => (
        <button key={q.label} onClick={() => onPick(q.draft)} className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-sm text-white hover:bg-[rgba(255,255,255,0.06)]">
          <Sparkles className="h-3.5 w-3.5 text-[#FF8A00]" /> {q.label}
        </button>
      ))}
    </div>
  );
}

function PhoneCard({ label, photo, note }: { label: string; photo?: string; note?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#E6EAF0] bg-white shadow-sm">
      <div className="aspect-[1/0.92] bg-[#E6EAF0]">{photo && <img src={photo} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />}</div>
      <p className="truncate px-1 pb-1 pt-2 text-center text-xs font-extrabold text-[#14243B]">{label}</p>
      {note && <p className="pb-1.5 text-center text-[10px] text-[#687588]">{note}</p>}
    </div>
  );
}

function MonthDay({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string) => void }) {
  const m = Number((value ?? "01-01").slice(0, 2)), d = Number((value ?? "01-01").slice(3));
  return (
    <div className="grid gap-1.5">
      <Label className="text-[hsl(215,20%,75%)]">{label}</Label>
      <div className="flex gap-2">
        <select aria-label={`${label} day`} className={select} value={d} onChange={e => onChange(`${pad(m)}-${pad(Number(e.target.value))}`)}>
          {Array.from({ length: DAYS[m - 1] }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </select>
        <select aria-label={`${label} month`} className={select} value={m} onChange={e => { const nm = Number(e.target.value); onChange(`${pad(nm)}-${pad(Math.min(d, DAYS[nm - 1]))}`); }}>
          {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
        </select>
      </div>
    </div>
  );
}

function SetEditor({ draft, setDraft, cats, saving, onSave, cardPhoto }: {
  draft: Draft; setDraft: (d: Draft | null) => void; cats: Category[]; saving: boolean; onSave: () => void;
  cardPhoto: (c: HomeCard) => string | undefined;
}) {
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const setCard = (i: number, c: HomeCard) => set({ cards: draft.cards.map((x, j) => (j === i ? c : x)) });
  const move = (i: number, by: number) => { const cs = [...draft.cards]; const [c] = cs.splice(i, 1); cs.splice(i + by, 0, c); set({ cards: cs }); };
  const activeCats = cats.filter(c => c.isActive);
  const firstCat = activeCats[0]?.id ?? cats[0]?.id ?? 0;

  return (
    <Dialog open onOpenChange={o => !o && setDraft(null)}>
      <DialogContent className="glass-panel max-h-[90vh] overflow-y-auto border-[rgba(255,255,255,0.1)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-white">{draft.id ? `Edit "${draft.name}"` : "New set of Home cards"}</DialogTitle>
          <DialogDescription>Up to four cards, shown under the heading on the app's Home while this set is live.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="hs-name" className="text-[hsl(215,20%,75%)]">Name (for staff)</Label>
              <Input id="hs-name" value={draft.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="e.g. Monsoon" className={field} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="hs-heading" className="text-[hsl(215,20%,75%)]">Heading on the app</Label>
              <Input id="hs-heading" value={draft.heading ?? ""} maxLength={40} onChange={e => set({ heading: e.target.value || null })} placeholder={DEFAULT_HEADING} className={field} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-[hsl(215,20%,75%)]">When it shows</Label>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="When it shows">
              {([["always", "Always"], ["yearly", "Every year"], ["dates", "On dates"]] as const).map(([k, l]) => (
                <button key={k} role="radio" aria-checked={draft.schedule === k} onClick={() => set({ schedule: k, ...(k === "dates" && !draft.startsOn ? { startsOn: todayIst(), endsOn: todayIst() } : {}) })}
                  className={`rounded-lg px-3 py-1.5 text-sm ${draft.schedule === k ? "bg-[rgba(255,138,0,0.18)] text-white ring-1 ring-[#FF8A00]" : "bg-[rgba(255,255,255,0.04)] text-[hsl(215,20%,70%)] hover:text-white"}`}>{l}</button>
              ))}
            </div>
            {draft.schedule === "yearly" && (
              <div className="flex flex-wrap items-end gap-4">
                <MonthDay label="From" value={draft.fromMmdd} onChange={v => set({ fromMmdd: v })} />
                <MonthDay label="To" value={draft.toMmdd} onChange={v => set({ toMmdd: v })} />
                <p className="pb-2 text-xs text-[hsl(215,20%,60%)]">Comes back every year. {draft.fromMmdd && draft.toMmdd && draft.fromMmdd > draft.toMmdd ? "Runs across the new year." : ""}</p>
              </div>
            )}
            {draft.schedule === "dates" && (
              <div className="flex flex-wrap items-end gap-4">
                <div className="grid gap-1.5"><Label htmlFor="hs-start" className="text-[hsl(215,20%,75%)]">First day</Label><input id="hs-start" type="date" value={draft.startsOn ?? ""} onChange={e => set({ startsOn: e.target.value })} className={`${select} [color-scheme:dark]`} /></div>
                <div className="grid gap-1.5"><Label htmlFor="hs-end" className="text-[hsl(215,20%,75%)]">Last day</Label><input id="hs-end" type="date" value={draft.endsOn ?? ""} onChange={e => set({ endsOn: e.target.value })} className={`${select} [color-scheme:dark]`} /></div>
              </div>
            )}
            {draft.schedule === "always" && <p className="text-xs text-[hsl(215,20%,60%)]">Your everyday cards: they show whenever no season with a higher priority is live, and top up seasons that have fewer than four.</p>}
            <p className="text-xs text-[hsl(215,20%,60%)]">{describeSchedule(draft)}</p>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="grid gap-1.5">
              <Label htmlFor="hs-priority" className="text-[hsl(215,20%,75%)]">Priority</Label>
              <Input id="hs-priority" type="number" min={-100} max={100} value={draft.priority} onChange={e => set({ priority: Math.round(Number(e.target.value) || 0) })} className={`${field} w-24`} />
            </div>
            <label className="flex items-center gap-2 pt-5 text-sm text-white"><Switch checked={draft.isActive} onCheckedChange={v => set({ isActive: v })} aria-label="Set is on" /> On</label>
            <p className="max-w-xs pt-5 text-xs text-[hsl(215,20%,60%)]">Higher wins when two sets are live on the same day. Give seasons a higher number than your everyday set.</p>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-[hsl(215,20%,75%)]">Cards ({draft.cards.length} of {MAX_HOME_CARDS})</Label>
              <Button size="sm" variant="outline" disabled={draft.cards.length >= MAX_HOME_CARDS} onClick={() => set({ cards: [...draft.cards, { target: "category", id: firstCat, photo: { kind: "auto" } }] })} className="gap-1"><Plus className="h-3.5 w-3.5" /> Add card</Button>
            </div>
            {draft.cards.length === 0 && <p className="text-xs text-[hsl(215,20%,60%)]">No cards: add up to four. Leaving gaps is fine: they are filled from the next live set.</p>}
            {draft.cards.map((c, i) => (
              <CardRow key={i} index={i} card={c} cats={cats} count={draft.cards.length} photo={cardPhoto(c)}
                onChange={nc => setCard(i, nc)} onMove={by => move(i, by)} onRemove={() => set({ cards: draft.cards.filter((_, j) => j !== i) })} />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save set"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CardRow({ index, card, cats, count, photo, onChange, onMove, onRemove }: {
  index: number; card: HomeCard; cats: Category[]; count: number; photo?: string;
  onChange: (c: HomeCard) => void; onMove: (by: number) => void; onRemove: () => void;
}) {
  const n = index + 1;
  const ph = card.photo ?? { kind: "auto" as const };
  const withPhoto = (p: HomeCardPhoto) => onChange({ ...card, photo: p } as HomeCard);
  return (
    <div className="flex gap-3 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-3" data-testid={`card-row-${n}`}>
      <div className="h-[74px] w-[80px] shrink-0 overflow-hidden rounded-lg bg-[rgba(255,255,255,0.06)]">{photo && <img src={photo} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />}</div>
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex flex-wrap gap-2">
          <select aria-label={`Card ${n} opens`} className={select} value={card.target}
            onChange={e => {
              const t = e.target.value;
              if (t === "screen") onChange({ target: "screen", screen: "recharge", label: card.label, photo: ph });
              else if (t === "service") onChange({ target: "service", id: cats.find(c => c.items.length)?.items[0]?.id ?? 0, label: card.label, photo: ph });
              else onChange({ target: "category", id: cats[0]?.id ?? 0, label: card.label, photo: ph });
            }}>
            <option value="category">A category</option><option value="service">A service</option><option value="screen">A screen</option>
          </select>
          {card.target === "category" && (
            <select aria-label={`Card ${n} category`} className={`${select} min-w-0 flex-1`} value={card.id} onChange={e => onChange({ ...card, id: Number(e.target.value) })}>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}{c.isActive ? "" : " (off)"}{c.items.length ? "" : " (no services)"}</option>)}
            </select>
          )}
          {card.target === "service" && (
            <select aria-label={`Card ${n} service`} className={`${select} min-w-0 flex-1`} value={card.id} onChange={e => onChange({ ...card, id: Number(e.target.value) })}>
              {cats.filter(c => c.items.length).map(c => (
                <optgroup key={c.id} label={c.name}>{c.items.map(s => <option key={s.id} value={s.id}>{s.name}{s.status === "DISABLED" ? " (disabled)" : ""}</option>)}</optgroup>
              ))}
            </select>
          )}
          {card.target === "screen" && (
            <select aria-label={`Card ${n} screen`} className={`${select} min-w-0 flex-1`} value={card.screen} onChange={e => onChange({ ...card, screen: e.target.value as any })}>
              {HOME_CARD_SCREENS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input aria-label={`Card ${n} label`} value={card.label ?? ""} maxLength={16} onChange={e => onChange({ ...card, label: e.target.value || null } as HomeCard)} placeholder="Short label (blank = its name)" className={`${field} h-9 w-44`} />
          <select aria-label={`Card ${n} photo`} className={select} value={ph.kind}
            onChange={e => withPhoto(e.target.value === "library" ? { kind: "library", key: PHOTO_LIBRARY[0].key } : e.target.value === "link" ? { kind: "link", url: "" } : { kind: "auto" })}>
            <option value="auto">Photo: picked for it</option><option value="library">Photo: from the app's photos</option><option value="link">Photo: image link</option>
          </select>
          {ph.kind === "library" && (
            <select aria-label={`Card ${n} library photo`} className={select} value={ph.key} onChange={e => withPhoto({ kind: "library", key: e.target.value })}>
              {PHOTO_LIBRARY.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          )}
          {ph.kind === "link" && (
            <Input aria-label={`Card ${n} image link`} value={ph.url} onChange={e => withPhoto({ kind: "link", url: e.target.value.trim() })} placeholder="https://…" className={`${field} h-9 min-w-0 flex-1`} />
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={index === 0} aria-label={`Move card ${n} left`} onClick={() => onMove(-1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={index === count - 1} aria-label={`Move card ${n} right`} onClick={() => onMove(1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Remove card ${n}`} onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}
