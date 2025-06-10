import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function PartnersPage() {
  const { data: partners, isLoading } = useQuery({
    queryKey: ["/api/business/partners"],
  });

  return (
      <div className="flex-1 p-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Business Partners</h2>
          <p className="text-gray-600">Manage all business partners and service providers</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Business Partners</CardTitle>
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
                      <th className="text-left py-3 px-4">Partner</th>
                      <th className="text-left py-3 px-4">Business Type</th>
                      <th className="text-left py-3 px-4">Services</th>
                      <th className="text-left py-3 px-4">Contact</th>
                      <th className="text-left py-3 px-4">Location</th>
                      <th className="text-left py-3 px-4">Status</th>
                      <th className="text-left py-3 px-4">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partners?.map((partner: any) => (
                      <tr key={partner.id} className="border-b border-gray-100">
                        <td className="py-3 px-4">
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                              <span className="text-white text-sm font-medium">
                                {partner.username.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{partner.username}</p>
                              <p className="text-sm text-gray-600">BU{String(partner.id).padStart(5, '0')}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={partner.businessType === 'business' ? 'default' : 'secondary'}>
                            {partner.businessType === 'business' ? 'Business' : 'Individual'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <div className="space-y-1">
                            {partner.services?.map((service: string, idx: number) => (
                              <span key={idx} className="inline-block px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded mr-1">
                                {service}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-sm text-gray-900">{partner.phone}</p>
                          <p className="text-sm text-gray-600">{partner.email}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-sm text-gray-600">{partner.pinCode}</p>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={partner.isVerified ? 'default' : 'destructive'}>
                            {partner.isVerified ? 'Verified' : 'Unverified'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-sm text-gray-600">
                            {new Date(partner.createdAt).toLocaleDateString()}
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