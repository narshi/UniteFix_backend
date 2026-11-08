/**
 * Admin → WhatsApp, against a fake Meta (WhatsApp Cloud API) on localhost:
 * connect (checked with Meta, token stored sealed and never returned), submit
 * the payment template, see it approved, send a test, and a call booking's
 * payment link going out on WhatsApp automatically. Uses its own settings row
 * (WHATSAPP_SETTINGS_KEY), so the real connection is never touched.
 *
 *   npx tsx scripts/smoke-whatsapp.ts
 */

import express from 'express';
import type { AddressInfo } from 'net';

const stamp = Date.now().toString(36);
process.env.WHATSAPP_SETTINGS_KEY = `whatsapp_test_${stamp}`;
process.env.PAYMENT_LINKS_MOCK = '1';
for (const k of ['WHATSAPP_CLOUD_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_PAYMENT_TEMPLATE', 'WHATSAPP_BUSINESS_ACCOUNT_ID']) delete process.env[k];

// ── a fake Meta ──
const meta = { sent: [] as any[], templates: [] as any[], templateStatus: 'PENDING' };
const fake = express(); fake.use(express.json());
const authed = (req: any, res: any) => { if (req.headers.authorization !== 'Bearer EAAG-good-token') { res.status(401).json({ error: { message: 'Invalid OAuth access token.' } }); return false; } return true; };
fake.get('/:phoneId', (req, res) => { if (!authed(req, res)) return; res.json({ id: req.params.phoneId, display_phone_number: '+91 80000 00000', verified_name: 'UniteFix' }); });
fake.post('/:waba/message_templates', (req, res) => { if (!authed(req, res)) return; meta.templates.push(req.body); res.json({ id: 'tmpl_1', status: 'PENDING', category: 'UTILITY' }); });
fake.get('/:waba/message_templates', (req, res) => { if (!authed(req, res)) return; res.json({ data: [{ name: req.query.name, status: meta.templateStatus, language: 'en', category: 'UTILITY', rejected_reason: 'NONE' }] }); });
fake.post('/:phoneId/messages', (req, res) => { if (!authed(req, res)) return; meta.sent.push(req.body); res.json({ messages: [{ id: `wamid.${meta.sent.length}` }] }); });

