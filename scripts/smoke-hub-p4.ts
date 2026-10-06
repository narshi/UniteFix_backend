/**
 * Partner Hub — phase 4 end to end: territories, partner technicians, rates
 * with guardrails, routing at booking, the partner job queue, SLA escalation,
 * job values held for the partner, cash jobs, release, subcontract invoice.
 *
 *   npm run smoke:hub-p4
 */

import jwt from 'jsonwebtoken';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, gstinFor, tinyPdf, cleanupPartners, db } from './lib/hub-test-kit';
import {
    adminUsers, businessPartners, businessPartnerLedger, employees, users, serviceRequests, serviceCategories, services, serviceablePincodes,
    partnerTerritories, partnerJobEarnings, partnerServiceRates, partnerWallets, walletTransactionsV2, taxDocuments,
} from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';
import { PartnerFieldService } from '../server/services/partner-field.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [];
const bpIds: number[] = [];
const userIds: number[] = [];
const pins: string[] = [];
let categoryId: number | null = null;
let serviceId: number | null = null;

const freshPin = async () => {
    for (;;) {
        const p = `79${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
        const [x] = await db.select().from(serviceablePincodes).where(eq(serviceablePincodes.pincode, p)).limit(1);
        const [y] = await db.select().from(partnerTerritories).where(eq(partnerTerritories.pincode, p)).limit(1);
        if (!x && !y && !pins.includes(p)) { pins.push(p); return p; }
    }
};

async function main() {
    // Bookings must not reach Razorpay from a test: without keys, dev marks the fee paid.
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const staff = (await api.login(sa.username, sa.password))!;

        const fs = await BusinessPartnerService.create({
            legalName: `QA Sirsi Electronics ${stamp}`, displayName: 'Sirsi Electronics', gstin: await gstinFor('29', 'QASRS1234K'), contactPhone: `7${String(Date.now()).slice(-9)}`,
            contactEmail: `qa_p4a_${stamp}@example.test`, verticalCodes: ['computer'], approvedByAdminId: sa.id,
        });
        const fs2 = await BusinessPartnerService.create({
            legalName: `QA Yellapur Care ${stamp}`, contactPhone: `6${String(Date.now()).slice(-9)}`,
            contactEmail: `qa_p4b_${stamp}@example.test`, verticalCodes: ['cctv'], approvedByAdminId: sa.id,
        });
        bpIds.push(fs.id, fs2.id);
        await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka' }).where(inArray(businessPartners.id, [fs.id, fs2.id]));
        const l1 = await PartnerHubService.createOwnerLogin(fs.id, {});
        const l2 = await PartnerHubService.createOwnerLogin(fs2.id, {});
        for (const e of [l1.username, l2.username]) { const [r] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, e)); if (r) adminIds.push(r.id); }
        const t1 = (await api.login(l1.username, l1.temporaryPassword))!;
        const t2 = (await api.login(l2.username, l2.temporaryPassword))!;

        const [cat] = await db.insert(serviceCategories).values({ name: `QA Laptop ${stamp}` }).returning(); categoryId = cat.id;
        const [svc] = await db.insert(services).values({ categoryId: cat.id, name: `QA Laptop service ${stamp}`, basePrice: 800 }).returning(); serviceId = svc.id;

        // ── territory ─────────────────────────────────────────────────────
        const pin = await freshPin(), other = await freshPin();
        const prop = await api.post('/api/hub/field/territories', { pincodes: `${pin}, 12345`, area: 'Sirsi town' }, t1);
        check('a bad pincode in the list is refused', prop.status === 400 && prop.body?.code === 'BAD_PINCODE');
        const prop2 = await api.post('/api/hub/field/territories', { pincodes: [pin], area: 'Sirsi town' }, t1);
        check('the partner proposes a new pincode', prop2.status === 201 && prop2.body?.data?.added === 1);
        const q0 = await api.get(`/api/services/quote?catalogServiceId=${svc.id}&pincode=${pin}`);
        check('until UniteFix approves, nobody serves it', q0.status === 200 && q0.body?.data?.servicedBy === null, JSON.stringify(q0.body).slice(0, 160));
        const terr = await api.get('/api/hub/field/territories', t1);
        const tId = terr.body?.data?.[0]?.id;
        const rev = await api.post('/api/admin/hub/territories/review', { ids: [tId], decision: 'approve' }, staff);
        check('UniteFix approves; a pincode it never served becomes exclusive', rev.status === 200 && rev.body?.data?.done?.includes(pin));
        const [sp] = await db.select().from(serviceablePincodes).where(eq(serviceablePincodes.pincode, pin));
        const [tRow] = await db.select().from(partnerTerritories).where(eq(partnerTerritories.id, tId));
        check('…and the pincode is now serviceable', !!sp?.isActive && tRow.mode === 'exclusive' && tRow.status === 'active');
        await api.post('/api/hub/field/territories', { pincodes: [pin] }, t2);
        const [t2Row] = await db.select().from(partnerTerritories).where(and(eq(partnerTerritories.businessPartnerId, fs2.id), eq(partnerTerritories.pincode, pin)));
        const rev2 = await api.post('/api/admin/hub/territories/review', { ids: [t2Row.id], decision: 'approve', mode: 'exclusive' }, staff);
        check('a second exclusive partner for the same pincode is refused', rev2.body?.data?.conflicts?.includes(pin));
        const rev3 = await api.post('/api/admin/hub/territories/review', { ids: [t2Row.id], decision: 'approve', mode: 'shared' }, staff);
        check('…but it can share it', rev3.body?.data?.done?.includes(pin));
        check('routing prefers the exclusive partner', (await PartnerFieldService.partnerFor(pin))?.bp.id === fs.id);
        await api.post(`/api/hub/field/territories/${tId}/pause`, { reason: 'Diwali' }, t1);
        check('a paused exclusive partner hands the pincode to the sharing one', (await PartnerFieldService.partnerFor(pin))?.bp.id === fs2.id);
        const resume = await api.post(`/api/hub/field/territories/${tId}/resume`, {}, t1);
        check('…and takes it back on resume', resume.status === 200 && (await PartnerFieldService.partnerFor(pin))?.bp.id === fs.id);
        await db.update(partnerTerritories).set({ status: 'withdrawn' }).where(eq(partnerTerritories.id, t2Row.id));

        // ── rates ─────────────────────────────────────────────────────────
        const high = await api.put(`/api/hub/field/rates/${svc.id}`, { price: 1200 }, t1);
        check('a rate outside ±25% of the national price is refused, with the band', high.status === 400 && high.body?.code === 'OUT_OF_BAND' && /600.*1000/.test(high.body?.message ?? ''));
        const ok = await api.put(`/api/hub/field/rates/${svc.id}`, { price: 900 }, t1);
        check('a new partner\'s rate waits for review', ok.status === 200 && ok.body?.data?.status === 'pending_review');
        const pend = await api.get('/api/admin/hub/rates/pending', staff);
        const mineP = pend.body?.data?.find((r: any) => r.id === ok.body.data.id);
        check('staff see it in the review queue', !!mineP && mineP.nationalPrice === 800 && mineP.price === 900);
        await api.post('/api/admin/hub/rates/review', { ids: [ok.body.data.id], approve: true }, staff);
        const q1 = await api.get(`/api/services/quote?catalogServiceId=${svc.id}&pincode=${pin}`);
        check('approved rates still give 24 h notice — the customer sees the national price today', q1.body?.data?.unitPrice === 800 && q1.body?.data?.servicedBy?.name === 'Sirsi Electronics');
        await db.update(partnerServiceRates).set({ effectiveFrom: new Date(Date.now() - 60_000) }).where(eq(partnerServiceRates.id, ok.body.data.id));
        const q2 = await api.get(`/api/services/quote?catalogServiceId=${svc.id}&pincode=${pin}`);
        check('once effective, the quote shows the partner\'s price and name', q2.body?.data?.unitPrice === 900 && /Sirsi Electronics, a UniteFix partner/.test(q2.body?.data?.servicedBy?.note ?? ''));

        // ── technicians ───────────────────────────────────────────────────
        const techPhone = `9${String(Date.now()).slice(-9)}`;
        const add = await api.post('/api/hub/field/technicians', { fullName: 'QA Ravi Naik', phone: techPhone, services: ['Laptop'] }, t1);
        check('the partner adds a technician', add.status === 201, add.body?.message);
        const techId = add.body?.data?.id;
        const [techEmp] = await db.select().from(employees).where(eq(employees.id, techId));
        userIds.push(techEmp.userId);
        check('…as an employee managed by the partner, inactive until verified', techEmp.managedByPartnerId === fs.id && techEmp.isActive === false && techEmp.documentVerificationStatus === 'pending');
        const dupT = await api.post('/api/hub/field/technicians', { fullName: 'Again', phone: techPhone }, t1);
        check('the same mobile number twice is refused', dupT.status === 409);
        const early = await api.patch(`/api/hub/field/technicians/${techId}`, { isActive: true }, t1);
        check('a technician cannot be switched on before UniteFix verifies them', early.status === 409 && early.body?.code === 'NOT_VERIFIED');
        const fd = new FormData(); fd.append('file', tinyPdf('aadhaar'), 'aadhaar.pdf');
        const doc = await api.upload(`/api/hub/field/technicians/${techId}/documents/aadhaar`, fd, t1);
        check('the partner uploads the technician\'s ID', doc.status === 201);
        const foreignTech = await api.patch(`/api/hub/field/technicians/${techId}`, { isActive: false }, t2);
        check('another partner cannot touch them', foreignTech.status === 404 || foreignTech.status === 403);
        await db.update(employees).set({ documentVerificationStatus: 'verified' as any }).where(eq(employees.id, techId));
        const on = await api.patch(`/api/hub/field/technicians/${techId}`, { isActive: true }, t1);
        check('after verification the partner switches them on', on.status === 200);

        // ── bookings ──────────────────────────────────────────────────────
        const [cust] = await db.insert(users).values({ phone: `8${String(Date.now()).slice(-9)}`, username: 'QA Customer', role: 'user', homeAddress: 'Sirsi', pinCode: pin } as any).returning();
        userIds.push(cust.id);
        const ct = jwt.sign({ userId: cust.id, role: 'user' }, SECRET, { expiresIn: '1h' });
        const book = (extra: Record<string, unknown>) => api.post('/api/services/create', { serviceType: 'Laptop', description: 'QA laptop not booting', address: `Main road, Sirsi ${pin}`, pinCode: pin, catalogServiceId: svc.id, ...extra }, ct);

        const b1 = await book({ quotedUnitPrice: 900 });
        const [sr1] = await db.select().from(serviceRequests).where(eq(serviceRequests.userId, cust.id));
        const snap1: any = sr1?.pricingSnapshot;
        check('a booking in the territory is routed to the partner', b1.status === 200 || b1.status === 201 ? sr1?.dispatchPartnerId === fs.id && sr1.dispatchMode === 'exclusive' : false, `${b1.status} ${b1.body?.message ?? ''}`);
        check('…at the partner\'s price the app showed, with the partner\'s fee %', snap1?.basePrice === 900 && snap1?.platformFeePercent === 15 && snap1?.payeeType === 'partner' && snap1?.servicedBy === 'Sirsi Electronics', JSON.stringify(snap1 && { b: snap1.basePrice, f: snap1.platformFeePercent }));
        check('…with an assign-by time', !!sr1?.slaAssignBy && new Date(sr1.slaAssignBy).getTime() > Date.now());

        await book({});
        const [sr2] = await db.select().from(serviceRequests).where(eq(serviceRequests.userId, cust.id)).orderBy(sql`${serviceRequests.id} desc`).limit(1);
        check('an app that showed the national price gets the national price (still the partner\'s job)', (sr2.pricingSnapshot as any)?.basePrice === 800 && sr2.dispatchPartnerId === fs.id);

        await api.post('/api/services/create', { serviceType: 'Laptop', description: 'QA elsewhere', address: `Somewhere ${other}`, pinCode: other, catalogServiceId: svc.id }, ct);
        const [sr3] = await db.select().from(serviceRequests).where(eq(serviceRequests.userId, cust.id)).orderBy(sql`${serviceRequests.id} desc`).limit(1);
        check('outside any territory the booking is UniteFix\'s, as before', sr3.dispatchPartnerId === null && (sr3.pricingSnapshot as any)?.basePrice === 800 && sr3.pincode === other);

        // ── queues ────────────────────────────────────────────────────────
        const aq = await api.get('/api/admin/assignment-queue', staff);
        const aqIds = (aq.body?.queue ?? []).map((r: any) => r.id);
        check('UniteFix\'s queue does not show the partner\'s jobs', aq.status === 200 && !aqIds.includes(sr1.id) && !aqIds.includes(sr2.id) && aqIds.includes(sr3.id), `${aq.status}`);
        check('…nor offer the partner\'s technicians', !(aq.body?.employees ?? []).some((e: any) => e.id === techId));
        const pq = await api.get('/api/hub/field/jobs?view=queue', t1);
        check('the partner\'s queue has both jobs, with the customer\'s details', pq.status === 200 && pq.body?.data?.length === 2 && !!pq.body.data[0].customerPhone);
        const pq2 = await api.get('/api/hub/field/jobs?view=queue', t2);
        check('another partner sees none of them', (pq2.body?.data ?? []).length === 0);
        const asg = await api.post(`/api/hub/field/jobs/${sr1.id}/assign`, { employeeId: techId }, t1);
        check('the partner assigns its technician', asg.status === 200, asg.body?.message);
        const [sr1b] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, sr1.id));
        check('…the booking is assigned to them', sr1b.status === 'assigned' && sr1b.providerId === techId);
        const steal = await api.post(`/api/hub/field/jobs/${sr3.id}/assign`, { employeeId: techId }, t1);
        check('a partner cannot take a job outside its queue', steal.status === 404);

        // SLA: sr2 misses its assign-by time
        await db.update(serviceRequests).set({ slaAssignBy: new Date(Date.now() - 60_000) }).where(eq(serviceRequests.id, sr2.id));
        const pqOver = await api.get('/api/hub/field/jobs?view=queue', t1);
        check('the partner sees it as overdue', pqOver.body?.data?.find((j: any) => j.id === sr2.id)?.overdue === true);
        await PartnerFieldService.escalateOverdue();
        const aq2 = await api.get('/api/admin/assignment-queue', staff);
        const esc = (aq2.body?.queue ?? []).find((r: any) => r.id === sr2.id);
        check('past its assign-by time the job escalates to UniteFix\'s queue', !!esc && esc.escalatedFromPartner === true);

        // ── money: online job ─────────────────────────────────────────────
        const { storage } = await import('../server/storage');
        await db.update(serviceRequests).set({ status: 'in_progress' as any }).where(eq(serviceRequests.id, sr1.id));
        await storage.updateServiceRequestStatus(sr1.id, 'completed');
        const [earn1] = await db.select().from(partnerJobEarnings).where(eq(partnerJobEarnings.serviceRequestId, sr1.id));
        check('completion holds the job\'s value for the partner', !!earn1 && earn1.status === 'held' && earn1.amountPaise === Math.round(snap1.technicianEarning * 100), `${earn1?.amountPaise} vs ${snap1.technicianEarning}`);
        const tw = await db.select().from(walletTransactionsV2).where(eq(walletTransactionsV2.serviceRequestId, sr1.id));
        const pw = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, techId));
        check('…and nothing goes to the technician\'s UniteFix wallet', tw.length === 0 && pw.length === 0);
        await storage.updateServiceRequestStatus(sr1.id, 'completed');
        check('completing twice holds once', (await db.select().from(partnerJobEarnings).where(eq(partnerJobEarnings.serviceRequestId, sr1.id))).length === 1);

        // ── money: cash job ───────────────────────────────────────────────
        await db.update(serviceRequests).set({ providerId: techId, status: 'pending_payment' as any, escalatedAt: null }).where(eq(serviceRequests.id, sr2.id));
        const techTok = jwt.sign({ userId: techEmp.userId, role: 'serviceman' }, SECRET, { expiresIn: '1h' });
        const snap2: any = sr2.pricingSnapshot;
        const cash = await api.post(`/api/bookings/${sr2.id}/cash-collected`, { amountCollected: snap2.finalTotal }, techTok);
        check('the technician records cash collected', cash.status === 200, cash.body?.message);
        const balAfterCash = await BusinessPartnerService.balancePaise(fs.id);
        const [cashRow] = await db.select().from(businessPartnerLedger).where(and(eq(businessPartnerLedger.businessPartnerId, fs.id), eq(businessPartnerLedger.entryType, 'cash_collected' as any)));
        const [earn2] = await db.select().from(partnerJobEarnings).where(eq(partnerJobEarnings.serviceRequestId, sr2.id));
        const debit2 = Math.round((snap2.platformFee + snap2.cgst + snap2.sgst) * 100);
        check('cash job: partner is charged the cash, and the value is held for it', !!cashRow && cashRow.amountPaise === Math.round(snap2.technicianEarning * 100) + debit2 && earn2?.amountPaise === Math.round(snap2.technicianEarning * 100), JSON.stringify({ cash: cashRow?.amountPaise, earn: earn2?.amountPaise, debit2 }));

        // ── release and settlement ────────────────────────────────────────
        await db.update(partnerJobEarnings).set({ releaseAt: new Date(Date.now() - 1000) }).where(inArray(partnerJobEarnings.serviceRequestId, [sr1.id, sr2.id]));
        const released = await PartnerFieldService.releaseDue();
        check('after the hold, job values are released to the partner ledger', released >= 2);
        const bal = await BusinessPartnerService.balancePaise(fs.id);
        check('net: UniteFix owes the online job\'s value, less its share of the cash job', bal === balAfterCash - earn1.amountPaise - earn2.amountPaise && bal === -(earn1.amountPaise - debit2), `${bal} vs ${-(earn1.amountPaise - debit2)}`);
        const work = await api.get('/api/admin/hub/settlements/worklist', staff);
        const w = work.body?.data?.find((x: any) => x.businessPartnerId === fs.id);
        check('the partner appears on the settlement worklist with that payout', !!w && Math.round(w.payout * 100) === -bal, JSON.stringify(w));

        // ── subcontract invoice ───────────────────────────────────────────
        const month = new Date().toISOString().slice(0, 7);
        const run = await api.post('/api/admin/hub/subcontract-invoices/run', { month }, staff);
        const [inv] = await db.select().from(taxDocuments).where(and(eq(taxDocuments.issuerPartnerId, fs.id), eq(taxDocuments.purpose, 'subcontract')));
        const value = earn1.amountPaise + earn2.amountPaise;
        check('the partner\'s monthly invoice to UniteFix covers every job', run.status === 200 && !!inv && inv.taxablePaise === value && inv.docKind === 'tax_invoice' && (inv.recipient as any)?.name !== undefined, `${inv?.taxablePaise} vs ${value}`);
        check('…with GST, which UniteFix pays on top', inv.cgstPaise + inv.sgstPaise === Math.round(value * 0.18) && (await BusinessPartnerService.balancePaise(fs.id)) === bal - (inv.cgstPaise + inv.sgstPaise));
        const run2 = await api.post('/api/admin/hub/subcontract-invoices/run', { month }, staff);
        check('the month is invoiced once', (run2.body?.data?.issued ?? []).length === 0);
        const earnApi = await api.get('/api/hub/field/earnings', t1);
        check('the partner sees its job values and the invoice', earnApi.status === 200 && earnApi.body?.data?.jobs?.length === 2 && earnApi.body?.data?.invoices?.length === 1);

        // ── technician app, roles, home ───────────────────────────────────
        const prof = await api.get('/api/partner/profile', techTok);
        check('the technician app knows who employs them', prof.status === 200 && prof.body?.data?.employer?.name === 'Sirsi Electronics', JSON.stringify(prof.body).slice(0, 200));
        const invd = await api.post('/api/hub/team', { name: 'QA Dispatcher', email: `qa_p4d_${stamp}@example.test`, role: 'dispatcher' }, t1);
        const [dRow] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, `qa_p4d_${stamp}@example.test`)); if (dRow) adminIds.push(dRow.id);
        const disp = (await api.login(invd.body.data.username, invd.body.data.temporaryPassword))!;
        check('a dispatcher sees the job queue', (await api.get('/api/hub/field/jobs', disp)).status === 200);
        check('…but cannot change prices', (await api.put(`/api/hub/field/rates/${svc.id}`, { price: 850 }, disp)).status === 403);
        const noField = await api.get('/api/hub/field/jobs', (await api.login(l2.username, l2.temporaryPassword))!);
        check('a partner without the field module is turned away (cctv has it: allowed)', noField.status === 200);
        const home = await api.get('/api/hub/summary', t1);
        check('home shows jobs to assign', JSON.stringify(home.body?.data ?? {}).includes('Jobs to assign'));
    } finally {
        await cleanup();
        await close();
    }
    process.exit(summary());
}

async function cleanup() {
    try {
        const srs = userIds.length ? await db.select({ id: serviceRequests.id }).from(serviceRequests).where(inArray(serviceRequests.userId, userIds)) : [];
        const srIds = srs.map(s => s.id);
        const ids = srIds.join(',') || '0';
        const uids = userIds.join(',') || '0';
        await cleanupPartners(bpIds, adminIds, [
            `DELETE FROM partner_job_earnings WHERE service_request_id IN (${ids})`,
            `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${ids})`,
            `DELETE FROM invoices WHERE service_request_id IN (${ids})`,
            `DELETE FROM payment_transactions WHERE service_request_id IN (${ids})`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM service_requests WHERE id IN (${ids})`,
            `DELETE FROM partner_service_rates WHERE business_partner_id IN (${bpIds.join(',') || 0})`,
            `DELETE FROM partner_territories WHERE business_partner_id IN (${bpIds.join(',') || 0})`,
            `DELETE FROM employees WHERE user_id IN (${uids})`,
            `DELETE FROM refresh_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM users WHERE id IN (${uids})`,
            `DELETE FROM services WHERE id = ${serviceId ?? 0}`,
            `DELETE FROM service_categories WHERE id = ${categoryId ?? 0}`,
            `DELETE FROM serviceable_pincodes WHERE pincode IN (${pins.map(p => `'${p}'`).join(',') || "''"})`,
        ]);
    } catch (e: any) { console.error('cleanup failed:', e.message); }
}

main().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
