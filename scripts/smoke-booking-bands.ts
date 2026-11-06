/**
 * Booking bands: staff set a category's band (and a service's own), the app
 * sees it, and each band books its own way — visit, inspect & quote (the
 * inspection fee; declining the quote closes the job and pays the expert the
 * fee), consultation (a call at a booked slot), recharge and referral (not
 * booked). Referral enquiries go to partners in the area first, then staff.
 * Never calls Razorpay.
 *
 *   npm run smoke:booking-bands
 */

import jwt from 'jsonwebtoken';
import { eq, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, users, employees, serviceRequests, serviceCategories, services, partnerTerritories, partnerServices, partRequests, partnerWallets } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], bpIds: number[] = [], catIds: number[] = [], svcIds: number[] = [];
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;
const PIN = '581401';
const ist = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);

async function main() {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;   // bookings count as paid (dev path)
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = await api.login(sa.username, sa.password);
        const mkCat = async (name: string) => { const [c] = await db.insert(serviceCategories).values({ name: `QA ${name} ${stamp}`, bookingFee: 99 } as any).returning(); catIds.push(c.id); return c; };
        const mkSvc = async (catId: number, name: string) => { const [s] = await db.insert(services).values({ categoryId: catId, name: `QA ${name} ${stamp}`, basePrice: 0, isActive: true } as any).returning(); svcIds.push(s.id); return s; };
        const visitCat = await mkCat('Repairs'), inspectCat = await mkCat('Transport'), consultCat = await mkCat('Professional'), referCat = await mkCat('Events');
        const fan = await mkSvc(visitCat.id, 'Fan repair'), dth = await mkSvc(visitCat.id, 'DTH recharge');
        const movers = await mkSvc(inspectCat.id, 'Packers & movers');
        const lawyer = await mkSvc(consultCat.id, 'Lawyer');
        const travel = await mkSvc(referCat.id, 'Travel'), catering = await mkSvc(referCat.id, 'Catering');

        // ── staff set the bands ──
        const patchCat = (id: number, body: any) => api.patch(`/api/admin/catalog/categories/${id}`, body, S);
        check('a category starts on "Visit" (field_service), as booking works today', (await db.select().from(serviceCategories).where(eq(serviceCategories.id, visitCat.id)))[0].bookingBand === 'field_service');
        check('an unknown band is refused', (await patchCat(inspectCat.id, { bookingBand: 'teleport' })).status === 400);
        check('a colour outside the theme is refused', (await patchCat(inspectCat.id, { bookingBand: 'inspect_quote', bandColor: '#123456' })).status === 400);
        const ok1 = await patchCat(inspectCat.id, { bookingBand: 'inspect_quote', inspectionFee: 149, bandColor: '#f59e0b' });
        check('staff set Inspect & quote with a ₹149 inspection fee and a theme colour', ok1.status === 200 && ok1.body.data.bookingBand === 'inspect_quote' && ok1.body.data.inspectionFee === 149 && ok1.body.data.bandColor === '#F59E0B', JSON.stringify(ok1.body));
        await patchCat(consultCat.id, { bookingBand: 'consultation' });
        await patchCat(referCat.id, { bookingBand: 'referral' });
        const ov = await api.patch(`/api/admin/catalog/services/${dth.id}`, { bookingBand: 'digital_recharge' }, S);
        check('a service can have its own band (DTH → Recharge inside a Visit category)', ov.status === 200 && ov.body.data.bookingBand === 'digital_recharge');

        // ── the app sees it ──
        const cats = (await api.get('/api/services/categories')).body?.data ?? [];
        const c = (id: number) => cats.find((x: any) => x.id === id);
        const item = (catId: number, svcId: number) => c(catId)?.items?.find((i: any) => i.id === svcId);
        check('categories carry their band, label and colour', c(inspectCat.id)?.bookingBand === 'inspect_quote' && c(inspectCat.id)?.bandLabel === 'Inspect & quote' && c(inspectCat.id)?.bandColor === '#F59E0B' && c(referCat.id)?.bandColor === '#10B981');
        check('a service carries the band that applies to it (its own over its category\'s)', item(visitCat.id, dth.id)?.band === 'digital_recharge' && item(visitCat.id, fan.id)?.band === 'field_service' && item(consultCat.id, lawyer.id)?.band === 'consultation');
        check('an inspection service\'s booking fee is the inspection fee', item(inspectCat.id, movers.id)?.bookingFee === 149 && item(inspectCat.id, movers.id)?.inspectionFee === 149 && item(visitCat.id, fan.id)?.bookingFee === 99);

        // ── booking by band ──
        const [cu] = await db.insert(users).values({ phone: phone(), username: 'QA Band Customer', role: 'user', isActive: true, homeAddress: `Road ${PIN}`, pinCode: PIN } as any).returning(); userIds.push(cu.id);
        const T = jwt.sign({ userId: cu.id, role: 'user' }, SECRET, { expiresIn: '1h' });
        const book = (svcId: number, extra: Record<string, unknown> = {}) => api.post('/api/services/create', { serviceType: 'QA', description: 'QA band booking', address: `Road ${PIN}`, pinCode: PIN, catalogServiceId: svcId, ...extra }, T);
        const row = async (id: number) => (await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)))[0];
        const bf = await book(fan.id);
        check('Visit: books as always, marked field_service', bf.status === 201 && (await row(bf.body.data.id)).bookingBand === 'field_service');
        const bi = await book(movers.id);
        const ri = await row(bi.body?.data?.id ?? 0);
        check('Inspect & quote: books with the ₹149 inspection fee', bi.status === 201 && ri?.bookingBand === 'inspect_quote' && ri.bookingFee === 149, JSON.stringify(ri && { b: ri.bookingBand, f: ri.bookingFee }));
        const noSlot = await book(lawyer.id);
        check('Consultation without a day and time is refused, saying what is needed', noSlot.status === 400 && noSlot.body?.code === 'NEED_SLOT');
        const past = await book(lawyer.id, { preferredDate: ist(-1), preferredTimeSlot: '10:00 – 11:00' });
        check('…a day in the past is refused', past.status === 400);
        const bc = await book(lawyer.id, { address: '', preferredDate: ist(2), preferredTimeSlot: '10:00 – 11:00' });
        const rc = await row(bc.body?.data?.id ?? 0);
        check('Consultation with a slot books, no address needed', bc.status === 201 && rc?.bookingBand === 'consultation' && rc.preferredDate === ist(2) && rc.address === 'Phone consultation', JSON.stringify(bc.body?.message ?? (rc && { a: rc.address, d: rc.preferredDate })));
        const br = await book(travel.id);
        check('Referral services are not booked (an older app is told to send an enquiry)', br.status === 409 && br.body?.code === 'USE_ENQUIRY');
        const bd = await book(dth.id);
        check('Recharge services are not booked (told to recharge)', bd.status === 409 && bd.body?.code === 'USE_RECHARGE');

        // ── the expert's side ──
        const [eu] = await db.insert(users).values({ phone: phone(), username: 'QA Band Expert', role: 'serviceman', isActive: true } as any).returning(); userIds.push(eu.id);
        const [ex] = await db.insert(employees).values({ userId: eu.id, fullName: 'QA Band Expert', documentVerificationStatus: 'verified', isActive: true } as any).returning();
        const ET = jwt.sign({ userId: eu.id, role: 'serviceman' }, SECRET, { expiresIn: '1h' });
        await db.update(serviceRequests).set({ providerId: ex.id, status: 'accepted' } as any).where(eq(serviceRequests.id, rc.id));
        const call = await api.post(`/api/bookings/${rc.id}/start-call`, {}, ET);
        check('Consultation: the expert starts the call — no arrival check, no code', call.status === 200 && (await row(rc.id)).status === 'in_progress', JSON.stringify(call.body));
        await db.update(serviceRequests).set({ providerId: ex.id, status: 'accepted' } as any).where(eq(serviceRequests.id, ri.id));
        check('…a visit booking cannot be started that way', (await api.post(`/api/bookings/${ri.id}/start-call`, {}, ET)).status === 409);

        // Inspect & quote: inspected, quote sent, customer declines.
        await db.update(serviceRequests).set({ status: 'in_progress', startedAt: new Date() } as any).where(eq(serviceRequests.id, ri.id));
        const early = await api.post(`/api/services/${ri.id}/decline-quote`, {}, T);
        check('declining before a quote is sent is refused', early.status === 409 && early.body?.code === 'NO_QUOTE');
        await db.insert(partRequests).values({ serviceRequestId: ri.id, employeeId: ex.id, customerUserId: cu.id, status: 'pending', items: [], workItems: [{ description: 'Move 2BHK', amountPaise: 1_200_000 }], workPaise: 1_200_000, sentAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } as any);
        const [wBefore] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, ex.id));
        const dec = await api.post(`/api/services/${ri.id}/decline-quote`, {}, T);
        const after = await row(ri.id);
        const [wAfter] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, ex.id));
        check('declining the quote closes the job', dec.status === 200 && after.status === 'cancelled' && after.cancelReason === 'Customer declined the quote', JSON.stringify(dec.body));
        check('…and the expert is paid the ₹149 inspection fee (held)', Number(wAfter?.balanceHold ?? 0) - Number(wBefore?.balanceHold ?? 0) === 149, JSON.stringify({ before: wBefore?.balanceHold, after: wAfter?.balanceHold }));
        const mine = (await api.get('/api/services/my-requests', T)).body?.data ?? [];
        check('…and the customer\'s booking says the fee paid for the visit (not "refunded")', mine.find((x: any) => x.id === ri.id)?.refund?.state === 'visit_charge', JSON.stringify(mine.find((x: any) => x.id === ri.id)?.refund));

        // ── referral enquiries ──
        const mkPartner = async (name: string, svcId: number | null) => {
            const bp = await BusinessPartnerService.create({ legalName: `${name} ${stamp}`, contactPhone: phone(), contactEmail: `qa_bb_${stamp}_${++n}@example.test`, verticalCodes: ['electrical'], approvedByAdminId: sa.id } as any);
            bpIds.push(bp.id);
            await db.insert(partnerTerritories).values({ businessPartnerId: bp.id, pincode: PIN, mode: 'shared', status: 'active', activatedAt: new Date() } as any);
            if (svcId) await db.insert(partnerServices).values({ businessPartnerId: bp.id, catalogServiceId: svcId, name: 'Travel', isActive: true } as any);
            const ol = await PartnerHubService.createOwnerLogin(bp.id, {});
            const [owner] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, ol.username)); adminIds.push(owner.id);
            return { bp, H: (await api.login(ol.username, ol.temporaryPassword))! };
        };
        const agent = await mkPartner('QA Sirsi Travels', travel.id);     // takes travel here, no technicians
        const other = await mkPartner('QA Other Shop', null);             // does not list travel
        const bad = await api.post('/api/enquiries', { catalogServiceId: fan.id, details: 'Need a fan fixed please' }, T);
        check('an enquiry for a bookable service is refused', bad.status === 409 && bad.body?.code === 'NOT_REFERRAL');
        const thin = await api.post('/api/enquiries', { catalogServiceId: travel.id, details: 'Goa' }, T);
        check('an enquiry needs a sentence of detail', thin.status === 400);
        const eq1 = await api.post('/api/enquiries', { catalogServiceId: travel.id, details: 'Family trip to Goa for 4 people in December', budget: '₹40,000', preferredDate: ist(20), address: `Road ${PIN}` }, T);
        check('an enquiry goes to partners who take the service in the pincode (no technicians needed)', eq1.status === 201 && /1 partner/.test(eq1.body?.message ?? ''), JSON.stringify(eq1.body));
        const inbox = (await api.get('/api/hub/enquiries', agent.H)).body?.data ?? [];
        const mineE = inbox.find((x: any) => x.id === eq1.body.data.id);
        check('the partner sees it, without the customer\'s number yet', mineE?.status === 'open' && mineE.customer === null);
        check('a partner it was not sent to does not see it', !((await api.get('/api/hub/enquiries', other.H)).body?.data ?? []).some((x: any) => x.id === eq1.body.data.id));
        check('…and cannot take it', (await api.post(`/api/hub/enquiries/${eq1.body.data.id}/take`, {}, other.H)).status === 409);
        const took = await api.post(`/api/hub/enquiries/${eq1.body.data.id}/take`, {}, agent.H);
        check('taking it gives the partner the customer\'s name and number', took.status === 200 && took.body.data.customer?.phone === cu.phone, JSON.stringify(took.body?.data?.customer));
        check('…it can be taken only once', (await api.post(`/api/hub/enquiries/${eq1.body.data.id}/take`, {}, agent.H)).status === 409);
        const my = (await api.get('/api/enquiries/mine', T)).body?.data ?? [];
        check('the customer sees who will call', my.find((x: any) => x.id === eq1.body.data.id)?.partnerName === agent.bp.displayName && my[0].status === 'taken');
        await new Promise(r => setTimeout(r, 300));
        const [told] = (await db.execute(sql`SELECT 1 FROM notifications WHERE user_id = ${cu.id} AND title = 'Your enquiry was picked up' LIMIT 1`) as any).rows;
        check('…and is told', !!told);
        check('the partner marks it closed', (await api.patch(`/api/hub/enquiries/${eq1.body.data.id}`, { status: 'closed', note: 'Booked the trip' }, agent.H)).status === 200);

        const eq2 = await api.post('/api/enquiries', { catalogServiceId: catering.id, details: 'Catering for 200 guests at a wedding' , address: `Road ${PIN}` }, T);
        check('with no partner for it, the enquiry goes to UniteFix', eq2.status === 201 && /UniteFix/.test(eq2.body?.message ?? ''));
        const staff = (await api.get('/api/admin/enquiries?filter=needs_staff', S)).body?.data ?? [];
        check('staff see it under "needs staff", with the customer\'s number', staff.some((x: any) => x.id === eq2.body.data.id && x.needsStaff && x.customerPhone === cu.phone));
        const fw = await api.post(`/api/admin/enquiries/${eq2.body.data.id}/forward`, { businessPartnerId: other.bp.id }, S);
        check('staff forward it to a partner', fw.status === 200 && fw.body.data.status === 'forwarded');
        const inbox2 = (await api.get('/api/hub/enquiries', other.H)).body?.data ?? [];
        check('…who now sees it with the customer\'s number', inbox2.find((x: any) => x.id === eq2.body.data.id)?.customer?.phone === cu.phone);
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0', bps = bpIds.join(',') || '0';
    await cleanupPartners(bpIds, adminIds, [
        `DELETE FROM service_enquiries WHERE user_id IN (${uids})`,
        `DELETE FROM audit_logs WHERE entity_type IN ('service_request','service_enquiry') AND entity_id IN (SELECT id FROM service_requests WHERE user_id IN (${uids}))`,
        `DELETE FROM hub_alerts WHERE business_partner_id IN (${bps})`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM part_requests WHERE customer_user_id IN (${uids})`,
        `DELETE FROM wallet_transactions_v2 WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM partner_wallets WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM payment_transactions WHERE service_request_id IN (SELECT id FROM service_requests WHERE user_id IN (${uids}))`,
        `DELETE FROM service_requests WHERE user_id IN (${uids})`,
        `DELETE FROM partner_territories WHERE business_partner_id IN (${bps})`,
        `DELETE FROM employees WHERE user_id IN (${uids})`,
        `DELETE FROM customers WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
        `DELETE FROM services WHERE id IN (${svcIds.join(',') || '0'})`,
        `DELETE FROM service_categories WHERE id IN (${catIds.join(',') || '0'})`,
    ]);
    process.exit(summary());
});
