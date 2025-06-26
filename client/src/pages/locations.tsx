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

interface LocationData {
  pinCode: string;
  area: string;
  district: string;
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

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["/api/admin/locations"],
  });

  const { data: stats = {} } = useQuery({
    queryKey: ["/api/admin/location-stats"],
  });

  const addLocationMutation = useMutation({
    mutationFn: async (location: LocationData) => {
      const response = await fetch("/api/admin/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(location),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to add location");
      }
      return response.json();
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
      const response = await fetch(`/api/admin/locations/${pinCode}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update location");
      }
      return response.json();
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
      const response = await fetch("/api/utils/validate-pincode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinCode }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to validate pin code");
      }
      return response.json();
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
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Location Management</h2>
            <p className="text-gray-600">Manage serviceable areas and pin codes for Uttara Kannada region</p>
          </div>
          <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
            <DialogTrigger asChild>
              <Button>Add New Location</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Serviceable Location</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="pinCode">Pin Code *</Label>
                  <Input
                    id="pinCode"
                    value={newLocation.pinCode}
                    onChange={(e) => setNewLocation(prev => ({ ...prev, pinCode: e.target.value }))}
                    placeholder="Enter 6-digit pin code"
                  />
                </div>
                <div>
                  <Label htmlFor="area">Area/Locality *</Label>
                  <Input
                    id="area"
                    value={newLocation.area}
                    onChange={(e) => setNewLocation(prev => ({ ...prev, area: e.target.value }))}
                    placeholder="Enter area or locality name"
                  />
                </div>
                <div>
                  <Label htmlFor="district">District *</Label>
                  <Input
                    id="district"
                    value={newLocation.district}
                    onChange={(e) => setNewLocation(prev => ({ ...prev, district: e.target.value }))}
                    placeholder="Enter district name"
                  />
                </div>
                <div>
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={newLocation.state}
                    onChange={(e) => setNewLocation(prev => ({ ...prev, state: e.target.value }))}
                    disabled
                  />
                </div>
                <div className="flex justify-end space-x-2 pt-4">
                  <Button variant="outline" onClick={() => setIsAddModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleAddLocation}
                    disabled={addLocationMutation.isPending}
                  >
                    {addLocationMutation.isPending ? "Adding..." : "Add Location"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Locations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(stats as any)?.totalLocations || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Locations</CardTitle>
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
    </div>
  );
}