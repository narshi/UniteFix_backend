import { useState } from "react";
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
  };
  employee: {
    fullName: string;
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
  const [actionDialog, setActionDialog] = useState<{ isOpen: boolean; type: 'approve' | 'reject' | 'approveManual'; request: Withdrawal | null }>({
    isOpen: false,
    type: 'approve',
    request: null
  });
  const [syncingId, setSyncingId] = useState<number | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<{ success: boolean; data: Withdrawal[] }>({
    queryKey: ["/api/admin/withdrawals"],
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/withdrawals/${id}/approve`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Approved", description: "Payout processing via RazorpayX" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
      setActionDialog({ isOpen: false, type: 'approve', request: null });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const approveManualMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/withdrawals/${id}/approve-manual`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Approved Manually", description: "Withdrawal marked as manually paid." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
      setActionDialog({ isOpen: false, type: 'approveManual', request: null });
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
      setActionDialog({ isOpen: false, type: 'reject', request: null });
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
    if (actionDialog.type === 'approve') {
      approveMutation.mutate(actionDialog.request.request.id);
    } else if (actionDialog.type === 'approveManual') {
      approveManualMutation.mutate(actionDialog.request.request.id);
    } else {
      rejectMutation.mutate(actionDialog.request.request.id);
    }
  };

  const withdrawals = data?.data || [];

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden bg-transparent">
      <div className="flex justify-between items-center mb-8 relative z-10 stagger-enter">
        <div>
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]">Withdrawals</h1>
          <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide mt-1">
            Manage partner payout requests via RazorpayX.
          </p>
        </div>
      </div>

      <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
        <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
          <CardTitle className="text-xl text-white">Payout Requests</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center p-8 text-[hsl(215,20%,65%)]">Loading...</div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
            <Table className="glass-table">
              <TableHeader>
                <TableRow className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.02)]">
                  <TableHead className="text-[hsl(215,20%,65%)] font-medium">Date</TableHead>
                  <TableHead className="text-[hsl(215,20%,65%)] font-medium">Partner</TableHead>
                  <TableHead className="text-[hsl(215,20%,65%)] font-medium">Amount (₹)</TableHead>
                  <TableHead className="text-[hsl(215,20%,65%)] font-medium">Method</TableHead>
                  <TableHead className="text-[hsl(215,20%,65%)] font-medium">Details</TableHead>
                  <TableHead className="text-[hsl(215,20%,65%)] font-medium">Status</TableHead>
                  <TableHead className="text-right text-[hsl(215,20%,65%)] font-medium">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isError ? (
                  /* Distinct from "none found" — a failed load must not read as
                     an empty queue when real payout requests may be waiting. */
                  <TableRow className="border-b border-[rgba(255,255,255,0.04)]">
                    <TableCell colSpan={7} className="text-center py-8">
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
                    <TableCell colSpan={7} className="text-center text-[hsl(215,20%,50%)] py-8">
                      No withdrawal requests found.
                    </TableCell>
                  </TableRow>
                ) : (
                  withdrawals.map((w) => (
                    <TableRow key={w.request.id} className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.03)] group transition-colors">
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
                          <div className="flex flex-col gap-2 items-end">
                            <div className="space-x-2">
                              <Button 
                                size="sm" 
                                variant="outline"
                                className="bg-[hsla(160,84%,39%,0.1)] text-[hsl(160,84%,65%)] hover:bg-[hsla(160,84%,39%,0.2)] border-[hsla(160,84%,39%,0.3)] transition-colors"
                                onClick={() => setActionDialog({ isOpen: true, type: 'approve', request: w })}
                              >
                                Approve
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
                            <Button 
                              size="sm" 
                              variant="outline"
                              className="w-[150px] bg-[hsla(38,92%,50%,0.1)] text-[hsl(38,92%,60%)] hover:bg-[hsla(38,92%,50%,0.2)] border-[hsla(38,92%,50%,0.3)] transition-colors"
                              onClick={() => setActionDialog({ isOpen: true, type: 'approveManual', request: w })}
                            >
                              Mark Paid Manually
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
          )}
        </CardContent>
      </Card>

      <AlertDialog open={actionDialog.isOpen} onOpenChange={(open) => !open && setActionDialog({ ...actionDialog, isOpen: false })}>
        <AlertDialogContent className="glass-panel border-[rgba(255,255,255,0.1)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {actionDialog.type === 'approve' ? 'Approve Withdrawal via RazorpayX?' : actionDialog.type === 'approveManual' ? 'Mark Paid Manually?' : 'Reject Withdrawal?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[hsl(215,20%,65%)]">
              {actionDialog.type === 'approve' 
                ? `This will initiate a real payout of ₹${actionDialog.request?.request.amount} to ${actionDialog.request?.employee.fullName} via RazorpayX. Are you sure?`
                : actionDialog.type === 'approveManual'
                ? `Have you already transferred ₹${actionDialog.request?.request.amount} to ${actionDialog.request?.employee.fullName} via UPI/Bank? This will complete the redemption without calling RazorpayX.`
                : `This will reject the withdrawal and refund ₹${actionDialog.request?.request.amount} to ${actionDialog.request?.employee.fullName}'s wallet. Continue?`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.08)]">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleAction}
              className={actionDialog.type === 'reject' ? "bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)] text-white shadow-[0_4px_15px_hsla(347,77%,50%,0.4)] transition-all active:scale-95" : "bg-[hsl(160,84%,39%)] hover:bg-[hsl(160,84%,35%)] text-white shadow-[0_4px_15px_hsla(160,84%,39%,0.4)] transition-all active:scale-95"}
            >
              {actionDialog.type === 'approve' 
                ? (approveMutation.isPending ? "Approving..." : "Yes, Approve Payout") 
                : (rejectMutation.isPending ? "Rejecting..." : "Yes, Reject")
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
