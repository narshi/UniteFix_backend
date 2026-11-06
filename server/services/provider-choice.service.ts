/**
 * The customer chooses who does the job, at booking:
 *   - "Book via UniteFix": UniteFix picks (staff assign, as always), or the
 *     customer picks one of the partner businesses that serve the address and
 *     take this service. The booking goes to that partner, who assigns a
 *     technician by the assign-by time or it comes back to the Assignment Queue.
 *   - "Nearby service person": a verified UniteFix expert near the address,
 *     who takes this kind of work. The job goes to them to accept; one they do
 *     not accept in time falls back to the queue (revertStaleAssignments).
 * The price is UniteFix's either way: the choice changes who, never what.
 *
 * The choice is stored on the booking and applied only once it is PAID
 * (applyAfterPayment), from whichever path confirms the payment first — the
 * same rule staff work under. A partner or expert who can no longer take it
 * by then leaves it in the queue for staff, with a note in the audit log.
 *
 * What a customer sees of an expert is deliberately thin: first name and
 * initial, photo, rating, jobs done, years, and distance rounded to 0.1 km.
 * No phone, no exact location.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { employees, ratings, serviceRequests } from '@shared/schema';
import { configService } from './config.service';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

export type ProviderChoice = { type: 'unitefix' } | { type: 'partner'; id: number; code?: string } | { type: 'expert'; id: number };

export interface PartnerOption {
    id: number; name: string;
    rating: number | null; reviews: number; jobsDone: number; technicians: number;
    /** Reached through the partner's own link or code (listed first, even outside its usual pincodes). */
    viaCode?: boolean;
}
/** The partner a link or code named, and whether it can take this booking. */
export interface InvitedPartner { code: string; name: string | null; available: boolean; reason: string | null }
export interface ExpertOption {
    id: number; name: string; photoUrl: string | null;
    rating: number | null; reviews: number; jobsDone: number; experienceYears: number;
    distanceKm: number; online: boolean;
}

export class ProviderChoiceError extends Error {
    constructor(message: string, public code: string, public status = 409) { super(message); }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const shortName = (full: string | null) => {
    const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'UniteFix expert';
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
};
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}
const pointOf = (wkt: string | null | undefined) => {
    const m = String(wkt ?? '').match(/POINT\(\s*([\d.-]+)\s+([\d.-]+)\s*\)/);
    return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
};

export class ProviderChoiceService {
    /** Partners the customer can choose for this service at this address (experts are UniteFix's to assign). */
    static async options(input: { catalogServiceId: number | null; pincode: string | null; lat: number | null; lng: number | null; partnerCode?: string | null }): Promise<{ partners: PartnerOption[]; experts: ExpertOption[]; radiusKm: number; invited: InvitedPartner | null }> {
        const radiusKm = Number(await configService.get<number>('BUSINESS_CONFIG.NEARBY_EXPERT_RADIUS_KM', 15)) || 15;
        // Customers choose among PARTNERS only; which expert goes is UniteFix's call.
        // experts stays in the reply, always empty, for app builds that still read it.
        const experts: ExpertOption[] = [];
        const [listed, invited] = await Promise.all([
            this.partnerOptions(input),
            input.partnerCode ? this.invitedPartner(input.partnerCode, input.catalogServiceId) : Promise.resolve(null),
        ]);
        // The partner the customer came through goes first and is marked; it is not listed twice.
        let partners = listed;
        if (invited?.option) partners = [invited.option, ...listed.filter(p => p.id !== invited.option!.id)];
        return { partners, experts, radiusKm, invited: invited ? invited.info : null };
    }

