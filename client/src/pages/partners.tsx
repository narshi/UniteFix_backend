import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Clock, Ban, ShieldCheck, Trash2, Wallet, Plus, Minus, History } from "lucide-react";
import { PurgeAccountDialog } from "@/components/admin/purge-account-dialog";
import { BulkPurgeDialog } from "@/components/admin/bulk-purge-dialog";
import { useAdminMe } from "@/lib/admin-auth";
import {
  useTableQuery, DataToolbar, DataPagination, SortableHeader,
  useRowSelection, BulkActionBar, SelectAllCheckbox, RowCheckbox,
  exportCsv, timestampedName,
} from "@/components/admin/table";
import { Download } from "lucide-react";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { TableEmptyState, TableErrorState } from "@/components/admin/table-states";

/** Empty state for the Add/Edit employee form. */
const blankPartner = {
  partnerName: '',
  email: '',
  phone: '',
  password: '',
  partnerType: 'Individual',
  services: [] as string[],
  location: '',   // pin code — the dashboard's historical name for it
  businessName: '',
  address: '',
};

export default function PartnersPage() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isTopupModalOpen, setIsTopupModalOpen] = useState(false);
  const [isDeductModalOpen, setIsDeductModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<any>(null);
  const [purgeTarget, setPurgeTarget] = useState<any>(null);
  const { isSuperAdmin } = useAdminMe();
  const [topupAmount, setTopupAmount] = useState("");
  const [deductAmount, setDeductAmount] = useState("");
  const [deductReason, setDeductReason] = useState("");
  const [bulkPurgeOpen, setBulkPurgeOpen] = useState(false);
  const query = useTableQuery("/api/admin/servicemen/list", {
    defaultSort: "createdAt",
    initialFilters: { status: "all" },
  });
  const selection = useRowSelection<any>();
  const [newPartner, setNewPartner] = useState({ ...blankPartner });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: partnersResponse, isLoading, isError, refetch } = useQuery<any>({
    queryKey: [query.key],
  });

  // Searching, filtering, sorting and paging all happen server-side now — the
  // page renders exactly the rows it was given.
  const filteredPartners = partnersResponse?.data || [];
  const pagination = partnersResponse?.pagination;

  /**
   * The list's React Query key is the full URL (`/api/admin/servicemen/list?page=1&…`),
   * so invalidating on the bare path matched nothing — keys are compared
   * element-wise, and a partial string is not a prefix of an array element.
   * Every mutation below routes through this instead.
   */
  const invalidateList = () =>
    queryClient.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0] as string).startsWith("/api/admin/servicemen/list"),
    });

  const refreshList = () => {
    invalidateList();
    selection.clear();
  };

  const bulkStatusMutation = useMutation({
    mutationFn: async (isActive: boolean) =>
      apiRequest("POST", "/api/admin/servicemen/bulk-status", { ids: selection.ids, isActive }),
    onSuccess: (r: any) => {
      toast({ title: "Employees updated", description: r?.message });
      refreshList();
    },
    onError: (e: any) => toast({ title: "Bulk update failed", description: e.message, variant: "destructive" }),
  });

  const handleExport = () => {
    exportCsv(timestampedName("employees"), selection.rows, [
      { header: "ID", value: (p: any) => p.id },
      { header: "Partner ID", value: (p: any) => p.partnerId },
      { header: "Name", value: (p: any) => p.partnerName },
      { header: "Phone", value: (p: any) => p.phone },
      { header: "Email", value: (p: any) => p.email },
      { header: "Pin code", value: (p: any) => p.pinCode ?? "" },
      { header: "Address", value: (p: any) => p.address ?? "" },
      { header: "Verification", value: (p: any) => p.documentVerificationStatus },
      { header: "Active", value: (p: any) => (p.isActive ? "yes" : "no") },
      { header: "Wallet", value: (p: any) => p.walletBalance },
      { header: "Jobs completed", value: (p: any) => p.totalServicesCompleted ?? 0 },
      { header: "Rating", value: (p: any) => p.averageRating ?? "" },
      { header: "Services", value: (p: any) => (p.services || []).join(" | ") },
    ]);
    toast({ title: `Exported ${selection.count} employee(s)` });
  };

  const addPartnerMutation = useMutation({
    mutationFn: async (partnerData: any) => {
      if (selectedPartner) {
        return await apiRequest("PATCH", `/api/admin/servicemen/${selectedPartner.id}`, partnerData);
      }
      return await apiRequest("POST", "/api/admin/servicemen/create", partnerData);
    },
    onSuccess: () => {
      const wasEdit = !!selectedPartner;
      invalidateList();
      setIsAddModalOpen(false);
      setSelectedPartner(null);
      setNewPartner({ ...blankPartner });
      toast({ title: wasEdit ? "Employee updated" : "Employee added successfully" });
    },
    onError: (error: any) => {
      toast({
        title: selectedPartner ? "Error updating employee" : "Error adding employee",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ partnerId, action, reason }: { partnerId: number; action: string; reason?: string }) => {
      return await apiRequest("POST", `/api/admin/servicemen/${partnerId}/${action}`, { reason });
    },
    onSuccess: (_, variables) => {
      invalidateList();
      toast({ title: `Employee ${variables.action} successful` });
    },
    onError: (error: any) => {
      toast({ title: "Action failed", description: error.message, variant: "destructive" });
    }
  });



  const { data: transactions = [] } = useQuery({
    queryKey: ["/api/admin/servicemen", selectedPartner?.id, "transactions"],
    queryFn: async () => {
      if (!selectedPartner?.id) return [];
      const res = await apiRequest("GET", `/api/admin/servicemen/${selectedPartner.id}/transactions`);
      return res.data;
    },
    enabled: !!selectedPartner?.id && isHistoryModalOpen,
  });

  const topupMutation = useMutation({
    mutationFn: async ({ partnerId, amount }: { partnerId: number; amount: number }) => {
      return await apiRequest("POST", `/api/admin/servicemen/${partnerId}/topup`, { amount, description: "Admin manual topup" });
    },
    onSuccess: () => {
      invalidateList();
      setIsTopupModalOpen(false);
      setTopupAmount("");
      toast({ title: "Wallet topup successful" });
    },
    onError: (error: any) => {
      toast({ title: "Topup failed", description: error.message, variant: "destructive" });
    }
  });

  const deductMutation = useMutation({
    mutationFn: async ({ partnerId, amount, reason }: { partnerId: number; amount: number; reason: string }) => {
      return await apiRequest("POST", `/api/admin/servicemen/${partnerId}/deduct`, { amount, description: reason });
    },
    onSuccess: () => {
      invalidateList();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/servicemen", selectedPartner?.id, "transactions"] });
      setIsDeductModalOpen(false);
      setDeductAmount("");
      setDeductReason("");
      toast({ title: "Wallet deduction successful" });
    },
    onError: (error: any) => {
      toast({ title: "Deduction failed", description: error.message, variant: "destructive" });
    }
  });

  const deletePartnerMutation = useMutation({
    mutationFn: async (partnerId: number) => {
      return await apiRequest("DELETE", `/api/admin/servicemen/${partnerId}`);
    },
    onSuccess: () => {
      invalidateList();
      toast({ title: "Employee deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    }
  });

  const handleAddPartner = () => {
    if (!newPartner.partnerName || !newPartner.email || !newPartner.phone || !newPartner.location) {
      toast({ title: "Missing fields", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    // `location` is the pin code field; the server rejects anything else, so
    // catch it here rather than round-tripping for a 400.
    if (!/^\d{6}$/.test(newPartner.location.trim())) {
      toast({ title: "Invalid pin code", description: "Pin code must be exactly 6 digits", variant: "destructive" });
      return;
    }
    addPartnerMutation.mutate(newPartner);
  };

  /**
   * TECHNICIAN TYPES, not service categories.
   *
   * Whatever is ticked here is written verbatim into employees.services, and
   * syncEmployeeTechnicianTypes then matches those strings BY NAME against the
   * technician_types table to populate employee_technician_types — which is what
   * assignment matching actually joins on.
   *
   * This list used to come from /api/services/categories, so an admin ticking
   * "Technology Services" wrote a string matching no trade. The expert ended up
   * with zero trade ids and was never flagged as qualified for anything, with
   * nothing on screen suggesting a problem. The hardcoded fallback beneath it
   * ("AC Repair", "Laptop Repair"…) named trades that exist nowhere either, so
   * a failed request silently produced the same result.
   *
   * Same source the expert app uses when they pick their own trades, so both
   * sides of the record speak one vocabulary.
   */
  const { data: tradesData, isLoading: tradesLoading, isError: tradesError } = useQuery({
    queryKey: ["/api/technician-types"],
  });
  const availableServices: string[] = ((tradesData as any)?.data ?? []).map((t: any) => t.name);

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden">
      <div className="mb-8 flex justify-between items-center relative z-10 stagger-enter">
        <div>
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)] mb-2">Employees</h2>
          <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide">Manage employees, verification, and wallets</p>
        </div>
        {/* One shared DialogContent serves both Add and Edit; `selectedPartner`
            is what tells them apart. Closing must clear it, otherwise the next
            "Add Employee" click silently PATCHes the last employee edited
            instead of creating a new one. */}
        <Dialog
          open={isAddModalOpen}
          onOpenChange={(open) => {
            setIsAddModalOpen(open);
            if (!open) setSelectedPartner(null);
          }}
        >
          <DialogTrigger asChild>
            <Button
              onClick={() => { setSelectedPartner(null); setNewPartner(blankPartner); }}
              className="flex items-center gap-2 bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_14px_hsla(217,91%,60%,0.3)] hover:shadow-[0_6px_20px_hsla(217,91%,60%,0.4)] transition-all active:scale-[0.97]"
            >
              <Plus className="w-4 h-4" /> Add Employee
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.8)] shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-y-auto max-h-[85vh] custom-scrollbar">
            <DialogHeader>
              <DialogTitle className="text-xl text-white">
                {selectedPartner ? `Edit ${selectedPartner.partnerName || 'Employee'}` : 'Register New Employee'}
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label className="text-[hsl(210,20%,85%)]">Employee Name *</Label>
                <Input className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)]" value={newPartner.partnerName} onChange={e => setNewPartner({ ...newPartner, partnerName: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label className="text-[hsl(210,20%,85%)]">Employee Type</Label>
                <Select value={newPartner.partnerType} onValueChange={v => setNewPartner({ ...newPartner, partnerType: v })}>
                  <SelectTrigger className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:ring-[hsla(217,91%,60%,0.3)]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Individual">Individual</SelectItem>
                    <SelectItem value="Business">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[hsl(210,20%,85%)]">Phone Number *</Label>
                <Input className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)]" value={newPartner.phone} onChange={e => setNewPartner({ ...newPartner, phone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label className="text-[hsl(210,20%,85%)]">Email *</Label>
                <Input className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)]" type="email" value={newPartner.email} onChange={e => setNewPartner({ ...newPartner, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label className="text-[hsl(210,20%,85%)]">Pin Code *</Label>
                <Input className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)]" inputMode="numeric" maxLength={6} placeholder="6 digits" value={newPartner.location} onChange={e => setNewPartner({ ...newPartner, location: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
              </div>
              {/* Only offered on create — the edit route does not change
                  passwords, so showing the field would imply it does. */}
              {!selectedPartner && (
                <div className="space-y-2">
                  <Label className="text-[hsl(210,20%,85%)]">Password *</Label>
                  <Input className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)]" type="password" value={newPartner.password} onChange={e => setNewPartner({ ...newPartner, password: e.target.value })} />
                </div>
              )}
              <div className="col-span-2 space-y-2">
                <Label className="text-[hsl(210,20%,85%)]">Address</Label>
                <Input className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)]" value={newPartner.address} onChange={e => setNewPartner({ ...newPartner, address: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-2">
                <Label className="text-[hsl(210,20%,85%)]">Trades *</Label>
                <p className="text-xs text-[hsl(215,20%,55%)]">
                  What this expert does — the same list they pick from during signup. Jobs are matched
                  to these, so an expert with none ticked will never appear as qualified.
                </p>
                <div className="grid grid-cols-2 gap-2 border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-3 rounded-md h-40 overflow-y-auto custom-scrollbar">
                  {tradesLoading && (
                    <p className="col-span-2 text-sm text-[hsl(215,20%,55%)]">Loading trades…</p>
                  )}
                  {/* No invented fallback list. A trade that is not a real
                      technician_types row cannot match anything, so offering one
                      would just recreate the bug in a quieter form. */}
                  {tradesError && (
                    <p className="col-span-2 text-sm text-[hsl(38,92%,60%)]">
                      Could not load the trade list. Save the rest and add trades once it loads.
                    </p>
                  )}
                  {!tradesLoading && !tradesError && availableServices.length === 0 && (
                    <p className="col-span-2 text-sm text-[hsl(38,92%,60%)]">
                      No trades defined yet — add them under Service Expert Types first.
                    </p>
                  )}
                  {availableServices.map((service: string) => (
                    <div key={service} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`service-${service}`}
                        checked={newPartner.services.includes(service)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewPartner({ ...newPartner, services: [...newPartner.services, service] });
                          } else {
                            setNewPartner({ ...newPartner, services: newPartner.services.filter(s => s !== service) });
                          }
                        }}
                        className="h-4 w-4 rounded border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.05)] text-[hsl(217,91%,60%)] focus:ring-[hsla(217,91%,60%,0.5)] focus:ring-offset-0"
                      />
                      <label htmlFor={`service-${service}`} className="text-sm text-[hsl(210,20%,80%)]">{service}</label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter className="border-t border-[rgba(255,255,255,0.08)] pt-4">
              <Button onClick={handleAddPartner} disabled={addPartnerMutation.isPending} className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_14px_hsla(217,91%,60%,0.3)] transition-all active:scale-[0.97]">
                {selectedPartner ? 'Save Changes' : 'Register Employee'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
        <CardHeader className="flex flex-col gap-4 pb-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
          <CardTitle className="text-xl text-white">
            Employee Directory{pagination?.total ? <span className="text-[hsl(215,20%,55%)] text-sm font-normal ml-2">({pagination.total})</span> : null}
          </CardTitle>
          <DataToolbar
            query={query}
            searchPlaceholder="Name, partner ID, phone, email…"
            filters={[{
              key: "status",
              label: "All Verification",
              options: [
                { value: "pending", label: "Pending" },
                { value: "verified", label: "Verified" },
                { value: "rejected", label: "Rejected" },
                { value: "suspended", label: "Suspended" },
              ],
            }]}
          />
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-10 text-center text-[hsl(215,20%,55%)] skeleton-shimmer">Loading partners...</div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm glass-table">
                <thead>
                  <tr className="text-left border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                    <th className="p-4 w-10">
                      <SelectAllCheckbox state={selection.pageState(filteredPartners)} onToggle={() => selection.togglePage(filteredPartners)} />
                    </th>
                    <SortableHeader query={query} field="fullName">Employee Info</SortableHeader>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Services</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Wallet</th>
                    <SortableHeader query={query} field="documentVerificationStatus">Status</SortableHeader>
                    <SortableHeader query={query} field="totalServicesCompleted">Jobs</SortableHeader>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isError && <TableErrorState colSpan={7} onRetry={() => refetch()} message="Could not load employees." />}
                    {!isError && filteredPartners.length === 0 && (
                      <TableEmptyState colSpan={7} icon="handyman" title={query.activeFilterCount > 0 ? "No matching employees" : "No employees yet"} description={query.activeFilterCount > 0 ? "Try a different search term or filter." : "Partners who sign up in the app will appear here for verification."} />
                    )}
                    {!isError && filteredPartners.map((partner: any) => (
                    <tr key={partner.id} className={`border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)] group ${!partner.isActive ? 'opacity-60 bg-[rgba(255,255,255,0.01)]' : ''} ${selection.isSelected(partner.id) ? 'bg-[hsla(217,91%,60%,0.06)]' : ''}`}>
                      <td className="p-4">
                        <RowCheckbox checked={selection.isSelected(partner.id)} onToggle={() => selection.toggle(partner)} />
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-gradient-to-br from-[hsl(263,70%,50%)] to-[hsl(217,91%,60%)] rounded-lg flex items-center justify-center font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                            {partner.partnerName.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-[hsl(210,20%,90%)]">{partner.partnerName}</p>
                            <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">{partner.partnerId} <span className="mx-1">•</span> {partner.partnerType}</p>
                            <p className="text-xs text-[hsl(215,20%,45%)] mt-0.5">{partner.phone || 'No phone'} <span className="mx-1">•</span> {partner.email || 'No email'}</p>
                            <p className="text-xs text-[hsl(215,20%,45%)] mt-0.5" title={partner.address || undefined}>
                              {partner.pinCode
                                ? <span className="text-[hsl(215,20%,60%)]">PIN {partner.pinCode}</span>
                                : <span className="text-[hsl(38,92%,60%)]">No pin code</span>}
                              <span className="mx-1">•</span>
                              <span className="inline-block max-w-[16rem] truncate align-bottom">
                                {partner.address || 'No address'}
                              </span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1.5">
                          {partner.services?.slice(0, 2).map((s: string) => (
                            <Badge key={s} variant="outline" className="text-[10px] bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,75%)]">{s}</Badge>
                          ))}
                          {partner.services?.length > 2 && <span className="text-[10px] text-[hsl(215,20%,50%)] self-center ml-1">+{partner.services.length - 2}</span>}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Wallet className="w-4 h-4 text-[hsl(160,84%,60%)]" />
                          <span className="font-mono font-bold text-[hsl(160,84%,65%)] mr-3">₹{partner.walletBalance}</span>

                          {/* Payout readiness. Without this there was no way to see
                              that a partner could never be paid automatically —
                              they'd request a payout and nobody would know why it
                              had to be settled by hand. */}
                          {!partner.hasPayoutDestination ? (
                            <Badge
                              className="bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,65%)] border-[hsla(38,92%,50%,0.3)] text-[10px] mr-1"
                              title="No UPI ID or bank details saved — this partner cannot request a payout yet."
                            >
                              No payout details
                            </Badge>
                          ) : !partner.upiVerifiedAt && partner.upiId ? (
                            // Nobody has checked this UPI id exists. Shown ahead of
                            // the automation badge because sending money to an
                            // unchecked id is the bigger risk of the two.
                            <Badge
                              className="bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,65%)] border-[hsla(38,92%,50%,0.3)] text-[10px] mr-1"
                              title="This UPI ID has never been verified against the payment provider. Confirm it with the partner before transferring money."
                            >
                              UPI unverified
                            </Badge>
                          ) : !partner.payoutAutomationReady ? (
                            <Badge
                              className="bg-[rgba(255,255,255,0.05)] text-[hsl(215,20%,70%)] border-[rgba(255,255,255,0.12)] text-[10px] mr-1"
                              title={
                                partner.upiVerifiedName
                                  ? `UPI verified — registered to ${partner.upiVerifiedName}. RazorpayX has no fund account, so payouts are settled manually with a proof screenshot.`
                                  : "Payout details saved, but RazorpayX has no fund account for them. They can still request a payout — it has to be settled manually with a proof screenshot."
                              }
                            >
                              Manual payout only
                            </Badge>
                          ) : null}

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-[hsl(215,20%,65%)] hover:text-white hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                            title="Transaction History"
                            onClick={() => { setSelectedPartner(partner); setIsHistoryModalOpen(true); }}
                          >
                            <History className="w-3.5 h-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-[hsl(160,84%,60%)] hover:bg-[hsla(160,84%,39%,0.15)] transition-colors"
                            title="Add Funds"
                            disabled={partner.verificationStatus === 'suspended'}
                            onClick={() => { setSelectedPartner(partner); setIsTopupModalOpen(true); }}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-[hsl(347,77%,60%)] hover:bg-[hsla(347,77%,50%,0.15)] transition-colors"
                            title="Deduct Funds"
                            onClick={() => { setSelectedPartner(partner); setIsDeductModalOpen(true); }}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge
                          variant={
                            partner.documentVerificationStatus === 'verified' ? 'default' :
                              partner.documentVerificationStatus === 'suspended' ? 'destructive' : 'secondary'
                          }
                          className={`flex items-center gap-1.5 w-fit ${partner.documentVerificationStatus === 'verified' ? 'bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)]' : partner.documentVerificationStatus === 'suspended' ? 'bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border-[hsla(347,77%,50%,0.3)] shadow-[0_0_10px_hsla(347,77%,50%,0.2)]' : 'bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,65%)] border-[hsla(38,92%,50%,0.3)]'}`}
                        >
                          {partner.documentVerificationStatus === 'verified' ? <CheckCircle className="w-3 h-3" /> :
                            partner.documentVerificationStatus === 'suspended' ? <Ban className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                          <span className="capitalize">{partner.documentVerificationStatus}</span>
                        </Badge>
                      </td>
                      <td className="p-4">
                        <p className="font-mono text-[hsl(210,20%,85%)]">{partner.totalServicesCompleted ?? 0}</p>
                        <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">★ {partner.averageRating ?? '0.00'}</p>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-1.5">
                          {partner.verificationStatus === 'pending' && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="outline" className="h-8 text-[hsl(160,84%,60%)] border-[rgba(255,255,255,0.1)] hover:bg-[hsla(160,84%,39%,0.15)] gap-1.5 transition-all" title="Verify this employee">
                                  <ShieldCheck className="w-4 h-4" />
                                  <span className="text-xs font-medium">Verify</span>
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.9)] backdrop-blur-xl">
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-white">Verify Employee?</AlertDialogTitle>
                                  <AlertDialogDescription className="text-[hsl(215,20%,65%)]">
                                    This will approve <strong className="text-white">{partner.partnerName}</strong> ({partner.email || partner.phone}) as a verified employee. They will be able to receive job assignments.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter className="border-t border-[rgba(255,255,255,0.08)] pt-4 mt-4">
                                  <AlertDialogCancel className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.1)]">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-[hsl(160,84%,39%)] hover:bg-[hsl(160,84%,34%)] text-white shadow-[0_4px_14px_hsla(160,84%,39%,0.3)]"
                                    onClick={() => updateStatusMutation.mutate({ partnerId: partner.id, action: 'approve' })}
                                  >
                                    Approve & Verify
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                          {partner.verificationStatus === 'verified' && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="outline" className="h-8 text-[hsl(38,92%,60%)] border-[rgba(255,255,255,0.1)] hover:bg-[hsla(38,92%,50%,0.15)] gap-1.5 transition-all" title="Suspend this employee">
                                  <Ban className="w-4 h-4" />
                                  <span className="text-xs font-medium">Suspend</span>
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.9)] backdrop-blur-xl">
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-white">Suspend Employee?</AlertDialogTitle>
                                  <AlertDialogDescription className="text-[hsl(215,20%,65%)]">
                                    This will suspend <strong className="text-white">{partner.partnerName}</strong>. They will not be able to receive new jobs until reactivated.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter className="border-t border-[rgba(255,255,255,0.08)] pt-4 mt-4">
                                  <AlertDialogCancel className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.1)]">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-[hsl(38,92%,55%)] hover:bg-[hsl(38,92%,50%)] text-white shadow-[0_4px_14px_hsla(38,92%,50%,0.3)]"
                                    onClick={() => updateStatusMutation.mutate({ partnerId: partner.id, action: 'suspend' })}
                                  >
                                    Suspend
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                          {partner.verificationStatus === 'suspended' && (
                            <Button size="sm" variant="outline" className="h-8 text-[hsl(217,91%,65%)] border-[rgba(255,255,255,0.1)] hover:bg-[hsla(217,91%,60%,0.15)] gap-1.5 transition-all" onClick={() => updateStatusMutation.mutate({ partnerId: partner.id, action: 'activate' })}>
                              <ShieldCheck className="w-4 h-4" />
                              <span className="text-xs font-medium">Reactivate</span>
                            </Button>
                          )}
                          <Dialog open={selectedPartner?.id === partner.id && isAddModalOpen} onOpenChange={(open) => {
                            if (!open) {
                              setSelectedPartner(null);
                              setIsAddModalOpen(false);
                            }
                          }}>
                            <DialogTrigger asChild>
                              <Button 
                                size="sm" 
                                variant="ghost" 
                                className="h-8 text-[hsl(215,20%,75%)] hover:text-white hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                                onClick={() => {
                                  setSelectedPartner(partner);
                                  setNewPartner({
                                    partnerName: partner.partnerName,
                                    email: partner.email,
                                    phone: partner.phone,
                                    password: '', // Don't show password
                                    partnerType: partner.partnerType || 'Individual',
                                    services: partner.services || [],
                                    location: partner.location || '',
                                    businessName: partner.businessName || '',
                                    address: partner.address || ''
                                  });
                                  setIsAddModalOpen(true);
                                }}
                              >
                                <Plus className="w-4 h-4 rotate-45 hidden" /> {/* Hidden trigger hack */}
                                <span className="text-xs font-medium">Edit</span>
                              </Button>
                            </DialogTrigger>
                            {/* The DialogContent is already defined outside the loop using state, 
                                but since we need the Edit button in the loop, we use this trigger pattern. */}
                          </Dialog>

                          {/* Deactivate — reversible, keeps all history. */}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" title="Deactivate (reversible)" className="h-8 w-8 text-[hsl(38,92%,60%)] hover:bg-[hsla(38,92%,50%,0.15)] transition-colors">
                                <Ban className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.9)] backdrop-blur-xl">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-white">Deactivate Employee?</AlertDialogTitle>
                                <AlertDialogDescription className="text-[hsl(215,20%,65%)]">
                                  Blocks login and removes them from assignment eligibility. All jobs, wallet and history are kept, and this can be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter className="border-t border-[rgba(255,255,255,0.08)] pt-4 mt-4">
                                <AlertDialogCancel className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.1)]">Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deletePartnerMutation.mutate(partner.id)} className="bg-[hsl(38,92%,50%)] hover:bg-[hsl(38,92%,45%)] text-white">Deactivate</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>

                          {/* Permanent purge — account + every connected service.
                              Super admin only; the endpoint enforces it too. */}
                          {isSuperAdmin && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Delete permanently (with all connected services)"
                              className="h-8 w-8 text-[hsl(347,77%,60%)] hover:bg-[hsla(347,77%,50%,0.15)] transition-colors"
                              onClick={() => setPurgeTarget(partner)}
                            >
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
            <DataPagination query={query} pagination={pagination} rowCount={filteredPartners.length} />
            </>
          )}
        </CardContent>
      </Card>

      <BulkActionBar
        count={selection.count}
        onClear={selection.clear}
        noun="employee"
        actions={[
          { label: "Export CSV", icon: <Download className="w-3.5 h-3.5" />, onClick: handleExport },
          { label: "Activate", icon: <CheckCircle className="w-3.5 h-3.5" />, onClick: () => bulkStatusMutation.mutate(true), disabled: bulkStatusMutation.isPending },
          { label: "Deactivate", icon: <Ban className="w-3.5 h-3.5" />, onClick: () => bulkStatusMutation.mutate(false), disabled: bulkStatusMutation.isPending },
          { label: "Delete", icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => setBulkPurgeOpen(true), destructive: true, visible: isSuperAdmin },
        ]}
      />

      <BulkPurgeDialog
        kind="employee"
        ids={selection.ids}
        noun="employee"
        open={bulkPurgeOpen}
        onOpenChange={setBulkPurgeOpen}
        onDeleted={refreshList}
      />

      <Dialog open={isTopupModalOpen} onOpenChange={setIsTopupModalOpen}>
        <DialogContent className="max-w-md glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.9)] backdrop-blur-xl overflow-y-auto max-h-[85vh] custom-scrollbar">
          <DialogHeader>
            <DialogTitle className="text-xl text-white">Wallet Top-up</DialogTitle>
            <DialogDescription className="text-[hsl(215,20%,65%)]">Add funds to <span className="text-white font-medium">{selectedPartner?.partnerName}'s</span> wallet</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-5">
            <div className="space-y-2">
              <Label className="text-[hsl(210,20%,85%)]">Amount (₹)</Label>
              <Input className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] text-lg h-12" type="number" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="bg-[hsla(160,84%,39%,0.1)] border border-[hsla(160,84%,39%,0.2)] p-4 rounded-xl flex justify-between items-center shadow-inner">
              <span className="text-sm text-[hsl(160,84%,75%)]">Current Balance</span>
              <span className="font-bold text-xl text-[hsl(160,84%,65%)]">₹{selectedPartner?.walletBalance}</span>
            </div>
          </div>
          <DialogFooter className="border-t border-[rgba(255,255,255,0.08)] pt-4 mt-2">
            <Button className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.1)] transition-all active:scale-[0.97]" variant="outline" onClick={() => setIsTopupModalOpen(false)}>Cancel</Button>
            <Button className="bg-[hsl(160,84%,39%)] hover:bg-[hsl(160,84%,34%)] text-white shadow-[0_4px_14px_hsla(160,84%,39%,0.3)] transition-all active:scale-[0.97]" onClick={() => topupMutation.mutate({ partnerId: selectedPartner.id, amount: parseFloat(topupAmount) })}>Confirm Top-up</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeductModalOpen} onOpenChange={setIsDeductModalOpen}>
        <DialogContent className="max-w-md glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.9)] backdrop-blur-xl overflow-y-auto max-h-[85vh] custom-scrollbar">
          <DialogHeader>
            <DialogTitle className="text-xl text-white">Deduct Funds</DialogTitle>
            <DialogDescription className="text-[hsl(215,20%,65%)]">Deduct from <span className="text-white font-medium">{selectedPartner?.partnerName}'s</span> wallet</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-5">
            <div className="bg-[hsla(160,84%,39%,0.1)] border border-[hsla(160,84%,39%,0.2)] p-4 rounded-xl flex justify-between items-center shadow-inner">
              <span className="text-sm text-[hsl(160,84%,75%)]">Current Balance</span>
              <span className="font-bold text-xl text-[hsl(160,84%,65%)]">₹{selectedPartner?.walletBalance}</span>
            </div>
            <div className="space-y-2">
              <Label className="text-[hsl(210,20%,85%)]">Amount (₹)</Label>
              <Input className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(347,77%,60%,0.3)] text-lg h-12" type="number" value={deductAmount} onChange={e => setDeductAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label className="text-[hsl(210,20%,85%)]">Reason</Label>
              <Input className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(347,77%,60%,0.3)]" value={deductReason} onChange={e => setDeductReason(e.target.value)} placeholder="Reason for deduction" />
            </div>
          </div>
          <DialogFooter className="border-t border-[rgba(255,255,255,0.08)] pt-4 mt-2">
            <Button className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.1)] transition-all active:scale-[0.97]" variant="outline" onClick={() => setIsDeductModalOpen(false)}>Cancel</Button>
            <Button className="bg-[hsl(347,77%,55%)] hover:bg-[hsl(347,77%,50%)] text-white shadow-[0_4px_14px_hsla(347,77%,50%,0.3)] transition-all active:scale-[0.97]" variant="destructive" onClick={() => deductMutation.mutate({ partnerId: selectedPartner.id, amount: parseFloat(deductAmount), reason: deductReason })}>Confirm Deduction</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isHistoryModalOpen} onOpenChange={setIsHistoryModalOpen}>
        <DialogContent className="max-w-3xl glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.9)] backdrop-blur-xl overflow-y-auto max-h-[85vh] custom-scrollbar">
          <DialogHeader className="border-b border-[rgba(255,255,255,0.06)] pb-4">
            <DialogTitle className="text-xl text-white">Transaction History</DialogTitle>
            <DialogDescription className="text-[hsl(215,20%,65%)]">Wallet history for <span className="text-white font-medium">{selectedPartner?.partnerName}</span></DialogDescription>
          </DialogHeader>
          <div className="py-2 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[hsla(222,40%,10%,0.95)] backdrop-blur-md z-10">
                <tr className="border-b border-[rgba(255,255,255,0.06)]">
                  <th className="text-left py-3 text-[hsl(215,20%,60%)] font-medium">Date</th>
                  <th className="text-left py-3 text-[hsl(215,20%,60%)] font-medium">Type</th>
                  <th className="text-left py-3 text-[hsl(215,20%,60%)] font-medium">Description</th>
                  <th className="text-right py-3 text-[hsl(215,20%,60%)] font-medium">Amount</th>
                  <th className="text-right py-3 text-[hsl(215,20%,60%)] font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-[hsl(215,20%,50%)]">No transactions found</td></tr>
                ) : (
                  transactions.map((tx: any) => (
                    <tr key={tx.id} className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                      <td className="py-3 text-[hsl(210,20%,85%)]">{format(new Date(tx.createdAt), 'dd MMM yyyy HH:mm')}</td>
                      <td className="py-3 capitalize">
                        <Badge variant={tx.type === 'credit' || tx.type === 'topup' ? 'default' : 'secondary'} className={tx.type === 'debit' ? 'bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border-[hsla(347,77%,50%,0.3)]' : 'bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)]'}>
                          {tx.type}
                        </Badge>
                      </td>
                      <td className="py-3 text-[hsl(215,20%,70%)]">{tx.description}</td>
                      <td className={`py-3 text-right font-mono font-bold ${Number(tx.amount) > 0 ? 'text-[hsl(160,84%,65%)]' : 'text-[hsl(347,77%,65%)]'}`}>
                        {Number(tx.amount) > 0 ? '+' : ''}{tx.amount}
                      </td>
                      <td className="py-3 text-right font-mono text-[hsl(215,20%,65%)]">₹{tx.balanceAfter}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {purgeTarget && (
        <PurgeAccountDialog
          kind="employee"
          id={purgeTarget.id}
          name={purgeTarget.fullName || purgeTarget.businessName || `Employee #${purgeTarget.id}`}
          open={!!purgeTarget}
          onOpenChange={(o) => !o && setPurgeTarget(null)}
          invalidateKeys={["/api/admin/servicemen/list", "/api/admin/stats"]}
        />
      )}
    </div>
  );
}
