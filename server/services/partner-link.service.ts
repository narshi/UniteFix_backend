/**
 * A partner's customer link and code: app.unitefix.com/p/POORVI12.
 *
 * Partners hand it to their own customers (visiting card, WhatsApp, shop
 * board). Opening it, or typing the code on the booking screen, puts that
 * partner first and selected — so a partner's customers book them through
 * UniteFix, and every such booking is marked chosen_via 'code'.
 *
 * The code is made on first use from the partner's name and id. A partner
 * can always also be reached by its staff code (BP-0012).
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { businessPartners, partnerServices, serviceRequests } from '@shared/schema';
import { publicAppUrl } from '../lib/public-url';

const norm = (raw: unknown) => String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);

export class PartnerLinkService {
    static linkFor(code: string) {
        return `${publicAppUrl() || 'https://app.unitefix.com'}/p/${encodeURIComponent(code)}`;
    }

    /** The partner's code, made the first time it is asked for. */
    static async ensureCode(bpId: number): Promise<string> {
        const [bp] = await db.select({ id: businessPartners.id, code: businessPartners.shareCode, name: businessPartners.displayName })
            .from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
        if (!bp) throw new Error('Partner not found');
        if (bp.code) return bp.code;
        const word = String(bp.name ?? '').toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).find(w => w.length >= 3) ?? 'UF';
        const base = `${word.slice(0, 8)}${bp.id}`;
        for (let i = 0; i < 5; i++) {
            const code = i === 0 ? base : `${base}${Math.floor(Math.random() * 90 + 10)}`;
            try {
                const [set] = await db.update(businessPartners).set({ shareCode: code } as any)
                    .where(and(eq(businessPartners.id, bpId), sql`${businessPartners.shareCode} IS NULL`)).returning({ code: businessPartners.shareCode });
                if (set?.code) return set.code;
                // Another request made it first.
                const [now] = await db.select({ code: businessPartners.shareCode }).from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
                if (now?.code) return now.code;
            } catch (e: any) {
                if (e?.code !== '23505') throw e;   // taken by another partner: try a variant
            }
        }
        throw new Error('Could not make a partner code');
    }

    /** The partner a code or link names: its share code, or its staff code (BP-0012). Active partners only. */
    static async resolve(raw: unknown) {
        const code = norm(raw);
        if (code.length < 3) return null;
        const [bp] = await db.select().from(businessPartners).where(and(
            sql`(lower(${businessPartners.shareCode}) = lower(${code}) OR upper(${businessPartners.partnerCode}) = ${code})`,
            eq(businessPartners.status, 'active'),
        )).limit(1);
        return bp ?? null;
    }

    /** What anyone opening the link sees. */
    static async publicCard(raw: unknown) {
        const bp = await this.resolve(raw);
        if (!bp) return null;
        const code = await this.ensureCode(bp.id);
        const { ProviderChoiceService } = await import('./provider-choice.service');
        const { PartnerFieldService } = await import('./partner-field.service');
        const ready = (await PartnerFieldService.dispatchCandidates()).some(c => c.id === bp.id);
        const stats = (await ProviderChoiceService.partnerStats([bp.id])).get(bp.id);
        const offered = await db.select({ name: partnerServices.name }).from(partnerServices)
            .where(and(eq(partnerServices.businessPartnerId, bp.id), eq(partnerServices.isActive, true))).limit(20);
        return {
            code, link: this.linkFor(code), name: bp.displayName,
            rating: stats?.rating ?? null, reviews: stats?.reviews ?? 0, jobsDone: stats?.jobsDone ?? 0,
            services: offered.map(o => o.name).filter(Boolean),
            takesJobs: ready,
        };
    }

    /** For the partner: their code and link, and what it has brought in. */
    static async summary(bpId: number) {
        const code = await this.ensureCode(bpId);
        const [r] = await db.select({
            bookings: sql<number>`count(*) filter (where ${serviceRequests.bookingFeeStatus} in ('paid','refunded'))::int`,
            completed: sql<number>`count(*) filter (where ${serviceRequests.status} = 'completed')::int`,
        }).from(serviceRequests).where(and(eq(serviceRequests.chosenPartnerId, bpId), eq(serviceRequests.chosenVia, 'code')));
        return { code, link: this.linkFor(code), bookings: r?.bookings ?? 0, completed: r?.completed ?? 0 };
    }
}
