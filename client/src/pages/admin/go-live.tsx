/**
 * Go-live checklist — every key, account and setting checked against the
 * running server. Shows whether something is set, never its value.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

type Check = { key: string; area: string; label: string; status: "ok" | "action" | "info"; detail: string; fix?: string };
const TONE: Record<Check["status"], string> = {
  ok: "border-emerald-500/40 text-emerald-600 dark:text-emerald-300",
  action: "border-rose-500/40 text-rose-600 dark:text-rose-300",
  info: "border-sky-500/40 text-sky-600 dark:text-sky-300",
};
const LABEL: Record<Check["status"], string> = { ok: "Ready", action: "To do", info: "Note" };

export default function GoLivePage() {
  const q = useQuery<{ checks: Check[]; summary: { ok: number; action: number; info: number } }>({ queryKey: ["/api/admin/hub/go-live"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/go-live")).data });
  const areas = Array.from(new Set((q.data?.checks ?? []).map(c => c.area)));
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Go-live checklist</h1>
          <p className="text-sm text-muted-foreground">Keys, accounts and settings the platform and the Partner Hub need before real customers and real money. Checked live on this server; no secret is ever shown.</p>
        </div>
        <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Checking…" : "Check again"}</Button>
      </div>
      {q.data && <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="outline" className={TONE.action}>{q.data.summary.action} to do</Badge>
        <Badge variant="outline" className={TONE.ok}>{q.data.summary.ok} ready</Badge>
        <Badge variant="outline" className={TONE.info}>{q.data.summary.info} notes</Badge>
      </div>}
      {q.isLoading && <p className="text-sm text-muted-foreground">Checking…</p>}
      {q.isError && <p className="text-sm text-destructive">Could not run the checks. Only super admins can see this page.</p>}
      {areas.map(area => (
        <Card key={area}>
          <CardHeader className="pb-2"><CardTitle className="text-base font-medium">{area}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">{q.data!.checks.filter(c => c.area === area).sort((a, b) => (a.status === "action" ? 0 : 1) - (b.status === "action" ? 0 : 1)).map(c => (
              <li key={c.key} className="grid gap-1 px-6 py-3 sm:grid-cols-[7rem_1fr]">
                <span><Badge variant="outline" className={TONE[c.status]}>{LABEL[c.status]}</Badge></span>
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{c.label}</p>
                  <p className="text-muted-foreground">{c.detail}</p>
                  {c.fix && c.status !== "ok" && <p className="mt-1 text-xs"><span className="font-medium">How: </span>{c.fix}</p>}
                </div>
              </li>
            ))}</ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
