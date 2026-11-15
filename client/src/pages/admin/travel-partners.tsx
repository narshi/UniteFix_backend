/**
 * Travel partners: cab operators, hotels, homestays, guides and activity
 * operators in each area. The travel manager asks them for prices from a trip
 * (Trip Requests → Supplier prices), by phone or a ready-made WhatsApp message.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Phone, MessageCircle, Search } from "lucide-react";
import { TRAVEL_PARTNER_KINDS, TRAVEL_PARTNER_KIND_LABEL, type TravelPartnerKind } from "@shared/travel";

type Partner = { id: number; name: string; kinds: TravelPartnerKind[]; baseTown: string | null; regionIds: number[]; contactName: string | null; phone: string | null; notes: string | null; isActive: boolean };
type Region = { id: number; name: string };

const field = "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white";
const panel = "rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]";
const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs ${on ? "border-sky-400/50 bg-sky-500/20 text-white" : "border-white/10 text-slate-400"}`;

export default function TravelPartnersPage() {
  const { toast } = useToast();
  const { data: partners = [], isLoading } = useQuery<Partner[]>({ queryKey: ["/api/admin/travel/partners"], queryFn: async () => (await apiRequest("GET", "/api/admin/travel/partners")).data });
  const { data: catalog } = useQuery<{ regions: Region[] }>({ queryKey: ["/api/admin/travel/catalog"], queryFn: async () => (await apiRequest("GET", "/api/admin/travel/catalog")).data });
  const regions = catalog?.regions ?? [];
  const regionName = useMemo(() => Object.fromEntries(regions.map((r) => [r.id, r.name])), [regions]);
  const [kind, setKind] = useState<string>("");
  const [q, setQ] = useState("");
  const [form, setForm] = useState<Partial<Partner> | null>(null);
  const [del, setDel] = useState<Partner | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/travel/partners"] });

  const save = useMutation({
    mutationFn: async () => {
      const f = form!;
      const body = { name: f.name, kinds: f.kinds ?? [], baseTown: f.baseTown || null, regionIds: f.regionIds ?? [], contactName: f.contactName || null, phone: f.phone || null, notes: f.notes || null, isActive: f.isActive ?? true };
      return apiRequest(f.id ? "PATCH" : "POST", `/api/admin/travel/partners${f.id ? `/${f.id}` : ""}`, body);
    },
    onSuccess: (r: any) => { toast({ title: r?.message ?? "Saved" }); setForm(null); refresh(); },
    onError: (e) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/travel/partners/${id}`),
    onSuccess: () => { toast({ title: "Removed", description: "A partner with prices on trips is hidden instead, so those trips keep their history." }); setDel(null); refresh(); },
    onError: (e) => toast({ title: "Not removed", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const toggle = (list: any[] | undefined, v: any) => (list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v];
  const shown = partners.filter((p) => (!kind || p.kinds.includes(kind as TravelPartnerKind)) && (!q.trim() || `${p.name} ${p.baseTown ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-white">Travel partners</h1>
          <p className="max-w-3xl text-sm text-slate-400">Cabs, hotels, homestays, guides and activity operators in each area. On a trip, the travel manager asks them for a price with one tap (WhatsApp or call), records it, and picks the best.</p>
        </div>
        <Button className="ml-auto" onClick={() => setForm({ kinds: [], regionIds: [], isActive: true })}><Plus className="mr-1 h-4 w-4" /> Add a partner</Button>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chip(!kind)} onClick={() => setKind("")}>All</button>
        {TRAVEL_PARTNER_KINDS.map((k) => <button key={k} type="button" className={chip(kind === k)} onClick={() => setKind(kind === k ? "" : k)}>{TRAVEL_PARTNER_KIND_LABEL[k]}</button>)}
        <div className="relative ml-auto w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><Input aria-label="Search partners" className={`${field} pl-9`} placeholder="Name or town" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {isLoading ? <p className="text-sm text-slate-400">Loading…</p> : !shown.length ? (
        <div className={`${panel} p-8 text-center text-slate-400`}>{partners.length ? "No partners match." : "No travel partners yet. Add the cab operators, hotels and guides you work with."}</div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <li key={p.id} className={`${panel} space-y-2 p-4 ${p.isActive ? "" : "opacity-50"}`}>
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-semibold text-white">{p.name}{!p.isActive && <span className="ml-1 text-xs text-slate-500">(hidden)</span>}</p><p className="text-sm text-slate-400">{[p.baseTown, p.contactName].filter(Boolean).join(" · ")}</p></div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" title="Edit" onClick={() => setForm(p)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" title="Remove" onClick={() => setDel(p)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">{p.kinds.map((k) => <span key={k} className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-300">{TRAVEL_PARTNER_KIND_LABEL[k] ?? k}</span>)}</div>
              {p.regionIds.length > 0 && <p className="text-xs text-slate-400">Serves {p.regionIds.map((r) => regionName[r] ?? "?").join(", ")}</p>}
              {p.notes && <p className="text-xs text-slate-500">{p.notes}</p>}
              {p.phone && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <a className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/5" href={`tel:+91${p.phone}`}><Phone className="h-3.5 w-3.5" /> {p.phone}</a>
                  <a className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10" href={`https://wa.me/91${p.phone}`} target="_blank" rel="noreferrer"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-[hsl(222,47%,9%)] text-white sm:max-w-lg">
          <DialogHeader><DialogTitle>{form?.id ? "Edit partner" : "Add a travel partner"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3">
              <div><Label htmlFor="tpn" className="text-xs text-slate-400">Business name</Label><Input id="tpn" className={field} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Coastal Cabs, Kumta" /></div>
              <div className="space-y-1.5"><Label className="text-xs text-slate-400">What they provide</Label>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="What they provide">{TRAVEL_PARTNER_KINDS.map((k) => <button key={k} type="button" aria-pressed={(form.kinds ?? []).includes(k)} className={chip((form.kinds ?? []).includes(k))} onClick={() => setForm({ ...form, kinds: toggle(form.kinds, k) })}>{TRAVEL_PARTNER_KIND_LABEL[k]}</button>)}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="tpt" className="text-xs text-slate-400">Based in</Label><Input id="tpt" className={field} value={form.baseTown ?? ""} onChange={(e) => setForm({ ...form, baseTown: e.target.value })} placeholder="Kumta" /></div>
                <div><Label htmlFor="tpc" className="text-xs text-slate-400">Contact person</Label><Input id="tpc" className={field} value={form.contactName ?? ""} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Raju" /></div>
              </div>
              <div><Label htmlFor="tpp" className="text-xs text-slate-400">Mobile (for calls and WhatsApp)</Label><Input id="tpp" className={field} value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="98450 12345" inputMode="tel" /></div>
              <div className="space-y-1.5"><Label className="text-xs text-slate-400">Regions they serve (they are suggested first for trips there)</Label>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Regions they serve">{regions.map((r) => <button key={r.id} type="button" aria-pressed={(form.regionIds ?? []).includes(r.id)} className={chip((form.regionIds ?? []).includes(r.id))} onClick={() => setForm({ ...form, regionIds: toggle(form.regionIds, r.id) })}>{r.name}</button>)}</div>
              </div>
              <div><Label htmlFor="tpo" className="text-xs text-slate-400">Notes</Label><Input id="tpo" className={field} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="3 Innovas, 1 Tempo Traveller; AC" /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive ?? true} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
            </div>
          )}
          <DialogFooter><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending || !(form?.name ?? "").trim() || !(form?.kinds ?? []).length}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <DialogContent className="border-white/10 bg-[hsl(222,47%,9%)] text-white">
          <DialogHeader><DialogTitle>Remove {del?.name}?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-400">If they have prices on trips, they are hidden instead of deleted, so those trips keep their history.</p>
          <DialogFooter><Button variant="ghost" onClick={() => setDel(null)}>Keep</Button><Button variant="destructive" onClick={() => del && remove.mutate(del.id)}>Remove</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
