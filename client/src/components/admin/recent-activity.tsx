import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";

export default function RecentActivity() {
  const [location, setLocation] = useLocation();
  
  const { data: recentServices, isLoading: servicesLoading } = useQuery({
    queryKey: ["/api/admin/services/recent"],
  });

  const { data: recentOrders, isLoading: ordersLoading } = useQuery({
    queryKey: ["/api/admin/orders/recent"],
  });

  const handleViewAllServices = () => {
    setLocation("/services");
  };

  const handleViewAllOrders = () => {
    setLocation("/orders");
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'partner_assigned': { color: 'bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,65%)] border border-[hsla(38,92%,50%,0.3)]', text: 'Employee Assigned' },
      'service_started': { color: 'bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border border-[hsla(160,84%,39%,0.3)]', text: 'Service Started' },
      'pending': { color: 'bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border border-[hsla(347,77%,50%,0.3)]', text: 'Pending Assignment' },
      'delivered': { color: 'bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border border-[hsla(160,84%,39%,0.3)]', text: 'Delivered' },
      'in_transit': { color: 'bg-[hsla(217,91%,60%,0.15)] text-[hsl(217,91%,70%)] border border-[hsla(217,91%,60%,0.3)]', text: 'In Transit' },
      'confirmed': { color: 'bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,65%)] border border-[hsla(38,92%,50%,0.3)]', text: 'Order Confirmed' },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || { 
      color: 'bg-[rgba(255,255,255,0.1)] text-[hsl(210,20%,80%)] border border-[rgba(255,255,255,0.2)]', 
      text: status 
    };
    
    return (
      <span className={`px-3 py-1 ${config.color} text-xs font-medium rounded-full`}>
        {config.text}
      </span>
    );
  };

  const getServiceIcon = (serviceType: string) => {
    return (
      <div className="w-10 h-10 bg-[hsla(217,91%,60%,0.2)] rounded-full flex items-center justify-center border border-[hsla(217,91%,60%,0.5)] shadow-[0_0_15px_hsla(217,91%,60%,0.3)] shrink-0">
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 7.172V5L8 4z" />
        </svg>
      </div>
    );
  };

  const getOrderIcon = (status: string) => {
    const iconColor = status === 'delivered' ? 'bg-[hsla(160,84%,39%,0.2)] border-[hsla(160,84%,39%,0.5)] shadow-[0_0_15px_hsla(160,84%,39%,0.3)]' : status === 'in_transit' ? 'bg-[hsla(217,91%,60%,0.2)] border-[hsla(217,91%,60%,0.5)] shadow-[0_0_15px_hsla(217,91%,60%,0.3)]' : 'bg-[hsla(38,92%,50%,0.2)] border-[hsla(38,92%,50%,0.5)] shadow-[0_0_15px_hsla(38,92%,50%,0.3)]';
    return (
      <div className={`w-10 h-10 rounded-full flex items-center justify-center border shrink-0 ${iconColor}`}>
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </div>
    );
  };

  const formatTimeAgo = (date: string) => {
    const now = new Date();
    const then = new Date(date);
    const diffHours = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60));
    
    if (diffHours < 1) return 'Just now';
    if (diffHours === 1) return '1 hour ago';
    if (diffHours < 24) return `${diffHours} hours ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return '1 day ago';
    return `${diffDays} days ago`;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8 stagger-enter">
      {/* Recent Services */}
      <div className="glass-card">
        <div className="p-6 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white tracking-tight">Recent Service Requests</h3>
            <button 
              onClick={handleViewAllServices}
              className="text-[hsl(217,91%,60%)] hover:text-[hsl(217,91%,70%)] text-sm font-medium transition-colors"
            >
              View All
            </button>
          </div>
        </div>
        <div className="p-6">
          {servicesLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 skeleton-shimmer rounded-full shrink-0"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 skeleton-shimmer rounded w-3/4"></div>
                      <div className="h-3 skeleton-shimmer rounded w-1/2"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {Array.isArray(recentServices) && recentServices.slice(0, 3).map((service: any) => (
                <div key={service.id} className="flex items-center justify-between p-4 bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)] rounded-xl transition-colors hover:bg-[rgba(255,255,255,0.04)]">
                  <div className="flex items-center space-x-4 min-w-0 pr-4">
                    {getServiceIcon(service.serviceType)}
                    <div className="min-w-0">
                      <p className="font-medium text-[hsl(210,20%,90%)] truncate">{service.description}</p>
                      <p className="text-sm text-[hsl(215,20%,55%)] truncate">
                        {service.user?.username} • {service.serviceId}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {getStatusBadge(service.status)}
                    <p className="text-xs text-[hsl(215,20%,55%)] mt-1">
                      {formatTimeAgo(service.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
              {(!recentServices || !Array.isArray(recentServices) || recentServices.length === 0) && (
                <p className="text-[hsl(215,20%,55%)] text-center py-4">No recent services</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Recent Orders */}
      <div className="glass-card">
        <div className="p-6 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white tracking-tight">Recent Product Orders</h3>
            <button 
              onClick={handleViewAllOrders}
              className="text-[hsl(217,91%,60%)] hover:text-[hsl(217,91%,70%)] text-sm font-medium transition-colors"
            >
              View All
            </button>
          </div>
        </div>
        <div className="p-6">
          {ordersLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 skeleton-shimmer rounded-full shrink-0"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 skeleton-shimmer rounded w-3/4"></div>
                      <div className="h-3 skeleton-shimmer rounded w-1/2"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {Array.isArray(recentOrders) && recentOrders.slice(0, 3).map((order: any) => (
                <div key={order.id} className="flex items-center justify-between p-4 bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)] rounded-xl transition-colors hover:bg-[rgba(255,255,255,0.04)]">
                  <div className="flex items-center space-x-4 min-w-0 pr-4">
                    {getOrderIcon(order.status)}
                    <div className="min-w-0">
                      <p className="font-medium text-[hsl(210,20%,90%)] truncate">Order #{order.orderId}</p>
                      <p className="text-sm text-[hsl(215,20%,55%)] truncate">
                        {order.user?.username} • {order.orderId}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {getStatusBadge(order.status)}
                    <p className="text-xs text-[hsl(215,20%,55%)] mt-1">
                      ₹{order.totalAmount.toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
              {(!recentOrders || !Array.isArray(recentOrders) || recentOrders.length === 0) && (
                <p className="text-[hsl(215,20%,55%)] text-center py-4">No recent orders</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
