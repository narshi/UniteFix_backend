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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-pulse">
            <div className="h-20 bg-gray-200 rounded"></div>
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
      icon: <Users className="w-6 h-6 text-blue-600" />,
      iconBg: "bg-blue-100",
    },
    {
      title: "Active Services",
      value: activeServices,
      change: `${pendingApprovals} pending approval`,
      changeType: "warning",
      icon: <Wrench className="w-6 h-6 text-orange-600" />,
      iconBg: "bg-orange-100",
    },
    {
      title: "Completed Services",
      value: completedServices,
      change: "All time",
      changeType: "positive",
      icon: <CheckCircle className="w-6 h-6 text-green-600" />,
      iconBg: "bg-green-100",
    },
    {
      title: "Product Orders",
      value: totalOrders,
      change: "Total orders",
      changeType: "info",
      icon: <ShoppingBag className="w-6 h-6 text-purple-600" />,
      iconBg: "bg-purple-100",
    },
    {
      title: "Total Revenue",
      value: `₹${totalRevenue.toLocaleString()}`,
      change: "All time earnings",
      changeType: "positive",
      icon: <TrendingUp className="w-6 h-6 text-emerald-600" />,
      iconBg: "bg-emerald-100",
    },
    {
      title: "Pending Approvals",
      value: pendingApprovals,
      change: "Partner verifications",
      changeType: "warning",
      icon: <Clock className="w-6 h-6 text-amber-600" />,
      iconBg: "bg-amber-100",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
      {statsCards.map((card, index) => (
        <div 
          key={index} 
          className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
          data-testid={`stat-card-${card.title.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-gray-500 font-medium">{card.title}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
              <p className={`text-xs mt-1 ${
                card.changeType === 'positive' ? 'text-green-600' : 
                card.changeType === 'warning' ? 'text-orange-600' : 
                'text-gray-500'
              }`}>
                {card.change}
              </p>
            </div>
            <div className={`w-10 h-10 ${card.iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
              {card.icon}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
