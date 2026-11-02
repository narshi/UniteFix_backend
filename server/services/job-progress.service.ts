/**
 * A job that does not finish in one visit.
 *
 * CONTINUE ANOTHER DAY. Work that takes 3–4 days stays one job: the expert
 * ends the day with the date they come back and a note, the customer is told,
 * and the job stays in progress (no new OTP the next morning). Each day is
 * kept in the job's visit log; one bill at the end.
 *
 * COULD NOT FIX. The expert says why. They earn the visit pay (Settings,
 * capped at what the job is worth), held like any earning, and the job goes
 * back to be sent to someone else: to the partner's Jobs page if a partner
 * had it, otherwise to UniteFix's Assignment Queue, marked as a follow-up.
 * Whoever finishes it earns the job's value less the visit pay already paid,
 * so the job never pays out more than it is worth.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { serviceRequests, partRequests, employees } from '@shared/schema';
import { configService } from './config.service';
import { NotificationService } from './notification.service';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

export class JobProgressError extends Error {
    constructor(message: string, public status = 400, public code = 'BAD_REQUEST') { super(message); }
}

const IST_MS = 5.5 * 3_600_000;
const todayIst = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

type Visit = { at: string; kind: 'paused' | 'resumed'; by: number; note?: string | null; until?: string };
type Attempt = { employeeId: number; at: string; reason: string; visitPayRupees: number };

export class JobProgressService {
    /** The booking, if this expert is the one working on it. */
    private static async mine(employeeId: number, id: number) {
        const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
        if (!sr) throw new JobProgressError('Job not found.', 404, 'NOT_FOUND');
        if (sr.providerId !== employeeId) throw new JobProgressError('This job is not assigned to you.', 403, 'FORBIDDEN');
        return sr;
    }

    /** End today's work; come back on `date` (tomorrow to 14 days out). */
    static async continueLater(employeeId: number, id: number, input: { date?: string; note?: string }) {
        const sr = await this.mine(employeeId, id);
        if (sr.status !== 'in_progress') throw new JobProgressError('Only a job in progress can continue another day.', 409, 'BAD_STATE');
        const date = String(input.date ?? '');
        const today = todayIst();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= today || date > addDays(today, 14)) {
            throw new JobProgressError('Choose a day from tomorrow up to 14 days ahead.', 400, 'BAD_DATE');
        }
        const note = String(input.note ?? '').trim().replace(/\s+/g, ' ');
        if (note.length < 3) throw new JobProgressError('Say what was done today and what is left; the customer reads it.', 400, 'NO_NOTE');
        const log = [...((sr.visitLog as Visit[] | null) ?? []), { at: new Date().toISOString(), kind: 'paused', by: employeeId, note: note.slice(0, 300), until: date } as Visit];
        const [u] = await db.update(serviceRequests).set({ pausedUntil: date, pauseNote: note.slice(0, 300), visitLog: log as any, updatedAt: new Date() })
            .where(and(eq(serviceRequests.id, id), eq(serviceRequests.status, 'in_progress' as any))).returning();
        if (!u) throw new JobProgressError('This job just changed. Refresh it.', 409, 'CHANGED');
        NotificationService.notify(sr.userId, 'Work continues another day',
            `Your technician will continue ${sr.serviceId} on ${dayLabel(date)}. Today: ${note.slice(0, 200)}`,
            'service_started', { serviceId: id, serviceRef: sr.serviceId });
        if (sr.dispatchPartnerId) {
            const { HubAlerts } = await import('./hub-alerts.service');
            await HubAlerts.send(sr.dispatchPartnerId, 'job_new' as any, { title: `Job ${sr.serviceId} continues on ${dayLabel(date)}`, body: note.slice(0, 300), link: '/partner/field/jobs', refType: 'service_request', refId: id }).catch(() => {});
        }
        return { booking: u, message: `Saved. The customer was told you will continue on ${dayLabel(date)}.` };
    }

    /** Back at work on a paused job. No OTP: the job never stopped being in progress. */
    static async resume(employeeId: number, id: number) {
        const sr = await this.mine(employeeId, id);
        if (sr.status !== 'in_progress' || !sr.pausedUntil) throw new JobProgressError('This job is not paused.', 409, 'NOT_PAUSED');
        const log = [...((sr.visitLog as Visit[] | null) ?? []), { at: new Date().toISOString(), kind: 'resumed', by: employeeId } as Visit];
        const [u] = await db.update(serviceRequests).set({ pausedUntil: null, pauseNote: null, visitLog: log as any, updatedAt: new Date() })
            .where(eq(serviceRequests.id, id)).returning();
        NotificationService.notify(sr.userId, 'Your technician is back', `Work on ${sr.serviceId} has started again.`, 'service_started', { serviceId: id, serviceRef: sr.serviceId });
        return { booking: u, message: 'Work resumed.' };
    }

    /** What an expert earns for a visit that could not fix the job, for this booking. */
    static async visitPayFor(sr: typeof serviceRequests.$inferSelect): Promise<number> {
        const setting = Math.max(0, Number(await configService.get<number>('BUSINESS_CONFIG.FAILED_VISIT_PAY', 150)) || 0);
        const snap: any = sr.pricingSnapshot ?? {};
        const worth = Number(snap.technicianEarning ?? snap.employeeEarnings ?? NaN);
        const left = Number.isFinite(worth) ? Math.max(0, worth - (sr.priorVisitPayPaise ?? 0) / 100) : setting;
        return Math.round(Math.min(setting, left) * 100) / 100;
    }

    /**
     * The expert could not fix it. They earn the visit pay; the job goes back
     * to be sent to someone else. Parts the customer approved for this visit
     * are withdrawn: the next expert asks again for what they need.
     */
    static async cannotFix(employeeId: number, id: number, input: { reason?: string }) {
        const sr = await this.mine(employeeId, id);
        if (!['reached', 'in_progress'].includes(sr.status as string)) throw new JobProgressError('You can report this once you have reached the customer.', 409, 'BAD_STATE');
        const reason = String(input.reason ?? '').trim().replace(/\s+/g, ' ');
        if (reason.length < 5) throw new JobProgressError('Say what you found and why it could not be fixed; the next expert reads it.', 400, 'NO_REASON');
        const [me] = await db.select({ bp: employees.managedByPartnerId, name: employees.fullName }).from(employees).where(eq(employees.id, employeeId)).limit(1);
        const pay = await this.visitPayFor(sr);
        const attempt: Attempt = { employeeId, at: new Date().toISOString(), reason: reason.slice(0, 500), visitPayRupees: pay };
        // Back to whoever sends it out: the partner if one had it, else UniteFix's queue.
        const toPartner = !!sr.dispatchPartnerId && me?.bp === sr.dispatchPartnerId;
        const [u] = await db.update(serviceRequests).set({
            status: 'created' as any, providerId: null, assignedAt: null, reachedAt: null, startedAt: null,
            pausedUntil: null, pauseNote: null,
            followUpCount: (sr.followUpCount ?? 0) + 1, lastAttemptReason: reason.slice(0, 500),
            attempts: [...((sr.attempts as Attempt[] | null) ?? []), attempt] as any,
            priorVisitPayPaise: (sr.priorVisitPayPaise ?? 0) + Math.round(pay * 100),
            ...(toPartner ? { slaAssignBy: null, escalatedAt: null } : { dispatchPartnerId: null, dispatchMode: null, slaAssignBy: null }),
            updatedAt: new Date(),
        }).where(and(eq(serviceRequests.id, id), eq(serviceRequests.providerId, employeeId), inArray(serviceRequests.status, ['reached', 'in_progress'] as any))).returning();
        if (!u) throw new JobProgressError('This job just changed. Refresh it.', 409, 'CHANGED');

        await db.update(partRequests).set({ status: 'cancelled' }).where(and(eq(partRequests.serviceRequestId, id), inArray(partRequests.status, ['pending', 'approved'])));

        if (pay > 0) {
            const { storage } = await import('../storage');
            const holdDays = Number(await configService.get<number>('BUSINESS_CONFIG.WALLET_HOLD_DAYS', 7));
            await storage.creditWalletOnHold(employeeId, null, pay, new Date(Date.now() + holdDays * 86_400_000), undefined,
                { description: `Visit pay — ${sr.serviceId} (could not fix; another expert follows up)`, countService: false, forBooking: id });
        }
        await recordAudit({
            entityType: 'service_request', entityId: id, action: 'could_not_fix', fromState: sr.status as string, toState: 'created', changedBy: null,
            metadata: { employeeId, reason, visitPayRupees: pay, backTo: toPartner ? 'partner' : 'unitefix', partnerId: sr.dispatchPartnerId },
        });
        NotificationService.notify(sr.userId, 'Another expert will follow up',
            `Your technician could not finish ${sr.serviceId}. We are sending another expert; you do not need to book again.`,
            'service_assigned', { serviceId: id, serviceRef: sr.serviceId });
        if (toPartner) {
            const { HubAlerts } = await import('./hub-alerts.service');
            await HubAlerts.send(sr.dispatchPartnerId, 'job_new' as any, { title: `Follow-up needed: ${sr.serviceId}`, body: `${me?.name ?? 'Your technician'} could not fix it: ${reason.slice(0, 200)}. Send someone else.`, link: '/partner/field/jobs', refType: 'service_request', refId: id }).catch(() => {});
        }
        logger.info(`[JOB] SR ${id}: expert ${employeeId} could not fix (visit pay ₹${pay}); back to ${toPartner ? `partner #${sr.dispatchPartnerId}` : 'the Assignment Queue'}`);
        return { booking: u, visitPayRupees: pay, message: pay > 0 ? `Reported. ₹${pay} visit pay is added to your wallet; the job goes to another expert.` : 'Reported. The job goes to another expert.' };
    }
}
