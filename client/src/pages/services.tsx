import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Search, Download, Filter, RefreshCw } from "lucide-react";
import PartnerAssignmentModal from "@/components/admin/partner-assignment-modal";
import { TableEmptyState, TableErrorState } from "@/components/admin/table-states";
import { useToast } from "@/hooks/use-toast";
import {
  useTableQuery, DataToolbar, DataPagination, SortableHeader,
  useRowSelection, BulkActionBar, SelectAllCheckbox, RowCheckbox,
  exportCsv, timestampedName,
} from "@/components/admin/table";

export default function ServicesPage() {
  const { toast } = useToast();
  const query = useTableQuery("/api/admin/services", {
    defaultSort: "createdAt",
    initialFilters: { status: "all" },
  });
  const selection = useRowSelection<any>();
  const [selectedService, setSelectedService] = useState<any>(null);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  // Download the real tax-invoice PDF from the server (same document the customer
  // gets). window.open can't send the admin token, so fetch it as an authenticated
  // blob and save that — the old window.open hit a route that never existed.
  const downloadInvoicePdf = async (service: any) => {
    try {
      setDownloadingId(service.id);
      const adminToken = localStorage.getItem("adminToken");
      const res = await fetch(`/api/admin/services/${service.id}/invoice`, {
        headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : {},
      });
      if (!res.ok) {
        let msg = "Could not generate the invoice for this booking.";
        try { const j = await res.json(); msg = j.message || msg; } catch { /* non-JSON error body */ }
        toast({ title: "Invoice unavailable", description: msg, variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `UniteFix-Invoice-${service.serviceId || service.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Download failed", description: e?.message || "Network error", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };
  
  const { data: response, isLoading, isError, refetch } = useQuery<any>({
    queryKey: [query.key],
  });

  // Searching, filtering, sorting and paging all happen server-side now — the
  // page renders exactly the rows it was given.
  const services = response?.data ?? [];
  const pagination = response?.pagination;
  const filteredServices = services;

  const handleExport = () => {
    exportCsv(timestampedName("service-requests"), selection.rows, [
      { header: "Service ID", value: (s: any) => s.serviceId ?? s.id },
      { header: "Type", value: (s: any) => s.serviceType },
      { header: "Customer", value: (s: any) => s.customerName },
      { header: "Customer phone", value: (s: any) => s.customerPhone },
      { header: "Brand", value: (s: any) => s.brand },
      { header: "Model", value: (s: any) => s.model },
      { header: "Employee", value: (s: any) => s.technicianName },
      { header: "Status", value: (s: any) => s.status },
      { header: "Total", value: (s: any) => s.totalAmount },
      { header: "Address", value: (s: any) => s.address },
      { header: "Created", value: (s: any) => (s.createdAt ? new Date(s.createdAt).toLocaleString() : "") },
    ]);
    toast({ title: `Exported ${selection.count} service request(s)` });
  };
  
  // Function to download individual service invoice from FROZEN billing snapshot
  const downloadServiceInvoice = (service: any) => {
    // Read from the frozen pricing snapshot (written by BillingEngine on the backend)
    // Falls back to stored totalAmount/commissionAmount for legacy bookings
    const snapshot = service.pricingSnapshot;
    
    let bookingFee: number;
    let sparePartsCost: number;
    let serviceLaborCost: number;
    let subtotal: number;
    let platformFeePercent: number;
    let platformFee: number;
    let taxableAmount: number;
    let gstPercent: number;
    let cgst: number;
    let sgst: number;
    let grossTotal: number;
    let finalTotal: number;

    if (snapshot && snapshot.snapshotVersion && snapshot.grossTotal) {
      // Use exact frozen values — no recalculation
      bookingFee = snapshot.bookingFee || 99;
      sparePartsCost = snapshot.sparePartsCost || 0;
      serviceLaborCost = snapshot.serviceLaborCost || 0;
      subtotal = snapshot.subtotal || 0;
      platformFeePercent = snapshot.platformFeePercent || 15;
      platformFee = snapshot.platformFee || 0;
      taxableAmount = snapshot.taxableAmount || 0;
      gstPercent = snapshot.gstPercent || 18;
      cgst = snapshot.cgst || 0;
      sgst = snapshot.sgst || 0;
      grossTotal = snapshot.grossTotal;
      finalTotal = snapshot.finalTotal || 0;
    } else {
      // Legacy fallback: reconstruct from stored DB fields
      bookingFee = service.bookingFee ?? 99;
      grossTotal = service.totalAmount || 0;
      platformFee = service.commissionAmount || 0;
      platformFeePercent = 15;
      gstPercent = 18;
      // Reverse-engineer (best effort for old bookings)
      const totalGst = grossTotal > 0 ? Math.round(grossTotal - grossTotal / 1.18) : 0;
      taxableAmount = grossTotal - totalGst;
      subtotal = Math.max(0, taxableAmount - platformFee);
      sparePartsCost = subtotal; // Can't split parts/labor for legacy
      serviceLaborCost = 0;
      cgst = Math.round(totalGst / 2);
      sgst = totalGst - cgst;
      finalTotal = Math.max(0, grossTotal - bookingFee);
    }

    const invoiceId = `UF-INV-${service.id}-${Date.now().toString(36).toUpperCase()}`;
    const invoiceDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const serviceDate = new Date(service.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const invoiceContent = `
══════════════════════════════════════════════════════
                    UNITEFIX
             SERVICE TAX INVOICE
══════════════════════════════════════════════════════

Invoice No:      ${invoiceId}
Invoice Date:    ${invoiceDate}
Service Date:    ${serviceDate}

──────────────────────────────────────────────────────
BOOKING DETAILS
──────────────────────────────────────────────────────
Booking ID:      ${service.serviceId || service.id}
Service Type:    ${service.serviceType || 'N/A'}
Brand/Model:     ${service.brand || '-'} ${service.model || ''}
Description:     ${service.description || 'N/A'}
Status:          ${service.status?.toUpperCase() || 'N/A'}

──────────────────────────────────────────────────────
CUSTOMER DETAILS
──────────────────────────────────────────────────────
Name:            ${service.customerName || 'N/A'}
Phone:           ${service.customerPhone || 'N/A'}
Address:         ${service.address || 'N/A'}

──────────────────────────────────────────────────────
ASSIGNED EMPLOYEE
──────────────────────────────────────────────────────
Name:            ${service.technicianName || 'Not Assigned'}
Employee ID:     ${service.providerId ? `BU${String(service.providerId).padStart(5, '0')}` : 'N/A'}

══════════════════════════════════════════════════════
                 BILLING BREAKDOWN
══════════════════════════════════════════════════════

Spare Parts:                          ₹${sparePartsCost.toFixed(2)}
Service Labor:                        ₹${serviceLaborCost.toFixed(2)}
                                      ──────────
Subtotal:                             ₹${subtotal.toFixed(2)}

UniteFix Platform Fee (${platformFeePercent}%):       ₹${platformFee.toFixed(2)}
                                      ──────────
Taxable Amount:                       ₹${taxableAmount.toFixed(2)}

CGST (${gstPercent / 2}%):                           ₹${cgst.toFixed(2)}
SGST (${gstPercent / 2}%):                           ₹${sgst.toFixed(2)}
                                      ──────────
Gross Total:                          ₹${grossTotal.toFixed(2)}

Less: Booking Fee (Paid Earlier):     -₹${bookingFee.toFixed(2)}
                                      ══════════
AMOUNT DUE / PAID:                    ₹${finalTotal.toFixed(2)}

${snapshot?.snapshotVersion ? '(Source: Frozen Billing Snapshot)' : '(Source: Legacy DB Values — approximate)'}

──────────────────────────────────────────────────────
GSTIN: [PENDING REGISTRATION]
SAC Code: 998719 (Repair & Maintenance)
──────────────────────────────────────────────────────

This is a computer-generated invoice.
Generated on: ${new Date().toLocaleString('en-IN')}
© ${new Date().getFullYear()} UniteFix — Uttara Kannada
══════════════════════════════════════════════════════
`;
    
    // Create and download file
    const blob = new Blob([invoiceContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `UniteFix-Invoice-${service.serviceId || service.id}.txt`;
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
      <span className={`px-3 py-1 ${config.color} text-xs font-medium rounded-full border border-current/20 shadow-sm backdrop-blur-sm`}>
        {config.text}
      </span>
    );
  };

  return (
      <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden">
        <div className="mb-8 relative z-10 stagger-enter">
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)] mb-2">Service Requests</h2>
          <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide">Monitor and manage all service requests</p>
        </div>

        <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
          <CardHeader className="flex flex-col gap-4 pb-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">
              All Service Requests{pagination?.total ? <span className="text-[hsl(215,20%,55%)] text-sm font-normal ml-2">({pagination.total})</span> : null}
            </CardTitle>
            <DataToolbar
              query={query}
              searchPlaceholder="Service ID, type, brand, customer, employee…"
              filters={[{
                key: "status",
                label: "All Status",
                options: [
                  { value: "created", label: "Created" },
                  { value: "assigned", label: "Assigned" },
                  { value: "accepted", label: "Accepted" },
                  { value: "reached", label: "Reached" },
                  { value: "in_progress", label: "In Progress" },
                  { value: "pending_payment", label: "Payment Due" },
                  { value: "completed", label: "Completed" },
                  { value: "cancelled", label: "Cancelled" },
                  { value: "disputed", label: "Disputed" },
                ],
              }]}
            />
          </CardHeader>
          <CardContent className="p-0">
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
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Service ID</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Service Type</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Customer</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Brand/Model</th>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Assigned Employee</th>
                      <SortableHeader query={query} field="status">Status</SortableHeader>
                      <SortableHeader query={query} field="totalAmount">Amount</SortableHeader>
                      <SortableHeader query={query} field="createdAt">Created</SortableHeader>
                      <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isError && <TableErrorState colSpan={10} onRetry={() => refetch()} message="Could not load service requests." />}
                    {!isError && filteredServices.length === 0 && (
                      <TableEmptyState colSpan={10} icon="build" title={services.length === 0 ? "No service requests yet" : "No matching service requests"} description={services.length === 0 ? "Bookings created in the mobile app will appear here." : "Try a different search term or filter."} />
                    )}
                    {!isError && filteredServices.map((service: any) => (
                      <tr key={service.id} className={`border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)] group ${selection.isSelected(service.id) ? 'bg-[hsla(217,91%,60%,0.06)]' : ''}`}>
                        <td className="p-4">
                          <RowCheckbox checked={selection.isSelected(service.id)} onToggle={() => selection.toggle(service)} />
                        </td>
                        <td className="p-4">
                          <p className="font-medium text-[hsl(210,20%,90%)]">{service.serviceId || service.id}</p>
                          <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">#{service.id}</p>
                        </td>
                        <td className="p-4">
                          <p className="font-medium text-[hsl(210,20%,90%)]">{service.serviceType || 'General'}</p>
                          <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5 line-clamp-1 max-w-[150px]">{service.description}</p>
                        </td>
                        <td className="p-4">
                          <p className="font-medium text-[hsl(210,20%,90%)]">{service.customerName || 'N/A'}</p>
                          <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">{service.customerPhone}</p>
                        </td>
                        <td className="p-4">
                          <p className="text-sm text-[hsl(210,20%,90%)]">{service.brand}</p>
                          <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">{service.model}</p>
                        </td>
                        <td className="p-4">
                          {service.technicianName ? (
                            <div>
                              <p className="font-medium text-[hsl(210,20%,90%)]">{service.technicianName}</p>
                              <Badge variant="secondary" className="text-[10px] mt-1 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,75%)]">
                                BU{String(service.providerId || '').padStart(5, '0')}
                              </Badge>
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-[10px] border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,60%)] bg-[rgba(255,255,255,0.02)]">Not Assigned</Badge>
                          )}
                        </td>
                        <td className="p-4">
                          {getStatusBadge(service.status)}
                        </td>
                        <td className="p-4">
                          <p className="font-medium text-[hsl(160,84%,65%)] font-mono">₹{service.totalAmount || service.bookingFee}</p>
                          {service.totalAmount && (
                            <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">Booking: ₹{service.bookingFee}</p>
                          )}
                        </td>
                        <td className="p-4">
                          <p className="text-sm text-[hsl(215,20%,70%)]">
                            {new Date(service.createdAt).toLocaleDateString()} {new Date(service.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </td>
                        <td className="p-4">
                          <div className="flex space-x-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedService(service)}
                                className="h-8 border-[rgba(255,255,255,0.1)] text-[hsl(217,91%,60%)] bg-[hsla(217,91%,60%,0.05)] hover:bg-[hsla(217,91%,60%,0.15)] transition-colors"
                              >
                                <span className="text-xs font-medium">View Details</span>
                              </Button>
                              {['assigned', 'accepted'].includes(service.status) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedService(service);
                                    setIsAssignModalOpen(true);
                                  }}
                                  className="h-8 border-[hsla(38,92%,60%,0.3)] text-[hsl(38,92%,60%)] bg-[hsla(38,92%,60%,0.05)] hover:bg-[hsla(38,92%,60%,0.15)] transition-colors"
                                >
                                  <span className="text-xs font-medium">Reassign</span>
                                </Button>
                              )}
                              {service.status === 'completed' && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={downloadingId === service.id}
                                onClick={() => downloadInvoicePdf(service)}
                                className="h-8 border-[rgba(255,255,255,0.1)] text-[hsl(160,84%,60%)] bg-[hsla(160,84%,39%,0.05)] hover:bg-[hsla(160,84%,39%,0.15)] transition-colors"
                              >
                                <span className="text-xs font-medium">{downloadingId === service.id ? 'Generating…' : 'Invoice'}</span>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <DataPagination query={query} pagination={pagination} rowCount={filteredServices.length} />
              </>
            )}
          </CardContent>
        </Card>

        <BulkActionBar
          count={selection.count}
          onClear={selection.clear}
          noun="request"
          actions={[
            { label: "Export CSV", icon: <Download className="w-3.5 h-3.5" />, onClick: handleExport },
          ]}
        />

        {/* Service Details Modal */}
        <Dialog open={!!selectedService} onOpenChange={() => setSelectedService(null)}>
          <DialogContent className="max-w-2xl glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.8)] shadow-[0_0_40px_rgba(0,0,0,0.5)] max-h-[85vh] overflow-y-auto custom-scrollbar">
            <DialogHeader className="border-b border-[rgba(255,255,255,0.06)] pb-4 sticky top-0 bg-[hsla(222,40%,10%,0.95)] backdrop-blur-md z-10">
              <DialogTitle className="text-xl text-white">Service Request Details</DialogTitle>
            </DialogHeader>
            {selectedService && (
              <div className="space-y-6 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                    <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Service ID</p>
                    <p className="text-lg font-semibold text-white">{selectedService.serviceId || selectedService.id}</p>
                  </div>
                  <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                    <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Status</p>
                    <div className="mt-1">{getStatusBadge(selectedService.status)}</div>
                  </div>
                  <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                    <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Service Type</p>
                    <p className="text-base text-white">{selectedService.serviceType || 'General'}</p>
                  </div>
                  <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                    <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Booking Fee Status</p>
                    <p className="text-base font-mono text-[hsl(210,20%,85%)]">{selectedService.bookingFeeStatus || 'N/A'}</p>
                  </div>
                </div>

                <div className="border-t border-[rgba(255,255,255,0.06)] pt-6">
                  <h4 className="font-medium text-white mb-4 flex items-center gap-2"><span className="w-1.5 h-4 bg-[hsl(217,91%,60%)] rounded-full"></span> Customer Information</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                      <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Name</p>
                      <p className="text-base text-white">{selectedService.customerName || 'N/A'}</p>
                    </div>
                    <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                      <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Phone</p>
                      <p className="text-base text-white">{selectedService.customerPhone || 'N/A'}</p>
                    </div>
                    <div className="col-span-2 bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                      <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Address</p>
                      <p className="text-base text-white leading-relaxed">{selectedService.address}</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-[rgba(255,255,255,0.06)] pt-6">
                  <h4 className="font-medium text-white mb-4 flex items-center gap-2"><span className="w-1.5 h-4 bg-[hsl(263,70%,60%)] rounded-full"></span> Device Information</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                      <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Brand</p>
                      <p className="text-base text-white">{selectedService.brand}</p>
                    </div>
                    <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                      <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Model</p>
                      <p className="text-base text-white">{selectedService.model}</p>
                    </div>
                    <div className="col-span-2 bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                      <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Description</p>
                      <p className="text-base text-white leading-relaxed">{selectedService.description}</p>
                    </div>
                  </div>
                </div>

                {/* Customer Photos */}
                {selectedService.photos && selectedService.photos.length > 0 && (
                  <div className="border-t border-[rgba(255,255,255,0.06)] pt-6">
                    <h4 className="font-medium text-white mb-4 flex items-center gap-2"><span className="w-1.5 h-4 bg-[hsl(347,77%,60%)] rounded-full"></span> Customer Photos ({selectedService.photos.length})</h4>
                    <div className="flex flex-wrap gap-3">
                      {selectedService.photos.map((photoUrl: string, index: number) => (
                        <a key={index} href={photoUrl} target="_blank" rel="noopener noreferrer">
                          <img
                            src={photoUrl}
                            alt={`Issue photo ${index + 1}`}
                            className="w-24 h-24 rounded-lg object-cover border border-[rgba(255,255,255,0.1)] hover:border-[hsl(217,91%,60%)] hover:shadow-[0_0_15px_hsla(217,91%,60%,0.3)] transition-all cursor-pointer"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {(selectedService.technicianName || ['assigned', 'accepted'].includes(selectedService.status)) && (
                  <div className="border-t border-[rgba(255,255,255,0.06)] pt-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-medium text-white flex items-center gap-2"><span className="w-1.5 h-4 bg-[hsl(38,92%,60%)] rounded-full"></span> Assigned Employee</h4>
                      {['assigned', 'accepted'].includes(selectedService.status) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs border-[hsla(217,91%,60%,0.3)] text-[hsl(217,91%,70%)] hover:bg-[hsla(217,91%,60%,0.1)] hover:text-white"
                          onClick={() => setIsAssignModalOpen(true)}
                        >
                          <RefreshCw className="w-3 h-3 mr-2" />
                          Reassign
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                        <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Employee Name</p>
                        <p className="text-base text-white">{selectedService.technicianName || <span className="text-red-400">Data Corrupted - Please Reassign</span>}</p>
                      </div>
                      <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                        <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Employee ID</p>
                        <p className="text-base font-mono text-[hsl(210,20%,85%)]">{selectedService.providerId ? `BU${String(selectedService.providerId).padStart(5, '0')}` : 'N/A'}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="border-t border-[rgba(255,255,255,0.06)] pt-6">
                  <h4 className="font-medium text-white mb-4 flex items-center gap-2"><span className="w-1.5 h-4 bg-[hsl(160,84%,60%)] rounded-full"></span> Payment Information</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
                      <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Booking Fee</p>
                      <p className="text-base font-mono text-white">₹{selectedService.bookingFee ?? 99}</p>
                    </div>
                    <div className="bg-[hsla(160,84%,39%,0.1)] p-4 rounded-xl border border-[hsla(160,84%,39%,0.2)]">
                      <p className="text-xs font-medium text-[hsl(160,84%,75%)] uppercase tracking-wider mb-1">Total Amount</p>
                      <p className="text-lg font-bold font-mono text-[hsl(160,84%,65%)]">{selectedService.totalAmount ? `₹${selectedService.totalAmount}` : 'Pending'}</p>
                    </div>
                    {selectedService.commissionAmount && (
                      <div className="col-span-2 bg-[hsla(217,91%,60%,0.1)] p-4 rounded-xl border border-[hsla(217,91%,60%,0.2)]">
                        <p className="text-xs font-medium text-[hsl(217,91%,75%)] uppercase tracking-wider mb-1">Platform Commission</p>
                        <p className="text-base font-mono font-medium text-[hsl(217,91%,65%)]">₹{selectedService.commissionAmount}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-[rgba(255,255,255,0.06)] pt-6 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Created</p>
                      <p className="text-sm text-[hsl(215,20%,75%)]">{new Date(selectedService.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">Last Updated</p>
                      <p className="text-sm text-[hsl(215,20%,75%)]">{new Date(selectedService.updatedAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <PartnerAssignmentModal
          isOpen={isAssignModalOpen}
          onClose={() => setIsAssignModalOpen(false)}
          service={selectedService}
        />
      </div>
  );
}