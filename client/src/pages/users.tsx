import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, UserCheck, UserX, Phone, Mail, MapPin, Calendar, Share2, Trash2, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { TableEmptyState, TableErrorState } from "@/components/admin/table-states";
import { PurgeAccountDialog } from "@/components/admin/purge-account-dialog";
import { BulkPurgeDialog } from "@/components/admin/bulk-purge-dialog";
import { useAdminMe } from "@/lib/admin-auth";
import {
  useTableQuery, DataToolbar, DataPagination, SortableHeader,
  useRowSelection, BulkActionBar, SelectAllCheckbox, RowCheckbox,
  exportCsv, timestampedName,
} from "@/components/admin/table";

export default function UsersPage() {
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<any>(null);
  const [bulkPurgeOpen, setBulkPurgeOpen] = useState(false);
  const { isSuperAdmin } = useAdminMe();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useTableQuery("/api/admin/users", {
    defaultSort: "createdAt",
    initialFilters: { status: "all" },
  });
  const selection = useRowSelection<any>();

  const { data, isLoading, isError, refetch } = useQuery<any>({ queryKey: [query.key] });

  const users = data?.data ?? [];
  const pagination = data?.pagination;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [query.key] });
    selection.clear();
  };

  const updateUserStatusMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/users/${userId}/status`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [query.key] });
      toast({ title: "User status updated successfully" });
    },
    onError: (error: any) =>
      toast({ title: "Error updating status", description: error.message, variant: "destructive" }),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async (isActive: boolean) =>
      apiRequest("POST", "/api/admin/users/bulk-status", { ids: selection.ids, isActive }),
    onSuccess: (r: any) => {
      toast({ title: "Customers updated", description: r?.message });
      refresh();
    },
    onError: (error: any) =>
      toast({ title: "Bulk update failed", description: error.message, variant: "destructive" }),
  });

  const handleExport = () => {
    exportCsv(timestampedName("customers"), selection.rows, [
      { header: "ID", value: (u) => u.id },
      { header: "Name", value: (u) => u.username },
      { header: "Phone", value: (u) => u.phone },
      { header: "Email", value: (u) => u.email },
      { header: "Pincode", value: (u) => u.pinCode },
      { header: "Address", value: (u) => u.homeAddress },
      { header: "Verified", value: (u) => (u.isVerified ? "yes" : "no") },
      { header: "Active", value: (u) => (u.isActive ? "yes" : "no") },
      { header: "Joined", value: (u) => (u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "") },
    ]);
    toast({ title: `Exported ${selection.count} customer(s)` });
  };

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden">
      <div className="mb-8 relative z-10 stagger-enter">
        <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)] mb-2">Customer Management</h2>
        <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide">Manage all registered customers. Employees are managed in the Employees section.</p>
      </div>

      <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
        <CardHeader className="flex flex-col gap-4 pb-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
          <CardTitle className="text-xl text-white">
            All Customers{pagination?.total ? <span className="text-[hsl(215,20%,55%)] text-sm font-normal ml-2">({pagination.total})</span> : null}
          </CardTitle>
          <DataToolbar
            query={query}
            searchPlaceholder="Name, phone, email, pincode…"
            filters={[{
              key: "status",
              label: "All Status",
              options: [
                { value: "active", label: "Active" },
                { value: "deactivated", label: "Deactivated" },
                { value: "incomplete", label: "No address / pin code" },
              ],
            }]}
          />
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-4 p-6">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center space-x-4 border border-[rgba(255,255,255,0.06)] rounded-xl p-4 bg-[rgba(255,255,255,0.02)]">
                  <div className="w-12 h-12 skeleton-shimmer rounded-full shrink-0"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 skeleton-shimmer rounded w-3/4"></div>
                    <div className="h-3 skeleton-shimmer rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full glass-table">
                  <thead>
                    <tr className="text-left border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                      <th className="p-4 w-10">
                        <SelectAllCheckbox
                          state={selection.pageState(users)}
                          onToggle={() => selection.togglePage(users)}
                        />
                      </th>
                      <SortableHeader query={query} field="username">User</SortableHeader>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Type</th>
                      <SortableHeader query={query} field="phone">Contact</SortableHeader>
                      <SortableHeader query={query} field="isActive">Status</SortableHeader>
                      <SortableHeader query={query} field="createdAt">Joined</SortableHeader>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {isError && <TableErrorState colSpan={7} onRetry={() => refetch()} message="Could not load customers." />}
                    {!isError && users.length === 0 && (
                      <TableEmptyState
                        colSpan={7}
                        icon="person_search"
                        title={query.activeFilterCount > 0 ? "No matching customers" : "No customers yet"}
                        description={
                          query.activeFilterCount > 0
                            ? "Try a different search term, or reset the filters."
                            : "Customers will appear here once they sign up in the mobile app."
                        }
                      />
                    )}
                    {!isError && users.map((user: any) => (
                      <tr key={user.id} className={`border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)] group ${selection.isSelected(user.id) ? "bg-[hsla(217,91%,60%,0.06)]" : ""}`}>
                        <td className="p-4">
                          <RowCheckbox checked={selection.isSelected(user.id)} onToggle={() => selection.toggle(user)} />
                        </td>
                        <td className="p-4">
                          <div className="flex items-center space-x-4">
                            {user.profilePicture ? (
                              <img src={user.profilePicture} alt={user.username} className="w-10 h-10 rounded-full object-cover shadow-[0_2px_8px_rgba(0,0,0,0.3)]" />
                            ) : (
                              <div className="w-10 h-10 bg-gradient-to-br from-[hsl(217,91%,60%)] to-[hsl(263,70%,50%)] rounded-full flex items-center justify-center font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                                {user.username?.charAt(0).toUpperCase() || "U"}
                              </div>
                            )}
                            <div>
                              <p className="font-medium text-[hsl(210,20%,90%)]">{user.username}</p>
                              <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">{user.email || "No email"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <Badge variant="outline" className="text-[hsl(215,20%,70%)] border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)]">
                            Customer
                          </Badge>
                        </td>
                        <td className="p-4">
                          <p className="font-medium text-[hsl(210,20%,85%)]">{user.phone}</p>
                          <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">{user.pinCode}</p>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col gap-1.5">
                            <Badge variant={user.isVerified ? 'default' : 'secondary'} className={`w-fit ${user.isVerified ? 'bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)]' : 'bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,65%)] border-[hsla(38,92%,50%,0.3)]'}`}>
                              {user.isVerified ? 'Verified' : 'Unverified'}
                            </Badge>
                            {!user.isActive && (
                              <Badge variant="outline" className="w-fit bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border border-[hsla(347,77%,50%,0.3)]">Inactive</Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-4">
                          <p className="text-[hsl(215,20%,65%)]">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "N/A"}</p>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-[hsl(215,20%,65%)] hover:text-[hsl(217,91%,65%)] hover:bg-[rgba(255,255,255,0.05)]" onClick={() => { setSelectedUser(user); setIsDetailModalOpen(true); }}>
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className={`h-8 w-8 transition-colors ${user.isActive ? "text-[hsl(347,77%,60%)] hover:bg-[hsla(347,77%,50%,0.1)]" : "text-[hsl(160,84%,60%)] hover:bg-[hsla(160,84%,39%,0.1)]"}`}
                              onClick={() => updateUserStatusMutation.mutate({ userId: user.id, isActive: !user.isActive })}
                              disabled={updateUserStatusMutation.isPending}
                            >
                              {user.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                            </Button>
                            {/* Super admin only; the endpoint enforces it too. */}
                            {isSuperAdmin && (
                              <Button size="icon" variant="ghost" title="Delete permanently (with all connected services)" className="h-8 w-8 text-[hsl(215,20%,65%)] hover:text-[hsl(347,77%,65%)] hover:bg-[hsla(347,77%,50%,0.1)]" onClick={() => setPurgeTarget(user)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <DataPagination query={query} pagination={pagination} rowCount={users.length} />
            </>
          )}
        </CardContent>
      </Card>

      <BulkActionBar
        count={selection.count}
        onClear={selection.clear}
        noun="customer"
        actions={[
          { label: "Export CSV", icon: <Download className="w-3.5 h-3.5" />, onClick: handleExport },
          { label: "Activate", icon: <UserCheck className="w-3.5 h-3.5" />, onClick: () => bulkStatusMutation.mutate(true), disabled: bulkStatusMutation.isPending },
          { label: "Deactivate", icon: <UserX className="w-3.5 h-3.5" />, onClick: () => bulkStatusMutation.mutate(false), disabled: bulkStatusMutation.isPending },
          { label: "Delete", icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => setBulkPurgeOpen(true), destructive: true, visible: isSuperAdmin },
        ]}
      />

      <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
        <DialogContent className="max-w-md glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.8)] shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-y-auto max-h-[85vh] custom-scrollbar">
          <DialogHeader>
            <DialogTitle className="text-xl text-white">User Details</DialogTitle>
            <DialogDescription className="text-[hsl(215,20%,55%)]">Full profile information for <span className="text-white font-medium">{selectedUser?.username}</span></DialogDescription>
          </DialogHeader>

          {selectedUser && (
            <div className="space-y-6">
              <div className="flex items-center space-x-4 p-4 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl shadow-inner">
                {selectedUser.profilePicture ? (
                  <img src={selectedUser.profilePicture} alt={selectedUser.username} className="w-16 h-16 rounded-full object-cover shadow-[0_2px_10px_rgba(0,0,0,0.3)]" />
                ) : (
                  <div className="w-16 h-16 bg-gradient-to-br from-[hsl(217,91%,60%)] to-[hsl(263,70%,50%)] text-white rounded-full flex items-center justify-center text-2xl font-bold shadow-[0_2px_10px_rgba(0,0,0,0.3)]">
                    {selectedUser.username?.charAt(0).toUpperCase() || "U"}
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-white tracking-tight truncate">{selectedUser.username || "Unnamed user"}</h3>
                  <Badge variant="outline" className="text-[10px] mt-1 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,75%)]">{(selectedUser.role || "user").toUpperCase()}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 p-1">
                {[
                  { icon: <Phone className="w-4 h-4 text-[hsl(215,20%,65%)]" />, content: selectedUser.phone },
                  { icon: <Mail className="w-4 h-4 text-[hsl(215,20%,65%)]" />, content: selectedUser.email || "N/A" },
                  { icon: <MapPin className="w-4 h-4 text-[hsl(215,20%,65%)]" />, content: `${selectedUser.homeAddress || "No address provided"} (${selectedUser.pinCode || "No Pin"})` },
                  { icon: <Calendar className="w-4 h-4 text-[hsl(215,20%,65%)]" />, content: `Joined: ${selectedUser.createdAt ? new Date(selectedUser.createdAt).toLocaleDateString() : "N/A"}` },
                ].map((row, i) => (
                  <div key={i} className="flex items-center space-x-3 text-sm text-[hsl(210,20%,85%)]">
                    <div className="w-8 h-8 rounded-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center shrink-0">{row.icon}</div>
                    <span>{row.content}</span>
                  </div>
                ))}
                <div className="flex items-center space-x-3 text-sm text-[hsl(210,20%,85%)]">
                  <div className="w-8 h-8 rounded-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center shrink-0">
                    <Share2 className="w-4 h-4 text-[hsl(215,20%,65%)]" />
                  </div>
                  <span>Referral Code: <span className="font-mono font-bold text-[hsl(160,84%,60%)] ml-1">{selectedUser.referralCode || "NONE"}</span></span>
                </div>
              </div>

              <div className="pt-5 border-t border-[rgba(255,255,255,0.06)] flex gap-3">
                <Button
                  className={`flex-1 transition-all active:scale-[0.97] ${selectedUser.isActive ? "bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border border-[hsla(347,77%,50%,0.3)] hover:bg-[hsla(347,77%,50%,0.25)]" : "bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border border-[hsla(160,84%,39%,0.3)] hover:bg-[hsla(160,84%,39%,0.25)]"}`}
                  variant={selectedUser.isActive ? "destructive" : "default"}
                  onClick={() => {
                    updateUserStatusMutation.mutate({ userId: selectedUser.id, isActive: !selectedUser.isActive });
                    setIsDetailModalOpen(false);
                  }}
                >
                  {selectedUser.isActive ? "Deactivate Account" : "Activate Account"}
                </Button>
                <Button className="flex-1 border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.05)] text-[hsl(210,20%,85%)] transition-all active:scale-[0.97]" variant="outline" onClick={() => setIsDetailModalOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {purgeTarget && (
        <PurgeAccountDialog
          kind="user"
          id={purgeTarget.id}
          name={purgeTarget.username || `User #${purgeTarget.id}`}
          open={!!purgeTarget}
          onOpenChange={(o) => !o && setPurgeTarget(null)}
          invalidateKeys={[query.key, "/api/admin/stats"]}
        />
      )}

      <BulkPurgeDialog
        kind="user"
        ids={selection.ids}
        noun="customer"
        open={bulkPurgeOpen}
        onOpenChange={setBulkPurgeOpen}
        onDeleted={refresh}
      />
    </div>
  );
}
