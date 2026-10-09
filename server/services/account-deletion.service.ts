/**
 * Account deletion — the customer or expert asks, UniteFix decides.
 *
 *   request   from the app, with what is wrong in their own words; one open
 *             request per person (a partial unique index). Staff are alerted.
 *   cancel    the person changes their mind while it is pending
 *   approve   staff check nothing is left hanging (open bookings, money in
 *             the wallet, a payout in flight) and approve: the account is
 *             deactivated and marked deleted — the same soft delete the app
 *             used to do on one tap, so records and invoices stay intact and
 *             a later sign-up with the same number starts fresh. Signed-in
 *             devices are logged out on their next request.
 *   deny      with a reason the person sees in the app and as a notification
 *
 * Staff can still purge an account outright afterwards (Users → delete).
 */

import { db } from '../db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { accountDeletionRequests, users, employees, serviceRequests, partnerWallets, withdrawalRequests, productOrders, refreshTokens } from '@shared/schema';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

export class DeletionError extends Error {
    constructor(message: string, public code: string, public status = 400) { super(message); }
}

export const REASON_CATEGORIES: Record<string, string> = {
    not_using: "I don't use UniteFix any more",
    privacy: 'Privacy concerns',
    bad_experience: 'I had a bad experience',
    duplicate: 'I have another account',
    moving: "I'm moving out of the service area",
    other: 'Something else',
};
const OPEN_BOOKING = ['created', 'assigned', 'accepted', 'reached', 'in_progress', 'pending_payment', 'disputed'] as const;
const OPEN_ORDER = ['placed', 'confirmed', 'shipped', 'in_transit', 'out_for_delivery', 'return_requested', 'return_approved', 'return_shipped'];

export class AccountDeletionService {

    static view(r: typeof accountDeletionRequests.$inferSelect) {
        return {
            id: r.id, status: r.status, reasonCategory: r.reasonCategory, reasonLabel: r.reasonCategory ? REASON_CATEGORIES[r.reasonCategory] ?? r.reasonCategory : null,
            reason: r.reason, adminNote: r.status === 'denied' ? r.adminNote : null, createdAt: r.createdAt, decidedAt: r.decidedAt,
        };
    }

