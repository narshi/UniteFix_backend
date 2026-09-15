/**
 * Assignment Queue — Dedicated admin page for assigning employees to service requests
 * 
 * Left panel: Priority-sorted request queue with filters
 * Right panel: Available employees with workload indicators
 */

import { useState, useMemo, useEffect } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import {
  Search, Clock, AlertTriangle, User, Phone, MapPin,
  Briefcase, Star, CheckCircle, ArrowRight, Image, RefreshCw,
} from "lucide-react";

interface QueueItem {
  id: number;
  serviceId: string;
  serviceType: string;
  brand?: string;
  model?: string;
  description: string;
  photos?: string[];
  urgency: string;
  address: string;
  bookingFeeStatus: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  waitingHours: number;
  /** Where the job is. Read off the address when it contains one, else the customer's profile. */
  pinCode?: string | null;
  pinCodeSource?: 'address' | 'profile' | null;
  categoryId?: number | null;
  categoryName?: string | null;
  /** Trades that can work this booking. Empty means no restriction. */
  requiredTechnicianTypeIds?: number[];
  requiredTechnicianTypeNames?: string[];
}

interface EmployeeItem {
  id: number;
  fullName: string;
  partnerId: string;
  phone: string;
  services: string[];
  /** Trade ids the expert holds. Matched against a booking's requirement. */
  technicianTypeIds?: number[];
  /** The expert's base-location pincode. */
  pinCode?: string | null;
  isOnline: boolean;
  activeJobCount: number;
  completedJobCount: number;
  averageRating: string;
  partnerType?: string;
  partsEnabled?: boolean;
}

/**
 * Expert-side filters. Each one narrows; "any" is the neutral value. Kept as
 * one object so the count of active filters — shown on the button — is one
 * line, and so reset is one assignment.
 */
interface ExpertFilters {
  trade: string;          // a trade name from emp.services, or "any"
  match: "any" | "qualified";
  area: "any" | "same" | "pincode";
  pincode: string;        // used when area === "pincode"; prefix match
  online: "any" | "online";
  workload: "any" | "free" | "light";
  minRating: "any" | "3" | "4" | "4.5";
  partnerType: string;    // "any" | "Individual" | "Business" …
  parts: "any" | "enabled";
}
const NO_FILTERS: ExpertFilters = { trade: "any", match: "any", area: "any", pincode: "", online: "any", workload: "any", minRating: "any", partnerType: "any", parts: "any" };
const activeFilterCount = (f: ExpertFilters) =>
  (f.trade !== "any" ? 1 : 0) + (f.match !== "any" ? 1 : 0) + (f.area !== "any" ? 1 : 0) + (f.online !== "any" ? 1 : 0)
  + (f.workload !== "any" ? 1 : 0) + (f.minRating !== "any" ? 1 : 0) + (f.partnerType !== "any" ? 1 : 0) + (f.parts !== "any" ? 1 : 0);

interface QueueStats {
  totalPending: number;
  urgentCount: number;
  avgWaitHours: number;
  oldestHours: number;
}

