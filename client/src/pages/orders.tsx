import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Search, Download, Filter, Package } from "lucide-react";
import { TableEmptyState, TableErrorState } from "@/components/admin/table-states";
import {
  useTableQuery, DataToolbar, DataPagination, SortableHeader,
  useRowSelection, BulkActionBar, SelectAllCheckbox, RowCheckbox,
  exportCsv, timestampedName,
} from "@/components/admin/table";
import { useToast } from "@/hooks/use-toast";

export default function OrdersPage() {
  const { toast } = useToast();
  const query = useTableQuery("/api/admin/orders", {
    defaultSort: "createdAt",
    initialFilters: { status: "all" },
  });
  const selection = useRowSelection<any>();
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  // Product categories
  const productCategories = [
    'AC', 'Laptop', 'Water Heater', 'Refrigerator', 'Washing Machine', 
    'Microwave', 'Television', 'Mobile Phone', 'Tablet', 'Other'
  ];
  
  const { data: response, isLoading, isError, refetch } = useQuery<any>({
    queryKey: [query.key],
  });

  // Searching, filtering, sorting and paging all happen server-side now.
  const orders = response?.data ?? [];
  const pagination = response?.pagination;
  const filteredOrders = orders;

  const handleExport = () => {
    exportCsv(timestampedName("product-orders"), selection.rows, [
      { header: "Order ID", value: (o: any) => o.orderId },
      { header: "Status", value: (o: any) => o.status },
      { header: "Total", value: (o: any) => o.totalAmount },
      { header: "Address", value: (o: any) => o.address },
      { header: "Date", value: (o: any) => (o.createdAt ? new Date(o.createdAt).toLocaleString() : "") },
    ]);
    toast({ title: `Exported ${selection.count} order(s)` });
  };



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
      <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden bg-transparent">
        <div className="mb-8 relative z-10 stagger-enter">
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)] mb-2">Product Orders</h2>
          <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide">Monitor and manage all product orders</p>
        </div>

        <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
          <CardHeader className="flex flex-col gap-4 pb-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">
              All Product Orders{pagination?.total ? <span className="text-[hsl(215,20%,55%)] text-sm font-normal ml-2">({pagination.total})</span> : null}
            </CardTitle>
            <DataToolbar
              query={query}
              searchPlaceholder="Order ID, customer, phone, address…"
              filters={[{
                key: "status",
                label: "All Status",
                options: [
                  { value: "placed", label: "Placed" },
                  { value: "confirmed", label: "Confirmed" },
                  { value: "shipped", label: "Shipped" },
                  { value: "in_transit", label: "In Transit" },
                  { value: "out_for_delivery", label: "Out for Delivery" },
                  { value: "delivered", label: "Delivered" },
                  { value: "cancelled", label: "Cancelled" },
                  { value: "refunded", label: "Refunded" },
                ],
              }]}
            />
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
              <>
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full glass-table">
                  <thead>
                    <tr className="text-left border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                      <th className="p-4 w-10">
                        <SelectAllCheckbox state={selection.pageState(filteredOrders)} onToggle={() => selection.togglePage(filteredOrders)} />
                      </th>
                      <SortableHeader query={query} field="orderId">Order ID</SortableHeader>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Customer</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Products</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Address</th>
                      <SortableHeader query={query} field="status">Status</SortableHeader>
                      <SortableHeader query={query} field="totalAmount">Amount</SortableHeader>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Download Invoice</th>
                      <SortableHeader query={query} field="createdAt">Date</SortableHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {isError && <TableErrorState colSpan={9} onRetry={() => refetch()} message="Could not load orders." />}
                    {!isError && filteredOrders.length === 0 && (
                      <TableEmptyState colSpan={9} icon="shopping_cart" title={orders.length === 0 ? "No product orders yet" : "No matching orders"} description={orders.length === 0 ? "Product ordering is currently paused in the mobile app." : "Try a different search term or filter."} />
                    )}
                    {!isError && filteredOrders?.map((order: any) => (
                      <tr key={order.id} className={"border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)] group " + (selection.isSelected(order.id) ? "bg-[hsla(217,91%,60%,0.06)]" : "")}>
                        <td className="p-4">
                          <RowCheckbox checked={selection.isSelected(order.id)} onToggle={() => selection.toggle(order)} />
                        </td>
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
              <DataPagination query={query} pagination={pagination} rowCount={filteredOrders.length} />
              </>
            )}
          </CardContent>
        </Card>

        <BulkActionBar
          count={selection.count}
          onClear={selection.clear}
          noun="order"
          actions={[
            { label: "Export CSV", icon: <Download className="w-3.5 h-3.5" />, onClick: handleExport },
          ]}
        />
      </div>
  );
}