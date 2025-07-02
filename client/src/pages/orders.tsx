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
      'placed': { color: 'bg-gray-100 text-gray-800', text: 'Order Placed' },
      'confirmed': { color: 'bg-blue-100 text-blue-800', text: 'Confirmed' },
      'in_transit': { color: 'bg-yellow-100 text-yellow-800', text: 'In Transit' },
      'out_for_delivery': { color: 'bg-orange-100 text-orange-800', text: 'Out for Delivery' },
      'delivered': { color: 'bg-green-100 text-green-800', text: 'Delivered' },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || { 
      color: 'bg-gray-100 text-gray-800', 
      text: status 
    };
    
    return (
      <span className={`px-3 py-1 ${config.color} text-xs font-medium rounded-full`}>
        {config.text}
      </span>
    );
  };

  return (
      <div className="flex-1 p-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Product Orders</h2>
          <p className="text-gray-600">Monitor and manage all product orders</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>All Product Orders</CardTitle>
              <div className="flex space-x-3">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search orders..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-64 pl-8"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-48">
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Filter by status" />
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
                  <SelectTrigger className="w-48">
                    <Package className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Filter by category" />
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
                      <th className="text-left py-3 px-4">Order ID</th>
                      <th className="text-left py-3 px-4">Customer</th>
                      <th className="text-left py-3 px-4">Products</th>
                      <th className="text-left py-3 px-4">Address</th>
                      <th className="text-left py-3 px-4">Status</th>
                      <th className="text-left py-3 px-4">Amount</th>
                      <th className="text-left py-3 px-4">Download Invoice</th>
                      <th className="text-left py-3 px-4">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders?.map((order: any) => (
                      <tr key={order.id} className="border-b border-gray-100">
                        <td className="py-3 px-4">
                          <p className="font-medium text-gray-900">{order.orderId}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-gray-900">{order.user?.username}</p>
                          <p className="text-sm text-gray-600">{order.user?.phone}</p>
                        </td>
                        <td className="py-3 px-4">
                          <div className="space-y-1">
                            {Array.isArray(order.products) ? order.products.map((product: any, idx: number) => (
                              <p key={idx} className="text-sm text-gray-600">
                                {product.quantity}x Product #{product.productId}
                              </p>
                            )) : (
                              <p className="text-sm text-gray-600">Multiple items</p>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-sm text-gray-600">{order.address}</p>
                        </td>
                        <td className="py-3 px-4">
                          {getStatusBadge(order.status)}
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-gray-900">₹{order.totalAmount.toLocaleString()}</p>
                        </td>
                        <td className="py-3 px-4">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadOrderInvoice(order)}
                            className="flex items-center gap-2"
                          >
                            <Download className="h-4 w-4" />
                            PDF
                          </Button>
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-sm text-gray-600">
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