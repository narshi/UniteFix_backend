import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function PartnersPage() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
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

  const handleAddPartner = () => {
    if (!newPartner.username || !newPartner.email || !newPartner.phone || !newPartner.pinCode) {
      toast({ 
        title: "Please fill all required fields",
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
                      placeholder="Enter pin code"
                    />
                  </div>
                  <div>
                    <Label htmlFor="homeAddress">Address</Label>
                    <Input
                      id="homeAddress"
                      value={newPartner.homeAddress}
                      onChange={(e) => setNewPartner(prev => ({ ...prev, homeAddress: e.target.value }))}
                      placeholder="Enter address"
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
                    </tr>
                  </thead>
                  <tbody>
                    {partners?.map((partner: any) => (
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}