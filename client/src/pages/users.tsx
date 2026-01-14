import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Eye, UserCheck, UserX, Phone, Mail, MapPin, Calendar, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function UsersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: usersResponse, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/users"],
  });

  const users = usersResponse?.data || [];

  const updateUserStatusMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: number; isActive: boolean }) => {
      return await apiRequest(`/api/admin/users/${userId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User status updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error updating status", description: error.message, variant: "destructive" });
    }
  });

  const filteredUsers = users?.filter((user: any) =>
    user.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.phone?.includes(searchTerm) ||
    user.userType?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const handleViewDetails = (user: any) => {
    setSelectedUser(user);
    setIsDetailModalOpen(true);
  };

  const handleToggleStatus = (user: any) => {
    updateUserStatusMutation.mutate({ userId: user.id, isActive: !user.isActive });
  };

  return (
    <div className="flex-1 p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">User Management</h2>
        <p className="text-gray-600">Manage all users in the UniteFix platform</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>All Users</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
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
                  <tr className="border-b border-gray-200 text-sm">
                    <th className="text-left py-3 px-4">User</th>
                    <th className="text-left py-3 px-4">Type</th>
                    <th className="text-left py-3 px-4">Contact</th>
                    <th className="text-left py-3 px-4">Status</th>
                    <th className="text-left py-3 px-4">Joined</th>
                    <th className="text-right py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {filteredUsers?.map((user: any, index: number) => (
                    <tr key={`${user.id}-${index}`} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold">
                            {user.username?.charAt(0).toUpperCase() || "U"}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{user.username}</p>
                            <p className="text-xs text-gray-500">{user.email || "No email"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={user.role === 'admin' ? 'default' : user.role === 'serviceman' ? 'outline' : 'secondary'}>
                          {user.role === 'serviceman' ? 'Service Partner' : user.role === 'admin' ? 'Admin' : 'Normal User'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-gray-900">{user.phone}</p>
                        <p className="text-xs text-gray-500">{user.pinCode}</p>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1">
                          <Badge variant={user.isVerified ? 'default' : 'destructive'} className="w-fit">
                            {user.isVerified ? 'Verified' : 'Unverified'}
                          </Badge>
                          {!user.isActive && (
                            <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 w-fit">
                              Inactive
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-gray-600">
                          {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "N/A"}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => handleViewDetails(user)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className={user.isActive ? "text-red-600" : "text-green-600"}
                            onClick={() => handleToggleStatus(user)}
                            disabled={updateUserStatusMutation.isPending}
                          >
                            {user.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                          </Button>
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

      <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
            <DialogDescription>Full profile information for {selectedUser?.username}</DialogDescription>
          </DialogHeader>
          
          {selectedUser && (
            <div className="space-y-6">
              <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
                <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold">
                  {selectedUser.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-lg font-bold">{selectedUser.username}</h3>
                  <Badge variant="outline">{selectedUser.role.toUpperCase()}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="flex items-center space-x-3 text-sm">
                  <Phone className="w-4 h-4 text-gray-400" />
                  <span>{selectedUser.phone}</span>
                </div>
                <div className="flex items-center space-x-3 text-sm">
                  <Mail className="w-4 h-4 text-gray-400" />
                  <span>{selectedUser.email || "N/A"}</span>
                </div>
                <div className="flex items-center space-x-3 text-sm">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  <span>{selectedUser.homeAddress || "No address provided"} ({selectedUser.pinCode || "No Pin"})</span>
                </div>
                <div className="flex items-center space-x-3 text-sm">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span>Joined: {new Date(selectedUser.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center space-x-3 text-sm">
                  <Share2 className="w-4 h-4 text-gray-400" />
                  <span>Referral Code: <span className="font-mono font-bold">{selectedUser.referralCode || "NONE"}</span></span>
                </div>
              </div>

              <div className="pt-4 border-t flex gap-2">
                <Button 
                  className="flex-1" 
                  variant={selectedUser.isActive ? "destructive" : "default"}
                  onClick={() => {
                    handleToggleStatus(selectedUser);
                    setIsDetailModalOpen(false);
                  }}
                >
                  {selectedUser.isActive ? "Deactivate Account" : "Activate Account"}
                </Button>
                <Button className="flex-1" variant="outline" onClick={() => setIsDetailModalOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}