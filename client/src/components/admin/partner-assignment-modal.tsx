import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
      const adminToken = localStorage.getItem("adminToken");
      const headers: Record<string, string> = {};
      if (adminToken) headers.Authorization = `Bearer ${adminToken}`;

      if (service?.locationLat && service?.locationLong) {
        const response = await fetch(
          `/api/admin/servicemen/nearby?lat=${service.locationLat}&long=${service.locationLong}&status=verified`,
          { headers }
        );
        return response.json();
      }
      const response = await fetch("/api/business/partners", { headers });
      const data = await response.json();
      return { success: true, data: Array.isArray(data) ? data : [] };
    },
    enabled: isOpen && !!service,
  });

  const partners: Partner[] = partnersData?.data || partnersData || [];

  const assignPartnerMutation = useMutation({
    mutationFn: async (partnerId: number) => {
      return await apiRequest("POST", `/api/admin/services/${service.id}/assign`, {
        technicianId: partnerId,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Employee assigned successfully!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/services/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/services"] });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to assign employee",
        variant: "destructive",
      });
    },
  });

  const handleAssign = () => {
    if (!selectedPartnerId) {
      toast({
        title: "Error",
        description: "Please select an employee",
        variant: "destructive",
      });
      return;
    }
    assignPartnerMutation.mutate(selectedPartnerId);
  };

  const getRandomRating = () => (4.2 + Math.random() * 0.7).toFixed(1);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-lg mx-4 glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.8)] shadow-[0_0_40px_rgba(0,0,0,0.5)]" data-testid="partner-assignment-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white text-xl">
            <div className="p-2 rounded-lg bg-[hsla(217,91%,60%,0.15)] border border-[hsla(217,91%,60%,0.3)]">
              <User className="w-5 h-5 text-[hsl(217,91%,65%)]" />
            </div>
            Assign Employee
          </DialogTitle>
        </DialogHeader>
        
        {service && (
          <div className="mb-4 p-4 bg-[rgba(255,255,255,0.03)] rounded-xl border border-[rgba(255,255,255,0.06)] shadow-inner">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold text-white text-lg tracking-tight">{service.serviceType}</p>
                <p className="text-sm text-[hsl(210,20%,85%)] mt-1">{service.description}</p>
                <p className="text-xs text-[hsl(215,20%,55%)] mt-2 font-medium">
                  {service.serviceId} <span className="mx-1 opacity-50">•</span> {service.brand} {service.model}
                </p>
              </div>
              {service.locationLat && (
                <Badge variant="outline" className="text-xs bg-[hsla(160,84%,39%,0.1)] border-[hsla(160,84%,39%,0.3)] text-[hsl(160,84%,65%)]">
                  <MapPin className="w-3 h-3 mr-1" />
                  Geo-located
                </Badge>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.06)]">
              <p className="text-xs text-[hsl(210,20%,75%)] flex items-center">
                <Navigation className="w-3 h-3 mr-1.5 text-[hsl(217,91%,60%)]" />
                {service.address}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="border border-[rgba(255,255,255,0.06)] rounded-xl p-4 bg-[rgba(255,255,255,0.02)]">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 skeleton-shimmer rounded-full shrink-0"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 skeleton-shimmer rounded w-3/4"></div>
                      <div className="h-3 skeleton-shimmer rounded w-1/2"></div>
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
                className={`border rounded-xl p-4 cursor-pointer transition-all duration-300 ${
                  selectedPartnerId === partner.id
                    ? "border-[hsla(217,91%,60%,0.5)] bg-[hsla(217,91%,60%,0.1)] shadow-[0_0_20px_hsla(217,91%,60%,0.15)] scale-[1.02]"
                    : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] hover:border-[rgba(255,255,255,0.1)]"
                }`}
                onClick={() => setSelectedPartnerId(partner.id)}
                data-testid={`partner-option-${partner.id}`}
              >
                <div className="flex items-center space-x-4">
                  <div className="relative shrink-0">
                    <div className="w-12 h-12 bg-gradient-to-br from-[hsl(217,91%,60%)] to-[hsl(263,70%,50%)] rounded-full flex items-center justify-center shadow-[0_4px_10px_rgba(0,0,0,0.3)]">
                      <span className="text-white font-bold text-lg">
                        {partner.partnerName?.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    {index === 0 && partner.distanceKm && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-[hsl(160,84%,45%)] border-2 border-[hsl(222,40%,10%)] rounded-full flex items-center justify-center shadow-sm">
                        <span className="text-white text-[10px] font-bold">1</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-white truncate text-[15px]">{partner.partnerName}</p>
                      {partner.distanceKm && (
                        <Badge variant="secondary" className="ml-2 text-[10px] bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.15)] border-transparent">
                          <MapPin className="w-3 h-3 mr-1 text-[hsl(217,91%,65%)]" />
                          {partner.distanceKm} km
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant={partner.partnerType === 'Business' ? 'default' : 'outline'} className="text-[10px] px-1.5 py-0">
                        {partner.partnerType}
                      </Badge>
                      <span className="text-xs text-[hsl(215,20%,65%)] flex items-center bg-[rgba(255,255,255,0.05)] px-1.5 py-0.5 rounded">
                        <Star className="w-3 h-3 mr-1 text-[hsl(38,92%,55%)] fill-[hsl(38,92%,55%)]" />
                        {getRandomRating()}
                      </span>
                      <span className="text-xs text-[hsl(215,20%,50%)]">
                        {partner.partnerId}
                      </span>
                    </div>
                    {partner.services && partner.services.length > 0 && (
                      <p className="text-xs text-[hsl(215,20%,65%)] mt-2 truncate">
                        Services: <span className="text-[hsl(210,20%,85%)]">{partner.services.slice(0, 3).join(', ')}</span>
                        {partner.services.length > 3 && ` +${partner.services.length - 3} more`}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-[rgba(255,255,255,0.04)]">
                      <span className="text-xs text-[hsl(160,84%,65%)] font-medium">
                        Wallet: ₹{parseFloat(partner.walletBalance || '0').toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-full flex items-center justify-center mx-auto mb-4">
                <User className="w-8 h-8 text-[hsl(215,20%,50%)]" />
              </div>
              <p className="text-[hsl(210,20%,85%)] font-medium">No verified employees available</p>
              <p className="text-sm text-[hsl(215,20%,55%)] mt-1">Add employees in Employee Management</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6 pt-4 border-t border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] -mx-4 -mb-4 p-4 rounded-b-xl">
          <Button 
            variant="outline" 
            onClick={onClose} 
            className="flex-1 border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.05)] text-[hsl(210,20%,85%)]"
            data-testid="cancel-assignment"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleAssign}
            disabled={!selectedPartnerId || assignPartnerMutation.isPending}
            className="flex-1 bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_14px_hsla(217,91%,60%,0.3)] hover:shadow-[0_6px_20px_hsla(217,91%,60%,0.4)] disabled:opacity-50 transition-all active:scale-[0.97]"
            data-testid="confirm-assignment"
          >
            {assignPartnerMutation.isPending ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Assigning...
              </span>
            ) : (
              "Assign Employee"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