    /**
     * A partner named by its link or code: offered for this service wherever
     * the customer is (they came through the partner), if the partner can take
     * jobs and lists the service.
     */
    static async invitedPartner(code: string, catalogServiceId: number | null): Promise<{ option: PartnerOption | null; info: InvitedPartner } | null> {
        const { PartnerLinkService } = await import('./partner-link.service');
        const bp = await PartnerLinkService.resolve(code);
        if (!bp) return { option: null, info: { code, name: null, available: false, reason: 'No UniteFix partner has this code. Check it with them.' } };
        const shareCode = await PartnerLinkService.ensureCode(bp.id);
        const { PartnerFieldService } = await import('./partner-field.service');
        const c = (await PartnerFieldService.dispatchCandidates()).find(x => x.id === bp.id);
        const name = bp.displayName;
        if (!c) return { option: null, info: { code: shareCode, name, available: false, reason: `${name} is not taking bookings in the app right now. UniteFix will send its own expert.` } };
        if (!catalogServiceId || !c.catalogServiceIds.includes(catalogServiceId)) {
            return { option: null, info: { code: shareCode, name, available: false, reason: `${name} does not take this service. Pick another partner or let UniteFix choose.` } };
        }
        const s = (await this.partnerStats([bp.id])).get(bp.id);
        return {
            option: { id: bp.id, name, rating: s?.rating ?? null, reviews: s?.reviews ?? 0, jobsDone: s?.jobsDone ?? 0, technicians: c.technicians, viaCode: true },
            info: { code: shareCode, name, available: true, reason: null },
        };
    }

    /** Customers' rating (stars on jobs the partner did) and completed jobs, per partner. */
    static async partnerStats(ids: number[]): Promise<Map<number, { rating: number | null; reviews: number; jobsDone: number }>> {
        const out = new Map<number, { rating: number | null; reviews: number; jobsDone: number }>();
        if (!ids.length) return out;
        const stars = await db.select({
            bpId: serviceRequests.dispatchPartnerId,
            avg: sql<number>`avg(${ratings.rating})::float`, n: sql<number>`count(${ratings.id})::int`,
        }).from(ratings).innerJoin(serviceRequests, eq(serviceRequests.id, ratings.serviceRequestId))
            .where(and(inArray(serviceRequests.dispatchPartnerId, ids), eq(ratings.isVisible, true)))
            .groupBy(serviceRequests.dispatchPartnerId);
        const done = await db.select({ bpId: serviceRequests.dispatchPartnerId, n: sql<number>`count(*)::int` })
            .from(serviceRequests).where(and(inArray(serviceRequests.dispatchPartnerId, ids), eq(serviceRequests.status, 'completed' as any)))
            .groupBy(serviceRequests.dispatchPartnerId);
        const st = new Map(stars.map(r => [r.bpId, r])), d = new Map(done.map(r => [r.bpId, r.n]));
        for (const id of ids) {
            const r = st.get(id);
            out.set(id, { rating: r?.n ? round1(Number(r.avg)) : null, reviews: r?.n ?? 0, jobsDone: d.get(id) ?? 0 });
        }
        return out;
    }

