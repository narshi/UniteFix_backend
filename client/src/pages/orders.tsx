import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function OrdersPage() {
  const { data: orders, isLoading } = useQuery({
    queryKey: ["/api/admin/orders/recent", { limit: 50 }],
  });

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
    <div className="min-h-screen flex bg-gray-50">
      <div className="flex-1 p-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Product Orders</h2>
          <p className="text-gray-600">Monitor and manage all product orders</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Product Orders</CardTitle>
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
                      <th className="text-left py-3 px-4">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders?.map((order: any) => (
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
    </div>
  );
}