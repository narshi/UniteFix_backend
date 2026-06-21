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
      <Card className="col-span-2 glass-card stagger-enter">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <TrendingUp className="w-5 h-5" />
            Revenue Overview
          </CardTitle>
          <CardDescription className="text-[hsl(215,20%,55%)]">Last 30 days revenue trend</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] skeleton-shimmer rounded-xl"></div>
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
    <Card className="col-span-2 glass-card" data-testid="revenue-chart">
      <CardHeader className="flex flex-row items-center justify-between border-b border-[rgba(255,255,255,0.06)] mb-6 pb-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-white text-xl">
            <div className="p-2 rounded-lg bg-[hsla(160,84%,39%,0.15)] border border-[hsla(160,84%,39%,0.3)]">
              <TrendingUp className="w-5 h-5 text-[hsl(160,84%,65%)]" />
            </div>
            Revenue Overview
          </CardTitle>
          <CardDescription className="text-[hsl(215,20%,55%)] mt-1 tracking-wide">Last 30 days revenue trend</CardDescription>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-[hsl(210,20%,75%)] tracking-wider uppercase mb-1">Total Revenue</p>
          <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[hsl(160,84%,65%)] to-[hsl(160,84%,45%)] tracking-tight">
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
                  <stop offset="5%" stopColor="hsl(160,84%,45%)" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="hsl(160,84%,45%)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis 
                dataKey="date" 
                stroke="hsl(215,20%,55%)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                dy={10}
              />
              <YAxis 
                stroke="hsl(215,20%,55%)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `₹${value}`}
                dx={-10}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: 'hsl(222,40%,10%)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                  color: 'white',
                  backdropFilter: 'blur(16px)'
                }}
                itemStyle={{ color: 'hsl(160,84%,65%)', fontWeight: 'bold' }}
                labelStyle={{ color: 'hsl(215,20%,65%)', marginBottom: '4px' }}
                formatter={(value: number) => [`₹${value.toLocaleString('en-IN')}`, 'Revenue']}
              />
              <Area 
                type="monotone" 
                dataKey="revenue" 
                stroke="hsl(160,84%,55%)" 
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorRevenue)" 
                activeDot={{ r: 6, strokeWidth: 0, fill: "hsl(160,84%,65%)" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[300px] flex items-center justify-center text-[hsl(215,20%,55%)]">
            <div className="text-center">
              <TrendingUp className="w-12 h-12 mx-auto mb-3 text-[hsl(215,20%,35%)]" />
              <p className="font-medium text-[hsl(210,20%,85%)] mb-1">No revenue data available yet</p>
              <p className="text-sm">Revenue will appear as services are completed</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
