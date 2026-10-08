/**
 * The Partner Hub shell — one portal for every business partner.
 *
 * Replaces the FTTH-only operator portal: a broadband operator sees the same
 * Broadband pages it always had, inside the Hub, alongside the back office
 * every partner gets. Navigation is built from the business's modules and the
 * signed-in person's role (registry.tsx); the server enforces both again.
 *
 * Kept separate from the staff shell for the same reason the operator portal
 * was: no URL a partner can type renders a staff page.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { HUB_ENTRIES, HUB_GROUP_ORDER, type HubEntry } from "@/components/hub/registry";
import { useHubMe, hubCan, hubHas, signOut, type HubMe } from "@/lib/hub";
import { HUB_ROLE_LABEL, PLAN_LABEL } from "@shared/hub";
import NotFound from "@/pages/not-found";
import { AlertBell } from "@/components/hub/AlertBell";

const Icon = ({ name, className = "" }: { name: string; className?: string }) => (
  <span className={`material-icons ${className}`} style={{ fontFamily: "Material Icons" }} aria-hidden="true">{name}</span>
);

function visible(me: HubMe, e: HubEntry) {
  if (!(e.anyModule ? e.anyModule.some(m => hubHas(me, m)) : hubHas(me, e.module))) return false;
  if (e.show && !e.show(me)) return false;
  if (me.status !== "active" && !e.pending) return false;
  if (e.perm && !hubCan(me, e.perm)) return false;
  return true;
}

function Sidebar({ me, open, onClose }: { me: HubMe; open: boolean; onClose: () => void }) {
  const [location] = useLocation();
  useEffect(() => { onClose(); /* close the drawer on navigation */ }, [location]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const byGroup = new Map<string, HubEntry[]>();
    HUB_ENTRIES.filter(e => e.nav && visible(me, e)).forEach(e => {
      const g = e.nav!.group;
      byGroup.set(g, [...(byGroup.get(g) ?? []), e]);
    });
    return HUB_GROUP_ORDER.filter(g => byGroup.has(g)).map(g => [g, byGroup.get(g)!] as const);
  }, [me]);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={`glass-sidebar flex flex-col h-screen z-50 w-64 shrink-0 fixed inset-y-0 left-0 transition-transform duration-300 ease-out
          ${open ? "translate-x-0" : "-translate-x-full"} lg:sticky lg:top-0 lg:translate-x-0 lg:transition-none`}
        aria-label="Partner Hub navigation"
      >
        <div className="p-5 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[hsla(174,72%,40%,0.15)] border border-[hsla(174,72%,40%,0.35)] shrink-0">
              <Icon name="storefront" className="text-[hsl(174,72%,55%)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white font-semibold truncate" title={me.displayName}>{me.displayName}</p>
              <p className="text-[11px] text-[hsl(215,20%,60%)] font-mono">{me.partnerCode} · {HUB_ROLE_LABEL[me.role]}</p>
            </div>
            <div className="hidden lg:block"><AlertBell /></div>
          </div>
          {me.status !== "active" && (
            <p className="mt-3 text-xs rounded-md px-2 py-1.5 bg-[hsla(38,92%,50%,0.12)] text-[hsl(38,92%,65%)]">
              {me.status === "pending_approval" ? "Application under review" : "Account paused"}
            </p>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
          {groups.map(([group, entries]) => (
            <div key={group}>
              <p className="px-3 mb-1 text-[10px] font-mono uppercase tracking-wider text-[hsl(215,20%,50%)]">{group}</p>
              {entries.map(e => {
                const active = location === e.path || (e.path !== "/partner" && location.startsWith(e.path + "/"));
                return (
                  <Link key={e.path} href={e.path} aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${active
                      ? "bg-[hsla(174,72%,40%,0.14)] text-white"
                      : "text-[hsl(215,20%,70%)] hover:bg-[rgba(255,255,255,0.04)] hover:text-white"}`}>
                    <Icon name={e.nav!.icon} className="text-[18px]" />
                    {e.nav!.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="p-4 border-t border-[rgba(255,255,255,0.06)] space-y-2">
          <p className="text-[11px] text-[hsl(215,20%,55%)]">Plan: <span className="text-[hsl(210,20%,85%)]">{PLAN_LABEL[me.plan]}</span></p>
          <button onClick={signOut} className="w-full flex items-center gap-2 text-sm text-[hsl(215,20%,65%)] hover:text-white">
            <Icon name="logout" className="text-[18px]" /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}

export default function PartnerHubLayout() {
  const { me, isLoading, error } = useHubMe();
  const [open, setOpen] = useState(false);
  const [location, navigate] = useLocation();

  // Old operator-portal URLs land on their new home.
  useEffect(() => {
    const hit = HUB_ENTRIES.find(e => e.aliases?.includes(location));
    if (hit && hit.path !== location) navigate(hit.path, { replace: true });
  }, [location, navigate]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-surface-0 text-[hsl(215,20%,65%)]">Opening your Hub…</div>;

  if (!me) {
    const msg = error?.message ?? "";
    const paused = msg.includes("PARTNER_NOT_ACTIVE") || msg.includes("LOGIN_DISABLED");
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-0 noise-overlay p-8">
        <div className="glass-card border border-[rgba(255,255,255,0.08)] rounded-xl p-8 max-w-md text-center">
          <Icon name={paused ? "pause_circle" : "error_outline"} className="text-4xl text-[hsl(38,92%,55%)]" />
          <h2 className="text-xl font-bold text-white mt-3">{paused ? "Access paused" : "Could not open your Hub"}</h2>
          <p className="text-sm text-[hsl(215,20%,65%)] mt-2">
            {paused ? "This login or business is not active right now. Ask the business owner, or contact UniteFix." : "Sign in again. If it keeps happening, contact UniteFix."}
          </p>
          <button onClick={signOut} className="mt-5 text-sm text-[hsl(210,20%,75%)] hover:text-white underline underline-offset-4">Sign out</button>
        </div>
      </div>
    );
  }

  const routes = HUB_ENTRIES.filter(e => visible(me, e));

  return (
    <div className="min-h-screen flex bg-surface-0 noise-overlay">
      <Sidebar me={me} open={open} onClose={() => setOpen(false)} />
      <div className="flex-1 min-w-0 overflow-y-auto h-screen">
        <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 h-14 border-b border-[rgba(255,255,255,0.06)] bg-[hsla(222,47%,6%,0.85)] backdrop-blur-md">
          <button onClick={() => setOpen(true)} className="text-[hsl(210,20%,80%)] hover:text-white p-2 -ml-2 rounded-lg" aria-label="Open navigation">
            <Icon name="menu" />
          </button>
          <span className="font-bold tracking-tight text-white truncate">{me.displayName}</span>
          <div className="ml-auto"><AlertBell /></div>
        </header>
        <Switch>
          {routes.map(e => <Route key={e.path} path={e.path} component={e.component} />)}
          {routes.flatMap(e => (e.aliases ?? []).map(a => <Route key={a} path={a} component={e.component} />))}
          <Route component={NotFound} />
        </Switch>
      </div>
    </div>
  );
}
