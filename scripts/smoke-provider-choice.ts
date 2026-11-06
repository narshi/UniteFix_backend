/**
 * The customer chooses who does the job: "Book via UniteFix" (UniteFix picks,
 * or one of the partners serving the address, shown with its customers'
 * rating) or a nearby UniteFix expert. The booking goes to that partner or
 * expert once paid, at UniteFix's price; a choice the customer could not have
 * been shown is refused. Also: a booking request can no longer set staff-only
 * fields (status, providerId, ...). Never calls Razorpay.
 *
 *   npm run smoke:provider-choice
 */

import jwt from 'jsonwebtoken';
import { eq, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { users, employees, serviceRequests, serviceCategories, services, partnerTerritories, partnerServices, ratings } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { ProviderChoiceService } from '../server/services/provider-choice.service';
import { PartnerFieldService } from '../server/services/partner-field.service';
import { revertStaleAssignments } from '../server/services/task_queues';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], bpIds: number[] = [], catIds: number[] = [], svcIds: number[] = [];
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;
const PIN = '581401';
// Sirsi, and points ~2 km and ~50 km away.
const HOME = { lat: 14.6195, lng: 74.8354 };
const pt = (lat: number, lng: number) => `POINT(${lng} ${lat})`;

async function main() {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;   // dev path: bookings count as paid, no Razorpay
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const [cat] = await db.insert(serviceCategories).values({ name: `QA Choice ${stamp}`, bookingFee: 99 } as any).returning(); catIds.push(cat.id);
        const [svc] = await db.insert(services).values({ categoryId: cat.id, name: `QA Fan repair ${stamp}`, basePrice: 500, isActive: true } as any).returning(); svcIds.push(svc.id);

        // A ready partner in the pincode that takes the service, and one that does not cover it.
        const mkPartner = async (name: string, pincode: string) => {
            const bp = await BusinessPartnerService.create({ legalName: `${name} ${stamp}`, contactPhone: phone(), contactEmail: `qa_pc_${stamp}_${++n}@example.test`, verticalCodes: ['electrical'], approvedByAdminId: sa.id } as any);
            bpIds.push(bp.id);
            await db.insert(partnerTerritories).values({ businessPartnerId: bp.id, pincode, mode: 'exclusive', status: 'active', activatedAt: new Date() } as any);
            await db.insert(partnerServices).values({ businessPartnerId: bp.id, catalogServiceId: svc.id, name: svc.name, isActive: true } as any);
            const [tu] = await db.insert(users).values({ phone: phone(), username: `${name} Tech`, role: 'serviceman', isActive: true } as any).returning(); userIds.push(tu.id);
            const [te] = await db.insert(employees).values({ userId: tu.id, fullName: `${name} Tech`, documentVerificationStatus: 'verified', isActive: true, managedByPartnerId: bp.id, currentLocation: pt(HOME.lat + 0.005, HOME.lng) } as any).returning();
            return { bp, techId: te.id };
        };
        const near = await mkPartner('QA Sirsi Electricals', PIN);
        const away = await mkPartner('QA Far Electricals', '560001');

        const mkExpert = async (name: string, lat: number, lng: number, extra: Record<string, unknown> = {}) => {
            const [u] = await db.insert(users).values({ phone: phone(), username: name, role: 'serviceman', isActive: true } as any).returning(); userIds.push(u.id);
            const [e] = await db.insert(employees).values({ userId: u.id, fullName: name, documentVerificationStatus: 'verified', isActive: true, isOnline: true, currentLocation: pt(lat, lng), averageRating: '4.80', totalServicesCompleted: 42, experienceYears: 6, ...extra } as any).returning();
            return e;
        };
        const ravi = await mkExpert('QA Ravi Kumar', HOME.lat + 0.018, HOME.lng);       // ~2 km
        const far = await mkExpert('QA Far Expert', HOME.lat + 0.45, HOME.lng);         // ~50 km
        const off = await mkExpert('QA Unverified Expert', HOME.lat + 0.01, HOME.lng, { documentVerificationStatus: 'pending' });

        const [cu] = await db.insert(users).values({ phone: phone(), username: 'QA Choice Customer', role: 'user', isActive: true, homeAddress: `Main road, Sirsi ${PIN}`, pinCode: PIN } as any).returning(); userIds.push(cu.id);
        const T = jwt.sign({ userId: cu.id, role: 'user' }, SECRET, { expiresIn: '1h' });
        const opts = async () => (await api.get(`/api/services/provider-options?catalogServiceId=${svc.id}&pincode=${PIN}&lat=${HOME.lat}&lng=${HOME.lng}`, T)).body?.data;

        // ── what the customer is shown ──
        let o = await opts();
        check('partners serving the pincode that take the service are listed', o?.partners?.length === 1 && o.partners[0].id === near.bp.id, JSON.stringify(o?.partners));
        check('…a partner with no reviews shows no rating ("New")', o?.partners?.[0]?.rating === null && o.partners[0].reviews === 0);
        // A finished job by that partner, rated 4 by a customer.
        const [done] = await db.insert(serviceRequests).values({ userId: cu.id, serviceId: `QA-PC-${stamp}-r`, serviceType: 'Fan', brand: 'x', model: 'x', description: 'QA', address: 'x', pincode: PIN, status: 'completed', dispatchPartnerId: near.bp.id, providerId: near.techId } as any).returning();
        await db.insert(ratings).values({ serviceRequestId: done.id, fromUserId: cu.id, toProviderId: near.techId, rating: 4 } as any);
        // And one review for Ravi, so his rating shows (an expert with none shows "New").
        const [rj] = await db.insert(serviceRequests).values({ userId: cu.id, serviceId: `QA-PC-${stamp}-rr`, serviceType: 'Fan', brand: 'x', model: 'x', description: 'QA', address: 'x', pincode: PIN, status: 'completed', providerId: ravi.id } as any).returning();
        await db.insert(ratings).values({ serviceRequestId: rj.id, fromUserId: cu.id, toProviderId: ravi.id, rating: 5 } as any);
        o = await opts();
        check('…its rating is the stars customers gave on its jobs, with the count', o?.partners?.[0]?.rating === 4 && o.partners[0].reviews === 1 && o.partners[0].jobsDone === 1, JSON.stringify(o?.partners?.[0]));
        const ex = o?.experts ?? [];
        check('customers are shown partners only: no UniteFix experts in the options', Array.isArray(o?.experts) && o.experts.length === 0, JSON.stringify(o?.experts));

        // ── booking with each choice ──
        const book = (provider?: any, extra: Record<string, unknown> = {}) => api.post('/api/services/create', {
            serviceType: 'Fan repair', description: 'QA choice booking', address: `Main road, Sirsi ${PIN}`, pinCode: PIN,
            customerLocation: pt(HOME.lat, HOME.lng), catalogServiceId: svc.id, ...(provider ? { provider } : {}), ...extra,
        }, T);
        const row = async (id: number) => (await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)))[0];

        const bp1 = await book({ type: 'partner', id: near.bp.id });
        const r1 = await row(bp1.body?.data?.id ?? 0);
        check('choosing a partner: once paid, the booking goes to that partner', bp1.status === 201 && r1?.dispatchPartnerId === near.bp.id && r1.dispatchMode === 'customer' && !!r1.choiceAppliedAt, JSON.stringify(bp1.body?.message ?? (r1 && { d: r1.dispatchPartnerId, m: r1.dispatchMode })));
        check('…at UniteFix\'s price', Number((r1?.pricingSnapshot as any)?.grossTotal ?? r1?.totalAmount) === 500 || r1?.totalAmount === 500, JSON.stringify((r1?.pricingSnapshot as any)?.grossTotal));
        const [alert] = (await db.execute(sql`SELECT body FROM hub_alerts WHERE business_partner_id = ${near.bp.id} ORDER BY id DESC LIMIT 1`) as any).rows;
        check('…and the partner is told a customer chose them', /A customer chose you/.test(alert?.body ?? ''), alert?.body);

        const be = await book({ type: 'expert', id: ravi.id });
        const r2 = await row(be.body?.data?.id ?? 0);
        check('an expert sent by an older app is ignored: it books as "UniteFix chooses"', be.status === 201 && !r2?.providerId && r2?.status === 'created' && r2.chosenProviderType === 'unitefix', JSON.stringify(be.body?.message ?? (r2 && { p: r2.providerId, s: r2.status, c: r2.chosenProviderType })));

        const bu = await book();
        const r3 = await row(bu.body?.data?.id ?? 0);
        check('"UniteFix chooses" (or an older app): it waits in the Assignment Queue as before', bu.status === 201 && !r3?.providerId && !r3?.dispatchPartnerId && r3?.status === 'created');

        const bad1 = await book({ type: 'expert', id: far.id });
        check('…even one far away (not refused, just not theirs to choose)', bad1.status === 201, JSON.stringify(bad1.body?.message));
        const bad2 = await book({ type: 'partner', id: away.bp.id });
        check('a partner that does not serve the address is refused', bad2.status === 409 && bad2.body?.code === 'PARTNER_UNAVAILABLE');

        // ── staff-only fields cannot be set from the app ──
        const forged = await book(undefined, { status: 'completed', providerId: ravi.id, dispatchPartnerId: near.bp.id, bookingFeeStatus: 'paid', cancelledByAdminId: 1 });
        const r4 = await row(forged.body?.data?.id ?? 0);
        check('a booking request cannot set status, expert, partner or staff fields', forged.status === 201 && r4?.status === 'created' && !r4.providerId && !r4.dispatchPartnerId && !r4.cancelledByAdminId, JSON.stringify(r4 && { s: r4.status, p: r4.providerId, d: r4.dispatchPartnerId }));

        // ── applied once, only when paid ──
        const [unpaid] = await db.insert(serviceRequests).values({ userId: cu.id, serviceId: `QA-PC-${stamp}-u`, serviceType: 'Fan', brand: 'x', model: 'x', description: 'QA', address: 'x', pincode: PIN, status: 'created', bookingFeeStatus: 'pending', chosenProviderType: 'expert', chosenExpertId: ravi.id } as any).returning();
        check('an unpaid booking is not handed over', (await ProviderChoiceService.applyAfterPayment(unpaid.id)) === 'none' && !(await row(unpaid.id)).providerId);
        await db.update(serviceRequests).set({ bookingFeeStatus: 'paid' } as any).where(eq(serviceRequests.id, unpaid.id));
        const firstApply = await ProviderChoiceService.applyAfterPayment(unpaid.id);
        const secondApply = await ProviderChoiceService.applyAfterPayment(unpaid.id);
        check('once paid it is handed over, and a second payment signal does nothing', firstApply === 'expert' && secondApply === 'none' && (await row(unpaid.id)).providerId === ravi.id);
        // An expert switched off between booking and payment: left for staff.
        const [gone] = await db.insert(serviceRequests).values({ userId: cu.id, serviceId: `QA-PC-${stamp}-g`, serviceType: 'Fan', brand: 'x', model: 'x', description: 'QA', address: 'x', pincode: PIN, status: 'created', bookingFeeStatus: 'paid', chosenProviderType: 'expert', chosenExpertId: off.id } as any).returning();
        check('a chosen expert who can no longer take it leaves the job in the queue for staff', (await ProviderChoiceService.applyAfterPayment(gone.id)) === 'left_in_queue' && !(await row(gone.id)).providerId);
        await new Promise(r => setTimeout(r, 300));
        const told = async (title: string, srRef: string) => (await db.execute(sql`SELECT 1 FROM notifications WHERE user_id = ${cu.id} AND title = ${title} AND body LIKE ${'%' + srRef + '%'} LIMIT 1`) as any).rows.length > 0;
        check('…and the customer is told UniteFix is assigning another expert', await told('Finding you another expert', (await row(gone.id)).serviceId));

        // ── a chosen expert who does not accept in time ──
        await db.update(serviceRequests).set({ assignedAt: new Date(Date.now() - 90 * 60_000) } as any).where(eq(serviceRequests.id, unpaid.id));
        await revertStaleAssignments();
        const r2b = await row(unpaid.id);
        check('a customer-chosen expert who does not accept within 60 min: the job goes back to the queue', r2b.status === 'created' && !r2b.providerId, JSON.stringify({ s: r2b.status, p: r2b.providerId }));
        await new Promise(r => setTimeout(r, 300));
        check('…and the customer is told', await told('Finding you another expert', r2b.serviceId));

        // ── a chosen partner past its assign-by time ──
        await db.update(serviceRequests).set({ slaAssignBy: new Date(Date.now() - 5 * 60_000) } as any).where(eq(serviceRequests.id, r1.id));
        await PartnerFieldService.escalateOverdue();
        await new Promise(r => setTimeout(r, 300));
        check('a customer-chosen partner past its assign-by time: the customer is told UniteFix is on it', await told('We are on it', r1.serviceId));

        // ── staff see the choice ──
        const S = await api.login(sa.username, sa.password);
        const list = await api.get(`/api/admin/services?q=${encodeURIComponent(r1.serviceId)}`, S);
        const inList = (list.body?.data ?? []).find((x: any) => x.id === r1.id);
        check('Service Requests shows who the customer chose and that it is with them', inList?.customerChoice?.type === 'partner' && inList.customerChoice.name === near.bp.displayName && inList.customerChoice.via === 'list' && inList.customerChoice.state === 'with_them', JSON.stringify(inList?.customerChoice));
        const queue = await api.get('/api/admin/assignment-queue', S);
        const inQueue = (queue.body?.queue ?? []).find((x: any) => x.id === unpaid.id);
        check('the Assignment Queue shows "Customer asked for" on a job the chosen expert did not take', inQueue?.customerChoice?.type === 'expert' && inQueue.customerChoice.state === 'not_taken' && inQueue.customerChoice.name === 'QA Ravi Kumar', JSON.stringify(inQueue?.customerChoice));

        // ── ratings keep the expert's stored average right ──
        const [rated] = await db.insert(serviceRequests).values({ userId: cu.id, serviceId: `QA-PC-${stamp}-rt`, serviceType: 'Fan', brand: 'x', model: 'x', description: 'QA', address: 'x', pincode: PIN, status: 'completed', bookingFeeStatus: 'paid', providerId: ravi.id } as any).returning();
        const rr = await api.post(`/api/ratings/service/${rated.id}`, { rating: 4, review: 'QA' }, T);
        const [rv] = await db.select({ avg: employees.averageRating }).from(employees).where(eq(employees.id, ravi.id));
        check('a customer rating updates the expert\'s stored average (5 and 4 → 4.5)', rr.status === 201 && Number(rv.avg) === 4.5, JSON.stringify({ s: rr.status, avg: rv.avg, m: rr.body?.message }));

    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0';
    await cleanupPartners(bpIds, adminIds, [
        `DELETE FROM hub_alerts WHERE business_partner_id IN (${bpIds.join(',') || '0'})`,
        `DELETE FROM ratings WHERE from_user_id IN (${uids})`,
        `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (SELECT id FROM service_requests WHERE user_id IN (${uids}))`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM payment_transactions WHERE service_request_id IN (SELECT id FROM service_requests WHERE user_id IN (${uids}))`,
        `DELETE FROM service_requests WHERE user_id IN (${uids})`,
        `DELETE FROM partner_territories WHERE business_partner_id IN (${bpIds.join(',') || '0'})`,
        `DELETE FROM employees WHERE user_id IN (${uids})`,
        `DELETE FROM customers WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
        `DELETE FROM services WHERE id IN (${svcIds.join(',') || '0'})`,
        `DELETE FROM service_categories WHERE id IN (${catIds.join(',') || '0'})`,
    ]);
    process.exit(summary());
});
