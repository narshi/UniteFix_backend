import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";

interface RevenueData {
  date: string;
  revenue: number;
}

interface RevenueResponse {
  success: boolean;
  data: RevenueData[];
}

export default function RevenueChart() {
  const { data: revenueData, isLoading } = useQuery<RevenueResponse>({
    queryKey: ["/api/admin/revenue/chart"],
  });

  if (isLoading) {
    return (
      <Card className="col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Revenue Overview
          </CardTitle>
          <CardDescription>Last 30 days revenue trend</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] bg-gray-100 animate-pulse rounded-lg"></div>
        </CardContent>
      </Card>
    );
  }

  const chartData = revenueData?.data || [];
  
  const formattedData = chartData.map(item => ({
    ...item,
    date: new Date(item.date).toLocaleDateString('en-IN', { 
      month: 'short', 
      day: 'numeric' 
    }),
    revenue: item.revenue / 100
  }));

  const totalRevenue = chartData.reduce((sum, item) => sum + item.revenue, 0) / 100;

  return (
    <Card className="col-span-2" data-testid="revenue-chart">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
            Revenue Overview
          </CardTitle>
          <CardDescription>Last 30 days revenue trend</CardDescription>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">Total Revenue</p>
          <p className="text-2xl font-bold text-emerald-600">
            ₹{totalRevenue.toLocaleString('en-IN')}
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {formattedData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={formattedData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="date" 
                stroke="#6b7280"
                fontSize={12}
                tickLine={false}
              />
              <YAxis 
                stroke="#6b7280"
                fontSize={12}
                tickLine={false}
                tickFormatter={(value) => `₹${value}`}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}
                formatter={(value: number) => [`₹${value.toLocaleString('en-IN')}`, 'Revenue']}
              />
              <Area 
                type="monotone" 
                dataKey="revenue" 
                stroke="#10b981" 
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorRevenue)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[300px] flex items-center justify-center text-gray-500">
            <div className="text-center">
              <TrendingUp className="w-12 h-12 mx-auto mb-2 text-gray-300" />
              <p>No revenue data available yet</p>
              <p className="text-sm">Revenue will appear as services are completed</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
