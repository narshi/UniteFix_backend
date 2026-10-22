/**
 * Give a booking to a partner — or move it to another one — from Service
 * Requests. The partner then picks one of their own technicians. Works for a
 * booking that is unassigned, with a partner, or assigned / accepted but not
 * started (the technician it was with is taken off it and told).
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";

type Option = {
  id: number; partnerCode: string; name: string; phone: string | null;
  technicians: number; openJobs: number; covers: boolean; offers: boolean; current: boolean;
};

export default function SendToPartnerModal({ service, open, onClose }: { service: any; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const options = useQuery<{ data: Option[]; pincode: string | null }>({
    queryKey: ["/api/admin/services", service?.id, "partner-options"],
    enabled: open && !!service?.id,
    queryFn: async () => apiRequest("GET", `/api/admin/services/${service.id}/partner-options`),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/admin/services") });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/assignment-queue"] });
  };
  const send = useMutation({
    mutationFn: async (bpId: number) => apiRequest("POST", `/api/admin/services/${service.id}/assign-partner`, { businessPartnerId: bpId }),
    onSuccess: (r: any) => { toast({ title: "Sent to partner", description: r?.message }); refresh(); onClose(); },
    onError: (e) => toast({ title: "Not sent", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const recall = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/services/${service.id}/recall-partner`, {}),
    onSuccess: (r: any) => { toast({ title: "Taken back", description: r?.message }); refresh(); onClose(); },
    onError: (e) => toast({ title: "Not taken back", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!service) return null;
  const withPartnerUnassigned = !!service.dispatchPartnerId && !service.providerId && service.status === "created";
  const moving = !!service.providerId || !!service.dispatchPartnerId;
  const rows = options.data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg glass-panel border-[rgba(255,255,255,0.1)]">
        <DialogHeader>
          <DialogTitle className="text-white">{moving ? "Reassign to a partner" : "Send to a partner"}</DialogTitle>
          <DialogDescription className="text-[hsl(215,20%,65%)]">
            {service.serviceId} · {service.serviceType}{options.data?.pincode ? ` · ${options.data.pincode}` : ""}.{" "}
            {service.providerId
              ? `${service.technicianName ?? "The current technician"} is taken off it and told. `
              : service.dispatchPartnerId ? `It is with ${service.partnerName ?? "a partner"} now; they are told it moved. ` : ""}
            The partner picks one of their technicians by the assign-by time, or it comes back to the Assignment Queue.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto space-y-2">
          {options.isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p>
            : !rows.length ? <p className="text-sm text-[hsl(215,20%,65%)]">No partner can take jobs yet. A partner needs Field service and at least one verified technician.</p>
            : rows.map(p => (
              <div key={p.id} className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${p.covers && p.offers ? "border-[hsla(217,91%,60%,0.3)] bg-[hsla(217,91%,60%,0.05)]" : "border-[rgba(255,255,255,0.08)]"}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{p.name} <span className="font-mono text-[10px] text-[hsl(215,20%,55%)]">{p.partnerCode}</span></p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge className={`border-0 px-1.5 py-0 text-[10px] ${p.covers ? "bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)]" : "bg-[rgba(255,255,255,0.05)] text-[hsl(215,20%,55%)]"}`}>{p.covers ? "Covers this pincode" : "Not their area"}</Badge>
                    <Badge className={`border-0 px-1.5 py-0 text-[10px] ${p.offers ? "bg-[hsla(217,91%,60%,0.2)] text-[hsl(217,91%,70%)]" : "bg-[rgba(255,255,255,0.05)] text-[hsl(215,20%,55%)]"}`}>{p.offers ? "Takes this service" : "Service not on their list"}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-[hsl(215,20%,55%)]">{p.technicians} technician{p.technicians === 1 ? "" : "s"} · {p.openJobs} open job{p.openJobs === 1 ? "" : "s"}</p>
                </div>
                {p.current && !service.providerId ? (
                  <span className="shrink-0 text-xs text-[hsl(215,20%,60%)]">Has it now</span>
                ) : (
                  <Button
                    size="sm"
                    className="shrink-0 h-7 text-xs bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white"
                    disabled={send.isPending}
                    onClick={() => {
                      if (!(p.covers && p.offers)) {
                        const why = [!p.covers && "does not cover this pincode", !p.offers && "has not listed this service"].filter(Boolean).join(" and ");
                        if (!window.confirm(`${p.name} ${why}.\n\nSend the job to them anyway?`)) return;
                      }
                      send.mutate(p.id);
                    }}
                  >
                    Send
                  </Button>
                )}
              </div>
            ))}
        </div>

        {withPartnerUnassigned && (
          <div className="flex items-center justify-between gap-3 border-t border-[rgba(255,255,255,0.08)] pt-3">
            <p className="text-xs text-[hsl(215,20%,60%)]">Or take it back to the Assignment Queue and give it to a UniteFix expert.</p>
            <Button size="sm" variant="outline" disabled={recall.isPending} onClick={() => recall.mutate()} className="shrink-0 border-[rgba(255,255,255,0.15)] text-white bg-transparent">
              Take back
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
