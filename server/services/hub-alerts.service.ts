/**
 * Alerts to partners.
 *
 * Every alert lands in the Hub's alert feed (the bell). It is also emailed to
 * the team members whose role covers it, pushed to the partner's UniteFix app
 * login when one is linked, and — for urgent ones, only if the partner turned
 * SMS on — texted to the business number. Each channel is best-effort: a
 * failed email never stops the business action that raised the alert.
 */

import { db } from '../db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { hubAlerts, businessPartners, partnerUsers, adminUsers } from '@shared/schema';
import { ROLE_PERMISSIONS, type HubPermission, type HubRole } from '@shared/hub';
import logger from '../lib/logger';

export type AlertKind =
    | 'job_new' | 'job_overdue' | 'warranty_claim'
    | 'enquiry_new' | 'quote_accepted' | 'quote_declined' | 'booking_request'
    | 'store_order' | 'store_return' | 'listing_reviewed'
    | 'payment_received' | 'settlement_paid' | 'territory_reviewed' | 'rate_reviewed' | 'application_approved';

/** Who on the team needs each kind, and whether it is worth a text message. */
const KIND: Record<AlertKind, { perm: HubPermission | null; urgent?: boolean }> = {
    job_new: { perm: 'ops:view', urgent: true },
    job_overdue: { perm: 'ops:view', urgent: true },
    warranty_claim: { perm: 'ops:view', urgent: true },
    enquiry_new: { perm: 'ops:view' },
    quote_accepted: { perm: 'sales:manage' },
    quote_declined: { perm: 'sales:manage' },
    booking_request: { perm: 'ops:view', urgent: true },
    store_order: { perm: 'ops:view', urgent: true },
    store_return: { perm: 'ops:view' },
    listing_reviewed: { perm: 'sales:manage' },
    payment_received: { perm: 'money:view' },
    settlement_paid: { perm: 'money:view' },
    territory_reviewed: { perm: 'settings:manage' },
    rate_reviewed: { perm: 'settings:manage' },
    application_approved: { perm: null },
};

export interface AlertPrefs { email: boolean; push: boolean; sms: boolean }
export const DEFAULT_PREFS: AlertPrefs = { email: true, push: true, sms: false };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class HubAlerts {

    /** Raise an alert. Never throws. */
    static async send(bpId: number | null | undefined, kind: AlertKind, input: { title: string; body: string; link?: string | null; refType?: string; refId?: number | null }) {
        if (!bpId) return null;
        try {
            const [row] = await db.insert(hubAlerts).values({
                businessPartnerId: bpId, kind, title: input.title.slice(0, 160), body: input.body.slice(0, 600),
                link: input.link ?? null, refType: input.refType ?? null, refId: input.refId ?? null,
            }).returning();
            void this.deliver(bpId, kind, input).catch(e => logger.warn(`[HUB-ALERT] delivery failed: ${e?.message}`));
            return row;
        } catch (e: any) {
            logger.error(`[HUB-ALERT] ${kind} for partner #${bpId} not recorded: ${e?.message}`);
            return null;
        }
    }

    private static async deliver(bpId: number, kind: AlertKind, input: { title: string; body: string; link?: string | null }) {
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
        if (!bp) return;
        const prefs: AlertPrefs = { ...DEFAULT_PREFS, ...((bp.alertPrefs as any) ?? {}) };
        const { NotificationService } = await import('./notification.service');
        const base = (process.env.HUB_BASE_URL || process.env.CLIENT_URL || '').replace(/\/$/, '');
        const url = input.link && base ? `${base}${input.link}` : null;

        if (prefs.email) {
            const perm = KIND[kind].perm;
            const members = await db.select({ email: adminUsers.email, role: partnerUsers.role }).from(partnerUsers)
                .innerJoin(adminUsers, eq(adminUsers.id, partnerUsers.adminUserId))
                .where(and(eq(partnerUsers.businessPartnerId, bpId), eq(partnerUsers.status, 'active')));
            const to = Array.from(new Set(members.filter(m => m.email && (!perm || m.role === 'owner' || (ROLE_PERMISSIONS[m.role as HubRole] ?? []).includes(perm))).map(m => m.email!)));
            if (!to.length && bp.contactEmail) to.push(bp.contactEmail);
            const html = `<p style="font:15px/1.5 sans-serif">${esc(input.body)}</p>${url ? `<p><a href="${esc(url)}" style="font:600 15px sans-serif">Open in the Partner Hub</a></p>` : ''}<p style="font:12px sans-serif;color:#666">You get this because you are on the ${esc(bp.displayName)} team in the UniteFix Partner Hub. The owner can change alerts under Business profile.</p>`;
            for (const addr of to) {
                try { await NotificationService.sendEmail(addr, input.title, html); }
                catch (e: any) { logger.warn(`[HUB-ALERT] email to ${addr} failed: ${e?.message}`); }
            }
        }
        if (prefs.push && bp.userId) {
            try { await NotificationService.sendToUser(bp.userId, input.title, input.body, 'partner_hub', { kind, link: input.link ?? '' }); }
            catch (e: any) { logger.warn(`[HUB-ALERT] push failed: ${e?.message}`); }
        }
        if (prefs.sms && KIND[kind].urgent && bp.contactPhone) {
            try { await NotificationService.sendSms(`+91${bp.contactPhone.replace(/\D/g, '').slice(-10)}`, `UniteFix: ${input.title}. ${input.body}`.slice(0, 300)); }
            catch (e: any) { logger.warn(`[HUB-ALERT] sms failed: ${e?.message}`); }
        }
    }

    static async list(bpId: number, limit = 50) {
        return db.select().from(hubAlerts).where(eq(hubAlerts.businessPartnerId, bpId)).orderBy(desc(hubAlerts.createdAt)).limit(Math.min(200, limit));
    }

    static async unread(bpId: number) {
        const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(hubAlerts).where(and(eq(hubAlerts.businessPartnerId, bpId), isNull(hubAlerts.readAt)));
        return r?.n ?? 0;
    }

    static async markRead(bpId: number, id?: number) {
        await db.update(hubAlerts).set({ readAt: new Date() })
            .where(and(eq(hubAlerts.businessPartnerId, bpId), isNull(hubAlerts.readAt), ...(id ? [eq(hubAlerts.id, id)] : [])));
    }

    static async prefs(bpId: number): Promise<AlertPrefs> {
        const [bp] = await db.select({ p: businessPartners.alertPrefs }).from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
        return { ...DEFAULT_PREFS, ...((bp?.p as any) ?? {}) };
    }

    static async setPrefs(bpId: number, prefs: Partial<AlertPrefs>) {
        const cur = await this.prefs(bpId);
        const next = { email: prefs.email ?? cur.email, push: prefs.push ?? cur.push, sms: prefs.sms ?? cur.sms };
        await db.update(businessPartners).set({ alertPrefs: next as any, updatedAt: new Date() }).where(eq(businessPartners.id, bpId));
        return next;
    }

    /** Which delivery channels the platform can actually use right now. */
    static channels() {
        return {
            email: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
            sms: !!(process.env.MSG91_API_KEY || (process.env.TWILIO_SID && process.env.TWILIO_AUTH_TOKEN)),
            push: true,
        };
    }
}
