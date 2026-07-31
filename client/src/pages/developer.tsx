import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Database, Table2, Play, KeyRound, Search, AlertTriangle, Loader2 } from "lucide-react";

interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
}
interface TableInfo {
  name: string;
  rowEstimate: number | null;
  columns: Column[];
}
interface QueryResult {
  rows: any[];
  fields: string[];
  rowCount: number;
  command?: string;
  readOnly: boolean;
  durationMs: number;
}

export default function DeveloperPage() {
  const { toast } = useToast();

  // ── Schema tab ───────────────────────────────────────────────────────────
  const [tableSearch, setTableSearch] = useState("");
  const [openTable, setOpenTable] = useState<string | null>(null);

  const { data: schema, isLoading: schemaLoading, isError: schemaError, error: schemaErrObj } = useQuery<{ tables: TableInfo[] }>({
    queryKey: ["/api/admin/db/schema"],
    // The endpoint wraps its payload as { success, data: { tables } }.
    select: (raw: any) => raw?.data ?? { tables: [] },
  });

  const tables = schema?.tables ?? [];
  const filteredTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter(
      (t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [tables, tableSearch]);

  // ── Query tab ────────────────────────────────────────────────────────────
  const [sqlText, setSqlText] = useState("SELECT * FROM users ORDER BY id DESC LIMIT 20;");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmOp, setConfirmOp] = useState<string | null>(null);

  const runQuery = async (confirm = false) => {
    if (!sqlText.trim()) return;
    setRunning(true);
    setQueryError(null);
    try {
      // Direct fetch (not apiRequest) so the 428 "needs confirmation" body is
      // readable — apiRequest turns any non-2xx into a plain thrown Error.
      const adminToken = localStorage.getItem("adminToken");
      const res = await fetch("/api/admin/db/query", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({ sql: sqlText, confirm }),
      });
      const body = await res.json().catch(() => ({} as any));

      if (res.status === 428 || body?.requiresConfirmation) {
        setConfirmOp(body?.operation || "WRITE");
        return;
      }
      if (!res.ok || !body?.success) {
        setQueryError(body?.message || `Request failed (${res.status})`);
        setResult(null);
        return;
      }

      setResult(body.data as QueryResult);
      toast({
        title: body.data.readOnly ? "Query complete" : "Statement executed",
        description: `${body.data.rowCount} row(s) · ${body.data.durationMs}ms`,
      });
    } catch (err: any) {
      setQueryError(err?.message || "Query failed");
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Database className="w-6 h-6" /> Database Console
        </h2>
        <p className="text-[hsl(215,20%,65%)] mt-1">
          Direct access to the production database. Handle with care — writes take effect immediately.
        </p>
      </div>

      <Tabs defaultValue="schema" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="schema"><Table2 className="w-4 h-4 mr-2" /> Schema</TabsTrigger>
          <TabsTrigger value="query"><Play className="w-4 h-4 mr-2" /> Query</TabsTrigger>
        </TabsList>

        {/* ── SCHEMA ─────────────────────────────────────────────── */}
        <TabsContent value="schema" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Tables &amp; Columns</CardTitle>
              <CardDescription>Every table in the public schema. Click a table to see its columns.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(215,20%,55%)]" />
                <Input
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Search tables or columns…"
                  className="pl-9"
                />
              </div>

              {schemaLoading && (
                <div className="flex items-center gap-2 text-[hsl(215,20%,65%)] py-8 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading schema…
                </div>
              )}
              {schemaError && (
                <div className="text-[hsl(347,77%,65%)] py-6 text-sm">
                  {(schemaErrObj as any)?.body?.message || "Could not load schema. Super_admin access is required."}
                </div>
              )}

              {!schemaLoading && !schemaError && (
                <div className="space-y-2">
                  <p className="text-xs text-[hsl(215,20%,55%)]">{filteredTables.length} of {tables.length} tables</p>
                  {filteredTables.map((t) => {
                    const isOpen = openTable === t.name;
                    return (
                      <div key={t.name} className="border border-[rgba(255,255,255,0.08)] rounded-lg overflow-hidden">
                        <button
                          onClick={() => setOpenTable(isOpen ? null : t.name)}
                          className="w-full flex items-center justify-between p-3 hover:bg-[rgba(255,255,255,0.03)] transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <Table2 className="w-4 h-4 text-[hsl(217,91%,65%)]" />
                            <span className="font-mono text-sm text-white">{t.name}</span>
                            <Badge variant="outline" className="text-[10px]">{t.columns.length} cols</Badge>
                          </div>
                          <span className="text-xs text-[hsl(215,20%,55%)]">
                            {t.rowEstimate != null ? `~${t.rowEstimate.toLocaleString()} rows` : ""}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="overflow-x-auto border-t border-[rgba(255,255,255,0.06)]">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-[hsl(215,20%,55%)] text-xs uppercase tracking-wider bg-[rgba(255,255,255,0.02)]">
                                  <th className="p-2 pl-4">Column</th>
                                  <th className="p-2">Type</th>
                                  <th className="p-2">Nullable</th>
                                  <th className="p-2">Default</th>
                                </tr>
                              </thead>
                              <tbody>
                                {t.columns.map((c) => (
                                  <tr key={c.name} className="border-t border-[rgba(255,255,255,0.04)]">
                                    <td className="p-2 pl-4 font-mono text-white flex items-center gap-1.5">
                                      {c.isPrimaryKey && <KeyRound className="w-3 h-3 text-[hsl(38,92%,60%)]" />}
                                      {c.name}
                                    </td>
                                    <td className="p-2 font-mono text-[hsl(160,84%,60%)] text-xs">{c.type}</td>
                                    <td className="p-2 text-xs text-[hsl(215,20%,65%)]">{c.nullable ? "YES" : "NO"}</td>
                                    <td className="p-2 font-mono text-xs text-[hsl(215,20%,55%)] max-w-[220px] truncate">{c.default || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── QUERY ──────────────────────────────────────────────── */}
        <TabsContent value="query" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>SQL Query</CardTitle>
              <CardDescription>
                Reads run immediately. Writes (INSERT/UPDATE/DELETE/DDL) ask for confirmation before executing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={sqlText}
                onChange={(e) => setSqlText(e.target.value)}
                rows={8}
                spellCheck={false}
                className="font-mono text-sm"
                placeholder="SELECT * FROM users LIMIT 20;"
              />
              <div className="flex items-center gap-3">
                <Button onClick={() => runQuery(false)} disabled={running || !sqlText.trim()}>
                  {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                  Run
                </Button>
                {result && (
                  <span className="text-xs text-[hsl(215,20%,60%)]">
                    {result.command || (result.readOnly ? "SELECT" : "OK")} · {result.rowCount} row(s) · {result.durationMs}ms
                  </span>
                )}
              </div>

              {queryError && (
                <div className="flex items-start gap-2 bg-[hsla(347,77%,50%,0.1)] border border-[hsla(347,77%,50%,0.3)] rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 text-[hsl(347,77%,65%)] mt-0.5 shrink-0" />
                  <pre className="text-xs text-[hsl(347,77%,75%)] whitespace-pre-wrap font-mono">{queryError}</pre>
                </div>
              )}

              {result && result.rows.length > 0 && (
                <div className="overflow-x-auto border border-[rgba(255,255,255,0.08)] rounded-lg max-h-[520px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0">
                      <tr className="text-left text-[hsl(215,20%,60%)] text-xs uppercase tracking-wider bg-[hsl(222,20%,12%)]">
                        {result.fields.map((f) => <th key={f} className="p-2 px-3 whitespace-nowrap">{f}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i} className="border-t border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.02)]">
                          {result.fields.map((f) => (
                            <td key={f} className="p-2 px-3 font-mono text-xs text-[hsl(210,20%,85%)] max-w-[320px] truncate">
                              {formatCell(row[f])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result && result.rows.length === 0 && !queryError && (
                <p className="text-sm text-[hsl(215,20%,60%)]">
                  {result.readOnly ? "No rows returned." : `Done. ${result.rowCount} row(s) affected.`}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Write confirmation */}
      <AlertDialog open={!!confirmOp} onOpenChange={(o) => !o && setConfirmOp(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-[hsl(38,92%,60%)]" />
              Run a {confirmOp} on production?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This statement will modify the live database and cannot be undone. Review your SQL before continuing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <pre className="bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] rounded p-3 text-xs font-mono text-[hsl(210,20%,85%)] max-h-40 overflow-auto whitespace-pre-wrap">
            {sqlText}
          </pre>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)]"
              onClick={() => { setConfirmOp(null); runQuery(true); }}
            >
              Yes, run it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatCell(value: any): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
