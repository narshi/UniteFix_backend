/**
 * Assignment Queue — Dedicated admin page for assigning employees to service requests
 * 
 * Left panel: Priority-sorted request queue with filters
 * Right panel: Available employees with workload indicators
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
}

interface EmployeeItem {
  id: number;
  fullName: string;
  partnerId: string;
  phone: string;
  services: string[];
  isOnline: boolean;
  activeJobCount: number;
  completedJobCount: number;
  averageRating: string;
}

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
  const { toast } = useToast();

  // Fetch assignment queue data
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/assignment-queue"],
    refetchInterval: 30000, // Auto-refresh every 30s
  });

  const queue: QueueItem[] = (data as any)?.queue || [];
  const employees: EmployeeItem[] = (data as any)?.employees || [];
  const stats: QueueStats = (data as any)?.stats || { totalPending: 0, urgentCount: 0, avgWaitHours: 0, oldestHours: 0 };

  // Get unique service types for filter dropdown
  const serviceTypes = useMemo(() => {
    const types = new Set(queue.map((r) => r.serviceType));
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

  // Sort employees: matching service type first, then by fewest active jobs
  const sortedEmployees = useMemo(() => {
    const sorted = [...employees];
    sorted.sort((a, b) => {
      if (selectedRequest) {
        const aMatches = a.services?.includes(selectedRequest.serviceType) ? 1 : 0;
        const bMatches = b.services?.includes(selectedRequest.serviceType) ? 1 : 0;
        if (aMatches !== bMatches) return bMatches - aMatches;
      }
      // Online first
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      // Fewest active jobs first
      return a.activeJobCount - b.activeJobCount;
    });
    return sorted;
  }, [employees, selectedRequest]);

  // Assign mutation
  const assignMutation = useMutation({
    mutationFn: async ({ requestId, employeeId }: { requestId: number; employeeId: number }) => {
      return await apiRequest("POST", "/api/admin/requests/assign", {
        request_id: requestId,
        provider_id: employeeId,
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
    if (count === 0) return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">{count} jobs</Badge>;
    if (count <= 2) return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">{count} jobs</Badge>;
    return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">{count} jobs</Badge>;
  };

  const formatWait = (hours: number) => {
    if (hours < 1) return "< 1h";
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = Math.floor(hours / 24);
    const h = Math.round(hours % 24);
    return `${days}d ${h}h`;
  };

  return (
    <div className="flex-1 p-6 h-screen overflow-hidden flex flex-col">
      {/* Header */}
      <div className="mb-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Assignment Queue</h2>
            <p className="text-gray-500 text-sm">Assign employees to pending service requests</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="bg-white rounded-lg border p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <Briefcase className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.totalPending}</p>
            <p className="text-xs text-gray-500">Total Pending</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-red-600">{stats.urgentCount}</p>
            <p className="text-xs text-gray-500">Urgent</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
            <Clock className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{formatWait(stats.avgWaitHours)}</p>
            <p className="text-xs text-gray-500">Avg Wait</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
            <Clock className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-orange-600">{formatWait(stats.oldestHours)}</p>
            <p className="text-xs text-gray-500">Oldest Request</p>
          </div>
        </div>
      </div>

      {/* Main Split Panel */}
      <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">

        {/* LEFT: Request Queue (2/3 width) */}
        <div className="col-span-2 flex flex-col min-h-0">
          <Card className="flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by ID, customer, address, or type..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
                <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
                  <SelectTrigger className="w-36 h-9">
                    <SelectValue placeholder="Urgency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Urgency</SelectItem>
                    <SelectItem value="urgent">🔴 Urgent</SelectItem>
                    <SelectItem value="normal">🟢 Normal</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={serviceTypeFilter} onValueChange={setServiceTypeFilter}>
                  <SelectTrigger className="w-44 h-9">
                    <SelectValue placeholder="Service Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {serviceTypes.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto px-4 pb-4">
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="animate-pulse h-20 bg-gray-100 rounded-lg" />
                  ))}
                </div>
              ) : filteredQueue.length === 0 ? (
                <div className="text-center py-16">
                  <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">All caught up!</p>
                  <p className="text-sm text-gray-400">No pending assignments right now.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredQueue.map((req) => (
                    <div
                      key={req.id}
                      onClick={() => setSelectedRequest(req)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all duration-150 ${
                        selectedRequest?.id === req.id
                          ? "border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-200"
                          : req.urgency === "urgent"
                          ? "border-red-200 bg-red-50/30 hover:border-red-300 hover:bg-red-50"
                          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-gray-900 text-sm">{req.serviceType}</p>
                            {getUrgencyBadge(req.urgency, req.waitingHours)}
                            {req.photos && req.photos.length > 0 && (
                              <span className="text-xs text-gray-400 flex items-center gap-0.5">
                                <Image className="w-3 h-3" />{req.photos.length}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-600 truncate">{req.description}</p>
                          <div className="flex items-center gap-4 mt-1.5">
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              <User className="w-3 h-3" />{req.customerName}
                            </span>
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              <Phone className="w-3 h-3" />{req.customerPhone}
                            </span>
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              <MapPin className="w-3 h-3" />{req.address?.slice(0, 30)}{req.address?.length > 30 ? "..." : ""}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-mono text-gray-400">{req.serviceId}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {req.brand} {req.model}
                          </p>
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
          <Card className="flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="w-4 h-4" />
                Employees ({employees.length})
                {selectedRequest && (
                  <Badge variant="secondary" className="ml-auto text-xs font-normal">
                    Sorted for: {selectedRequest.serviceType}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto px-4 pb-4">
              {!selectedRequest ? (
                <div className="text-center py-12">
                  <ArrowRight className="w-8 h-8 text-gray-300 mx-auto mb-3 rotate-180" />
                  <p className="text-gray-400 text-sm">Select a request from the queue</p>
                  <p className="text-gray-400 text-xs">to see available employees</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedEmployees.map((emp) => {
                    const matchesService = emp.services?.includes(selectedRequest.serviceType);
                    return (
                      <div
                        key={emp.id}
                        className={`p-3 rounded-lg border transition-all ${
                          matchesService
                            ? "border-gray-200 hover:border-blue-300 hover:bg-blue-50/50"
                            : "border-gray-100 bg-gray-50/50 opacity-70 hover:opacity-100"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-900 text-sm">{emp.fullName}</p>
                              {emp.isOnline && (
                                <span className="w-2 h-2 bg-green-500 rounded-full" title="Online" />
                              )}
                              {matchesService && (
                                <Badge className="bg-blue-100 text-blue-700 border-0 text-[10px] px-1.5 py-0">
                                  Match
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-gray-500">{emp.partnerId}</span>
                              <span className="text-xs text-gray-400">•</span>
                              <span className="text-xs text-gray-500 flex items-center gap-0.5">
                                <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                                {parseFloat(emp.averageRating).toFixed(1)}
                              </span>
                              <span className="text-xs text-gray-400">•</span>
                              <span className="text-xs text-gray-500">{emp.completedJobCount} done</span>
                            </div>
                            {emp.services && emp.services.length > 0 && (
                              <p className="text-[11px] text-gray-400 mt-1 truncate">
                                {emp.services.slice(0, 3).join(", ")}
                                {emp.services.length > 3 && ` +${emp.services.length - 3}`}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            {getWorkloadBadge(emp.activeJobCount)}
                            <Button
                              size="sm"
                              className="h-7 text-xs px-3"
                              disabled={assignMutation.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
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
                      <User className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No verified employees available</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
