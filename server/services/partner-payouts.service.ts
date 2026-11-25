/**
 * Payouts to partners, set per partner by staff.
 *
 *   Schedule     weekly (Mondays) · fortnightly (1st and 16th) · monthly (1st)
 *                · on request. Times are IST.
 *   Auto limit   a payout up to this amount goes out through Cashfree Payouts
 *                without a person; above it (or with no limit set) the run is
 *                drafted and waits for staff approval.
 *   Minimum      below it, nothing is drafted on schedule.
 *   Hold         staff can stop payouts to a partner, with a reason.
 *   Requests     a partner (or staff, when asked on the phone) asks to be paid
 *                now, on any schedule. Within the auto limit it pays at once;
 *                otherwise it waits in the staff queue.
 *
 * Money moves only through SettlementService (frozen figures, verified bank,
 * balances re-checked before paying, idempotent Cashfree transfer).
 */

import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db';
import { businessPartners, partnerPayoutRequests, settlementRuns } from '@shared/schema';
import { HubError } from './partner-hub.service';
import { SettlementService, SettlementError } from './settlement.service';
import { BusinessPartnerService } from './business-partner.service';
import { cashfreeKeys } from '../lib/cashfree-env';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

export const PAYOUT_SCHEDULES = ['weekly', 'fortnightly', 'monthly', 'on_request'] as const;
export type PayoutSchedule = typeof PAYOUT_SCHEDULES[number];
export const SCHEDULE_LABEL: Record<PayoutSchedule, string> = { weekly: 'Every Monday', fortnightly: 'On the 1st and 16th', monthly: 'On the 1st of each month', on_request: 'When you ask' };

const r2 = (p: number | null | undefined) => (p == null ? null : Math.round(p) / 100);
/** Today in India as y-m-d and weekday (0 = Sunday). */
const ist = (now = new Date()) => { const d = new Date(now.getTime() + 330 * 60_000); return { ymd: d.toISOString().slice(0, 10), dow: d.getUTCDay(), day: d.getUTCDate(), d }; };

export function isDue(schedule: string, now = new Date()) {
    const t = ist(now);
    if (schedule === 'weekly') return t.dow === 1;
    if (schedule === 'fortnightly') return t.day === 1 || t.day === 16;
    if (schedule === 'monthly') return t.day === 1;
    return false;
}

export function nextDue(schedule: string, now = new Date()): string | null {
    if (schedule === 'on_request') return null;
    for (let i = 1; i <= 32; i++) {
        const probe = new Date(now.getTime() + i * 86_400_000);
        if (isDue(schedule, probe)) return ist(probe).ymd;
    }
    return null;
}

const cashfreeReady = () => !!cashfreeKeys();

export class PartnerPayouts {

    static settingsOf(bp: typeof businessPartners.$inferSelect) {
        const schedule = (PAYOUT_SCHEDULES as readonly string[]).includes(bp.payoutSchedule) ? bp.payoutSchedule as PayoutSchedule : 'weekly';
        return {
            schedule, scheduleLabel: SCHEDULE_LABEL[schedule], nextDue: nextDue(schedule),
            autoLimit: r2(bp.payoutAutoLimitPaise), minimum: r2(bp.payoutMinPaise), onHold: bp.payoutsOnHold, holdReason: bp.payoutHoldReason,
        };
    }

