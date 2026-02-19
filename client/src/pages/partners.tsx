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
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";

export default function PartnersPage() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isTopupModalOpen, setIsTopupModalOpen] = useState(false);
  const [isDeductModalOpen, setIsDeductModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<any>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [deductAmount, setDeductAmount] = useState("");
  const [deductReason, setDeductReason] = useState("");
  const [verificationStatusFilter, setVerificationStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState('');
  const [newPartner, setNewPartner] = useState({
    partnerName: '',
    email: '',
    phone: '',
    password: '',
    partnerType: 'Individual',
    services: [] as string[],
    location: '',
    businessName: '',
    address: ''
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: partnersResponse, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/servicemen/list"],
  });

  const partners = partnersResponse?.data || [];

  // Filter partners based on search term and verification status
  const filteredPartners = partners.filter((partner: any) => {
    const matchesSearch = partner.partnerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      partner.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      partner.phone?.includes(searchTerm) ||
      partner.location?.includes(searchTerm) ||
      partner.services?.some((service: string) => service.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus = verificationStatusFilter === "all" ||
      partner.verificationStatus === verificationStatusFilter;

    return matchesSearch && matchesStatus;
  });

  const addPartnerMutation = useMutation({
    mutationFn: async (partnerData: any) => {
      return await apiRequest("POST", "/api/admin/servicemen/create", partnerData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/servicemen/list"] });
      setIsAddModalOpen(false);
      setNewPartner({
        partnerName: '',
        email: '',
        phone: '',
        password: '',
        partnerType: 'Individual',
        services: [],
        location: '',
        businessName: '',
        address: ''
      });
      toast({ title: "Service Partner added successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error adding partner", description: error.message, variant: "destructive" });
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ partnerId, action, reason }: { partnerId: number; action: string; reason?: string }) => {
      return await apiRequest("POST", `/api/admin/servicemen/${partnerId}/${action}`, { reason });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/servicemen/list"] });
      toast({ title: `Partner ${variables.action} successful` });
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/servicemen/list"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/servicemen/list"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/servicemen/list"] });
      toast({ title: "Partner deleted successfully" });
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
    addPartnerMutation.mutate(newPartner);
  };

  const availableServices = [
    "AC Repair", "Laptop Repair", "Water Heater Repair", "Refrigerator Repair",
    "Washing Machine Repair", "Microwave Repair", "TV Repair", "Mobile Phone Repair"
  ];

  return (
    <div className="flex-1 p-8">
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Service Partners</h2>
          <p className="text-gray-600">Manage business partners, verification, and wallets</p>
        </div>
        <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Partner
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Register New Partner</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label>Partner Name *</Label>
                <Input value={newPartner.partnerName} onChange={e => setNewPartner({ ...newPartner, partnerName: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Partner Type</Label>
                <Select value={newPartner.partnerType} onValueChange={v => setNewPartner({ ...newPartner, partnerType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Individual">Individual</SelectItem>
                    <SelectItem value="Business">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Phone Number *</Label>
                <Input value={newPartner.phone} onChange={e => setNewPartner({ ...newPartner, phone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input type="email" value={newPartner.email} onChange={e => setNewPartner({ ...newPartner, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Pin Code *</Label>
                <Input value={newPartner.location} onChange={e => setNewPartner({ ...newPartner, location: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Password *</Label>
                <Input type="password" value={newPartner.password} onChange={e => setNewPartner({ ...newPartner, password: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Address</Label>
                <Input value={newPartner.address} onChange={e => setNewPartner({ ...newPartner, address: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Services Offered *</Label>
                <div className="grid grid-cols-2 gap-2 border p-3 rounded-md h-40 overflow-y-auto">
                  {availableServices.map((service) => (
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
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <label htmlFor={`service-${service}`} className="text-sm text-gray-700">{service}</label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAddPartner}>Register Partner</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Partner Directory</CardTitle>
            <div className="flex gap-2">
              <Select value={verificationStatusFilter} onValueChange={setVerificationStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Search name, phone, service..."
                className="w-64"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-gray-500 animate-pulse">Loading partners...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-4 px-4">Partner Info</th>
                    <th className="text-left py-4 px-4">Services</th>
                    <th className="text-left py-4 px-4">Wallet</th>
                    <th className="text-left py-4 px-4">Status</th>
                    <th className="text-right py-4 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPartners.map((partner: any) => (
                    <tr key={partner.id} className={`border-b border-gray-100 hover:bg-gray-50 ${!partner.isActive ? 'opacity-60 bg-gray-50' : ''}`}>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-indigo-100 text-indigo-700 rounded-lg flex items-center justify-center font-bold">
                            {partner.partnerName.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold">{partner.partnerName}</p>
                            <p className="text-xs text-gray-500">{partner.partnerId} • {partner.partnerType}</p>
                            <p className="text-xs text-gray-400">{partner.phone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex flex-wrap gap-1">
                          {partner.services?.slice(0, 2).map((s: string) => (
                            <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                          ))}
                          {partner.services?.length > 2 && <span className="text-[10px] text-gray-400">+{partner.services.length - 2}</span>}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-1">
                          <Wallet className="w-4 h-4 text-emerald-500" />
                          <span className="font-mono font-bold text-emerald-700 mr-2">₹{partner.walletBalance}</span>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-gray-400 hover:text-blue-600"
                            title="Transaction History"
                            onClick={() => { setSelectedPartner(partner); setIsHistoryModalOpen(true); }}
                          >
                            <History className="w-3 h-3" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-emerald-600 hover:bg-emerald-50"
                            title="Add Funds"
                            disabled={partner.verificationStatus === 'suspended'}
                            onClick={() => { setSelectedPartner(partner); setIsTopupModalOpen(true); }}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-red-600 hover:bg-red-50"
                            title="Deduct Funds"
                            onClick={() => { setSelectedPartner(partner); setIsDeductModalOpen(true); }}
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <Badge
                          variant={
                            partner.verificationStatus === 'verified' ? 'default' :
                              partner.verificationStatus === 'suspended' ? 'destructive' : 'secondary'
                          }
                          className="flex items-center gap-1 w-fit"
                        >
                          {partner.verificationStatus === 'verified' ? <CheckCircle className="w-3 h-3" /> :
                            partner.verificationStatus === 'suspended' ? <Ban className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                          {partner.verificationStatus}
                        </Badge>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex justify-end gap-1">
                          {partner.verificationStatus === 'pending' && (
                            <Button size="sm" variant="outline" className="h-8 text-green-600" onClick={() => updateStatusMutation.mutate({ partnerId: partner.id, action: 'approve' })}>
                              <ShieldCheck className="w-4 h-4" />
                            </Button>
                          )}
                          {partner.verificationStatus === 'verified' && (
                            <Button size="sm" variant="outline" className="h-8 text-orange-600" onClick={() => updateStatusMutation.mutate({ partnerId: partner.id, action: 'suspend' })}>
                              <Ban className="w-4 h-4" />
                            </Button>
                          )}
                          {partner.verificationStatus === 'suspended' && (
                            <Button size="sm" variant="outline" className="h-8 text-blue-600" onClick={() => updateStatusMutation.mutate({ partnerId: partner.id, action: 'activate' })}>
                              <ShieldCheck className="w-4 h-4" />
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="ghost" className="h-8 text-red-500 hover:bg-red-50">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Partner?</AlertDialogTitle>
                                <AlertDialogDescription>This will permanently remove the partner profile and wallet history.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deletePartnerMutation.mutate(partner.id)} className="bg-red-600">Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isTopupModalOpen} onOpenChange={setIsTopupModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wallet Top-up</DialogTitle>
            <DialogDescription>Add funds to {selectedPartner?.partnerName}'s wallet</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Amount (₹)</Label>
              <Input type="number" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} placeholder="Enter amount to add" />
            </div>
            <div className="bg-emerald-50 p-4 rounded-lg flex justify-between items-center text-emerald-800">
              <span className="text-sm">Current Balance</span>
              <span className="font-bold">₹{selectedPartner?.walletBalance}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTopupModalOpen(false)}>Cancel</Button>
            <Button onClick={() => topupMutation.mutate({ partnerId: selectedPartner.id, amount: parseFloat(topupAmount) })}>Confirm Top-up</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeductModalOpen} onOpenChange={setIsDeductModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deduct Funds</DialogTitle>
            <DialogDescription>Deduct from {selectedPartner?.partnerName}'s wallet</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="bg-emerald-50 p-4 rounded-lg flex justify-between items-center text-emerald-800">
              <span className="text-sm">Current Balance</span>
              <span className="font-bold">₹{selectedPartner?.walletBalance}</span>
            </div>
            <div className="space-y-2">
              <Label>Amount (₹)</Label>
              <Input type="number" value={deductAmount} onChange={e => setDeductAmount(e.target.value)} placeholder="Amount to deduct" />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input value={deductReason} onChange={e => setDeductReason(e.target.value)} placeholder="Reason for deduction" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeductModalOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deductMutation.mutate({ partnerId: selectedPartner.id, amount: parseFloat(deductAmount), reason: deductReason })}>Confirm Deduction</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isHistoryModalOpen} onOpenChange={setIsHistoryModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Transaction History</DialogTitle>
            <DialogDescription>{selectedPartner?.partnerName}</DialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Type</th>
                  <th className="text-left py-2">Description</th>
                  <th className="text-right py-2">Amount</th>
                  <th className="text-right py-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-4 text-gray-500">No transactions found</td></tr>
                ) : (
                  transactions.map((tx: any) => (
                    <tr key={tx.id} className="border-b border-gray-100">
                      <td className="py-2">{format(new Date(tx.createdAt), 'dd MMM yyyy HH:mm')}</td>
                      <td className="py-2 capitalize">
                        <Badge variant={tx.type === 'credit' || tx.type === 'topup' ? 'default' : 'secondary'} className={tx.type === 'debit' ? 'bg-red-100 text-red-800' : ''}>
                          {tx.type}
                        </Badge>
                      </td>
                      <td className="py-2 text-gray-600">{tx.description}</td>
                      <td className={`py-2 text-right font-mono font-bold ${Number(tx.amount) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {Number(tx.amount) > 0 ? '+' : ''}{tx.amount}
                      </td>
                      <td className="py-2 text-right font-mono text-gray-600">₹{tx.balanceAfter}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
