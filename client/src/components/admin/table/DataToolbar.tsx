/**
 * The filter bar above an admin table: search, dropdown filters, date range,
 * and a reset that only appears when there is something to reset.
 *
 * Filters are declared as data so each page describes what it needs rather than
 * rebuilding the same row of controls.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, RotateCcw } from "lucide-react";
import { DateRangeFilter } from "./DateRangeFilter";
import { ALL, type TableQueryLike } from "./useTableQuery";

export interface FilterSpec {
    /** Query-string key, e.g. "status". */
    key: string;
    /** Placeholder shown when the value is ALL. */
    label: string;
    options: Array<{ value: string; label: string }>;
}

interface Props {
    query: TableQueryLike;
    searchPlaceholder?: string;
    filters?: FilterSpec[];
    /** Set false for tables with no meaningful date column. */
    showDateRange?: boolean;
    /** Extra controls (e.g. an "Add" button) rendered at the end of the bar. */
    children?: React.ReactNode;
}

export function DataToolbar({
    query,
    searchPlaceholder = "Search…",
    filters = [],
    showDateRange = true,
    children,
}: Props) {
    return (
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 w-full">
            <div className="relative w-full lg:w-64 shrink-0">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-[hsl(215,20%,50%)]" />
                <Input
                    placeholder={searchPlaceholder}
                    value={query.searchDraft}
                    onChange={(e) => query.setSearchDraft(e.target.value)}
                    // Enter commits: searching on every keystroke would fire a
                    // request per character against a server-side query.
                    onKeyDown={(e) => e.key === "Enter" && query.applySearch()}
                    onBlur={() => query.searchDraft !== query.search && query.applySearch()}
                    className="pl-9 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[hsl(215,20%,40%)] focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                />
            </div>

            <div className="flex flex-wrap items-center gap-3">
                {filters.map((filter) => (
                    <Select
                        key={filter.key}
                        value={query.filters[filter.key] ?? ALL}
                        onValueChange={(v) => query.setFilter(filter.key, v)}
                    >
                        <SelectTrigger className="w-full sm:w-44 bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:ring-[hsla(217,91%,60%,0.3)]">
                            <SelectValue placeholder={filter.label} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>{filter.label}</SelectItem>
                            {filter.options.map((o) => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ))}

                {showDateRange && (
                    <DateRangeFilter value={query.dateRange} onChange={query.applyDateRange} />
                )}

                {query.activeFilterCount > 0 && (
                    <Button
                        variant="ghost"
                        onClick={query.reset}
                        className="text-[hsl(215,20%,65%)] hover:text-white hover:bg-[rgba(255,255,255,0.05)] gap-2"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Reset ({query.activeFilterCount})
                    </Button>
                )}
            </div>

            {children && <div className="lg:ml-auto flex items-center gap-2">{children}</div>}
        </div>
    );
}
