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
    <div className="flex-1 p-8 min-h-screen relative overflow-hidden">
      <div className="flex justify-between items-start mb-8 relative z-10 stagger-enter">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]">Service Catalog</h2>
          <p className="text-[hsl(215,20%,65%)] mt-1 font-medium tracking-wide">Manage categories, services, and their visibility on the platform.</p>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => { setEditingCategory(null); setIsCategoryModalOpen(true); }} variant="outline" className="flex items-center gap-2 border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.05)] text-[hsl(210,20%,85%)] shadow-sm transition-all active:scale-[0.97]">
            <Plus className="w-4 h-4" /> Add Category
          </Button>
          <Button onClick={() => { setEditingService(null); setIsServiceModalOpen(true); }} className="flex items-center gap-2 bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_14px_hsla(217,91%,60%,0.3)] hover:shadow-[0_6px_20px_hsla(217,91%,60%,0.4)] transition-all active:scale-[0.97]">
            <Plus className="w-4 h-4" /> Add Service
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 relative z-10 stagger-enter">
        <Card className="md:col-span-1 glass-card border-[rgba(255,255,255,0.08)] overflow-hidden">
          <CardHeader className="pb-3 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)]">
            <CardTitle className="text-lg flex items-center gap-2 text-white">
              <div className="p-1.5 rounded-md bg-[hsla(217,91%,60%,0.15)] border border-[hsla(217,91%,60%,0.3)]">
                <Grid className="w-4 h-4 text-[hsl(217,91%,65%)]" /> 
              </div>
              Categories
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-3">
            <Button 
              variant={selectedCategoryId === 'all' ? "secondary" : "ghost"} 
              className={`w-full justify-start text-sm font-medium transition-all ${selectedCategoryId === 'all' ? 'bg-[rgba(255,255,255,0.08)] text-white shadow-sm' : 'text-[hsl(210,20%,80%)] hover:bg-[rgba(255,255,255,0.04)] hover:text-white'}`}
              onClick={() => setSelectedCategoryId('all')}
            >
              All Categories
            </Button>
            {categories.map((cat: any) => (
              <div key={cat.id} className="flex items-center group relative">
                <Button 
                  variant={selectedCategoryId === cat.id ? "secondary" : "ghost"} 
                  className={`flex-1 justify-start text-sm truncate transition-all ${selectedCategoryId === cat.id ? 'bg-[rgba(255,255,255,0.08)] text-white shadow-sm' : 'text-[hsl(210,20%,80%)] hover:bg-[rgba(255,255,255,0.04)] hover:text-white'}`}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  title={cat.name}
                >
                  {cat.icon && cat.icon.startsWith('http') ? (
                    <img src={cat.icon} alt={cat.name} className="w-5 h-5 mr-2 rounded-md object-cover shadow-sm" referrerPolicy="no-referrer" />
                  ) : null}
                  {cat.name}
                </Button>
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity absolute right-1">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7 bg-[rgba(0,0,0,0.4)] backdrop-blur-md border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.1)] mr-1"
                    onClick={() => { setEditingCategory(cat); setIsCategoryModalOpen(true); }}
                  >
                    <Edit className="w-3 h-3 text-[hsl(215,20%,75%)] hover:text-white" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7 bg-[rgba(0,0,0,0.4)] backdrop-blur-md border border-[rgba(255,255,255,0.1)] hover:bg-[hsla(347,77%,50%,0.2)]"
                    onClick={() => {
                      if (window.confirm("Are you sure you want to delete this category? This will also delete all services inside it.")) {
                        deleteCategoryMutation.mutate(cat.id);
                      }
                    }}
                    disabled={deleteCategoryMutation.isPending}
                  >
                    <Trash2 className="w-3 h-3 text-[hsl(215,20%,75%)] hover:text-[hsl(347,77%,60%)]" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="md:col-span-3 space-y-6">
          <Card className="glass-card border-[rgba(255,255,255,0.08)]">
            <CardHeader className="pb-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
              <div className="flex justify-between items-center">
                <div className="space-y-1">
                  <CardTitle className="text-xl text-white">Services</CardTitle>
                  <CardDescription className="text-[hsl(215,20%,55%)] font-medium">Total <span className="text-[hsl(217,91%,65%)]">{filteredServices.length}</span> services found</CardDescription>
                </div>
                <div className="relative w-64">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-[hsl(215,20%,50%)]" />
                  <Input
                    placeholder="Search services..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[hsl(215,20%,40%)] focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {isLoading ? (
                  Array(6).fill(0).map((_, i) => (
                    <div key={i} className="h-48 skeleton-shimmer rounded-xl" />
                  ))
                ) : filteredServices.map((service: any) => (
                  <Card key={service.id} className="overflow-hidden group hover:-translate-y-1 transition-all duration-300 bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.15)] shadow-none hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
                    <div className="h-28 bg-[rgba(0,0,0,0.2)] relative overflow-hidden group-hover:after:absolute group-hover:after:inset-0 group-hover:after:bg-white/5">
                      {service.bannerImage ? (
                        <img src={service.bannerImage} alt={service.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[hsl(215,20%,40%)]">
                          <ImageIcon className="w-8 h-8 opacity-50" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
                      <div className="absolute top-2 right-2">
                        <Badge variant={service.isActive ? "default" : "secondary"} className={service.isActive ? "bg-[hsla(160,84%,39%,0.8)] text-white border-transparent backdrop-blur-md shadow-sm" : "bg-[hsla(215,20%,20%,0.8)] text-[hsl(215,20%,70%)] border-[rgba(255,255,255,0.1)] backdrop-blur-md"}>
                          {service.isActive ? "Active" : "Archived"}
                        </Badge>
                      </div>
                    </div>
                    <CardContent className="p-4 relative">
                      <div className="flex justify-between items-start mb-2">
                        <div className="min-w-0 pr-2">
                          <h3 className="font-semibold text-white leading-tight truncate">{service.name}</h3>
                          <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5 truncate">{service.categoryName}</p>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-[hsl(215,20%,60%)] hover:text-[hsl(217,91%,65%)] hover:bg-[rgba(255,255,255,0.05)] shrink-0 transition-colors"
                          onClick={() => { setEditingService(service); setIsServiceModalOpen(true); }}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      </div>
                      <p className="text-sm text-[hsl(210,20%,75%)] line-clamp-2 min-h-[40px] leading-relaxed">{service.subtitle || "No description provided."}</p>
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)]">
                        <div className="flex gap-2">
                          {service.isHomeVisible && <Badge variant="outline" className="text-[10px] uppercase font-bold text-[hsl(217,91%,65%)] border-[hsla(217,91%,60%,0.3)] bg-[hsla(217,91%,60%,0.1)]">Home</Badge>}
                          <Badge variant="outline" className="text-[10px] uppercase font-bold text-[hsl(215,20%,65%)] border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)]">{service.status}</Badge>
                        </div>
                        <span className="text-[10px] font-medium text-[hsl(215,20%,50%)] uppercase tracking-wider">Order: {service.sortOrder}</span>
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
        <DialogContent className="sm:max-w-[425px] glass-panel border-[rgba(255,255,255,0.1)] overflow-y-auto max-h-[85vh] custom-scrollbar">
          <form onSubmit={handleCategorySubmit}>
            <DialogHeader>
              <DialogTitle className="text-xl text-white">{editingCategory ? "Edit Category" : "Add New Category"}</DialogTitle>
              <CardDescription className="text-[hsl(215,20%,65%)]">Categories group your services. Use icons from Lucide library.</CardDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="cat-name" className="text-[hsl(215,20%,75%)]">Category Name</Label>
                <Input id="cat-name" name="name" defaultValue={editingCategory?.name} required placeholder="e.g., Electronics" className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cat-icon" className="text-[hsl(215,20%,75%)]">Icon Name (Lucide)</Label>
                <Input id="cat-icon" name="icon" defaultValue={editingCategory?.icon} placeholder="e.g., monitor" className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cat-sort" className="text-[hsl(215,20%,75%)]">Sort Order</Label>
                <Input id="cat-sort" name="sortOrder" type="number" defaultValue={editingCategory?.sortOrder || 0} className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Switch id="cat-active" name="isActive" defaultChecked={editingCategory ? editingCategory.isActive : true} className="data-[state=checked]:bg-[hsl(217,91%,60%)]" />
                <Label htmlFor="cat-active" className="text-[hsl(215,20%,75%)]">Active (Visible to users)</Label>
              </div>
            </div>
            <DialogFooter className="mt-2 pt-4 border-t border-[rgba(255,255,255,0.06)]">
              <Button type="button" variant="outline" onClick={() => setIsCategoryModalOpen(false)} className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.08)]">Cancel</Button>
              <Button type="submit" disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending} className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_15px_hsla(217,91%,60%,0.4)] transition-all active:scale-95">
                {editingCategory ? "Update Category" : "Create Category"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Service Modal */}
      <Dialog open={isServiceModalOpen} onOpenChange={setIsServiceModalOpen}>
        <DialogContent className="sm:max-w-[500px] glass-panel border-[rgba(255,255,255,0.1)] overflow-y-auto max-h-[85vh] custom-scrollbar">
          <form onSubmit={handleServiceSubmit}>
            <DialogHeader>
              <DialogTitle className="text-xl text-white">{editingService ? "Edit Service" : "Add New Service"}</DialogTitle>
              <CardDescription className="text-[hsl(215,20%,65%)]">Configure service details and discovery settings.</CardDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4 px-1">
              <div className="grid gap-2">
                <Label htmlFor="svc-cat" className="text-[hsl(215,20%,75%)]">Category</Label>
                <Select name="categoryId" defaultValue={editingService?.categoryId?.toString() || (selectedCategoryId !== 'all' ? selectedCategoryId.toString() : categories[0]?.id?.toString())}>
                  <SelectTrigger id="svc-cat" className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:ring-[hsla(217,91%,60%,0.3)]">
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent className="glass-panel border-[rgba(255,255,255,0.1)]">
                    {categories.map((cat: any) => (
                      <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="svc-name" className="text-[hsl(215,20%,75%)]">Service Name</Label>
                <Input id="svc-name" name="name" defaultValue={editingService?.name} required placeholder="e.g., Laptop Repair" className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="svc-sub" className="text-[hsl(215,20%,75%)]">Subtitle / Description</Label>
                <Input id="svc-sub" name="subtitle" defaultValue={editingService?.subtitle} placeholder="Short summary of the service" className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="svc-icon" className="text-[hsl(215,20%,75%)]">Icon (Lucide)</Label>
                  <Input id="svc-icon" name="icon" defaultValue={editingService?.icon} placeholder="e.g., laptop" className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="svc-status" className="text-[hsl(215,20%,75%)]">Initial Status</Label>
                  <Select name="status" defaultValue={editingService?.status || "ACTIVE"}>
                    <SelectTrigger id="svc-status" className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:ring-[hsla(217,91%,60%,0.3)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="glass-panel border-[rgba(255,255,255,0.1)]">
                      <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                      <SelectItem value="COMING_SOON">COMING SOON</SelectItem>
                      <SelectItem value="MAINTENANCE">MAINTENANCE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="svc-banner" className="text-[hsl(215,20%,75%)]">Banner Image URL</Label>
                <Input id="svc-banner" name="bannerImage" defaultValue={editingService?.bannerImage} placeholder="https://..." className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="svc-sort" className="text-[hsl(215,20%,75%)]">Sort Order</Label>
                  <Input id="svc-sort" name="sortOrder" type="number" defaultValue={editingService?.sortOrder || 0} className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all" />
                </div>
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Switch id="svc-home" name="isHomeVisible" defaultChecked={editingService ? editingService.isHomeVisible : true} className="data-[state=checked]:bg-[hsl(217,91%,60%)]" />
                <Label htmlFor="svc-home" className="text-[hsl(215,20%,75%)]">Show on Homepage</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="svc-active" name="isActive" defaultChecked={editingService ? editingService.isActive : true} className="data-[state=checked]:bg-[hsl(217,91%,60%)]" />
                <Label htmlFor="svc-active" className="text-[hsl(215,20%,75%)]">Active / Enabled</Label>
              </div>
            </div>
            <DialogFooter className="mt-2 pt-4 border-t border-[rgba(255,255,255,0.06)]">
              <Button type="button" variant="outline" onClick={() => setIsServiceModalOpen(false)} className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.08)]">Cancel</Button>
              <Button type="submit" disabled={createServiceMutation.isPending || updateServiceMutation.isPending} className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_15px_hsla(217,91%,60%,0.4)] transition-all active:scale-95">
                {editingService ? "Update Service" : "Create Service"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
