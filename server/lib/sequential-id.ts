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
