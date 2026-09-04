/**
 * Warranty claims.
 *
 * The screen exists to make one decision quickly and consistently: what the
 * inspecting technician found. Everything needed to make it — the customer, the
 * job, the part, where it was bought and whether there is a bill for it — is on
 * the row, because the sourcing IS the decision and putting it behind a click
 * would mean deciding without it.
 *
 * The cost bearer is NOT chosen here. It is routed from the verdict by
 * warranty.service.routeCost(), and shown before you commit so the consequence
 * of a verdict is visible at the moment of choosing it. That is deliberate: a
 * dropdown of who pays would turn a policy into a negotiation, and the same
 * claim would be settled differently by different people on different days.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { ShieldCheck, AlertTriangle, FileWarning, Receipt, PhoneCall, Search } from "lucide-react";

type Claim = {
    claim: {
        id: number;
        claimId: string;
        serviceRequestId: number;
        partItemId: number | null;
        description: string;
        status: "open" | "inspecting" | "resolved" | "rejected";
        verdict: string | null;
        verdictNotes: string | null;
        costBearer: string | null;
        createdAt: string;
        resolvedAt: string | null;
    };
    booking: { serviceId: string; serviceType: string; address: string; providerId: number | null } | null;
    customerName: string | null;
    customerPhone: string | null;
    part: {
        id: number;
        partName: string;
        brand: string | null;
        sourceType: "platform" | "approved_vendor" | "technician_local" | "customer_supplied";
        vendorName: string | null;
        isDocumented: boolean;
        warrantyBacker: string;
        warrantyExpiresAt: string | null;
        unitPricePaise: number;
        quantity: number;
        billPhotoUrl: string | null;
    } | null;
    wouldRoute: { part_failed: string };
};

/** What the office sees while the customer is still on the line. */
type Lookup = {
    booking: {
        id: number;
        serviceId: string;
        serviceType: string;
        status: string;
        address: string;
        completedAt: string | null;
    };
    parts: Array<{
        id: number;
        partName: string;
        brand: string | null;
        quantity: number;
        purchasedFrom: string | null;
        isDocumented: boolean;
        statement: string;
    }>;
};

/** The five verdicts, with what each one means for who pays. */
const VERDICTS: Array<{ value: string; label: string; consequence: string }> = [
    {
        value: "workmanship_fault",
        label: "We fitted it wrong",
        consequence: "The technician returns and redoes it free, with no earnings on the revisit.",
    },
    {
        value: "part_failed",
        label: "The part itself failed",
        consequence: "Free for the customer. Who absorbs it depends on where the part came from.",
    },
    {
        value: "customer_damage",
        label: "Damaged after we left",
        consequence: "Chargeable. Quote the repair before doing it.",
    },
    {
        value: "out_of_warranty",
        label: "Outside the warranty window",
        consequence: "Chargeable. Consider a goodwill discount to keep the customer.",
    },
    {
        value: "unrelated",
        label: "Nothing to do with our job",
        consequence: "Chargeable as a new booking.",
    },
];

const SOURCE_LABEL: Record<string, string> = {
    platform: "UniteFix stock",
    approved_vendor: "Approved vendor",
    technician_local: "Local shop",
    customer_supplied: "Customer's own",
};

const BEARER_LABEL: Record<string, string> = {
    unitefix: "UniteFix absorbs it",
    vendor: "The vendor replaces it",
    technician: "The technician covers it",
    customer: "Chargeable to the customer",
};

function StatusBadge({ status }: { status: string }) {
    const tone =
        status === "open" ? "bg-amber-100 text-amber-900 hover:bg-amber-100"
            : status === "inspecting" ? "bg-blue-100 text-blue-900 hover:bg-blue-100"
                : status === "resolved" ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-100"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-100";
    return <Badge className={tone} variant="secondary">{status}</Badge>;
}

/**
 * Where the part came from, and whether there is a bill for it. An undocumented
 * local part is the row worth noticing — it is the one case with nobody to
 * recover from, so it is marked rather than left to be inferred.
 */
