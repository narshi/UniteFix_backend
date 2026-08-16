/**
 * Owns the state behind an admin list table and turns it into the query string
 * the server expects (see server/lib/list-query.ts).
 *
 * The query string doubles as the React Query key, so changing any filter
 * naturally refetches — the same trick audit-logs.tsx already used, generalised.
 */

import { useCallback, useMemo, useState } from "react";

export type SortOrder = "asc" | "desc";

export interface DateRange {
    from?: string; // yyyy-MM-dd
    to?: string;   // yyyy-MM-dd
}

export interface TableQueryOptions {
    defaultSort?: string;
    defaultOrder?: SortOrder;
    defaultLimit?: number;
    /** Filter keys with their initial values, e.g. { status: "all" }. */
    initialFilters?: Record<string, string>;
}

/** Filter value meaning "don't filter" — never sent to the server. */
export const ALL = "all";

export function useTableQuery(basePath: string, options: TableQueryOptions = {}) {
    const {
        defaultSort = "createdAt",
        defaultOrder = "desc",
        defaultLimit = 25,
        initialFilters = {},
    } = options;

    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(defaultLimit);
    const [sort, setSort] = useState(defaultSort);
    const [order, setOrder] = useState<SortOrder>(defaultOrder);
    const [search, setSearch] = useState("");        // committed term
    const [searchDraft, setSearchDraft] = useState(""); // what's in the box
    const [dateRange, setDateRange] = useState<DateRange>({});
    const [filters, setFilters] = useState<Record<string, string>>(initialFilters);

    /** Any filter change must return to page 1, or you land on an empty page. */
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

    /** Click a column: same column flips direction, new column starts descending. */
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

    const queryString = useMemo(() => {
        const params = new URLSearchParams({
            page: String(page),
            limit: String(limit),
            sort,
            order,
        });
        if (search) params.set("q", search);
        if (dateRange.from) params.set("from", dateRange.from);
        if (dateRange.to) params.set("to", dateRange.to);
        for (const [key, value] of Object.entries(filters)) {
            if (value && value !== ALL) params.set(key, value);
        }
        return params.toString();
    }, [page, limit, sort, order, search, dateRange, filters]);

    const activeFilterCount =
        (search ? 1 : 0) +
        (dateRange.from || dateRange.to ? 1 : 0) +
        Object.entries(filters).filter(([, v]) => v && v !== ALL).length;

    return {
        // React Query key — the URL and the key are the same thing on purpose.
        key: `${basePath}?${queryString}`,
        queryString,

        page, setPage,
        limit, setLimit,
        sort, order, toggleSort,
        search, searchDraft, setSearchDraft, applySearch,
        dateRange, applyDateRange,
        filters, setFilter,
        activeFilterCount,
        reset,
    };
}

export type TableQuery = ReturnType<typeof useTableQuery>;

/**
 * What the presentation components (DataToolbar, SortableHeader,
 * DataPagination) actually need. Both useTableQuery and useClientTableQuery
 * satisfy it, so a page can switch between server- and client-side paging
 * without touching its markup.
 */
export interface TableQueryLike {
    page: number;
    setPage: (page: number) => void;
    limit: number;
    setLimit: (limit: number) => void;
    sort: string;
    order: SortOrder;
    toggleSort: (field: string) => void;
    search: string;
    searchDraft: string;
    setSearchDraft: (value: string) => void;
    applySearch: () => void;
    dateRange: DateRange;
    applyDateRange: (range: DateRange) => void;
    filters: Record<string, string>;
    setFilter: (key: string, value: string) => void;
    activeFilterCount: number;
    reset: () => void;
}
