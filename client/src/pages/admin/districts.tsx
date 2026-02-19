
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface District {
    id: number;
    name: string;
    state: string;
    pincodePrefix: string;
    isActive: boolean;
    createdAt: string;
}

export default function DistrictsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [newDistrict, setNewDistrict] = useState({
        name: '',
        state: 'Karnataka',
        pincodePrefix: '581',
        isActive: true
    });

    const { data: districts, isLoading } = useQuery<District[]>({
        queryKey: ["/api/admin/districts"],
    });

    const addDistrictMutation = useMutation({
        mutationFn: async (district: typeof newDistrict) => {
            const response = await apiRequest("POST", "/api/admin/districts", district);
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/districts"] });
            setIsAddModalOpen(false);
            setNewDistrict({
                name: '',
                state: 'Karnataka',
                pincodePrefix: '581',
                isActive: true
            });
            toast({ title: "District added successfully" });
        },
        onError: (error: any) => {
            toast({
                title: "Error adding district",
                description: error.message,
                variant: "destructive"
            });
        }
    });

    const toggleDistrictMutation = useMutation({
        mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
            const response = await apiRequest("PATCH", `/api/admin/districts/${id}/toggle`, { isActive });
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/districts"] });
            toast({ title: "District status updated" });
        },
        onError: (error: any) => {
            toast({
                title: "Error updating status",
                description: error.message,
                variant: "destructive"
            });
        }
    });

    const deleteDistrictMutation = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest("DELETE", `/api/admin/districts/${id}`);
        },
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: ["/api/admin/districts"] });
            const previousDistricts = queryClient.getQueryData<District[]>(["/api/admin/districts"]);

            if (previousDistricts) {
                queryClient.setQueryData<District[]>(["/api/admin/districts"], (old) =>
                    old ? old.filter((d) => d.id !== id) : []
                );
            }

            return { previousDistricts };
        },
        onError: (err, id, context) => {
            if (context?.previousDistricts) {
                queryClient.setQueryData(["/api/admin/districts"], context.previousDistricts);
            }
            toast({
                title: "Error deleting district",
                description: err.message,
                variant: "destructive"
            });
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/districts"] });
        },
        onSuccess: () => {
            toast({ title: "District deleted successfully" });
        },
    });

    if (isLoading) return <div>Loading districts...</div>;

    return (
        <div className="p-8">
            <div className="flex flex-row w-full justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 tracking-tight">District Management</h1>
                    <p className="text-gray-500 mt-2">Manage backend service districts and their active status.</p>
                </div>
                <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-primary hover:bg-primary/90 text-white shadow-sm transition-all duration-200">
                            <span className="material-icons text-sm mr-2" style={{ fontFamily: 'Material Icons' }}>add</span>
                            Add District
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Add New District</DialogTitle>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="name" className="text-right">
                                    Name
                                </Label>
                                <Input
                                    id="name"
                                    value={newDistrict.name}
                                    onChange={(e) => setNewDistrict({ ...newDistrict, name: e.target.value })}
                                    className="col-span-3"
                                    placeholder="e.g. Uttara Kannada"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="prefix" className="text-right">
                                    Prefix
                                </Label>
                                <Input
                                    id="prefix"
                                    value={newDistrict.pincodePrefix}
                                    onChange={(e) => setNewDistrict({ ...newDistrict, pincodePrefix: e.target.value })}
                                    className="col-span-3"
                                    placeholder="e.g. 581"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button
                                onClick={() => addDistrictMutation.mutate(newDistrict)}
                                disabled={addDistrictMutation.isPending || !newDistrict.name}
                            >
                                {addDistrictMutation.isPending ? "Adding..." : "Add District"}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            <Card className="shadow-md border-0 ring-1 ring-gray-200">
                <CardHeader className="border-b bg-gray-50/50">
                    <CardTitle className="text-lg font-semibold text-gray-700">Defined Districts</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="rounded-md">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">State</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Prefix</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-100">
                                {districts?.map((district) => (
                                    <tr key={district.id} className="hover:bg-gray-50/60 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 border-l-4 border-transparent hover:border-primary transition-all">
                                            {district.name}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {district.state}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {district.pincodePrefix}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <Badge variant={district.isActive ? "default" : "secondary"} className={district.isActive ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-700"}>
                                                {district.isActive ? "Active" : "Inactive"}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            <div className="flex items-center space-x-3">
                                                <Label htmlFor={`status-${district.id}`} className="text-xs font-medium text-gray-700 cursor-pointer">
                                                    {district.isActive ? 'Enabled' : 'Disabled'}
                                                </Label>
                                                <Input
                                                    id={`status-${district.id}`}
                                                    type="checkbox"
                                                    checked={district.isActive}
                                                    onChange={(e) => toggleDistrictMutation.mutate({
                                                        id: district.id,
                                                        isActive: e.target.checked
                                                    })}
                                                    className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer accent-primary"
                                                />
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {district.name !== 'Uttara Kannada' && (
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                        >
                                                            <span className="material-icons text-sm mr-1">delete</span>
                                                            Delete
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                This action cannot be undone. This will permanently delete the district
                                                                <strong> {district.name} </strong>
                                                                and ALL associated locations (pincodes).
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction
                                                                className="bg-red-600 hover:bg-red-700"
                                                                onClick={() => deleteDistrictMutation.mutate(district.id)}
                                                            >
                                                                Delete
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {districts?.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-4 text-center text-gray-500">
                                            No districts defined. Add one to get started.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
