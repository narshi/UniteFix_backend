import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function PartnersPage() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<any>(null);
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

  const { data: partners = [], isLoading } = useQuery({
    queryKey: ["/api/service-partners"],
    select: (data) => Array.isArray(data) ? data : []
  });

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
      return await apiRequest("/api/service-partners", {
        method: "POST",
        body: JSON.stringify(partnerData),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-partners"] });
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
      toast({ 
        title: "Error adding partner", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const updateVerificationMutation = useMutation({
    mutationFn: async ({ partnerId, status }: { partnerId: number; status: string }) => {
      return await apiRequest(`/api/service-partners/${partnerId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ verification_status: status }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-partners"] });
      toast({
        title: "Verification Status Updated",
        description: "Partner verification status has been updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update verification status",
        variant: "destructive",
      });
    }
  });

  const deletePartnerMutation = useMutation({
    mutationFn: async (partnerId: number) => {
      return await apiRequest(`/api/service-partners/${partnerId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-partners"] });
      toast({
        title: "Partner Deleted",
        description: "Service partner has been deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete partner",
        variant: "destructive",
      });
    }
  });

  const handleAddPartner = () => {
    if (!newPartner.partnerName || !newPartner.email || !newPartner.phone || !newPartner.location) {
      toast({ 
        title: "Missing required fields", 
        description: "Please fill in all required fields",
        variant: "destructive" 
      });
      return;
    }
    addPartnerMutation.mutate(newPartner);
  };

  const handleVerificationToggle = (partner: any) => {
    const newStatus = partner.verificationStatus === "Verified" ? "Pending Verification" : "Verified";
    updateVerificationMutation.mutate({
      partnerId: partner.id,
      status: newStatus
    });
  };

  const availableServices = [
    "AC Repair",
    "Laptop Repair",
    "Water Heater Repair",
    "Refrigerator Repair",
    "Washing Machine Repair",
    "Microwave Repair",
    "TV Repair",
    "Mobile Phone Repair"
  ];

  return (
    <div className="flex-1 p-8">
      <div className="mb-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Service Partners</h2>
            <p className="text-gray-600">Manage all service partners and their verification status</p>
          </div>
          <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-partner">Add New Partner</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Service Partner</DialogTitle>
                <DialogDescription>
                  Enter partner information. Admin-created partners are automatically verified.
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="partnerName">Partner Name *</Label>
                    <Input
                      id="partnerName"
                      data-testid="input-partner-name"
                      value={newPartner.partnerName}
                      onChange={(e) => setNewPartner(prev => ({ ...prev, partnerName: e.target.value }))}
                      placeholder="Enter partner name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="partnerType">Partner Type *</Label>
                    <Select value={newPartner.partnerType} onValueChange={(value) => setNewPartner(prev => ({ ...prev, partnerType: value }))}>
                      <SelectTrigger data-testid="select-partner-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Individual">Individual</SelectItem>
                        <SelectItem value="Business">Business</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {newPartner.partnerType === "Business" && (
                  <div>
                    <Label htmlFor="businessName">Business Name</Label>
                    <Input
                      id="businessName"
                      data-testid="input-business-name"
                      value={newPartner.businessName}
                      onChange={(e) => setNewPartner(prev => ({ ...prev, businessName: e.target.value }))}
                      placeholder="Enter business name"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      data-testid="input-email"
                      value={newPartner.email}
                      onChange={(e) => setNewPartner(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="Enter email address"
                    />
                  </div>
                  <div>
                    <Label htmlFor="phone">Phone *</Label>
                    <Input
                      id="phone"
                      data-testid="input-phone"
                      value={newPartner.phone}
                      onChange={(e) => setNewPartner(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="Enter phone number"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="location">Pin Code / Location *</Label>
                  <Input
                    id="location"
                    data-testid="input-location"
                    value={newPartner.location}
                    onChange={(e) => setNewPartner(prev => ({ ...prev, location: e.target.value }))}
                    placeholder="Enter pin code (581xxx)"
                  />
                </div>

                <div>
                  <Label htmlFor="address">Full Address</Label>
                  <Input
                    id="address"
                    data-testid="input-address"
                    value={newPartner.address}
                    onChange={(e) => setNewPartner(prev => ({ ...prev, address: e.target.value }))}
                    placeholder="Enter complete address"
                  />
                </div>

                <div>
                  <Label>Services Offered *</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {availableServices.map((service) => (
                      <label key={service} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newPartner.services.includes(service)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewPartner(prev => ({ ...prev, services: [...prev.services, service] }));
                            } else {
                              setNewPartner(prev => ({ ...prev, services: prev.services.filter(s => s !== service) }));
                            }
                          }}
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm">{service}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <Label htmlFor="password">Temporary Password *</Label>
                  <Input
                    id="password"
                    type="password"
                    data-testid="input-password"
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
                    data-testid="button-submit-partner"
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
          <div className="flex justify-between items-center">
            <CardTitle>All Service Partners</CardTitle>
            <div className="flex space-x-2">
              <Select value={verificationStatusFilter} onValueChange={setVerificationStatusFilter}>
                <SelectTrigger className="w-48" data-testid="select-verification-filter">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Partners</SelectItem>
                  <SelectItem value="Verified">Verified Only</SelectItem>
                  <SelectItem value="Pending Verification">Pending Only</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Search partners..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-64"
                data-testid="input-search-partners"
              />
            </div>
          </div>
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
                    <th className="text-left py-3 px-4">Partner Type</th>
                    <th className="text-left py-3 px-4">Services</th>
                    <th className="text-left py-3 px-4">Contact</th>
                    <th className="text-left py-3 px-4">Location</th>
                    <th className="text-left py-3 px-4">Verification Status</th>
                    <th className="text-left py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(filteredPartners) && filteredPartners.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-gray-500">
                        No service partners found
                      </td>
                    </tr>
                  ) : (
                    filteredPartners.map((partner: any) => (
                      <tr key={partner.id} className="border-b border-gray-100 hover:bg-gray-50" data-testid={`row-partner-${partner.id}`}>
                        <td className="py-3 px-4">
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                              <span className="text-white text-sm font-medium">
                                {partner.partnerName.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-900" data-testid={`text-partner-name-${partner.id}`}>{partner.partnerName}</p>
                              <p className="text-sm text-gray-600">{partner.partnerId}</p>
                              {partner.businessName && (
                                <p className="text-xs text-gray-500">{partner.businessName}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={partner.partnerType === 'Business' ? 'default' : 'secondary'}>
                            {partner.partnerType}
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
                          <p className="text-sm text-gray-600">{partner.location}</p>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center space-x-2">
                            {partner.verificationStatus === "Verified" ? (
                              <Badge className="bg-green-100 text-green-800 hover:bg-green-200">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Verified
                              </Badge>
                            ) : (
                              <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200">
                                <Clock className="w-3 h-3 mr-1" />
                                Pending Verification
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleVerificationToggle(partner)}
                              className={partner.verificationStatus === "Verified" ? "text-orange-600 hover:text-orange-700" : "text-green-600 hover:text-green-700"}
                              data-testid={`button-toggle-verification-${partner.id}`}
                            >
                              {partner.verificationStatus === "Verified" ? "Unverify" : "Verify"}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-700 hover:text-red-800"
                                  data-testid={`button-delete-${partner.id}`}
                                >
                                  Delete
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Service Partner</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete this partner? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deletePartnerMutation.mutate(partner.id)}
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
