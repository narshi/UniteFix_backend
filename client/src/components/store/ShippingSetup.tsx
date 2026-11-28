/**
 * Store Orders → Shipping setup: is India Post live, where UniteFix ships its
 * own orders from, and the article-number ranges India Post allocated.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Warehouse = { name: string; company: string; line1: string; line2?: string | null; city: string; pincode: string; stateCode: string; phone: string; email?: string | null };
type Series = { id: number; prefix: string; firstSerial: number; lastSerial: number; nextSerial: number; product: string; isActive: boolean; note: string | null; left: number; next: string | null };
type Setup = { indiaPost: { mode: "live" | "mock" | "off"; base: string; customerId: string | null; products: string[]; webhookReady: boolean; missing: string[] }; warehouse: Warehouse | null; series: Series[] };

const STATES: Array<[string, string]> = [["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"], ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"], ["26", "Dadra and Nagar Haveli and Daman and Diu"], ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"], ["35", "Andaman and Nicobar Islands"], ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"]];
const field = "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white";
const MODE: Record<string, [string, string]> = {
  live: ["Live", "bg-emerald-500/15 text-emerald-300"], mock: ["Test mode", "bg-amber-500/15 text-amber-300"], off: ["Off", "bg-rose-500/15 text-rose-300"],
};

export default function ShippingSetup() {
  const { toast } = useToast();
  const q = useQuery<Setup>({ queryKey: ["/api/admin/store/shipping"], queryFn: async () => (await apiRequest("GET", "/api/admin/store/shipping")).data });
  const [w, setW] = useState<Warehouse | null>(null);
  const [s, setS] = useState({ prefix: "", firstSerial: "", lastSerial: "", product: "SP", note: "" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/store/shipping"] });
  const run = async (title: string, fn: () => Promise<any>) => { try { const r = await fn(); toast({ title: r?.message ?? title }); refresh(); return true; } catch (e) { toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" }); return false; } };

  if (q.isLoading || !q.data) return <p className="text-sm text-slate-400">Loading…</p>;
  const d = q.data, ip = d.indiaPost;
  const wh = w ?? d.warehouse ?? { name: "", company: "UniteFix", line1: "", line2: "", city: "", pincode: "", stateCode: "29", phone: "", email: "" };
  const setWh = (patch: Partial<Warehouse>) => setW({ ...wh, ...patch });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="space-y-2 rounded-xl border border-white/10 p-4 text-sm text-slate-300">
        <div className="flex items-center gap-2"><h3 className="font-semibold text-white">India Post</h3><span className={`rounded-full px-2 py-0.5 text-xs ${MODE[ip.mode][1]}`}>{MODE[ip.mode][0]}</span></div>
        <p className="text-xs text-slate-400">{ip.mode === "live" ? `Connected to ${ip.base}${ip.customerId ? `, customer ${ip.customerId}` : ""}.` : ip.mode === "mock" ? "Bookings and tracking are simulated, so the whole flow can be tried before the contract exists." : "Not offered. Set INDIA_POST_MODE=live with the credentials India Post issues."}</p>
        {ip.missing.length > 0 && <p className="text-xs text-rose-300">Missing on the server: {ip.missing.join(", ")}</p>}
        <p className="text-xs">Products: {ip.products.length ? ip.products.map(p => p === "SP" ? "Speed Post" : "Business Parcel").join(", ") : "no contract id set"}</p>
        <p className="text-xs">Tracking push (webhook): {ip.webhookReady ? "secret set" : "no secret yet (INDIA_POST_WEBHOOK_SECRET)"} · <span className="font-mono">/api/webhooks/india-post</span></p>
        <Button size="sm" variant="outline" onClick={() => run("Checked", () => apiRequest("POST", "/api/admin/store/shipping/sync", {}))}>Check tracking now</Button>
      </section>

      <section className="space-y-2 rounded-xl border border-white/10 p-4 text-sm">
        <h3 className="font-semibold text-white">UniteFix ships from</h3>
        <p className="text-xs text-slate-400">Sender and pickup address on UniteFix's own parcels.</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-slate-300">Contact name</Label><Input className={field} value={wh.name} onChange={e => setWh({ name: e.target.value })} /></div>
          <div><Label className="text-slate-300">Company</Label><Input className={field} value={wh.company} onChange={e => setWh({ company: e.target.value })} /></div>
          <div className="col-span-2"><Label className="text-slate-300">Address</Label><Input className={field} value={wh.line1} onChange={e => setWh({ line1: e.target.value })} /></div>
          <div className="col-span-2"><Input className={field} placeholder="Landmark (optional)" value={wh.line2 ?? ""} onChange={e => setWh({ line2: e.target.value })} /></div>
          <div><Label className="text-slate-300">City</Label><Input className={field} value={wh.city} onChange={e => setWh({ city: e.target.value })} /></div>
          <div><Label className="text-slate-300">Pincode</Label><Input className={field} inputMode="numeric" maxLength={6} value={wh.pincode} onChange={e => setWh({ pincode: e.target.value.replace(/\D/g, "") })} /></div>
          <div><Label className="text-slate-300">State</Label>
            <select className={`h-9 w-full rounded-md border px-2 text-sm ${field}`} value={wh.stateCode} onChange={e => setWh({ stateCode: e.target.value })}>{STATES.map(([c, n]) => <option key={c} value={c} className="bg-slate-900">{n}</option>)}</select>
          </div>
          <div><Label className="text-slate-300">Mobile</Label><Input className={field} inputMode="tel" maxLength={10} value={wh.phone} onChange={e => setWh({ phone: e.target.value.replace(/\D/g, "") })} /></div>
        </div>
        <Button size="sm" disabled={!w} onClick={async () => { if (await run("Saved", () => apiRequest("PUT", "/api/admin/store/shipping/warehouse", { ...wh, line2: wh.line2 || null, email: wh.email || null }))) setW(null); }}>Save address</Button>
      </section>

      <section className="space-y-2 rounded-xl border border-white/10 p-4 text-sm">
        <h3 className="font-semibold text-white">Article numbers</h3>
        <p className="text-xs text-slate-400">The ranges India Post allocated (e.g. ET 21433001 to 21434000). Each booking takes the next number; the check digit is added here.</p>
        <ul className="space-y-1 text-xs text-slate-300">
          {d.series.length === 0 && <li className="text-slate-500">None yet.</li>}
          {d.series.map(r => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{r.prefix} {r.firstSerial}–{r.lastSerial}</span>
              <span className="text-slate-500">{r.product === "SP" ? "Speed Post" : "Business Parcel"} · {r.left} left{r.next ? ` · next ${r.next}` : ""}</span>
              {!r.isActive && <span className="rounded-full bg-white/10 px-2">paused</span>}
              <button className="ml-auto underline decoration-dotted" onClick={() => run("Done", () => apiRequest("POST", `/api/admin/store/shipping/series/${r.id}/active`, { active: !r.isActive }))}>{r.isActive ? "Pause" : "Use"}</button>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-3 gap-2">
          <div><Label className="text-slate-300">Prefix</Label><Input className={`${field} font-mono`} maxLength={2} value={s.prefix} onChange={e => setS({ ...s, prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} placeholder="ET" /></div>
          <div><Label className="text-slate-300">First</Label><Input className={`${field} font-mono`} inputMode="numeric" maxLength={8} value={s.firstSerial} onChange={e => setS({ ...s, firstSerial: e.target.value.replace(/\D/g, "") })} placeholder="21433001" /></div>
          <div><Label className="text-slate-300">Last</Label><Input className={`${field} font-mono`} inputMode="numeric" maxLength={8} value={s.lastSerial} onChange={e => setS({ ...s, lastSerial: e.target.value.replace(/\D/g, "") })} placeholder="21434000" /></div>
        </div>
        <div className="flex gap-2">
          {(["SP", "BP"] as const).map(p => <Button key={p} size="sm" variant={s.product === p ? "default" : "outline"} onClick={() => setS({ ...s, product: p })}>{p === "SP" ? "Speed Post" : "Business Parcel"}</Button>)}
          <Button size="sm" className="ml-auto" disabled={s.prefix.length !== 2 || s.firstSerial.length !== 8 || s.lastSerial.length !== 8}
            onClick={async () => { if (await run("Added", () => apiRequest("POST", "/api/admin/store/shipping/series", { prefix: s.prefix, firstSerial: Number(s.firstSerial), lastSerial: Number(s.lastSerial), product: s.product, note: s.note || null }))) setS({ prefix: "", firstSerial: "", lastSerial: "", product: "SP", note: "" }); }}>Add range</Button>
        </div>
      </section>
    </div>
  );
}
