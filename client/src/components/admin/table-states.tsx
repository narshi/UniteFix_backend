/**
 * Shared table state rows for admin list pages.
 *
 * Previously every list page rendered only `rows.map(...)`, so a failed request
 * and a genuinely empty result both produced a table with headers and no body —
 * indistinguishable from each other and from a stuck load.
 */
import { Button } from "@/components/ui/button";

interface StateRowProps {
  /** Must match the table's column count so the cell spans the full width. */
  colSpan: number;
}

export function TableEmptyState({
  colSpan,
  icon = "inbox",
  title = "Nothing here yet",
  description,
}: StateRowProps & { icon?: string; title?: string; description?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-12 text-center">
        <div className="flex flex-col items-center gap-3">
          <span
            className="material-icons text-4xl text-[hsl(215,20%,35%)]"
            style={{ fontFamily: "Material Icons" }}
          >
            {icon}
          </span>
          <p className="text-[hsl(210,20%,80%)] font-medium">{title}</p>
          {description && (
            <p className="text-sm text-[hsl(215,20%,55%)] max-w-sm">{description}</p>
          )}
        </div>
      </td>
    </tr>
  );
}

export function TableErrorState({
  colSpan,
  onRetry,
  message = "Could not load this data.",
}: StateRowProps & { onRetry?: () => void; message?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-12 text-center">
        <div className="flex flex-col items-center gap-3">
          <span
            className="material-icons text-4xl text-[hsl(347,77%,60%)]"
            style={{ fontFamily: "Material Icons" }}
          >
            error_outline
          </span>
          <p className="text-[hsl(210,20%,80%)] font-medium">{message}</p>
          <p className="text-sm text-[hsl(215,20%,55%)]">
            This is a loading failure, not an empty list.
          </p>
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="mt-1 border-[rgba(255,255,255,0.12)] text-[hsl(210,20%,85%)] hover:bg-[rgba(255,255,255,0.06)]"
            >
              Retry
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
