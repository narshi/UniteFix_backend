/**
 * Audit Trail — who changed what, and when.
 *
 * The audit_logs table was written to by several flows but had no read
 * endpoint and no UI, so the trail was invisible. This surfaces it with the
 * filters an admin actually needs during an investigation: entity, action,
 * actor, date range, and free text across the metadata.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, RefreshCw, ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";
import { format } from "date-fns";

interface AuditRow {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  fromState: string | null;
  toState: string | null;
  changedBy: number | null;
  actorName: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const ALL = "__all__";

/** Actions that move money or change access get visual weight. */
const HIGH_IMPACT = /payout|withdrawal|refund|dispute|override|config|verified|rejected|suspended|delete/i;

function actionTone(action: string) {
  if (/fail|revers|reject|suspend|delete/i.test(action)) {
    return "bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border-[hsla(347,77%,50%,0.3)]";
  }
  if (/approve|complete|verified|resolved/i.test(action)) {
    return "bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)]";
  }
  if (/override|config/i.test(action)) {
    return "bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,65%)] border-[hsla(38,92%,50%,0.3)]";
  }
  return "bg-[rgba(255,255,255,0.04)] text-[hsl(215,20%,75%)] border-[rgba(255,255,255,0.1)]";
}

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState(ALL);
  const [action, setAction] = useState(ALL);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const params = new URLSearchParams({ page: String(page), limit: "25" });
  if (entityType !== ALL) params.set("entityType", entityType);
  if (action !== ALL) params.set("action", action);
  if (search) params.set("q", search);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<any>({
    queryKey: [`/api/admin/audit-logs?${params.toString()}`],
  });

  const { data: filterData } = useQuery<any>({
    queryKey: ["/api/admin/audit-logs/filters"],
  });

  const rows: AuditRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, totalPages: 1, total: 0 };
  const entityTypes: string[] = filterData?.data?.entityTypes ?? [];
  const actions: string[] = filterData?.data?.actions ?? [];

  const applySearch = () => { setSearch(q.trim()); setPage(1); };
  const resetFilters = () => { setEntityType(ALL); setAction(ALL); setQ(""); setSearch(""); setPage(1); };

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden bg-transparent">
      <div className="mb-8 relative z-10 stagger-enter">
        <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)] mb-2">
          Audit Trail
        </h2>
        <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide">
          Every payout, verification, override, refund and config change — with who did it.
        </p>
      </div>

      <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
        <CardHeader className="flex flex-col gap-3 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-xl text-white">
              {pagination.total} {pagination.total === 1 ? "entry" : "entries"}
            </CardTitle>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Select value={entityType} onValueChange={(v) => { setEntityType(v); setPage(1); }}>
                <SelectTrigger className="w-full sm:w-44 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white">
                  <SelectValue placeholder="All entities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All entities</SelectItem>
                  {entityTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
                <SelectTrigger className="w-full sm:w-52 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white">
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All actions</SelectItem>
                  {actions.map((a) => (
                    <SelectItem key={a} value={a}>{a.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-[hsl(215,20%,50%)]" />
                <Input
                  placeholder="Search id, amount, reason…"
                  className="pl-9 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[hsl(215,20%,40%)]"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applySearch()}
                />
              </div>

              <Button
                variant="outline"
                onClick={() => refetch()}
                disabled={isRefetching}
                className="border-[rgba(255,255,255,0.12)] text-[hsl(210,20%,85%)] hover:bg-[rgba(255,255,255,0.06)]"
              >
                <RefreshCw className={`w-4 h-4 ${isRefetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {(entityType !== ALL || action !== ALL || search) && (
            <button onClick={resetFilters} className="text-xs text-[hsl(217,91%,70%)] hover:underline self-start">
              Clear filters
            </button>
          )}
        </CardHeader>

        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-14 skeleton-shimmer rounded-xl" />)}
            </div>
          ) : isError ? (
            <div className="text-center py-10">
              <p className="text-[hsl(347,77%,65%)] font-medium">Could not load the audit trail.</p>
              <p className="text-xs text-[hsl(215,20%,55%)] mt-1">This is a loading failure, not an empty log.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3 border-[rgba(255,255,255,0.12)] text-[hsl(210,20%,85%)]">
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12">
              <ShieldAlert className="w-10 h-10 text-[hsl(215,20%,35%)] mx-auto mb-3" />
              <p className="text-[hsl(210,20%,80%)] font-medium">
                {search || entityType !== ALL || action !== ALL ? "No entries match these filters" : "No audit entries yet"}
              </p>
              <p className="text-sm text-[hsl(215,20%,55%)] mt-1">
                Admin actions such as payouts, verifications and overrides will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full glass-table">
                <thead>
                  <tr className="text-left border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">When</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Action</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Entity</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Change</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">By</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {rows.map((r) => (
                    <>
                      <tr key={r.id} className={`border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.03)] transition-colors ${HIGH_IMPACT.test(r.action) ? "bg-[rgba(255,255,255,0.015)]" : ""}`}>
                        <td className="p-4 whitespace-nowrap text-[hsl(215,20%,70%)]">
                          {r.createdAt ? format(new Date(r.createdAt), "dd MMM yyyy, HH:mm") : "—"}
                        </td>
                        <td className="p-4">
                          <Badge variant="outline" className={`${actionTone(r.action)} border`}>
                            {r.action.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="p-4 text-[hsl(210,20%,85%)]">
                          <span className="capitalize">{r.entityType.replace(/_/g, " ")}</span>
                          <span className="text-[hsl(215,20%,55%)]"> #{r.entityId}</span>
                        </td>
                        <td className="p-4 text-[hsl(215,20%,70%)]">
                          {r.fromState || r.toState ? (
                            <span className="font-mono text-xs">
                              {r.fromState ?? "—"} <span className="text-[hsl(215,20%,45%)]">to</span> {r.toState ?? "—"}
                            </span>
                          ) : <span className="text-[hsl(215,20%,45%)]">—</span>}
                        </td>
                        <td className="p-4 text-[hsl(210,20%,85%)]">{r.actorName}</td>
                        <td className="p-4 text-right">
                          {r.metadata && Object.keys(r.metadata).length > 0 ? (
                            <button
                              onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                              className="text-xs text-[hsl(217,91%,70%)] hover:underline"
                            >
                              {expanded === r.id ? "Hide" : "View"}
                            </button>
                          ) : <span className="text-xs text-[hsl(215,20%,45%)]">—</span>}
                        </td>
                      </tr>
                      {expanded === r.id && r.metadata && (
                        <tr key={`${r.id}-meta`} className="border-b border-[rgba(255,255,255,0.04)]">
                          <td colSpan={6} className="p-4 bg-[rgba(0,0,0,0.25)]">
                            <pre className="text-xs text-[hsl(210,20%,80%)] font-mono whitespace-pre-wrap break-all">
                              {JSON.stringify(r.metadata, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-[rgba(255,255,255,0.06)]">
              <p className="text-xs text-[hsl(215,20%,55%)]">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="border-[rgba(255,255,255,0.12)] text-[hsl(210,20%,85%)] disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                </Button>
                <Button
                  variant="outline" size="sm"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="border-[rgba(255,255,255,0.12)] text-[hsl(210,20%,85%)] disabled:opacity-40"
                >
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
