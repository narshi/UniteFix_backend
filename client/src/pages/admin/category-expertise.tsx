/**
 * Category -> Trade mapping.
 *
 * Decides which technician types are suitable for a booking, which is what the
 * assignment queue ranks experts on. Mapped per CATEGORY rather than per
 * service: services inside a category are worked by the same trades, so
 * per-service rows would be admin busywork with no extra signal.
 *
 * A category with nothing ticked is UNRESTRICTED — every expert stays eligible.
 * That is the right reading for Professional & Property, Transport, Events and
 * Specialized, where no technician type applies, so the UI says so explicitly
 * rather than leaving an empty row looking like a mistake.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Check, Loader2, Users } from "lucide-react";

interface TradeOption {
    id: number;
    name: string;
    isActive?: boolean;
}

interface CategoryMapping {
    categoryId: number;
    categoryName: string;
    technicianTypes: { id: number; name: string }[];
}

export default function CategoryExpertisePage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState<Record<number, number[]>>({});
    const [savingId, setSavingId] = useState<number | null>(null);

    const { data: mappingResponse, isLoading } = useQuery<any>({
        queryKey: ["/api/admin/category-technician-types"],
    });
    const { data: tradesResponse } = useQuery<any>({
        queryKey: ["/api/technician-types"],
    });

    const categories: CategoryMapping[] = mappingResponse?.data ?? [];
    const trades: TradeOption[] = tradesResponse?.data ?? [];

    // Seed the draft from the server once loaded, so a tick is instant and the
    // Save button knows what changed.
    useEffect(() => {
        if (categories.length === 0) return;
        setDraft((prev) =>
            Object.keys(prev).length > 0
                ? prev
                : Object.fromEntries(categories.map((c) => [c.categoryId, c.technicianTypes.map((t) => t.id)])),
        );
    }, [categories]);

    const saveMutation = useMutation({
        mutationFn: async (categoryId: number) =>
            apiRequest("PUT", `/api/admin/categories/${categoryId}/technician-types`, {
                technicianTypeIds: draft[categoryId] ?? [],
            }),
        onSuccess: (r: any) => {
            toast({ title: "Mapping saved", description: r?.message });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/category-technician-types"] });
        },
        onError: (e: any) =>
            toast({ title: "Could not save", description: e.message, variant: "destructive" }),
        onSettled: () => setSavingId(null),
    });

    const toggle = (categoryId: number, tradeId: number) => {
        setDraft((prev) => {
            const current = prev[categoryId] ?? [];
            return {
                ...prev,
                [categoryId]: current.includes(tradeId)
                    ? current.filter((id) => id !== tradeId)
                    : [...current, tradeId],
            };
        });
    };

    const isDirty = (c: CategoryMapping) => {
        const saved = [...c.technicianTypes.map((t) => t.id)].sort((a, b) => a - b);
        const next = [...(draft[c.categoryId] ?? [])].sort((a, b) => a - b);
        return saved.join(",") !== next.join(",");
    };

    return (
        <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen">
            <div className="mb-8">
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight mb-2">
                    Category Expertise
                </h2>
                <p className="text-[hsl(215,20%,65%)] font-medium">
                    Which trades can take work from each service category. Used to rank experts on the
                    assignment queue.
                </p>
            </div>

            {isLoading ? (
                <div className="flex items-center gap-2 text-[hsl(215,20%,65%)]">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading categories…
                </div>
            ) : (
                <div className="space-y-4">
                    {categories.map((c) => {
                        const selected = draft[c.categoryId] ?? [];
                        const dirty = isDirty(c);
                        return (
                            <Card key={c.categoryId} className="glass-card border-[rgba(255,255,255,0.08)]">
                                <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4">
                                    <div>
                                        <CardTitle className="text-lg text-white">{c.categoryName}</CardTitle>
                                        <p className="text-xs text-[hsl(215,20%,55%)] mt-1">
                                            {selected.length === 0 ? (
                                                <span className="text-[hsl(38,92%,60%)]">
                                                    No trade mapped — every expert stays eligible
                                                </span>
                                            ) : (
                                                `${selected.length} trade(s) can work this category`
                                            )}
                                        </p>
                                    </div>
                                    <Button
                                        size="sm"
                                        disabled={!dirty || savingId === c.categoryId}
                                        onClick={() => {
                                            setSavingId(c.categoryId);
                                            saveMutation.mutate(c.categoryId);
                                        }}
                                        className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white disabled:opacity-40"
                                    >
                                        {savingId === c.categoryId ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : dirty ? (
                                            "Save"
                                        ) : (
                                            <Check className="w-4 h-4" />
                                        )}
                                    </Button>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-wrap gap-2">
                                        {trades.map((t) => {
                                            const on = selected.includes(t.id);
                                            return (
                                                <button
                                                    key={t.id}
                                                    onClick={() => toggle(c.categoryId, t.id)}
                                                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${on
                                                        ? "bg-[hsla(217,91%,60%,0.18)] text-[hsl(217,91%,72%)] border-[hsla(217,91%,60%,0.45)]"
                                                        : "bg-[rgba(255,255,255,0.02)] text-[hsl(215,20%,60%)] border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.2)] hover:text-white"
                                                        }`}
                                                >
                                                    {on && <Check className="w-3 h-3 inline mr-1 -mt-0.5" />}
                                                    {t.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}

                    {categories.length === 0 && (
                        <div className="text-center py-16 text-[hsl(215,20%,55%)]">
                            <Users className="w-8 h-8 mx-auto mb-3 opacity-40" />
                            <p>No service categories yet.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
