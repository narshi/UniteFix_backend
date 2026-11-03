/**
 * Admin → Business partners → "Create app login": the partner's mobile login.
 *
 *   npm run smoke:partner-mobile-login
 */

import { eq, inArray } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { users, businessPartners } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], bpIds: number[] = [];
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;
        const mk = async (p: string, email: string | null) => {
            const bp = await BusinessPartnerService.create({ legalName: `QA Login ${stamp} ${++n}`, contactPhone: p, contactEmail: email, verticalCodes: ['electrical'], approvedByAdminId: sa.id } as any);
            bpIds.push(bp.id);
            return bp;
        };
        const create = (id: number, q = '') => api.post(`/api/admin/business-partners/${id}/mobile-login${q}`, {}, S);
        const loginOf = async (id: number) => (await db.select({ userId: businessPartners.userId }).from(businessPartners).where(eq(businessPartners.id, id)))[0]?.userId;

        // A new number: a business_partner login on it.
        const p1 = phone();
        const a = await mk(p1, `qa_ml_a_${stamp}@example.test`);
        const r1 = await create(a.id);
        const u1 = await loginOf(a.id); if (u1) userIds.push(u1);
        const [row1] = u1 ? await db.select().from(users).where(eq(users.id, u1)) : [];
        check('a new number: the app login is created', r1.status === 200 && row1?.role === 'business_partner' && row1?.phone === `+91${p1}`, JSON.stringify(r1.body).slice(0, 200));
        check('…only once', (await create(a.id)).status === 409);

        // The partner's email is already on another account (their own customer login, say).
        const [other] = await db.insert(users).values({ phone: phone(), email: `qa_ml_dup_${stamp}@example.test`, username: 'QA Other', role: 'user', isActive: true } as any).returning(); userIds.push(other.id);
        const b = await mk(phone(), `qa_ml_dup_${stamp}@example.test`);
        const r2 = await create(b.id);
        const u2 = await loginOf(b.id); if (u2) userIds.push(u2);
        check('an email already on another account does not break it (login made, email left off)', r2.status === 200 && !!u2, JSON.stringify(r2.body).slice(0, 200));
        check('…and the other account keeps its email', (await db.select().from(users).where(eq(users.id, other.id)))[0].email === `qa_ml_dup_${stamp}@example.test`);

        // Same email in different capitals: still the same address.
        const c = await mk(phone(), `QA_ML_DUP_${stamp}@Example.TEST`);
        const r3 = await create(c.id);
        const u3 = await loginOf(c.id); if (u3) userIds.push(u3);
        check('…same email in other capitals too', r3.status === 200 && !!u3, JSON.stringify(r3.body).slice(0, 200));

        // A customer account on the number, stored without +91 (older rows): found, not duplicated.
        const p4 = phone();
        const [cust] = await db.insert(users).values({ phone: p4, username: 'QA Cust', role: 'user', isActive: true } as any).returning(); userIds.push(cust.id);
        const d = await mk(p4, null);
        const r4 = await create(d.id);
        check('a customer account on the number (stored without +91) is found and explained, not duplicated', r4.status === 409 && r4.body?.code === 'PHONE_IN_USE', JSON.stringify(r4.body).slice(0, 200));
        const dupes = await db.select({ id: users.id }).from(users).where(inArray(users.phone, [p4, `+91${p4}`]));
        check('…no second account on that number', dupes.length === 1);
        const r5 = await create(d.id, '?convert=true');
        check('…and with convert it becomes the partner login', r5.status === 200 && (await loginOf(d.id)) === cust.id, JSON.stringify(r5.body).slice(0, 200));

        // App sign-in finds an account however its number was saved.
        const { storage } = await import('../server/storage');
        const p7 = phone();
        const [hubTech] = await db.insert(users).values({ phone: p7, username: 'QA Hub Tech', role: 'serviceman', isActive: true } as any).returning(); userIds.push(hubTech.id);
        check('sign-in with +91 finds a technician the Hub saved as 10 digits', (await storage.getUserByPhone(`+91${p7}`))?.id === hubTech.id);
        check('…and with the bare 10 digits too', (await storage.getUserByPhone(p7))?.id === hubTech.id);
        const p8 = phone();
        const [bare] = await db.insert(users).values({ phone: p8, username: 'QA Bare', role: 'user', isActive: true } as any).returning(); userIds.push(bare.id);
        const [plus] = await db.insert(users).values({ phone: `+91${p8}`, username: 'QA Plus', role: 'user', isActive: true } as any).returning(); userIds.push(plus.id);
        check('when both spellings exist, the +91 account (the one the app always used) wins', (await storage.getUserByPhone(`+91${p8}`))?.id === plus.id && (await storage.getUserByPhone(p8))?.id === plus.id);
        check('a non-mobile string still matches only itself', (await storage.getUserByPhone(`qa-${stamp}`)) === undefined);

        // First sign-in on a login with no email: an email already on another account is refused clearly.
        const otp = await api.post('/api/auth/fallback/request-otp', { phone: `+91${p7}`, email: `qa_ml_dup_${stamp}@example.test`, role: 'serviceman' });
        check('first sign-in with an email already on another account: told plainly, not a server error', otp.status === 409 && otp.body?.code === 'EMAIL_IN_USE', JSON.stringify(otp.body).slice(0, 200));

        // A partner with no email at all.
        const e = await mk(phone(), null);
        const r6 = await create(e.id);
        const u6 = await loginOf(e.id); if (u6) userIds.push(u6);
        check('a partner with no email gets a login', r6.status === 200 && !!u6, JSON.stringify(r6.body).slice(0, 200));
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0', bps = bpIds.join(',') || '0';
    await cleanupPartners(bpIds, adminIds, [
        `UPDATE business_partners SET user_id = NULL WHERE id IN (${bps})`,
        `DELETE FROM audit_logs WHERE entity_type = 'business_partner' AND entity_id IN (${bps})`,
        `DELETE FROM users WHERE id IN (${uids})`,
    ]);
    process.exit(summary());
});
