/**
 * The Partner Hub bell: unread alerts, the latest few in a panel, and a page
 * with all of them plus how the business wants to be told.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useHubMe, hubCan } from "@/lib/hub";
import { HubPage, Panel, Empty } from "@/components/hub/ui";

type Alert = { id: number; kind: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };
type Feed = { unread: number; items: Alert[] };

const ago = (d: string) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export function useAlerts() {
  return useQuery<Feed>({ queryKey: ["/api/hub/alerts"], queryFn: async () => (await apiRequest("GET", "/api/hub/alerts?limit=50")).data, refetchInterval: 60_000 });
}

export function AlertBell() {
  const { data } = useAlerts();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const unread = data?.unread ?? 0;
  const go = async (a: Alert) => {
    setOpen(false);
    if (!a.readAt) { await apiRequest("POST", "/api/hub/alerts/read", { id: a.id }).catch(() => null); qc.invalidateQueries({ queryKey: ["/api/hub/alerts"] }); }
    if (a.link) navigate(a.link);
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"} aria-expanded={open}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-[hsl(210,20%,80%)] hover:bg-white/5 hover:text-white">
        <span className="material-icons text-[20px]" style={{ fontFamily: "Material Icons" }} aria-hidden="true">notifications</span>
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white tabular-nums">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[rgba(255,255,255,0.1)] bg-[hsl(222,47%,9%)] shadow-2xl lg:right-auto lg:left-0">
          <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-4 py-2.5">
            <span className="text-sm font-semibold text-white">Alerts</span>
            {unread > 0 && <button className="text-xs text-[hsl(174,72%,60%)] hover:text-white" onClick={async () => { await apiRequest("POST", "/api/hub/alerts/read", {}); qc.invalidateQueries({ queryKey: ["/api/hub/alerts"] }); }}>Mark all read</button>}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {!(data?.items ?? []).length && <li className="px-4 py-6 text-center text-sm text-[hsl(215,20%,60%)]">Nothing yet. New jobs, enquiries and orders show up here.</li>}
            {(data?.items ?? []).slice(0, 8).map(a => (
              <li key={a.id}>
                <button onClick={() => go(a)} className={`block w-full px-4 py-2.5 text-left hover:bg-white/5 ${a.readAt ? "" : "bg-[hsla(174,72%,40%,0.08)]"}`}>
                  <span className="flex items-center gap-2 text-sm text-white">{!a.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-[hsl(174,72%,50%)]" aria-label="unread" />}{a.title}</span>
                  <span className="mt-0.5 block text-xs text-[hsl(215,20%,65%)]">{a.body}</span>
                  <span className="mt-0.5 block text-[11px] text-[hsl(215,20%,50%)]">{ago(a.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/partner/alerts" onClick={() => setOpen(false)} className="block border-t border-[rgba(255,255,255,0.08)] px-4 py-2.5 text-center text-sm text-[hsl(174,72%,60%)] hover:text-white">All alerts and settings</Link>
        </div>
      )}
    </div>
  );
}

export function HubAlertsPage() {
  const { me } = useHubMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data, isLoading } = useAlerts();
  const prefs = useQuery<{ prefs: { email: boolean; push: boolean; sms: boolean }; available: { email: boolean; sms: boolean; push: boolean } }>({ queryKey: ["/api/hub/alerts/prefs"], queryFn: async () => (await apiRequest("GET", "/api/hub/alerts/prefs")).data });
  const canSet = hubCan(me, "settings:manage");
  const setPref = async (k: "email" | "push" | "sms", v: boolean) => {
    try { await apiRequest("PUT", "/api/hub/alerts/prefs", { [k]: v }); qc.invalidateQueries({ queryKey: ["/api/hub/alerts/prefs"] }); }
    catch (e) { toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }); }
  };
  const p = prefs.data;
  const CH: Array<["email" | "push" | "sms", string, string]> = [
    ["email", "Email", "To each team member whose role covers the alert"],
    ["push", "UniteFix app", "To your business login in the UniteFix app"],
    ["sms", "Text message", "Urgent ones only: new jobs, overdue jobs, warranty claims, booking requests, store orders"],
  ];
  return (
    <HubPage title="Alerts" subtitle="Everything that needs you: new jobs, enquiries, booking requests, orders, warranty claims, decisions from UniteFix and payments."
      actions={(data?.unread ?? 0) > 0 ? <Button variant="outline" onClick={async () => { await apiRequest("POST", "/api/hub/alerts/read", {}); qc.invalidateQueries({ queryKey: ["/api/hub/alerts"] }); }}>Mark all read</Button> : undefined}>
      <Panel title="How we tell you">
        <ul className="grid gap-3 sm:grid-cols-3">{CH.map(([k, label, hint]) => (
          <li key={k} className="rounded-lg border border-[rgba(255,255,255,0.08)] p-3">
            <label className="flex items-center gap-2 text-sm text-white">
              <input type="checkbox" disabled={!canSet || !p} checked={!!p?.prefs[k]} onChange={e => setPref(k, e.target.checked)} /> {label}
            </label>
            <p className="mt-1 text-xs text-[hsl(215,20%,60%)]">{hint}</p>
            {p && !p.available[k] && <p className="mt-1 text-xs text-amber-300">Not set up on UniteFix's side yet — alerts still appear here.</p>}
          </li>
        ))}</ul>
      </Panel>
      <Panel title="All alerts">
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : !(data?.items ?? []).length ? <Empty icon="notifications" title="No alerts yet" /> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)]">{data!.items.map(a => (
            <li key={a.id} className="flex flex-wrap items-start gap-3 py-3">
              {!a.readAt ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(174,72%,50%)]" aria-label="unread" /> : <span className="mt-1.5 h-2 w-2 shrink-0" />}
              <div className="min-w-0 flex-1 text-sm"><p className="text-white">{a.title}</p><p className="text-[hsl(215,20%,70%)]">{a.body}</p><p className="text-xs text-[hsl(215,20%,50%)]">{ago(a.createdAt)}</p></div>
              {a.link && <Button size="sm" variant="ghost" onClick={async () => { if (!a.readAt) await apiRequest("POST", "/api/hub/alerts/read", { id: a.id }).catch(() => null); qc.invalidateQueries({ queryKey: ["/api/hub/alerts"] }); navigate(a.link!); }}>Open</Button>}
            </li>
          ))}</ul>
        )}
      </Panel>
    </HubPage>
  );
}
