/**
 * A broadband subscriber's mobile numbers.
 *
 * The connection — its ISP id, recharges and history — is the subscriber and
 * never changes. What changes is which number, and so which UniteFix member,
 * it belongs to. Each number is a row in ftth_connection_phones; a number is
 * never deleted, only closed (replaced or suspended) with when, why and by
 * whom, so the subscriber's history stays as it was.
 *
 *   change      the new number must belong to a UniteFix member, must not be
 *               the current one, and that member must not already hold another
 *               open connection with this partner (one per member per partner —
 *               an ID request would otherwise overwrite it). The member is
 *               linked at once: their app shows the connection.
 *   suspend     the current number loses the connection (lost or stolen
 *               phone); the subscriber stays as it is, waiting for a number.
 *   reactivate  a previous number becomes current again — the same checks as
 *               a change.
 */

import { db } from '../db';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { ftthConnections, ftthConnectionPhones, ftthOperators, users } from '@shared/schema';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';
import { nowFilledMs } from '../lib/db-time';

export class PhoneChangeError extends Error {
    constructor(message: string, public code: string, public status = 400) { super(message); }
}

type Actor = { operatorId: number; adminUserId: number | null };

/** The last ten digits of an Indian mobile number, or null. */
export function tenDigitPhone(raw: unknown): string | null {
    const d = String(raw ?? '').replace(/\D/g, '');
    const t = d.length > 10 && (d.startsWith('91') || d.startsWith('0')) ? d.slice(-10) : d;
    return /^[6-9]\d{9}$/.test(t) ? t : null;
}
const mask = (p: string | null | undefined) => (p ? `…${p.slice(-4)}` : null);

export class FtthPhoneService {

    /** The UniteFix member signed up with this number (not a closed account), if any. */
    static async memberByPhone(phone: string, tx: any = db) {
        const [u] = await tx.select({ id: users.id, name: users.username, role: users.role }).from(users)
            .where(and(sql`right(regexp_replace(coalesce(${users.phone}, ''), '\\D', '', 'g'), 10) = ${phone}`, isNull(users.deletedAt)))
            .orderBy(asc(users.id)).limit(1);
        return u ?? null;
    }

    private static async connectionOf(actor: Actor, connectionId: number, tx: any = db) {
        const [c] = await tx.select().from(ftthConnections)
            .where(and(eq(ftthConnections.id, connectionId), eq(ftthConnections.operatorId, actor.operatorId))).limit(1);
        if (!c) throw new PhoneChangeError('Subscriber not found.', 'NOT_FOUND', 404);
        return c;
    }

    /** When the subscriber was really created (its created_at is filled by SQL now(); see db-time). */
    private static async createdInstant(connectionId: number, tx: any = db): Promise<Date> {
        const [r] = await tx.select({ ms: nowFilledMs(ftthConnections.createdAt) }).from(ftthConnections).where(eq(ftthConnections.id, connectionId)).limit(1);
        return r?.ms ? new Date(Number(r.ms)) : new Date();
    }

    /**
     * The number history, newest first. A subscriber whose number predates the
     * history (set by hand or by import) shows it as the current number until
     * the first change records it.
     */
    static async list(actor: Actor, connectionId: number) {
        const c = await this.connectionOf(actor, connectionId);
        const rows = await db.select({ p: ftthConnectionPhones, memberName: users.username })
            .from(ftthConnectionPhones).leftJoin(users, eq(users.id, ftthConnectionPhones.userId))
            .where(eq(ftthConnectionPhones.connectionId, connectionId))
            .orderBy(desc(ftthConnectionPhones.createdAt), desc(ftthConnectionPhones.id));
        const history = rows.map(r => ({
            id: r.p.id, phone: r.p.phone, status: r.p.status, memberName: r.memberName ?? null, linked: !!r.p.userId,
            reason: r.p.reason, addedAt: r.p.createdAt, endedAt: r.p.endedAt, endedReason: r.p.endedReason,
        }));
        if (!history.some(h => h.status === 'active') && c.customerPhone) {
            const m = c.userId ? (await db.select({ name: users.username }).from(users).where(eq(users.id, c.userId)).limit(1))[0] : null;
            history.unshift({ id: 0, phone: c.customerPhone, status: 'active', memberName: m?.name ?? null, linked: !!c.userId, reason: null, addedAt: await this.createdInstant(c.id), endedAt: null, endedReason: null });
        }
        return { connectionId: c.id, status: c.status, ispConnectionId: c.ispConnectionId, current: c.customerPhone, linked: !!c.userId, history };
    }