function SourceCell({ part }: { part: Claim["part"] }) {
    if (!part) {
        return <span className="text-sm text-muted-foreground">Workmanship claim — no part</span>;
    }
    const undocumented = !part.isDocumented && part.sourceType === "technician_local";
    return (
        <div className="space-y-1">
            <div className="text-sm font-medium">
                {part.partName}
                {part.quantity > 1 && <span className="text-muted-foreground"> ×{part.quantity}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[11px] font-normal">
                    {SOURCE_LABEL[part.sourceType] ?? part.sourceType}
                </Badge>
                {part.vendorName && (
                    <span className="text-xs text-muted-foreground">{part.vendorName}</span>
                )}
                {undocumented && (
                    <Badge variant="secondary" className="gap-1 bg-rose-100 text-rose-900 text-[11px] font-normal hover:bg-rose-100">
                        <FileWarning className="h-3 w-3" /> No bill on file
                    </Badge>
                )}
                {part.billPhotoUrl && (
                    <a href={part.billPhotoUrl} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2">
                        <Receipt className="h-3 w-3" /> Bill
                    </a>
                )}
            </div>
            {part.warrantyExpiresAt && (
                <div className="text-xs text-muted-foreground">
                    Part warranty to {format(new Date(part.warrantyExpiresAt), "d MMM yyyy")}
                </div>
            )}
        </div>
    );
}

export default function WarrantyClaimsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState<string>("open");
    const [active, setActive] = useState<Claim | null>(null);
    const [verdict, setVerdict] = useState<string>("");
    const [notes, setNotes] = useState("");

    // Logging a claim taken over the phone.
    const [logOpen, setLogOpen] = useState(false);
    const [lookupRef, setLookupRef] = useState("");
    const [found, setFound] = useState<Lookup | null>(null);
    const [lookupError, setLookupError] = useState<string | null>(null);
    const [logPartId, setLogPartId] = useState<number | null>(null);
    const [logDesc, setLogDesc] = useState("");

    const { data, isLoading } = useQuery<{ data: Claim[] }>({
        queryKey: ["/api/admin/warranty-claims", statusFilter],
        queryFn: async () => {
            const qs = statusFilter === "all" ? "" : `?status=${statusFilter}`;
            const res = await apiRequest("GET", `/api/admin/warranty-claims${qs}`);
            return res.json();
        },
    });

    const lookup = useMutation({
        mutationFn: async (ref: string) => {
            const res = await apiRequest("GET", `/api/admin/warranty-claims/lookup?ref=${encodeURIComponent(ref)}`);
            const body = await res.json();
            if (!res.ok) throw new Error(body?.message ?? "Could not find that booking");
            return body.data as Lookup;
        },
        onSuccess: (data) => {
            setFound(data);
            setLookupError(null);
            // Pre-select when there is only one part: the common call is about the
            // only part that was fitted, and making someone click it changes nothing.
            setLogPartId(data.parts.length === 1 ? data.parts[0].id : null);
        },
        onError: (error: any) => {
            setFound(null);
            setLookupError(error.message);
        },
    });

    const logClaim = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", "/api/admin/warranty-claims", {
                bookingRef: found?.booking.serviceId ?? lookupRef,
                partItemId: logPartId,
                description: logDesc,
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body?.message ?? "Could not log the claim");
            return body;
        },
        onSuccess: (result: any) => {
            toast({ title: "Claim logged", description: result?.message });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/warranty-claims"] });
            closeLog();
        },
        onError: (error: any) => {
            toast({ title: "Not logged", description: error.message, variant: "destructive" });
        },
    });

    const closeLog = () => {
        setLogOpen(false);
        setLookupRef("");
        setFound(null);
        setLookupError(null);
        setLogPartId(null);
        setLogDesc("");
    };

    const settle = useMutation({
        mutationFn: async ({ id, verdict, notes }: { id: number; verdict: string; notes: string }) => {
            const res = await apiRequest("POST", `/api/admin/warranty-claims/${id}/verdict`, { verdict, notes });
            if (!res.ok) throw new Error((await res.json())?.message ?? "Could not record the verdict");
            return res.json();
        },
        onSuccess: (result: any) => {
            toast({ title: "Verdict recorded", description: result?.message });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/warranty-claims"] });
            setActive(null);
            setVerdict("");
            setNotes("");
        },
        onError: (error: any) => {
            toast({ title: "Not recorded", description: error.message, variant: "destructive" });
        },
    });

    const claims = data?.data ?? [];
    const openCount = claims.filter(c => c.claim.status === "open").length;

    /** What this verdict would cost, for this specific part. */
    const projectedBearer = (c: Claim, v: string): string | null => {
        if (!v) return null;
        if (v === "workmanship_fault") return "technician";
        if (v === "part_failed") return c.wouldRoute.part_failed;
        return "customer";
    };

    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Warranty Claims</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        Record what the inspecting technician found. The verdict decides who absorbs the
                        cost — the customer pays nothing on any genuine failure.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {/* Most warranty calls arrive by telephone, not through the
                        app. Without this the queue could only be fed by a channel
                        the customer may never use, and stayed empty while the
                        calls kept coming. */}
                    <Button size="sm" onClick={() => setLogOpen(true)}>
                        <PhoneCall className="mr-1.5 h-3.5 w-3.5" />
                        Log a phoned-in claim
                    </Button>
                    {["open", "inspecting", "resolved", "all"].map(s => (
                        <Button
                            key={s}
                            size="sm"
                            variant={statusFilter === s ? "default" : "outline"}
                            onClick={() => setStatusFilter(s)}
                        >
                            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                            {s === "open" && openCount > 0 && (
                                <span className="ml-1.5 rounded bg-background/20 px-1.5 text-xs">{openCount}</span>
                            )}
                        </Button>
                    ))}
                </div>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium">
                        {isLoading ? "Loading…" : `${claims.length} claim${claims.length === 1 ? "" : "s"}`}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[130px]">Claim</TableHead>
                                    <TableHead className="w-[180px]">Customer</TableHead>
                                    <TableHead className="min-w-[240px]">Part &amp; source</TableHead>
                                    <TableHead className="min-w-[220px]">What they reported</TableHead>
                                    <TableHead className="w-[150px]">Status</TableHead>
                                    <TableHead className="w-[110px] text-right">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {!isLoading && claims.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={6} className="py-12 text-center">
                                            <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
                                            <p className="text-sm font-medium">No {statusFilter === "all" ? "" : statusFilter} claims</p>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                Claims raised from the customer app appear here. If a customer
                                                rings the office, use "Log a phoned-in claim" above.
                                            </p>
                                        </TableCell>
                                    </TableRow>
                                )}

                                {claims.map(c => (
                                    <TableRow key={c.claim.id}>
                                        <TableCell className="align-top">
                                            <div className="font-mono text-xs">{c.claim.claimId}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {format(new Date(c.claim.createdAt), "d MMM yyyy")}
                                            </div>
                                            {c.booking && (
                                                <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                                                    {c.booking.serviceId}
                                                </div>
                                            )}
                                        </TableCell>

                                        <TableCell className="align-top">
                                            <div className="text-sm font-medium">{c.customerName ?? "—"}</div>
                                            {c.customerPhone && (
                                                <div className="text-xs text-muted-foreground">{c.customerPhone}</div>
                                            )}
                                            {c.booking && (
                                                <div className="mt-1 text-xs text-muted-foreground">{c.booking.serviceType}</div>
                                            )}
                                        </TableCell>

                                        <TableCell className="align-top"><SourceCell part={c.part} /></TableCell>

                                        <TableCell className="align-top">
                                            <p className="max-w-sm text-sm text-muted-foreground">{c.claim.description}</p>
                                        </TableCell>

                                        <TableCell className="align-top">
                                            <StatusBadge status={c.claim.status} />
                                            {c.claim.verdict && (
                                                <div className="mt-1.5 text-xs">
                                                    <div className="font-medium">{c.claim.verdict.replace(/_/g, " ")}</div>
                                                    {c.claim.costBearer && (
                                                        <div className="text-muted-foreground">
                                                            {BEARER_LABEL[c.claim.costBearer] ?? c.claim.costBearer}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </TableCell>

                                        <TableCell className="text-right align-top">
                                            {c.claim.status === "resolved" || c.claim.status === "rejected" ? (
                                                <span className="text-xs text-muted-foreground">Settled</span>
                                            ) : (
                                                <Button size="sm" variant="outline" onClick={() => { setActive(c); setVerdict(""); setNotes(""); }}>
                                                    Record verdict
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>What did the inspection find?</DialogTitle>
                        <DialogDescription>
                            {active?.part
                                ? <>The part was {SOURCE_LABEL[active.part.sourceType]?.toLowerCase()}
                                    {active.part.vendorName ? ` from ${active.part.vendorName}` : ""}
                                    {!active.part.isDocumented && active.part.sourceType === "technician_local"
                                        ? ", with no bill on file." : "."}</>
                                : "This claim is about our workmanship, not a part."}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        {VERDICTS.map(v => {
                            const selected = verdict === v.value;
                            return (
                                <button
                                    key={v.value}
                                    type="button"
                                    onClick={() => setVerdict(v.value)}
                                    className={`w-full rounded-md border p-3 text-left transition-colors ${selected
                                        ? "border-primary bg-primary/5"
                                        : "border-border hover:bg-muted/50"
                                        }`}
                                >
                                    <div className="text-sm font-medium">{v.label}</div>
                                    <div className="mt-0.5 text-xs text-muted-foreground">{v.consequence}</div>
                                </button>
                            );
                        })}
                    </div>

                    {/* The consequence, before it is committed to. */}
                    {active && verdict && (
                        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <div>
                                <div className="font-medium">
                                    {BEARER_LABEL[projectedBearer(active, verdict) ?? ""] ?? "—"}
                                </div>
                                {projectedBearer(active, verdict) !== "customer" && (
                                    <div className="mt-0.5 text-amber-800">The customer is charged nothing.</div>
                                )}
                            </div>
                        </div>
                    )}

                    <Textarea
                        placeholder="What the technician saw, for the record."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                    />

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setActive(null)}>Cancel</Button>
                        <Button
                            disabled={!verdict || settle.isPending}
                            onClick={() => active && settle.mutate({ id: active.claim.id, verdict, notes })}
                        >
                            {settle.isPending ? "Recording…" : "Record verdict"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Log a claim taken over the phone. */}
            <Dialog open={logOpen} onOpenChange={(open) => !open && closeLog()}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Log a phoned-in claim</DialogTitle>
                        <DialogDescription>
                            Filed against the customer who booked the job, not against you. Who took
                            the call is recorded separately.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div>
                            <label className="text-sm font-medium">Booking reference</label>
                            <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
                                Whatever is on their invoice or SMS — the SR number, or the booking number.
                            </p>
                            <div className="flex gap-2">
                                <Input
                                    value={lookupRef}
                                    onChange={(e) => setLookupRef(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && lookupRef.trim()) {
                                            e.preventDefault();
                                            lookup.mutate(lookupRef.trim());
                                        }
                                    }}
                                    placeholder="e.g. SR-1042"
                                />
                                <Button
                                    variant="outline"
                                    disabled={!lookupRef.trim() || lookup.isPending}
                                    onClick={() => lookup.mutate(lookupRef.trim())}
                                >
                                    <Search className="mr-1.5 h-3.5 w-3.5" />
                                    {lookup.isPending ? "Finding…" : "Find"}
                                </Button>
                            </div>
                            {lookupError && (
                                <p className="mt-2 text-sm text-destructive">{lookupError}</p>
                            )}
                        </div>

                        {found && (
                            <>
                                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                                    <div className="font-medium">{found.booking.serviceType}</div>
                                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                                        {found.booking.serviceId}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">{found.booking.address}</div>
                                </div>

                                <div>
                                    <label className="text-sm font-medium">What are they claiming on?</label>
                                    <div className="mt-2 space-y-1.5">
                                        {/* A workmanship claim is always available: the part
                                            may be fine and the fitting wrong, and that is our
                                            guarantee either way. */}
                                        <button
                                            type="button"
                                            onClick={() => setLogPartId(null)}
                                            className={`w-full rounded-md border p-2.5 text-left text-sm transition ${
                                                logPartId === null ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                                            }`}
                                        >
                                            <div className="font-medium">The work itself</div>
                                            <div className="text-xs text-muted-foreground">
                                                Our 30-day workmanship guarantee
                                            </div>
                                        </button>

                                        {found.parts.map(p => (
                                            <button
                                                key={p.id}
                                                type="button"
                                                onClick={() => setLogPartId(p.id)}
                                                className={`w-full rounded-md border p-2.5 text-left text-sm transition ${
                                                    logPartId === p.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-medium">
                                                        {p.partName}{p.quantity > 1 ? ` ×${p.quantity}` : ""}
                                                        {p.brand ? <span className="ml-1.5 font-normal text-muted-foreground">{p.brand}</span> : null}
                                                    </span>
                                                    {!p.isDocumented && (
                                                        <Badge variant="outline" className="shrink-0 text-[10px]">
                                                            <FileWarning className="mr-1 h-3 w-3" />
                                                            No bill
                                                        </Badge>
                                                    )}
                                                </div>
                                                {p.purchasedFrom && (
                                                    <div className="mt-0.5 text-xs text-muted-foreground">
                                                        Bought from {p.purchasedFrom}
                                                    </div>
                                                )}
                                            </button>
                                        ))}

                                        {found.parts.length === 0 && (
                                            <p className="text-xs text-muted-foreground">
                                                No parts were recorded on this job, so this can only be a
                                                workmanship claim.
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <label className="text-sm font-medium">What did they say?</label>
                                    <Textarea
                                        className="mt-2"
                                        rows={3}
                                        value={logDesc}
                                        onChange={(e) => setLogDesc(e.target.value)}
                                        placeholder="In their words — e.g. the fan stopped again after three weeks"
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={closeLog}>Cancel</Button>
                        <Button
                            disabled={!found || logDesc.trim().length < 5 || logClaim.isPending}
                            onClick={() => logClaim.mutate()}
                        >
                            {logClaim.isPending ? "Logging…" : "Log claim"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
