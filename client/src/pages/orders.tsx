import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Search, Download, Filter, Package } from "lucide-react";

export default function OrdersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  // Product categories
  const productCategories = [
    'AC', 'Laptop', 'Water Heater', 'Refrigerator', 'Washing Machine', 
    'Microwave', 'Television', 'Mobile Phone', 'Tablet', 'Other'
  ];
  
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["/api/admin/orders"],
    select: (data) => Array.isArray(data) ? data : []
  });

  // Filter orders based on search term, status, and category
  const filteredOrders = orders.filter((order: any) => {
    const matchesSearch = searchTerm === '' || (
      order.orderId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.user?.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.user?.phone?.includes(searchTerm) ||
      order.status?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.products?.some((product: any) => 
        product.name?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    );
    
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    
    const matchesCategory = categoryFilter === 'all' || 
      order.products?.some((product: any) => 
        product.category === categoryFilter || 
        product.name?.toLowerCase().includes(categoryFilter.toLowerCase())
      );
    
    return matchesSearch && matchesStatus && matchesCategory;
  });

  // Function to download individual order invoice
  const downloadOrderInvoice = (order: any) => {
    // Create PDF content
    const invoiceContent = `
      UniteFix Product Order Invoice
      ============================
      
      Order ID: ${order.orderId}
      Order Date: ${new Date(order.createdAt).toLocaleDateString()}
      
      Customer Details:
      Name: ${order.user?.username || 'N/A'}
      Phone: ${order.user?.phone || 'N/A'}
      Email: ${order.user?.email || 'N/A'}
      
      Products Ordered:
      ${order.products?.map((product: any) => `
      - ${product.name} (${product.category || 'Uncategorized'})
        Quantity: ${product.quantity}
        Price: ₹${product.price}
        Subtotal: ₹${product.quantity * product.price}
      `).join('') || 'No products listed'}
      
      Order Summary:
      Status: ${order.status}
      Total Amount: ₹${order.totalAmount}
      Payment Status: ${order.paymentStatus || 'Pending'}
      
      Delivery Address:
      ${order.deliveryAddress || 'N/A'}
      
      Generated on: ${new Date().toLocaleDateString()}
    `;
    
    // Create and download file
    const blob = new Blob([invoiceContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `order-invoice-${order.orderId}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'placed': { color: 'bg-[hsla(215,20%,50%,0.15)] text-[hsl(215,20%,70%)] border-[hsla(215,20%,50%,0.3)]', text: 'Order Placed' },
      'confirmed': { color: 'bg-[hsla(217,91%,60%,0.15)] text-[hsl(217,91%,70%)] border-[hsla(217,91%,60%,0.3)]', text: 'Confirmed' },
      'in_transit': { color: 'bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,60%)] border-[hsla(38,92%,50%,0.3)]', text: 'In Transit' },
      'out_for_delivery': { color: 'bg-[hsla(27,90%,55%,0.15)] text-[hsl(27,90%,65%)] border-[hsla(27,90%,55%,0.3)]', text: 'Out for Delivery' },
      'delivered': { color: 'bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)]', text: 'Delivered' },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || { 
      color: 'bg-[rgba(255,255,255,0.05)] text-[hsl(215,20%,65%)] border-[rgba(255,255,255,0.1)]', 
      text: status 
    };
    
    return (
      <span className={`px-3 py-1 ${config.color} border text-xs font-medium rounded-full shadow-sm backdrop-blur-sm`}>
        {config.text}
      </span>
    );
  };

  return (
      <div className="flex-1 p-8 min-h-screen relative overflow-hidden bg-transparent">
        <div className="mb-8 relative z-10 stagger-enter">
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)] mb-2">Product Orders</h2>
          <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide">Monitor and manage all product orders</p>
        </div>

        <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <div className="flex justify-between items-center w-full">
              <CardTitle className="text-xl text-white">All Product Orders</CardTitle>
              <div className="flex space-x-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[hsl(215,20%,50%)]" />
                  <Input
                    placeholder="Search orders..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-64 pl-9 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[hsl(215,20%,40%)] focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-48 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:ring-[hsla(217,91%,60%,0.3)]">
                    <div className="flex items-center">
                      <Filter className="mr-2 h-4 w-4 text-[hsl(215,20%,50%)]" />
                      <SelectValue placeholder="Filter by status" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="placed">Order Placed</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="in_transit">In Transit</SelectItem>
                    <SelectItem value="out_for_delivery">Out for Delivery</SelectItem>
                    <SelectItem value="delivered">Delivered</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-48 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:ring-[hsla(217,91%,60%,0.3)]">
                    <div className="flex items-center">
                      <Package className="mr-2 h-4 w-4 text-[hsl(215,20%,50%)]" />
                      <SelectValue placeholder="Filter by category" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {productCategories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
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
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Order ID</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Customer</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Products</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Address</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Status</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Amount</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Download Invoice</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders?.map((order: any) => (
                      <tr key={order.id} className="border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)] group">
                        <td className="p-4">
                          <p className="font-medium text-[hsl(210,20%,90%)]">{order.orderId}</p>
                        </td>
                        <td className="p-4">
                          <p className="font-medium text-[hsl(210,20%,90%)]">{order.user?.username}</p>
                          <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">{order.user?.phone}</p>
                        </td>
                        <td className="p-4">
                          <div className="space-y-1">
                            {Array.isArray(order.products) ? order.products.map((product: any, idx: number) => (
                              <p key={idx} className="text-xs text-[hsl(210,20%,85%)]">
                                {product.quantity}x Product #{product.productId}
                              </p>
                            )) : (
                              <p className="text-xs text-[hsl(215,20%,65%)]">Multiple items</p>
                            )}
                          </div>
                        </td>
                        <td className="p-4">
                          <p className="text-sm text-[hsl(215,20%,70%)] line-clamp-2 max-w-[200px]">{order.address}</p>
                        </td>
                        <td className="p-4">
                          {getStatusBadge(order.status)}
                        </td>
                        <td className="p-4">
                          <p className="font-medium text-[hsl(160,84%,65%)] font-mono">₹{order.totalAmount.toLocaleString()}</p>
                        </td>
                        <td className="p-4">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadOrderInvoice(order)}
                            className="flex items-center gap-1.5 h-8 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,80%)] hover:bg-[rgba(255,255,255,0.08)] hover:text-white transition-all"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span className="text-xs">PDF</span>
                          </Button>
                        </td>
                        <td className="p-4">
                          <p className="text-sm text-[hsl(215,20%,70%)]">
                            {new Date(order.createdAt).toLocaleDateString()}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}