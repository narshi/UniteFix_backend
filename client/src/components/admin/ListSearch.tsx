/**
 * A search box for a client-side list.
 *
 * Every admin listing should be searchable; the pages that fetch a whole
 * array and render it (as opposed to the paginated, server-queried tables
 * that use DataToolbar) had no way to find one row once the list grew. This
 * is the smallest thing that fixes that: an input, and a hook that filters
 * an array by the fields the page names. Filtering happens as you type — the
 * data is already in memory, so there is nothing to debounce.
 */

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";

export function useListSearch<T>(rows: T[] | undefined, fields: (row: T) => Array<string | number | null | undefined>) {
    const [q, setQ] = useState("");
    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        const all = rows ?? [];
        if (!needle) return all;
        return all.filter(r => fields(r).some(v => v != null && String(v).toLowerCase().includes(needle)));
    }, [rows, q, fields]);
    return { q, setQ, filtered, active: q.trim().length > 0, total: rows?.length ?? 0 };
}

export function ListSearch({ value, onChange, placeholder = "Search…", className = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
    return (
        <div className={`relative ${className}`}>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="h-9 pl-8 pr-8" />
            {value && (
                <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                </button>
            )}
        </div>
    );
}
