/**
 * Apply to become a UniteFix partner — public, no login.
 *
 * Any kind of business: broadband, computer service, CCTV, electronics,
 * consulting, events. The form creates the owner's login straight away, so
 * the applicant can sign in to finish KYC (documents, bank, agreement) while
 * UniteFix reviews.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { checkGstin } from "@shared/hub";

type Vertical = { code: string; name: string; description: string | null };

export default function PartnerApplyPage() {
  const { data: verticals = [] } = useQuery<Vertical[]>({ queryKey: ["/api/hub/verticals"], queryFn: async () => (await apiRequest("GET", "/api/hub/verticals")).data });
  const [f, setF] = useState({ businessName: "", legalName: "", gstin: "", contactName: "", phone: "", email: "", address: "", pincode: "", district: "", password: "", confirm: "" });
  const [picked, setPicked] = useState<string[]>([]);
  const [coverage, setCoverage] = useState("");
  const [done, setDone] = useState<{ partnerCode: string; username: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const g = f.gstin.trim() ? checkGstin(f.gstin) : null;
  const pins = coverage.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  const badPins = pins.filter(p => !/^\d{6}$/.test(p));

  const apply = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/hub/apply", {
      businessName: f.businessName, legalName: f.legalName || null, gstin: f.gstin.trim() || null,
      contactName: f.contactName, phone: f.phone.trim(), email: f.email.trim(), address: f.address || null,
      pincode: f.pincode || null, district: f.district || null, verticals: picked,
      coveragePincodes: picked.includes("isp") ? pins : [], password: f.password,
    }),
    onSuccess: (r: any) => { setError(null); setDone(r.data); },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const problems: string[] = [];
  if (f.businessName.trim().length < 2) problems.push("business name");
  if (!picked.length) problems.push("what your business does");
  if (f.contactName.trim().length < 2) problems.push("contact name");
  if (!/^[6-9]\d{9}$/.test(f.phone.trim())) problems.push("a 10-digit mobile");
  if (!f.email.includes("@")) problems.push("email");
  if (f.password.length < 8) problems.push("a password of 8+ characters");
  if (f.password !== f.confirm) problems.push("matching passwords");
  if (g && !g.valid) problems.push("a valid GSTIN");
  if (picked.includes("isp") && (!pins.length || badPins.length)) problems.push("broadband coverage pincodes");

  const field = "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white placeholder:text-[hsl(215,20%,40%)]";

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-0 noise-overlay p-6">
        <div className="glass-card max-w-lg rounded-2xl border border-[rgba(255,255,255,0.08)] p-8 text-center">
          <span className="material-icons text-5xl text-emerald-400" style={{ fontFamily: "Material Icons" }}>task_alt</span>
          <h1 className="mt-3 text-2xl font-semibold text-white">Application received</h1>
          <p className="mt-2 text-[hsl(215,20%,70%)]">Your partner code is <span className="font-mono text-white">{done.partnerCode}</span>.</p>
          <p className="mt-4 text-sm text-[hsl(215,20%,70%)]">Next: sign in with <span className="text-white">{done.username}</span> and the password you chose. Upload your documents, add your bank account and accept the agreement — then submit. UniteFix reviews within 48 hours.</p>
          <a href="/" className="mt-6 inline-block rounded-lg bg-[hsl(174,72%,38%)] px-5 py-2.5 font-medium text-white hover:bg-[hsl(174,72%,33%)]">Sign in to continue</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-0 noise-overlay px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-mono uppercase tracking-widest text-[hsl(174,72%,55%)]">UniteFix Partner Hub</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Apply to become a partner</h1>
        <p className="mt-2 max-w-2xl text-[hsl(215,20%,70%)]">One portal for your customers, invoices, GST and settlements. Tell us about your business; you finish KYC after signing in.</p>

        <form className="mt-8 space-y-8" onSubmit={e => { e.preventDefault(); if (!problems.length) apply.mutate(); }}>
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-white">What does your business do? <span className="font-normal text-[hsl(215,20%,60%)]">Pick all that apply.</span></legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {verticals.map(v => {
                const on = picked.includes(v.code);
                return (
                  <button type="button" key={v.code} aria-pressed={on} onClick={() => setPicked(on ? picked.filter(x => x !== v.code) : [...picked, v.code])}
                    className={`rounded-xl border p-3 text-left transition-colors ${on ? "border-[hsl(174,72%,45%)] bg-[hsla(174,72%,40%,0.12)]" : "border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.25)]"}`}>
                    <p className="text-sm font-medium text-white">{v.name}</p>
                    {v.description && <p className="text-xs text-[hsl(215,20%,60%)]">{v.description}</p>}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {picked.includes("isp") && (
            <div>
              <Label htmlFor="ap-coverage" className="text-white">Pincodes where you provide broadband</Label>
              <textarea id="ap-coverage" className={`mt-1 w-full rounded-md border p-2 text-sm ${field}`} rows={2} placeholder="581401, 581402, 581403" value={coverage} onChange={e => setCoverage(e.target.value)} />
              <p className="mt-1 text-xs text-[hsl(215,20%,55%)]">{pins.length} pincode{pins.length === 1 ? "" : "s"}{badPins.length ? ` · not 6 digits: ${badPins.join(", ")}` : ""}. Pincodes UniteFix doesn't serve yet are reviewed with your application.</p>
            </div>
          )}

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-white">Business</legend>
            <div><Label htmlFor="ap-name" className="text-[hsl(215,20%,75%)]">Business name</Label><Input id="ap-name" className={field} value={f.businessName} onChange={e => setF({ ...f, businessName: e.target.value })} /></div>
            <div><Label htmlFor="ap-legal" className="text-[hsl(215,20%,75%)]">Legal name (if different)</Label><Input id="ap-legal" className={field} value={f.legalName} onChange={e => setF({ ...f, legalName: e.target.value })} /></div>
            <div className="sm:col-span-2">
              <Label htmlFor="ap-gstin" className="text-[hsl(215,20%,75%)]">GSTIN <span className="text-[hsl(215,20%,55%)]">(needed to sell goods or buy on credit)</span></Label>
              <Input id="ap-gstin" className={`${field} font-mono`} maxLength={15} value={f.gstin} onChange={e => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
              {g && <p className={`mt-1 text-xs ${g.valid ? "text-emerald-300" : "text-rose-300"}`}>{g.valid ? `Looks right · ${g.stateName} · PAN ${g.pan}` : g.reason}</p>}
            </div>
            <div className="sm:col-span-2"><Label htmlFor="ap-address" className="text-[hsl(215,20%,75%)]">Address</Label><Input id="ap-address" className={field} value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></div>
            <div><Label htmlFor="ap-pin" className="text-[hsl(215,20%,75%)]">Pincode</Label><Input id="ap-pin" className={field} inputMode="numeric" maxLength={6} value={f.pincode} onChange={e => setF({ ...f, pincode: e.target.value })} /></div>
            <div><Label htmlFor="ap-district" className="text-[hsl(215,20%,75%)]">District</Label><Input id="ap-district" className={field} value={f.district} onChange={e => setF({ ...f, district: e.target.value })} /></div>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-white">You — the owner's login</legend>
            <div><Label htmlFor="ap-contact" className="text-[hsl(215,20%,75%)]">Your name</Label><Input id="ap-contact" className={field} value={f.contactName} onChange={e => setF({ ...f, contactName: e.target.value })} /></div>
            <div><Label htmlFor="ap-phone" className="text-[hsl(215,20%,75%)]">Mobile</Label><Input id="ap-phone" className={field} inputMode="tel" maxLength={10} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value.replace(/\D/g, "") })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="ap-email" className="text-[hsl(215,20%,75%)]">Email — you sign in with this</Label><Input id="ap-email" type="email" autoComplete="email" className={field} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
            <div><Label htmlFor="ap-pw" className="text-[hsl(215,20%,75%)]">Password</Label><Input id="ap-pw" type="password" autoComplete="new-password" className={field} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></div>
            <div><Label htmlFor="ap-pw2" className="text-[hsl(215,20%,75%)]">Repeat password</Label><Input id="ap-pw2" type="password" autoComplete="new-password" className={field} value={f.confirm} onChange={e => setF({ ...f, confirm: e.target.value })} /></div>
          </fieldset>

          {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[hsl(215,20%,55%)]">{problems.length ? `Still needed: ${problems.join(", ")}.` : "Ready to send."} <a href="/" className="underline underline-offset-2">Already a partner? Sign in</a></p>
            <Button type="submit" disabled={problems.length > 0 || apply.isPending} className="bg-[hsl(174,72%,38%)] hover:bg-[hsl(174,72%,33%)]">{apply.isPending ? "Sending…" : "Send application"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
