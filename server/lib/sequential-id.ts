import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Next number for a prefixed sequential id (e.g. SR000017), derived from the
 * MAX existing id — NOT the row count.
 *
 * Using count()+1 was a latent integrity bug: once any row is deleted, count()+1
 * collides with a still-existing id and the unique insert throws (500). Deriving
 * from the max, and only over ids matching the exact `prefix + digits` shape,
 * survives deletions and ignores unrelated id formats sharing the column.
 *
 * Callers should still retry the insert on a 23505 (unique_violation), bumping
 * the number, to cover the rare concurrent-insert race.
 *
 * tableName/idColumn/prefix are hardcoded constants (never user input), so
 * sql.raw is safe here.
 */
export async function nextSequentialNumber(tableName: string, idColumn: string, prefix: string): Promise<number> {
    const digitsFrom = prefix.length + 1; // 1-indexed substring start, after the prefix
    const res: any = await db.execute(sql.raw(
        `SELECT COALESCE(MAX(CAST(substring(${idColumn} from ${digitsFrom}) AS bigint)), 0) AS max ` +
        `FROM ${tableName} WHERE ${idColumn} ~ '^${prefix}[0-9]+$'`
    ));
    const rows = Array.isArray(res) ? res : (res?.rows ?? []);
    return Number(rows[0]?.max ?? 0) + 1;
}

/**
 * Returns the Indian Fiscal Year prefix for a given date.
 * E.g., for March 2026 -> "UF/25-26/"
 * E.g., for April 2026 -> "UF/26-27/"
 */
export function getFiscalYearInvoicePrefix(date = new Date()): string {
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-indexed, 3 = April

    let startYear, endYear;
    if (month >= 3) {
        // April to December
        startYear = year;
        endYear = year + 1;
    } else {
        // January to March
        startYear = year - 1;
        endYear = year;
    }

    const startYY = startYear.toString().slice(-2);
    const endYY = endYear.toString().slice(-2);
    return `UF/${startYY}-${endYY}/`;
}

/**
 * Handles the retry loop for inserting an invoice with a sequential,
 * fiscal-year-aware ID (e.g., UF/25-26/0001).
 * 
 * @param insertFn A function that receives the generated invoice ID and attempts the insert.
 */
export async function generateInvoiceIdWithRetry<T>(
    insertFn: (invoiceId: string) => Promise<T>,
    padding = 4
): Promise<T> {
    const prefix = getFiscalYearInvoicePrefix();
    let next = await nextSequentialNumber('invoices', 'invoice_id', prefix);

    for (let attempt = 0; attempt < 6; attempt++) {
        const invoiceId = `${prefix}${String(next).padStart(padding, '0')}`;
        try {
            return await insertFn(invoiceId);
        } catch (err: any) {
            // 23505 is PostgreSQL unique_violation
            if (err?.code === '23505') {
                next++;
                continue;
            }
            throw err;
        }
    }
    throw new Error(`Could not allocate a unique invoice id after several attempts for prefix ${prefix}`);
}