    /** Close the current number's row (recording it first if it predates the history). */
    private static async endCurrent(tx: any, c: typeof ftthConnections.$inferSelect, actor: Actor, endedReason: string) {
        const [active] = await tx.select().from(ftthConnectionPhones)
            .where(and(eq(ftthConnectionPhones.connectionId, c.id), eq(ftthConnectionPhones.status, 'active'))).limit(1);
        const now = new Date();
        if (active) {
            await tx.update(ftthConnectionPhones).set({ status: 'suspended', endedAt: now, endedReason, endedByAdminId: actor.adminUserId })
                .where(eq(ftthConnectionPhones.id, active.id));
        } else if (c.customerPhone) {
            await tx.insert(ftthConnectionPhones).values({
                connectionId: c.id, phone: c.customerPhone, userId: c.userId, status: 'suspended', reason: 'Number on file before history was kept',
                endedAt: now, endedReason, endedByAdminId: actor.adminUserId, createdAt: await this.createdInstant(c.id, tx),
            });
        }
    }

    /**
     * Put a new number on the subscriber. Strict: the number must belong to a
     * UniteFix member, who must not already hold another open connection with
     * this partner.
     */
    static async change(actor: Actor, connectionId: number, rawPhone: unknown, reason?: string | null) {
        const phone = tenDigitPhone(rawPhone);
        if (!phone) throw new PhoneChangeError('Enter a 10-digit Indian mobile number.', 'BAD_PHONE');
        const why = String(reason ?? '').trim().slice(0, 200) || null;

        const result = await db.transaction(async (tx) => {
            // Serialise changes to one subscriber.
            await tx.execute(sql`SELECT id FROM ftth_connections WHERE id = ${connectionId} FOR UPDATE`);
            const c = await this.connectionOf(actor, connectionId, tx);
            if (c.status === 'closed') throw new PhoneChangeError('This subscriber is closed. Reopen them first.', 'CLOSED', 409);
            if (c.customerPhone === phone && c.userId) throw new PhoneChangeError('That is already the current number.', 'SAME', 409);

            const member = await this.memberByPhone(phone, tx);
            if (!member) {
                throw new PhoneChangeError('No UniteFix member has this number. Ask the customer to sign up in the UniteFix app with it first, then change the number.', 'NOT_MEMBER', 422);
            }
            const [other] = await tx.select({ id: ftthConnections.id, ispConnectionId: ftthConnections.ispConnectionId }).from(ftthConnections)
                .where(and(eq(ftthConnections.operatorId, actor.operatorId), eq(ftthConnections.userId, member.id), ne(ftthConnections.id, c.id), ne(ftthConnections.status, 'closed')))
                .limit(1);
            if (other) {
                throw new PhoneChangeError(`This member already has another connection with you (${other.ispConnectionId ?? `#${other.id}`}). One UniteFix account holds one connection per broadband partner — suspend that number there first, or use a different number.`, 'MEMBER_HAS_CONNECTION', 409);
            }

            await this.endCurrent(tx, c, actor, 'changed');
            const [row] = await tx.insert(ftthConnectionPhones).values({
                connectionId: c.id, phone, userId: member.id, status: 'active', reason: why, addedByAdminId: actor.adminUserId, createdAt: new Date(),
            }).returning();
            await tx.update(ftthConnections).set({ customerPhone: phone, userId: member.id, updatedAt: new Date() }).where(eq(ftthConnections.id, c.id));
            return { c, row, member };
        });

        await recordAudit({
            entityType: 'ftth_connection', entityId: connectionId, action: 'ftth_phone_changed', changedBy: actor.adminUserId,
            metadata: { operatorId: actor.operatorId, from: mask(result.c.customerPhone), to: mask(phone), fromUserId: result.c.userId, toUserId: result.member.id, reason: why },
        });
        void this.notify(result.c, result.member.id, result.c.userId && result.c.userId !== result.member.id ? result.c.userId : null);
        return { phone, memberName: result.member.name, history: (await this.list(actor, connectionId)).history };
    }

    /** The current number loses the subscriber (lost or stolen phone). */
    static async suspend(actor: Actor, connectionId: number, reason?: string | null) {
        const why = String(reason ?? '').trim().slice(0, 200);
        if (why.length < 3) throw new PhoneChangeError('Say why the number is suspended (e.g. "phone lost").', 'NO_REASON');
        const c = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT id FROM ftth_connections WHERE id = ${connectionId} FOR UPDATE`);
            const conn = await this.connectionOf(actor, connectionId, tx);
            if (!conn.customerPhone && !conn.userId) throw new PhoneChangeError('This subscriber has no number to suspend.', 'NO_NUMBER', 409);
            await this.endCurrent(tx, conn, actor, `suspended: ${why}`);
            await tx.update(ftthConnections).set({ customerPhone: null, userId: null, updatedAt: new Date() }).where(eq(ftthConnections.id, conn.id));
            return conn;
        });
        await recordAudit({ entityType: 'ftth_connection', entityId: connectionId, action: 'ftth_phone_suspended', changedBy: actor.adminUserId, metadata: { operatorId: actor.operatorId, phone: mask(c.customerPhone), userId: c.userId, reason: why } });
        return { history: (await this.list(actor, connectionId)).history };
    }

    /** A previous number becomes current again — same checks as a change. */
    static async reactivate(actor: Actor, connectionId: number, phoneId: number, reason?: string | null) {
        const [p] = await db.select().from(ftthConnectionPhones)
            .where(and(eq(ftthConnectionPhones.id, phoneId), eq(ftthConnectionPhones.connectionId, connectionId))).limit(1);
        await this.connectionOf(actor, connectionId);
        if (!p) throw new PhoneChangeError('That number is not in this subscriber\'s history.', 'NOT_FOUND', 404);
        if (p.status === 'active') throw new PhoneChangeError('That is already the current number.', 'SAME', 409);
        return this.change(actor, connectionId, p.phone, reason?.trim() || 'Previous number reactivated');
    }

    /** Record the number a subscriber is created with, so its history starts at the beginning. */
    static async recordInitial(tx: any, connectionId: number, phone: string | null, userId: number | null, adminUserId: number | null, reason = 'Added with the subscriber') {
        if (!phone) return;
        await tx.insert(ftthConnectionPhones).values({ connectionId, phone, userId, status: 'active', reason, addedByAdminId: adminUserId, createdAt: new Date() });
    }

    private static async notify(c: typeof ftthConnections.$inferSelect, newUserId: number, oldUserId: number | null) {
        try {
            const [op] = await db.select({ name: ftthOperators.companyName }).from(ftthOperators).where(eq(ftthOperators.id, c.operatorId)).limit(1);
            const { NotificationService } = await import('./notification.service');
            const who = op?.name ?? 'your broadband provider';
            await NotificationService.sendToUser(newUserId, 'Broadband connection added', `${who} moved connection ${c.ispConnectionId ?? ''} to your UniteFix account. You can recharge it in the app.`.replace(/\s+/g, ' '), 'ftth_connection_linked', { connectionId: c.id });
            if (oldUserId) await NotificationService.sendToUser(oldUserId, 'Broadband connection moved', `${who} moved connection ${c.ispConnectionId ?? ''} to another mobile number. Contact them if this was not you.`.replace(/\s+/g, ' '), 'ftth_connection_unlinked', { connectionId: c.id });
        } catch (e: any) { logger.warn(`[FTTH] phone change notification failed: ${e?.message}`); }
    }
}
