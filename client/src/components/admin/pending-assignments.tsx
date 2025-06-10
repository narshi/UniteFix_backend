import { useQuery } from "@tanstack/react-query";

interface PendingAssignmentsProps {
  onAssignPartner: (service: any) => void;
}

export default function PendingAssignments({ onAssignPartner }: PendingAssignmentsProps) {
  const { data: pendingServices, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/services/pending"],
  });

  const getWaitingTimeColor = (createdAt: string) => {
    const hours = Math.floor((new Date().getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60));
    
    if (hours > 24) return "bg-red-100 text-red-800";
    if (hours > 12) return "bg-yellow-100 text-yellow-800";
    return "bg-green-100 text-green-800";
  };

  const formatWaitingTime = (createdAt: string) => {
    const hours = Math.floor((new Date().getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60));
    
    if (hours < 1) return "< 1 hour";
    if (hours === 1) return "1 hour";
    if (hours < 24) return `${hours} hours`;
    
    const days = Math.floor(hours / 24);
    if (days === 1) return "1 day";
    return `${days} days`;
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-6 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Pending Partner Assignments</h3>
        </div>
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      <div className="p-6 border-b border-gray-100">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">Pending Partner Assignments</h3>
          <span className="px-3 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-full">
            {pendingServices?.length || 0} Pending
          </span>
        </div>
      </div>
      <div className="p-6">
        {(!pendingServices || pendingServices.length === 0) ? (
          <div className="text-center py-8">
            <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-gray-500">No pending assignments</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-gray-200">
                  <th className="pb-3 text-sm font-medium text-gray-600">Service Request</th>
                  <th className="pb-3 text-sm font-medium text-gray-600">Customer</th>
                  <th className="pb-3 text-sm font-medium text-gray-600">Location</th>
                  <th className="pb-3 text-sm font-medium text-gray-600">Waiting Time</th>
                  <th className="pb-3 text-sm font-medium text-gray-600">Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingServices.map((service: any) => (
                  <tr key={service.id} className="border-b border-gray-100">
                    <td className="py-4">
                      <div>
                        <p className="font-medium text-gray-900">{service.description}</p>
                        <p className="text-sm text-gray-600">{service.serviceId}</p>
                      </div>
                    </td>
                    <td className="py-4">
                      <div>
                        <p className="font-medium text-gray-900">{service.user?.username}</p>
                        <p className="text-sm text-gray-600">{service.user?.phone}</p>
                      </div>
                    </td>
                    <td className="py-4">
                      <p className="text-sm text-gray-600">{service.user?.homeAddress || service.address}</p>
                    </td>
                    <td className="py-4">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${getWaitingTimeColor(service.createdAt)}`}>
                        {formatWaitingTime(service.createdAt)}
                      </span>
                    </td>
                    <td className="py-4">
                      <button 
                        onClick={() => onAssignPartner(service)}
                        className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors"
                      >
                        Assign Partner
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
