
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
        <div className="flex-1 p-8 min-h-screen relative overflow-hidden bg-transparent">
            <div className="flex flex-row w-full justify-between items-center mb-8 relative z-10 stagger-enter">
                <div>
                    <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]">District Management</h1>
                    <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide mt-1">Manage backend service districts and their active status.</p>
                </div>
                <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_15px_hsla(217,91%,60%,0.4)] transition-all active:scale-95">
                            <span className="material-icons text-sm mr-2" style={{ fontFamily: 'Material Icons' }}>add</span>
                            Add District
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px] glass-panel border-[rgba(255,255,255,0.1)] overflow-y-auto max-h-[85vh] custom-scrollbar">
                        <DialogHeader>
                            <DialogTitle className="text-xl text-white">Add New District</DialogTitle>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="name" className="text-right text-[hsl(215,20%,75%)]">
                                    Name
                                </Label>
                                <Input
                                    id="name"
                                    value={newDistrict.name}
                                    onChange={(e) => setNewDistrict({ ...newDistrict, name: e.target.value })}
                                    className="col-span-3 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[hsl(215,20%,40%)] focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                                    placeholder="e.g. Uttara Kannada"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="prefix" className="text-right text-[hsl(215,20%,75%)]">
                                    Prefix
                                </Label>
                                <Input
                                    id="prefix"
                                    value={newDistrict.pincodePrefix}
                                    onChange={(e) => setNewDistrict({ ...newDistrict, pincodePrefix: e.target.value })}
                                    className="col-span-3 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[hsl(215,20%,40%)] focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                                    placeholder="e.g. 581"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end pt-2">
                            <Button
                                onClick={() => addDistrictMutation.mutate(newDistrict)}
                                disabled={addDistrictMutation.isPending || !newDistrict.name}
                                className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_15px_hsla(217,91%,60%,0.4)] transition-all active:scale-95"
                            >
                                {addDistrictMutation.isPending ? "Adding..." : "Add District"}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
                <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
                    <CardTitle className="text-xl text-white">Defined Districts</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full glass-table">
                            <thead>
                                <tr className="text-left border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Name</th>
                                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">State</th>
                                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Prefix</th>
                                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Status</th>
                                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider text-center">Toggle</th>
                                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {districts?.map((district) => (
                                    <tr key={district.id} className="border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)] group">
                                        <td className="p-4">
                                            <p className="font-medium text-[hsl(210,20%,90%)]">{district.name}</p>
                                        </td>
                                        <td className="p-4">
                                            <p className="text-sm text-[hsl(215,20%,70%)]">{district.state}</p>
                                        </td>
                                        <td className="p-4">
                                            <p className="text-sm text-[hsl(215,20%,70%)] font-mono">{district.pincodePrefix}</p>
                                        </td>
                                        <td className="p-4">
                                            <Badge variant={district.isActive ? "default" : "secondary"} className={district.isActive ? "bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)] border shadow-sm backdrop-blur-sm" : "bg-[rgba(255,255,255,0.05)] text-[hsl(215,20%,65%)] border-[rgba(255,255,255,0.1)] border shadow-sm backdrop-blur-sm"}>
                                                {district.isActive ? "Active" : "Inactive"}
                                            </Badge>
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center space-x-3">
                                                <Label htmlFor={`status-${district.id}`} className="text-xs font-medium text-[hsl(215,20%,60%)] cursor-pointer">
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
                                                    className="h-4 w-4 rounded border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.05)] text-[hsl(217,91%,60%)] focus:ring-[hsla(217,91%,60%,0.3)] cursor-pointer accent-[hsl(217,91%,60%)] transition-all"
                                                />
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            {district.name !== 'Uttara Kannada' && (
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="text-[hsl(347,77%,60%)] hover:text-[hsl(347,77%,70%)] hover:bg-[hsla(347,77%,50%,0.1)] transition-colors"
                                                        >
                                                            <span className="material-icons text-sm mr-1">delete</span>
                                                            Delete
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent className="glass-panel border-[rgba(255,255,255,0.1)]">
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle className="text-white">Are you absolutely sure?</AlertDialogTitle>
                                                            <AlertDialogDescription className="text-[hsl(215,20%,65%)]">
                                                                This action cannot be undone. This will permanently delete the district
                                                                <strong className="text-[hsl(210,20%,90%)]"> {district.name} </strong>
                                                                and ALL associated locations (pincodes).
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.08)]">Cancel</AlertDialogCancel>
                                                            <AlertDialogAction
                                                                className="bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)] text-white"
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
                                        <td colSpan={6} className="p-8 text-center text-[hsl(215,20%,50%)]">
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
