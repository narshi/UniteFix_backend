import { useState } from "react";
import BusinessOverview from "@/components/admin/business-overview";
import PendingAssignments from "@/components/admin/pending-assignments";
import PartnerAssignmentModal from "@/components/admin/partner-assignment-modal";

/**
 * Admin home: the business overview (money by stream, jobs right now, what is
 * waiting on staff), then the jobs that need an expert — assignable in place.
 */
export default function Dashboard() {
  const [selectedService, setSelectedService] = useState<any>(null);

  return (
    <main className="min-w-0 flex-1 space-y-8 p-4 sm:p-6 xl:p-8">
      <BusinessOverview />
      <PendingAssignments onAssignPartner={setSelectedService} />
      <PartnerAssignmentModal isOpen={!!selectedService} onClose={() => setSelectedService(null)} service={selectedService} />
    </main>
  );
}
