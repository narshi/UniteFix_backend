/**
 * Technician Types — the trade list service experts tick during signup.
 *
 * Separate from the Service Catalog on purpose: the catalog is what customers
 * buy, this is how technicians describe themselves. Editing one should not
 * disturb the other.
 *
 * Experts can add a trade they can't find during signup; those arrive flagged
 * "Suggested" so they can be renamed, adopted or removed here rather than the
 * list quietly filling with near-duplicates.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  useTableQuery, DataToolbar, DataPagination, SortableHeader,
} from "@/components/admin/table";
import { Plus, Pencil, Trash2, Eye, EyeOff, Sparkles } from "lucide-react";
import { format } from "date-fns";

interface TechnicianType {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  source: "admin" | "expert";
  suggestedBy: number | null;
  createdAt: string;
}

const emptyForm = { name: "", description: "", sortOrder: "0" };

export default function TechnicianTypesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useTableQuery("/api/admin/technician-types", {
    defaultSort: "sortOrder",
    defaultOrder: "asc",
    initialFilters: { status: "all", source: "all" },
  });

  const [editing, setEditing] = useState<TechnicianType | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<TechnicianType | null>(null);

  const { data, isLoading } = useQuery<any>({ queryKey: [query.key] });
  const rows: TechnicianType[] = data?.data ?? [];
  const pagination = data?.pagination;

  const refresh = () => queryClient.invalidateQueries({ queryKey: [query.key] });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setIsFormOpen(true);
  };

  const openEdit = (row: TechnicianType) => {
    setEditing(row);
    setForm({
      name: row.name,
      description: row.description ?? "",
      sortOrder: String(row.sortOrder),
    });
    setIsFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        sortOrder: Number(form.sortOrder) || 0,
      };
      return editing
        ? apiRequest("PATCH", `/api/admin/technician-types/${editing.id}`, body)
        : apiRequest("POST", "/api/admin/technician-types", body);
    },
    onSuccess: (r: any) => {
      toast({ title: editing ? "Updated" : "Added", description: r?.message });
      setIsFormOpen(false);
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: async (row: TechnicianType) =>
      apiRequest("PATCH", `/api/admin/technician-types/${row.id}`, { isActive: !row.isActive }),
    onSuccess: () => { toast({ title: "Visibility updated" }); refresh(); },
    onError: (e: any) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (row: TechnicianType) =>
      apiRequest("DELETE", `/api/admin/technician-types/${row.id}`),
    onSuccess: (r: any) => {
      toast({ title: "Removed", description: r?.message });
      setDeleteTarget(null);
      refresh();
    },
    onError: (e: any) => {
      toast({ title: "Could not remove", description: e.message, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  const suggestedCount = rows.filter((r) => r.source === "expert").length;

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden bg-transparent">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-8 relative z-10 stagger-enter">
        <div>
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]">
            Service Expert Types
          </h1>
          <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide mt-1">
            The trades a service expert picks during signup. At least one is required to finish signup.
          </p>
        </div>
        <Button onClick={openCreate} className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white">
          <Plus className="w-4 h-4 mr-2" />
          Add type
        </Button>
      </div>

      {suggestedCount > 0 && (
        <div className="glass-card border border-[hsla(38,92%,50%,0.25)] bg-[hsla(38,92%,50%,0.06)] rounded-xl p-4 mb-6 relative z-10 flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-[hsl(38,92%,65%)] mt-0.5 shrink-0" />
          <p className="text-sm text-[hsl(210,20%,80%)]">
            <span className="font-semibold text-white">{suggestedCount}</span> type
            {suggestedCount === 1 ? " was" : "s were"} added by service experts during signup.
            Rename to adopt, or remove if it duplicates an existing trade.
          </p>
        </div>
      )}

      <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
        <CardHeader className="flex flex-col gap-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
          <CardTitle className="text-xl text-white">
            All types{pagination?.total ? <span className="text-[hsl(215,20%,55%)] text-sm font-normal ml-2">({pagination.total})</span> : null}
          </CardTitle>
          <DataToolbar
            query={query}
            searchPlaceholder="Trade name or description…"
            showDateRange={false}
            filters={[
              {
                key: "status",
                label: "All Status",
                options: [
                  { value: "active", label: "Visible" },
                  { value: "inactive", label: "Hidden" },
                ],
              },
              {
                key: "source",
                label: "All Sources",
                options: [
                  { value: "admin", label: "Curated" },
                  { value: "expert", label: "Suggested by expert" },
                ],
              },
            ]}
          />
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-[hsl(215,20%,65%)]">Loading…</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full glass-table text-sm">
                  <thead>
                    <tr className="text-left border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                      <SortableHeader query={query} field="sortOrder">Order</SortableHeader>
                      <SortableHeader query={query} field="name">Trade</SortableHeader>
                      <SortableHeader query={query} field="source">Source</SortableHeader>
                      <SortableHeader query={query} field="isActive">Shown in signup</SortableHeader>
                      <SortableHeader query={query} field="createdAt">Added</SortableHeader>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-[hsl(215,20%,55%)]">
                          {query.activeFilterCount > 0 ? "No types match these filters" : "No service expert types yet."}
                        </td>
                      </tr>
                    )}
                    {rows.map((row) => (
                      <tr key={row.id} className={`border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.03)] transition-colors ${!row.isActive ? "opacity-55" : ""}`}>
                        <td className="p-4 font-mono text-[hsl(215,20%,60%)]">{row.sortOrder}</td>
                        <td className="p-4">
                          <p className="font-medium text-[hsl(210,20%,90%)]">{row.name}</p>
                          {row.description && (
                            <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">{row.description}</p>
                          )}
                        </td>
                        <td className="p-4">
                          <Badge
                            variant="outline"
                            className={row.source === "expert"
                              ? "bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,68%)] border-[hsla(38,92%,50%,0.3)]"
                              : "bg-[rgba(255,255,255,0.03)] text-[hsl(215,20%,75%)] border-[rgba(255,255,255,0.1)]"}
                          >
                            {row.source === "expert" ? "Suggested" : "Curated"}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <Badge
                            variant="outline"
                            className={row.isActive
                              ? "bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)]"
                              : "bg-[rgba(255,255,255,0.04)] text-[hsl(215,20%,60%)] border-[rgba(255,255,255,0.1)]"}
                          >
                            {row.isActive ? "Visible" : "Hidden"}
                          </Badge>
                        </td>
                        <td className="p-4 text-[hsl(215,20%,65%)]">
                          {row.createdAt ? format(new Date(row.createdAt), "dd MMM yyyy") : "—"}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="icon" variant="ghost"
                              title={row.isActive ? "Hide from signup" : "Show in signup"}
                              className="h-8 w-8 text-[hsl(215,20%,65%)] hover:text-white hover:bg-[rgba(255,255,255,0.05)]"
                              onClick={() => toggleActive.mutate(row)}
                              disabled={toggleActive.isPending}
                            >
                              {row.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                            </Button>
                            <Button
                              size="icon" variant="ghost" title="Edit"
                              className="h-8 w-8 text-[hsl(215,20%,65%)] hover:text-[hsl(217,91%,65%)] hover:bg-[rgba(255,255,255,0.05)]"
                              onClick={() => openEdit(row)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon" variant="ghost" title="Remove"
                              className="h-8 w-8 text-[hsl(215,20%,65%)] hover:text-[hsl(347,77%,65%)] hover:bg-[hsla(347,77%,50%,0.1)]"
                              onClick={() => setDeleteTarget(row)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <DataPagination query={query} pagination={pagination} rowCount={rows.length} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Create / edit */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-md glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.9)]">
          <DialogHeader>
            <DialogTitle className="text-xl text-white">
              {editing ? `Edit "${editing.name}"` : "New service expert type"}
            </DialogTitle>
            <DialogDescription className="text-[hsl(215,20%,60%)]">
              {editing?.source === "expert"
                ? "This was suggested by a service expert. Saving adopts it as a curated type."
                : "This appears as a tickable option during service expert signup."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[hsl(210,20%,80%)]">Trade name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Electrician"
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[hsl(210,20%,80%)]">
                Description <span className="text-[hsl(215,20%,55%)]">(optional)</span>
              </Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Wiring, switchboards, inverters"
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[hsl(210,20%,80%)]">Sort order</Label>
              <Input
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                inputMode="numeric"
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
              />
              <p className="text-xs text-[hsl(215,20%,55%)]">Lower numbers appear first in the signup list.</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1 border-[rgba(255,255,255,0.1)] text-[hsl(210,20%,85%)]" onClick={() => setIsFormOpen(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white"
              disabled={form.name.trim().length < 2 || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : editing ? "Save" : "Add"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.9)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Remove "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription className="text-[hsl(215,20%,65%)]">
              It disappears from the signup list. Experts who already picked it keep it on their
              profile — the trade is stored by name, so nothing they have is lost.
              <br /><br />
              If you only want it out of signup, hiding it is reversible; removing is not.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="border-t border-[rgba(255,255,255,0.08)] pt-4 mt-4">
            <AlertDialogCancel className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.1)]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)] text-white"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
