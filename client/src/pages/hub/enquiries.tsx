/**
 * Partner Hub — Enquiries: free-quote requests from customers in the
 * partner's pincodes for services they list. The first partner to take one
 * gets the customer's name and number; UniteFix may also forward one.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { LIVE } from "@/lib/live";
import { useHubMe, hubCan } from "@/lib/hub";
import { HubPage, Panel, Chip, Empty } from "@/components/hub/ui";

type Row = {
  id: number; ref: string; serviceName: string; details: string; preferredDate: string | null; budget: string | null; pincode: string | null;
  status: "open" | "taken_by_other" | "taken" | "forwarded" | "contacted" | "closed" | "new"; createdAt: string;
  customer: { name: string | null; phone: string | null; address: string | null } | null;
};
const LABEL: Record<string, [string, "good" | "info" | "muted" | "warn"]> = {
  open: ["Open", "warn"], new: ["Open", "warn"], taken: ["Yours", "good"], forwarded: ["From UniteFix", "good"],
  contacted: ["Called", "info"], closed: ["Closed", "muted"], taken_by_other: ["Taken by another partner", "muted"],
};

export function HubEnquiries() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const q = useQuery<Row[]>({ queryKey: ["/api/hub/enquiries"], queryFn: async () => (await apiRequest("GET", "/api/hub/enquiries")).data, ...LIVE });
  const can = hubCan(me, "ops:view");
  const act = async (id: number, path: string, body?: object, done?: string) => {
    setBusy(id);
    try {
      const r: any = await apiRequest(path.endsWith("/take") ? "POST" : "PATCH", path, body ?? {});
      toast({ title: done ?? "Saved", description: r?.message });
      qc.invalidateQueries({ queryKey: ["/api/hub/enquiries"] });
    } catch (e) { toast({ title: "Not done", description: apiErrorMessage(e), variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const rows = q.data ?? [];
  return (
    <HubPage title="Enquiries" subtitle="Customers near you asking for quotes on services you list. Take one to get the customer's number, then call them. The first partner to take it gets it.">
      <Panel>
        {q.isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !rows.length ? (
          <Empty icon="forum" title="No enquiries yet">They arrive here (and in your alerts) when a customer in your pincodes asks about a service on your list.</Empty>
        ) : (
          <div className="space-y-3">{rows.map(e => {
            const [label, tone] = LABEL[e.status] ?? [e.status, "muted"];
            const mine = !!e.customer;
            return (
              <div key={e.id} className="rounded-lg border border-[rgba(255,255,255,0.08)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">{e.serviceName} <span className="font-mono text-[11px] text-[hsl(215,20%,55%)]">{e.ref}</span></p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[hsl(210,20%,85%)]">{e.details}</p>
                    <p className="mt-1 text-xs text-[hsl(215,20%,55%)]">{[e.pincode, e.preferredDate && `for ${e.preferredDate}`, e.budget && `budget ${e.budget}`].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Chip tone={tone}>{label}</Chip>
                </div>
                {mine && (
                  <div className="mt-3 rounded-md bg-[rgba(255,255,255,0.04)] p-3 text-sm">
                    <p className="text-white">{e.customer!.name ?? "Customer"} · <span className="font-mono">{e.customer!.phone ?? "—"}</span></p>
                    {e.customer!.address && <p className="text-xs text-[hsl(215,20%,60%)]">{e.customer!.address}</p>}
                  </div>
                )}
                {can && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {e.status === "open" && <Button size="sm" disabled={busy === e.id} onClick={() => act(e.id, `/api/hub/enquiries/${e.id}/take`, undefined, "It is yours")}>Take it</Button>}
                    {mine && ["taken", "forwarded"].includes(e.status) && <Button size="sm" variant="outline" disabled={busy === e.id} onClick={() => act(e.id, `/api/hub/enquiries/${e.id}`, { status: "contacted" }, "Marked as called")}>I called them</Button>}
                    {mine && ["taken", "forwarded", "contacted"].includes(e.status) && <Button size="sm" variant="outline" disabled={busy === e.id} onClick={() => act(e.id, `/api/hub/enquiries/${e.id}`, { status: "closed", note: "Closed by the partner" }, "Closed")}>Close</Button>}
                  </div>
                )}
              </div>
            );
          })}</div>
        )}
      </Panel>
    </HubPage>
  );
}
