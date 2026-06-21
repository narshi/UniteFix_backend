import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/admin/sidebar";
import StatsCards from "@/components/admin/stats-cards";
import RevenueChart from "@/components/admin/revenue-chart";
import RecentActivity from "@/components/admin/recent-activity";
import PendingAssignments from "@/components/admin/pending-assignments";
import QuickActions from "@/components/admin/quick-actions";
import PartnerAssignmentModal from "@/components/admin/partner-assignment-modal";

export default function Dashboard() {
  const [selectedService, setSelectedService] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const { toast } = useToast();

  const handleAssignPartner = (service: any) => {
    setSelectedService(service);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setSelectedService(null);
    setIsModalOpen(false);
  };

  const handleAddPartner = () => {
    setLocation("/partners");
  };

  const handleExportReport = async () => {
    try {
      // Fetch all necessary data for the report (uses apiRequest for auth token)
      const [statsRes, servicesRes, ordersRes, usersRes] = await Promise.all([
        apiRequest("GET", "/api/admin/stats"),
        apiRequest("GET", "/api/admin/services/recent"),
        apiRequest("GET", "/api/admin/orders/recent"),
        apiRequest("GET", "/api/admin/users"),
      ]);

      // Unwrap the { success, data } wrapper
      const stats = statsRes?.data || statsRes || {};
      const services = Array.isArray(servicesRes) ? servicesRes : (servicesRes?.data || []);
      const orders = Array.isArray(ordersRes) ? ordersRes : (ordersRes?.data || []);

      // Create CSV content
      const csvContent = [
        // Header
        ["UniteFix Admin Report", new Date().toLocaleDateString()],
        [],
        ["Summary Statistics"],
        ["Total Users", stats.totalUsers || 0],
        ["Active Services", stats.activeServices || 0],
        ["Product Orders", stats.totalOrders || 0],
        ["Total Revenue", `₹${stats.totalRevenue || 0}`],
        [],
        ["Recent Services"],
        ["Service ID", "Type", "Status", "Customer", "Created"],
        ...services.map((service: any) => [
          service.serviceId || "N/A",
          service.serviceType,
          service.status || "Pending",
          service.customerName || "Unknown",
          new Date(service.createdAt).toLocaleDateString()
        ]),
        [],
        ["Recent Orders"],
        ["Order ID", "Amount", "Status", "Customer", "Created"],
        ...orders.map((order: any) => [
          order.orderId || "N/A",
          `₹${order.totalAmount}`,
          order.status || "Pending",
          order.customerName || "Unknown",
          new Date(order.createdAt).toLocaleDateString()
        ])
      ];

      // Convert to CSV string
      const csv = csvContent.map(row => 
        row.map((cell: any) => `"${cell}"`).join(",")
      ).join("\n");

      // Create and download file
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `unitefix-report-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Report Exported",
        description: "Excel report has been downloaded successfully",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export report. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
      <main className="flex-1 p-8">
        <div className="mb-8 stagger-enter">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]">Dashboard Overview</h2>
              <p className="text-[hsl(215,20%,65%)] mt-1 tracking-wide uppercase text-sm font-medium">Uttara Kannada Service Region</p>
            </div>
            <div className="flex space-x-4">
              <button 
                onClick={handleExportReport}
                className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] text-white px-4 py-2 rounded-lg hover:bg-[rgba(255,255,255,0.08)] flex items-center space-x-2 transition-all active:scale-[0.97]"
              >
                <svg className="w-4 h-4 text-[hsl(210,20%,75%)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Export Report</span>
              </button>
              <button 
                onClick={handleAddPartner}
                className="bg-[hsl(160,84%,39%)] text-white px-4 py-2 rounded-lg hover:bg-[hsl(160,84%,34%)] shadow-[0_4px_14px_hsla(160,84%,39%,0.3)] hover:shadow-[0_6px_20px_hsla(160,84%,39%,0.4)] flex items-center space-x-2 transition-all active:scale-[0.97]"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span>Add Partner</span>
              </button>
            </div>
          </div>

          <StatsCards />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <RevenueChart />
          <QuickActions />
        </div>

        <RecentActivity />

        <div className="mt-8">
          <PendingAssignments onAssignPartner={handleAssignPartner} />
        </div>

        <PartnerAssignmentModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          service={selectedService}
        />
      </main>
  );
}
