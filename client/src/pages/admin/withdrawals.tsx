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
  const [actionDialog, setActionDialog] = useState<{ isOpen: boolean; type: 'approve' | 'reject'; request: Withdrawal | null }>({
    isOpen: false,
    type: 'approve',
    request: null
  });

  const { data, isLoading } = useQuery<{ success: boolean; data: Withdrawal[] }>({
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

  const handleAction = () => {
    if (!actionDialog.request) return;
    if (actionDialog.type === 'approve') {
      approveMutation.mutate(actionDialog.request.request.id);
    } else {
      rejectMutation.mutate(actionDialog.request.request.id);
    }
  };

  const withdrawals = data?.data || [];

  return (
    <div className="p-8 w-full max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Withdrawals</h1>
          <p className="text-muted-foreground mt-2">
            Manage partner payout requests via RazorpayX.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payout Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-8">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Partner</TableHead>
                  <TableHead>Amount (₹)</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withdrawals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No withdrawal requests found.
                    </TableCell>
                  </TableRow>
                ) : (
                  withdrawals.map((w) => (
                    <TableRow key={w.request.id}>
                      <TableCell>
                        {format(new Date(w.request.createdAt), 'MMM dd, yyyy HH:mm')}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{w.employee.fullName}</div>
                        <div className="text-xs text-muted-foreground">{w.user.phone || w.user.email}</div>
                      </TableCell>
                      <TableCell className="font-bold">
                        {w.request.amount}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="uppercase">{w.request.method}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
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
                        }>
                          {w.request.status}
                        </Badge>
                        {w.request.failureReason && (
                          <div className="text-[10px] text-red-500 mt-1 max-w-[150px] truncate" title={w.request.failureReason}>
                            {w.request.failureReason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {w.request.status === 'pending' && (
                          <>
                            <Button 
                              size="sm" 
                              variant="outline"
                              className="bg-green-50 text-green-700 hover:bg-green-100 border-green-200"
                              onClick={() => setActionDialog({ isOpen: true, type: 'approve', request: w })}
                            >
                              Approve
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              className="text-red-600 hover:bg-red-50"
                              onClick={() => setActionDialog({ isOpen: true, type: 'reject', request: w })}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {w.request.status === 'completed' && w.request.razorpayPayoutId && (
                          <span className="text-xs text-muted-foreground">Payout ID: {w.request.razorpayPayoutId}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={actionDialog.isOpen} onOpenChange={(open) => !open && setActionDialog({ ...actionDialog, isOpen: false })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionDialog.type === 'approve' ? 'Approve Withdrawal?' : 'Reject Withdrawal?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionDialog.type === 'approve' 
                ? `This will initiate a real payout of ₹${actionDialog.request?.request.amount} to ${actionDialog.request?.employee.fullName} via RazorpayX. Are you sure?`
                : `This will reject the withdrawal and refund ₹${actionDialog.request?.request.amount} to ${actionDialog.request?.employee.fullName}'s wallet. Continue?`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleAction}
              className={actionDialog.type === 'reject' ? "bg-red-600 hover:bg-red-700" : ""}
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
