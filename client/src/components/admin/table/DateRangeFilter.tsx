/**
 * Date range picker with the presets an admin reaches for daily, plus a custom
 * start/end. Emits yyyy-MM-dd strings, which server/lib/list-query.ts widens to
 * end-of-day on the `to` side so "16th to 16th" includes the 16th.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarDays, X } from "lucide-react";
import { format, startOfMonth, subDays } from "date-fns";
import type { DateRange } from "./useTableQuery";

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Indian fiscal year starts 1 April, matching the UF/25-26/ invoice numbering —
 * so "this financial year" lines up with how the books are actually kept.
 */
function fiscalYearStart(now = new Date()): Date {
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return new Date(year, 3, 1);
}

const PRESETS: Array<{ label: string; range: () => DateRange }> = [
    { label: "Today", range: () => ({ from: fmt(new Date()), to: fmt(new Date()) }) },
    { label: "Last 7 days", range: () => ({ from: fmt(subDays(new Date(), 6)), to: fmt(new Date()) }) },
    { label: "Last 30 days", range: () => ({ from: fmt(subDays(new Date(), 29)), to: fmt(new Date()) }) },
    { label: "This month", range: () => ({ from: fmt(startOfMonth(new Date())), to: fmt(new Date()) }) },
    { label: "This financial year", range: () => ({ from: fmt(fiscalYearStart()), to: fmt(new Date()) }) },
];

interface Props {
    value: DateRange;
    onChange: (range: DateRange) => void;
}

export function DateRangeFilter({ value, onChange }: Props) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<DateRange>(value);

    const active = !!(value.from || value.to);
    const label = active
        ? `${value.from ?? "…"} → ${value.to ?? "…"}`
        : "Any date";

    const apply = () => {
        onChange(draft);
        setOpen(false);
    };

    const clear = () => {
        setDraft({});
        onChange({});
        setOpen(false);
    };

    return (
        <Popover
            open={open}
            onOpenChange={(o) => {
                setOpen(o);
                if (o) setDraft(value); // reopening should not show a stale draft
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className={`justify-start gap-2 border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] text-sm font-normal ${
                        active ? "text-white" : "text-[hsl(215,20%,60%)]"
                    }`}
                >
                    <CalendarDays className="w-4 h-4 shrink-0" />
                    <span className="truncate max-w-[13rem]">{label}</span>
                    {active && (
                        <X
                            className="w-3.5 h-3.5 ml-auto shrink-0 hover:text-[hsl(347,77%,65%)]"
                            onClick={(e) => { e.stopPropagation(); clear(); }}
                        />
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-72 glass-panel border-[rgba(255,255,255,0.08)] bg-[hsla(222,40%,10%,0.95)] p-4 space-y-4"
            >
                <div className="space-y-1.5">
                    {PRESETS.map((preset) => (
                        <button
                            key={preset.label}
                            onClick={() => { onChange(preset.range()); setOpen(false); }}
                            className="w-full text-left px-3 py-1.5 rounded-lg text-sm text-[hsl(210,20%,80%)] hover:bg-[rgba(255,255,255,0.06)] hover:text-white transition-colors"
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>

                <div className="pt-3 border-t border-[rgba(255,255,255,0.06)] space-y-2">
                    <p className="text-xs text-[hsl(215,20%,55%)]">Custom range</p>
                    <div className="flex items-center gap-2">
                        <Input
                            type="date"
                            value={draft.from ?? ""}
                            max={draft.to || undefined}
                            onChange={(e) => setDraft({ ...draft, from: e.target.value || undefined })}
                            className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white text-xs h-8"
                        />
                        <span className="text-[hsl(215,20%,45%)] text-xs">to</span>
                        <Input
                            type="date"
                            value={draft.to ?? ""}
                            min={draft.from || undefined}
                            onChange={(e) => setDraft({ ...draft, to: e.target.value || undefined })}
                            className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white text-xs h-8"
                        />
                    </div>
                    <div className="flex gap-2 pt-1">
                        <Button size="sm" variant="outline" className="flex-1 h-8 text-xs border-[rgba(255,255,255,0.1)] text-[hsl(210,20%,80%)]" onClick={clear}>
                            Clear
                        </Button>
                        <Button
                            size="sm"
                            className="flex-1 h-8 text-xs bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white"
                            disabled={!draft.from && !draft.to}
                            onClick={apply}
                        >
                            Apply
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
