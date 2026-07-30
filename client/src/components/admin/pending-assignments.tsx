import { useQuery } from "@tanstack/react-query";

interface PendingAssignmentsProps {
  onAssignPartner: (service: any) => void;
}

export default function PendingAssignments({ onAssignPartner }: PendingAssignmentsProps) {
  const { data: pendingServices, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/admin/services/pending"],
  });

  const getWaitingTimeColor = (createdAt: string) => {
    const hours = Math.floor((new Date().getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60));

    if (hours > 24) return "bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border border-[hsla(347,77%,50%,0.3)] shadow-[0_0_10px_hsla(347,77%,50%,0.2)]";
    if (hours > 12) return "bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,65%)] border border-[hsla(38,92%,50%,0.3)] shadow-[0_0_10px_hsla(38,92%,50%,0.2)]";
    return "bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border border-[hsla(160,84%,39%,0.3)] shadow-[0_0_10px_hsla(160,84%,39%,0.2)]";
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
      <div className="glass-card stagger-enter">
        <div className="p-6 border-b border-[rgba(255,255,255,0.06)]">
          <h3 className="text-lg font-semibold text-white tracking-tight">Pending Employee Assignments</h3>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 skeleton-shimmer rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card stagger-enter">
      <div className="p-6 border-b border-[rgba(255,255,255,0.06)]">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white tracking-tight">Pending Employee Assignments</h3>
          <span className="px-3 py-1 bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border border-[hsla(347,77%,50%,0.3)] shadow-[0_0_10px_hsla(347,77%,50%,0.2)] text-xs font-medium rounded-full">
            {pendingServices?.length || 0} Pending
          </span>
        </div>
      </div>
      <div className="p-6">
        {(!pendingServices || pendingServices.length === 0) ? (
          <div className="text-center py-8">
            <svg className="w-12 h-12 text-[hsl(215,20%,45%)] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-[hsl(210,20%,75%)]">No pending assignments</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full glass-table">
              <thead>
                <tr className="text-left border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                  <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Service Requested</th>
                  <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Customer</th>
                  <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Location</th>
                  <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Waiting Time</th>
                  <th className="p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingServices.map((service: any) => (
                  <tr key={service.id} className="border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)] group">
                    <td className="p-4">
                      {/* Lead with the service the customer actually SELECTED, so the
                          assignment decision is driven by that and not by a free-text
                          description that may name a different trade. The customer's
                          note is kept but clearly demoted as supporting detail. */}
                      <div className="space-y-1 max-w-[280px]">
                        <p className="font-semibold text-white">{service.serviceType || 'Service'}</p>
                        <p className="text-xs text-[hsl(215,20%,55%)] font-mono">{service.serviceId}</p>
                        {service.description && (
                          <p className="text-xs text-[hsl(215,20%,70%)] italic line-clamp-2">
                            <span className="not-italic text-[hsl(215,20%,50%)]">Note: </span>
                            {service.description}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <div>
                        <p className="font-medium text-[hsl(210,20%,90%)]">{service.user?.username}</p>
                        <p className="text-sm text-[hsl(215,20%,55%)]">{service.user?.phone}</p>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-sm text-[hsl(215,20%,55%)]">{service.user?.homeAddress || service.address}</p>
                    </td>
                    <td className="p-4">
                      <span className={`px-3 py-1 text-xs font-medium rounded-full ${getWaitingTimeColor(service.createdAt)}`}>
                        {formatWaitingTime(service.createdAt)}
                      </span>
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => onAssignPartner(service)}
                        className="bg-[hsl(217,91%,60%)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[hsl(217,91%,55%)] shadow-[0_4px_14px_hsla(217,91%,60%,0.3)] hover:shadow-[0_6px_20px_hsla(217,91%,60%,0.4)] transition-all active:scale-[0.97]"
                      >
                        Assign Employee
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
