/**
 * What the app's travel planner offers: regions ("Sirsi"), the places in
 * them, and the pickup points. Map positions drive the route optimiser, so
 * each place links to Google Maps to check it.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Star, ExternalLink, EyeOff, Search } from "lucide-react";
import { PLACE_KINDS, PLACE_KIND_LABEL } from "@shared/travel";

type Region = { id: number; name: string; tagline: string | null; photoKey: string | null; photoUrl: string | null; bestMonths: number[]; sortOrder: number; isActive: boolean };
type Place = { id: number; regionId: number | null; name: string; kind: string; description: string | null; lat: number; lng: number; visitMinutes: number; bestMonths: number[]; featured: boolean; photoUrl: string | null; sortOrder: number; isActive: boolean };
type Pickup = { id: number; name: string; lat: number; lng: number; sortOrder: number; isActive: boolean };
type Catalog = { regions: Region[]; places: Place[]; pickups: Pickup[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const field = "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white";
const select = "h-10 w-full rounded-md border border-[rgba(255,255,255,0.08)] bg-[hsl(222,47%,11%)] px-3 text-sm text-white";
const panel = "rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]";
const maps = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

function MonthPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Best months">
      {MONTHS.map((m, i) => {
        const on = value.includes(i + 1);
        return <button key={m} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== i + 1) : [...value, i + 1].sort((a, b) => a - b))}
          className={`rounded-md border px-2 py-1 text-xs ${on ? "border-sky-400/50 bg-sky-500/20 text-white" : "border-white/10 text-slate-400"}`}>{m}</button>;
      })}
    </div>
  );
}

/** Paste "14.5196, 74.3243" (copied from Google Maps) into either box and both fill. */
function LatLng({ lat, lng, onChange }: { lat: string; lng: string; onChange: (lat: string, lng: string) => void }) {
  const paste = (v: string, which: "lat" | "lng") => {
    const m = v.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (m) onChange(m[1], m[2]); else onChange(which === "lat" ? v : lat, which === "lng" ? v : lng);
  };
  const ok = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && lat !== "" && lng !== "";
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-2">
        <div><Label htmlFor="tp-lat" className="text-xs text-slate-400">Latitude</Label><Input id="tp-lat" className={field} value={lat} onChange={(e) => paste(e.target.value, "lat")} placeholder="14.5196" /></div>
        <div><Label htmlFor="tp-lng" className="text-xs text-slate-400">Longitude</Label><Input id="tp-lng" className={field} value={lng} onChange={(e) => paste(e.target.value, "lng")} placeholder="74.3243" /></div>
      </div>
      <p className="text-xs text-slate-500">In Google Maps, right-click the spot and click the numbers to copy them, then paste here. {ok && <a className="text-sky-300 underline" href={maps(Number(lat), Number(lng))} target="_blank" rel="noreferrer">Check on the map</a>}</p>
    </div>
  );
}

type Editing =
  | { kind: "region"; row: Partial<Region> }
  | { kind: "place"; row: Partial<Place> }
  | { kind: "pickup"; row: Partial<Pickup> }
  | null;

