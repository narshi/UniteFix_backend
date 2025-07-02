import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";

export default function ServicesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedService, setSelectedService] = useState<any>(null);
  
  const { data: services = [], isLoading } = useQuery({
    queryKey: ["/api/admin/services"],
    select: (data) => Array.isArray(data) ? data : []
  });

  // Filter services based on search term
  const filteredServices = Array.isArray(services) ? services.filter((service: any) => 
    service.serviceType?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    service.serviceId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    service.brand?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    service.model?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    service.status?.toLowerCase().includes(searchTerm.toLowerCase())
  ) : [];

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
            <div className="flex justify-between items-center">
              <CardTitle>All Service Requests</CardTitle>
              <div className="flex space-x-2">
                <Input
                  placeholder="Search by service ID, type, brand..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-64"
                />
                <Button variant="outline">Download Invoice</Button>
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
                      <th className="text-left py-3 px-4">Service ID</th>
                      <th className="text-left py-3 px-4">Service Type</th>
                      <th className="text-left py-3 px-4">Customer</th>
                      <th className="text-left py-3 px-4">Brand/Model</th>
                      <th className="text-left py-3 px-4">Assigned Partner</th>
                      <th className="text-left py-3 px-4">Status</th>
                      <th className="text-left py-3 px-4">Amount</th>
                      <th className="text-left py-3 px-4">Created</th>
                      <th className="text-left py-3 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredServices.map((service: any) => (
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
                          {service.partner ? (
                            <div>
                              <p className="font-medium text-gray-900">{service.partner.username}</p>
                              <p className="text-sm text-gray-600">{service.partner.phone}</p>
                              <Badge variant="secondary" className="text-xs mt-1">
                                BU{String(service.partner.id).padStart(5, '0')}
                              </Badge>
                            </div>
                          ) : (
                            <Badge variant="outline">Not Assigned</Badge>
                          )}
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
                        <td className="py-3 px-4">
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedService(service)}
                            >
                              View Details
                            </Button>
                            {service.status === 'service_completed' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.open(`/api/invoices/generate/${service.serviceId}`, '_blank')}
                              >
                                Invoice
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Service Details Modal */}
        <Dialog open={!!selectedService} onOpenChange={() => setSelectedService(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Service Request Details</DialogTitle>
            </DialogHeader>
            {selectedService && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Service ID</p>
                    <p className="text-lg font-semibold">{selectedService.serviceId}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Status</p>
                    <div className="mt-1">{getStatusBadge(selectedService.status)}</div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Service Type</p>
                    <p className="text-base">{selectedService.serviceType}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Verification Code</p>
                    <p className="text-base font-mono">{selectedService.verificationCode || 'N/A'}</p>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-medium text-gray-900 mb-3">Customer Information</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Name</p>
                      <p className="text-base">{selectedService.user?.username}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">Phone</p>
                      <p className="text-base">{selectedService.user?.phone}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-sm font-medium text-gray-600">Address</p>
                      <p className="text-base">{selectedService.address}</p>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-medium text-gray-900 mb-3">Device Information</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Brand</p>
                      <p className="text-base">{selectedService.brand}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">Model</p>
                      <p className="text-base">{selectedService.model}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-sm font-medium text-gray-600">Description</p>
                      <p className="text-base">{selectedService.description}</p>
                    </div>
                  </div>
                </div>

                {selectedService.partner && (
                  <div className="border-t pt-4">
                    <h4 className="font-medium text-gray-900 mb-3">Assigned Partner</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Partner Name</p>
                        <p className="text-base">{selectedService.partner.username}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-600">Partner ID</p>
                        <p className="text-base">BU{String(selectedService.partner.id).padStart(5, '0')}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-600">Contact</p>
                        <p className="text-base">{selectedService.partner.phone}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-600">Email</p>
                        <p className="text-base">{selectedService.partner.email}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="border-t pt-4">
                  <h4 className="font-medium text-gray-900 mb-3">Payment Information</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Booking Fee</p>
                      <p className="text-base">₹{selectedService.bookingFee || 250}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">Total Amount</p>
                      <p className="text-base">₹{selectedService.totalAmount || 'Pending'}</p>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Created</p>
                      <p className="text-base">{new Date(selectedService.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">Last Updated</p>
                      <p className="text-base">{new Date(selectedService.updatedAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
  );
}