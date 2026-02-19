
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea"; // Assuming Textarea exists
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

interface Product {
    id: number;
    name: string;
    description: string;
    price: number;
    category: string;
    stock: number;
    images: string[];
    isActive: boolean;
}

const CATEGORIES = ["Computer", "Computer Parts", "CC Camera", "Camera Parts", "Water Purifier", "Purifier Parts", "Other"];

export default function InventoryPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [categoryFilter, setCategoryFilter] = useState<string>("all");
    const [selectedProducts, setSelectedProducts] = useState<number[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        price: '',
        category: 'Computer',
        stock: '',
        images: '' // Comma separated URLs
    });

    const { data: products, isLoading } = useQuery<Product[]>({
        queryKey: ["/api/admin/inventory"],
    });

    const filteredProducts = products?.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = categoryFilter === "all" || p.category === categoryFilter;
        return matchesSearch && matchesCategory;
    });

    const handleSelectAll = (checked: boolean) => {
        if (checked && filteredProducts) {
            setSelectedProducts(filteredProducts.map(p => p.id));
        } else {
            setSelectedProducts([]);
        }
    };

    const handleSelectOne = (id: number, checked: boolean) => {
        if (checked) {
            setSelectedProducts(prev => [...prev, id]);
        } else {
            setSelectedProducts(prev => prev.filter(p => p !== id));
        }
    };

    const handleExportSelected = async () => {
        try {
            const token = localStorage.getItem("adminToken");
            const res = await fetch("/api/admin/inventory/export", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": token ? `Bearer ${token}` : ""
                },
                body: JSON.stringify({ ids: selectedProducts })
            });

            if (!res.ok) throw new Error("Export failed");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `inventory_export_${new Date().toISOString().split('T')[0]}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            toast({ title: "Export successful" });
        } catch (error) {
            toast({ title: "Export failed", variant: "destructive" });
        }
    };

    const saveProductMutation = useMutation({
        mutationFn: async (data: any) => {
            const payload = {
                ...data,
                price: parseFloat(data.price),
                stock: parseInt(data.stock),
                images: data.images.split(',').map((s: string) => s.trim()).filter((s: string) => s),
                isActive: true
            };

            if (editingProduct) {
                return await apiRequest("PATCH", `/api/admin/inventory/${editingProduct.id}`, payload);
            } else {
                return await apiRequest("POST", "/api/admin/inventory", payload);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/inventory"] });
            setIsAddModalOpen(false);
            setEditingProduct(null);
            setFormData({ name: '', description: '', price: '', category: 'Computer', stock: '', images: '' });
            toast({ title: `Product ${editingProduct ? 'updated' : 'added'} successfully` });
        },
        onError: (error: any) => {
            toast({ title: "Error saving product", description: error.message, variant: "destructive" });
        }
    });

    const deleteProductMutation = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest("DELETE", `/api/admin/inventory/${id}`);
        },
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: ["/api/admin/inventory"] });
            const previousProducts = queryClient.getQueryData<Product[]>(["/api/admin/inventory"]);

            if (previousProducts) {
                queryClient.setQueryData<Product[]>(["/api/admin/inventory"], (old) =>
                    old ? old.filter((p) => p.id !== id) : []
                );
            }

            return { previousProducts };
        },
        onError: (err, id, context) => {
            if (context?.previousProducts) {
                queryClient.setQueryData(["/api/admin/inventory"], context.previousProducts);
            }
            toast({ title: "Error deleting", description: err.message, variant: "destructive" });
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/inventory"] });
        },
        onSuccess: () => {
            toast({ title: "Product deleted" });
        },
    });

    const importMutation = useMutation({
        mutationFn: async (file: File) => {
            const formData = new FormData();
            formData.append('file', file);
            const token = localStorage.getItem("adminToken");
            const res = await fetch("/api/admin/inventory/import", {
                method: "POST",
                headers: {
                    "Authorization": token ? `Bearer ${token}` : ""
                },
                body: formData
            });
            if (!res.ok) throw new Error((await res.json()).message);
            return await res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/inventory"] });
            setIsImportModalOpen(false);
            toast({ title: "Import successful", description: data.message });
        },
        onError: (error: any) => {
            toast({ title: "Import failed", description: error.message, variant: "destructive" });
        }
    });

    const handleEdit = (product: Product) => {
        setEditingProduct(product);
        setFormData({
            name: product.name,
            description: product.description || '',
            price: product.price.toString(),
            category: product.category,
            stock: product.stock.toString(),
            images: product.images ? product.images.join(', ') : ''
        });
        setIsAddModalOpen(true);
    };

    return (
        <div className="p-8">
            <div className="flex flex-col md:flex-row w-full justify-between items-start md:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Inventory Management</h1>
                    <p className="text-gray-500 mt-2">Manage products, stock, and categories.</p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        onClick={handleExportSelected}
                        disabled={selectedProducts.length === 0}
                    >
                        <span className="material-icons text-sm mr-2">download</span>
                        Export Selected ({selectedProducts.length})
                    </Button>
                    <Button variant="outline" onClick={() => setIsImportModalOpen(true)}>
                        <span className="material-icons text-sm mr-2">upload_file</span>
                        Import/Export
                    </Button>
                    <Button
                        className="bg-primary text-white"
                        onClick={() => {
                            setEditingProduct(null);
                            setFormData({ name: '', description: '', price: '', category: 'Computer', stock: '', images: '' });
                            setIsAddModalOpen(true);
                        }}
                    >
                        <span className="material-icons text-sm mr-2">add</span>
                        Add Product
                    </Button>
                </div>
            </div>

            <Card className="shadow-md border-0 ring-1 ring-gray-200 mb-6">
                <CardContent className="p-4 flex gap-4 items-center">
                    <div className="flex-1">
                        <Input
                            placeholder="Search products..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="w-[200px]">
                        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                            <SelectTrigger>
                                <SelectValue placeholder="Category" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Categories</SelectItem>
                                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            <Card className="shadow-md border-0 ring-1 ring-gray-200">
                <CardContent className="p-0">
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">
                                    <Checkbox
                                        checked={filteredProducts && filteredProducts.length > 0 && selectedProducts.length === filteredProducts.length}
                                        onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                                    />
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Image</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Category</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Price</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Stock</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredProducts?.map((product) => (
                                <tr key={product.id} className="hover:bg-gray-50/60">
                                    <td className="px-6 py-4">
                                        <Checkbox
                                            checked={selectedProducts.includes(product.id)}
                                            onCheckedChange={(checked) => handleSelectOne(product.id, checked as boolean)}
                                        />
                                    </td>
                                    <td className="px-6 py-4">
                                        {product.images?.[0] ? (
                                            <img src={product.images[0]} alt={product.name} className="w-12 h-12 object-cover rounded" />
                                        ) : (
                                            <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center text-gray-400">
                                                <span className="material-icons text-sm">image</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 font-medium text-gray-900">{product.name}</td>
                                    <td className="px-6 py-4"><Badge variant="outline">{product.category}</Badge></td>
                                    <td className="px-6 py-4">₹{product.price}</td>
                                    <td className="px-6 py-4">
                                        <Badge variant={product.stock < 5 ? "destructive" : "secondary"}>
                                            {product.stock}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-4 flex gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => handleEdit(product)}>Edit</Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="sm" className="text-red-600">Delete</Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete {product.name}?</AlertDialogTitle>
                                                    <AlertDialogDescription>This will remove the product from inventory.</AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction className="bg-red-600" onClick={() => deleteProductMutation.mutate(product.id)}>Delete</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </CardContent>
            </Card>

            {/* Add/Edit Modal */}
            <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editingProduct ? 'Edit Product' : 'Add New Product'}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Name</Label>
                                <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                            </div>
                            <div>
                                <Label>Category</Label>
                                <Select value={formData.category} onValueChange={val => setFormData({ ...formData, category: val })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Price (₹)</Label>
                                <Input type="number" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} />
                            </div>
                            <div>
                                <Label>Stock</Label>
                                <Input type="number" value={formData.stock} onChange={e => setFormData({ ...formData, stock: e.target.value })} />
                            </div>
                        </div>
                        <div>
                            <Label>Description</Label>
                            <Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                        </div>
                        <div>
                            <Label>Image URLs (comma separated)</Label>
                            <Input value={formData.images} onChange={e => setFormData({ ...formData, images: e.target.value })} placeholder="https://..., https://..." />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setIsAddModalOpen(false)}>Cancel</Button>
                        <Button onClick={() => saveProductMutation.mutate(formData)} disabled={saveProductMutation.isPending}>
                            {saveProductMutation.isPending ? 'Saving...' : 'Save Product'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Import Modal */}
            <Dialog open={isImportModalOpen} onOpenChange={setIsImportModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Bulk Import / Export</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-6 py-4">
                        <div className="space-y-2">
                            <h4 className="font-medium">1. Download Template</h4>
                            <p className="text-sm text-gray-500">Download the Excel template to key in your products.</p>
                            <Button variant="outline" onClick={async () => {
                                try {
                                    const token = localStorage.getItem("adminToken");
                                    const res = await fetch("/api/admin/inventory/template", {
                                        headers: {
                                            "Authorization": token ? `Bearer ${token}` : ""
                                        }
                                    });

                                    if (!res.ok) throw new Error("Failed to download");

                                    const blob = await res.blob();
                                    const url = window.URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = "inventory_template.xlsx";
                                    document.body.appendChild(a);
                                    a.click();
                                    window.URL.revokeObjectURL(url);
                                    document.body.removeChild(a);
                                } catch (error) {
                                    toast({
                                        title: "Download failed",
                                        description: "Could not download the template. Please try again.",
                                        variant: "destructive"
                                    });
                                }
                            }}>
                                <span className="material-icons text-sm mr-2">download</span>
                                Download Template
                            </Button>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-medium">2. Upload Filled Template</h4>
                            <p className="text-sm text-gray-500">Upload the filled Excel file to import products.</p>
                            <div className="flex gap-2">
                                <Input type="file" ref={fileInputRef} accept=".xlsx, .xls" />
                                <Button onClick={() => {
                                    const file = fileInputRef.current?.files?.[0];
                                    if (file) importMutation.mutate(file);
                                }} disabled={importMutation.isPending}>
                                    {importMutation.isPending ? "Importing..." : "Import"}
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