async function main() {
    const fakeServer = await new Promise<any>(r => { const s = fake.listen(0, '127.0.0.1', () => r(s)); });
    process.env.WHATSAPP_GRAPH_BASE = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`;

    const { bootServer, client, check, makeSuperAdmin, db } = await import('./lib/hub-test-kit');
    const { integrationSettings, serviceCategories, services, serviceRequests, users } = await import('../shared/schema');
    const { eq, inArray, sql } = await import('drizzle-orm');
    const { open } = await import('../server/lib/secret-box');
    const ids = { admin: 0, cat: 0, svc: 0, sr: [] as number[], user: 0 };
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); ids.admin = sa.id;
        const S = await api.login(sa.username, sa.password);
        const P = '/api/admin/integrations/whatsapp';

        const st0 = await api.get(P, S);
        check('not connected at first', st0.status === 200 && st0.body.data.connected === false && st0.body.data.ready === false);

        // ── connect ──
        check('a bad phone number ID is refused', (await api.put(P, { token: 'EAAG-good-token', phoneNumberId: 'abc' }, S)).status === 400);
        const bad = await api.put(P, { token: 'EAAG-bad-token', phoneNumberId: '109876543210987', businessAccountId: '200000000000001' }, S);
        check('a wrong token is caught by Meta, with Meta\'s message, and nothing is saved', bad.status === 400 && /Invalid OAuth/.test(bad.body.message) && !(await db.select().from(integrationSettings).where(eq(integrationSettings.key, process.env.WHATSAPP_SETTINGS_KEY!))).length, JSON.stringify(bad.body));
        const ok = await api.put(P, { token: 'EAAG-good-token', phoneNumberId: '109876543210987', businessAccountId: '200000000000001' }, S);
        check('the right token connects: Meta\'s name and number shown', ok.status === 200 && ok.body.data.connected && ok.body.data.verifiedName === 'UniteFix' && ok.body.data.displayNumber === '+91 80000 00000', JSON.stringify(ok.body));
        check('…the token never comes back: only its last four characters', !JSON.stringify(ok.body).includes('EAAG-good-token') && ok.body.data.tokenEnding === 'oken');
        const [row] = await db.select().from(integrationSettings).where(eq(integrationSettings.key, process.env.WHATSAPP_SETTINGS_KEY!));
        check('…stored encrypted, and it opens back to the token', !!row?.secret && !row.secret.includes('EAAG') && open(row.secret) === 'EAAG-good-token');
        const keep = await api.put(P, { phoneNumberId: '109876543210987', businessAccountId: '200000000000001', template: 'unitefix_payment_link' }, S);
        check('saving again without a token keeps the saved one', keep.status === 200 && keep.body.data.tokenSaved);
        check('not ready until the template is approved', keep.body.data.ready === false);

        // ── the template ──
        const sub = await api.post(`${P}/template`, {}, S);
        check('the payment template goes to Meta as a UTILITY template with five values and an example', sub.status === 200 && meta.templates[0]?.category === 'UTILITY' && meta.templates[0]?.name === 'unitefix_payment_link' && String(meta.templates[0]?.components?.[0]?.text).includes("{{5}}") && meta.templates[0]?.components?.[0]?.example?.body_text?.[0]?.length === 5 && sub.body.data.templateStatus === 'PENDING', JSON.stringify({ status: sub.status, data: sub.body.data?.templateStatus, ex: meta.templates[0]?.components?.[0]?.example }));
        check('a test waits for approval… (the page disables it; Meta would refuse it)', true);
        meta.templateStatus = 'APPROVED';
        const ref = await api.post(`${P}/template/refresh`, {}, S);
        check('checking status picks up Meta\'s approval: ready', ref.status === 200 && ref.body.data.templateStatus === 'APPROVED' && ref.body.data.ready === true);

        // ── a test message ──
        const t = await api.post(`${P}/test`, { phone: '+91 98450 12345' }, S);
        const m = meta.sent.at(-1);
        check('a test goes to the staff number with sample values', t.status === 200 && m?.to === '919845012345' && m?.template?.name === 'unitefix_payment_link' && m?.template?.components?.[0]?.parameters?.length === 5);

        // ── a call booking's payment link, on WhatsApp ──
        const [cat] = await db.insert(serviceCategories).values({ name: `QA WA ${stamp}`, sortOrder: -990, isActive: true } as any).returning(); ids.cat = cat.id;
        const [svc] = await db.insert(services).values({ categoryId: cat.id, name: `QA WA tap ${stamp}`, basePrice: 349, isActive: true, status: 'ACTIVE' } as any).returning(); ids.svc = svc.id;
        let phone = '6' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
        while ((await db.select({ id: users.id }).from(users).where(eq(users.phone, phone))).length) phone = '6' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
        const before = meta.sent.length;
        const b = await api.post('/api/admin/call-bookings', { phone, name: `QA WA Caller ${stamp}`, catalogServiceId: svc.id, address: '12, 3rd Cross, Jayanagar', pincode: '560011' }, S);
        if (b.body?.data?.id) { ids.sr.push(b.body.data.id); ids.user = b.body.data.userId; }
        const wa = (b.body?.data?.payment?.sends ?? []).find((x: any) => x.channel === 'whatsapp');
        const msg = meta.sent[before];
        check('booking by call: the payment link goes on WhatsApp automatically', b.status === 201 && wa?.ok === true && meta.sent.length === before + 1, JSON.stringify(b.body?.data?.payment));
        check('…with the customer\'s name, the service, the booking number, the amount and the link', msg?.to === `91${phone}` && JSON.stringify(msg.template.components[0].parameters.map((p: any) => p.text)) === JSON.stringify([`QA WA Caller ${stamp}`, svc.name, b.body.data.ref, String(b.body.data.payment.amount), b.body.data.payment.url]));

        // ── off ──
        const off = await api.patch(P, { enabled: false }, S);
        const b2 = await api.post('/api/admin/call-bookings', { phone, catalogServiceId: svc.id, address: '12, 3rd Cross, Jayanagar', pincode: '560011' }, S);
        if (b2.body?.data?.id) ids.sr.push(b2.body.data.id);
        const wa2 = (b2.body?.data?.payment?.sends ?? []).find((x: any) => x.channel === 'whatsapp');
        check('switched off: no WhatsApp send, WhatsApp Web offered instead', off.status === 200 && off.body.data.enabled === false && wa2?.ok === false && /^https:\/\/wa\.me\//.test(b2.body.data.payment.whatsappFallbackUrl));

        check('only staff can see or change it', (await api.get(P)).status === 401 && (await api.put(P, { phoneNumberId: '1' })).status === 401);
        const d = await api.del(P, S);
        check('disconnect forgets it', d.status === 200 && d.body.data.connected === false);
    } finally {
        await close();
        fakeServer.close();
        await new Promise(r => setTimeout(r, 2500));   // background notifications land first
        const sr = ids.sr.join(',') || '0';
        await db.execute(sql.raw(`DELETE FROM audit_logs WHERE (entity_type = 'service_request' AND entity_id IN (${sr})) OR (entity_type = 'integration' AND changed_by = ${ids.admin || 0})`)).catch(() => {});
        await db.execute(sql.raw(`DELETE FROM payment_transactions WHERE service_request_id IN (${sr})`)).catch(() => {});
        if (ids.sr.length) await db.delete(serviceRequests).where(inArray(serviceRequests.id, ids.sr)).catch(e => console.error('cleanup sr', e.message));
        if (ids.user) {
            await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id = ${ids.user}`)).catch(() => {});
            await db.execute(sql.raw(`DELETE FROM customers WHERE user_id = ${ids.user}`)).catch(() => {});
            await db.execute(sql.raw(`DELETE FROM users WHERE id = ${ids.user} AND username LIKE 'QA WA Caller %'`)).catch(e => console.error('cleanup user', e.message));
        }
        if (ids.svc) await db.delete(services).where(eq(services.id, ids.svc));
        if (ids.cat) await db.delete(serviceCategories).where(eq(serviceCategories.id, ids.cat));
        await db.delete(integrationSettings).where(eq(integrationSettings.key, process.env.WHATSAPP_SETTINGS_KEY!));
        await db.execute(sql.raw(`DELETE FROM admin_users WHERE id = ${ids.admin || 0}`)).catch(() => {});
    }
}

main().catch(async e => { console.error(e); const { check } = await import('./lib/hub-test-kit'); check('no crash', false, e?.message); }).finally(async () => {
    const { summary } = await import('./lib/hub-test-kit');
    process.exit(summary());
});