    /** Ready partners (staff's own dispatch list) that cover the pincode and take this service, best rated first. */
    static async partnerOptions(input: { catalogServiceId: number | null; pincode: string | null }): Promise<PartnerOption[]> {
        if (!input.catalogServiceId || !input.pincode) return [];
        const { PartnerFieldService } = await import('./partner-field.service');
        const ready = (await PartnerFieldService.dispatchCandidates())
            .filter(p => p.pincodes.includes(input.pincode!) && p.catalogServiceIds.includes(input.catalogServiceId!));
        if (!ready.length) return [];
        // A partner's rating: the stars customers gave on jobs that partner did.
        const stats = await this.partnerStats(ready.map(p => p.id));
        return ready.map(p => ({
            id: p.id, name: p.name,
            rating: stats.get(p.id)?.rating ?? null, reviews: stats.get(p.id)?.reviews ?? 0,
            jobsDone: stats.get(p.id)?.jobsDone ?? 0, technicians: p.technicians,
        })).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviews - a.reviews || b.jobsDone - a.jobsDone);
    }

    /** Verified UniteFix experts (not a partner's staff) within the radius who take this kind of work, nearest first. */
    static async expertOptions(input: { catalogServiceId: number | null; lat: number | null; lng: number | null }, radiusKm: number): Promise<ExpertOption[]> {
        if (input.lat == null || input.lng == null || !Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return [];
        const rows = await db.select({
            id: employees.id, fullName: employees.fullName, photo: employees.profilePhotoUrl, location: employees.currentLocation,
            rating: employees.averageRating, jobs: employees.totalServicesCompleted, years: employees.experienceYears, online: employees.isOnline,
        }).from(employees).where(and(
            eq(employees.isActive, true), eq(employees.documentVerificationStatus, 'verified' as any), isNull(employees.managedByPartnerId),
        ));
        // Who takes this kind of work. Unmapped categories leave everyone eligible.
        let allowed: Set<number> | null = null;
        if (input.catalogServiceId) {
            const { resolveExpertiseForRequest } = await import('../lib/expertise-matching');
            const m = await resolveExpertiseForRequest(0, input.catalogServiceId);
            if (m.recommendedEmployeeIds) allowed = new Set(m.recommendedEmployeeIds);
        }
        const near = rows.map(r => {
            const p = pointOf(r.location);
            return p ? { r, km: haversineKm(input.lat!, input.lng!, p.lat, p.lng) } : null;
        }).filter((x): x is { r: typeof rows[number]; km: number } => !!x && x.km <= radiusKm && (!allowed || allowed.has(x.r.id)))
            .sort((a, b) => a.km - b.km).slice(0, 12);
        if (!near.length) return [];
        // From the ratings themselves: employees.average_rating was never
        // recalculated when a customer rated, so it read 0 for most experts.
        const counts = await db.select({ id: ratings.toProviderId, n: sql<number>`count(*)::int`, avg: sql<number>`avg(${ratings.rating})::float` }).from(ratings)
            .where(and(inArray(ratings.toProviderId, near.map(x => x.r.id)), eq(ratings.isVisible, true))).groupBy(ratings.toProviderId);
        const c = new Map(counts.map(x => [x.id, x]));
        return near.map(({ r, km }) => {
            const reviews = c.get(r.id)?.n ?? 0;
            return {
                id: r.id, name: shortName(r.fullName), photoUrl: r.photo ?? null,
                rating: reviews > 0 ? round1(Number(c.get(r.id)!.avg)) : null, reviews,
                jobsDone: r.jobs ?? 0, experienceYears: r.years ?? 0,
                distanceKm: Math.max(0.1, round1(km)), online: !!r.online,
            };
        });
    }

    /**
     * For staff screens: who the customer chose and where it stands —
     * 'waiting' (not paid yet), 'with_them' (still theirs), or 'not_taken'
     * (they could not take it, timed out, or staff moved it).
     */
    static async describe(rows: Array<{ id: number; chosenProviderType?: string | null; chosenPartnerId?: number | null; chosenExpertId?: number | null; chosenVia?: string | null; choiceAppliedAt?: Date | string | null; providerId?: number | null; dispatchPartnerId?: number | null }>) {
        const out = new Map<number, { type: 'partner' | 'expert'; name: string | null; via: 'code' | 'list' | null; state: 'waiting' | 'with_them' | 'not_taken' }>();
        const chosen = rows.filter(r => (r.chosenProviderType === 'partner' && r.chosenPartnerId) || (r.chosenProviderType === 'expert' && r.chosenExpertId));
        if (!chosen.length) return out;
        const { businessPartners } = await import('@shared/schema');
        const bpIds = Array.from(new Set(chosen.map(r => r.chosenPartnerId).filter((x): x is number => !!x)));
        const exIds = Array.from(new Set(chosen.map(r => r.chosenExpertId).filter((x): x is number => !!x)));
        const bps = bpIds.length ? await db.select({ id: businessPartners.id, name: businessPartners.displayName }).from(businessPartners).where(inArray(businessPartners.id, bpIds)) : [];
        const exs = exIds.length ? await db.select({ id: employees.id, name: employees.fullName }).from(employees).where(inArray(employees.id, exIds)) : [];
        const bn = new Map(bps.map(b => [b.id, b.name])), en = new Map(exs.map(e => [e.id, e.name]));
        for (const r of chosen) {
            const isPartner = r.chosenProviderType === 'partner';
            const theirs = isPartner ? r.dispatchPartnerId === r.chosenPartnerId : r.providerId === r.chosenExpertId;
            out.set(r.id, {
                type: isPartner ? 'partner' : 'expert',
                name: (isPartner ? bn.get(r.chosenPartnerId!) : en.get(r.chosenExpertId!)) ?? null,
                via: isPartner ? ((r.chosenVia as 'code' | 'list' | null) ?? 'list') : null,
                state: !r.choiceAppliedAt ? 'waiting' : theirs ? 'with_them' : 'not_taken',
            });
        }
        return out;
    }

    /** Read the app's choice from a booking request. Anything unrecognised is "UniteFix picks". */
    static parse(raw: any): ProviderChoice {
        const type = raw?.type;
        const id = Number(raw?.id);
        if (type === 'partner' && Number.isInteger(id) && id > 0) {
            const code = typeof raw?.code === 'string' && raw.code.trim() ? raw.code.trim().slice(0, 24) : undefined;
            return code ? { type, id, code } : { type, id };
        }
        // An expert is never the customer's to choose (UniteFix assigns experts):
        // an older build that sends one books as 'UniteFix chooses'.
        return { type: 'unitefix' };
    }

    /** At booking: the chosen partner or expert must be one the customer could have been shown. */
    static async validate(choice: ProviderChoice, ctx: { catalogServiceId: number | null; pincode: string | null; location: string | null }) {
        if (choice.type === 'unitefix') return;
        if (choice.type === 'partner') {
            if (choice.code) {
                const inv = await this.invitedPartner(choice.code, ctx.catalogServiceId);
                if (inv?.option?.id === choice.id) return;
            }
            const ok = (await this.partnerOptions(ctx)).some(p => p.id === choice.id);
            if (!ok) throw new ProviderChoiceError('That partner can no longer take this booking here. Choose again, or let UniteFix choose.', 'PARTNER_UNAVAILABLE');
            return;
        }
        const p = pointOf(ctx.location);
        const radiusKm = Number(await configService.get<number>('BUSINESS_CONFIG.NEARBY_EXPERT_RADIUS_KM', 15)) || 15;
        const ok = p && (await this.expertOptions({ catalogServiceId: ctx.catalogServiceId, lat: p.lat, lng: p.lng }, radiusKm)).some(e => e.id === choice.id);
        if (!ok) throw new ProviderChoiceError('That expert is no longer available near this address. Choose again, or let UniteFix choose.', 'EXPERT_UNAVAILABLE');
    }

    /**
     * Once the booking is paid, hand it to whoever the customer chose. Called
     * from every path that confirms payment; the claim makes it run once.
     */
    static async applyAfterPayment(serviceRequestId: number): Promise<'none' | 'partner' | 'expert' | 'left_in_queue'> {
        const [claimed] = await db.update(serviceRequests).set({ choiceAppliedAt: new Date() } as any).where(and(
            eq(serviceRequests.id, serviceRequestId), isNull(serviceRequests.choiceAppliedAt),
            inArray(serviceRequests.chosenProviderType, ['partner', 'expert']),
            eq(serviceRequests.bookingFeeStatus, 'paid' as any), eq(serviceRequests.status, 'created' as any),
            isNull(serviceRequests.providerId), isNull(serviceRequests.dispatchPartnerId),
        )).returning();
        if (!claimed) return 'none';
        try {
            if (claimed.chosenProviderType === 'partner' && claimed.chosenPartnerId) {
                const { PartnerFieldService } = await import('./partner-field.service');
                await PartnerFieldService.dispatchToPartner(serviceRequestId, claimed.chosenPartnerId, null, { by: 'customer' });
                return 'partner';
            }
            if (claimed.chosenProviderType === 'expert' && claimed.chosenExpertId) {
                const [e] = await db.select({ ok: sql<boolean>`${employees.isActive} AND ${employees.documentVerificationStatus} = 'verified' AND ${employees.managedByPartnerId} IS NULL` })
                    .from(employees).where(eq(employees.id, claimed.chosenExpertId)).limit(1);
                if (!e?.ok) throw new Error('the expert is no longer available');
                const { AdminServiceManager } = await import('./admin-service.manager');
                await AdminServiceManager.assignTechnician(serviceRequestId, claimed.chosenExpertId, null as any, { by: 'customer' });
                return 'expert';
            }
        } catch (err: any) {
            logger.warn(`[CHOICE] SR ${serviceRequestId}: customer's choice not applied (${err?.message}); left for staff`);
            await recordAudit({ entityType: 'service_request', entityId: serviceRequestId, action: 'customer_choice_not_applied', metadata: { type: claimed.chosenProviderType, partnerId: claimed.chosenPartnerId, expertId: claimed.chosenExpertId, reason: err?.message } });
            const { BookingNotifications } = await import('./booking-notifications');
            void BookingNotifications.choiceNotTaken(serviceRequestId, (await this.describe([claimed])).get(serviceRequestId)?.name ?? null);
        }
        return 'left_in_queue';
    }
}
