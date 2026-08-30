/**
 * Audit trail helper.
 *
 * The audit_logs table already existed and order/service/return flows wrote to
 * it, but the money- and trust-critical admin actions did not: payout approval,
 * employee verification, dispute resolution, booking overrides and platform
 * config changes all happened with no record of who did what.
 *
 * Everything goes through this helper so entries share one shape and a failure
 * to write an audit row can never roll back or block the action it describes.
 */

import { db } from '../db';
import { auditLogs } from '@shared/schema';
import logger from './logger';

/** Entities we record against. Keep in step with the dashboard filter list. */
export type AuditEntity =
    | 'service_request'
    | 'employee'
    | 'user'
    | 'withdrawal'
    | 'config'
    | 'product_order'
    | 'return_request'
    | 'payment'
    | 'service_category'
    | 'db_console'
    | 'admin_user'
    | 'admin_role'
    | 'ftth_operator'
    | 'ftth_connection'
    | 'ftth_lead';

export interface AuditEntry {
    entityType: AuditEntity;
    entityId: number;
    /** Imperative and specific, e.g. 'withdrawal_approved', 'config_updated'. */
    action: string;
    /** Admin/user id responsible. Null for system-initiated changes. */
    changedBy?: number | null;
    fromState?: string | null;
    toState?: string | null;
    /** Amounts, reasons, external ids — anything needed to reconstruct the event. */
    metadata?: Record<string, unknown>;
}

/**
 * Record an audit entry.
 *
 * Deliberately never throws: an audit write must not fail a payout or a
 * verification. Failures are logged loudly instead so the gap is visible.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
    try {
        await db.insert(auditLogs).values({
            entityType: entry.entityType,
            entityId: entry.entityId,
            action: entry.action,
            fromState: entry.fromState ?? null,
            toState: entry.toState ?? null,
            changedBy: entry.changedBy ?? null,
            metadata: (entry.metadata ?? null) as any,
        });
    } catch (err: any) {
        logger.error('[AUDIT] Failed to record entry — action still applied', {
            entityType: entry.entityType,
            entityId: entry.entityId,
            action: entry.action,
            error: err.message,
        });
    }
}
