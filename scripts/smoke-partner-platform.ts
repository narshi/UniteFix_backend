/**
 * Partner platform end to end: identity checks through Cashfree Secure ID
 * (stubbed — no real call leaves this process) and by hand, auto-approval of
 * food sellers, name-mismatch and expiry handling, payout settings per
 * partner, requests (paid automatically within the limit, queued above it),
 * staff "pay now", hold, and the payout schedule.
 *
 *   npx tsx scripts/smoke-partner-platform.ts
 */

// Never touch real Cashfree from a test: sandbox, dummy keys, and every call stubbed below.
process.env.CASHFREE_ENVIRONMENT = 'TEST';
process.env.CASHFREE_VERIFICATION_CLIENT_ID = 'qa-verify-id';
process.env.CASHFREE_VERIFICATION_CLIENT_SECRET = 'qa-verify-secret';
process.env.CASHFREE_PAYOUTS_CLIENT_ID = 'qa-payout-id';
process.env.CASHFREE_PAYOUTS_CLIENT_SECRET = 'qa-payout-secret';

import { eq, and, desc } from 'drizzle-orm';
import { check, summary, bootServer, client, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { businessPartners, partnerDocuments, partnerAgreements, adminUsers, partnerVerificationChecks, settlementRuns, partnerPayoutRequests } from '../shared/schema';
import { agreementsFor, docsFor } from '../shared/hub';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';
import { PartnerPayouts } from '../server/services/partner-payouts.service';
import { CashfreeService } from '../server/services/cashfree.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [], bpIds: number[] = [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Cashfree stubs ─────────────────────────────────────────────────────────
const calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? input);
    if (!url.includes('cashfree.com/verification')) return realFetch(input, init);
    const path = url.split('/verification')[1];
    const body = init?.body ? JSON.parse(init.body) : {};
    const headers = init?.headers ?? {};
    calls.push(`${path}|${headers['x-api-version'] ?? ''}`);
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (path === '/pan') {
        if (body.pan === 'QAERR1234Z') return json(503, { message: 'down' });
        const stranger = body.pan === 'QAMIS1234Z';
        return json(200, { reference_id: 1001, pan: body.pan, valid: true, registered_name: stranger ? 'RAMESH KUMAR SHARMA' : body.name, name_match_result: stranger ? 'NO_MATCH' : 'DIRECT_MATCH', type: 'Individual' });
    }
    if (path === '/bank-account/sync') {
        const stranger = body.name?.includes('Mismatch');
        return json(200, { reference_id: 2002, account_status: 'VALID', account_status_code: 'ACCOUNT_IS_VALID', name_at_bank: stranger ? 'SOMEONE ELSE' : body.name });
    }
    if (path === '/driving-license') return json(200, { reference_id: 3003, status: 'VALID', dl_number: body.dl_number, details_of_driving_licence: { name: 'QA DRIVER', date_of_expiry: '2024-01-31' } });
    if (path === '/vehicle-rc') return json(200, { reference_id: 4004, status: 'VALID', reg_no: body.vehicle_number, owner: 'QA OWNER', rc_expiry_date: '2031-06-30', vehicle_insurance_upto: '2025-02-28' });
    return json(404, { message: 'not stubbed' });
}) as any;
let payouts = 0;
(CashfreeService as any).addBeneficiary = async () => 'BENE_QA';
(CashfreeService as any).createPayout = async (_bene: string, amount: number, transferId: string) => { payouts++; return { utr: `UTRQA${payouts}${stamp.slice(-4)}`, referenceId: transferId, amount }; };

