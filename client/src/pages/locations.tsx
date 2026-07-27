import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface LocationData {
  pincode: string;
  area: string;
  district: string;
  state: string;
  isActive: boolean;
}

interface District {
  id: number;
  name: string;
  state: string;
  pincodePrefix?: string;
  isActive: boolean;
}

export default function LocationsPage() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationData | null>(null);
  const [newLocation, setNewLocation] = useState<LocationData>({
    pincode: '',
    area: '',
    district: '',
    state: 'Karnataka',
    isActive: true
  });
  const [testPinCode, setTestPinCode] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: locations = [], isLoading } = useQuery<LocationData[]>({
    queryKey: ["/api/admin/locations"],
  });

  const { data: districts } = useQuery<District[]>({
    queryKey: ["/api/admin/districts"],
  });

  // Filter active districts
  const activeDistricts = districts?.filter(d => d.isActive) || [];

  const handleDistrictChange = (districtName: string) => {
    setNewLocation({ ...newLocation, district: districtName });
  };

  const { data: stats = {} } = useQuery({
    queryKey: ["/api/admin/location-stats"],
  });

  const addLocationMutation = useMutation({
    mutationFn: async (location: LocationData) => {
      // Client-side validation
      const selectedDistrict = districts?.find(d => d.name === location.district);
      if (selectedDistrict?.pincodePrefix) {
        if (!location.pincode.startsWith(selectedDistrict.pincodePrefix)) {
          throw new Error(`Pincode for ${selectedDistrict.name} must start with ${selectedDistrict.pincodePrefix}`);
        }
      }

      const response = await apiRequest("POST", "/api/admin/locations", {
        ...location,
        pincode: location.pincode
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/location-stats"] });
      setIsAddModalOpen(false);
      setNewLocation({
        pincode: '',
        area: '',
        district: '',
        state: 'Karnataka',
        isActive: true
      });
      toast({ title: "Location added successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Error adding location",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const toggleLocationMutation = useMutation({
    mutationFn: async ({ pincode, isActive }: { pincode: string; isActive: boolean }) => {
      const response = await apiRequest("PATCH", `/api/admin/locations/${pincode}/toggle`, { isActive });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/location-stats"] });
      toast({ title: "Location status updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating location",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const editLocationMutation = useMutation({
    mutationFn: async ({ originalPincode, data }: { originalPincode: string; data: LocationData }) => {
      const selectedDistrict = districts?.find(d => d.name === data.district);
      if (selectedDistrict?.pincodePrefix && data.pincode && !data.pincode.startsWith(selectedDistrict.pincodePrefix)) {
        throw new Error(`Pincode for ${selectedDistrict.name} must start with ${selectedDistrict.pincodePrefix}`);
      }
      
      const response = await apiRequest("PUT", `/api/admin/locations/${originalPincode}`, data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/location-stats"] });
      setIsEditModalOpen(false);
      setEditingLocation(null);
      toast({ title: "Location updated successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating location",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const testPinCodeMutation = useMutation({
    mutationFn: async (pinCode: string) => {
      const response = await apiRequest("POST", "/api/validate-pincode", { pinCode });
      return response;
    },
    onSuccess: (data: any) => {
      toast({
        title: data.valid ? "Pin Code Valid" : "Pin Code Invalid",
        description: data.message,
        variant: data.valid ? "default" : "destructive"
      });
    }
  });

  const handleAddLocation = () => {
    if (!newLocation.pincode || !newLocation.area || !newLocation.district) {
      toast({
        title: "Please fill all required fields",
        variant: "destructive"
      });
      return;
    }

    // Dynamic validation check based on district
    const selectedDistrict = districts?.find(d => d.name === newLocation.district);
    if (selectedDistrict?.pincodePrefix) {
      if (!newLocation.pincode.startsWith(selectedDistrict.pincodePrefix)) {
        toast({
          title: "Invalid Pincode Region",
          description: `Pincode for ${selectedDistrict.name} must start with ${selectedDistrict.pincodePrefix}`,
          variant: "destructive"
        });
        return;
      }
    }

    addLocationMutation.mutate(newLocation);
  };

  const handleTestPinCode = () => {
    if (!testPinCode) {
      toast({
        title: "Please enter a pin code to test",
        variant: "destructive"
      });
      return;
    }
    testPinCodeMutation.mutate(testPinCode);
  };

  const handleEditLocation = () => {
    if (!editingLocation || !editingLocation.pincode || !editingLocation.area || !editingLocation.district) {
      toast({
        title: "Please fill all required fields",
        variant: "destructive"
      });
      return;
    }

    const selectedDistrict = districts?.find(d => d.name === editingLocation.district);
    if (selectedDistrict?.pincodePrefix && editingLocation.pincode && !editingLocation.pincode.startsWith(selectedDistrict.pincodePrefix)) {
      toast({
        title: "Invalid Pincode Region",
        description: `Pincode for ${selectedDistrict.name} must start with ${selectedDistrict.pincodePrefix}`,
        variant: "destructive"
      });
      return;
    }

    // Assuming we somehow tracked the original pincode. For simplicity, we assume the editingLocation contains the original pincode in a custom field, or we just pass the original pincode separately. Wait, since editingLocation is state, we need its original pincode.
    // I will modify this below.
    editLocationMutation.mutate({ originalPincode: (editingLocation as any)._originalPincode, data: editingLocation });
  };

  const openEditModal = (location: LocationData) => {
    setEditingLocation({ ...location, _originalPincode: location.pincode } as any);
    setIsEditModalOpen(true);
  };

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden">
      <div className="mb-8">
        <div className="flex justify-between items-center mb-8 relative z-10 stagger-enter">
          <div>
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)] mb-2">Location Management</h1>
            <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide">Manage serviceable areas and pin codes for Uttara Kannada region</p>
          </div>
          <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
            <DialogTrigger asChild>
              <Button className="flex items-center gap-2 bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_14px_hsla(217,91%,60%,0.3)] hover:shadow-[0_6px_20px_hsla(217,91%,60%,0.4)] transition-all active:scale-[0.97]">
                <span className="material-icons text-sm mr-2" style={{ fontFamily: 'Material Icons' }}>add</span>
                Add New Location
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.8)] shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-y-auto max-h-[85vh] custom-scrollbar">
              <DialogHeader>
                <DialogTitle className="text-xl text-white">Add New Serviceable Location</DialogTitle>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="pincode" className="text-right font-medium text-[hsl(210,20%,85%)]">Pin Code *</Label>
                  <Input
                    id="pincode"
                    value={newLocation.pincode}
                    onChange={(e) => setNewLocation({ ...newLocation, pincode: e.target.value })}
                    className="col-span-3 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)]"
                    placeholder="e.g. 581341"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="area" className="text-right font-medium text-[hsl(210,20%,85%)]">Area/Locality *</Label>
                  <Input
                    id="area"
                    value={newLocation.area}
                    onChange={(e) => setNewLocation({ ...newLocation, area: e.target.value })}
                    className="col-span-3 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)]"
                    placeholder="e.g. Karki"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="district" className="text-right font-medium text-[hsl(210,20%,85%)]">District *</Label>
                  <div className="col-span-3">
                    <Select
                      value={newLocation.district}
                      onValueChange={(value) => {
                        const district = districts?.find(d => d.name === value);
                        setNewLocation({
                          ...newLocation,
                          district: value,
                          state: district?.state || 'Karnataka'
                        });
                      }}
                    >
                      <SelectTrigger className="mt-1 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:ring-[hsla(217,91%,60%,0.3)]">
                        <SelectValue placeholder="Select District" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeDistricts.map((district) => (
                          <SelectItem key={district.id} value={district.name}>
                            {district.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="state" className="text-right font-medium text-[hsl(210,20%,85%)]">State</Label>
                  <Input
                    id="state"
                    value={newLocation.state}
                    readOnly
                    className="col-span-3 bg-[rgba(255,255,255,0.01)] border-[rgba(255,255,255,0.04)] text-[hsl(215,20%,65%)] cursor-not-allowed"
                  />
                </div>
              </div>
              <Button
                onClick={handleAddLocation}
                className="w-full transition-all duration-200 bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_14px_hsla(217,91%,60%,0.3)]"
                disabled={addLocationMutation.isPending}
              >
                {addLocationMutation.isPending ? "Adding..." : "Add Location"}
              </Button>
            </DialogContent>
          </Dialog>

          {/* Edit Modal */}
          <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
            <DialogContent className="sm:max-w-[500px] glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.8)] shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-y-auto max-h-[85vh] custom-scrollbar">
              <DialogHeader>
                <DialogTitle className="text-xl text-white">Edit Serviceable Location</DialogTitle>
              </DialogHeader>
              {editingLocation && (
                <div className="grid gap-6 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-pincode" className="text-right font-medium text-[hsl(210,20%,85%)]">Pin Code *</Label>
                    <Input
                      id="edit-pincode"
                      value={editingLocation.pincode}
                      onChange={(e) => setEditingLocation({ ...editingLocation, pincode: e.target.value })}
                      className="col-span-3 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)]"
                      placeholder="e.g. 581341"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-area" className="text-right font-medium text-[hsl(210,20%,85%)]">Area/Locality *</Label>
                    <Input
                      id="edit-area"
                      value={editingLocation.area}
                      onChange={(e) => setEditingLocation({ ...editingLocation, area: e.target.value })}
                      className="col-span-3 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)]"
                      placeholder="e.g. Karki"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-district" className="text-right font-medium text-[hsl(210,20%,85%)]">District *</Label>
                    <div className="col-span-3">
                      <Select
                        value={editingLocation.district}
                        onValueChange={(value) => {
                          const district = districts?.find(d => d.name === value);
                          setEditingLocation({
                            ...editingLocation,
                            district: value,
                            state: district?.state || 'Karnataka'
                          });
                        }}
                      >
                        <SelectTrigger className="mt-1 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:ring-[hsla(217,91%,60%,0.3)]">
                          <SelectValue placeholder="Select District" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeDistricts.map((district) => (
                            <SelectItem key={district.id} value={district.name}>
                              {district.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-state" className="text-right font-medium text-[hsl(210,20%,85%)]">State</Label>
                    <Input
                      id="edit-state"
                      value={editingLocation.state}
                      readOnly
                      className="col-span-3 bg-[rgba(255,255,255,0.01)] border-[rgba(255,255,255,0.04)] text-[hsl(215,20%,65%)] cursor-not-allowed"
                    />
                  </div>
                </div>
              )}
              <Button
                onClick={handleEditLocation}
                className="w-full transition-all duration-200 bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_14px_hsla(217,91%,60%,0.3)]"
                disabled={editLocationMutation.isPending}
              >
                {editLocationMutation.isPending ? "Updating..." : "Update Location"}
              </Button>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 relative z-10 stagger-enter">
          <Card className="glass-card border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[hsl(215,20%,65%)]">Total Locations</CardTitle>
              <span className="material-icons text-[hsl(217,91%,60%)] text-lg">place</span>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{(stats as any)?.totalLocations || 0}</div>
            </CardContent>
          </Card>
          <Card className="glass-card border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[hsl(215,20%,65%)]">Active Locations</CardTitle>
              <span className="material-icons text-[hsl(160,84%,60%)] text-lg">check_circle</span>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[hsl(160,84%,65%)]">{(stats as any)?.activeLocations || 0}</div>
            </CardContent>
          </Card>
          <Card className="glass-card border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[hsl(215,20%,65%)]">Inactive Locations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[hsl(347,77%,65%)]">{(stats as any)?.inactiveLocations || 0}</div>
            </CardContent>
          </Card>
          <Card className="glass-card border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[hsl(215,20%,65%)]">Districts Covered</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{(stats as any)?.districtsCovered || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Pin Code Tester */}
        <Card className="mb-8 glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">Pin Code Validator</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex space-x-4">
              <Input
                placeholder="Enter pin code to test"
                value={testPinCode}
                onChange={(e) => setTestPinCode(e.target.value)}
                className="max-w-xs bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
              />
              <Button
                onClick={handleTestPinCode}
                disabled={testPinCodeMutation.isPending}
                className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.1)] transition-all active:scale-[0.97]"
                variant="outline"
              >
                {testPinCodeMutation.isPending ? "Testing..." : "Test Pin Code"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Locations Table */}
      <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
        <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
          <CardTitle className="text-xl text-white">All Serviceable Locations</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-4 skeleton-shimmer">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-[rgba(255,255,255,0.05)] rounded-xl border border-[rgba(255,255,255,0.08)]"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-[rgba(255,255,255,0.05)] rounded-md w-3/4"></div>
                      <div className="h-3 bg-[rgba(255,255,255,0.03)] rounded-md w-1/2"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full glass-table">
                <thead>
                  <tr className="text-left border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Pin Code</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Area/Locality</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">District</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">State</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Status</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(locations as any[])?.map((location: any) => (
                    <tr key={location.pincode} className="border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)] group">
                      <td className="p-4">
                        <span className="font-medium text-[hsl(210,20%,90%)]">{location.pincode}</span>
                      </td>
                      <td className="p-4">
                        <span className="text-[hsl(210,20%,85%)]">{location.area}</span>
                      </td>
                      <td className="p-4">
                        <span className="text-[hsl(215,20%,70%)]">{location.district}</span>
                      </td>
                      <td className="p-4">
                        <span className="text-[hsl(215,20%,70%)]">{location.state}</span>
                      </td>
                      <td className="p-4">
                        <Badge variant={location.isActive ? 'default' : 'destructive'} className={location.isActive ? 'bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)] border' : 'bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border-[hsla(347,77%,50%,0.3)] border'}>
                          {location.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="p-4 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditModal(location)}
                          className="h-8 border-[rgba(255,255,255,0.1)] text-[hsl(217,91%,60%)] bg-[hsla(217,91%,60%,0.05)] hover:bg-[hsla(217,91%,60%,0.15)] transition-colors"
                        >
                          <span className="text-xs font-medium material-icons text-sm mr-1">edit</span>
                          <span className="text-xs font-medium">Edit</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleLocationMutation.mutate({
                            pincode: location.pincode,
                            isActive: !location.isActive
                          })}
                          disabled={toggleLocationMutation.isPending}
                          className={`h-8 ${location.isActive ? 'border-[rgba(255,255,255,0.1)] text-[hsl(38,92%,60%)] bg-[hsla(38,92%,50%,0.05)] hover:bg-[hsla(38,92%,50%,0.15)]' : 'border-[rgba(255,255,255,0.1)] text-[hsl(160,84%,60%)] bg-[hsla(160,84%,39%,0.05)] hover:bg-[hsla(160,84%,39%,0.15)]'} transition-colors`}
                        >
                          <span className="text-xs font-medium">{location.isActive ? 'Deactivate' : 'Activate'}</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(!locations || (locations as any[]).length === 0) && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-[hsl(215,20%,50%)]">
                        No locations found. Add your first serviceable location.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div >
  );
}