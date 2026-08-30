/**
 * Coverage — which pincodes this operator serves.
 *
 * This is what makes multi-operator work. With one operator you can list
 * everyone; at fifteen across the district, a customer in Yellapur must not be
 * offered an ISP that only wires Karwar.
 *
 * Only pincodes UniteFix already serves can be selected — free-text entry would
 * quietly poison the serviceability join with areas that have no customers.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface CoverageData {
  selected: string[];
  available: Array<{ pincode: string; area: string | null }>;
}

export default function OperatorCoverage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery<{ data: CoverageData }>({ queryKey: ["/api/ftth/admin/coverage"] });

  useEffect(() => {
    if (data?.data) {
      setSelected(new Set(data.data.selected));
      setDirty(false);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => apiRequest("PUT", "/api/ftth/admin/coverage", { pincodes: Array.from(selected) }),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ftth/admin/coverage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ftth/admin/me"] });
      setDirty(false);
      toast({ title: "Coverage saved", description: r?.message });
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const available = data?.data.available ?? [];
  const shown = filter.trim()
    ? available.filter(a =>
        a.pincode.includes(filter.trim()) ||
        (a.area ?? "").toLowerCase().includes(filter.trim().toLowerCase()))
    : available;

  const toggle = (pincode: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(pincode) ? next.delete(pincode) : next.add(pincode);
      return next;
    });
    setDirty(true);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Coverage</h1>
          <p className="text-sm text-[hsl(215,20%,65%)] mt-1">
            Customers only see you if their pincode is selected here.
          </p>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : `Save (${selected.size} selected)`}
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Serviceable pincodes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by pincode or area"
            className="max-w-sm"
          />

          {isLoading ? (
            <p className="text-sm text-[hsl(215,20%,55%)]">Loading…</p>
          ) : available.length === 0 ? (
            <p className="text-sm text-[hsl(215,20%,65%)]">
              UniteFix hasn't opened any service areas yet. Contact UniteFix to add yours.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map(a => {
                const on = selected.has(a.pincode);
                return (
                  <button
                    key={a.pincode}
                    onClick={() => toggle(a.pincode)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      on
                        ? "border-[hsla(160,84%,39%,0.4)] bg-[hsla(160,84%,39%,0.12)] text-white"
                        : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] text-[hsl(210,20%,75%)] hover:bg-[rgba(255,255,255,0.05)]"
                    }`}
                  >
                    <span>
                      <span className="font-mono">{a.pincode}</span>
                      {a.area && <span className="block text-xs text-[hsl(215,20%,55%)]">{a.area}</span>}
                    </span>
                    <span className="material-icons text-lg" style={{ fontFamily: "Material Icons" }}>
                      {on ? "check_circle" : "radio_button_unchecked"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