    static async saveSettings(adminId: number, bpId: number, input: { schedule: string; autoLimitRupees: number | null; minimumRupees: number; onHold: boolean; holdReason?: string | null }) {
        if (!(PAYOUT_SCHEDULES as readonly string[]).includes(input.schedule)) throw new HubError('Schedule is weekly, fortnightly, monthly or on request.', 'BAD_SCHEDULE');
        if (input.autoLimitRupees != null && !(Number.isFinite(input.autoLimitRupees) && input.autoLimitRupees >= 0 && input.autoLimitRupees <= 10_00_000)) throw new HubError('The automatic limit is ₹0 to ₹10,00,000, or empty for "always ask".', 'BAD_LIMIT');
        if (!(Number.isFinite(input.minimumRupees) && input.minimumRupees >= 0 && input.minimumRupees <= 1_00_000)) throw new HubError('The minimum is ₹0 to ₹1,00,000.', 'BAD_MIN');
        if (input.onHold && !input.holdReason?.trim()) throw new HubError('Say why payouts are on hold; the partner sees it.', 'NO_REASON');
        const [u] = await db.update(businessPartners).set({
            payoutSchedule: input.schedule, payoutAutoLimitPaise: input.autoLimitRupees == null ? null : Math.round(input.autoLimitRupees * 100),
            payoutMinPaise: Math.round(input.minimumRupees * 100), payoutsOnHold: input.onHold, payoutHoldReason: input.onHold ? input.holdReason!.trim().slice(0, 300) : null, updatedAt: new Date(),
        }).where(eq(businessPartners.id, bpId)).returning();
        if (!u) throw new HubError('Partner not found', 'NOT_FOUND', 404);
        await recordAudit({ entityType: 'business_partner', entityId: bpId, action: 'payout_settings_changed', changedBy: adminId, metadata: { schedule: input.schedule, autoLimitRupees: input.autoLimitRupees, minimumRupees: input.minimumRupees, onHold: input.onHold, holdReason: input.holdReason ?? null } });
        return this.settingsOf(u);
    }