export default function AssignmentQueuePage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [serviceTypeFilter, setServiceTypeFilter] = useState("all");
  const [selectedRequest, setSelectedRequest] = useState<QueueItem | null>(null);
  // Expert search and filters. Off by default: seeing everyone who *could*
  // take the job is the point; the dispatcher narrows when the list is long.
  const [expertSearch, setExpertSearch] = useState("");
  const [filters, setFilters] = useState<ExpertFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const onlineOnly = filters.online === "online";
  const setOnlineOnly = (fn: (v: boolean) => boolean) => setFilters(f => ({ ...f, online: fn(f.online === "online") ? "online" : "any" }));
  const { toast } = useToast();
  // ?request=<id> — opened from the Services page's Assign action with a
  // booking already chosen.
  const searchString = useSearch();
  const requestedId = useMemo(() => { const v = new URLSearchParams(searchString).get("request"); return v ? Number(v) : null; }, [searchString]);

  // Fetch assignment queue data
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/assignment-queue"],
    refetchInterval: 30000, // Auto-refresh every 30s
  });

  const queue: QueueItem[] = (data as any)?.queue || [];
  const employees: EmployeeItem[] = (data as any)?.employees || [];

  useEffect(() => {
    if (!requestedId || selectedRequest || !queue.length) return;
    const hit = queue.find(r => r.id === requestedId);
    if (hit) setSelectedRequest(hit);
    else toast({ title: "Not in the queue", description: "That booking is not awaiting assignment (already assigned, unpaid, or cancelled)." });
  }, [requestedId, queue.length]);

  // Trade and partner-type options come from the roster itself, so the
  // dropdowns never offer a value that matches nobody.
  const tradeOptions = useMemo(() => Array.from(new Set(employees.flatMap(e => e.services ?? []))).sort(), [employees]);
  const partnerTypeOptions = useMemo(() => Array.from(new Set(employees.map(e => e.partnerType).filter(Boolean) as string[])).sort(), [employees]);
  const stats: QueueStats = (data as any)?.stats || { totalPending: 0, urgentCount: 0, avgWaitHours: 0, oldestHours: 0 };

  // Get unique service types for filter dropdown
  const serviceTypes = useMemo(() => {
    const types = new Set(queue.map((r) => r.serviceType).filter(Boolean));
    return Array.from(types).sort();
  }, [queue]);

  // Filter and sort queue
  const filteredQueue = useMemo(() => {
    let filtered = [...queue];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.serviceId?.toLowerCase().includes(term) ||
          r.customerName?.toLowerCase().includes(term) ||
          r.address?.toLowerCase().includes(term) ||
          r.serviceType?.toLowerCase().includes(term)
      );
    }

    // Urgency filter
    if (urgencyFilter !== "all") {
      filtered = filtered.filter((r) => r.urgency === urgencyFilter);
    }

    // Service type filter
    if (serviceTypeFilter !== "all") {
      filtered = filtered.filter((r) => r.serviceType === serviceTypeFilter);
    }

    // Sort: urgent first, then by longest waiting
    filtered.sort((a, b) => {
      if (a.urgency === "urgent" && b.urgency !== "urgent") return -1;
      if (a.urgency !== "urgent" && b.urgency === "urgent") return 1;
      return b.waitingHours - a.waitingHours;
    });

    return filtered;
  }, [queue, searchTerm, urgencyFilter, serviceTypeFilter]);

  /**
   * Is this expert qualified for the selected booking?
   *
   * Previously this compared emp.services (trade names, "Computer Technician")
   * against request.serviceType (a catalog SERVICE name, "CCTV Installation").
   * Those are different vocabularies, so it was always false — the Match badge
   * never appeared and the sort did nothing. Both sides are now technician type
   * IDS, resolved server-side through the category mapping.
   *
   * An empty requirement list means the category has no trades mapped (or the
   * booking carries no catalog service). That reads as "no restriction known",
   * so EVERYONE qualifies — never nobody.
   */
  const isQualified = (emp: EmployeeItem, request: QueueItem | null): boolean => {
    if (!request) return false;
    const required = request.requiredTechnicianTypeIds ?? [];
    if (required.length === 0) return true;
    return (emp.technicianTypeIds ?? []).some((id) => required.includes(id));
  };

  /** True when the booking imposes no trade requirement at all. */
  const isUnrestricted = (request: QueueItem | null): boolean =>
    !request || (request.requiredTechnicianTypeIds ?? []).length === 0;

  /** Same pincode as the job. Blank on either side is not a match, not a guess. */
  const isSameArea = (emp: EmployeeItem, request: QueueItem | null): boolean => {
    const jobPin = String(request?.pinCode ?? '').trim();
    const empPin = String(emp.pinCode ?? '').trim();
    return jobPin.length > 0 && jobPin === empPin;
  };

  /**
   * Trade first, then area, then availability, then workload.
   *
   * Trade outranks area because the wrong trade cannot do the job at all,
   * whereas a nearby expert is only a convenience. Online outranks workload so
   * that among equally suitable people the reachable one surfaces — but offline
   * experts are still listed and still assignable: an admin scheduling
   * tomorrow's work needs everyone who could take it, not just whoever has the
   * app open.
   */
  const sortedEmployees = useMemo(() => {
    const q = expertSearch.trim().toLowerCase();
    const sorted = employees.filter((e) => {
      if (q) {
        const hay = [e.fullName, e.partnerId, e.phone, e.pinCode, ...(e.services ?? [])].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.online === "online" && !e.isOnline) return false;
      if (filters.trade !== "any" && !(e.services ?? []).includes(filters.trade)) return false;
      if (filters.match === "qualified" && !isQualified(e, selectedRequest)) return false;
      if (filters.area === "same" && !isSameArea(e, selectedRequest)) return false;
      if (filters.area === "pincode" && filters.pincode.trim() && !String(e.pinCode ?? "").startsWith(filters.pincode.trim())) return false;
      if (filters.workload === "free" && e.activeJobCount > 0) return false;
      if (filters.workload === "light" && e.activeJobCount > 2) return false;
      if (filters.minRating !== "any" && parseFloat(e.averageRating || "0") < Number(filters.minRating)) return false;
      if (filters.partnerType !== "any" && e.partnerType !== filters.partnerType) return false;
      if (filters.parts === "enabled" && !e.partsEnabled) return false;
      return true;
    });
    sorted.sort((a, b) => {
      if (selectedRequest) {
        const aQ = isQualified(a, selectedRequest) ? 1 : 0;
        const bQ = isQualified(b, selectedRequest) ? 1 : 0;
        if (aQ !== bQ) return bQ - aQ;

        const aArea = isSameArea(a, selectedRequest) ? 1 : 0;
        const bArea = isSameArea(b, selectedRequest) ? 1 : 0;
        if (aArea !== bArea) return bArea - aArea;
      }
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return a.activeJobCount - b.activeJobCount;
    });
    return sorted;
  }, [employees, selectedRequest, expertSearch, filters]);

  const qualifiedCount = useMemo(
    () => sortedEmployees.filter((e) => isQualified(e, selectedRequest)).length,
    [sortedEmployees, selectedRequest],
  );

  // Assign mutation
  const assignMutation = useMutation({
    mutationFn: async ({ requestId, employeeId }: { requestId: number; employeeId: number }) => {
      return await apiRequest("POST", `/api/admin/services/${requestId}/assign`, {
        technicianId: employeeId,
      });
    },
    onSuccess: () => {
      toast({ title: "Employee Assigned ✅", description: "The request has been assigned successfully." });
      setSelectedRequest(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/assignment-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/services/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/services"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    },
    onError: (error: Error) => {
      toast({ title: "Assignment Failed", description: error.message, variant: "destructive" });
    },
  });

  const getUrgencyBadge = (urgency: string, waitingHours: number) => {
    if (urgency === "urgent") {
      return <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded-full flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Urgent</span>;
    }
    if (waitingHours > 24) {
      return <span className="px-2 py-0.5 bg-red-50 text-red-600 text-xs font-medium rounded-full">{formatWait(waitingHours)}</span>;
    }
    if (waitingHours > 12) {
      return <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs font-medium rounded-full">{formatWait(waitingHours)}</span>;
    }
    return <span className="px-2 py-0.5 bg-green-50 text-green-700 text-xs font-medium rounded-full">{formatWait(waitingHours)}</span>;
  };

  const getWorkloadBadge = (count: number) => {
    if (count === 0) return <Badge variant="outline" className="bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-[hsla(160,84%,39%,0.3)] text-xs">{count} jobs</Badge>;
    if (count <= 2) return <Badge variant="outline" className="bg-[hsla(38,92%,50%,0.15)] text-[hsl(38,92%,60%)] border-[hsla(38,92%,50%,0.3)] text-xs">{count} jobs</Badge>;
    return <Badge variant="outline" className="bg-[hsla(347,77%,50%,0.15)] text-[hsl(347,77%,65%)] border-[hsla(347,77%,50%,0.3)] text-xs">{count} jobs</Badge>;
  };

  const formatWait = (hours: number) => {
    if (hours < 1) return "< 1h";
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = Math.floor(hours / 24);
    const h = Math.round(hours % 24);
    return `${days}d ${h}h`;
  };

  return (
    <div className="flex-1 p-6 h-screen overflow-hidden flex flex-col min-h-screen relative overflow-hidden bg-transparent">
      {/* Header */}
      <div className="mb-4 relative z-10 stagger-enter">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]">Assignment Queue</h2>
            <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide mt-1">Assign employees to pending service requests</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="flex items-center gap-2 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.1)] transition-all">
            <RefreshCw className="w-4 h-4 text-[hsl(217,91%,60%)]" /> Refresh
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-4 mb-4 relative z-10 stagger-enter">
        <div className="glass-card rounded-xl border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-4 flex items-center gap-4 transition-shadow">
          <div className="w-12 h-12 rounded-xl bg-[hsla(217,91%,60%,0.1)] border border-[hsla(217,91%,60%,0.2)] flex items-center justify-center">
            <Briefcase className="w-6 h-6 text-[hsl(217,91%,60%)]" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{stats.totalPending}</p>
            <p className="text-xs text-[hsl(215,20%,65%)] uppercase tracking-wider font-medium">Total Pending</p>
          </div>
        </div>
        <div className="glass-card rounded-xl border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-4 flex items-center gap-4 transition-shadow">
          <div className="w-12 h-12 rounded-xl bg-[hsla(347,77%,50%,0.1)] border border-[hsla(347,77%,50%,0.2)] flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-[hsl(347,77%,65%)]" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[hsl(347,77%,65%)]">{stats.urgentCount}</p>
            <p className="text-xs text-[hsl(215,20%,65%)] uppercase tracking-wider font-medium">Urgent</p>
          </div>
        </div>
        <div className="glass-card rounded-xl border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-4 flex items-center gap-4 transition-shadow">
          <div className="w-12 h-12 rounded-xl bg-[hsla(38,92%,50%,0.1)] border border-[hsla(38,92%,50%,0.2)] flex items-center justify-center">
            <Clock className="w-6 h-6 text-[hsl(38,92%,60%)]" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{formatWait(stats.avgWaitHours)}</p>
            <p className="text-xs text-[hsl(215,20%,65%)] uppercase tracking-wider font-medium">Avg Wait</p>
          </div>
        </div>
        <div className="glass-card rounded-xl border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-4 flex items-center gap-4 transition-shadow">
          <div className="w-12 h-12 rounded-xl bg-[hsla(27,90%,55%,0.1)] border border-[hsla(27,90%,55%,0.2)] flex items-center justify-center">
            <Clock className="w-6 h-6 text-[hsl(27,90%,60%)]" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[hsl(27,90%,60%)]">{formatWait(stats.oldestHours)}</p>
            <p className="text-xs text-[hsl(215,20%,65%)] uppercase tracking-wider font-medium">Oldest Request</p>
          </div>
        </div>
      </div>

      {/* Main Split Panel */}
      <div className="flex-1 grid grid-cols-3 gap-4 min-h-0 relative z-10 stagger-enter">

        {/* LEFT: Request Queue (2/3 width) */}
        <div className="col-span-2 flex flex-col min-h-0">
          <Card className="flex-1 flex flex-col min-h-0 glass-card border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]">
            <CardHeader className="pb-3 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl mb-4">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[hsl(215,20%,50%)]" />
                  <Input
                    placeholder="Search by ID, customer, address, or type..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-9 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[hsl(215,20%,40%)] focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                  />
                </div>
                <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
                  <SelectTrigger className="w-36 h-9 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:ring-[hsla(217,91%,60%,0.3)]">
                    <SelectValue placeholder="Urgency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Urgency</SelectItem>
                    <SelectItem value="urgent">🔴 Urgent</SelectItem>
                    <SelectItem value="normal">🟢 Normal</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={serviceTypeFilter} onValueChange={setServiceTypeFilter}>
                  <SelectTrigger className="w-44 h-9 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:ring-[hsla(217,91%,60%,0.3)]">
                    <SelectValue placeholder="Service Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {serviceTypes.map((type) => type ? (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ) : null)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto px-4 pb-4 custom-scrollbar">
              {isLoading ? (
                <div className="space-y-3 skeleton-shimmer">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="animate-pulse h-20 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.05)] rounded-lg" />
                  ))}
                </div>
              ) : filteredQueue.length === 0 ? (
                <div className="text-center py-16">
                  <CheckCircle className="w-12 h-12 text-[hsl(160,84%,60%)] mx-auto mb-3 opacity-80" />
                  <p className="text-white font-medium">All caught up!</p>
                  <p className="text-sm text-[hsl(215,20%,55%)]">No pending assignments right now.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredQueue.map((req) => (
                    <div
                      key={req.id}
                      onClick={() => setSelectedRequest(req)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 group ${
                        selectedRequest?.id === req.id
                          ? "border-[hsl(217,91%,60%)] bg-[hsla(217,91%,60%,0.1)] shadow-[0_0_15px_hsla(217,91%,60%,0.2)]"
                          : req.urgency === "urgent"
                          ? "border-[hsla(347,77%,50%,0.3)] bg-[hsla(347,77%,50%,0.05)] hover:border-[hsla(347,77%,50%,0.5)] hover:bg-[hsla(347,77%,50%,0.1)]"
                          : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] hover:border-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.03)]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {(req as any).categoryName && (
                              <span className="text-[10px] uppercase tracking-wider font-bold text-[hsl(217,91%,70%)] bg-[hsla(217,91%,60%,0.12)] border border-[hsla(217,91%,60%,0.25)] rounded px-1.5 py-0.5">
                                {(req as any).categoryName}
                              </span>
                            )}
                            <p className="font-semibold text-white text-sm group-hover:text-[hsl(217,91%,70%)] transition-colors">{(req as any).serviceName || req.serviceType || 'General'}</p>
                            {getUrgencyBadge(req.urgency, req.waitingHours)}
                            {req.photos && req.photos.length > 0 && (
                              <span className="text-xs text-[hsl(215,20%,55%)] flex items-center gap-0.5">
                                <Image className="w-3 h-3 text-[hsl(217,91%,60%)]" />{req.photos.length}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[hsl(215,20%,65%)] truncate"><span className="text-[hsl(215,20%,45%)]">Note: </span>{req.description}</p>
                          <div className="flex items-center gap-4 mt-1.5">
                            <span className="text-xs text-[hsl(215,20%,55%)] flex items-center gap-1">
                              <User className="w-3 h-3 text-[hsl(217,91%,60%)]" />{req.customerName}
                            </span>
                            <span className="text-xs text-[hsl(215,20%,55%)] flex items-center gap-1">
                              <Phone className="w-3 h-3 text-[hsl(160,84%,60%)]" />{req.customerPhone}
                            </span>
                            <span className="text-xs text-[hsl(215,20%,55%)] flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-[hsl(347,77%,60%)]" />{req.address?.slice(0, 30)}{req.address?.length > 30 ? "..." : ""}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-mono text-[hsl(210,20%,80%)]">{req.serviceId}</p>
                          <p className="text-xs text-[hsl(215,20%,55%)] mt-0.5">
                            {req.brand} {req.model}
                          </p>
                          {req.createdAt && (
                            <p className="text-[10px] text-[hsl(215,20%,45%)] mt-1 flex items-center justify-end gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(req.createdAt).toLocaleString(undefined, {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Employee Panel (1/3 width) */}
        <div className="flex flex-col min-h-0">
          <Card className="flex-1 flex flex-col min-h-0 glass-card border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]">
            <CardHeader className="pb-3 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl mb-4">
              <CardTitle className="text-base flex items-center gap-2 text-white">
                <User className="w-4 h-4 text-[hsl(217,91%,60%)]" />
                Employees ({sortedEmployees.length}{sortedEmployees.length !== employees.length ? ` of ${employees.length}` : ""})
                {selectedRequest && (
                  <Badge variant="secondary" className="ml-auto text-xs font-normal bg-[hsla(217,91%,60%,0.1)] text-[hsl(217,91%,70%)] border-[hsla(217,91%,60%,0.2)]">
                    Sorted for: {selectedRequest.serviceType}
                  </Badge>
                )}
              </CardTitle>
              {/* Search + filters. The roster grows with every onboarding; a
                  dispatcher should find one person by name, code, phone or
                  pincode without scrolling, and narrow by trade, area,
                  availability and workload without the panel turning into a
                  wall of dropdowns — hence the sheet. */}
              <div className="mt-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[hsl(215,20%,50%)]" />
                  <Input
                    placeholder="Name, ID, phone, pincode, trade…"
                    value={expertSearch}
                    onChange={(e) => setExpertSearch(e.target.value)}
                    className="pl-9 h-9 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[hsl(215,20%,40%)] focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFiltersOpen(true)}
                  className={`h-9 border-[rgba(255,255,255,0.1)] text-[hsl(210,20%,85%)] hover:bg-[rgba(255,255,255,0.05)] ${activeFilterCount(filters) > 0 ? "border-[hsla(217,91%,60%,0.5)] text-[hsl(217,91%,70%)]" : ""}`}
                >
                  Filters{activeFilterCount(filters) > 0 && <span className="ml-1.5 rounded bg-[hsla(217,91%,60%,0.25)] px-1.5 text-[10px]">{activeFilterCount(filters)}</span>}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto px-4 pb-4 custom-scrollbar">
              {!selectedRequest ? (
                <div className="text-center py-12">
                  <ArrowRight className="w-8 h-8 text-[hsl(215,20%,40%)] mx-auto mb-3 rotate-180" />
                  <p className="text-[hsl(210,20%,80%)] text-sm font-medium">Select a request from the queue</p>
                  <p className="text-[hsl(215,20%,50%)] text-xs mt-1">to see available employees</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* States why experts are ordered the way they are — without it
                      the Match badges look arbitrary. */}
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-[hsl(215,20%,60%)]">
                      {selectedRequest.pinCode ? (
                        <>
                          Job pincode{" "}
                          <span className="font-mono text-[hsl(210,20%,85%)]">{selectedRequest.pinCode}</span>
                          <span className="text-[hsl(215,20%,45%)]">
                            {" "}({selectedRequest.pinCodeSource === "address" ? "from address" : "from customer profile"})
                          </span>
                        </>
                      ) : (
                        <span className="text-[hsl(38,92%,60%)]">No pincode on this booking — area matching unavailable</span>
                      )}
                    </p>
                    <button
                      onClick={() => setOnlineOnly((v) => !v)}
                      className={`text-[10px] px-2 py-1 rounded border transition-colors whitespace-nowrap ${onlineOnly
                        ? "border-[hsla(160,84%,39%,0.4)] text-[hsl(160,84%,65%)] bg-[hsla(160,84%,39%,0.12)]"
                        : "border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,60%)] hover:text-white"}`}
                    >
                      {onlineOnly ? "Online only" : "All experts"}
                    </button>
                  </div>

                  <div className="mb-3 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)]">
                    {isUnrestricted(selectedRequest) ? (
                      <p className="text-[11px] text-[hsl(215,20%,60%)]">
                        No trade mapped for{" "}
                        <span className="text-[hsl(210,20%,80%)]">
                          {selectedRequest.categoryName ?? "this booking"}
                        </span>
                        {" "}— every expert is eligible.
                      </p>
                    ) : (
                      <>
                        <p className="text-[11px] text-[hsl(215,20%,60%)] mb-1">
                          {selectedRequest.categoryName} needs:
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {(selectedRequest.requiredTechnicianTypeNames ?? []).map((t) => (
                            <Badge
                              key={t}
                              className="bg-[hsla(217,91%,60%,0.15)] text-[hsl(217,91%,70%)] border-0 text-[10px] px-1.5 py-0"
                            >
                              {t}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-[10px] text-[hsl(215,20%,45%)] mt-1.5">
                          {qualifiedCount} of {sortedEmployees.length} experts qualify. Others can still be assigned.
                        </p>
                      </>
                    )}
                  </div>
                  {sortedEmployees.map((emp) => {
                    const matchesService = isQualified(emp, selectedRequest);
                    const sameArea = isSameArea(emp, selectedRequest);
                    // No badge when nothing is required — flagging every expert
                    // as a "Match" would make the badge meaningless.
                    const showMatchBadge = matchesService && !isUnrestricted(selectedRequest);
                    return (
                      <div
                        key={emp.id}
                        className={`p-3 rounded-lg border transition-all ${
                          matchesService
                            ? "border-[hsla(217,91%,60%,0.3)] bg-[hsla(217,91%,60%,0.05)] hover:border-[hsla(217,91%,60%,0.5)] hover:bg-[hsla(217,91%,60%,0.1)]"
                            : "border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)] opacity-70 hover:opacity-100 hover:border-[rgba(255,255,255,0.1)]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-white text-sm">{emp.fullName}</p>
                              {emp.isOnline ? (
                                <span className="w-2 h-2 bg-[hsl(160,84%,60%)] shadow-[0_0_8px_hsla(160,84%,60%,0.8)] rounded-full" title="Online" />
                              ) : (
                                // Named, not merely absent. A missing dot is too
                                // easy to miss when deciding who to call.
                                <span className="text-[10px] text-[hsl(215,20%,45%)] border border-[rgba(255,255,255,0.1)] rounded px-1">
                                  offline
                                </span>
                              )}
                              {sameArea && (
                                <Badge className="bg-[hsla(160,84%,39%,0.15)] text-[hsl(160,84%,65%)] border-0 text-[10px] px-1.5 py-0">
                                  Same area
                                </Badge>
                              )}
                              {showMatchBadge && (
                                <Badge className="bg-[hsla(217,91%,60%,0.2)] text-[hsl(217,91%,70%)] border-0 text-[10px] px-1.5 py-0">
                                  Match
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-[hsl(215,20%,65%)]">{emp.partnerId}</span>
                              <span className="text-xs text-[hsl(215,20%,40%)]">•</span>
                              <span className="text-xs text-[hsl(215,20%,65%)] flex items-center gap-0.5">
                                <Star className="w-3 h-3 text-[hsl(38,92%,60%)] fill-[hsl(38,92%,60%)]" />
                                {parseFloat(emp.averageRating).toFixed(1)}
                              </span>
                              <span className="text-xs text-[hsl(215,20%,40%)]">•</span>
                              <span className="text-xs text-[hsl(215,20%,65%)]">{emp.completedJobCount} done</span>
                            </div>
                            {emp.pinCode ? (
                              <p className="text-[10px] text-[hsl(215,20%,50%)] font-mono mt-0.5">
                                PIN {emp.pinCode}
                              </p>
                            ) : (
                              <p className="text-[10px] text-[hsl(38,92%,55%)] mt-0.5">no base pincode set</p>
                            )}
                            {emp.services && emp.services.length > 0 && (
                              <p className="text-[11px] text-[hsl(215,20%,50%)] mt-1 truncate">
                                {emp.services.slice(0, 3).join(", ")}
                                {emp.services.length > 3 && ` +${emp.services.length - 3}`}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            {getWorkloadBadge(emp.activeJobCount)}
                            <Button
                              size="sm"
                              className="h-7 text-xs px-3 bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_2px_8px_hsla(217,91%,60%,0.3)] transition-all active:scale-95"
                              disabled={assignMutation.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                // Advisory, not a gate. On a night when nobody
                                // with the right trade is free the job still has
                                // to go out, so this confirms rather than blocks.
                                if (!matchesService) {
                                  const trades = (selectedRequest.requiredTechnicianTypeNames ?? []).join(", ");
                                  const ok = window.confirm(
                                    `${emp.fullName} is not registered for ${trades || "this work"}.\n\nAssign anyway?`
                                  );
                                  if (!ok) return;
                                }
                                assignMutation.mutate({
                                  requestId: selectedRequest.id,
                                  employeeId: emp.id,
                                });
                              }}
                            >
                              {assignMutation.isPending ? "..." : "Assign"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {sortedEmployees.length === 0 && (
                    <div className="text-center py-8">
                      <User className="w-8 h-8 text-[hsl(215,20%,40%)] mx-auto mb-2" />
                      {employees.length > 0 ? (
                        <>
                          <p className="text-sm text-[hsl(210,20%,80%)]">Nobody matches the search and filters</p>
                          <button type="button" className="text-xs text-[hsl(217,91%,70%)] underline underline-offset-2 mt-1" onClick={() => { setExpertSearch(""); setFilters(NO_FILTERS); }}>
                            Clear search and filters ({employees.length} experts)
                          </button>
                        </>
                      ) : (
                        <p className="text-sm text-[hsl(215,20%,55%)]">No verified employees available</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent className="w-[360px] overflow-y-auto bg-[hsl(222,40%,10%)] border-[rgba(255,255,255,0.08)] text-white">
          <SheetHeader>
            <SheetTitle className="text-white">Filter experts</SheetTitle>
            <SheetDescription className="text-[hsl(215,20%,60%)]">Narrow the roster. Everyone still qualifies for assignment; these only decide who is listed.</SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-4">
            <FilterField label="Trade">
              <Select value={filters.trade} onValueChange={(v) => setFilters(f => ({ ...f, trade: v }))}>
                <SelectTrigger className={SHEET_SELECT}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="any">Any trade</SelectItem>{tradeOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Trade match for this booking">
              <Select value={filters.match} onValueChange={(v) => setFilters(f => ({ ...f, match: v as ExpertFilters["match"] }))} disabled={!selectedRequest || isUnrestricted(selectedRequest)}>
                <SelectTrigger className={SHEET_SELECT}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="any">Everyone</SelectItem><SelectItem value="qualified">Only experts registered for the required trade</SelectItem></SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Area">
              <Select value={filters.area} onValueChange={(v) => setFilters(f => ({ ...f, area: v as ExpertFilters["area"] }))}>
                <SelectTrigger className={SHEET_SELECT}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Anywhere</SelectItem>
                  <SelectItem value="same" disabled={!selectedRequest?.pinCode}>Same pincode as the job{selectedRequest?.pinCode ? ` (${selectedRequest.pinCode})` : ""}</SelectItem>
                  <SelectItem value="pincode">A pincode I type</SelectItem>
                </SelectContent>
              </Select>
              {filters.area === "pincode" && (
                <Input className={`mt-2 ${SHEET_SELECT}`} inputMode="numeric" placeholder="Pincode or prefix, e.g. 5811" value={filters.pincode} onChange={(e) => setFilters(f => ({ ...f, pincode: e.target.value }))} />
              )}
            </FilterField>
            <FilterField label="Availability">
              <Select value={filters.online} onValueChange={(v) => setFilters(f => ({ ...f, online: v as ExpertFilters["online"] }))}>
                <SelectTrigger className={SHEET_SELECT}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="any">Online and offline</SelectItem><SelectItem value="online">Online now</SelectItem></SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Workload">
              <Select value={filters.workload} onValueChange={(v) => setFilters(f => ({ ...f, workload: v as ExpertFilters["workload"] }))}>
                <SelectTrigger className={SHEET_SELECT}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="any">Any</SelectItem><SelectItem value="free">Free now (no active jobs)</SelectItem><SelectItem value="light">Up to 2 active jobs</SelectItem></SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Minimum rating">
              <Select value={filters.minRating} onValueChange={(v) => setFilters(f => ({ ...f, minRating: v as ExpertFilters["minRating"] }))}>
                <SelectTrigger className={SHEET_SELECT}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="any">Any</SelectItem><SelectItem value="3">3.0 and above</SelectItem><SelectItem value="4">4.0 and above</SelectItem><SelectItem value="4.5">4.5 and above</SelectItem></SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Partner type">
              <Select value={filters.partnerType} onValueChange={(v) => setFilters(f => ({ ...f, partnerType: v }))}>
                <SelectTrigger className={SHEET_SELECT}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="any">Any</SelectItem>{partnerTypeOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Spare parts">
              <Select value={filters.parts} onValueChange={(v) => setFilters(f => ({ ...f, parts: v as ExpertFilters["parts"] }))}>
                <SelectTrigger className={SHEET_SELECT}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="any">Any</SelectItem><SelectItem value="enabled">Can fit parts from UniteFix stock</SelectItem></SelectContent>
              </Select>
            </FilterField>
            <div className="flex items-center justify-between pt-2 border-t border-[rgba(255,255,255,0.08)]">
              <span className="text-xs text-[hsl(215,20%,60%)]">{sortedEmployees.length} of {employees.length} listed</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="text-[hsl(210,20%,85%)]" onClick={() => setFilters(NO_FILTERS)} disabled={activeFilterCount(filters) === 0}>Reset</Button>
                <Button size="sm" className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white" onClick={() => setFiltersOpen(false)}>Done</Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

const SHEET_SELECT = "h-9 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white focus:ring-[hsla(217,91%,60%,0.3)]";

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-[hsl(215,20%,65%)]">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
