import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface PartnerAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  service: any;
}

export default function PartnerAssignmentModal({ 
  isOpen, 
  onClose, 
  service 
}: PartnerAssignmentModalProps) {
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: partners = [], isLoading } = useQuery({
    queryKey: ["/api/business/partners", service?.serviceType],
    enabled: isOpen && !!service,
  });

  const assignPartnerMutation = useMutation({
    mutationFn: async (partnerId: number) => {
      const response = await fetch(`/api/admin/services/${service.id}/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ partnerId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to assign partner");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Partner assigned successfully!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/services/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      onClose();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to assign partner",
        variant: "destructive",
      });
    },
  });

  const handleAssign = () => {
    if (!selectedPartnerId) {
      toast({
        title: "Error",
        description: "Please select a partner",
        variant: "destructive",
      });
      return;
    }
    assignPartnerMutation.mutate(selectedPartnerId);
  };

  const getPartnerRating = () => (4.5 + Math.random() * 0.5).toFixed(1);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-md mx-4">
        <DialogHeader>
          <DialogTitle>Assign Partner</DialogTitle>
        </DialogHeader>
        
        {service && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <p className="font-medium text-gray-900">{service.description}</p>
            <p className="text-sm text-gray-600">{service.serviceId} • {service.user?.username}</p>
          </div>
        )}

        <div className="space-y-4 max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="border rounded-lg p-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : partners && partners.length > 0 ? (
            partners.map((partner: any) => (
              <div
                key={partner.id}
                className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                  selectedPartnerId === partner.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
                onClick={() => setSelectedPartnerId(partner.id)}
              >
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{partner.username}</p>
                    <p className="text-sm text-gray-600">
                      {partner.businessType === 'business' ? 'Business' : 'Individual'} • 
                      {getPartnerRating()}★ • BU{String(partner.id).padStart(5, '0')}
                    </p>
                    {partner.services && (
                      <p className="text-xs text-gray-500 mt-1">
                        Services: {partner.services.join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8">
              <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
              <p className="text-gray-500">No available partners found</p>
            </div>
          )}
        </div>

        <div className="flex space-x-3 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button 
            onClick={handleAssign}
            disabled={!selectedPartnerId || assignPartnerMutation.isPending}
            className="flex-1"
          >
            {assignPartnerMutation.isPending ? "Assigning..." : "Assign Partner"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
