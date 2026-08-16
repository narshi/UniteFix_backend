/**
 * Pager for admin tables. Shows the row window ("26–50 of 312") because a bare
 * page number tells an admin nothing about how much data they are looking at.
 */

import { Button } from "@/components/ui/button";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TableQueryLike } from "./useTableQuery";

export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
}

interface Props {
    query: TableQueryLike;
    pagination?: PaginationMeta;
    /** Rows on the current page, used for the window when total is 0. */
    rowCount?: number;
}

const PAGE_SIZES = [10, 25, 50, 100];

export function DataPagination({ query, pagination, rowCount = 0 }: Props) {
    const total = pagination?.total ?? rowCount;
    const totalPages = pagination?.totalPages ?? 1;
    const page = pagination?.page ?? query.page;
    const limit = pagination?.limit ?? query.limit;

    if (total === 0) return null;

    const first = (page - 1) * limit + 1;
    const last = Math.min(page * limit, total);

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)]">
            <p className="text-xs text-[hsl(215,20%,60%)]">
                Showing <span className="text-white font-medium">{first}–{last}</span> of{" "}
                <span className="text-white font-medium">{total}</span>
            </p>

            <div className="flex items-center gap-3">
                <Select
                    value={String(limit)}
                    onValueChange={(v) => { query.setLimit(Number(v)); query.setPage(1); }}
                >
                    <SelectTrigger className="w-[5.5rem] h-8 text-xs bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {PAGE_SIZES.map((n) => (
                            <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <div className="flex items-center gap-1">
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-[hsl(215,20%,65%)] hover:text-white hover:bg-[rgba(255,255,255,0.05)] disabled:opacity-30"
                        disabled={page <= 1}
                        onClick={() => query.setPage(page - 1)}
                        aria-label="Previous page"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </Button>

                    <span className="text-xs text-[hsl(215,20%,70%)] px-2 tabular-nums">
                        {page} / {totalPages}
                    </span>

                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-[hsl(215,20%,65%)] hover:text-white hover:bg-[rgba(255,255,255,0.05)] disabled:opacity-30"
                        disabled={page >= totalPages}
                        onClick={() => query.setPage(page + 1)}
                        aria-label="Next page"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
