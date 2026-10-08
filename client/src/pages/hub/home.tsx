/**
 * Partner Hub — home.
 *
 * While an application is under review this is the onboarding progress and
 * nothing else. Once approved it is the set-up checklist for the business's
 * modules and the way into each of them.
 */

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useHubMe, hubHas, hubCan } from "@/lib/hub";
import { HubPage, Panel, Chip, Stat } from "@/components/hub/ui";
import { HUB_ENTRIES } from "@/components/hub/registry";
import { MODULE_LABEL, PLAN_LABEL, HUB_ROLE_LABEL } from "@shared/hub";
import { apiRequest } from "@/lib/queryClient";

export default function HubHome() {
  const { me } = useHubMe();
  const team = useQuery<any[]>({
    queryKey: ["/api/hub/team"],
    queryFn: async () => (await apiRequest("GET", "/api/hub/team")).data,
    enabled: me?.status === "active",
  });
  const summary = useQuery<any>({
    queryKey: ["/api/hub/summary"],
    queryFn: async () => (await apiRequest("GET", "/api/hub/summary")).data,
    enabled: me?.status === "active",
    retry: false,
  });
  if (!me) return null;

  const pending = me.status !== "active";
  const done = me.onboarding.steps.filter(s => s.done).length;

  const checklist: Array<{ label: string; done: boolean; href: string }> = [
    { label: "Verify your business (GSTIN, PAN, bank, documents)", done: me.onboarding.steps.every(s => s.done), href: "/partner/onboarding" },
  ];
  if (hubCan(me, "team:manage")) checklist.push({ label: "Invite your team — accountant, dispatcher", done: (team.data?.filter(m => m.status === "active").length ?? 1) > 1, href: "/partner/team" });
  if (summary.data?.checklist) checklist.push(...summary.data.checklist);
  if (hubHas(me, "broadband")) checklist.push({ label: "Broadband: plans, add-ons and coverage", done: !!summary.data?.broadband?.plans, href: "/partner/broadband/plans" });

  const moduleLinks = HUB_ENTRIES.filter(e => e.nav && !e.anyModule && e.module !== "home" && e.module !== "onboarding" && hubHas(me, e.module) && (!e.perm || hubCan(me, e.perm)) && (!e.show || e.show(me)))
    .reduce<Record<string, { label: string; href: string; icon: string }>>((acc, e) => { if (!acc[e.module]) acc[e.module] = { label: MODULE_LABEL[e.module], href: e.path, icon: e.nav!.icon }; return acc; }, {});

  return (
    <HubPage
      title={pending ? `Welcome, ${me.displayName}` : me.displayName}
      subtitle={pending
        ? "Finish these steps and submit. UniteFix reviews applications within 48 hours; your Hub opens fully once approved."
        : <>{me.partnerCode} · {HUB_ROLE_LABEL[me.role]} · {PLAN_LABEL[me.plan]} · {me.business?.stateName ?? "State not set"}</>}
    >
      {pending ? (
        <Panel title={`Onboarding — ${done} of ${me.onboarding.steps.length} done`} actions={<Link href="/partner/onboarding" className="text-sm text-[hsl(174,72%,60%)] hover:text-white">Continue →</Link>}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {me.onboarding.steps.map(s => (
              <li key={s.key} className="flex items-start gap-3 rounded-lg bg-[rgba(255,255,255,0.03)] p-3">
                <span className={`material-icons text-[20px] ${s.done ? "text-emerald-400" : "text-[hsl(215,20%,45%)]"}`} style={{ fontFamily: "Material Icons" }}>{s.done ? "check_circle" : "radio_button_unchecked"}</span>
                <div className="min-w-0"><p className="text-sm text-white">{s.label}</p><p className="text-xs text-[hsl(215,20%,60%)] break-words">{s.detail}</p></div>
              </li>
            ))}
          </ul>
          {me.onboarding.submittedAt && <p className="mt-4 text-sm text-emerald-300">Submitted on {new Date(me.onboarding.submittedAt).toLocaleDateString("en-IN")}. UniteFix is reviewing it.</p>}
          {me.onboarding.rejectionReason && <p className="mt-4 text-sm text-rose-300">UniteFix asked for changes: {me.onboarding.rejectionReason}</p>}
        </Panel>
      ) : (
        <>
          {summary.data?.stats?.length > 0 && (
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {summary.data.stats.map((s: any) => <Stat key={s.label} label={s.label} value={s.value} hint={s.hint} />)}
            </div>
          )}
          <Panel title="Set-up checklist">
            <ul className="space-y-2">
              {checklist.map(c => (
                <li key={c.label}>
                  <Link href={c.href} className="flex items-center gap-3 rounded-lg p-2 hover:bg-[rgba(255,255,255,0.03)]">
                    <span className={`material-icons text-[20px] ${c.done ? "text-emerald-400" : "text-[hsl(215,20%,45%)]"}`} style={{ fontFamily: "Material Icons" }}>{c.done ? "check_circle" : "radio_button_unchecked"}</span>
                    <span className={`text-sm ${c.done ? "text-[hsl(215,20%,60%)] line-through" : "text-white"}`}>{c.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Your modules">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {Object.entries(moduleLinks).map(([mod, l]) => (
                <Link key={mod} href={l.href} className="rounded-xl border border-[rgba(255,255,255,0.08)] p-4 hover:border-[hsla(174,72%,40%,0.5)] hover:bg-[rgba(255,255,255,0.02)]">
                  <span className="material-icons text-[hsl(174,72%,55%)]" style={{ fontFamily: "Material Icons" }}>{l.icon}</span>
                  <p className="mt-2 text-sm font-medium text-white">{l.label}</p>
                </Link>
              ))}
            </div>
            <p className="mt-4 text-xs text-[hsl(215,20%,55%)]">Modules follow what your business does: {me.verticals.map(v => <Chip key={v}>{v}</Chip>)}. Need another? Ask UniteFix to add a vertical.</p>
          </Panel>
        </>
      )}
    </HubPage>
  );
}
