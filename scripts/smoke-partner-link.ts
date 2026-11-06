/**
 * A partner's customer link and code (app.unitefix.com/p/POORVI12): the public
 * card, the code on the booking screen putting that partner first and
 * selected even outside their usual pincodes, bookings through it marked
 * chosen_via 'code', and the partner's own count in the Hub. Never calls Razorpay.
 *
 *   npm run smoke:partner-link
 */

import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, users, employees, serviceRequests, serviceCategories, services, partnerTerritories, partnerServices } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], bpIds: number[] = [], catIds: number[] = [], svcIds: number[] = [];
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;
const HOME_PIN = '581401', AWAY_PIN = '581402';

async function main() {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const [cat] = await db.insert(serviceCategories).values({ name: `QA Link ${stamp}`, bookingFee: 99 } as any).returning(); catIds.push(cat.id);
        const [svc] = await db.insert(services).values({ categoryId: cat.id, name: `QA CCTV install ${stamp}`, basePrice: 800, isActive: true } as any).returning(); svcIds.push(svc.id);
        const [other] = await db.insert(services).values({ categoryId: cat.id, name: `QA Laptop repair ${stamp}`, basePrice: 600, isActive: true } as any).returning(); svcIds.push(other.id);

        // A ready partner whose territory is HOME_PIN and who takes CCTV (not laptops).
        const bp = await BusinessPartnerService.create({ legalName: `QA Poorvi Computers ${stamp}`, contactPhone: phone(), contactEmail: `qa_pl_${stamp}@example.test`, verticalCodes: ['electrical'], approvedByAdminId: sa.id } as any);
        bpIds.push(bp.id);
        await db.insert(partnerTerritories).values({ businessPartnerId: bp.id, pincode: HOME_PIN, mode: 'exclusive', status: 'active', activatedAt: new Date() } as any);
        await db.insert(partnerServices).values({ businessPartnerId: bp.id, catalogServiceId: svc.id, name: svc.name, isActive: true } as any);
        const [tu] = await db.insert(users).values({ phone: phone(), username: 'QA Poorvi Tech', role: 'serviceman', isActive: true } as any).returning(); userIds.push(tu.id);
        await db.insert(employees).values({ userId: tu.id, fullName: 'QA Poorvi Tech', documentVerificationStatus: 'verified', isActive: true, managedByPartnerId: bp.id } as any);

        // ── the public card ──
        const card = await api.get(`/api/public/partners/${bp.partnerCode}`);
        const code: string = card.body?.data?.code;
        check('a partner gets a friendly code from its name', /^POORVI\d+$/.test(code ?? ''), code);
        check('the public card (no login) shows name, services, that it takes jobs, and the link', card.status === 200 && card.body.data.name.startsWith('QA Poorvi') && card.body.data.services.includes(svc.name) && card.body.data.takesJobs === true && card.body.data.link.endsWith(`/p/${code}`), JSON.stringify(card.body?.data));
        check('…found by the friendly code too, any case', (await api.get(`/api/public/partners/${code.toLowerCase()}`)).body?.data?.code === code);
        check('…the code does not change', (await api.get(`/api/public/partners/${code}`)).body?.data?.code === code);
        check('an unknown code is a plain "not found"', (await api.get(`/api/public/partners/NOSUCH${stamp}`)).status === 404);

        // ── on the booking screen ──
        const [cu] = await db.insert(users).values({ phone: phone(), username: 'QA Link Customer', role: 'user', isActive: true, homeAddress: `Road ${AWAY_PIN}`, pinCode: AWAY_PIN } as any).returning(); userIds.push(cu.id);
        const T = jwt.sign({ userId: cu.id, role: 'user' }, SECRET, { expiresIn: '1h' });
        const opts = async (svcId: number, extra = '') => (await api.get(`/api/services/provider-options?catalogServiceId=${svcId}&pincode=${AWAY_PIN}${extra}`, T)).body?.data;
        const without = await opts(svc.id);
        check('outside its pincodes the partner is not in the list on its own', !without?.partners?.some((p: any) => p.id === bp.id));
        const withCode = await opts(svc.id, `&partnerCode=${code}`);
        check('with its code it is listed first, marked as the customer\'s partner', withCode?.partners?.[0]?.id === bp.id && withCode.partners[0].viaCode === true && withCode.invited?.available === true, JSON.stringify(withCode?.invited));
        const wrongSvc = await opts(other.id, `&partnerCode=${code}`);
        check('for a service it does not take, the customer is told why', wrongSvc?.invited?.available === false && /does not take this service/.test(wrongSvc.invited.reason ?? '') && !wrongSvc.partners.some((p: any) => p.id === bp.id), JSON.stringify(wrongSvc?.invited));
        const bad = await opts(svc.id, `&partnerCode=NOSUCH${stamp}`);
        check('a wrong code says so', bad?.invited?.available === false && /No UniteFix partner has this code/.test(bad.invited.reason ?? ''));

        // ── booking through the code ──
        const book = (provider: any) => api.post('/api/services/create', { serviceType: 'CCTV', description: 'QA link booking', address: `Road ${AWAY_PIN}`, pinCode: AWAY_PIN, catalogServiceId: svc.id, provider }, T);
        const noCode = await book({ type: 'partner', id: bp.id });
        check('choosing it outside its pincodes without the code is refused', noCode.status === 409 && noCode.body?.code === 'PARTNER_UNAVAILABLE');
        const viaCode = await book({ type: 'partner', id: bp.id, code });
        const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, viaCode.body?.data?.id ?? 0));
        check('with the code it books, goes to the partner, and is marked as brought in by the code', viaCode.status === 201 && sr?.dispatchPartnerId === bp.id && sr.chosenVia === 'code', JSON.stringify(viaCode.body?.message ?? (sr && { d: sr.dispatchPartnerId, v: sr.chosenVia })));
        const otherBp = await book({ type: 'partner', id: bp.id, code: `NOSUCH${stamp}` });
        check('a code that names nobody does not let a far partner through', otherBp.status === 409);

        // ── the partner sees it ──
        const ol = await PartnerHubService.createOwnerLogin(bp.id, {});
        const [owner] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, ol.username)); adminIds.push(owner.id);
        const H = (await api.login(ol.username, ol.temporaryPassword))!;
        const share = await api.get('/api/hub/field/share', H);
        check('the partner\'s Hub shows its code, link and the bookings it brought in', share.status === 200 && share.body.data.code === code && share.body.data.link.endsWith(`/p/${code}`) && share.body.data.bookings === 1, JSON.stringify(share.body?.data));
        const S = await api.login(sa.username, sa.password);
        const adminShare = await api.get(`/api/admin/business-partners/${bp.id}/share`, S);
        check('staff see the same code and count in Business partners', adminShare.status === 200 && adminShare.body.data.code === code && adminShare.body.data.bookings === 1, JSON.stringify(adminShare.body));
        const list = await api.get(`/api/admin/services?q=${encodeURIComponent(sr.serviceId)}`, S);
        const row = (list.body?.data ?? []).find((x: any) => x.id === sr.id);
        check('…and Service Requests marks the booking as brought in by the partner\'s code', row?.customerChoice?.via === 'code' && row.customerChoice.type === 'partner', JSON.stringify(row?.customerChoice));
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0', bps = bpIds.join(',') || '0';
    await cleanupPartners(bpIds, adminIds, [
        `DELETE FROM hub_alerts WHERE business_partner_id IN (${bps})`,
        `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (SELECT id FROM service_requests WHERE user_id IN (${uids}))`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
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