    static async latest(userId: number) {
        const [r] = await db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.userId, userId)).orderBy(desc(accountDeletionRequests.createdAt)).limit(1);
        return r ?? null;
    }

    static async request(userId: number, input: { reasonCategory?: string | null; reason?: string | null; source?: 'app' | 'legacy_app' }) {
        const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!u || u.deletedAt) throw new DeletionError('Account not found.', 'NOT_FOUND', 404);
        const category = input.reasonCategory && REASON_CATEGORIES[input.reasonCategory] ? input.reasonCategory : null;
        const reason = (input.reason ?? '').trim().slice(0, 1000);
        if (input.source !== 'legacy_app') {
            if (!category) throw new DeletionError('Tell us why you are leaving.', 'NO_CATEGORY');
            if (reason.length < 10) throw new DeletionError('Please describe it in a few words (at least 10 characters).', 'NO_REASON');
        }
        try {
            const [row] = await db.insert(accountDeletionRequests).values({
                userId, role: u.role, reasonCategory: category, source: input.source ?? 'app',
                reason: reason || 'Requested from an older version of the app — no reason given.',
            }).returning();
            try {
                const { NotificationService } = await import('./notification.service');
                void NotificationService.sendToAdmins('Account deletion requested', `${u.role === 'serviceman' ? 'Expert' : 'Customer'} #${u.id} asked to delete their account.`, { type: 'account_deletion', requestId: row.id });
            } catch { /* a missed staff ping must not fail the request */ }
            await recordAudit({ entityType: 'user', entityId: userId, action: 'account_deletion_requested', changedBy: userId, metadata: { requestId: row.id, category } });
            return row;
        } catch (e: any) {
            if (e?.code === '23505' || e?.cause?.code === '23505') throw new DeletionError('You have already asked to delete your account. We will be in touch.', 'PENDING', 409);
            throw e;
        }
    }

    static async cancel(userId: number) {
        const [u] = await db.update(accountDeletionRequests).set({ status: 'cancelled', decidedAt: new Date() })
            .where(and(eq(accountDeletionRequests.userId, userId), eq(accountDeletionRequests.status, 'pending'))).returning();
        if (!u) throw new DeletionError('There is no open request to cancel.', 'NONE', 404);
        await recordAudit({ entityType: 'user', entityId: userId, action: 'account_deletion_cancelled', changedBy: userId, metadata: { requestId: u.id } });
        return u;
    }

    /** What is still open on the account — for staff to weigh before approving. */
    static async impact(userId: number) {
        const [emp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, userId)).limit(1);
        const [asCustomer] = await db.select({ n: sql<number>`count(*)::int` }).from(serviceRequests)
            .where(and(eq(serviceRequests.userId, userId), inArray(serviceRequests.status, OPEN_BOOKING as any)));
        const [asExpert] = emp ? await db.select({ n: sql<number>`count(*)::int` }).from(serviceRequests)
            .where(and(eq(serviceRequests.providerId, emp.id), inArray(serviceRequests.status, OPEN_BOOKING as any))) : [{ n: 0 }];
        const [orders] = await db.select({ n: sql<number>`count(*)::int` }).from(productOrders)
            .where(and(eq(productOrders.userId, userId), inArray(productOrders.status, OPEN_ORDER as any)));
        const [wallet] = emp ? await db.select({ held: partnerWallets.balanceHold, available: partnerWallets.balanceAvailable }).from(partnerWallets).where(eq(partnerWallets.partnerId, emp.id)).limit(1) : [];
        const [payouts] = emp ? await db.select({ n: sql<number>`count(*)::int` }).from(withdrawalRequests)
            .where(and(eq(withdrawalRequests.partnerId, emp.id), inArray(withdrawalRequests.status, ['pending', 'processing'] as any))) : [{ n: 0 }];
        const walletHeld = Number(wallet?.held ?? 0), walletAvailable = Number(wallet?.available ?? 0);
        const blockers = [
            asCustomer.n ? `${asCustomer.n} open booking${asCustomer.n === 1 ? '' : 's'} as a customer` : null,
            asExpert.n ? `${asExpert.n} open job${asExpert.n === 1 ? '' : 's'} as an expert` : null,
            orders.n ? `${orders.n} store order${orders.n === 1 ? '' : 's'} not yet delivered` : null,
            walletAvailable > 0 || walletHeld > 0 ? `₹${(walletAvailable + walletHeld).toLocaleString('en-IN')} in their wallet to pay out first` : walletAvailable < 0 ? `₹${Math.abs(walletAvailable).toLocaleString('en-IN')} owed to UniteFix` : null,
            payouts.n ? `${payouts.n} payout${payouts.n === 1 ? '' : 's'} in progress` : null,
        ].filter(Boolean) as string[];
        return { openBookings: asCustomer.n, openJobs: asExpert.n, openOrders: orders.n, walletAvailable, walletHeld, payoutsInFlight: payouts.n, blockers };
    }

    static async list(status?: string) {
        const rows = await db.select({ r: accountDeletionRequests, name: users.username, phone: users.phone, email: users.email, joined: users.createdAt })
            .from(accountDeletionRequests).innerJoin(users, eq(users.id, accountDeletionRequests.userId))
            .where(status ? eq(accountDeletionRequests.status, status) : undefined)
            .orderBy(desc(accountDeletionRequests.createdAt)).limit(300);
        const out = [];
        for (const x of rows) {
            out.push({
                ...this.view(x.r), adminNote: x.r.adminNote, userId: x.r.userId, role: x.r.role, source: x.r.source,
                name: x.name, phone: x.phone, email: x.email, joined: x.joined,
                impact: x.r.status === 'pending' ? await this.impact(x.r.userId) : null,
            });
        }
        return out;
    }

    static async pendingCount() {
        const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(accountDeletionRequests).where(eq(accountDeletionRequests.status, 'pending'));
        return r?.n ?? 0;
    }

    private static async pending(id: number) {
        const [r] = await db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.id, id)).limit(1);
        if (!r) throw new DeletionError('Request not found.', 'NOT_FOUND', 404);
        if (r.status !== 'pending') throw new DeletionError(`This request is already ${r.status}.`, 'DECIDED', 409);
        return r;
    }

    /**
     * Approve. Open bookings, jobs, orders, wallet money or payouts must be
     * settled first — unless staff explicitly approve anyway (`force`), which
     * is recorded.
     */
    static async approve(adminId: number, id: number, input: { note?: string | null; force?: boolean }) {
        const r = await this.pending(id);
        const impact = await this.impact(r.userId);
        if (impact.blockers.length && !input.force) {
            throw new DeletionError(`Settle these first, or approve anyway: ${impact.blockers.join('; ')}.`, 'OPEN_ITEMS', 409);
        }
        const now = new Date();
        await db.transaction(async (tx) => {
            const [u] = await tx.update(accountDeletionRequests).set({ status: 'approved', adminNote: input.note?.trim().slice(0, 500) || null, decidedByAdminId: adminId, decidedAt: now })
                .where(and(eq(accountDeletionRequests.id, id), eq(accountDeletionRequests.status, 'pending'))).returning();
            if (!u) throw new DeletionError('This request was decided a moment ago.', 'DECIDED', 409);
            await tx.update(users).set({ isActive: false, deletedAt: now, updatedAt: now }).where(eq(users.id, r.userId));
            await tx.update(employees).set({ isActive: false, isOnline: false, documentVerificationStatus: 'suspended' as any, updatedAt: now }).where(eq(employees.userId, r.userId));
            await tx.delete(refreshTokens).where(eq(refreshTokens.userId, r.userId));
        });
        await recordAudit({ entityType: 'user', entityId: r.userId, action: 'account_deletion_approved', changedBy: adminId, fromState: 'active', toState: 'deleted', metadata: { requestId: id, forced: !!input.force && impact.blockers.length > 0, openItems: impact.blockers } });
        try {
            const { NotificationService } = await import('./notification.service');
            void NotificationService.sendToUser(r.userId, 'Your UniteFix account has been deleted', 'As you asked, your account is closed. Thank you for using UniteFix.', 'account_deletion', { requestId: id }).catch(() => undefined);
        } catch { /* best effort */ }
        logger.warn(`[ACCOUNT] deletion request #${id} approved by admin ${adminId} — user #${r.userId} deactivated`);
        return { ...r, status: 'approved' };
    }

    static async deny(adminId: number, id: number, input: { note: string }) {
        const note = input.note?.trim();
        if (!note || note.length < 5) throw new DeletionError('Tell them why — they will see this note.', 'NO_NOTE');
        const r = await this.pending(id);
        const [u] = await db.update(accountDeletionRequests).set({ status: 'denied', adminNote: note.slice(0, 500), decidedByAdminId: adminId, decidedAt: new Date() })
            .where(and(eq(accountDeletionRequests.id, id), eq(accountDeletionRequests.status, 'pending'))).returning();
        if (!u) throw new DeletionError('This request was decided a moment ago.', 'DECIDED', 409);
        await recordAudit({ entityType: 'user', entityId: r.userId, action: 'account_deletion_denied', changedBy: adminId, metadata: { requestId: id, note } });
        try {
            const { NotificationService } = await import('./notification.service');
            void NotificationService.sendToUser(r.userId, 'About your account deletion request', `We could not delete your account yet: ${note.slice(0, 180)}`, 'account_deletion', { requestId: id, screen: 'DeleteAccount' }).catch(() => undefined);
        } catch { /* the app shows the note on the request screen regardless */ }
        return u;
    }
}

