/**
 * Client-side twin of useTableQuery, for endpoints that return a whole array.
 *
 * Some admin tables are configuration rather than transactional data — the
 * inventory catalogue and the pincode list — and they have inline editing with
 * optimistic updates that depend on holding the full array. Paginating those on
 * the server would mean rewriting the edit flows for no real benefit at their
 * size.
 *
 * It exposes the SAME shape as useTableQuery, so DataToolbar, SortableHeader
 * and DataPagination work against it unchanged. The difference is that `apply()`
 * does the filtering, sorting and slicing in memory instead of a query string
 * reaching the server.
 */

import { useCallback, useMemo, useState } from "react";
import { ALL, type SortOrder, type DateRange } from "./useTableQuery";

export interface ClientTableOptions<T> {
    defaultSort?: string;
    defaultOrder?: SortOrder;
    defaultLimit?: number;
    initialFilters?: Record<string, string>;
    /** Fields concatenated for the free-text search. */
    searchFields?: (row: T) => Array<string | number | null | undefined>;
    /** Field name → value used for sorting and filtering. */
    accessor?: (row: T, field: string) => unknown;
    /** Row timestamp, for the date-range filter. */
    dateField?: (row: T) => string | Date | null | undefined;
}

export function useClientTableQuery<T>(options: ClientTableOptions<T> = {}) {
    const {
        defaultSort = "id",
        defaultOrder = "desc",
        defaultLimit = 25,
        initialFilters = {},
        searchFields,
        accessor = (row: any, field: string) => row?.[field],
        dateField,
    } = options;

    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(defaultLimit);
    const [sort, setSort] = useState(defaultSort);
    const [order, setOrder] = useState<SortOrder>(defaultOrder);
    const [search, setSearch] = useState("");
    const [searchDraft, setSearchDraft] = useState("");
    const [dateRange, setDateRange] = useState<DateRange>({});
    const [filters, setFilters] = useState<Record<string, string>>(initialFilters);

    const setFilter = useCallback((key: string, value: string) => {
        setFilters((prev) => ({ ...prev, [key]: value }));
        setPage(1);
    }, []);

    const applySearch = useCallback(() => {
        setSearch(searchDraft.trim());
        setPage(1);
    }, [searchDraft]);

    const applyDateRange = useCallback((range: DateRange) => {
        setDateRange(range);
        setPage(1);
    }, []);

    const toggleSort = useCallback((field: string) => {
        setSort((current) => {
            if (current === field) {
                setOrder((o) => (o === "asc" ? "desc" : "asc"));
                return current;
            }
            setOrder("desc");
            return field;
        });
        setPage(1);
    }, []);

    const reset = useCallback(() => {
        setPage(1);
        setSort(defaultSort);
        setOrder(defaultOrder);
        setSearch("");
        setSearchDraft("");
        setDateRange({});
        setFilters(initialFilters);
    }, [defaultSort, defaultOrder, JSON.stringify(initialFilters)]);

    const activeFilterCount =
        (search ? 1 : 0) +
        (dateRange.from || dateRange.to ? 1 : 0) +
        Object.entries(filters).filter(([, v]) => v && v !== ALL).length;

    /** Filter → sort → slice. Returns the page plus a pagination envelope. */
    const apply = useCallback((rows: T[]) => {
        let out = rows ?? [];

        if (search && searchFields) {
            const needle = search.toLowerCase();
            out = out.filter((row) =>
                searchFields(row).some((v) => v != null && String(v).toLowerCase().includes(needle))
            );
        }

        for (const [key, value] of Object.entries(filters)) {
            if (!value || value === ALL) continue;
            out = out.filter((row) => String(accessor(row, key) ?? "") === value);
        }

        if ((dateRange.from || dateRange.to) && dateField) {
            const from = dateRange.from ? new Date(dateRange.from).getTime() : -Infinity;
            // Inclusive of the whole `to` day, matching the server's behaviour.
            const to = dateRange.to ? new Date(dateRange.to).getTime() + 86_399_999 : Infinity;
            out = out.filter((row) => {
                const raw = dateField(row);
                if (!raw) return false;
                const t = new Date(raw).getTime();
                return t >= from && t <= to;
            });
        }

        out = [...out].sort((a, b) => {
            const av = accessor(a, sort);
            const bv = accessor(b, sort);
            if (av == null && bv == null) return 0;
            if (av == null) return 1;   // nulls last, whichever direction
            if (bv == null) return -1;

            const an = typeof av === "number" ? av : Number(av);
            const bn = typeof bv === "number" ? bv : Number(bv);
            const numeric = !Number.isNaN(an) && !Number.isNaN(bn) && String(av).trim() !== "";

            const cmp = numeric
                ? an - bn
                : String(av).localeCompare(String(bv), undefined, { numeric: true });
            return order === "asc" ? cmp : -cmp;
        });

        const total = out.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        // A filter that shrinks the list can leave `page` beyond the end.
        const safePage = Math.min(page, totalPages);
        const start = (safePage - 1) * limit;

        return {
            rows: out.slice(start, start + limit),
            pagination: {
                page: safePage,
                limit,
                total,
                totalPages,
                hasMore: safePage < totalPages,
            },
        };
    }, [search, searchFields, filters, dateRange, dateField, sort, order, page, limit, accessor]);

    return {
        // Present for interface parity with useTableQuery; nothing fetches with it.
        key: "",
        queryString: "",

        page, setPage,
        limit, setLimit,
        sort, order, toggleSort,
        search, searchDraft, setSearchDraft, applySearch,
        dateRange, applyDateRange,
        filters, setFilter,
        activeFilterCount,
        reset,
        apply,
    };
}
