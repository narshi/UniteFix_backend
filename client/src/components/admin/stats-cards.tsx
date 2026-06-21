import { useQuery } from "@tanstack/react-query";
import { Users, Wrench, ShoppingBag, TrendingUp, Clock, CheckCircle } from "lucide-react";

interface StatsDataInner {
  totalUsers: number;
  totalProviders: number;
  activeServices: number;
  completedServices: number;
  totalOrders: number;
  totalRevenue: number;
  pendingApprovals: number;
}

interface StatsResponse {
  success?: boolean;
  data?: StatsDataInner;
  totalUsers?: number;
  activeServices?: number;
  productOrders?: number;
  revenue?: number;
  pendingCount?: number;
  totalProviders?: number;
  completedServices?: number;
  totalOrders?: number;
  totalRevenue?: number;
  pendingApprovals?: number;
}

export default function StatsCards() {
  const { data: stats, isLoading } = useQuery<StatsResponse>({
    queryKey: ["/api/admin/stats"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 stagger-enter">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-6 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.035)]">
            <div className="h-20 skeleton-shimmer rounded-lg w-full"></div>
          </div>
        ))}
      </div>
    );
  }

  const statsData = stats?.data || stats as StatsDataInner | undefined;
  
  const totalUsers = statsData?.totalUsers || (stats as StatsResponse)?.totalUsers || 0;
  const totalProviders = statsData?.totalProviders || (stats as StatsResponse)?.totalProviders || 0;
  const activeServices = statsData?.activeServices || (stats as StatsResponse)?.activeServices || 0;
  const completedServices = statsData?.completedServices || (stats as StatsResponse)?.completedServices || 0;
  const totalOrders = statsData?.totalOrders || (stats as StatsResponse)?.totalOrders || (stats as StatsResponse)?.productOrders || 0;
  const totalRevenue = statsData?.totalRevenue || (stats as StatsResponse)?.totalRevenue || (stats as StatsResponse)?.revenue || 0;
  const pendingApprovals = statsData?.pendingApprovals || (stats as StatsResponse)?.pendingApprovals || 0;
  
  const statsCards = [
    {
      title: "Total Users",
      value: totalUsers,
      change: `${totalProviders} providers`,
      changeType: "info",
      icon: <Users className="w-6 h-6 text-white" />,
      iconBg: "bg-[hsla(217,91%,60%,0.2)] border-[hsla(217,91%,60%,0.5)] shadow-[0_0_15px_hsla(217,91%,60%,0.3)]",
    },
    {
      title: "Active Services",
      value: activeServices,
      change: `${pendingApprovals} pending approval`,
      changeType: "warning",
      icon: <Wrench className="w-6 h-6 text-white" />,
      iconBg: "bg-[hsla(38,92%,50%,0.2)] border-[hsla(38,92%,50%,0.5)] shadow-[0_0_15px_hsla(38,92%,50%,0.3)]",
    },
    {
      title: "Completed Services",
      value: completedServices,
      change: "All time",
      changeType: "positive",
      icon: <CheckCircle className="w-6 h-6 text-white" />,
      iconBg: "bg-[hsla(160,84%,39%,0.2)] border-[hsla(160,84%,39%,0.5)] shadow-[0_0_15px_hsla(160,84%,39%,0.3)]",
    },
    {
      title: "Product Orders",
      value: totalOrders,
      change: "Total orders",
      changeType: "info",
      icon: <ShoppingBag className="w-6 h-6 text-white" />,
      iconBg: "bg-[hsla(263,70%,58%,0.2)] border-[hsla(263,70%,58%,0.5)] shadow-[0_0_15px_hsla(263,70%,58%,0.3)]",
    },
    {
      title: "Total Revenue",
      value: `₹${totalRevenue.toLocaleString()}`,
      change: "All time earnings",
      changeType: "positive",
      icon: <TrendingUp className="w-6 h-6 text-white" />,
      iconBg: "bg-[hsla(160,84%,39%,0.2)] border-[hsla(160,84%,39%,0.5)] shadow-[0_0_15px_hsla(160,84%,39%,0.3)]",
    },
    {
      title: "Pending Approvals",
      value: pendingApprovals,
      change: "Partner verifications",
      changeType: "warning",
      icon: <Clock className="w-6 h-6 text-white" />,
      iconBg: "bg-[hsla(38,92%,50%,0.2)] border-[hsla(38,92%,50%,0.5)] shadow-[0_0_15px_hsla(38,92%,50%,0.3)]",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8 stagger-enter">
      {statsCards.map((card, index) => (
        <div 
          key={index} 
          className="glass-card p-5 group"
          data-testid={`stat-card-${card.title.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-[hsl(210,20%,75%)] font-medium">{card.title}</p>
              <p className="text-2xl font-bold text-white mt-1 tracking-tight">{card.value}</p>
              <p className={`text-xs mt-1 font-medium ${
                card.changeType === 'positive' ? 'text-[hsl(160,84%,65%)]' : 
                card.changeType === 'warning' ? 'text-[hsl(38,92%,65%)]' : 
                'text-[hsl(217,91%,70%)]'
              }`}>
                {card.change}
              </p>
            </div>
            <div className={`w-10 h-10 border rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110 ${card.iconBg}`}>
              {card.icon}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
