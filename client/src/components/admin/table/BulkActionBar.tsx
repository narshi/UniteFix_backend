/**
 * Floating bar that appears once rows are selected.
 *
 * Docked to the bottom of the viewport rather than inline in the table, because
 * a selection can span pages — the bar must stay reachable no matter how far
 * the admin has scrolled or which page they are on.
 */

import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export interface BulkAction {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    /** Renders in red and is grouped after a divider. */
    destructive?: boolean;
    disabled?: boolean;
    /** Hidden entirely when false — used for super_admin-only actions. */
    visible?: boolean;
}

interface Props {
    count: number;
    onClear: () => void;
    actions: BulkAction[];
    /** Singular noun, e.g. "customer" → "3 customers selected". */
    noun?: string;
}

export function BulkActionBar({ count, onClear, actions, noun = "row" }: Props) {
    if (count === 0) return null;

    const visible = actions.filter((a) => a.visible !== false);
    const safe = visible.filter((a) => !a.destructive);
    const destructive = visible.filter((a) => a.destructive);

    return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 duration-200">
            <div className="glass-panel border border-[rgba(255,255,255,0.12)] bg-[hsla(222,40%,10%,0.95)] backdrop-blur-xl rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] px-4 py-3 flex items-center gap-3">
                <div className="flex items-center gap-2 pr-3 border-r border-[rgba(255,255,255,0.1)]">
                    <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-[hsl(217,91%,60%)] text-white text-xs font-bold tabular-nums">
                        {count}
                    </span>
                    <span className="text-sm text-[hsl(210,20%,80%)] whitespace-nowrap">
                        {noun}{count === 1 ? "" : "s"} selected
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    {safe.map((action) => (
                        <Button
                            key={action.label}
                            size="sm"
                            variant="outline"
                            disabled={action.disabled}
                            onClick={action.onClick}
                            className="h-8 text-xs gap-1.5 border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] text-[hsl(210,20%,85%)] hover:bg-[rgba(255,255,255,0.08)] hover:text-white"
                        >
                            {action.icon}
                            {action.label}
                        </Button>
                    ))}

                    {destructive.length > 0 && safe.length > 0 && (
                        <span className="w-px h-6 bg-[rgba(255,255,255,0.1)]" />
                    )}

                    {destructive.map((action) => (
                        <Button
                            key={action.label}
                            size="sm"
                            variant="outline"
                            disabled={action.disabled}
                            onClick={action.onClick}
                            className="h-8 text-xs gap-1.5 border-[hsla(347,77%,50%,0.3)] bg-[hsla(347,77%,50%,0.1)] text-[hsl(347,77%,68%)] hover:bg-[hsla(347,77%,50%,0.2)]"
                        >
                            {action.icon}
                            {action.label}
                        </Button>
                    ))}
                </div>

                <Button
                    size="icon"
                    variant="ghost"
                    onClick={onClear}
                    aria-label="Clear selection"
                    className="h-8 w-8 ml-1 text-[hsl(215,20%,60%)] hover:text-white hover:bg-[rgba(255,255,255,0.06)]"
                >
                    <X className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
}

/** Tri-state header checkbox: none / some (indeterminate) / all on this page. */
export function SelectAllCheckbox({
    state,
    onToggle,
}: {
    state: "none" | "some" | "all";
    onToggle: () => void;
}) {
    return (
        <input
            type="checkbox"
            checked={state === "all"}
            ref={(el) => { if (el) el.indeterminate = state === "some"; }}
            onChange={onToggle}
            aria-label="Select all rows on this page"
            className="w-4 h-4 rounded border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.05)] accent-[hsl(217,91%,60%)] cursor-pointer"
        />
    );
}

export function RowCheckbox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
    return (
        <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            aria-label="Select row"
            className="w-4 h-4 rounded border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.05)] accent-[hsl(217,91%,60%)] cursor-pointer"
        />
    );
}
