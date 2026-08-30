/**
 * Plans — a GRID, not a form list.
 *
 * A real ISP arrives with 15-25 plans (5 speeds × 3-5 durations). Adding those
 * one modal at a time is how a feature gets abandoned during onboarding, so
 * speeds are rows, durations are columns, and each cell is an editable price.
 *
 * A BLANK CELL IS LEGITIMATE. Operators sell sparse matrices — 30 Mbps at 1 and
 * 6 months but not 3 — and the customer app honours that by only offering
 * durations that exist at the chosen speed. Nothing here contains a speed or
 * duration list: rows and columns are derived from the operator's own plans,
 * and both are free-text integer entry, so a new ISP types 40 and 200 without
 * anyone touching code.
 *
 * Prices are entered in RUPEES. Paise conversion happens once, at the API.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface PlanRow {
  id: number;
  name: string;
  speedMbps: number;
  durationMonths: number;
  price: number;
  discount: number;
  finalPrice: number;
  dataLimitGb: number | null;
  benefits: string[];
  sortOrder: number;
  isActive: boolean;
}

export default function OperatorPlans() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<{ speed: number; duration: number; plan: PlanRow | null } | null>(null);
  const [form, setForm] = useState({ name: "", price: "", discount: "", dataLimitGb: "", benefits: "" });
  const [addSpeedOpen, setAddSpeedOpen] = useState(false);
  const [addDurationOpen, setAddDurationOpen] = useState(false);
  const [draftSpeed, setDraftSpeed] = useState("");
  const [draftDuration, setDraftDuration] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState("");

  // Rows/columns the operator has added but not yet priced. Kept in component
  // state because an empty row has nothing to persist yet.
  const [extraSpeeds, setExtraSpeeds] = useState<number[]>([]);
  const [extraDurations, setExtraDurations] = useState<number[]>([]);

  const { data, isLoading } = useQuery<{ data: PlanRow[] }>({ queryKey: ["/api/ftth/admin/plans"] });
  const plans = data?.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/ftth/admin/plans"] });

  const speeds = useMemo(
    () => Array.from(new Set([...plans.map(p => p.speedMbps), ...extraSpeeds])).sort((a, b) => a - b),
    [plans, extraSpeeds],
  );
  const durations = useMemo(
    () => Array.from(new Set([...plans.map(p => p.durationMonths), ...extraDurations])).sort((a, b) => a - b),
    [plans, extraDurations],
  );

  const cell = (speed: number, duration: number) =>
    plans.find(p => p.speedMbps === speed && p.durationMonths === duration) ?? null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const body = {
        name: form.name.trim() || `${editing.speed} Mbps · ${editing.duration} month${editing.duration === 1 ? "" : "s"}`,
        speedMbps: editing.speed,
        durationMonths: editing.duration,
        priceRupees: Number(form.price),
        discountRupees: form.discount.trim() ? Number(form.discount) : 0,
        dataLimitGb: form.dataLimitGb.trim() ? Number(form.dataLimitGb) : null,
        benefits: form.benefits.split(",").map(s => s.trim()).filter(Boolean),
      };
      return editing.plan
        ? apiRequest("PATCH", `/api/ftth/admin/plans/${editing.plan.id}`, body)
        : apiRequest("POST", "/api/ftth/admin/plans", body);
    },
    onSuccess: () => {
      refresh();
      setEditing(null);
      toast({ title: "Plan saved" });
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (vars: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/ftth/admin/plans/${vars.id}`, { isActive: vars.isActive }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      // name, speed, months, price, discount, dataLimitGb — the shape most
      // operators already have in a spreadsheet.
      const rows = csv.split("\n").map(l => l.trim()).filter(Boolean);
      const parsed = rows
        .filter(l => !/^name\s*,/i.test(l))
        .map((line, i) => {
          const [name, speed, months, price, discount, limit] = line.split(",").map(s => s?.trim() ?? "");
          if (!speed || !months || !price) throw new Error(`Row ${i + 1}: speed, months and price are required`);
          return {
            name: name || `${speed} Mbps · ${months} months`,
            speedMbps: Number(speed),
            durationMonths: Number(months),
            priceRupees: Number(price),
            discountRupees: discount ? Number(discount) : 0,
            dataLimitGb: limit ? Number(limit) : null,
          };
        });
      if (!parsed.length) throw new Error("Nothing to import");
      return apiRequest("POST", "/api/ftth/admin/plans/bulk", { plans: parsed });
    },
    onSuccess: (r: any) => {
      refresh();
      setImportOpen(false);
      setCsv("");
      toast({ title: "Import complete", description: r?.message });
    },
    onError: (e: Error) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const openCell = (speed: number, duration: number) => {
    const plan = cell(speed, duration);
    setEditing({ speed, duration, plan });
    setForm({
      name: plan?.name ?? "",
      price: plan ? String(plan.price) : "",
      discount: plan && plan.discount > 0 ? String(plan.discount) : "",
      dataLimitGb: plan?.dataLimitGb != null ? String(plan.dataLimitGb) : "",
      benefits: (plan?.benefits ?? []).join(", "),
    });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Plans</h1>
          <p className="text-sm text-[hsl(215,20%,65%)] mt-1">
            Your speeds and prices. A blank cell means you don't sell that combination — customers
            will only be offered what's filled in.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAddSpeedOpen(true)}>Add speed</Button>
          <Button variant="outline" onClick={() => setAddDurationOpen(true)}>Add duration</Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>Import CSV</Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price grid (₹)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-[hsl(215,20%,55%)]">Loading…</p>
          ) : speeds.length === 0 || durations.length === 0 ? (
            <div className="text-sm text-[hsl(215,20%,65%)] space-y-3 py-4">
              <p>No plans yet. Start by adding a speed and a duration — for example 40 Mbps and 6 months.</p>
              <div className="flex gap-2">
                <Button onClick={() => setAddSpeedOpen(true)}>Add your first speed</Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[rgba(255,255,255,0.08)]">
                    <th className="p-3 text-left text-xs uppercase tracking-wider text-[hsl(215,20%,55%)]">Speed</th>
                    {durations.map(d => (
                      <th key={d} className="p-3 text-left text-xs uppercase tracking-wider text-[hsl(215,20%,55%)]">
                        {d} month{d === 1 ? "" : "s"}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {speeds.map(s => (
                    <tr key={s} className="border-b border-[rgba(255,255,255,0.04)]">
                      <td className="p-3 font-semibold text-white whitespace-nowrap">{s} Mbps</td>
                      {durations.map(d => {
                        const plan = cell(s, d);
                        return (
                          <td key={d} className="p-2">
                            <button
                              onClick={() => openCell(s, d)}
                              className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                                plan
                                  ? plan.isActive
                                    ? "border-[hsla(160,84%,39%,0.3)] bg-[hsla(160,84%,39%,0.08)] text-white hover:bg-[hsla(160,84%,39%,0.15)]"
                                    : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] text-[hsl(215,20%,50%)] hover:bg-[rgba(255,255,255,0.05)]"
                                  : "border-dashed border-[rgba(255,255,255,0.12)] text-[hsl(215,20%,40%)] hover:bg-[rgba(255,255,255,0.03)]"
                              }`}
                            >
                              {plan ? (
                                <>
                                  <span className="font-semibold">₹{plan.finalPrice}</span>
                                  {plan.discount > 0 && (
                                    <span className="ml-1.5 text-xs line-through text-[hsl(215,20%,50%)]">₹{plan.price}</span>
                                  )}
                                  {!plan.isActive && <span className="ml-2 text-[10px] uppercase">hidden</span>}
                                </>
                              ) : (
                                <span className="text-xs">— not sold —</span>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {plans.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">All plans</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {plans.map(p => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-[rgba(255,255,255,0.06)]">
                  <div className="min-w-0">
                    <p className="text-white font-medium">{p.name}</p>
                    <p className="text-xs text-[hsl(215,20%,55%)]">
                      {p.speedMbps} Mbps · {p.durationMonths} month{p.durationMonths === 1 ? "" : "s"} · ₹{p.finalPrice}
                      {p.dataLimitGb != null ? ` · ${p.dataLimitGb} GB` : " · Unlimited"}
                      {p.benefits.length ? ` · ${p.benefits.join(", ")}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={toggleMutation.isPending}
                    onClick={() => toggleMutation.mutate({ id: p.id, isActive: !p.isActive })}
                  >
                    {p.isActive ? "Hide from app" : "Show in app"}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Edit / create one cell */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.speed} Mbps · {editing?.duration} month{editing?.duration === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              Leave the price blank and cancel if you don't sell this combination.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="plan-name">Plan name (shown to customers)</Label>
              <Input
                id="plan-name" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={`${editing?.speed} Mbps Unlimited`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="plan-price">Price (₹, incl. GST)</Label>
                <Input id="plan-price" inputMode="decimal" value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="471" />
              </div>
              <div>
                <Label htmlFor="plan-discount">Discount (₹)</Label>
                <Input id="plan-discount" inputMode="decimal" value={form.discount}
                  onChange={(e) => setForm({ ...form, discount: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div>
              <Label htmlFor="plan-limit">Data limit (GB) — blank = unlimited</Label>
              <Input id="plan-limit" inputMode="numeric" value={form.dataLimitGb}
                onChange={(e) => setForm({ ...form, dataLimitGb: e.target.value })} placeholder="unlimited" />
            </div>
            <div>
              <Label htmlFor="plan-benefits">Extras (comma separated)</Label>
              <Input id="plan-benefits" value={form.benefits}
                onChange={(e) => setForm({ ...form, benefits: e.target.value })}
                placeholder="OTT pack, Free installation" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.price.trim()}>
              {saveMutation.isPending ? "Saving…" : "Save plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add a speed row */}
      <Dialog open={addSpeedOpen} onOpenChange={setAddSpeedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a speed</DialogTitle>
            <DialogDescription>Any speed you sell. There's no fixed list.</DialogDescription>
          </DialogHeader>
          <Input inputMode="numeric" value={draftSpeed} onChange={(e) => setDraftSpeed(e.target.value)} placeholder="40" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSpeedOpen(false)}>Cancel</Button>
            <Button
              disabled={!Number(draftSpeed)}
              onClick={() => {
                setExtraSpeeds(prev => [...prev, Number(draftSpeed)]);
                if (durations.length === 0) setExtraDurations([1]);
                setDraftSpeed("");
                setAddSpeedOpen(false);
              }}
            >
              Add row
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add a duration column */}
      <Dialog open={addDurationOpen} onOpenChange={setAddDurationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a duration</DialogTitle>
            <DialogDescription>In months. 1, 3, 6 and 12 are common, but anything works.</DialogDescription>
          </DialogHeader>
          <Input inputMode="numeric" value={draftDuration} onChange={(e) => setDraftDuration(e.target.value)} placeholder="6" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDurationOpen(false)}>Cancel</Button>
            <Button
              disabled={!Number(draftDuration)}
              onClick={() => {
                setExtraDurations(prev => [...prev, Number(draftDuration)]);
                setDraftDuration("");
                setAddDurationOpen(false);
              }}
            >
              Add column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV import */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import your price list</DialogTitle>
            <DialogDescription>
              One plan per line: name, speed, months, price, discount, data limit. Re-importing updates
              matching plans rather than duplicating them.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={8}
            className="w-full rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] p-3 text-sm text-white font-mono"
            placeholder={"40 Mbps Unlimited, 40, 1, 471, 0,\n40 Mbps Unlimited, 40, 6, 2650, 150,\n100 Mbps + OTT, 100, 12, 8400, 400, 3300"}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending || !csv.trim()}>
              {importMutation.isPending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