    /** What the partner (and staff) see: owed now, schedule, open request, recent payouts. */
    static async overview(bpId: number) {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) throw new HubError('Partner not found', 'NOT_FOUND', 404);
        const position = await SettlementService.position(bpId);
        const [open] = await db.select().from(partnerPayoutRequests).where(and(eq(partnerPayoutRequests.businessPartnerId, bpId), eq(partnerPayoutRequests.status, 'requested'))).limit(1);
        const runs = await db.select().from(settlementRuns).where(eq(settlementRuns.businessPartnerId, bpId)).orderBy(desc(settlementRuns.createdAt)).limit(10);
        return {
            settings: this.settingsOf(bp),
            owed: r2(position.payout), offset: r2(position.offset),
            bankReady: bp.bankStatus === 'verified' && !!bp.bankAccountNumber, bankLast4: bp.bankAccountNumber?.slice(-4) ?? null,
            openRequest: open ? { id: open.id, at: open.createdAt, note: open.note } : null,
            runs: runs.map(r => ({ id: r.id, code: r.runCode, status: r.status, amount: r2(r.payoutPaise), origin: r.origin, reference: r.payoutReference, at: r.paidAt ?? r.createdAt, failure: r.failureReason })),
        };
    }

    /** The partner asks to be paid now. Pays at once within the auto limit; otherwise staff decide. */
    static async request(bpId: number, hubUserId: number | null, note?: string | null) {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp || bp.status !== 'active') throw new HubError('Payouts start once your account is approved.', 'NOT_ACTIVE', 409);
        if (bp.payoutsOnHold) throw new HubError(`Payouts are on hold: ${bp.payoutHoldReason ?? 'contact UniteFix'}.`, 'ON_HOLD', 409);
        if (!(bp.bankStatus === 'verified' && bp.bankAccountNumber)) throw new HubError('Your bank account is not verified yet. UniteFix pays only into a verified account.', 'BANK_NOT_VERIFIED', 409);
        const position = await SettlementService.position(bpId);
        if (position.payout <= 0) throw new HubError('Nothing is due to you right now.', 'NOTHING_DUE', 409);
        let reqRow: typeof partnerPayoutRequests.$inferSelect;
        try {
            [reqRow] = await db.insert(partnerPayoutRequests).values({ businessPartnerId: bpId, requestedByAdminUserId: hubUserId, note: note?.trim().slice(0, 300) || null }).returning();
        } catch (e: any) {
            if (e?.code === '23505') throw new HubError('You already have a payout request open. UniteFix will pay it soon.', 'OPEN_REQUEST', 409);
            throw e;
        }
        const auto = bp.payoutAutoLimitPaise != null && position.payout <= bp.payoutAutoLimitPaise && cashfreeReady();
        if (auto) {
            try {
                const r = await this.pay(null, bpId, { method: 'cashfree' }, 'request', reqRow.id);
                return { request: reqRow, paid: true, status: r.status, amount: r2(r.payoutPaise) };
            } catch (e: any) {
                logger.warn(`[PAYOUT] Automatic payout for request #${reqRow.id} did not go through: ${e?.message}`);
            }
        }
        const { NotificationService } = await import('./notification.service');
        void NotificationService.sendToAdmins('Payout requested', `${bp.displayName} (${bp.partnerCode}) asked to be paid ₹${r2(position.payout)!.toLocaleString('en-IN')}. Admin → Partner payouts.`, { businessPartnerId: bpId }).catch(() => null);
        return { request: reqRow, paid: false, status: 'requested', amount: r2(position.payout) };
    }

    /**
     * Draft and pay one run now. Staff "Pay now", an approved request, or the
     * schedule within the auto limit. Closes the partner's open request.
     */
    static async pay(adminId: number | null, bpId: number, how: { method: 'cashfree' } | { method: 'manual'; reference: string }, origin: 'staff' | 'schedule' | 'request', requestId?: number | null) {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) throw new HubError('Partner not found', 'NOT_FOUND', 404);
        if (bp.payoutsOnHold && origin !== 'staff') throw new HubError(`Payouts are on hold: ${bp.payoutHoldReason ?? ''}`, 'ON_HOLD', 409);
        // Reuse a draft that is already there (the schedule drafted it and it waits for approval).
        const [draft] = await db.select().from(settlementRuns).where(and(eq(settlementRuns.businessPartnerId, bpId), eq(settlementRuns.status, 'draft'))).limit(1);
        let run = draft;
        try {
            if (!run) run = await SettlementService.create(bpId, adminId, origin === 'request' ? 'Paid on the partner\'s request' : origin === 'schedule' ? 'Scheduled payout' : 'Paid now by staff', origin);
            const paid = await SettlementService.pay(run.id, adminId, how);
            const open = requestId ? [{ id: requestId }] : await db.select({ id: partnerPayoutRequests.id }).from(partnerPayoutRequests).where(and(eq(partnerPayoutRequests.businessPartnerId, bpId), eq(partnerPayoutRequests.status, 'requested')));
            for (const o of open) {
                await db.update(partnerPayoutRequests).set({ status: paid.status === 'paid' ? 'paid' : 'processing', settlementRunId: run.id, decidedByAdminId: adminId, decidedAt: new Date() }).where(and(eq(partnerPayoutRequests.id, o.id), eq(partnerPayoutRequests.status, 'requested')));
            }
            await recordAudit({ entityType: 'business_partner', entityId: bpId, action: 'payout_sent', changedBy: adminId ?? undefined, metadata: { runCode: run.runCode, origin, method: how.method, amountPaise: run.payoutPaise } });
            return paid;
        } catch (e: any) {
            if (e instanceof SettlementError) throw new HubError(e.message, e.code, 409);
            throw e;
        }
    }

    static async decline(adminId: number, requestId: number, note: string) {
        if (!note?.trim()) throw new HubError('Say why; the partner sees it.', 'NO_REASON');
        const [u] = await db.update(partnerPayoutRequests).set({ status: 'declined', decidedByAdminId: adminId, decidedAt: new Date(), decisionNote: note.trim().slice(0, 300) })
            .where(and(eq(partnerPayoutRequests.id, requestId), eq(partnerPayoutRequests.status, 'requested'))).returning();
        if (!u) throw new HubError('That request is no longer open.', 'NOT_OPEN', 409);
        const { HubAlerts } = await import('./hub-alerts.service');
        void HubAlerts.send(u.businessPartnerId, 'payout_request_declined', { title: 'Payout request not paid yet', body: note.trim().slice(0, 200), link: '/partner/money' }).catch(() => null);
        return u;
    }

    /** Staff queue: open requests and drafts waiting for approval. */
    static async queue() {
        const reqs = await db.select({ r: partnerPayoutRequests, name: businessPartners.displayName, code: businessPartners.partnerCode, limit: businessPartners.payoutAutoLimitPaise })
            .from(partnerPayoutRequests).innerJoin(businessPartners, eq(businessPartners.id, partnerPayoutRequests.businessPartnerId))
            .where(eq(partnerPayoutRequests.status, 'requested')).orderBy(partnerPayoutRequests.createdAt);
        const drafts = await db.select({ run: settlementRuns, name: businessPartners.displayName, code: businessPartners.partnerCode })
            .from(settlementRuns).innerJoin(businessPartners, eq(businessPartners.id, settlementRuns.businessPartnerId))
            .where(eq(settlementRuns.status, 'draft')).orderBy(settlementRuns.createdAt);
        const out = [];
        for (const q of reqs) out.push({ kind: 'request' as const, id: q.r.id, businessPartnerId: q.r.businessPartnerId, partner: q.name, code: q.code, owed: r2((await SettlementService.position(q.r.businessPartnerId)).payout), note: q.r.note, at: q.r.createdAt });
        for (const d of drafts) out.push({ kind: 'draft' as const, id: d.run.id, businessPartnerId: d.run.businessPartnerId, partner: d.name, code: d.code, owed: r2(d.run.payoutPaise), note: d.run.notes, at: d.run.createdAt, origin: d.run.origin });
        return out;
    }

    /**
     * The schedule (hourly job, acts once a day per partner): for partners due
     * today, draft a run; pay it within the auto limit, else leave it for staff.
     */
    static async runScheduled(now = new Date()) {
        const today = ist(now).ymd;
        const startOfDayUtc = new Date(Date.parse(`${today}T00:00:00+05:30`));
        const bps = await db.select().from(businessPartners).where(and(eq(businessPartners.status, 'active'), eq(businessPartners.payoutsOnHold, false), ne(businessPartners.payoutSchedule, 'on_request')));
        let drafted = 0, paid = 0, waiting = 0;
        for (const bp of bps) {
            if (!isDue(bp.payoutSchedule, now)) continue;
            if (!(bp.bankStatus === 'verified' && bp.bankAccountNumber)) continue;
            const [already] = await db.select({ id: settlementRuns.id }).from(settlementRuns).where(and(eq(settlementRuns.businessPartnerId, bp.id),
                sql`(${settlementRuns.status} IN ('draft', 'processing') OR (${settlementRuns.origin} = 'schedule' AND ${settlementRuns.createdAt} >= ${startOfDayUtc}))`)).limit(1);
            if (already) continue;
            const position = await SettlementService.position(bp.id);
            if (position.payout <= 0 || position.payout < bp.payoutMinPaise) continue;
            const auto = bp.payoutAutoLimitPaise != null && position.payout <= bp.payoutAutoLimitPaise && cashfreeReady();
            try {
                if (auto) { await this.pay(null, bp.id, { method: 'cashfree' }, 'schedule'); paid++; }
                else { await SettlementService.create(bp.id, null, 'Scheduled payout: waiting for approval', 'schedule'); waiting++; }
                drafted++;
            } catch (e: any) {
                logger.warn(`[PAYOUT] Scheduled payout for ${bp.partnerCode}: ${e?.message}`);
            }
        }
        if (waiting) {
            const { NotificationService } = await import('./notification.service');
            void NotificationService.sendToAdmins('Payouts to approve', `${waiting} scheduled partner payout${waiting > 1 ? 's are' : ' is'} waiting for approval (Admin → Partner payouts).`, {}).catch(() => null);
        }
        if (drafted) logger.info(`[PAYOUT] Schedule ${today}: ${drafted} run(s), ${paid} paid automatically, ${waiting} waiting`);
        return { drafted, paid, waiting };
    }
}

