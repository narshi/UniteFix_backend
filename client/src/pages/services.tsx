import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Search, Download, Filter } from "lucide-react";

export default function ServicesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedService, setSelectedService] = useState<any>(null);
  
  const { data: services = [], isLoading } = useQuery({
    queryKey: ["/api/admin/services"],
    select: (data: any) => {
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.services)) return data.services;
      return [];
    }
  });

  // Filter services based on search term and status
  const filteredServices = Array.isArray(services) ? services.filter((service: any) => {
    const matchesSearch = searchTerm === '' || (
      service.serviceType?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      service.id?.toString().includes(searchTerm) ||
      service.brand?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      service.model?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      service.status?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    const matchesStatus = statusFilter === 'all' || service.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  }) : [];
  
  // Function to download individual service invoice
  const downloadServiceInvoice = (service: any) => {
    // Create PDF content
    const invoiceContent = `
      UniteFix Service Invoice
      =====================
      
      Service ID: ${service.id}
      Service Type: ${service.serviceType}
      Brand: ${service.brand}
      Model: ${service.model}
      Issue Description: ${service.issueDescription}
      
      Status: ${service.status}
      Booking Fee: ₹${service.bookingFee || 200}
      Service Charge: ₹${service.serviceCharge || 500}
      Total Amount: ₹${(service.bookingFee || 200) + (service.serviceCharge || 500)}
      
      Customer Details:
      Phone: ${service.customerPhone || 'N/A'}
      Address: ${service.address || 'N/A'}
      
      Generated on: ${new Date().toLocaleDateString()}
    `;
    
    // Create and download file
    const blob = new Blob([invoiceContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `service-invoice-${service.id}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'created': { color: 'bg-gray-100 text-gray-800', text: 'Created' },
      'assigned': { color: 'bg-blue-100 text-blue-800', text: 'Assigned' },
      'accepted': { color: 'bg-purple-100 text-purple-800', text: 'Accepted' },
      'reached': { color: 'bg-yellow-100 text-yellow-800', text: 'Reached' },
      'in_progress': { color: 'bg-orange-100 text-orange-800', text: 'In Progress' },
      'pending_payment': { color: 'bg-pink-100 text-pink-800', text: 'Payment Due' },
      'completed': { color: 'bg-green-100 text-green-800', text: 'Completed' },
      'cancelled': { color: 'bg-red-100 text-red-800', text: 'Cancelled' },
      'disputed': { color: 'bg-red-800 text-white', text: 'Disputed' },
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
              <div className="flex space-x-3">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search services..."
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
                    <SelectItem value="created">Created</SelectItem>
                    <SelectItem value="assigned">Assigned</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="reached">Reached</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="pending_payment">Payment Due</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="disputed">Disputed</SelectItem>
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
                      <th className="text-left py-3 px-4">Service ID</th>
                      <th className="text-left py-3 px-4">Service Type</th>
                      <th className="text-left py-3 px-4">Customer</th>
                      <th className="text-left py-3 px-4">Brand/Model</th>
                      <th className="text-left py-3 px-4">Assigned Employee</th>
                      <th className="text-left py-3 px-4">Status</th>
                      <th className="text-left py-3 px-4">Amount</th>
                      <th className="text-left py-3 px-4">Download Invoice</th>
                      <th className="text-left py-3 px-4">Created</th>
                      <th className="text-left py-3 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredServices.map((service: any) => (
                      <tr key={service.id} className="border-b border-gray-100">
                        <td className="py-3 px-4">
                          <p className="font-medium text-gray-900">{service.id}</p>
                          <p className="text-sm text-gray-600">{service.verificationCode}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-gray-900">{service.serviceType}</p>
                          <p className="text-sm text-gray-600">{service.description}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-gray-900">{service.user?.username || service.customerName}</p>
                          <p className="text-sm text-gray-600">{service.user?.phone || service.customerPhone}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-sm text-gray-900">{service.brand}</p>
                          <p className="text-sm text-gray-600">{service.model}</p>
                        </td>
                        <td className="py-3 px-4">
                          {service.partner || service.technicianName ? (
                            <div>
                              <p className="font-medium text-gray-900">{service.partner?.username || service.technicianName}</p>
                              <p className="text-sm text-gray-600">{service.partner?.phone}</p>
                              <Badge variant="secondary" className="text-xs mt-1">
                                BU{String(service.partner?.id || service.providerId || '').padStart(5, '0')}
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadServiceInvoice(service)}
                            className="flex items-center gap-2"
                          >
                            <Download className="h-4 w-4" />
                            PDF
                          </Button>
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
                              {service.status === 'completed' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.open(`/api/invoices/generate/${service.id}`, '_blank')}
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
                    <p className="text-lg font-semibold">{selectedService.id}</p>
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
                      <p className="text-base">{selectedService.user?.username || selectedService.customerName}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">Phone</p>
                      <p className="text-base">{selectedService.user?.phone || selectedService.customerPhone}</p>
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

                {(selectedService.partner || selectedService.technicianName) && (
                  <div className="border-t pt-4">
                    <h4 className="font-medium text-gray-900 mb-3">Assigned Employee</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Employee Name</p>
                        <p className="text-base">{selectedService.partner?.username || selectedService.technicianName}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-600">Employee ID</p>
                        <p className="text-base">BU{String(selectedService.partner?.id || selectedService.providerId || '').padStart(5, '0')}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-600">Contact</p>
                        <p className="text-base">{selectedService.partner?.phone || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-600">Email</p>
                        <p className="text-base">{selectedService.partner?.email || 'N/A'}</p>
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