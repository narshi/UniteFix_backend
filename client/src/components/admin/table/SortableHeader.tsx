/**
 * Click-to-sort table header. The `field` must be in the endpoint's sortable
 * allowlist (server/lib/list-query.ts) or the server quietly falls back to its
 * default sort — the column would look interactive but do nothing.
 */

import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import type { TableQuery } from "./useTableQuery";

interface Props {
    query: TableQuery;
    field: string;
    children: React.ReactNode;
    align?: "left" | "right";
    className?: string;
}

export function SortableHeader({ query, field, children, align = "left", className = "" }: Props) {
    const active = query.sort === field;

    return (
        <th
            className={`p-4 text-xs font-medium text-[hsl(215,20%,65%)] uppercase tracking-wider ${
                align === "right" ? "text-right" : "text-left"
            } ${className}`}
        >
            <button
                type="button"
                onClick={() => query.toggleSort(field)}
                className={`inline-flex items-center gap-1.5 uppercase tracking-wider transition-colors group ${
                    align === "right" ? "flex-row-reverse" : ""
                } ${active ? "text-white" : "hover:text-[hsl(210,20%,85%)]"}`}
                aria-sort={active ? (query.order === "asc" ? "ascending" : "descending") : "none"}
            >
                {children}
                {active ? (
                    query.order === "asc"
                        ? <ArrowUp className="w-3 h-3 text-[hsl(217,91%,65%)]" />
                        : <ArrowDown className="w-3 h-3 text-[hsl(217,91%,65%)]" />
                ) : (
                    <ChevronsUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                )}
            </button>
        </th>
    );
}
