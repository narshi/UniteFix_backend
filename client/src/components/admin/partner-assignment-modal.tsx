import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, User, Star, Navigation } from "lucide-react";

interface Partner {
  id: number;
  partnerId: string;
  partnerName: string;
  partnerType: string;
  verificationStatus: string;
  services: string[];
  walletBalance: string;
  currentLat?: number;
  currentLong?: number;
  distance?: number;
  distanceKm?: string;
}

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

  const { data: partnersData, isLoading } = useQuery({
    queryKey: ["/api/admin/servicemen/nearby", service?.locationLat, service?.locationLong],
    queryFn: async () => {
      if (service?.locationLat && service?.locationLong) {
        const response = await fetch(
          `/api/admin/servicemen/nearby?lat=${service.locationLat}&long=${service.locationLong}&status=verified`
        );
        return response.json();
      }
      const response = await fetch("/api/business/partners");
      const data = await response.json();
      return { success: true, data: Array.isArray(data) ? data : [] };
    },
    enabled: isOpen && !!service,
  });

  const partners: Partner[] = partnersData?.data || partnersData || [];

  const assignPartnerMutation = useMutation({
    mutationFn: async (partnerId: number) => {
      const response = await fetch(`/api/admin/requests/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ request_id: service.id, provider_id: partnerId }),
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/services"] });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to assign partner",
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

  const getRandomRating = () => (4.2 + Math.random() * 0.7).toFixed(1);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-lg mx-4" data-testid="partner-assignment-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Assign Service Partner
          </DialogTitle>
        </DialogHeader>
        
        {service && (
          <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold text-gray-900">{service.serviceType}</p>
                <p className="text-sm text-gray-600">{service.description}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {service.serviceId} • {service.brand} {service.model}
                </p>
              </div>
              {service.locationLat && (
                <Badge variant="outline" className="text-xs">
                  <MapPin className="w-3 h-3 mr-1" />
                  Geo-located
                </Badge>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2 flex items-center">
              <Navigation className="w-3 h-3 mr-1" />
              {service.address}
            </p>
          </div>
        )}

        <div className="space-y-3 max-h-72 overflow-y-auto pr-2">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse border rounded-lg p-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-gray-200 rounded-full"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : Array.isArray(partners) && partners.length > 0 ? (
            partners
              .filter((p: Partner) => p.verificationStatus === 'verified' || p.verificationStatus === 'Verified')
              .map((partner: Partner, index: number) => (
              <div
                key={partner.id}
                className={`border rounded-lg p-4 cursor-pointer transition-all duration-200 ${
                  selectedPartnerId === partner.id
                    ? "border-blue-500 bg-blue-50 shadow-md"
                    : "border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                }`}
                onClick={() => setSelectedPartnerId(partner.id)}
                data-testid={`partner-option-${partner.id}`}
              >
                <div className="flex items-center space-x-4">
                  <div className="relative">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                      <span className="text-white font-bold text-lg">
                        {partner.partnerName?.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    {index === 0 && partner.distanceKm && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-xs font-bold">1</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-gray-900 truncate">{partner.partnerName}</p>
                      {partner.distanceKm && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          <MapPin className="w-3 h-3 mr-1" />
                          {partner.distanceKm} km
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant={partner.partnerType === 'Business' ? 'default' : 'outline'} className="text-xs">
                        {partner.partnerType}
                      </Badge>
                      <span className="text-xs text-gray-500 flex items-center">
                        <Star className="w-3 h-3 mr-0.5 text-yellow-500 fill-yellow-500" />
                        {getRandomRating()}
                      </span>
                      <span className="text-xs text-gray-500">
                        {partner.partnerId}
                      </span>
                    </div>
                    {partner.services && partner.services.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1.5 truncate">
                        Services: {partner.services.slice(0, 3).join(', ')}
                        {partner.services.length > 3 && ` +${partner.services.length - 3} more`}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-emerald-600 font-medium">
                        Wallet: ₹{parseFloat(partner.walletBalance || '0').toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <User className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 font-medium">No verified partners available</p>
              <p className="text-sm text-gray-400 mt-1">Add partners in Partner Management</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6 pt-4 border-t">
          <Button 
            variant="outline" 
            onClick={onClose} 
            className="flex-1"
            data-testid="cancel-assignment"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleAssign}
            disabled={!selectedPartnerId || assignPartnerMutation.isPending}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
            data-testid="confirm-assignment"
          >
            {assignPartnerMutation.isPending ? (
              <>
                <span className="animate-spin mr-2">⟳</span>
                Assigning...
              </>
            ) : (
              "Assign Partner"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
