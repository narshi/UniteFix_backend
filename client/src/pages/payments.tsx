import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function PaymentsPage() {
  const { data: invoices, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/invoices"],
  });

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden bg-transparent">
      <div className="mb-8 relative z-10 stagger-enter">
        <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)] mb-2">Payments & Invoices</h2>
        <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide">Manage all payments and invoice records</p>
      </div>

      <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter">
        <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
          <CardTitle className="text-xl text-white">All Invoices</CardTitle>
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
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Invoice ID</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Type</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Customer</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Base Amount</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Tax (CGST+SGST)</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Total Amount</th>
                    <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices?.map((invoice: any) => (
                    <tr key={invoice.id} className="border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)] group">
                      <td className="p-4">
                        <p className="font-medium text-[hsl(210,20%,90%)]">{invoice.invoiceId || '—'}</p>
                      </td>
                      <td className="p-4">
                        <Badge variant={invoice.serviceRequestId ? 'default' : 'secondary'} className={invoice.serviceRequestId ? 'bg-[hsla(217,91%,60%,0.15)] text-[hsl(217,91%,70%)] border-[hsla(217,91%,60%,0.3)] border' : 'bg-[rgba(255,255,255,0.05)] text-[hsl(215,20%,75%)] border-[rgba(255,255,255,0.1)] border'}>
                          {invoice.serviceRequestId ? 'Service' : 'Product'}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <p className="text-sm text-[hsl(215,20%,70%)]">Customer #{invoice.userId}</p>
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
                    </tr>
                  ))}
                  {(!invoices || invoices.length === 0) && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-[hsl(215,20%,50%)]">
                        No invoices found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}