import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import {
  useTableQuery, DataToolbar, DataPagination, SortableHeader,
  useRowSelection, BulkActionBar, SelectAllCheckbox, RowCheckbox,
  exportCsv, timestampedName,
} from "@/components/admin/table";
import { Download } from "lucide-react";

type Withdrawal = {
  request: {
    id: number;
    partnerId: number;
    amount: string;
    method: string;
    status: string;
    createdAt: string;
    failureReason: string | null;
    razorpayPayoutId: string | null;
    paymentProofUrl: string | null;
  };
  employee: {
    fullName: string;
    /** Null means nobody ever checked this UPI id — not that it is invalid. */
    upiVerifiedAt: string | null;
    upiVerifiedName: string | null;
    bankAccountNumber: string | null;
    upiId: string | null;
  };
  user: {
    phone: string | null;
    email: string | null;
  };
};

export default function WithdrawalsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [actionDialog, setActionDialog] = useState<{ isOpen: boolean; type: 'reject' | 'approveManual'; request: Withdrawal | null }>({
    isOpen: false,
    type: 'approveManual',
    request: null
  });
  const [syncingId, setSyncingId] = useState<number | null>(null);
  // Payment-proof screenshot — mandatory for manual approval.
  const [proofFile, setProofFile] = useState<File | null>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);

  const query = useTableQuery("/api/admin/withdrawals", {
    defaultSort: "createdAt",
    initialFilters: { status: "all" },
  });
  const selection = useRowSelection<any>();

  const { data, isLoading, isError, refetch } = useQuery<any>({
    queryKey: [query.key],
  });

  const handleExport = () => {
    exportCsv(timestampedName("withdrawals"), selection.rows, [
      { header: "Request ID", value: (w: any) => w.request.id },
      { header: "Date", value: (w: any) => (w.request.createdAt ? new Date(w.request.createdAt).toLocaleString() : "") },
      { header: "Partner", value: (w: any) => w.employee.fullName },
      { header: "Phone", value: (w: any) => w.user.phone },
      { header: "Amount", value: (w: any) => w.request.amount },
      { header: "Method", value: (w: any) => w.request.method },
      { header: "UPI", value: (w: any) => w.employee.upiId },
      { header: "Bank account", value: (w: any) => w.employee.bankAccountNumber },
      { header: "Status", value: (w: any) => w.request.status },
      { header: "Payout ref", value: (w: any) => w.request.razorpayPayoutId },
    ]);
    toast({ title: "Exported " + selection.count + " withdrawal(s)" });
  };

  const closeDialog = () => {
    setActionDialog({ isOpen: false, type: 'approveManual', request: null });
    setProofFile(null);
  };

  const approveManualMutation = useMutation({
    mutationFn: async ({ id, proof }: { id: number; proof: File }) => {
      // apiRequest is JSON-only; the proof photo needs multipart/form-data.
      const formData = new FormData();
      formData.append('proof', proof);

      const adminToken = localStorage.getItem("adminToken");
      const res = await fetch(`/api/admin/withdrawals/${id}/approve-manual`, {
        method: 'POST',
        credentials: 'include',
        headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined,
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Request failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Approved", description: "Withdrawal marked as paid with proof attached." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
      closeDialog();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/withdrawals/${id}/reject`, { reason: "Admin rejected" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rejected", description: "Withdrawal rejected and refunded." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
      closeDialog();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  /**
   * Reconcile a payout against RazorpayX.
   *
   * A request only leaves 'processing' when the payout.processed webhook lands.
   * If that webhook is failing, successful payouts sit here indefinitely and a
   * reversed payout never returns the money to the partner's wallet. This asks
   * RazorpayX directly and applies the real outcome.
   */
  const syncMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/withdrawals/${id}/sync`);
      return res.json();
    },
    onSuccess: (result: any) => {
      const d = result?.data ?? {};
      const settled = d.localStatus === 'completed' || d.localStatus === 'failed';
      toast({
        title: settled ? `Payout ${d.payoutStatus}` : "Still in progress",
        description: d.message,
        variant: d.localStatus === 'failed' ? "destructive" : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
    },
    onError: (error: any) => {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
    },
    onSettled: () => setSyncingId(null),
  });

  const handleAction = () => {
    if (!actionDialog.request) return;
    if (actionDialog.type === 'approveManual') {
      if (!proofFile) return; // guarded again in the dialog button
      approveManualMutation.mutate({ id: actionDialog.request.request.id, proof: proofFile });
    } else {
      rejectMutation.mutate(actionDialog.request.request.id);
    }
  };

  // The rows are { request, employee, user }; row selection needs a numeric id,
  // so surface the request id at the top level.
  const withdrawals = (data?.data || []).map((w: any) => ({ ...w, id: w.request.id }));
  const pagination = data?.pagination;

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden bg-transparent">
      <div className="flex justify-between items-center mb-8 relative z-10 stagger-enter">
        <div>
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]">Withdrawals</h1>
          <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide mt-1">
            Pay partners via UPI/bank, then approve with a payment-proof screenshot.
          </p>
        </div>
      </div>

      <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
        <CardHeader className="flex flex-col gap-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
          <CardTitle className="text-xl text-white">
            Payout Requests{pagination?.total ? <span className="text-[hsl(215,20%,55%)] text-sm font-normal ml-2">({pagination.total})</span> : null}
          </CardTitle>
          <DataToolbar
            query={query}
            searchPlaceholder="Partner, phone, UPI, account, payout ref…"
            filters={[{
              key: "status",
              label: "All Status",
              options: [
                { value: "pending", label: "Pending" },
                { value: "processing", label: "Processing" },
                { value: "completed", label: "Completed" },
                { value: "failed", label: "Failed" },
                { value: "rejected", label: "Rejected" },
              ],
            }]}
          />
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center p-8 text-[hsl(215,20%,65%)]">Loading...</div>
          ) : (
            <>
            <div className="overflow-x-auto custom-scrollbar">
            <Table className="glass-table">
              <TableHeader>
                <TableRow className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.02)]">
                  <TableHead className="w-10">
                    <SelectAllCheckbox state={selection.pageState(withdrawals)} onToggle={() => selection.togglePage(withdrawals)} />
                  </TableHead>
                  <SortableHeader query={query} field="createdAt">Date</SortableHeader>
                  <SortableHeader query={query} field="fullName">Partner</SortableHeader>
                  <SortableHeader query={query} field="amount">Amount (₹)</SortableHeader>
                  <TableHead className="text-[hsl(215,20%,65%)] font-medium">Method</TableHead>
                  <TableHead className="text-[hsl(215,20%,65%)] font-medium">Details</TableHead>
                  <SortableHeader query={query} field="status">Status</SortableHeader>
                  <TableHead className="text-right text-[hsl(215,20%,65%)] font-medium">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isError ? (
                  /* Distinct from "none found" — a failed load must not read as
                     an empty queue when real payout requests may be waiting. */
                  <TableRow className="border-b border-[rgba(255,255,255,0.04)]">
                    <TableCell colSpan={8} className="text-center py-8">
                      <p className="text-[hsl(347,77%,65%)] font-medium">Could not load withdrawal requests.</p>
                      <p className="text-xs text-[hsl(215,20%,55%)] mt-1">
                        This is a loading failure, not an empty queue.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => refetch()}
                        className="mt-3 border-[rgba(255,255,255,0.12)] text-[hsl(210,20%,85%)] hover:bg-[rgba(255,255,255,0.06)]"
                      >
                        Retry
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : withdrawals.length === 0 ? (
                  <TableRow className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.03)]">
                    <TableCell colSpan={8} className="text-center text-[hsl(215,20%,50%)] py-8">
                      No withdrawal requests found.
                    </TableCell>
                  </TableRow>
                ) : (
                  withdrawals.map((w: any) => (
                    <TableRow key={w.request.id} className={"border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.03)] group transition-colors " + (selection.isSelected(w.id) ? "bg-[hsla(217,91%,60%,0.06)]" : "")}>
                      <TableCell>
                        <RowCheckbox checked={selection.isSelected(w.id)} onToggle={() => selection.toggle(w)} />
                      </TableCell>
                      <TableCell className="text-[hsl(210,20%,90%)]">
                        {format(new Date(w.request.createdAt), 'MMM dd, yyyy HH:mm')}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-[hsl(210,20%,90%)]">{w.employee.fullName}</div>
                        <div className="text-xs text-[hsl(215,20%,65%)]">{w.user.phone || w.user.email}</div>
                      </TableCell>
                      <TableCell className="font-mono text-[hsl(210,20%,90%)] font-bold">
                        {w.request.amount}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="uppercase border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,70%)] bg-[rgba(255,255,255,0.02)]">{w.request.method}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-[hsl(215,20%,65%)]">
                        {w.request.method === 'bank' 
                          ? `A/C: ${w.employee.bankAccountNumber || 'N/A'}`
                          : `UPI: ${w.employee.upiId || 'N/A'}`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          w.request.status === 'completed' ? 'default' :
                          w.request.status === 'pending' ? 'secondary' :
                          w.request.status === 'processing' ? 'default' :
                          'destructive'
                        } className={
                          w.request.status === 'completed' ? 'bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)] border shadow-sm backdrop-blur-sm' :
                          w.request.status === 'pending' ? 'bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,60%)] border-[hsla(38,92%,50%,0.3)] border shadow-sm backdrop-blur-sm' :
                          w.request.status === 'processing' ? 'bg-[hsla(217,91%,60%,0.15)] text-[hsl(217,91%,70%)] border-[hsla(217,91%,60%,0.3)] border shadow-sm backdrop-blur-sm' :
                          'bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,60%)] border-[hsla(347,77%,50%,0.3)] border shadow-sm backdrop-blur-sm'
                        }>
                          {w.request.status}
                        </Badge>
                        {w.request.failureReason && (
                          <div className="text-[10px] text-[hsl(347,77%,60%)] mt-1 max-w-[150px] truncate" title={w.request.failureReason}>
                            {w.request.failureReason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {w.request.status === 'pending' && (
                          <div className="space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-[hsla(160,84%,39%,0.1)] text-[hsl(160,84%,65%)] hover:bg-[hsla(160,84%,39%,0.2)] border-[hsla(160,84%,39%,0.3)] transition-colors"
                              onClick={() => { setProofFile(null); setActionDialog({ isOpen: true, type: 'approveManual', request: w }); }}
                            >
                              Approve &amp; Mark Paid
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-[hsl(347,77%,60%)] hover:bg-[hsla(347,77%,50%,0.1)] border-[hsla(347,77%,50%,0.3)] bg-[hsla(347,77%,50%,0.05)] transition-colors"
                              onClick={() => setActionDialog({ isOpen: true, type: 'reject', request: w })}
                            >
                              Reject
                            </Button>
                          </div>
                        )}
                        {/* Stuck in 'processing' means the payout fired but the
                            webhook never confirmed the outcome. */}
                        {w.request.status === 'processing' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!w.request.razorpayPayoutId || syncingId === w.request.id}
                            title={w.request.razorpayPayoutId
                              ? "Ask RazorpayX for the real payout status"
                              : "No payout id recorded for this request"}
                            className="bg-[hsla(217,91%,60%,0.1)] text-[hsl(217,91%,70%)] hover:bg-[hsla(217,91%,60%,0.2)] border-[hsla(217,91%,60%,0.3)] transition-colors disabled:opacity-40"
                            onClick={() => {
                              setSyncingId(w.request.id);
                              syncMutation.mutate(w.request.id);
                            }}
                          >
                            {syncingId === w.request.id ? "Checking…" : "Sync with RazorpayX"}
                          </Button>
                        )}
                        {w.request.paymentProofUrl && (
                          <a
                            href={w.request.paymentProofUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-[hsl(217,91%,70%)] underline block mt-1"
                          >
                            View payment proof
                          </a>
                        )}
                        {w.request.razorpayPayoutId && (
                          <span className="text-xs text-[hsl(215,20%,65%)] font-mono block mt-1">ID: {w.request.razorpayPayoutId}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
            <DataPagination query={query} pagination={pagination} rowCount={withdrawals.length} />
            </>
          )}
        </CardContent>
      </Card>

      <BulkActionBar
        count={selection.count}
        onClear={selection.clear}
        noun="request"
        actions={[
          { label: "Export CSV", icon: <Download className="w-3.5 h-3.5" />, onClick: handleExport },
        ]}
      />

      <AlertDialog open={actionDialog.isOpen} onOpenChange={(open) => !open && closeDialog()}>
        <AlertDialogContent className="glass-panel border-[rgba(255,255,255,0.1)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {actionDialog.type === 'approveManual' ? 'Approve & Mark Paid?' : 'Reject Withdrawal?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[hsl(215,20%,65%)]">
              {actionDialog.type === 'approveManual'
                ? `Transfer ₹${actionDialog.request?.request.amount} to ${actionDialog.request?.employee.fullName} via UPI/Bank first, then attach the payment screenshot below as proof. This completes the redemption.`
                : `This will reject the withdrawal and refund ₹${actionDialog.request?.request.amount} to ${actionDialog.request?.employee.fullName}'s wallet. Continue?`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Where the money is actually going. Shown before the transfer, not
              after it fails — and the unverified case is called out, because a
              UPI id nobody has checked is exactly how a manual payout reaches
              the wrong person. */}
          {actionDialog.type === 'approveManual' && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                actionDialog.request?.employee.upiVerifiedAt
                  ? "border-[hsla(160,84%,39%,0.3)] bg-[hsla(160,84%,39%,0.08)]"
                  : "border-[hsla(38,92%,50%,0.35)] bg-[hsla(38,92%,50%,0.1)]"
              }`}
            >
              <p className="font-mono text-white">
                {actionDialog.request?.employee.upiId
                  || actionDialog.request?.employee.bankAccountNumber
                  || "No payout destination on file"}
              </p>
              {actionDialog.request?.employee.upiVerifiedAt ? (
                <p className="text-[hsl(160,84%,65%)] mt-1">
                  Verified
                  {actionDialog.request?.employee.upiVerifiedName
                    ? ` — registered to ${actionDialog.request.employee.upiVerifiedName}`
                    : ""}
                </p>
              ) : (
                <p className="text-[hsl(38,92%,65%)] mt-1">
                  Not verified — nobody has confirmed this UPI ID exists. Check it with the
                  partner before transferring.
                </p>
              )}
            </div>
          )}

          {actionDialog.type === 'approveManual' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-white block">
                Payment proof <span className="text-[hsl(347,77%,60%)]">*</span>
              </label>
              <input
                ref={proofInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-[hsl(215,20%,65%)] file:mr-3 file:rounded-md file:border-0 file:bg-[hsla(160,84%,39%,0.15)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[hsl(160,84%,65%)] hover:file:bg-[hsla(160,84%,39%,0.25)] file:cursor-pointer cursor-pointer"
              />
              {proofFile ? (
                <img
                  src={URL.createObjectURL(proofFile)}
                  alt="Payment proof preview"
                  className="max-h-40 rounded-md border border-[rgba(255,255,255,0.1)]"
                />
              ) : (
                <p className="text-xs text-[hsl(215,20%,55%)]">
                  A screenshot of the UPI/bank transfer is required to approve.
                </p>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.08)]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                if (actionDialog.type === 'approveManual') {
                  if (!proofFile) {
                    e.preventDefault();
                    toast({ title: "Proof required", description: "Attach the payment screenshot before approving.", variant: "destructive" });
                    return;
                  }
                  // Keep the dialog open while the upload runs; onSuccess closes it.
                  e.preventDefault();
                  if (!approveManualMutation.isPending) handleAction();
                  return;
                }
                handleAction();
              }}
              className={actionDialog.type === 'reject' ? "bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)] text-white shadow-[0_4px_15px_hsla(347,77%,50%,0.4)] transition-all active:scale-95" : "bg-[hsl(160,84%,39%)] hover:bg-[hsl(160,84%,35%)] text-white shadow-[0_4px_15px_hsla(160,84%,39%,0.4)] transition-all active:scale-95"}
            >
              {actionDialog.type === 'approveManual'
                ? (approveManualMutation.isPending ? "Uploading proof..." : "Yes, Mark as Paid")
                : (rejectMutation.isPending ? "Rejecting..." : "Yes, Reject")
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
