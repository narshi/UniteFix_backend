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
  pinCode: string;
  area: string;
  district: string;
  state: string;
  isActive: boolean;
}

interface District {
  id: number;
  name: string;
  state: string;
  isActive: boolean;
}

export default function LocationsPage() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newLocation, setNewLocation] = useState<LocationData>({
    pinCode: '',
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

  const { data: stats = {} } = useQuery({
    queryKey: ["/api/admin/location-stats"],
  });

  const addLocationMutation = useMutation({
    mutationFn: async (location: LocationData) => {
      const response = await apiRequest("/api/admin/locations", {
        method: "POST",
        body: JSON.stringify({
          ...location,
          pincode: location.pinCode // Map camelCase to lowercase for backend schema
        }),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/location-stats"] });
      setIsAddModalOpen(false);
      setNewLocation({
        pinCode: '',
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
    mutationFn: async ({ pinCode, isActive }: { pinCode: string; isActive: boolean }) => {
      const response = await apiRequest(`/api/admin/locations/${pinCode}/toggle`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      });
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

  const testPinCodeMutation = useMutation({
    mutationFn: async (pinCode: string) => {
      const response = await apiRequest("/api/validate-pincode", {
        method: "POST",
        body: JSON.stringify({ pinCode }),
      });
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
    if (!newLocation.pinCode || !newLocation.area || !newLocation.district) {
      toast({
        title: "Please fill all required fields",
        variant: "destructive"
      });
      return;
    }

    // Strict validation check on client side for better UX
    if (!newLocation.pinCode.startsWith('581')) {
      toast({
        title: "Invalid Pincode Region",
        description: "Pincode must start with 581 (Uttara Kannada)",
        variant: "destructive"
      });
      return;
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

  return (
    <div className="flex-1 p-8">
      <div className="mb-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Location Management</h1>
            <p className="text-gray-500 mt-2">Manage serviceable areas and pin codes for Uttara Kannada region</p>
          </div>
          <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-white shadow-sm transition-all duration-200">
                <span className="material-icons text-sm mr-2" style={{ fontFamily: 'Material Icons' }}>add</span>
                Add New Location
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Add New Serviceable Location</DialogTitle>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="pinCode" className="text-right font-medium">Pin Code *</Label>
                  <Input
                    id="pinCode"
                    value={newLocation.pinCode}
                    onChange={(e) => setNewLocation({ ...newLocation, pinCode: e.target.value })}
                    className="col-span-3"
                    placeholder="e.g. 581341"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="area" className="text-right font-medium">Area/Locality *</Label>
                  <Input
                    id="area"
                    value={newLocation.area}
                    onChange={(e) => setNewLocation({ ...newLocation, area: e.target.value })}
                    className="col-span-3"
                    placeholder="e.g. Karki"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="district" className="text-right font-medium">District *</Label>
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
                      <SelectTrigger>
                        <SelectValue placeholder="Select district" />
                      </SelectTrigger>
                      <SelectContent>
                        {districts?.filter(d => d.isActive).map(d => (
                          <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="state" className="text-right font-medium">State</Label>
                  <Input
                    id="state"
                    value={newLocation.state}
                    readOnly
                    className="col-span-3 bg-muted/50"
                  />
                </div>
              </div>
              <Button
                onClick={handleAddLocation}
                className="w-full transition-all duration-200"
                disabled={addLocationMutation.isPending}
              >
                {addLocationMutation.isPending ? "Adding..." : "Add Location"}
              </Button>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="shadow-sm border border-gray-100 bg-white hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Locations</CardTitle>
              <span className="material-icons text-gray-400 text-lg">place</span>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">{(stats as any)?.totalLocations || 0}</div>
            </CardContent>
          </Card>
          <Card className="shadow-sm border border-gray-100 bg-white hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Active Locations</CardTitle>
              <span className="material-icons text-green-500 text-lg">check_circle</span>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{(stats as any)?.activeLocations || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Inactive Locations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{(stats as any)?.inactiveLocations || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Districts Covered</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(stats as any)?.districtsCovered || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Pin Code Tester */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Pin Code Validator</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex space-x-4">
              <Input
                placeholder="Enter pin code to test"
                value={testPinCode}
                onChange={(e) => setTestPinCode(e.target.value)}
                className="max-w-xs"
              />
              <Button
                onClick={handleTestPinCode}
                disabled={testPinCodeMutation.isPending}
              >
                {testPinCodeMutation.isPending ? "Testing..." : "Test Pin Code"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Locations Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Serviceable Locations</CardTitle>
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
                    <th className="text-left py-3 px-4">Pin Code</th>
                    <th className="text-left py-3 px-4">Area/Locality</th>
                    <th className="text-left py-3 px-4">District</th>
                    <th className="text-left py-3 px-4">State</th>
                    <th className="text-left py-3 px-4">Status</th>
                    <th className="text-left py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(locations as any[])?.map((location: any) => (
                    <tr key={location.pinCode} className="border-b border-gray-100">
                      <td className="py-3 px-4">
                        <span className="font-medium text-gray-900">{location.pinCode}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-gray-900">{location.area}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-gray-600">{location.district}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-gray-600">{location.state}</span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={location.isActive ? 'default' : 'destructive'}>
                          {location.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleLocationMutation.mutate({
                            pinCode: location.pinCode,
                            isActive: !location.isActive
                          })}
                          disabled={toggleLocationMutation.isPending}
                        >
                          {location.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(!locations || (locations as any[]).length === 0) && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-gray-500">
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