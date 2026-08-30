/**
 * Leads — new-connection requests from the UniteFix app.
 *
 * Converting a lead is the moment UniteFix's acquisition fee accrues, so the
 * dialog says the amount out loud rather than letting it arrive as a surprise
 * on the settlement statement.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";

interface LeadRow {
  id: number;
  name: string;
  phone: string;
  address: string;
  pincode: string;
  notes: string | null;
  status: "new" | "contacted" | "converted" | "closed";
  leadFee: number | null;
  convertedAt: string | null;
  createdAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  contacted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  converted: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  closed: "bg-[rgba(255,255,255,0.05)] text-[hsl(215,20%,55%)] border-[rgba(255,255,255,0.1)]",
};

export default function OperatorLeads() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [converting, setConverting] = useState<LeadRow | null>(null);
  const [ispId, setIspId] = useState("");

  const { data, isLoading } = useQuery<{ data: LeadRow[] }>({ queryKey: ["/api/ftth/admin/leads"] });
  const leads = data?.data ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/ftth/admin/leads"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ftth/admin/ledger"] });
  };

  const statusMutation = useMutation({
    mutationFn: async (vars: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/ftth/admin/leads/${vars.id}`, { status: vars.status }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: async (vars: { id: number; ispConnectionId?: string }) =>
      apiRequest("POST", `/api/ftth/admin/leads/${vars.id}/convert`,
        vars.ispConnectionId ? { ispConnectionId: vars.ispConnectionId } : {}),
    onSuccess: (r: any) => {
      refresh(); setConverting(null); setIspId("");
      toast({ title: "Lead converted", description: r?.message });
    },
    onError: (e: Error) => toast({ title: "Could not convert", description: e.message, variant: "destructive" }),
  });

  const open = leads.filter(l => l.status === "new" || l.status === "contacted");
  const done = leads.filter(l => l.status === "converted" || l.status === "closed");

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white tracking-tight">Leads</h1>
        <p className="text-sm text-[hsl(215,20%,65%)] mt-1">
          People asking for a new connection through the UniteFix app.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Open
            {open.length > 0 && <Badge className={STATUS_STYLE.new}>{open.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-[hsl(215,20%,55%)]">Loading…</p>
          ) : open.length === 0 ? (
            <p className="text-sm text-[hsl(215,20%,55%)]">No open leads.</p>
          ) : (
            <ul className="space-y-3">
              {open.map(l => (
                <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 p-4 rounded-xl border border-[rgba(255,255,255,0.08)]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white">{l.name}</p>
                      <Badge className={STATUS_STYLE[l.status]}>{l.status}</Badge>
                    </div>
                    <p className="text-sm text-[hsl(215,20%,65%)] mt-0.5">
                      <a href={`tel:${l.phone}`} className="underline underline-offset-2">{l.phone}</a>
                      {" · "}{l.pincode}
                    </p>
                    <p className="text-xs text-[hsl(215,20%,50%)] mt-1">{l.address}</p>
                    {l.notes && <p className="text-xs text-[hsl(215,20%,50%)] mt-1 italic">"{l.notes}"</p>}
                    <p className="text-xs text-[hsl(215,20%,40%)] mt-1">
                      {format(new Date(l.createdAt), "d MMM yyyy, HH:mm")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {l.status === "new" && (
                      <Button size="sm" variant="outline" disabled={statusMutation.isPending}
                        onClick={() => statusMutation.mutate({ id: l.id, status: "contacted" })}>
                        Mark contacted
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setConverting(l)}>Convert</Button>
                    <Button size="sm" variant="outline" disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate({ id: l.id, status: "closed" })}>
                      Close
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {done.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {done.map(l => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-[rgba(255,255,255,0.06)]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white font-medium">{l.name}</p>
                      <Badge className={STATUS_STYLE[l.status]}>{l.status}</Badge>
                    </div>
                    <p className="text-xs text-[hsl(215,20%,55%)]">
                      {l.phone} · {l.pincode}
                      {l.leadFee !== null ? ` · acquisition fee ₹${l.leadFee}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={converting !== null} onOpenChange={(o) => !o && setConverting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert {converting?.name}</DialogTitle>
            <DialogDescription>
              Marks this lead as a new customer and creates their connection. UniteFix's acquisition
              fee is recorded against your account — you'll see it on your settlement statement.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="convert-isp-id">Your customer ID (optional)</Label>
            <Input
              id="convert-isp-id" value={ispId}
              onChange={(e) => setIspId(e.target.value)}
              placeholder="POORVI-9913 — leave blank if not created yet"
            />
            <p className="text-xs text-[hsl(215,20%,55%)] mt-1.5">
              Without an ID the customer waits in "awaiting ID" and can't recharge yet.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConverting(null)}>Cancel</Button>
            <Button
              disabled={convertMutation.isPending}
              onClick={() => converting && convertMutation.mutate({
                id: converting.id, ispConnectionId: ispId.trim() || undefined,
              })}
            >
              {convertMutation.isPending ? "Converting…" : "Confirm conversion"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
