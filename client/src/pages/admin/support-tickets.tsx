import { useState } from "react";
import {
  useTableQuery, DataToolbar, DataPagination, SortableHeader,
} from "@/components/admin/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription 
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Ticket {
    id: number;
    userId: number;
    subject: string;
    description: string;
    status: 'open' | 'in_progress' | 'escalated' | 'resolved' | 'closed';
    category: string;
    serviceRequestId: number | null;
    createdAt: string;
    user: { fullName: string; phone: string; role: string };
    messages?: {
        id: number;
        message: string;
        senderType: string;
        senderId: number;
        isInternal: boolean;
        createdAt: string;
    }[];
}

export default function SupportTicketsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
    const [replyMessage, setReplyMessage] = useState("");
    const [isInternal, setIsInternal] = useState(false);

    const query = useTableQuery("/api/admin/tickets", {
        defaultSort: "createdAt",
        initialFilters: { status: "all", category: "all" },
    });

    const { data, isLoading } = useQuery<any>({
        queryKey: [query.key],
        queryFn: async () => {
            const res = await fetch(query.key, {
                headers: { Authorization: `Bearer ${localStorage.getItem("adminToken")}` }
            });
            if (!res.ok) throw new Error("Failed to fetch tickets");
            return res.json();
        }
    });

    const tickets: Ticket[] = data?.data ?? data?.tickets ?? [];
    const pagination = data?.pagination;

    const fetchTicketDetails = async (id: number) => {
        try {
            const res = await fetch(`/api/admin/tickets/${id}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('adminToken')}` }
            });
            if (!res.ok) throw new Error("Failed to fetch details");
            const data = await res.json();
            setSelectedTicket(data.ticket); // Server might return { ticket, messages } or just ticket with messages included depending on implementation, let's assume { ticket } where ticket has messages
        } catch (error) {
            toast({ title: "Error", description: "Could not load ticket details", variant: "destructive" });
        }
    };

    const replyMutation = useMutation({
        mutationFn: async () => {
            if (!selectedTicket) return;
            await apiRequest("POST", `/api/admin/tickets/${selectedTicket.id}/reply`, {
                message: replyMessage,
                isInternal
            });
        },
        onSuccess: () => {
            toast({ title: "Reply Sent" });
            setReplyMessage("");
            if (selectedTicket) fetchTicketDetails(selectedTicket.id);
            queryClient.invalidateQueries({ queryKey: ['/api/admin/tickets'] });
        },
        onError: () => {
            toast({ title: "Error", description: "Failed to send reply", variant: "destructive" });
        }
    });

    const statusMutation = useMutation({
        mutationFn: async ({ id, status }: { id: number, status: string }) => {
            await apiRequest("PUT", `/api/admin/tickets/${id}/status`, { status });
        },
        onSuccess: () => {
            toast({ title: "Status Updated" });
            queryClient.invalidateQueries({ queryKey: ['/api/admin/tickets'] });
            if (selectedTicket) fetchTicketDetails(selectedTicket.id);
        }
    });

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'open': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
            case 'in_progress': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
            case 'escalated': return 'bg-red-500/10 text-red-500 border-red-500/20';
            case 'resolved': return 'bg-green-500/10 text-green-500 border-green-500/20';
            default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
        }
    };

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-2 text-white">Support Tickets</h1>
            <p className="text-[hsl(215,20%,65%)] mb-6">
                {pagination?.total ? pagination.total + " ticket(s)" : "Customer support queue"}
            </p>

            <div className="mb-4">
                <DataToolbar
                    query={query}
                    searchPlaceholder="Ticket ID, subject, description, customer…"
                    filters={[
                        {
                            key: "status",
                            label: "All Status",
                            options: [
                                { value: "open", label: "Open" },
                                { value: "in_progress", label: "In Progress" },
                                { value: "escalated", label: "Escalated" },
                                { value: "resolved", label: "Resolved" },
                                { value: "closed", label: "Closed" },
                            ],
                        },
                    ]}
                />
            </div>

            <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="border-white/10 hover:bg-white/5">
                            <SortableHeader query={query} field="ticketId">ID</SortableHeader>
                            <TableHead className="text-white/60">Customer</TableHead>
                            <TableHead className="text-white/60">Subject</TableHead>
                            <SortableHeader query={query} field="status">Status</SortableHeader>
                            <SortableHeader query={query} field="createdAt">Date</SortableHeader>
                            <TableHead className="text-white/60 text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
                        ) : tickets.length === 0 ? (
                            <TableRow><TableCell colSpan={6} className="text-center py-8 text-white/60">No tickets found</TableCell></TableRow>
                        ) : (
                            tickets.map((ticket) => (
                                <TableRow key={ticket.id} className="border-white/10 hover:bg-white/5 cursor-pointer" onClick={() => fetchTicketDetails(ticket.id)}>
                                    <TableCell className="font-medium text-white/80">#{ticket.id}</TableCell>
                                    <TableCell>
                                        <div className="text-white">{ticket.user?.fullName}</div>
                                        <div className="text-xs text-white/60">{ticket.user?.phone}</div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="text-white font-medium">{ticket.subject}</div>
                                        {ticket.serviceRequestId && <div className="text-xs text-primary">Booking #{ticket.serviceRequestId}</div>}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={getStatusColor(ticket.status)}>
                                            {ticket.status.replace('_', ' ').toUpperCase()}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-white/60 text-sm">
                                        {format(new Date(ticket.createdAt), "dd MMM yyyy, HH:mm")}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); fetchTicketDetails(ticket.id); }}>View</Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
                <DataPagination query={query} pagination={pagination} rowCount={tickets.length} />
            </div>

            <Dialog open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
                <DialogContent className="sm:max-w-[600px] bg-surface-50 border-white/10 text-white">
                    <DialogHeader>
                        <DialogTitle className="flex justify-between items-center pr-6">
                            <span>Ticket #{selectedTicket?.id}: {selectedTicket?.subject}</span>
                            {selectedTicket && (
                                <Badge variant="outline" className={getStatusColor(selectedTicket.status)}>
                                    {selectedTicket.status.replace('_', ' ').toUpperCase()}
                                </Badge>
                            )}
                        </DialogTitle>
                        <DialogDescription className="text-white/60">
                            By {selectedTicket?.user?.fullName} ({selectedTicket?.user?.phone})
                        </DialogDescription>
                    </DialogHeader>

                    <div className="my-4 space-y-4">
                        <div className="bg-white/5 p-4 rounded-lg">
                            <h4 className="text-sm font-semibold text-white/80 mb-2">Description</h4>
                            <p className="text-sm whitespace-pre-wrap">{selectedTicket?.description}</p>
                            {selectedTicket?.serviceRequestId && (
                                <div className="mt-2 text-sm text-primary">Linked to Booking #{selectedTicket.serviceRequestId}</div>
                            )}
                        </div>

                        <ScrollArea className="h-[200px] rounded-md border border-white/10 p-4">
                            {selectedTicket?.messages && selectedTicket.messages.length > 0 ? (
                                <div className="space-y-4">
                                    {selectedTicket.messages.map((msg) => (
                                        <div key={msg.id} className={`flex flex-col ${msg.senderType === 'customer' ? 'items-start' : 'items-end'}`}>
                                            <div className={`max-w-[80%] rounded-lg p-3 ${
                                                msg.isInternal 
                                                    ? 'bg-yellow-500/20 text-yellow-100 border border-yellow-500/30' 
                                                    : msg.senderType === 'customer'
                                                        ? 'bg-white/10 text-white'
                                                        : 'bg-primary/20 text-primary-100 border border-primary/30'
                                            }`}>
                                                <p className="text-sm">{msg.message}</p>
                                                <span className="text-[10px] opacity-70 mt-1 block">
                                                    {msg.isInternal ? 'Internal Note - ' : ''}{format(new Date(msg.createdAt), "dd MMM HH:mm")}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="h-full flex items-center justify-center text-white/40 text-sm">
                                    No replies yet
                                </div>
                            )}
                        </ScrollArea>

                        <div className="space-y-3">
                            <Textarea 
                                placeholder="Type a reply..." 
                                value={replyMessage}
                                onChange={(e) => setReplyMessage(e.target.value)}
                                className="bg-white/5 border-white/10 resize-none"
                            />
                            <div className="flex justify-between items-center">
                                <div className="flex gap-2">
                                    <Button 
                                        size="sm" 
                                        variant={isInternal ? "secondary" : "ghost"}
                                        onClick={() => setIsInternal(!isInternal)}
                                        className={isInternal ? "bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30" : "text-white/60"}
                                    >
                                        Internal Note
                                    </Button>
                                    <Button size="sm" onClick={() => replyMutation.mutate()} disabled={!replyMessage.trim() || replyMutation.isPending}>
                                        Send {isInternal ? 'Note' : 'Reply'}
                                    </Button>
                                </div>
                                
                                {selectedTicket && (
                                    <select 
                                        className="bg-surface border border-white/10 rounded px-2 py-1 text-sm text-white"
                                        value={selectedTicket.status}
                                        onChange={(e) => statusMutation.mutate({ id: selectedTicket.id, status: e.target.value })}
                                    >
                                        <option value="open">Open</option>
                                        <option value="in_progress">In Progress</option>
                                        <option value="escalated">Escalated</option>
                                        <option value="resolved">Resolved</option>
                                        <option value="closed">Closed</option>
                                    </select>
                                )}
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
