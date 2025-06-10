import { useState } from "react";
import Sidebar from "@/components/admin/sidebar";
import StatsCards from "@/components/admin/stats-cards";
import RecentActivity from "@/components/admin/recent-activity";
import PendingAssignments from "@/components/admin/pending-assignments";
import QuickActions from "@/components/admin/quick-actions";
import PartnerAssignmentModal from "@/components/admin/partner-assignment-modal";

export default function Dashboard() {
  const [selectedService, setSelectedService] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleAssignPartner = (service: any) => {
    setSelectedService(service);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setSelectedService(null);
    setIsModalOpen(false);
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
              <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Export Report</span>
              </button>
              <button className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center space-x-2">
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
