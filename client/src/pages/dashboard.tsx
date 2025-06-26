import { useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/admin/sidebar";
import StatsCards from "@/components/admin/stats-cards";
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
      // Fetch all necessary data for the report
      const [statsResponse, servicesResponse, ordersResponse, usersResponse] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/services/recent"),
        fetch("/api/admin/orders/recent"),
        fetch("/api/admin/users")
      ]);

      const stats = await statsResponse.json();
      const services = await servicesResponse.json();
      const orders = await ordersResponse.json();
      const users = await usersResponse.json();

      // Create CSV content
      const csvContent = [
        // Header
        ["UniteFix Admin Report", new Date().toLocaleDateString()],
        [],
        ["Summary Statistics"],
        ["Total Users", stats.totalUsers],
        ["Active Services", stats.activeServices],
        ["Product Orders", stats.productOrders],
        ["Total Revenue", `₹${stats.revenue}`],
        [],
        ["Recent Services"],
        ["Service ID", "Type", "Status", "Customer", "Created"],
        ...services.map((service: any) => [
          service.serviceId || "N/A",
          service.serviceType,
          service.status || "Pending",
          service.user?.username || "Unknown",
          new Date(service.createdAt).toLocaleDateString()
        ]),
        [],
        ["Recent Orders"],
        ["Order ID", "Amount", "Status", "Customer", "Created"],
        ...orders.map((order: any) => [
          order.orderId || "N/A",
          `₹${order.totalAmount}`,
          order.status || "Pending",
          order.user?.username || "Unknown",
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
        <div className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Dashboard Overview</h2>
              <p className="text-gray-600">Uttara Kannada Service Region</p>
            </div>
            <div className="flex space-x-4">
              <button 
                onClick={handleExportReport}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Export Report</span>
              </button>
              <button 
                onClick={handleAddPartner}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center space-x-2"
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

        <RecentActivity />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
          <div className="lg:col-span-2">
            <PendingAssignments onAssignPartner={handleAssignPartner} />
          </div>
          <div>
            <QuickActions />
          </div>
        </div>

        <PartnerAssignmentModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          service={selectedService}
        />
      </main>
  );
}
