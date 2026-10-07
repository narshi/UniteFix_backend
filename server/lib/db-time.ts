/**
 * Timestamps filled by SQL now() hold the database session's wall-clock time
 * (IST here), while drizzle reads every timestamp column as UTC. Rows written
 * from JS round-trip correctly; rows defaulted by now() come back shifted by
 * the session offset. Where a decision depends on such a column (how old an
 * order or a job really is), read its instant through this instead.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

/** Milliseconds since the epoch for a column defaulted by now() — a plain number, safe to compare in JS. */
export const nowFilledMs = (col: AnyColumn | SQL) =>
    sql<number>`(extract(epoch from (${col} at time zone current_setting('TimeZone'))) * 1000)::float8`;
