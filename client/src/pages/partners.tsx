import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function PartnersPage() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<any>(null);
  const [actionType, setActionType] = useState<'verify' | 'deactivate' | 'suspend' | 'delete' | null>(null);
  const [comment, setComment] = useState('');
  const [suspensionDays, setSuspensionDays] = useState('');
  const [newPartner, setNewPartner] = useState({
    username: '',
    email: '',
    phone: '',
    password: '',
    businessType: 'individual',
    services: [] as string[],
    pinCode: '',
    homeAddress: ''
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: partners = [], isLoading } = useQuery({
    queryKey: ["/api/business/partners"],
    select: (data) => Array.isArray(data) ? data : []
  });

  const addPartnerMutation = useMutation({
    mutationFn: async (partnerData: any) => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...partnerData,
          userType: 'business'
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to add partner");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business/partners"] });
      setIsAddModalOpen(false);
      setNewPartner({
        username: '',
        email: '',
        phone: '',
        password: '',
        businessType: 'individual',
        services: [],
        pinCode: '',
        homeAddress: ''
      });
      toast({ title: "Partner added successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error adding partner", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const partnerActionMutation = useMutation({
    mutationFn: async ({ partnerId, action, comment, days }: {
      partnerId: number;
      action: string;
      comment: string;
      days?: number;
    }) => {
      const response = await fetch(`/api/admin/partners/${partnerId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment, days })
      });
      if (!response.ok) throw new Error(`Failed to ${action} partner`);
      return response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/business/partners"] });
      setSelectedPartner(null);
      setActionType(null);
      setComment('');
      setSuspensionDays('');
      toast({
        title: "Action Completed",
        description: `Partner has been ${variables.action}d successfully`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to perform action. Please try again.",
        variant: "destructive",
      });
    }
  });

  const handlePartnerAction = (partner: any, action: string) => {
    setSelectedPartner(partner);
    setActionType(action as any);
  };

  const executePartnerAction = () => {
    if (!selectedPartner || !actionType) return;
    
    const days = actionType === 'suspend' ? parseInt(suspensionDays) : undefined;
    
    partnerActionMutation.mutate({
      partnerId: selectedPartner.id,
      action: actionType,
      comment,
      days
    });
  };

  const handleAddPartner = () => {
    if (!newPartner.username || !newPartner.email || !newPartner.phone || !newPartner.pinCode) {
      toast({ 
        title: "Missing required fields", 
        description: "Please fill in all required fields",
        variant: "destructive" 
      });
      return;
    }
    addPartnerMutation.mutate(newPartner);
  };

  return (
    <div className="flex-1 p-8">
      <div className="mb-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Business Partners</h2>
            <p className="text-gray-600">Manage all business partners and service providers</p>
          </div>
          <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
            <DialogTrigger asChild>
              <Button>Add New Partner</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add New Business Partner</DialogTitle>
                <DialogDescription>
                  Enter partner information to add them to the platform
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="username">Username *</Label>
                  <Input
                    id="username"
                    value={newPartner.username}
                    onChange={(e) => setNewPartner(prev => ({ ...prev, username: e.target.value }))}
                    placeholder="Enter username"
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newPartner.email}
                    onChange={(e) => setNewPartner(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="Enter email address"
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone *</Label>
                  <Input
                    id="phone"
                    value={newPartner.phone}
                    onChange={(e) => setNewPartner(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="Enter phone number"
                  />
                </div>
                <div>
                  <Label htmlFor="businessType">Business Type</Label>
                  <Select value={newPartner.businessType} onValueChange={(value) => setNewPartner(prev => ({ ...prev, businessType: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="individual">Individual</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="pinCode">Pin Code *</Label>
                  <Input
                    id="pinCode"
                    value={newPartner.pinCode}
                    onChange={(e) => setNewPartner(prev => ({ ...prev, pinCode: e.target.value }))}
                    placeholder="Enter pin code (581xxx)"
                  />
                </div>
                <div>
                  <Label htmlFor="homeAddress">Address</Label>
                  <Input
                    id="homeAddress"
                    value={newPartner.homeAddress}
                    onChange={(e) => setNewPartner(prev => ({ ...prev, homeAddress: e.target.value }))}
                    placeholder="Enter complete address"
                  />
                </div>
                <div>
                  <Label htmlFor="password">Temporary Password *</Label>
                  <Input
                    id="password"
                    type="password"
                    value={newPartner.password}
                    onChange={(e) => setNewPartner(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="Set temporary password"
                  />
                </div>
                <div className="flex justify-end space-x-2 pt-4">
                  <Button variant="outline" onClick={() => setIsAddModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleAddPartner}
                    disabled={addPartnerMutation.isPending}
                  >
                    {addPartnerMutation.isPending ? "Adding..." : "Add Partner"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Business Partners</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-gray-200 rounded-full"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4">Partner</th>
                    <th className="text-left py-3 px-4">Business Type</th>
                    <th className="text-left py-3 px-4">Services</th>
                    <th className="text-left py-3 px-4">Contact</th>
                    <th className="text-left py-3 px-4">Location</th>
                    <th className="text-left py-3 px-4">Status</th>
                    <th className="text-left py-3 px-4">Joined</th>
                    <th className="text-left py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(partners) && partners.map((partner: any) => (
                    <tr key={partner.id} className="border-b border-gray-100">
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                            <span className="text-white text-sm font-medium">
                              {partner.username.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{partner.username}</p>
                            <p className="text-sm text-gray-600">BU{String(partner.id).padStart(5, '0')}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={partner.businessType === 'business' ? 'default' : 'secondary'}>
                          {partner.businessType === 'business' ? 'Business' : 'Individual'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          {partner.services?.map((service: string, idx: number) => (
                            <span key={idx} className="inline-block px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded mr-1">
                              {service}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-sm text-gray-900">{partner.phone}</p>
                        <p className="text-sm text-gray-600">{partner.email}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-sm text-gray-600">{partner.pinCode}</p>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={partner.isVerified ? 'default' : 'destructive'}>
                          {partner.isVerified ? 'Verified' : 'Unverified'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-sm text-gray-600">
                          {new Date(partner.createdAt).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex space-x-2">
                          {!partner.isVerified && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePartnerAction(partner, 'verify')}
                              className="text-green-600 hover:text-green-700"
                            >
                              Verify
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handlePartnerAction(partner, 'suspend')}
                            className="text-orange-600 hover:text-orange-700"
                          >
                            Suspend
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handlePartnerAction(partner, 'deactivate')}
                            className="text-red-600 hover:text-red-700"
                          >
                            Deactivate
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-700 hover:text-red-800"
                              >
                                Delete
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Partner</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete this partner? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handlePartnerAction(partner, 'delete')}
                                  className="bg-red-600 hover:bg-red-700"
                                >
                                  Delete
                                </AlertDialogAction>
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

      {/* Partner Action Modal */}
      <Dialog open={!!actionType} onOpenChange={() => setActionType(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionType === 'verify' && 'Verify Partner'}
              {actionType === 'suspend' && 'Suspend Partner'}
              {actionType === 'deactivate' && 'Deactivate Partner'}
              {actionType === 'delete' && 'Delete Partner'}
            </DialogTitle>
            <DialogDescription>
              {actionType === 'verify' && 'Confirm partner verification and add verification notes'}
              {actionType === 'suspend' && 'Temporarily suspend partner access for specified days'}
              {actionType === 'deactivate' && 'Deactivate partner account with reason'}
              {actionType === 'delete' && 'Permanently delete partner account'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {actionType === 'suspend' && (
              <div>
                <Label htmlFor="suspensionDays">Suspension Duration (Days) *</Label>
                <Input
                  id="suspensionDays"
                  type="number"
                  value={suspensionDays}
                  onChange={(e) => setSuspensionDays(e.target.value)}
                  placeholder="Enter number of days"
                  min="1"
                  max="365"
                />
              </div>
            )}
            
            <div>
              <Label htmlFor="comment">
                {actionType === 'verify' ? 'Verification Notes' : 'Reason/Comment'} *
              </Label>
              <Textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={
                  actionType === 'verify' 
                    ? 'Add verification notes and comments'
                    : 'Provide reason for this action'
                }
                rows={3}
              />
            </div>
            
            <div className="flex justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => setActionType(null)}>
                Cancel
              </Button>
              <Button 
                onClick={executePartnerAction}
                disabled={!comment || (actionType === 'suspend' && !suspensionDays)}
                variant={actionType === 'delete' ? 'destructive' : 'default'}
              >
                {actionType === 'verify' && 'Verify Partner'}
                {actionType === 'suspend' && 'Suspend Partner'}
                {actionType === 'deactivate' && 'Deactivate Partner'}
                {actionType === 'delete' && 'Delete Partner'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}