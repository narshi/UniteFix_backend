import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ServicesPage() {
  const { data: services, isLoading } = useQuery({
    queryKey: ["/api/admin/services/recent", { limit: 50 }],
  });

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'placed': { color: 'bg-gray-100 text-gray-800', text: 'Placed' },
      'confirmed': { color: 'bg-blue-100 text-blue-800', text: 'Confirmed' },
      'partner_assigned': { color: 'bg-yellow-100 text-yellow-800', text: 'Partner Assigned' },
      'service_started': { color: 'bg-green-100 text-green-800', text: 'Service Started' },
      'service_completed': { color: 'bg-green-100 text-green-800', text: 'Completed' },
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
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Service Requests</h2>
          <p className="text-gray-600">Monitor and manage all service requests</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Service Requests</CardTitle>
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
                      <th className="text-left py-3 px-4">Service ID</th>
                      <th className="text-left py-3 px-4">Service Type</th>
                      <th className="text-left py-3 px-4">Customer</th>
                      <th className="text-left py-3 px-4">Brand/Model</th>
                      <th className="text-left py-3 px-4">Status</th>
                      <th className="text-left py-3 px-4">Amount</th>
                      <th className="text-left py-3 px-4">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services?.map((service: any) => (
                      <tr key={service.id} className="border-b border-gray-100">
                        <td className="py-3 px-4">
                          <p className="font-medium text-gray-900">{service.serviceId}</p>
                          <p className="text-sm text-gray-600">{service.verificationCode}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-gray-900">{service.serviceType}</p>
                          <p className="text-sm text-gray-600">{service.description}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-gray-900">{service.user?.username}</p>
                          <p className="text-sm text-gray-600">{service.user?.phone}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-sm text-gray-900">{service.brand}</p>
                          <p className="text-sm text-gray-600">{service.model}</p>
                        </td>
                        <td className="py-3 px-4">
                          {getStatusBadge(service.status)}
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-gray-900">₹{service.totalAmount || service.bookingFee}</p>
                          {service.totalAmount && (
                            <p className="text-sm text-gray-600">Booking: ₹{service.bookingFee}</p>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-sm text-gray-600">
                            {new Date(service.createdAt).toLocaleDateString()}
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