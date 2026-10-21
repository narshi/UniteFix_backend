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
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
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
    /** Set when staff paid it themselves: imps | neft | rtgs | upi, and the bank's reference. */
    payoutMode: string | null;
    payoutReference: string | null;
  };
  employee: {
    fullName: string;
    /** Null means nobody ever checked this UPI id — not that it is invalid. */
    upiVerifiedAt: string | null;
    upiVerifiedName: string | null;
    bankAccountNumber: string | null;
    bankIfsc: string | null;
    bankName: string | null;
    upiId: string | null;
  };
  user: {
    phone: string | null;
    email: string | null;
  };
};

type ManualMode = 'imps' | 'neft' | 'rtgs' | 'upi';
const BANK_MODES: Array<{ value: ManualMode; label: string; hint: string }> = [
  { value: 'imps', label: 'IMPS', hint: 'Instant, any time, up to ₹5 lakh' },
  { value: 'neft', label: 'NEFT', hint: 'Within a couple of hours' },
  { value: 'rtgs', label: 'RTGS', hint: '₹2 lakh and above' },
];
/** What a bank shows as the transfer reference: letters and digits, 6–30 long. */
const REFERENCE_OK = /^[A-Z0-9]{6,30}$/;
const cleanReference = (v: string) => v.replace(/\s+/g, '').toUpperCase();
const hasBank = (w: Withdrawal | null) => !!(w?.employee.bankAccountNumber && w?.employee.bankIfsc);
const hasUpi = (w: Withdrawal | null) => !!w?.employee.upiId;

/** One detail to type into a banking app, with a copy button. */
function CopyRow({ label, value, onCopied }: { label: string; value: string | null | undefined; onCopied: (label: string) => void }) {
  const copy = async () => {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); onCopied(label); } catch { /* clipboard refused: the value is still selectable */ }
  };
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-[hsl(215,20%,55%)]">{label}</p>
        <p className="font-mono text-sm text-white break-all select-all">{value || "—"}</p>
      </div>
      {value && (
        <button type="button" onClick={copy} className="shrink-0 text-xs px-2 py-1 rounded-md border border-[rgba(255,255,255,0.12)] text-[hsl(210,20%,80%)] hover:bg-[rgba(255,255,255,0.06)]">
          Copy
        </button>
      )}
    </div>
  );
}

