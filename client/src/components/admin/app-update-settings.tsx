/**
 * Settings → App updates. Its own card and its own Save, because raising the
 * minimum blocks every older install — it is confirmed in place, not saved
 * alongside fee changes.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";

type Policy = { minVersionCode: number; latestVersionCode: number; message: string; androidUrl: string; iosUrl: string; blockLegacy: boolean };

export default function AppUpdateSettings() {
  const { toast } = useToast();
  const { data } = useQuery<{ data: Policy }>({ queryKey: ["/api/admin/app-version"], queryFn: async () => apiRequest("GET", "/api/admin/app-version") });
  const saved = data?.data;
  const [form, setForm] = useState<Policy | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (saved && !form) setForm(saved); }, [saved]);

  const save = useMutation({
    mutationFn: async (p: Policy) => apiRequest("PUT", "/api/admin/app-version", p),
    onSuccess: (r: any) => {
      toast({ title: "App updates saved", description: r?.message });
      setForm(r?.data ?? form); setConfirming(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/app-version"] });
    },
    onError: (e) => { toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }); setConfirming(false); },
  });

  if (!form) return null;
  const set = (patch: Partial<Policy>) => { setForm({ ...form, ...patch }); setConfirming(false); };
  const raising = !!saved && (form.minVersionCode > saved.minVersionCode || (form.blockLegacy && !saved.blockLegacy));
  const problem = form.minVersionCode > 0 && form.latestVersionCode > 0 && form.minVersionCode > form.latestVersionCode
    ? `The minimum (${form.minVersionCode}) is above the latest build (${form.latestVersionCode}); nobody could update past it.` : null;
  const changed = JSON.stringify(form) !== JSON.stringify(saved);

  return (
    <Card className="glass-card border-[rgba(255,255,255,0.08)]">
      <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
        <CardTitle className="text-xl text-white">App updates</CardTitle>
        <p className="text-sm text-[hsl(215,20%,60%)] mt-1">
          Force people on old versions of the UniteFix app to update. Use the build's <b className="text-white">version code</b> (versionCode in the Play Console, e.g. 32), not the version name.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="au-latest" className="text-[hsl(215,20%,90%)]">Latest version code in the store</Label>
            <Input id="au-latest" inputMode="numeric" value={String(form.latestVersionCode)} onChange={e => set({ latestVersionCode: Number(e.target.value.replace(/\D/g, "")) || 0 })} className="mt-1" />
            <p className="text-xs text-[hsl(215,20%,55%)] mt-1">Older builds get an optional "update available" prompt.</p>
          </div>
          <div>
            <Label htmlFor="au-min" className="text-[hsl(215,20%,90%)]">Minimum version code (force update below this)</Label>
            <Input id="au-min" inputMode="numeric" value={String(form.minVersionCode)} onChange={e => set({ minVersionCode: Number(e.target.value.replace(/\D/g, "")) || 0 })} className="mt-1" />
            <p className="text-xs text-[hsl(215,20%,55%)] mt-1">0 = nobody is forced. Builds below this see a full-screen "Update required" and cannot be used.</p>
          </div>
        </div>
        <div>
          <Label htmlFor="au-msg" className="text-[hsl(215,20%,90%)]">Message on the update screen</Label>
          <Textarea id="au-msg" rows={2} value={form.message} onChange={e => set({ message: e.target.value })} className="mt-1" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="au-android" className="text-[hsl(215,20%,90%)]">Android store link</Label>
            <Input id="au-android" value={form.androidUrl} onChange={e => set({ androidUrl: e.target.value })} className="mt-1 font-mono text-xs" />
          </div>
          <div>
            <Label htmlFor="au-ios" className="text-[hsl(215,20%,90%)]">iOS store link (optional)</Label>
            <Input id="au-ios" value={form.iosUrl} placeholder="itms-apps://… when there is an iOS app" onChange={e => set({ iosUrl: e.target.value })} className="mt-1 font-mono text-xs" />
          </div>
        </div>
        <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-[hsla(38,92%,50%,0.3)] bg-[hsla(38,92%,50%,0.06)]">
          <div className="min-w-0">
            <Label htmlFor="au-legacy" className="text-[hsl(215,20%,90%)]">Also block builds too old to show the update screen</Label>
            <p className="text-sm text-[hsl(215,20%,60%)] mt-0.5">
              Versions before the force-update feature (version code 31 and older) cannot show the screen. With this on, every action in those apps fails with the message above, so people go and update. Leave off unless old installs must stop now.
            </p>
          </div>
          <Switch id="au-legacy" checked={form.blockLegacy} onCheckedChange={checked => set({ blockLegacy: checked })} />
        </div>
        {problem && <p className="text-sm text-[hsl(347,77%,65%)]">{problem}</p>}
        {confirming ? (
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-[hsla(347,77%,50%,0.35)] bg-[hsla(347,77%,50%,0.08)] p-3">
            <p className="flex-1 min-w-[220px] text-sm text-white">
              {form.minVersionCode > (saved?.minVersionCode ?? 0) ? `Everyone on a build below ${form.minVersionCode} will be stopped until they update. ` : ""}
              {form.blockLegacy && !saved?.blockLegacy ? "Builds 31 and older will stop working. " : ""}
              Make sure version {form.latestVersionCode || form.minVersionCode} is live in the store first.
            </p>
            <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button className="bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)] text-white" disabled={save.isPending} onClick={() => save.mutate(form)}>Yes, force the update</Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={!changed} onClick={() => { setForm(saved ?? form); setConfirming(false); }}>Undo changes</Button>
            <Button disabled={!changed || !!problem || save.isPending} onClick={() => (raising ? setConfirming(true) : save.mutate(form))}>Save app updates</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
