/**
 * Row selection for bulk actions.
 *
 * The selection is keyed by id and deliberately survives paging, so an admin can
 * gather rows across several pages before acting. It also keeps the selected
 * rows' data, not just ids — bulk CSV export and the combined delete preview
 * need the row contents, and those rows may no longer be on screen.
 */

import { useCallback, useMemo, useState } from "react";

export function useRowSelection<T extends { id: number }>() {
    const [selected, setSelected] = useState<Map<number, T>>(new Map());

    const toggle = useCallback((row: T) => {
        setSelected((prev) => {
            const next = new Map(prev);
            if (next.has(row.id)) next.delete(row.id);
            else next.set(row.id, row);
            return next;
        });
    }, []);

    /** Select-all applies to the current page only — never to unfetched rows. */
    const togglePage = useCallback((rows: T[]) => {
        setSelected((prev) => {
            const next = new Map(prev);
            const allOnPage = rows.length > 0 && rows.every((r) => next.has(r.id));
            if (allOnPage) rows.forEach((r) => next.delete(r.id));
            else rows.forEach((r) => next.set(r.id, r));
            return next;
        });
    }, []);

    const clear = useCallback(() => setSelected(new Map()), []);

    const isSelected = useCallback((id: number) => selected.has(id), [selected]);

    const pageState = useCallback((rows: T[]): "none" | "some" | "all" => {
        if (rows.length === 0) return "none";
        const count = rows.filter((r) => selected.has(r.id)).length;
        if (count === 0) return "none";
        return count === rows.length ? "all" : "some";
    }, [selected]);

    const rows = useMemo(() => Array.from(selected.values()), [selected]);
    const ids = useMemo(() => Array.from(selected.keys()), [selected]);

    return { selected, rows, ids, count: selected.size, toggle, togglePage, clear, isSelected, pageState };
}

export type RowSelection<T extends { id: number }> = ReturnType<typeof useRowSelection<T>>;
