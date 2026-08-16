
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useClientTableQuery, DataToolbar, DataPagination, SortableHeader,
} from "@/components/admin/table";
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
    // Inventory is configuration data with inline stock editing and optimistic
    // updates, so it stays a single fetch and is filtered/sorted/paged in memory.
    const table = useClientTableQuery<Product>({
        defaultSort: "name",
        defaultOrder: "asc",
        defaultLimit: 25,
        initialFilters: { category: "all" },
        searchFields: (p) => [p.name, (p as any).sku, (p as any).brand, p.category],
        dateField: (p) => (p as any).createdAt,
    });
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

    const { rows: filteredProducts, pagination } = table.apply(products ?? []);

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
        <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden bg-transparent">
            <div className="flex flex-col md:flex-row w-full justify-between items-start md:items-center mb-8 gap-4 relative z-10 stagger-enter">
                <div>
                    <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]">Inventory Management</h1>
                    <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide mt-1">Manage products, stock, and categories.</p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        onClick={handleExportSelected}
                        disabled={selectedProducts.length === 0}
                        className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.08)]"
                    >
                        <span className="material-icons text-sm mr-2">download</span>
                        Export Selected ({selectedProducts.length})
                    </Button>
                    <Button variant="outline" onClick={() => setIsImportModalOpen(true)} className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.08)]">
                        <span className="material-icons text-sm mr-2">upload_file</span>
                        Import/Export
                    </Button>
                    <Button
                        className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_15px_hsla(217,91%,60%,0.4)] transition-all active:scale-95"
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

            <Card className="glass-card border-[rgba(255,255,255,0.08)] mb-6 relative z-10 stagger-enter">
                <CardContent className="p-4">
                    <DataToolbar
                        query={table}
                        searchPlaceholder="Product name, SKU, brand…"
                        showDateRange={false}
                        filters={[{
                            key: "category",
                            label: "All Categories",
                            options: CATEGORIES.map((c) => ({ value: c, label: c })),
                        }]}
                    />
                </CardContent>
            </Card>
            <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
                <CardContent className="p-0">
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full glass-table">
                            <thead>
                                <tr className="text-left border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider w-[50px]">
                                    <Checkbox
                                        checked={filteredProducts && filteredProducts.length > 0 && selectedProducts.length === filteredProducts.length}
                                        onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                                        className="border-[rgba(255,255,255,0.2)] data-[state=checked]:bg-[hsl(217,91%,60%)]"
                                    />
                                </th>
                                <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Image</th>
                                <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Name</th>
                                <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Category</th>
                                <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Price</th>
                                <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Stock</th>
                                <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredProducts?.map((product) => (
                                <tr key={product.id} className="border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)] group">
                                    <td className="p-4">
                                        <Checkbox
                                            checked={selectedProducts.includes(product.id)}
                                            onCheckedChange={(checked) => handleSelectOne(product.id, checked as boolean)}
                                            className="border-[rgba(255,255,255,0.2)] data-[state=checked]:bg-[hsl(217,91%,60%)]"
                                        />
                                    </td>
                                    <td className="p-4">
                                        {product.images?.[0] ? (
                                            <img src={product.images[0]} alt={product.name} className="w-12 h-12 object-cover rounded-lg border border-[rgba(255,255,255,0.1)] shadow-sm" />
                                        ) : (
                                            <div className="w-12 h-12 bg-[rgba(255,255,255,0.05)] rounded-lg flex items-center justify-center text-[hsl(215,20%,50%)] border border-[rgba(255,255,255,0.05)]">
                                                <span className="material-icons text-sm">image</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-4 font-medium text-[hsl(210,20%,90%)]">{product.name}</td>
                                    <td className="p-4"><Badge variant="outline" className="border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,70%)] bg-[rgba(255,255,255,0.02)]">{product.category}</Badge></td>
                                    <td className="p-4 font-mono text-[hsl(210,20%,80%)]">₹{product.price}</td>
                                    <td className="p-4">
                                        <Badge variant={product.stock < 5 ? "destructive" : "secondary"} className={product.stock < 5 ? "bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,60%)] border-[hsla(347,77%,50%,0.3)] border shadow-sm backdrop-blur-sm" : "bg-[hsla(217,91%,60%,0.15)] text-[hsl(217,91%,70%)] border-[hsla(217,91%,60%,0.3)] border shadow-sm backdrop-blur-sm"}>
                                            {product.stock}
                                        </Badge>
                                    </td>
                                    <td className="p-4 flex gap-2 justify-end">
                                        <Button variant="ghost" size="sm" onClick={() => handleEdit(product)} className="text-[hsl(215,20%,70%)] hover:text-white hover:bg-[rgba(255,255,255,0.05)]">Edit</Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="sm" className="text-[hsl(347,77%,60%)] hover:text-[hsl(347,77%,70%)] hover:bg-[hsla(347,77%,50%,0.1)] transition-colors">Delete</Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent className="glass-panel border-[rgba(255,255,255,0.1)]">
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle className="text-white">Delete {product.name}?</AlertDialogTitle>
                                                    <AlertDialogDescription className="text-[hsl(215,20%,65%)]">This will remove the product from inventory.</AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.08)]">Cancel</AlertDialogCancel>
                                                    <AlertDialogAction className="bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)] text-white" onClick={() => deleteProductMutation.mutate(product.id)}>Delete</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                    <DataPagination query={table} pagination={pagination} rowCount={filteredProducts.length} />
                </CardContent>
            </Card>

            {/* Add/Edit Modal */}
            <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                <DialogContent className="max-w-2xl glass-panel border-[rgba(255,255,255,0.1)] overflow-y-auto max-h-[85vh] custom-scrollbar">
                    <DialogHeader>
                        <DialogTitle className="text-xl text-white">{editingProduct ? 'Edit Product' : 'Add New Product'}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label className="text-[hsl(215,20%,75%)]">Name</Label>
                                <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
                            </div>
                            <div>
                                <Label className="text-[hsl(215,20%,75%)]">Category</Label>
                                <Select value={formData.category} onValueChange={val => setFormData({ ...formData, category: val })}>
                                    <SelectTrigger className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:ring-[hsla(217,91%,60%,0.3)]"><SelectValue /></SelectTrigger>
                                    <SelectContent className="glass-panel border-[rgba(255,255,255,0.1)]">
                                        {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label className="text-[hsl(215,20%,75%)]">Price (₹)</Label>
                                <Input type="number" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
                            </div>
                            <div>
                                <Label className="text-[hsl(215,20%,75%)]">Stock</Label>
                                <Input type="number" value={formData.stock} onChange={e => setFormData({ ...formData, stock: e.target.value })} className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
                            </div>
                        </div>
                        <div>
                            <Label className="text-[hsl(215,20%,75%)]">Description</Label>
                            <Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all min-h-[80px]" />
                        </div>
                        <div>
                            <Label className="text-[hsl(215,20%,75%)]">Image URLs (comma separated)</Label>
                            <Input value={formData.images} onChange={e => setFormData({ ...formData, images: e.target.value })} placeholder="https://..., https://..." className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[hsl(215,20%,40%)] focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => setIsAddModalOpen(false)} className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.08)]">Cancel</Button>
                        <Button onClick={() => saveProductMutation.mutate(formData)} disabled={saveProductMutation.isPending} className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_15px_hsla(217,91%,60%,0.4)] transition-all active:scale-95">
                            {saveProductMutation.isPending ? 'Saving...' : 'Save Product'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Import Modal */}
            <Dialog open={isImportModalOpen} onOpenChange={setIsImportModalOpen}>
                <DialogContent className="glass-panel border-[rgba(255,255,255,0.1)] overflow-y-auto max-h-[85vh] custom-scrollbar">
                    <DialogHeader>
                        <DialogTitle className="text-xl text-white">Bulk Import / Export</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-6 py-4">
                        <div className="space-y-2">
                            <h4 className="font-medium text-[hsl(210,20%,90%)]">1. Download Template</h4>
                            <p className="text-sm text-[hsl(215,20%,65%)]">Download the Excel template to key in your products.</p>
                            <Button variant="outline" className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.08)]" onClick={async () => {
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
                            <h4 className="font-medium text-[hsl(210,20%,90%)]">2. Upload Filled Template</h4>
                            <p className="text-sm text-[hsl(215,20%,65%)]">Upload the filled Excel file to import products.</p>
                            <div className="flex gap-2">
                                <Input type="file" ref={fileInputRef} accept=".xlsx, .xls" className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white file:text-white file:border-0 file:bg-[rgba(255,255,255,0.05)] file:mr-4 file:px-4 file:py-2 file:rounded-md cursor-pointer focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
                                <Button className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_15px_hsla(217,91%,60%,0.4)] transition-all active:scale-95" onClick={() => {
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
