import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function PaymentsPage() {
  const { data: invoices, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/invoices"],
  });

  return (
    <div className="flex-1 p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Payments & Invoices</h2>
        <p className="text-gray-600">Manage all payments and invoice records</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Invoices</CardTitle>
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
                    <th className="text-left py-3 px-4">Invoice ID</th>
                    <th className="text-left py-3 px-4">Type</th>
                    <th className="text-left py-3 px-4">Customer</th>
                    <th className="text-left py-3 px-4">Base Amount</th>
                    <th className="text-left py-3 px-4">Tax (CGST+SGST)</th>
                    <th className="text-left py-3 px-4">Total Amount</th>
                    <th className="text-left py-3 px-4">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices?.map((invoice: any) => (
                    <tr key={invoice.id} className="border-b border-gray-100">
                      <td className="py-3 px-4">
                        <p className="font-medium text-gray-900">{invoice.invoiceId}</p>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={invoice.serviceRequestId ? 'default' : 'secondary'}>
                          {invoice.serviceRequestId ? 'Service' : 'Product'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-sm text-gray-900">Customer #{invoice.userId}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-sm text-gray-900">₹{invoice.baseAmount.toLocaleString()}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-sm text-gray-900">₹{(invoice.cgst + invoice.sgst).toLocaleString()}</p>
                        <p className="text-xs text-gray-600">CGST: ₹{invoice.cgst} | SGST: ₹{invoice.sgst}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-gray-900">₹{invoice.totalAmount.toLocaleString()}</p>
                        {invoice.discount > 0 && (
                          <p className="text-xs text-green-600">Discount: ₹{invoice.discount}</p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-sm text-gray-600">
                          {new Date(invoice.createdAt).toLocaleDateString()}
                        </p>
                      </td>
                    </tr>
                  ))}
                  {(!invoices || invoices.length === 0) && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-gray-500">
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