async function partner(label: string, verticals: string[], opts: { pan?: string; bankName?: string } = {}) {
    const bp = await BusinessPartnerService.create({ legalName: `QA ${label} ${stamp}`, displayName: label, contactPhone: `9${String(Date.now()).slice(-8)}${bpIds.length}`, contactEmail: `qa-${label.replace(/\W/g, '').toLowerCase()}-${stamp}@example.test`, verticalCodes: verticals });
    bpIds.push(bp.id);
    await db.update(businessPartners).set({ pan: opts.pan ?? 'QAAMP1234K', panStatus: 'format_ok', beneficiaryName: opts.bankName ?? `QA ${label} ${stamp}`, bankAccountNumber: `50100${String(Date.now()).slice(-7)}`, bankIfsc: 'HDFC0001234', bankStatus: 'unverified' }).where(eq(businessPartners.id, bp.id));
    for (const d of docsFor(verticals, false).filter(x => x.required)) {
        await db.insert(partnerDocuments).values({ businessPartnerId: bp.id, docType: d.code, fileUrl: 'https://example.test/doc.pdf', fileName: `${d.code}.pdf`, expiresAt: d.hasExpiry ? '2028-03-31' : null });
    }
    for (const a of agreementsFor(verticals)) await db.insert(partnerAgreements).values({ businessPartnerId: bp.id, agreementCode: a.code, version: a.version });
    return bp;
}
const latest = async (bpId: number, c: string) => (await db.select().from(partnerVerificationChecks).where(and(eq(partnerVerificationChecks.businessPartnerId, bpId), eq(partnerVerificationChecks.check, c))).orderBy(desc(partnerVerificationChecks.id)).limit(1))[0];
const bpRow = async (id: number) => (await db.select().from(businessPartners).where(eq(businessPartners.id, id)))[0];

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const staff = (await api.login(sa.username, sa.password))!;

        // ── A food seller: Cashfree checks on submit, FSSAI by hand, auto-approved ──
        const food = await partner('Amma Pickles', ['food']);
        let s = (await api.get(`/api/admin/hub/partners/${food.id}/checks`, staff)).body?.data;
        check('a food seller needs PAN, bank and FSSAI checked (no GSTIN given)', s?.items?.filter((i: any) => i.required).map((i: any) => i.code).join() === 'pan,bank,fssai', JSON.stringify(s?.items?.map((i: any) => i.code)));
        check('…FSSAI is by hand, the others automatic', s.items.find((i: any) => i.code === 'fssai').automatic === false && s.items.find((i: any) => i.code === 'pan').automatic === true);
        await PartnerHubService.submit(food.id);
        for (let i = 0; i < 30 && !(await latest(food.id, 'bank')); i++) await sleep(150);
        const pan = await latest(food.id, 'pan'), bank = await latest(food.id, 'bank');
        check('submitting runs the Cashfree checks: PAN verified, name matches', pan?.status === 'verified' && pan.method === 'cashfree' && pan.nameMatch === 'match');
        check('…bank verified by penny drop; the account is marked verified', bank?.status === 'verified' && (await bpRow(food.id)).bankStatus === 'verified');
        check('every Cashfree call carries x-api-version 2024-12-01', calls.length >= 2 && calls.every(c => c.endsWith('|2024-12-01')), calls.join(' '));
        check('…and the PAN is stored masked', /^•+\d{3}[A-Z]$/.test(pan.subject ?? ''), pan?.subject ?? '');
        check('not approved yet: FSSAI is still to check', (await bpRow(food.id)).status === 'pending_approval');
        const [fssaiDoc] = await db.select().from(partnerDocuments).where(and(eq(partnerDocuments.businessPartnerId, food.id), eq(partnerDocuments.docType, 'fssai_licence')));
        let r = await api.post(`/api/admin/hub/partners/${food.id}/documents/${fssaiDoc.id}/review`, { status: 'verified', note: 'FSSAI 21226008000123 matched on FoSCoS' }, staff);
        const fs = await latest(food.id, 'fssai');
        check('verifying the FSSAI certificate records the FSSAI check by hand', r.status === 200 && fs?.status === 'verified' && fs.method === 'manual' && fs.validUntil === '2028-03-31', r.body?.message);
        const fb = await bpRow(food.id);
        check('…and the food seller is auto-approved: every check passed', fb.status === 'active' && !!fb.autoApprovedAt && !fb.approvedByAdminId);

        // ── A service partner with every check passed is NOT auto-approved ──
        const svc = await partner('Sirsi Computers', ['computer']);
        await PartnerHubService.submit(svc.id);
        for (let i = 0; i < 30 && !(await latest(svc.id, 'bank')); i++) await sleep(150);
        check('a computer-service partner with every check passed still waits for staff', (await latest(svc.id, 'pan'))?.status === 'verified' && (await bpRow(svc.id)).status === 'pending_approval');

        // ── Names that do not match go to staff, never pass ──
        const odd = await partner('Odd Foods', ['food'], { pan: 'QAMIS1234Z', bankName: 'Mismatch Holder' });
        r = await api.post(`/api/admin/hub/partners/${odd.id}/checks/run`, {}, staff);
        const op = await latest(odd.id, 'pan'), ob = await latest(odd.id, 'bank');
        check('a PAN in someone else\'s name needs review (not verified)', op?.status === 'needs_review' && op.nameFound === 'RAMESH KUMAR SHARMA' && (await bpRow(odd.id)).panStatus === 'mismatch');
        check('…a bank account in someone else\'s name is NOT marked verified (payouts go there)', ob?.status === 'needs_review' && (await bpRow(odd.id)).bankStatus !== 'verified');

        // ── Cashfree down / not set up; licence and RC ──
        await db.update(businessPartners).set({ pan: 'QAERR1234Z' }).where(eq(businessPartners.id, odd.id));
        const before = (await db.select().from(partnerVerificationChecks).where(eq(partnerVerificationChecks.businessPartnerId, odd.id))).length;
        r = await api.post(`/api/admin/hub/partners/${odd.id}/checks/run`, { check: 'pan' }, staff);
        const after = (await db.select().from(partnerVerificationChecks).where(eq(partnerVerificationChecks.businessPartnerId, odd.id))).length;
        check('Cashfree down: says so, records nothing (no false "failed")', r.status === 502 && after === before, `${r.status}`);
        delete process.env.CASHFREE_VERIFICATION_CLIENT_ID;
        r = await api.post(`/api/admin/hub/partners/${odd.id}/checks/run`, { check: 'pan' }, staff);
        process.env.CASHFREE_VERIFICATION_CLIENT_ID = 'qa-verify-id';
        check('no Cashfree keys: recorded as "check by hand"', r.status === 200 && (await latest(odd.id, 'pan'))?.status === 'manual_required');
        r = await api.post(`/api/admin/hub/partners/${odd.id}/checks/manual`, { check: 'pan', status: 'verified', note: 'PAN card matched the proprietor, Aadhaar seen' }, staff);
        check('staff record PAN verified by hand, with a note', r.status === 200 && (await latest(odd.id, 'pan'))?.method === 'manual' && (await bpRow(odd.id)).panStatus === 'verified');
        r = await api.post(`/api/admin/hub/partners/${odd.id}/checks/manual`, { check: 'pan', status: 'verified', note: 'ok' }, staff);
        check('…a note is required', r.status === 400);
        r = await api.post(`/api/admin/hub/partners/${odd.id}/checks/run`, { check: 'fssai' }, staff);
        check('FSSAI cannot be "run" (no lookup): staff are told to check by hand', r.status === 400 && r.body?.code === 'MANUAL_ONLY');
        r = await api.post(`/api/admin/hub/partners/${odd.id}/checks/run`, { check: 'driving_licence', dlNumber: 'KA01 20100000001', dob: '1990-05-01' }, staff);
        check('an expired driving licence fails, with the date', (await latest(odd.id, 'driving_licence'))?.status === 'failed' && /Expired on 2024-01-31/.test(r.body?.message ?? ''), r.body?.message);
        r = await api.post(`/api/admin/hub/partners/${odd.id}/checks/run`, { check: 'vehicle_rc', rcNumber: 'KA31 AB 1234' }, staff);
        const rc = await latest(odd.id, 'vehicle_rc');
        check('a valid RC with lapsed insurance needs review', rc?.status === 'needs_review' && rc.validUntil === '2031-06-30' && /Insurance expired/.test(rc.note ?? ''));

        // ── Payouts: per-partner settings, requests, pay now, hold, schedule ──
        const lg = await PartnerHubService.createOwnerLogin(food.id, {});
        const [lu] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, lg.username)); if (lu) adminIds.push(lu.id);
        const pt = (await api.login(lg.username, lg.temporaryPassword))!;
        r = await api.post('/api/hub/payouts/request', {}, pt);
        check('nothing owed: a request is refused politely', r.status === 409 && r.body?.code === 'NOTHING_DUE');
        await BusinessPartnerService.appendLedger(db as any, { businessPartnerId: food.id, entryType: 'marketplace_sale' as any, amountPaise: -50000, description: 'QA sale' });
        r = await api.put(`/api/admin/hub/partners/${food.id}/payout-settings`, { schedule: 'on_request', autoLimitRupees: 1000, minimumRupees: 100, onHold: false }, staff);
        check('staff set this partner to "paid when asked", automatic up to ₹1,000', r.status === 200 && r.body?.data?.schedule === 'on_request');
        let ov = (await api.get('/api/hub/payouts', pt)).body?.data;
        check('the partner sees ₹500 owed and their schedule', ov?.owed === 500 && ov.settings.scheduleLabel === 'When you ask' && ov.bankReady);
        r = await api.post('/api/hub/payouts/request', { note: 'Need it for stock' }, pt);
        check('a request within the limit is paid at once through Cashfree', r.status === 201 && r.body?.data?.paid === true && payouts === 1, JSON.stringify(r.body));
        ov = (await api.get('/api/hub/payouts', pt)).body?.data;
        check('…owed is now zero; the payout shows with its UTR', ov.owed === 0 && ov.runs[0]?.status === 'paid' && ov.runs[0].origin === 'request' && /^UTRQA/.test(ov.runs[0].reference ?? ''));

        await BusinessPartnerService.appendLedger(db as any, { businessPartnerId: food.id, entryType: 'marketplace_sale' as any, amountPaise: -300000, description: 'QA sale 2' });
        r = await api.post('/api/hub/payouts/request', {}, pt);
        check('above the limit: the request waits for staff', r.status === 201 && r.body?.data?.paid === false && payouts === 1);
        r = await api.post('/api/hub/payouts/request', {}, pt);
        check('…one open request at a time', r.status === 409 && r.body?.code === 'OPEN_REQUEST');
        let q = (await api.get('/api/admin/hub/payouts/queue', staff)).body?.data ?? [];
        check('staff see it in the approval queue with the amount', q.some((i: any) => i.kind === 'request' && i.businessPartnerId === food.id && i.owed === 3000));
        r = await api.post(`/api/admin/hub/partners/${food.id}/payouts/pay-now`, { method: 'cashfree' }, staff);
        const [req] = await db.select().from(partnerPayoutRequests).where(eq(partnerPayoutRequests.businessPartnerId, food.id)).orderBy(desc(partnerPayoutRequests.id)).limit(1);
        check('staff "Pay now" pays it and closes the request', r.status === 200 && payouts === 2 && req.status === 'paid' && !!req.settlementRunId);
        r = await api.put(`/api/admin/hub/partners/${food.id}/payout-settings`, { schedule: 'on_request', autoLimitRupees: 1000, minimumRupees: 100, onHold: true }, staff);
        check('a hold needs a reason', r.status === 400);
        await api.put(`/api/admin/hub/partners/${food.id}/payout-settings`, { schedule: 'on_request', autoLimitRupees: 1000, minimumRupees: 100, onHold: true, holdReason: 'Customer complaint under review' }, staff);
        await BusinessPartnerService.appendLedger(db as any, { businessPartnerId: food.id, entryType: 'marketplace_sale' as any, amountPaise: -20000, description: 'QA sale 3' });
        r = await api.post('/api/hub/payouts/request', {}, pt);
        check('on hold: the partner is told why', r.status === 409 && /Customer complaint/.test(r.body?.message ?? ''));

        // Scheduled: weekly, no automatic limit → drafted on Monday, waits; pay now reuses the draft.
        await BusinessPartnerService.approve(svc.id, sa.id);
        await api.put(`/api/admin/hub/partners/${svc.id}/payout-settings`, { schedule: 'weekly', autoLimitRupees: null, minimumRupees: 100, onHold: false }, staff);
        await BusinessPartnerService.appendLedger(db as any, { businessPartnerId: svc.id, entryType: 'service_value' as any, amountPaise: -80000, description: 'QA jobs' });
        const monday = new Date('2026-11-30T05:00:00Z'), tuesday = new Date('2026-12-01T05:00:00Z');
        let sc = await PartnerPayouts.runScheduled(tuesday);
        const runsTue = await db.select().from(settlementRuns).where(eq(settlementRuns.businessPartnerId, svc.id));
        check('not due on a Tuesday for a weekly partner', runsTue.length === 0);
        sc = await PartnerPayouts.runScheduled(monday);
        const [draft] = await db.select().from(settlementRuns).where(eq(settlementRuns.businessPartnerId, svc.id));
        check('on Monday: drafted, waiting for approval (no automatic limit)', draft?.status === 'draft' && draft.origin === 'schedule' && draft.payoutPaise === 80000 && payouts === 2, JSON.stringify(sc));
        await PartnerPayouts.runScheduled(monday);
        check('…running the schedule again the same day drafts nothing more', (await db.select().from(settlementRuns).where(eq(settlementRuns.businessPartnerId, svc.id))).length === 1);
        r = await api.post(`/api/admin/hub/partners/${svc.id}/payouts/pay-now`, { method: 'cashfree' }, staff);
        const [paidDraft] = await db.select().from(settlementRuns).where(eq(settlementRuns.id, draft.id));
        check('approving pays that same draft', r.status === 200 && paidDraft.status === 'paid' && payouts === 3);
        await api.put(`/api/admin/hub/partners/${svc.id}/payout-settings`, { schedule: 'weekly', autoLimitRupees: 5000, minimumRupees: 100, onHold: false }, staff);
        await BusinessPartnerService.appendLedger(db as any, { businessPartnerId: svc.id, entryType: 'service_value' as any, amountPaise: -120000, description: 'QA jobs 2' });
        await PartnerPayouts.runScheduled(new Date('2026-12-07T05:00:00Z'));
        const last = (await db.select().from(settlementRuns).where(eq(settlementRuns.businessPartnerId, svc.id)).orderBy(desc(settlementRuns.id)))[0];
        check('within the automatic limit, the schedule pays by itself', last.status === 'paid' && last.origin === 'schedule' && payouts === 4);
    } finally {
        globalThis.fetch = realFetch;
        await cleanupPartners(bpIds, adminIds, [
            `DELETE FROM partner_payout_requests WHERE business_partner_id IN (${bpIds.join(',') || 0})`,
            `DELETE FROM partner_verification_checks WHERE business_partner_id IN (${bpIds.join(',') || 0})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(async e => { console.error(e); await cleanupPartners(bpIds, adminIds, [`DELETE FROM partner_payout_requests WHERE business_partner_id IN (${bpIds.join(',') || 0})`, `DELETE FROM partner_verification_checks WHERE business_partner_id IN (${bpIds.join(',') || 0})`]).catch(() => null); process.exit(1); });
