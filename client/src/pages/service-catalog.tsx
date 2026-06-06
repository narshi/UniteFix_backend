import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Search, Plus, Edit, Archive, CheckCircle2, XCircle, Grid, List, MoreVertical, Image as ImageIcon, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function ServiceCatalogPage() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'all'>('all');
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [editingService, setEditingService] = useState<any>(null);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["/api/admin/catalog/categories"],
    select: (res: any) => res.data || []
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/catalog/categories", data);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/catalog/categories"] });
      toast({ title: "Success", description: "Category created successfully" });
      setIsCategoryModalOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number, data: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/catalog/categories/${id}`, data);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/catalog/categories"] });
      toast({ title: "Success", description: "Category updated successfully" });
      setIsCategoryModalOpen(false);
      setEditingCategory(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/catalog/categories/${id}`);
      return res;
    },
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/catalog/categories"] });
      toast({ title: "Success", description: "Category and its services deleted successfully" });
      if (selectedCategoryId === deletedId) setSelectedCategoryId('all');
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const createServiceMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/catalog/services", data);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/catalog/categories"] });
      toast({ title: "Success", description: "Service created successfully" });
      setIsServiceModalOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const updateServiceMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number, data: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/catalog/services/${id}`, data);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/catalog/categories"] });
      toast({ title: "Success", description: "Service updated successfully" });
      setIsServiceModalOpen(false);
      setEditingService(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const handleCategorySubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      icon: formData.get('icon') as string,
      sortOrder: parseInt(formData.get('sortOrder') as string) || 0,
      isActive: formData.get('isActive') === 'on'
    };

    const isDuplicate = categories.some((cat: any) => 
      cat.name.toLowerCase() === data.name.toLowerCase() && 
      (!editingCategory || cat.id !== editingCategory.id)
    );

    if (isDuplicate) {
      toast({ title: "Validation Error", description: "A category with this name already exists", variant: "destructive" });
      return;
    }

    if (editingCategory) {
      updateCategoryMutation.mutate({ id: editingCategory.id, data });
    } else {
      createCategoryMutation.mutate(data);
    }
  };

  const handleServiceSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      categoryId: parseInt(formData.get('categoryId') as string),
      name: formData.get('name') as string,
      subtitle: formData.get('subtitle') as string,
      icon: formData.get('icon') as string,
      bannerImage: formData.get('bannerImage') as string,
      status: formData.get('status') as string,
      isHomeVisible: formData.get('isHomeVisible') === 'on',
      sortOrder: parseInt(formData.get('sortOrder') as string) || 0,
      isActive: formData.get('isActive') === 'on'
    };

    if (editingService) {
      updateServiceMutation.mutate({ id: editingService.id, data });
    } else {
      createServiceMutation.mutate(data);
    }
  };

  const allServices = categories.flatMap((cat: any) => 
    (cat.items || []).map((item: any) => ({ ...item, categoryName: cat.name }))
  );

  const filteredServices = allServices.filter((service: any) => {
    const matchesSearch = service.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (service.subtitle?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategoryId === 'all' || service.categoryId === selectedCategoryId;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="flex-1 p-8 bg-gray-50/50 min-h-screen">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">Service Catalog</h2>
          <p className="text-gray-500 mt-1">Manage categories, services, and their visibility on the platform.</p>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => { setEditingCategory(null); setIsCategoryModalOpen(true); }} variant="outline" className="flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Category
          </Button>
          <Button onClick={() => { setEditingService(null); setIsServiceModalOpen(true); }} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Add Service
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card className="md:col-span-1 bg-white shadow-sm border-gray-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Grid className="w-4 h-4 text-blue-500" /> Categories
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <Button 
              variant={selectedCategoryId === 'all' ? "secondary" : "ghost"} 
              className="w-full justify-start text-sm"
              onClick={() => setSelectedCategoryId('all')}
            >
              All Categories
            </Button>
            {categories.map((cat: any) => (
              <div key={cat.id} className="flex items-center group">
                <Button 
                  variant={selectedCategoryId === cat.id ? "secondary" : "ghost"} 
                  className="flex-1 justify-start text-sm truncate"
                  onClick={() => setSelectedCategoryId(cat.id)}
                  title={cat.name}
                >
                  {cat.icon && cat.icon.startsWith('http') ? (
                    <img src={cat.icon} alt={cat.name} className="w-5 h-5 mr-2 rounded-sm object-cover" referrerPolicy="no-referrer" />
                  ) : null}
                  {cat.name}
                </Button>
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8"
                    onClick={() => { setEditingCategory(cat); setIsCategoryModalOpen(true); }}
                  >
                    <Edit className="w-3 h-3 text-gray-500 hover:text-blue-600" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8"
                    onClick={() => {
                      if (window.confirm("Are you sure you want to delete this category? This will also delete all services inside it.")) {
                        deleteCategoryMutation.mutate(cat.id);
                      }
                    }}
                    disabled={deleteCategoryMutation.isPending}
                  >
                    <Trash2 className="w-3 h-3 text-gray-500 hover:text-red-600" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="md:col-span-3 space-y-6">
          <Card className="bg-white shadow-sm border-gray-200">
            <CardHeader className="pb-4">
              <div className="flex justify-between items-center">
                <div className="space-y-1">
                  <CardTitle className="text-xl">Services</CardTitle>
                  <CardDescription>Total {filteredServices.length} services found</CardDescription>
                </div>
                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search services..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 bg-gray-50/50"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {isLoading ? (
                  Array(6).fill(0).map((_, i) => (
                    <div key={i} className="h-48 bg-gray-100 animate-pulse rounded-xl" />
                  ))
                ) : filteredServices.map((service: any) => (
                  <Card key={service.id} className="overflow-hidden group hover:shadow-md transition-all border-gray-200">
                    <div className="h-24 bg-gray-100 relative overflow-hidden">
                      {service.bannerImage ? (
                        <img src={service.bannerImage} alt={service.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                          <ImageIcon className="w-8 h-8" />
                        </div>
                      )}
                      <div className="absolute top-2 right-2">
                        <Badge variant={service.isActive ? "default" : "secondary"} className={service.isActive ? "bg-green-500/10 text-green-600 border-green-200" : ""}>
                          {service.isActive ? "Active" : "Archived"}
                        </Badge>
                      </div>
                    </div>
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h3 className="font-semibold text-gray-900 leading-tight">{service.name}</h3>
                          <p className="text-xs text-gray-500 mt-0.5">{service.categoryName}</p>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-gray-400 hover:text-blue-600"
                          onClick={() => { setEditingService(service); setIsServiceModalOpen(true); }}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-2 min-h-[40px]">{service.subtitle || "No description provided."}</p>
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                        <div className="flex gap-2">
                          {service.isHomeVisible && <Badge variant="outline" className="text-[10px] uppercase font-bold text-blue-600 border-blue-100 bg-blue-50/50">Home</Badge>}
                          <Badge variant="outline" className="text-[10px] uppercase font-bold text-gray-500">{service.status}</Badge>
                        </div>
                        <span className="text-[10px] text-gray-400">Order: {service.sortOrder}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Category Modal */}
      <Dialog open={isCategoryModalOpen} onOpenChange={setIsCategoryModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleCategorySubmit}>
            <DialogHeader>
              <DialogTitle>{editingCategory ? "Edit Category" : "Add New Category"}</DialogTitle>
              <CardDescription>Categories group your services. Use icons from Lucide library.</CardDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="cat-name">Category Name</Label>
                <Input id="cat-name" name="name" defaultValue={editingCategory?.name} required placeholder="e.g., Electronics" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cat-icon">Icon Name (Lucide)</Label>
                <Input id="cat-icon" name="icon" defaultValue={editingCategory?.icon} placeholder="e.g., monitor" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cat-sort">Sort Order</Label>
                <Input id="cat-sort" name="sortOrder" type="number" defaultValue={editingCategory?.sortOrder || 0} />
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="cat-active" name="isActive" defaultChecked={editingCategory ? editingCategory.isActive : true} />
                <Label htmlFor="cat-active">Active (Visible to users)</Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending}>
                {editingCategory ? "Update Category" : "Create Category"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Service Modal */}
      <Dialog open={isServiceModalOpen} onOpenChange={setIsServiceModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleServiceSubmit}>
            <DialogHeader>
              <DialogTitle>{editingService ? "Edit Service" : "Add New Service"}</DialogTitle>
              <CardDescription>Configure service details and discovery settings.</CardDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto px-1">
              <div className="grid gap-2">
                <Label htmlFor="svc-cat">Category</Label>
                <Select name="categoryId" defaultValue={editingService?.categoryId?.toString() || (selectedCategoryId !== 'all' ? selectedCategoryId.toString() : categories[0]?.id?.toString())}>
                  <SelectTrigger id="svc-cat">
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat: any) => (
                      <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="svc-name">Service Name</Label>
                <Input id="svc-name" name="name" defaultValue={editingService?.name} required placeholder="e.g., Laptop Repair" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="svc-sub">Subtitle / Description</Label>
                <Input id="svc-sub" name="subtitle" defaultValue={editingService?.subtitle} placeholder="Short summary of the service" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="svc-icon">Icon (Lucide)</Label>
                  <Input id="svc-icon" name="icon" defaultValue={editingService?.icon} placeholder="e.g., laptop" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="svc-status">Initial Status</Label>
                  <Select name="status" defaultValue={editingService?.status || "ACTIVE"}>
                    <SelectTrigger id="svc-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                      <SelectItem value="COMING_SOON">COMING SOON</SelectItem>
                      <SelectItem value="MAINTENANCE">MAINTENANCE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="svc-banner">Banner Image URL</Label>
                <Input id="svc-banner" name="bannerImage" defaultValue={editingService?.bannerImage} placeholder="https://..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="svc-sort">Sort Order</Label>
                  <Input id="svc-sort" name="sortOrder" type="number" defaultValue={editingService?.sortOrder || 0} />
                </div>
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Switch id="svc-home" name="isHomeVisible" defaultChecked={editingService ? editingService.isHomeVisible : true} />
                <Label htmlFor="svc-home">Show on Homepage</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="svc-active" name="isActive" defaultChecked={editingService ? editingService.isActive : true} />
                <Label htmlFor="svc-active">Active / Enabled</Label>
              </div>
            </div>
            <DialogFooter className="mt-4 pt-4 border-t">
              <Button type="submit" disabled={createServiceMutation.isPending || updateServiceMutation.isPending}>
                {editingService ? "Update Service" : "Create Service"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