export default function TravelPlacesPage() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Catalog>({ queryKey: ["/api/admin/travel/catalog"], queryFn: async () => (await apiRequest("GET", "/api/admin/travel/catalog")).data });
  const [tab, setTab] = useState<"places" | "regions" | "pickups">("places");
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [confirmDelete, setConfirmDelete] = useState<{ kind: string; id: number; name: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/travel/catalog"] });

  const open = (e: NonNullable<Editing>) => {
    setEditing(e);
    const r: any = e.row;
    setForm({ ...r, lat: r.lat != null ? String(r.lat) : "", lng: r.lng != null ? String(r.lng) : "", visitMinutes: r.visitMinutes != null ? String(r.visitMinutes) : "90", bestMonths: r.bestMonths ?? [], isActive: r.isActive ?? true, featured: r.featured ?? false });
  };
  const path = (k: string) => (k === "region" ? "regions" : k === "place" ? "places" : "pickups");
  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const id = (editing.row as any).id as number | undefined;
      const body: Record<string, any> =
        editing.kind === "region" ? { name: form.name, tagline: form.tagline || null, photoUrl: form.photoUrl || null, bestMonths: form.bestMonths, sortOrder: Number(form.sortOrder || 0), isActive: !!form.isActive }
          : editing.kind === "place" ? { regionId: form.regionId ? Number(form.regionId) : null, name: form.name, kind: form.kind || "nature", description: form.description || null, lat: Number(form.lat), lng: Number(form.lng), visitMinutes: Number(form.visitMinutes || 90), bestMonths: form.bestMonths, featured: !!form.featured, photoUrl: form.photoUrl || null, sortOrder: Number(form.sortOrder || 0), isActive: !!form.isActive }
            : { name: form.name, lat: Number(form.lat), lng: Number(form.lng), sortOrder: Number(form.sortOrder || 0), isActive: !!form.isActive };
      return apiRequest(id ? "PATCH" : "POST", `/api/admin/travel/${path(editing.kind)}${id ? `/${id}` : ""}`, body);
    },
    onSuccess: (r: any) => { toast({ title: r?.message ?? "Saved" }); setEditing(null); refresh(); },
    onError: (e) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const toggle = useMutation({
    mutationFn: async (v: { kind: string; id: number; body: Record<string, unknown> }) => apiRequest("PATCH", `/api/admin/travel/${path(v.kind)}/${v.id}`, v.body),
    onSuccess: () => refresh(),
    onError: (e) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (v: { kind: string; id: number }) => apiRequest("DELETE", `/api/admin/travel/${path(v.kind)}/${v.id}`),
    onSuccess: (r: any) => { toast({ title: r?.message ?? "Deleted" }); setConfirmDelete(null); refresh(); },
    onError: (e) => { toast({ title: "Not deleted", description: apiErrorMessage(e), variant: "destructive" }); setConfirmDelete(null); },
  });

  const regionName = useMemo(() => Object.fromEntries((data?.regions ?? []).map((r) => [r.id, r.name])), [data]);
  const places = (data?.places ?? []).filter((p) => (!regionFilter || String(p.regionId ?? "none") === regionFilter) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())));
  const tabs = [
    { key: "places", label: "Places", n: data?.places.length ?? 0 },
    { key: "regions", label: "Regions", n: data?.regions.length ?? 0 },
    { key: "pickups", label: "Pickup points", n: data?.pickups.length ?? 0 },
  ] as const;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-white">Travel places</h1>
        <p className="max-w-3xl text-sm text-slate-400">What the app's travel planner offers. Customers pick regions, then places in them; the planner orders the places into the shortest route and splits it into days using each place's map position and time to see it. "Best pick" places are suggested first. Hidden items stay here but leave the app.</p>
      </header>

      <div className="flex flex-wrap items-center gap-2" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)}
            className={`rounded-full border px-3 py-1.5 text-sm ${tab === t.key ? "border-sky-400/50 bg-sky-500/15 text-white" : "border-white/10 text-slate-300 hover:bg-white/5"}`}>
            {t.label} <span className="text-xs text-slate-400">{t.n}</span>
          </button>
        ))}
        <Button size="sm" className="ml-auto" onClick={() => open(tab === "places" ? { kind: "place", row: { regionId: regionFilter && regionFilter !== "none" ? Number(regionFilter) : null, kind: "nature" } } : tab === "regions" ? { kind: "region", row: {} } : { kind: "pickup", row: {} })}>
          <Plus className="mr-1 h-4 w-4" /> Add {tab === "places" ? "a place" : tab === "regions" ? "a region" : "a pickup point"}
        </Button>
      </div>

      {isLoading ? <p className="text-sm text-slate-400">Loading…</p> : !data ? null : tab === "places" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select aria-label="Region" className={`${select} w-56`} value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
              <option value="">All regions</option>
              {data.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              <option value="none">No region</option>
            </select>
            <div className="relative w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><Input aria-label="Search places" className={`${field} pl-9`} placeholder="Find a place" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          <div className={`${panel} overflow-x-auto`}>
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-white/5 text-left text-xs text-slate-400"><th className="p-3">Place</th><th className="p-3">Region</th><th className="p-3">Type</th><th className="p-3">Time there</th><th className="p-3">Best months</th><th className="p-3">Map</th><th className="p-3 text-right">Actions</th></tr></thead>
              <tbody>
                {places.map((p) => (
                  <tr key={p.id} className={`border-b border-white/5 ${p.isActive ? "" : "opacity-50"}`}>
                    <td className="p-3"><div className="flex items-center gap-2 font-medium text-white">{p.featured && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Best pick" />}{p.name}{!p.isActive && <span className="text-xs text-slate-500">(hidden)</span>}</div>{p.description && <div className="text-xs text-slate-400">{p.description}</div>}</td>
                    <td className="p-3 text-slate-300">{p.regionId ? regionName[p.regionId] ?? "—" : "—"}</td>
                    <td className="p-3 text-slate-300">{PLACE_KIND_LABEL[p.kind as keyof typeof PLACE_KIND_LABEL] ?? p.kind}</td>
                    <td className="p-3 text-slate-300">{p.visitMinutes >= 60 ? `${Math.floor(p.visitMinutes / 60)} h${p.visitMinutes % 60 ? ` ${p.visitMinutes % 60}m` : ""}` : `${p.visitMinutes} min`}</td>
                    <td className="p-3 text-xs text-slate-400">{p.bestMonths.length ? p.bestMonths.map((m) => MONTHS[m - 1]).join(" ") : "All year"}</td>
                    <td className="p-3"><a className="inline-flex items-center gap-1 text-xs text-sky-300 underline" href={maps(p.lat, p.lng)} target="_blank" rel="noreferrer">{p.lat.toFixed(3)}, {p.lng.toFixed(3)} <ExternalLink className="h-3 w-3" /></a></td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title={p.featured ? "Remove best pick" : "Mark as best pick"} onClick={() => toggle.mutate({ kind: "place", id: p.id, body: { featured: !p.featured } })}><Star className={`h-4 w-4 ${p.featured ? "fill-amber-400 text-amber-400" : ""}`} /></Button>
                        <Button size="sm" variant="ghost" title={p.isActive ? "Hide from the app" : "Show in the app"} onClick={() => toggle.mutate({ kind: "place", id: p.id, body: { isActive: !p.isActive } })}><EyeOff className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" title="Edit" onClick={() => open({ kind: "place", row: p })}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" title="Delete" onClick={() => setConfirmDelete({ kind: "place", id: p.id, name: p.name })}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!places.length && <tr><td colSpan={7} className="p-6 text-center text-slate-400">No places match.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ) : tab === "regions" ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.regions.map((r) => {
            const n = data.places.filter((p) => p.regionId === r.id).length;
            return (
              <li key={r.id} className={`${panel} space-y-2 p-4 ${r.isActive ? "" : "opacity-50"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-semibold text-white">{r.name}{!r.isActive && <span className="ml-1 text-xs text-slate-500">(hidden)</span>}</p><p className="text-sm text-slate-400">{r.tagline ?? ""}</p></div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" title="Edit" onClick={() => open({ kind: "region", row: r })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" title="Delete" onClick={() => setConfirmDelete({ kind: "region", id: r.id, name: r.name })}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <p className="text-xs text-slate-400">{n} place{n === 1 ? "" : "s"} · best {r.bestMonths.length ? r.bestMonths.map((m) => MONTHS[m - 1]).join(" ") : "all year"} · order {r.sortOrder}</p>
                <Button size="sm" variant="outline" onClick={() => { setRegionFilter(String(r.id)); setTab("places"); }}>See its places</Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={`${panel} overflow-x-auto`}>
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="border-b border-white/5 text-left text-xs text-slate-400"><th className="p-3">Pickup point</th><th className="p-3">Map</th><th className="p-3">Order</th><th className="p-3 text-right">Actions</th></tr></thead>
            <tbody>
              {data.pickups.map((p) => (
                <tr key={p.id} className={`border-b border-white/5 ${p.isActive ? "" : "opacity-50"}`}>
                  <td className="p-3 font-medium text-white">{p.name}{!p.isActive && <span className="ml-1 text-xs text-slate-500">(hidden)</span>}</td>
                  <td className="p-3"><a className="inline-flex items-center gap-1 text-xs text-sky-300 underline" href={maps(p.lat, p.lng)} target="_blank" rel="noreferrer">{p.lat.toFixed(3)}, {p.lng.toFixed(3)} <ExternalLink className="h-3 w-3" /></a></td>
                  <td className="p-3 text-slate-300">{p.sortOrder}</td>
                  <td className="p-3"><div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" title={p.isActive ? "Hide from the app" : "Show in the app"} onClick={() => toggle.mutate({ kind: "pickup", id: p.id, body: { isActive: !p.isActive } })}><EyeOff className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" title="Edit" onClick={() => open({ kind: "pickup", row: p })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" title="Delete" onClick={() => setConfirmDelete({ kind: "pickup", id: p.id, name: p.name })}><Trash2 className="h-4 w-4" /></Button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-[hsl(222,47%,9%)] text-white sm:max-w-lg">
          <DialogHeader><DialogTitle>{(editing?.row as any)?.id ? "Edit" : "Add"} {editing?.kind === "region" ? "region" : editing?.kind === "place" ? "place" : "pickup point"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="tp-name" className="text-xs text-slate-400">Name</Label><Input id="tp-name" className={field} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            {editing?.kind === "region" && (<>
              <div><Label htmlFor="tp-tag" className="text-xs text-slate-400">One line under the name</Label><Input id="tp-tag" className={field} value={form.tagline ?? ""} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="Temples, beaches and the island" /></div>
              <div><Label htmlFor="tp-photo" className="text-xs text-slate-400">Photo link (optional; the app has its own photos)</Label><Input id="tp-photo" className={field} value={form.photoUrl ?? ""} onChange={(e) => setForm({ ...form, photoUrl: e.target.value })} placeholder="https://…" /></div>
              <div className="space-y-1"><Label className="text-xs text-slate-400">Best months (shown as "In season")</Label><MonthPicker value={form.bestMonths ?? []} onChange={(v) => setForm({ ...form, bestMonths: v })} /></div>
            </>)}
            {editing?.kind === "place" && (<>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="tp-region" className="text-xs text-slate-400">Region</Label><select id="tp-region" className={select} value={form.regionId ?? ""} onChange={(e) => setForm({ ...form, regionId: e.target.value })}><option value="">No region</option>{data?.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
                <div><Label htmlFor="tp-kind" className="text-xs text-slate-400">Type</Label><select id="tp-kind" className={select} value={form.kind ?? "nature"} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{PLACE_KINDS.map((k) => <option key={k} value={k}>{PLACE_KIND_LABEL[k]}</option>)}</select></div>
              </div>
              <div><Label htmlFor="tp-desc" className="text-xs text-slate-400">One line about it</Label><Input id="tp-desc" className={field} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Boat ride through the mangroves" /></div>
              <LatLng lat={form.lat ?? ""} lng={form.lng ?? ""} onChange={(lat, lng) => setForm({ ...form, lat, lng })} />
              <div><Label htmlFor="tp-min" className="text-xs text-slate-400">Time to see it (minutes)</Label><Input id="tp-min" className={field} value={form.visitMinutes ?? ""} onChange={(e) => setForm({ ...form, visitMinutes: e.target.value.replace(/\D/g, "") })} inputMode="numeric" /></div>
              <div className="space-y-1"><Label className="text-xs text-slate-400">Best months (none = all year)</Label><MonthPicker value={form.bestMonths ?? []} onChange={(v) => setForm({ ...form, bestMonths: v })} /></div>
              <div><Label htmlFor="tp-pphoto" className="text-xs text-slate-400">Photo link (optional)</Label><Input id="tp-pphoto" className={field} value={form.photoUrl ?? ""} onChange={(e) => setForm({ ...form, photoUrl: e.target.value })} placeholder="https://…" /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Best pick: suggest it first</label>
            </>)}
            {editing?.kind === "pickup" && <LatLng lat={form.lat ?? ""} lng={form.lng ?? ""} onChange={(lat, lng) => setForm({ ...form, lat, lng })} />}
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="tp-sort" className="text-xs text-slate-400">Order (lower first)</Label><Input id="tp-sort" className={field} value={form.sortOrder ?? 0} onChange={(e) => setForm({ ...form, sortOrder: e.target.value.replace(/[^\d-]/g, "") })} inputMode="numeric" /></div>
              <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Show in the app</label>
            </div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending || !(form.name ?? "").trim()}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="border-white/10 bg-[hsl(222,47%,9%)] text-white">
          <DialogHeader><DialogTitle>Delete {confirmDelete?.name}?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-400">Trips already sent keep their own copy of the plan. To take it out of the app for now, hide it instead.</p>
          <DialogFooter><Button variant="ghost" onClick={() => setConfirmDelete(null)}>Keep it</Button><Button variant="destructive" onClick={() => confirmDelete && remove.mutate({ kind: confirmDelete.kind, id: confirmDelete.id })}>Delete</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