export default function WithdrawalsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [actionDialog, setActionDialog] = useState<{ isOpen: boolean; type: 'reject' | 'approveManual' | 'payCashfree' | 'retry'; request: Withdrawal | null }>({
    isOpen: false,
    type: 'approveManual',
    request: null
  });
  const [syncingId, setSyncingId] = useState<number | null>(null);
  // Payment-proof screenshot — mandatory for manual approval.
  const [proofFile, setProofFile] = useState<File | null>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);
  // Manual payout: how staff paid, and the bank's reference for it.
  const [manualMode, setManualMode] = useState<ManualMode>('imps');
  const [reference, setReference] = useState("");
  // Staff adding or changing the expert's bank account, so they can be paid by IMPS / NEFT.
  const [bankForm, setBankForm] = useState<null | { account: string; confirm: string; ifsc: string; bankName: string }>(null);
  const bankFormProblem = !bankForm ? null
    : !/^\d{9,18}$/.test(bankForm.account.replace(/\s+/g, '')) ? 'Account number: 9 to 18 digits.'
    : bankForm.account.replace(/\s+/g, '') !== bankForm.confirm.replace(/\s+/g, '') ? 'The two account numbers do not match.'
    : !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankForm.ifsc.trim().toUpperCase()) ? 'IFSC: 4 letters, a zero, then 6 letters or digits.'
    : null;
  const saveBankMutation = useMutation({
    mutationFn: async ({ employeeId, form }: { employeeId: number; form: NonNullable<typeof bankForm> }) =>
      apiRequest("PUT", `/api/admin/servicemen/${employeeId}/bank`, {
        bankAccountNumber: form.account.replace(/\s+/g, ''), bankIfsc: form.ifsc.trim().toUpperCase(), bankName: form.bankName.trim() || null,
      }),
    onSuccess: (r: any) => {
      const d = r?.data ?? {};
      // The open dialog holds a copy of the row: update it so the details show at once.
      setActionDialog(prev => prev.request ? { ...prev, request: { ...prev.request, employee: { ...prev.request.employee, bankAccountNumber: d.bankAccountNumber, bankIfsc: d.bankIfsc, bankName: d.bankName } } } : prev);
      setManualMode('imps');
      setBankForm(null);
      toast({ title: "Bank account saved", description: r?.message });
      refreshList();
    },
    onError: (error: any) => toast({ title: "Not saved", description: apiErrorMessage(error), variant: "destructive" }),
  });

  const openManual = (w: Withdrawal) => {
    setProofFile(null);
    setReference("");
    setBankForm(null);
    // Pay the way the expert asked when their details allow it.
    setManualMode(w.request.method === 'upi' ? (hasUpi(w) ? 'upi' : 'imps') : (hasBank(w) ? 'imps' : 'upi'));
    setActionDialog({ isOpen: true, type: 'approveManual', request: w });
  };
  const copied = (label: string) => toast({ title: `${label} copied` });

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
      { header: "IFSC", value: (w: any) => w.employee.bankIfsc },
      { header: "Bank", value: (w: any) => w.employee.bankName },
      { header: "Paid by", value: (w: any) => w.request.payoutMode },
      { header: "UTR / reference", value: (w: any) => w.request.payoutReference },
      { header: "Status", value: (w: any) => w.request.status },
      { header: "Payout ref", value: (w: any) => w.request.razorpayPayoutId },
    ]);
    toast({ title: "Exported " + selection.count + " withdrawal(s)" });
  };

  /**
   * The list is cached under its full URL ("/api/admin/withdrawals?page=1&…"),
   * so invalidating ["/api/admin/withdrawals"] matched nothing and a request
   * stayed "pending" on screen after it was paid. Match on the path instead.
   */
  const refreshList = () =>
    queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/admin/withdrawals"),
    });

  const closeDialog = () => {
    setActionDialog({ isOpen: false, type: 'approveManual', request: null });
    setProofFile(null);
    setReference("");
    setBankForm(null);
  };

  const approveManualMutation = useMutation({
    mutationFn: async ({ id, proof, mode, reference }: { id: number; proof: File; mode: ManualMode; reference: string }) => {
      // apiRequest is JSON-only; the proof photo needs multipart/form-data.
      const formData = new FormData();
      formData.append('proof', proof);
      formData.append('mode', mode);
      if (reference) formData.append('reference', reference);

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
    onSuccess: (r: any) => {
      toast({ title: "Marked as paid", description: r?.message ?? "Withdrawal marked as paid with proof attached." });
      refreshList();
      closeDialog();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  /** Send the money through Cashfree Payouts — UPI or bank, as the expert asked. */
  const payCashfreeMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/admin/withdrawals/${id}/approve`, {}),
    onSuccess: (r: any) => {
      toast({ title: "Sent to Cashfree", description: r?.message ?? "Payout processing via Cashfree. Use “Sync with Cashfree” to see when it lands." });
      refreshList();
      closeDialog();
    },
    onError: (error: any) => {
      toast({ title: "Not sent", description: apiErrorMessage(error), variant: "destructive" });
      refreshList();
    },
  });

  /** A failed payout: take the amount from the wallet again and put it back to pending. */
  const retryMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/admin/withdrawals/${id}/retry`, {}),
    onSuccess: (r: any) => {
      toast({ title: "Back to pending", description: r?.message ?? "Pay it through Cashfree or manually." });
      refreshList();
      closeDialog();
    },
    onError: (error: any) => {
      toast({ title: "Not retried", description: apiErrorMessage(error), variant: "destructive" });
      refreshList();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: number) => {
      // apiRequest resolves to the parsed body already; a non-2xx throws.
      return apiRequest("POST", `/api/admin/withdrawals/${id}/reject`, { reason: "Admin rejected" });
    },
    onSuccess: () => {
      toast({ title: "Rejected", description: "Withdrawal rejected and refunded." });
      refreshList();
      closeDialog();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  /**
   * Reconcile a payout against Cashfree.
   *
   * A request only leaves 'processing' when the payout.processed webhook lands.
   * If that webhook is failing, successful payouts sit here indefinitely and a
   * reversed payout never returns the money to the partner's wallet. This asks
   * Cashfree directly and applies the real outcome.
   */
  const syncMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/admin/withdrawals/${id}/sync`);
    },
    onSuccess: (result: any) => {
      const d = result?.data ?? {};
      const settled = d.localStatus === 'completed' || d.localStatus === 'failed';
      toast({
        title: settled ? `Payout ${d.payoutStatus}` : "Still in progress",
        description: d.message,
        variant: d.localStatus === 'failed' ? "destructive" : undefined,
      });
      refreshList();
    },
    onError: (error: any) => {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
    },
    onSettled: () => setSyncingId(null),
  });

  const handleAction = () => {
    if (!actionDialog.request) return;
    if (actionDialog.type === 'payCashfree') {
      payCashfreeMutation.mutate(actionDialog.request.request.id);
    } else if (actionDialog.type === 'retry') {
      retryMutation.mutate(actionDialog.request.request.id);
    } else if (actionDialog.type === 'approveManual') {
      if (!proofFile) return; // guarded again in the dialog button
      approveManualMutation.mutate({ id: actionDialog.request.request.id, proof: proofFile, mode: manualMode, reference: cleanReference(reference) });
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
            Pay partners through Cashfree, or pay one yourself by bank transfer (IMPS / NEFT / RTGS) or UPI and record the UTR with a proof screenshot.
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
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              size="sm"
                              className="bg-[hsl(160,84%,39%)] hover:bg-[hsl(160,84%,35%)] text-white"
                              onClick={() => setActionDialog({ isOpen: true, type: 'payCashfree', request: w })}
                              title={`Send ₹${w.request.amount} through Cashfree to the expert's ${w.request.method === 'bank' ? 'bank account' : 'UPI ID'}`}
                            >
                              Pay via Cashfree
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-[hsla(160,84%,39%,0.1)] text-[hsl(160,84%,65%)] hover:bg-[hsla(160,84%,39%,0.2)] border-[hsla(160,84%,39%,0.3)] transition-colors"
                              onClick={() => openManual(w)}
                              title="Pay by your own bank transfer or UPI, then record the UTR and proof"
                            >
                              Paid manually
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
                        {/* A failed payout returned the money to the wallet; Retry
                            takes it again and reopens the request for payment. */}
                        {w.request.status === 'failed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-[hsla(38,92%,50%,0.1)] text-[hsl(38,92%,65%)] hover:bg-[hsla(38,92%,50%,0.2)] border-[hsla(38,92%,50%,0.35)] transition-colors"
                            onClick={() => setActionDialog({ isOpen: true, type: 'retry', request: w })}
                            title="Take the amount from the wallet again and reopen the request"
                          >
                            Retry payout
                          </Button>
                        )}
                        {/* Stuck in 'processing' means the payout fired but the
                            webhook never confirmed the outcome. */}
                        {w.request.status === 'processing' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!w.request.razorpayPayoutId || syncingId === w.request.id}
                            title={w.request.razorpayPayoutId
                              ? "Ask Cashfree for the real payout status"
                              : "No payout id recorded for this request"}
                            className="bg-[hsla(217,91%,60%,0.1)] text-[hsl(217,91%,70%)] hover:bg-[hsla(217,91%,60%,0.2)] border-[hsla(217,91%,60%,0.3)] transition-colors disabled:opacity-40"
                            onClick={() => {
                              setSyncingId(w.request.id);
                              syncMutation.mutate(w.request.id);
                            }}
                          >
                            {syncingId === w.request.id ? "Checking…" : "Sync with Cashfree"}
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
                        {w.request.payoutReference ? (
                          <span className="text-xs text-[hsl(215,20%,65%)] font-mono block mt-1">
                            {(w.request.payoutMode ?? 'manual').toUpperCase()} · UTR {w.request.payoutReference}
                          </span>
                        ) : w.request.razorpayPayoutId && (
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
              {actionDialog.type === 'payCashfree' ? `Pay ₹${actionDialog.request?.request.amount} via Cashfree?` : actionDialog.type === 'approveManual' ? `Pay ₹${actionDialog.request?.request.amount} yourself` : actionDialog.type === 'retry' ? `Retry ₹${actionDialog.request?.request.amount} for ${actionDialog.request?.employee.fullName}?` : 'Reject Withdrawal?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[hsl(215,20%,65%)]">
              {actionDialog.type === 'payCashfree'
                ? `Cashfree sends ₹${actionDialog.request?.request.amount} to ${actionDialog.request?.employee.fullName} by ${actionDialog.request?.request.method === 'bank' ? 'IMPS to their bank account' : 'UPI'}, from your Cashfree Payouts balance. The request shows "processing" until Cashfree confirms; if it fails, the money goes back to their wallet.`
                : actionDialog.type === 'retry'
                ? `When this payout failed, ₹${actionDialog.request?.request.amount} went back to their wallet${actionDialog.request?.request.failureReason ? ` (${actionDialog.request.request.failureReason})` : ''}. Retry takes it from the wallet again and puts the request back to pending, so you can pay it through Cashfree or manually, or reject it. If they no longer have that much available, nothing changes.`
                : actionDialog.type === 'approveManual'
                ? `Send ₹${actionDialog.request?.request.amount} to ${actionDialog.request?.employee.fullName} from your own bank or UPI app using the details below, then record the transfer here. This completes the withdrawal.`
                : `This will reject the withdrawal and refund ₹${actionDialog.request?.request.amount} to ${actionDialog.request?.employee.fullName}'s wallet. Continue?`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Where the money is actually going. Shown before the transfer, not
              after it fails — and the unverified case is called out, because a
              UPI id nobody has checked is exactly how a manual payout reaches
              the wrong person. */}
          {actionDialog.type === 'payCashfree' && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                actionDialog.request?.request.method === 'bank' || actionDialog.request?.employee.upiVerifiedAt
                  ? "border-[hsla(160,84%,39%,0.3)] bg-[hsla(160,84%,39%,0.08)]"
                  : "border-[hsla(38,92%,50%,0.35)] bg-[hsla(38,92%,50%,0.1)]"
              }`}
            >
              <p className="font-mono text-white">
                {actionDialog.request?.request.method === 'bank'
                  ? (hasBank(actionDialog.request)
                      ? `${actionDialog.request?.employee.bankAccountNumber} · ${actionDialog.request?.employee.bankIfsc}`
                      : "No bank account and IFSC on file")
                  : (actionDialog.request?.employee.upiId || "No UPI ID on file")}
              </p>
              {actionDialog.request?.request.method === 'bank' ? (
                <p className="text-[hsl(215,20%,70%)] mt-1">
                  Bank account{actionDialog.request?.employee.bankName ? ` at ${actionDialog.request.employee.bankName}` : ""}, in the name of {actionDialog.request?.employee.fullName}.
                </p>
              ) : actionDialog.request?.employee.upiVerifiedAt ? (
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

          {actionDialog.type === 'approveManual' && actionDialog.request && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-white mb-1.5">Pay by</p>
                <div className="grid grid-cols-2 gap-2">
                  {([['bank', 'Bank transfer', hasBank(actionDialog.request)], ['upi', 'UPI', hasUpi(actionDialog.request)]] as const).map(([k, label, ok]) => {
                    const on = k === 'upi' ? manualMode === 'upi' : manualMode !== 'upi';
                    return (
                      <button
                        key={k}
                        type="button"
                        disabled={!ok}
                        onClick={() => setManualMode(k === 'upi' ? 'upi' : 'imps')}
                        className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${on ? "border-[hsla(160,84%,39%,0.6)] bg-[hsla(160,84%,39%,0.12)] text-white" : "border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,70%)] hover:bg-[rgba(255,255,255,0.04)]"}`}
                      >
                        {label}
                        <span className="block text-[11px] text-[hsl(215,20%,55%)]">
                          {!ok ? (k === 'upi' ? 'No UPI ID on file' : 'No bank account / IFSC on file') : (actionDialog.request!.request.method === (k === 'upi' ? 'upi' : 'bank') ? 'What they asked for' : 'They asked for the other one')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {bankForm ? (
                <div className="rounded-lg border border-[hsla(217,91%,60%,0.35)] bg-[hsla(217,91%,60%,0.06)] p-3 space-y-2">
                  <p className="text-sm font-medium text-white">{hasBank(actionDialog.request) ? 'Change' : 'Add'} {actionDialog.request.employee.fullName}'s bank account</p>
                  <p className="text-xs text-[hsl(215,20%,60%)]">Take these from the expert's cancelled cheque or passbook. They are told about the change.</p>
                  {([
                    ['bank-account', 'Account number', 'account', 'e.g. 50100012345678', 'numeric'],
                    ['bank-confirm', 'Account number again', 'confirm', 'Type it again', 'numeric'],
                    ['bank-ifsc', 'IFSC', 'ifsc', 'e.g. HDFC0001234', 'text'],
                    ['bank-name', 'Bank name (optional)', 'bankName', 'e.g. HDFC Bank', 'text'],
                  ] as const).map(([fid, label, key, ph, mode]) => (
                    <div key={fid}>
                      <label htmlFor={fid} className="block text-[11px] uppercase tracking-wide text-[hsl(215,20%,55%)] mb-1">{label}</label>
                      <input
                        id={fid}
                        inputMode={mode}
                        autoComplete="off"
                        value={bankForm[key]}
                        onChange={(e) => setBankForm({ ...bankForm, [key]: key === 'ifsc' ? e.target.value.toUpperCase() : e.target.value })}
                        onPaste={key === 'confirm' ? (e) => e.preventDefault() : undefined}
                        placeholder={ph}
                        className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 font-mono text-sm text-white placeholder:text-[hsl(215,20%,45%)] focus:outline-none focus:border-[hsla(217,91%,60%,0.6)]"
                      />
                    </div>
                  ))}
                  {bankFormProblem && (bankForm.account || bankForm.confirm || bankForm.ifsc) && <p className="text-xs text-[hsl(347,77%,65%)]">{bankFormProblem}</p>}
                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => setBankForm(null)} className="border-[rgba(255,255,255,0.12)] text-white bg-transparent">Cancel</Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!!bankFormProblem || saveBankMutation.isPending}
                      onClick={() => saveBankMutation.mutate({ employeeId: actionDialog.request!.request.partnerId, form: bankForm })}
                      className="bg-[hsl(217,91%,55%)] hover:bg-[hsl(217,91%,50%)] text-white"
                    >
                      {saveBankMutation.isPending ? "Checking…" : "Save bank account"}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setBankForm({ account: '', confirm: '', ifsc: '', bankName: actionDialog.request?.employee.bankName ?? '' })}
                  className="text-xs text-[hsl(217,91%,72%)] underline underline-offset-2 hover:text-white text-left"
                >
                  {hasBank(actionDialog.request) ? 'Change bank account' : `Add a bank account for ${actionDialog.request.employee.fullName} to pay by IMPS / NEFT`}
                </button>
              )}

              {manualMode !== 'upi' ? (
                <div className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 divide-y divide-[rgba(255,255,255,0.06)]">
                  <CopyRow label="Account holder" value={actionDialog.request.employee.fullName} onCopied={copied} />
                  <CopyRow label="Account number" value={actionDialog.request.employee.bankAccountNumber} onCopied={copied} />
                  <CopyRow label="IFSC" value={actionDialog.request.employee.bankIfsc} onCopied={copied} />
                  {actionDialog.request.employee.bankName && <CopyRow label="Bank" value={actionDialog.request.employee.bankName} onCopied={copied} />}
                  <CopyRow label="Amount (₹)" value={actionDialog.request.request.amount} onCopied={copied} />
                  <p className="text-xs text-[hsl(38,92%,65%)] py-2">
                    UniteFix has not verified this account. When you add the payee, the name your bank shows should be {actionDialog.request.employee.fullName}; if it is not, stop and check with the partner.
                  </p>
                </div>
              ) : (
                <div className={`rounded-lg border px-3 py-1.5 ${actionDialog.request.employee.upiVerifiedAt ? "border-[hsla(160,84%,39%,0.3)] bg-[hsla(160,84%,39%,0.08)]" : "border-[hsla(38,92%,50%,0.35)] bg-[hsla(38,92%,50%,0.1)]"}`}>
                  <CopyRow label="UPI ID" value={actionDialog.request.employee.upiId} onCopied={copied} />
                  <CopyRow label="Amount (₹)" value={actionDialog.request.request.amount} onCopied={copied} />
                  <p className={`text-xs py-2 ${actionDialog.request.employee.upiVerifiedAt ? "text-[hsl(160,84%,65%)]" : "text-[hsl(38,92%,65%)]"}`}>
                    {actionDialog.request.employee.upiVerifiedAt
                      ? `Verified${actionDialog.request.employee.upiVerifiedName ? ` — registered to ${actionDialog.request.employee.upiVerifiedName}` : ""}.`
                      : "Not verified — nobody has confirmed this UPI ID exists. Check the name your UPI app shows before paying."}
                  </p>
                </div>
              )}

              {manualMode !== 'upi' && (
                <div>
                  <p className="text-sm font-medium text-white mb-1.5">Sent as</p>
                  <div className="grid grid-cols-3 gap-2">
                    {BANK_MODES.map(m => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setManualMode(m.value)}
                        title={m.hint}
                        className={`rounded-lg border px-2 py-1.5 text-sm transition-colors ${manualMode === m.value ? "border-[hsla(160,84%,39%,0.6)] bg-[hsla(160,84%,39%,0.12)] text-white" : "border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,70%)] hover:bg-[rgba(255,255,255,0.04)]"}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-[hsl(215,20%,55%)] mt-1">{BANK_MODES.find(m => m.value === manualMode)?.hint}</p>
                </div>
              )}

              <div>
                <label htmlFor="manual-reference" className="text-sm font-medium text-white block mb-1.5">
                  {manualMode === 'upi' ? 'UPI transaction ID' : 'UTR / bank reference'}
                  {manualMode !== 'upi' ? <span className="text-[hsl(347,77%,60%)]"> *</span> : <span className="text-[hsl(215,20%,55%)] font-normal"> (optional)</span>}
                </label>
                <input
                  id="manual-reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={manualMode === 'upi' ? 'e.g. 412345678901' : manualMode === 'imps' ? 'e.g. 412345678901 (12 digits)' : 'As shown in your bank statement'}
                  autoComplete="off"
                  className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-3 py-2 font-mono text-sm text-white placeholder:text-[hsl(215,20%,45%)] focus:outline-none focus:border-[hsla(160,84%,39%,0.6)]"
                />
                {reference && !REFERENCE_OK.test(cleanReference(reference)) && (
                  <p className="text-xs text-[hsl(347,77%,65%)] mt-1">6 to 30 letters and digits, exactly as your bank shows it.</p>
                )}
              </div>

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
                if (actionDialog.type === 'payCashfree') {
                  // Keep the dialog open while Cashfree answers; onSuccess closes it.
                  e.preventDefault();
                  if (!payCashfreeMutation.isPending) handleAction();
                  return;
                }
                if (actionDialog.type === 'retry') {
                  e.preventDefault();
                  if (!retryMutation.isPending) handleAction();
                  return;
                }
                if (actionDialog.type === 'approveManual') {
                  const ref = cleanReference(reference);
                  if (manualMode !== 'upi' && !REFERENCE_OK.test(ref)) {
                    e.preventDefault();
                    toast({ title: "UTR required", description: "Enter the UTR (bank reference) of the transfer.", variant: "destructive" });
                    return;
                  }
                  if (ref && !REFERENCE_OK.test(ref)) {
                    e.preventDefault();
                    toast({ title: "Check the reference", description: "6 to 30 letters and digits, exactly as your app shows it.", variant: "destructive" });
                    return;
                  }
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
              disabled={payCashfreeMutation.isPending || retryMutation.isPending}
              className={actionDialog.type === 'reject' ? "bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)] text-white shadow-[0_4px_15px_hsla(347,77%,50%,0.4)] transition-all active:scale-95" : "bg-[hsl(160,84%,39%)] hover:bg-[hsl(160,84%,35%)] text-white shadow-[0_4px_15px_hsla(160,84%,39%,0.4)] transition-all active:scale-95"}
            >
              {actionDialog.type === 'payCashfree'
                ? (payCashfreeMutation.isPending ? "Sending…" : `Send ₹${actionDialog.request?.request.amount}`)
                : actionDialog.type === 'retry'
                ? (retryMutation.isPending ? "Reopening…" : "Retry payout")
                : actionDialog.type === 'approveManual'
                ? (approveManualMutation.isPending ? "Saving…" : "Record payment")
                : (rejectMutation.isPending ? "Rejecting..." : "Yes, Reject")
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
