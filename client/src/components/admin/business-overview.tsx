/**
 * Admin dashboard — business overview.
 *
 * Money, kept apart: what customers paid (volume), what UniteFix keeps
 * (revenue, before GST), what partners and UniteFix's own experts earn, and
 * GST. Partners' own sales in the Hub are shown for context and never added
 * to UniteFix's numbers. Then the work as it stands right now, and the queues
 * waiting on staff.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Minus, RefreshCw, Download, ChevronRight, AlertTriangle, Star, Users, Wrench, Building2, Wifi } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type Range = "7d" | "30d" | "90d" | "12m";
type StreamKey = "services_direct" | "services_partner" | "broadband" | "parts" | "store" | "paylinks" | "subscriptions";
type Totals = { gmv: number; unitefix: number; partner: number; expert: number; gst: number; jobs: number; partnerOwnSales: number; takeRate: number };
type Overview = {
  range: Range; granularity: "day" | "week" | "month"; from: string; to: string;
  totals: { current: Totals; previous: Totals };
  streams: Array<{ key: StreamKey; label: string; note: string; gmv: number; unitefix: number; partner: number; expert: number; gst: number; previousUnitefix: number }>;
  series: Array<Record<StreamKey, number> & { label: string; start: string; unitefix: number; gmv: number; partner: number; expert: number; gst: number; partnerOwnSales: number }>;
  operations: {
    pipeline: Array<{ key: string; label: string; count: number; sub?: string }>;
    alerts: { overduePartnerJobs: number; partsAwaitingCustomer: number };
    period: { completed: number; cancelled: number; cancellationRate: number; rating: number | null; ratings: number; newCustomers: number };
    network: { customers: number; experts: number; online: number; partnerTechnicians: number; partners: number; proPartners: number };
  };
  attention: Array<{ key: string; label: string; count: number; href: string; tone: "urgent" | "normal"; amount?: number }>;
};

const STREAM_COLOR: Record<StreamKey, string> = {
  services_direct: "hsl(160,84%,45%)",
  services_partner: "hsl(217,91%,62%)",
  broadband: "hsl(190,85%,50%)",
  parts: "hsl(38,92%,55%)",
  store: "hsl(280,70%,68%)",
  paylinks: "hsl(330,75%,64%)",
  subscriptions: "hsl(14,85%,62%)",
};
const FLOW = [
  { key: "unitefix", label: "UniteFix", color: "hsl(160,84%,45%)" },
  { key: "partner", label: "Partners", color: "hsl(217,91%,62%)" },
  { key: "expert", label: "UniteFix experts", color: "hsl(38,92%,55%)" },
  { key: "gst", label: "GST", color: "hsl(215,16%,47%)" },
] as const;
const RANGES: Array<[Range, string]> = [["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["12m", "12 months"]];

const inr = (n: number, compact = false) => {
  if (compact && Math.abs(n) >= 100000) return `₹${(n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}L`;
  if (compact && Math.abs(n) >= 1000) return `₹${(n / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}k`;
  // Whole rupees on screen; the CSV export keeps paise.
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};
const change = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10);

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const c = change(cur, prev);
  if (c === null) return <span className="text-xs text-[hsl(160,84%,60%)]">new</span>;
  const Icon = c > 0 ? ArrowUpRight : c < 0 ? ArrowDownRight : Minus;
  const tone = c > 0 ? "text-[hsl(160,84%,60%)]" : c < 0 ? "text-[hsl(0,84%,68%)]" : "text-[hsl(215,20%,55%)]";
  return <span className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${tone}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{Math.abs(c)}%</span>;
}

const tooltipStyle = {
  contentStyle: { backgroundColor: "hsl(222,40%,10%)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, color: "white", fontSize: 12 },
  labelStyle: { color: "hsl(215,20%,70%)", marginBottom: 4 },
  cursor: { fill: "rgba(255,255,255,0.04)" },
};
const axis = { stroke: "hsl(215,20%,50%)", fontSize: 11, tickLine: false, axisLine: false } as const;

export function useOverview(range: Range) {
  return useQuery<Overview>({
    queryKey: ["/api/admin/reports/overview", range],
    queryFn: async () => (await apiRequest("GET", `/api/admin/reports/overview?range=${range}`)).data,
    refetchInterval: 60_000,
  });
}

export default function BusinessOverview() {
  const [range, setRange] = useState<Range>(() => { try { return (localStorage.getItem("dash.range") as Range) || "30d"; } catch { return "30d"; } });
  const [view, setView] = useState<"revenue" | "flow" | "partners">("revenue");
  const { data, isLoading, isError, refetch, isFetching } = useOverview(range);
  const { toast } = useToast();
  const pick = (r: Range) => { setRange(r); try { localStorage.setItem("dash.range", r); } catch { /* private mode */ } };

  const cur = data?.totals.current, prev = data?.totals.previous;
  const activeStreams = useMemo(() => (data?.streams ?? []).filter(s => s.unitefix !== 0 || s.gmv !== 0), [data]);
  const period = data ? `${new Date(data.from).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${new Date(data.to).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : "";

  const exportCsv = () => {
    if (!data) return;
    const rows: Array<Array<string | number>> = [
      ["UniteFix business overview", period],
      [],
      ["Measure", "This period", "Previous period"],
      ["Gross volume (customers paid, incl. GST)", data.totals.current.gmv, data.totals.previous.gmv],
      ["UniteFix revenue (before GST)", data.totals.current.unitefix, data.totals.previous.unitefix],
      ["Partner earnings", data.totals.current.partner, data.totals.previous.partner],
      ["UniteFix expert earnings", data.totals.current.expert, data.totals.previous.expert],
      ["GST collected", data.totals.current.gst, data.totals.previous.gst],
      ["Jobs completed", data.totals.current.jobs, data.totals.previous.jobs],
      ["Partners' own sales in the Hub (not UniteFix money)", data.totals.current.partnerOwnSales, data.totals.previous.partnerOwnSales],
      [],
      ["Stream", "Gross volume", "UniteFix revenue", "Partners", "Experts", "GST", "UniteFix revenue, previous period"],
      ...data.streams.map(s => [s.label, s.gmv, s.unitefix, s.partner, s.expert, s.gst, s.previousUnitefix]),
      [],
      ["Period", ...data.streams.map(s => `UniteFix · ${s.label}`), "UniteFix total", "Partners", "Experts", "GST", "Gross volume", "Partners' own sales"],
      ...data.series.map(b => [b.label, ...data.streams.map(s => b[s.key]), b.unitefix, b.partner, b.expert, b.gst, b.gmv, b.partnerOwnSales]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    a.download = `unitefix-overview-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    toast({ title: "Exported", description: "The overview for this period has been downloaded as CSV." });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Business overview</h2>
          <p className="mt-1 text-sm text-[hsl(215,20%,65%)]">{period || "Loading…"}{isFetching && !isLoading ? " · updating" : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Period" className="flex rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-1">
            {RANGES.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={range === k} onClick={() => pick(k)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${range === k ? "bg-[rgba(255,255,255,0.1)] text-white" : "text-[hsl(215,20%,65%)] hover:text-white"}`}>{l}</button>
            ))}
          </div>
          <button onClick={() => refetch()} aria-label="Refresh" className="rounded-lg border border-[rgba(255,255,255,0.08)] p-2 text-[hsl(215,20%,70%)] hover:bg-[rgba(255,255,255,0.06)] hover:text-white">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </button>
          <button onClick={exportCsv} disabled={!data} className="flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.08)] px-3 py-2 text-sm text-white hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-40">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      {isError && (
        <div className="rounded-xl border border-[hsla(0,84%,60%,0.3)] bg-[hsla(0,84%,60%,0.08)] p-4 text-sm text-[hsl(0,84%,75%)]">
          The overview could not load. <button className="underline" onClick={() => refetch()}>Try again</button>
        </div>
      )}

      {/* Money KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          { label: "UniteFix revenue", value: cur?.unitefix, prev: prev?.unitefix, hint: cur ? `${cur.takeRate}% of volume · before GST` : "", strong: true },
          { label: "Gross volume", value: cur?.gmv, prev: prev?.gmv, hint: "What customers paid, incl. GST" },
          { label: "Partner earnings", value: cur?.partner, prev: prev?.partner, hint: "Through UniteFix" },
          { label: "Expert earnings", value: cur?.expert, prev: prev?.expert, hint: "UniteFix's own experts" },
          { label: "Jobs completed", value: cur?.jobs, prev: prev?.jobs, hint: cur && cur.jobs ? `${inr(Math.round(data!.streams.filter(s => s.key === "services_direct" || s.key === "services_partner").reduce((a, s) => a + s.gmv, 0) / cur.jobs))} average job` : "", count: true },
        ].map(k => (
          <div key={k.label} className={`glass-card rounded-xl p-4 ${k.strong ? "col-span-2 lg:col-span-1 border-[hsla(160,84%,39%,0.35)]" : ""}`}>
            <p className="text-xs font-medium uppercase tracking-wider text-[hsl(215,20%,60%)]">{k.label}</p>
            {isLoading || k.value === undefined ? <div className="mt-2 h-8 w-24 rounded skeleton-shimmer" /> : (
              <>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-2xl font-bold tabular-nums ${k.strong ? "text-[hsl(160,84%,62%)]" : "text-white"}`}>{k.count ? k.value.toLocaleString("en-IN") : inr(k.value)}</span>
                  <Delta cur={k.value} prev={k.prev ?? 0} />
                </div>
                <p className="mt-1 text-xs text-[hsl(215,20%,55%)]">{k.hint}</p>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Chart */}
        <section className="glass-card rounded-xl p-5 xl:col-span-2" aria-labelledby="h-chart">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="h-chart" className="text-lg font-semibold text-white">
                {view === "revenue" ? "UniteFix revenue by stream" : view === "flow" ? "Where customers' money goes" : "Partners"}
              </h3>
              <p className="text-xs text-[hsl(215,20%,55%)]">
                {view === "revenue" ? `Before GST, per ${data?.granularity ?? "day"}` : view === "flow" ? "Each bar is everything customers paid, split by who it belongs to" : "Earned through UniteFix, and their own sales in the Hub"}
              </p>
            </div>
            <div role="tablist" aria-label="Chart" className="flex rounded-lg border border-[rgba(255,255,255,0.08)] p-1 text-sm">
              {([["revenue", "Revenue"], ["flow", "Money flow"], ["partners", "Partners"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                  className={`rounded-md px-3 py-1 ${view === k ? "bg-[rgba(255,255,255,0.1)] text-white" : "text-[hsl(215,20%,65%)] hover:text-white"}`}>{l}</button>
              ))}
            </div>
          </div>
          {isLoading ? <div className="h-[320px] rounded-xl skeleton-shimmer" /> : !data || data.series.every(b => b.gmv === 0 && b.unitefix === 0 && b.partnerOwnSales === 0) ? (
            <div className="flex h-[320px] flex-col items-center justify-center text-center">
              <p className="font-medium text-[hsl(210,20%,85%)]">No money moved in this period</p>
              <p className="mt-1 text-sm text-[hsl(215,20%,55%)]">Completed jobs, recharges, parts and store orders appear here as they happen. Try a longer period.</p>
            </div>
          ) : (
            <>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  {view === "revenue" ? (
                    <BarChart data={data.series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="label" {...axis} minTickGap={16} dy={6} />
                      <YAxis {...axis} width={56} tickFormatter={v => inr(v, true)} />
                      <Tooltip {...tooltipStyle} formatter={(v: number, k: string) => [inr(v), data.streams.find(s => s.key === k)?.label ?? k]} />
                      {data.streams.map(s => <Bar key={s.key} dataKey={s.key} stackId="uf" fill={STREAM_COLOR[s.key]} maxBarSize={36} />)}
                    </BarChart>
                  ) : view === "flow" ? (
                    <BarChart data={data.series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="label" {...axis} minTickGap={16} dy={6} />
                      <YAxis {...axis} width={56} tickFormatter={v => inr(v, true)} />
                      <Tooltip {...tooltipStyle} formatter={(v: number, k: string) => [inr(v), FLOW.find(f => f.key === k)?.label ?? k]} />
                      {FLOW.map(f => <Bar key={f.key} dataKey={f.key} stackId="flow" fill={f.color} maxBarSize={36} />)}
                    </BarChart>
                  ) : (
                    <ComposedChart data={data.series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="label" {...axis} minTickGap={16} dy={6} />
                      <YAxis {...axis} width={56} tickFormatter={v => inr(v, true)} />
                      <Tooltip {...tooltipStyle} formatter={(v: number, k: string) => [inr(v), k === "partner" ? "Partner earnings through UniteFix" : "Partners' own sales (Hub)"]} />
                      <Bar dataKey="partner" fill="hsl(217,91%,62%)" maxBarSize={36} radius={[3, 3, 0, 0]} />
                      <Line dataKey="partnerOwnSales" stroke="hsl(280,70%,72%)" strokeWidth={2} dot={false} type="monotone" />
                    </ComposedChart>
                  )}
                </ResponsiveContainer>
              </div>
              {/* Legend with the period total for each series. */}
              <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
                {view === "revenue" ? activeStreams.map(s => (
                  <li key={s.key} className="flex items-center gap-2" title={s.note}>
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STREAM_COLOR[s.key] }} />
                    <span className="text-[hsl(215,20%,70%)]">{s.label}</span><span className="font-medium tabular-nums text-white">{inr(s.unitefix)}</span>
                  </li>
                )) : view === "flow" ? FLOW.map(f => (
                  <li key={f.key} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: f.color }} />
                    <span className="text-[hsl(215,20%,70%)]">{f.label}</span><span className="font-medium tabular-nums text-white">{inr(cur?.[f.key] ?? 0)}</span>
                  </li>
                )) : (
                  <>
                    <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-[hsl(217,91%,62%)]" /><span className="text-[hsl(215,20%,70%)]">Earned through UniteFix</span><span className="font-medium tabular-nums text-white">{inr(cur?.partner ?? 0)}</span></li>
                    <li className="flex items-center gap-2"><span className="h-0.5 w-3 bg-[hsl(280,70%,72%)]" /><span className="text-[hsl(215,20%,70%)]">Own sales invoiced in the Hub</span><span className="font-medium tabular-nums text-white">{inr(cur?.partnerOwnSales ?? 0)}</span></li>
                  </>
                )}
              </ul>
            </>
          )}
        </section>

        <div className="flex flex-col gap-6">
        {/* Needs attention */}
          <section className="glass-card rounded-xl p-5" aria-labelledby="h-attn">
            <h3 id="h-attn" className="text-lg font-semibold text-white">Needs attention</h3>
            <p className="text-xs text-[hsl(215,20%,55%)]">Queues waiting on staff, most urgent first</p>
            {isLoading ? <div className="mt-4 h-48 rounded-lg skeleton-shimmer" /> : !data?.attention.length ? (
              <div className="mt-6 rounded-lg bg-[hsla(160,84%,39%,0.08)] p-4 text-sm text-[hsl(160,84%,65%)]">Nothing waiting. Every queue is clear.</div>
            ) : (
              <ul className="mt-3 divide-y divide-[rgba(255,255,255,0.06)]">
                {data.attention.map(a => (
                  <li key={a.key}>
                    <Link href={a.href} className="flex items-center gap-3 py-2.5 hover:text-white">
                      <span className={`min-w-[2.25rem] rounded-md px-2 py-0.5 text-center text-sm font-semibold tabular-nums ${a.tone === "urgent" ? "bg-[hsla(0,84%,60%,0.15)] text-[hsl(0,84%,72%)]" : "bg-[rgba(255,255,255,0.06)] text-white"}`}>{a.count}</span>
                      <span className="flex-1 text-sm text-[hsl(210,20%,85%)]">{a.label}{a.amount ? <span className="block text-xs text-[hsl(215,20%,55%)]">{inr(a.amount)} to pay out</span> : null}</span>
                      <ChevronRight className="h-4 w-4 text-[hsl(215,20%,45%)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="glass-card rounded-xl p-5" aria-labelledby="h-net">
            <h3 id="h-net" className="text-lg font-semibold text-white">Network</h3>
            {data ? (
              <ul className="mt-3 space-y-3 text-sm">
                <li className="flex items-center gap-3"><Users className="h-4 w-4 text-[hsl(217,91%,65%)]" /><span className="flex-1 text-[hsl(210,20%,85%)]">Customers</span><span className="font-semibold tabular-nums text-white">{data.operations.network.customers.toLocaleString("en-IN")}</span></li>
                <li className="flex items-center gap-3"><Wrench className="h-4 w-4 text-[hsl(38,92%,60%)]" /><span className="flex-1 text-[hsl(210,20%,85%)]">UniteFix experts</span><span className="font-semibold tabular-nums text-white">{data.operations.network.experts}</span></li>
                <li className="flex items-center gap-3"><Wifi className="h-4 w-4 text-[hsl(160,84%,55%)]" /><span className="flex-1 text-[hsl(210,20%,85%)]">Online now</span><span className="font-semibold tabular-nums text-white">{data.operations.network.online}</span></li>
                <li className="flex items-center gap-3"><Building2 className="h-4 w-4 text-[hsl(280,70%,70%)]" /><span className="flex-1 text-[hsl(210,20%,85%)]">Active partners<span className="block text-xs text-[hsl(215,20%,55%)]">{data.operations.network.proPartners} on Hub Pro · {data.operations.network.partnerTechnicians} partner technicians</span></span><span className="font-semibold tabular-nums text-white">{data.operations.network.partners}</span></li>
              </ul>
            ) : <div className="mt-4 h-32 rounded-lg skeleton-shimmer" />}
          </section>
        </div>
      </div>

      {/* Streams table */}
      <section className="glass-card overflow-hidden rounded-xl" aria-labelledby="h-streams">
        <div className="p-5 pb-3">
          <h3 id="h-streams" className="text-lg font-semibold text-white">Revenue streams</h3>
          <p className="text-xs text-[hsl(215,20%,55%)]">Who each rupee belongs to, by line of business. Partner and expert columns are what they earn; GST is not revenue.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-[rgba(255,255,255,0.06)] text-left text-[11px] uppercase tracking-wider text-[hsl(215,20%,55%)]">
                <th className="px-5 py-2 font-medium">Stream</th>
                <th className="px-3 py-2 text-right font-medium">Gross volume</th>
                <th className="px-3 py-2 text-right font-medium">UniteFix</th>
                <th className="px-3 py-2 text-right font-medium">vs previous</th>
                <th className="px-3 py-2 text-right font-medium">Partners</th>
                <th className="px-3 py-2 text-right font-medium">Experts</th>
                <th className="px-5 py-2 text-right font-medium">GST</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {(data?.streams ?? []).map(s => {
                const idle = s.gmv === 0 && s.unitefix === 0 && s.previousUnitefix === 0;
                return (
                  <tr key={s.key} className={`border-b border-[rgba(255,255,255,0.04)] ${idle ? "opacity-45" : ""}`}>
                    <td className="px-5 py-2.5">
                      <span className="flex min-w-[9.5rem] items-center gap-2 text-white"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: STREAM_COLOR[s.key] }} />{s.label}</span>
                      <span className="hidden pl-[18px] text-xs text-[hsl(215,20%,50%)] sm:block">{s.note}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-[hsl(210,20%,85%)]">{inr(s.gmv)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-[hsl(160,84%,62%)]">{inr(s.unitefix)}</td>
                    <td className="px-3 py-2.5 text-right">{idle ? <span className="text-xs text-[hsl(215,20%,45%)]">—</span> : <Delta cur={s.unitefix} prev={s.previousUnitefix} />}</td>
                    <td className="px-3 py-2.5 text-right text-[hsl(210,20%,85%)]">{s.partner ? inr(s.partner) : "—"}</td>
                    <td className="px-3 py-2.5 text-right text-[hsl(210,20%,85%)]">{s.expert ? inr(s.expert) : "—"}</td>
                    <td className="px-5 py-2.5 text-right text-[hsl(215,20%,60%)]">{s.gst ? inr(s.gst) : "—"}</td>
                  </tr>
                );
              })}
              {cur && (
                <tr className="font-semibold">
                  <td className="px-5 py-3 text-white">Total</td>
                  <td className="px-3 py-3 text-right text-white">{inr(cur.gmv)}</td>
                  <td className="px-3 py-3 text-right text-[hsl(160,84%,62%)]">{inr(cur.unitefix)}</td>
                  <td className="px-3 py-3 text-right"><Delta cur={cur.unitefix} prev={prev?.unitefix ?? 0} /></td>
                  <td className="px-3 py-3 text-right text-white">{inr(cur.partner)}</td>
                  <td className="px-3 py-3 text-right text-white">{inr(cur.expert)}</td>
                  <td className="px-5 py-3 text-right text-[hsl(215,20%,60%)]">{inr(cur.gst)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {cur && cur.partnerOwnSales > 0 && (
          <p className="border-t border-[rgba(255,255,255,0.06)] px-5 py-3 text-xs text-[hsl(215,20%,55%)]">
            Partners also invoiced {inr(cur.partnerOwnSales)} to their own customers through the Hub this period. That is their business, not UniteFix's, and is not in the totals above.
          </p>
        )}
      </section>

      {/* Operations */}
      <div>
        <section className="glass-card rounded-xl p-5" aria-labelledby="h-ops">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="h-ops" className="text-lg font-semibold text-white">Jobs right now</h3>
            <Link href="/services" className="text-xs text-[hsl(217,91%,70%)] hover:text-white">All service requests →</Link>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(data?.operations.pipeline ?? Array.from({ length: 4 }, (_, i) => ({ key: String(i), label: "", count: 0, sub: undefined as string | undefined }))).map(p => (
              <div key={p.key} className="rounded-lg bg-[rgba(255,255,255,0.03)] p-3">
                <p className="text-xs text-[hsl(215,20%,60%)]">{p.label || " "}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-white">{isLoading ? "–" : p.count}</p>
                {p.sub ? <p className="text-xs text-[hsl(215,20%,50%)]">{p.sub}</p> : null}
              </div>
            ))}
          </div>
          {data && (data.operations.alerts.overduePartnerJobs > 0 || data.operations.alerts.partsAwaitingCustomer > 0) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.operations.alerts.overduePartnerJobs > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsla(0,84%,60%,0.12)] px-3 py-1 text-xs text-[hsl(0,84%,72%)]"><AlertTriangle className="h-3.5 w-3.5" />{data.operations.alerts.overduePartnerJobs} partner job(s) past their assign-by time</span>
              )}
              {data.operations.alerts.partsAwaitingCustomer > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsla(38,92%,50%,0.12)] px-3 py-1 text-xs text-[hsl(38,92%,65%)]">{data.operations.alerts.partsAwaitingCustomer} spare part(s) waiting for the customer's approval</span>
              )}
            </div>
          )}
          {data && (
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[rgba(255,255,255,0.06)] pt-4 sm:grid-cols-4">
              <div><dt className="text-xs text-[hsl(215,20%,55%)]">Completed</dt><dd className="text-lg font-semibold tabular-nums text-white">{data.operations.period.completed}</dd></div>
              <div><dt className="text-xs text-[hsl(215,20%,55%)]">Cancelled</dt><dd className="text-lg font-semibold tabular-nums text-white">{data.operations.period.cancelled} <span className="text-xs font-normal text-[hsl(215,20%,55%)]">{data.operations.period.cancellationRate}%</span></dd></div>
              <div><dt className="text-xs text-[hsl(215,20%,55%)]">Rating</dt><dd className="flex items-center gap-1 text-lg font-semibold tabular-nums text-white">{data.operations.period.rating ?? "—"}{data.operations.period.rating && <Star className="h-4 w-4 fill-[hsl(45,93%,58%)] text-[hsl(45,93%,58%)]" />}<span className="text-xs font-normal text-[hsl(215,20%,55%)]">{data.operations.period.ratings} rated</span></dd></div>
              <div><dt className="text-xs text-[hsl(215,20%,55%)]">New customers</dt><dd className="text-lg font-semibold tabular-nums text-white">{data.operations.period.newCustomers}</dd></div>
            </dl>
          )}
        </section>


      </div>
    </div>
  );
}
