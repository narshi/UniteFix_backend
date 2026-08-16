import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { StuckPayments } from "@/components/admin/stuck-payments";
import {
  useTableQuery, DataToolbar, DataPagination, SortableHeader,
  useRowSelection, BulkActionBar, SelectAllCheckbox, RowCheckbox,
  exportCsv, timestampedName,
} from "@/components/admin/table";
import { downloadAdminFile } from "@/lib/admin-auth";
import { Download } from "lucide-react";

export default function PaymentsPage() {
  const query = useTableQuery("/api/admin/invoices", {
    defaultSort: "createdAt",
    initialFilters: { source: "all" },
  });
  const selection = useRowSelection<any>();
  const { data: response, isLoading, refetch } = useQuery<any>({
    queryKey: [query.key],
  });
  const invoices = response?.data ?? [];
  const pagination = response?.pagination;
  const { toast } = useToast();

  const handleExport = () => {
    exportCsv(timestampedName("invoices"), selection.rows, [
      { header: "Invoice ID", value: (i: any) => i.invoiceId },
      { header: "Source", value: (i: any) => i.source },
      { header: "Customer", value: (i: any) => i.customerName },
      { header: "Phone", value: (i: any) => i.customerPhone },
      { header: "Base", value: (i: any) => i.baseAmount },
      { header: "CGST", value: (i: any) => i.cgst },
      { header: "SGST", value: (i: any) => i.sgst },
      { header: "Discount", value: (i: any) => i.discount },
      { header: "Total", value: (i: any) => i.totalAmount },
      { header: "Payment status", value: (i: any) => i.paymentStatus },
      { header: "Date", value: (i: any) => (i.createdAt ? new Date(i.createdAt).toLocaleString() : "") },
    ]);
    toast({ title: `Exported ${selection.count} invoice(s)` });
  };

  const handleRefund = async (invoice: any) => {
    if (!confirm("Are you sure you want to refund this payment?")) return;
    try {
      await apiRequest("POST", `/api/admin/invoices/${invoice.id}/refund`);
      toast({
        title: "Refund Processed",
        description: `Successfully refunded invoice ${invoice.invoiceId}`,
      });
      refetch();
    } catch (error: any) {
      toast({
        title: "Refund Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden bg-transparent">
      <div className="mb-8 relative z-10 stagger-enter">
        <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)] mb-2">Payments & Invoices</h2>
        <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide">Manage all payments and invoice records</p>
      </div>

      {/* Safety net for QR payments that were made but never settled. */}
      <StuckPayments />

      <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
        <CardHeader className="flex flex-col gap-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
          <CardTitle className="text-xl text-white">
            All Invoices{pagination?.total ? <span className="text-[hsl(215,20%,55%)] text-sm font-normal ml-2">({pagination.total})</span> : null}
          </CardTitle>
          <DataToolbar
            query={query}
            searchPlaceholder="Invoice no, customer, phone…"
            filters={[{
              key: "source",
              label: "All Sources",
              options: [
                { value: "service", label: "Service booking" },
                { value: "manual", label: "Manual bill" },
                { value: "product", label: "Product order" },
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
                    <th className="p-4 w-10">
                      <SelectAllCheckbox state={selection.pageState(invoices)} onToggle={() => selection.togglePage(invoices)} />
                    </th>
                    <SortableHeader query={query} field="invoiceId">Invoice ID</SortableHeader>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Type</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Customer</th>
                    <SortableHeader query={query} field="baseAmount">Base Amount</SortableHeader>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Tax (CGST+SGST)</th>
                    <SortableHeader query={query} field="totalAmount">Total Amount</SortableHeader>
                    <SortableHeader query={query} field="createdAt">Date</SortableHeader>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Status</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices?.map((invoice: any) => (
                    <tr key={invoice.id} className={`border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)] group ${selection.isSelected(invoice.id) ? 'bg-[hsla(217,91%,60%,0.06)]' : ''}`}>
                      <td className="p-4">
                        <RowCheckbox checked={selection.isSelected(invoice.id)} onToggle={() => selection.toggle(invoice)} />
                      </td>
                      <td className="p-4">
                        <p className="font-medium text-[hsl(210,20%,90%)]">{invoice.invoiceId || '—'}</p>
                      </td>
                      <td className="p-4">
                        <Badge
                          variant="outline"
                          className={
                            invoice.source === 'service' ? 'bg-[hsla(217,91%,60%,0.15)] text-[hsl(217,91%,70%)] border-[hsla(217,91%,60%,0.3)]'
                              : invoice.source === 'manual' ? 'bg-[hsla(263,70%,58%,0.15)] text-[hsl(263,70%,72%)] border-[hsla(263,70%,58%,0.3)]'
                                : 'bg-[rgba(255,255,255,0.05)] text-[hsl(215,20%,75%)] border-[rgba(255,255,255,0.1)]'
                          }
                        >
                          {invoice.source === 'service' ? 'Service' : invoice.source === 'manual' ? 'Manual' : 'Product'}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <p className="text-sm text-[hsl(210,20%,85%)]">{invoice.customerName ?? `Customer #${invoice.userId}`}</p>
                        <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">{invoice.customerPhone ?? ''}</p>
                      </td>
                      <td className="p-4">
                        <p className="text-sm text-[hsl(210,20%,85%)]">₹{(invoice.baseAmount ?? 0).toLocaleString()}</p>
                      </td>
                      <td className="p-4">
                        <p className="text-sm text-[hsl(210,20%,85%)]">₹{((invoice.cgst ?? 0) + (invoice.sgst ?? 0)).toLocaleString()}</p>
                        <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">CGST: ₹{invoice.cgst ?? 0} | SGST: ₹{invoice.sgst ?? 0}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-medium text-[hsl(160,84%,65%)] font-mono">₹{(invoice.totalAmount ?? 0).toLocaleString()}</p>
                        {(invoice.discount ?? 0) > 0 && (
                          <p className="text-xs text-[hsl(160,84%,55%)] mt-0.5">Discount: ₹{invoice.discount}</p>
                        )}
                      </td>
                      <td className="p-4">
                        <p className="text-sm text-[hsl(215,20%,65%)]">
                          {invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString() : '—'}
                        </p>
                      </td>
                      <td className="p-4">
                        <Badge 
                          variant={invoice.paymentStatus === 'captured' ? 'default' : invoice.paymentStatus === 'refunded' ? 'secondary' : invoice.paymentStatus === 'failed' ? 'destructive' : 'outline'}
                          className={invoice.paymentStatus === 'captured' ? 'bg-[hsla(160,84%,40%,0.15)] text-[hsl(160,84%,55%)] border-[hsla(160,84%,40%,0.3)]' : ''}
                        >
                          {invoice.paymentStatus === 'captured' ? 'Completed' : invoice.paymentStatus || 'Pending'}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Download invoice PDF"
                            className="h-8 w-8 text-[hsl(215,20%,65%)] hover:text-white"
                            onClick={() => downloadAdminFile(`/api/admin/invoices/${invoice.id}/pdf`, `${invoice.invoiceId}.pdf`)
                              .catch((e) => toast({ title: "Download failed", description: e.message, variant: "destructive" }))}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          {(invoice.paymentStatus === 'captured' || invoice.paymentStatus === 'pending') && invoice.serviceRequestId && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="bg-[hsla(0,84%,40%,0.1)] text-[hsl(0,84%,65%)] border-[hsla(0,84%,40%,0.3)] hover:bg-[hsla(0,84%,40%,0.2)]"
                              onClick={() => handleRefund(invoice)}
                            >
                              Refund
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(!invoices || invoices.length === 0) && (
                    <tr>
                      <td colSpan={10} className="text-center py-8 text-[hsl(215,20%,50%)]">
                        {query.activeFilterCount > 0 ? "No invoices match these filters" : "No invoices found"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <DataPagination query={query} pagination={pagination} rowCount={invoices.length} />
            </>
          )}
        </CardContent>
      </Card>

      <BulkActionBar
        count={selection.count}
        onClear={selection.clear}
        noun="invoice"
        actions={[
          { label: "Export CSV", icon: <Download className="w-3.5 h-3.5" />, onClick: handleExport },
        ]}
      />
    </div>
  );
}