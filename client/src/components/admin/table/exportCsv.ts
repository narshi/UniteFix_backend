/**
 * Client-side CSV export for a selection of rows. No endpoint — the rows are
 * already in memory, and round-tripping them to the server would only add a
 * way for the file to disagree with what the admin selected.
 */

export interface CsvColumn<T> {
    header: string;
    value: (row: T) => unknown;
}

/**
 * Escape a cell for CSV.
 *
 * The leading-quote guard is deliberate: a value starting with = + - or @ is
 * executed as a formula when the file is opened in Excel or Sheets, so a
 * username like "=cmd|..." becomes a spreadsheet injection. Prefixing with a
 * single quote makes it inert text.
 */
function escapeCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    let text = value instanceof Date ? value.toISOString() : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
    return text;
}

export function exportCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]): void {
    const header = columns.map((c) => escapeCell(c.header)).join(",");
    const body = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(",")).join("\n");

    // BOM so Excel reads UTF-8 (₹ and Kannada names would otherwise mojibake).
    const blob = new Blob(["﻿" + header + "\n" + body], { type: "text/csv;charset=utf-8;" });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/** `users-2026-08-16.csv` */
export function timestampedName(prefix: string): string {
    return `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
}
