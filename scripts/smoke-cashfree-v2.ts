/**
 * Cashfree Payouts v2 — beneficiaries, transfers and status — against a local
 * stand-in that behaves like Cashfree v2 (real HTTP statuses, its id rules,
 * its duplicate errors). No call leaves this box and no money moves.
 *
 * Ends with a whole expert withdrawal through the real admin routes:
 * approve → Cashfree transfer → "Sync with Cashfree" → completed; and a
 * failed transfer that puts the money back in the wallet.
 *
 *   npm run smoke:cashfree-v2
 */

import http from 'http';
import crypto from 'crypto';
import type { AddressInfo } from 'net';
import { eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { users, employees, partnerWallets, withdrawalRequests } from '../shared/schema';
import { CashfreeService } from '../server/services/cashfree.service';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [];

// ── the stand-in ────────────────────────────────────────────────────────────
type Bene = { beneficiary_id: string; beneficiary_name: string; beneficiary_instrument_details: any };
const benes = new Map<string, Bene>();
const transfers = new Map<string, any>();
const log: Array<{ method: string; path: string; headers: http.IncomingHttpHeaders; body: any }> = [];
let transferFault: null | '500_recorded' | '500_lost' | '500_and_status_down' | '422' = null;
let statusDown = false;
let dupWording: null | 'plain' = null; // Cashfree's other wording for "this id exists"
let beneLookupDown = false;

const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
        const url = new URL(req.url!, 'http://x');
        const body = raw ? JSON.parse(raw) : null;
        log.push({ method: req.method!, path: url.pathname, headers: req.headers, body });
        const send = (s: number, d: unknown) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
        if (req.headers['x-api-version'] !== '2024-01-01' || !req.headers['x-client-id'] || !req.headers['x-client-secret']) return send(401, { type: 'authentication_error', code: 'authentication_failed', message: 'missing headers' });

        if (url.pathname === '/payout/beneficiary' && req.method === 'POST') {
            const id = body.beneficiary_id;
            if (!/^[A-Za-z0-9]{1,50}$/.test(id)) return send(400, { type: 'invalid_request_error', code: 'beneficiary_id_invalid', message: 'beneficiary_id : invalid' });
            if (benes.has(id)) return dupWording === 'plain'
                ? send(409, { type: 'invalid_request_error', code: 'beneficiary_already_exists', message: 'beneficiary_id already exists' })
                : send(409, { type: 'invalid_request_error', code: 'beneficiary_id_already_exists', message: 'Beneficiary already exists with the given beneficiary_id' });
            const i = body.beneficiary_instrument_details ?? {};
            for (const b of benes.values()) {
                const j = b.beneficiary_instrument_details;
                if (i.bank_account_number && j.bank_account_number === i.bank_account_number && j.bank_ifsc === i.bank_ifsc) return send(409, { type: 'invalid_request_error', code: 'beneficiary_already_exists', message: 'Beneficiary already exists with the given beneficiary_bank_account_number and beneficiary_ifsc' });
            }
            benes.set(id, { beneficiary_id: id, beneficiary_name: body.beneficiary_name, beneficiary_instrument_details: i });
            return send(201, { ...benes.get(id), beneficiary_status: 'VERIFIED' });
        }
        if (url.pathname === '/payout/beneficiary' && req.method === 'GET') {
            if (beneLookupDown) return send(500, { type: 'api_error', message: 'something went wrong' });
            const id = url.searchParams.get('beneficiary_id');
            const acc = url.searchParams.get('bank_account_number'), ifsc = url.searchParams.get('bank_ifsc');
            const b = id ? benes.get(id) : [...benes.values()].find(x => x.beneficiary_instrument_details.bank_account_number === acc && x.beneficiary_instrument_details.bank_ifsc === ifsc);
            return b ? send(200, b) : send(404, { type: 'invalid_request_error', code: 'beneficiary_not_found', message: 'Beneficiary does not exist' });
        }
        if (url.pathname === '/payout/transfers' && req.method === 'POST') {
            const tid = body.transfer_id;
            if (!/^[A-Za-z0-9_]{1,40}$/.test(tid)) return send(400, { type: 'invalid_request_error', code: 'transfer_id_invalid', message: 'transfer_id : invalid' });
            if (transfers.has(tid)) return send(409, { type: 'invalid_request_error', code: 'transfer_id_already_exists', message: 'Transfer with the given transfer_id already exists' });
            const bene = benes.get(body.beneficiary_details?.beneficiary_id);
            if (!bene) return send(404, { type: 'invalid_request_error', code: 'beneficiary_not_found', message: 'Beneficiary does not exist' });
            if (transferFault === '422') return send(422, { type: 'invalid_request_error', code: 'insufficient_balance', message: 'Insufficient balance in the account' });
            const t = { transfer_id: tid, cf_transfer_id: String(100000 + transfers.size), status: body.transfer_amount === 99 ? 'FAILED' : 'RECEIVED', status_code: body.transfer_amount === 99 ? 'INSUFFICIENT_BALANCE' : 'RECEIVED', status_description: body.transfer_amount === 99 ? 'Not enough balance in the payouts account' : 'The transfer has been received', transfer_amount: body.transfer_amount, transfer_mode: body.transfer_mode, transfer_utr: null, beneficiary_details: { beneficiary_id: bene.beneficiary_id } };
            if (transferFault === '500_lost') return send(500, { type: 'api_error', code: 'internal_error', message: 'something went wrong' });
            transfers.set(tid, t);
            if (transferFault === '500_recorded' || transferFault === '500_and_status_down') { if (transferFault === '500_and_status_down') statusDown = true; return send(500, { type: 'api_error', code: 'internal_error', message: 'something went wrong' }); }
            return send(200, t);
        }
        if (url.pathname === '/payout/transfers' && req.method === 'GET') {
            if (statusDown) return send(503, { type: 'api_error', message: 'unavailable' });
            const t = transfers.get(url.searchParams.get('transfer_id') ?? '');
            return t ? send(200, t) : send(404, { type: 'invalid_request_error', code: 'transfer_not_found', message: 'Transfer does not exist' });
        }
        send(404, { message: 'no route' });
    });
});
const setStatus = (tid: string, status: string, extra: Record<string, unknown> = {}) => Object.assign(transfers.get(tid), { status, status_code: status, ...extra });
const lastTo = (path: string, method = 'POST') => [...log].reverse().find(l => l.path === path && l.method === method)!;

async function main() {
    await new Promise<void>(r => fake.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/payout`;
    (CashfreeService as any).v2Base = () => base;
    for (const k of ['CASHFREE_CLIENT_ID', 'CASHFREE_CLIENT_SECRET', 'CASHFREE_PUBLIC_KEY', 'CASHFREE_PAYOUTS_PUBLIC_KEY']) delete process.env[k];
    process.env.CASHFREE_PAYOUTS_CLIENT_ID = 'CFQA1234567890';
    process.env.CASHFREE_PAYOUTS_CLIENT_SECRET = 'cfsk_qa_secret';
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.CASHFREE_PAYOUTS_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    // ── beneficiaries ──
    const u1 = await CashfreeService.addBeneficiary({ name: 'Ravi Kumar 2', email: 'ravi@example.com', phone: '+91 98765 43210', vpa: 'Ravi@OKHDFCBANK' });
    const bReq = lastTo('/payout/beneficiary');
    check('a UPI beneficiary gets an id made from the UPI ID (alphanumeric, UFU…)', /^UFU[0-9A-F]{30}$/.test(u1) && bReq.body.beneficiary_id === u1);
    check('…registered with v2 fields: lower-cased UPI ID, clean name, 10-digit phone, +91', bReq.body.beneficiary_instrument_details.vpa === 'ravi@okhdfcbank' && bReq.body.beneficiary_name === 'Ravi Kumar' && bReq.body.beneficiary_contact_details.beneficiary_phone === '9876543210' && bReq.body.beneficiary_contact_details.beneficiary_country_code === '+91');
    const sig = String(bReq.headers['x-cf-signature'] ?? '');
    const plain = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(sig, 'base64')).toString();
    check('…sent with the v2 headers and a fresh public-key signature', bReq.headers['x-api-version'] === '2024-01-01' && bReq.headers['x-client-id'] === 'CFQA1234567890' && /^CFQA1234567890\.\d{10}$/.test(plain));
    check('the same UPI ID again: same beneficiary, no error', (await CashfreeService.addBeneficiary({ name: 'Ravi Kumar', email: 'x', phone: '', vpa: 'ravi@okhdfcbank' })) === u1);
    check('a different UPI ID: a different beneficiary', (await CashfreeService.addBeneficiary({ name: 'Ravi Kumar', email: 'x', phone: '', vpa: 'ravi2@okicici' })) !== u1);
    benes.set('OLDBENE1', { beneficiary_id: 'OLDBENE1', beneficiary_name: 'Sita Rao', beneficiary_instrument_details: { bank_account_number: '026291800001191', bank_ifsc: 'YESB0000262' } });
    const b1 = await CashfreeService.addBeneficiary({ name: 'Sita Rao', email: 'sita@example.com', phone: '9876500000', bankAccount: '0262 9180 0001 191', ifsc: 'yesb0000262' });
    check('a bank account Cashfree already holds under another id: that id is used', b1 === 'OLDBENE1');
    const b2 = await CashfreeService.addBeneficiary({ name: 'Mohan', email: 'm@example.com', phone: '9876511111', bankAccount: '50100012345678', ifsc: 'HDFC0001234' });
    check('a new bank account gets a UFB… id', /^UFB[0-9A-F]{30}$/.test(b2));
    // The go-live error: "beneficiary_id already exists" for a UPI ID paid before.
    dupWording = 'plain';
    check('"beneficiary_id already exists" (Cashfree’s other wording) for our own UPI beneficiary: reused, no error', (await CashfreeService.addBeneficiary({ name: 'Ravi Kumar', email: 'x', phone: '', vpa: 'ravi@okhdfcbank' }).catch(e => e.message)) === u1);
    beneLookupDown = true;
    check('…and when Cashfree’s beneficiary lookup is failing too (the id is a hash of the UPI ID, so it is ours)', (await CashfreeService.addBeneficiary({ name: 'Ravi Kumar', email: 'x', phone: '', vpa: 'ravi@okhdfcbank' }).catch(e => e.message)) === u1);
    beneLookupDown = false;
    const maskedId = CashfreeService.beneIdFor({ vpa: 'masked@okicici' } as any);
    benes.set(maskedId, { beneficiary_id: maskedId, beneficiary_name: 'M', beneficiary_instrument_details: { vpa: 'ma****@okicici' } });
    check('…a lookup that shows the UPI ID masked: still reused', (await CashfreeService.addBeneficiary({ name: 'M', email: 'x', phone: '', vpa: 'masked@okicici' }).catch(e => e.message)) === maskedId);
    const takenId = CashfreeService.beneIdFor({ vpa: 'zed@okaxis' } as any);
    benes.set(takenId, { beneficiary_id: takenId, beneficiary_name: 'Z', beneficiary_instrument_details: { vpa: 'someone.else@okaxis' } });
    check('…but our id holding a different UPI ID: refused, never paid to the wrong person', await CashfreeService.addBeneficiary({ name: 'Z', email: 'x', phone: '', vpa: 'zed@okaxis' }).then(() => false, e => /already registered in Cashfree/.test(e.message)));
    dupWording = null;
    check('no bank account and no UPI ID: refused before calling Cashfree', await CashfreeService.addBeneficiary({ name: 'X', email: 'x', phone: '' }).then(() => false, e => /needs a bank account/.test(e.message)));

    // ── transfers ──
    const p1 = await CashfreeService.createPayout(u1, 1, 'WDRW-12', 'payout');
    const tReq = lastTo('/payout/transfers');
    check('a UPI payout: transfer id WDRW-12 becomes WDRW_12 (v2 allows letters, digits, _)', p1.transferId === 'WDRW_12' && tReq.body.transfer_id === 'WDRW_12');
    check('…₹1.00, UPI mode, to the beneficiary id, remarks without symbols', tReq.body.transfer_amount === 1 && tReq.body.transfer_mode === 'upi' && tReq.body.beneficiary_details.beneficiary_id === u1 && /^[A-Za-z0-9 ]+$/.test(tReq.body.transfer_remarks));
    check('…and Cashfree\'s own id kept as the reference', p1.referenceId === '100000' && !p1.alreadyExisted);
    await CashfreeService.createPayout(b2, 250.5, 'DEP-REF-5', 'deposit refund');
    check('a bank payout goes by IMPS, amount to the paisa', lastTo('/payout/transfers').body.transfer_mode === 'imps' && lastTo('/payout/transfers').body.transfer_amount === 250.5 && transfers.has('DEP_REF_5'));
    await CashfreeService.createPayout('OLDBENE1', 10, 'SR-2026-10-0001', 'settlement');
    check('a beneficiary registered elsewhere: its account decides the mode (IMPS)', lastTo('/payout/transfers').body.transfer_mode === 'imps');
    check('no fund source set: none sent, Cashfree picks', !('fundsource_id' in lastTo('/payout/transfers').body));
    process.env.CASHFREE_PAYOUTS_FUNDSOURCE_ID = ' CF_Wallet ';
    await CashfreeService.createPayout(u1, 2, 'FS-1', 'payout');
    check('CASHFREE_PAYOUTS_FUNDSOURCE_ID set: every transfer names that fund source (trimmed)', lastTo('/payout/transfers').body.fundsource_id === 'CF_Wallet');
    process.env.CASHFREE_PAYOUTS_FUNDSOURCE_ID = 'CF Wallet!';
    await CashfreeService.createPayout(u1, 2, 'FS-2', 'payout');
    check('…a malformed value is ignored rather than sent', !('fundsource_id' in lastTo('/payout/transfers').body));
    delete process.env.CASHFREE_PAYOUTS_FUNDSOURCE_ID;
    const before = transfers.size;
    const again = await CashfreeService.createPayout(u1, 1, 'WDRW-12', 'payout');
    check('the same withdrawal approved twice: "already sent", never paid twice', again.alreadyExisted && transfers.size === before);
    check('a transfer Cashfree fails at once (no balance): refused with its reason', await CashfreeService.createPayout(u1, 99, 'WDRW-13').then(() => false, e => /Not enough balance/.test(e.message)));
    transferFault = '422';
    check('a 4xx from Cashfree: refused with its message', await CashfreeService.createPayout(u1, 1, 'WDRW-14').then(() => false, e => /Insufficient balance/.test(e.message)));
    transferFault = '500_recorded';
    const r500 = await CashfreeService.createPayout(u1, 1, 'WDRW-15');
    check('a 500 after Cashfree took it: reported in progress, not failed (no refund, no repeat)', r500.transferId === 'WDRW_15' && !r500.alreadyExisted);
    transferFault = '500_lost';
    check('a 500 where Cashfree never took it: refused, so the wallet can be refunded', await CashfreeService.createPayout(u1, 1, 'WDRW-16').then(() => false, e => /did not take the transfer/.test(e.message)));
    transferFault = '500_and_status_down';
    const unknown = await CashfreeService.createPayout(u1, 1, 'WDRW-17');
    check('a 500 and Cashfree cannot say either way: left in progress, never refunded on a guess', unknown.transferId === 'WDRW_17');
    transferFault = null; statusDown = false;

    // ── status ──
    setStatus('WDRW_12', 'SUCCESS', { transfer_utr: 'UTR778899' });
    const s1 = await CashfreeService.fetchPayoutStatus('WDRW-12');
    check('status by the original id (WDRW-12): SUCCESS → processed, with UTR', s1.status === 'processed' && s1.utr === 'UTR778899' && s1.referenceId === '100000');
    setStatus('DEP_REF_5', 'APPROVAL_PENDING', { status_code: 'MANUAL_APPROVAL_REQUIRED' });
    const s2 = await CashfreeService.fetchPayoutStatus('DEP-REF-5');
    check('APPROVAL_PENDING → still in progress, and says to approve it on the Cashfree dashboard', s2.status === 'processing' && /Cashfree dashboard/.test(s2.failureReason ?? ''));
    for (const [st, want] of [['RECEIVED', 'processing'], ['QUEUED', 'processing'], ['PENDING', 'processing'], ['REVERSED', 'reversed'], ['FAILED', 'failed'], ['REJECTED', 'failed'], ['MANUALLY_REJECTED', 'failed']] as const) {
        setStatus('WDRW_15', st, { status_description: st === 'FAILED' ? 'Invalid beneficiary VPA' : undefined });
        const s = await CashfreeService.fetchPayoutStatus('WDRW-15');
        check(`${st} → ${want}`, s.status === want, s.status);
    }
    setStatus('WDRW_15', 'FAILED', { status_code: 'INVALID_BENE_VPA', status_description: 'Invalid beneficiary VPA' });
    check('…a failure carries Cashfree\'s description and its status code', (await CashfreeService.fetchPayoutStatus('WDRW_15')).failureReason === 'Invalid beneficiary VPA [INVALID_BENE_VPA]');
    check('an unknown transfer: "not found"', await CashfreeService.fetchPayoutStatus('NOPE-1').then(() => false, e => /not found/.test(e.message)));

    // ── a whole expert withdrawal through the admin routes ──
    const { base: app, close } = await bootServer();
    const api = client(app);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;
        const [u] = await db.insert(users).values({ phone: `9${String(Date.now()).slice(-9)}`, username: 'QA Payout Expert', role: 'serviceman', isActive: true, email: 'qa.payout@example.test' } as any).returning();
        userIds.push(u.id);
        const [emp] = await db.insert(employees).values({ userId: u.id, fullName: 'QA Payout Expert', upiId: 'qa.expert@okaxis' } as any).returning();
        await db.insert(partnerWallets).values({ partnerId: emp.id, balanceAvailable: '0.00', balanceHold: '0.00', totalEarned: '5.00' } as any);
        const [w] = await db.insert(withdrawalRequests).values({ partnerId: emp.id, amount: '5.00', method: 'upi', status: 'pending' } as any).returning();
        const ap = await api.post(`/api/admin/withdrawals/${w.id}/approve`, {}, S);
        const [w1] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, w.id));
        const [e1] = await db.select().from(employees).where(eq(employees.id, emp.id));
        const tid = `WDRW_${w.id}`;
        check('staff approve a ₹5 withdrawal: Cashfree gets ₹5 by UPI to the expert\'s UPI ID', ap.status === 200 && transfers.get(tid)?.transfer_amount === 5 && transfers.get(tid)?.transfer_mode === 'upi' && benes.get(e1.cashfreeBeneId!)?.beneficiary_instrument_details?.vpa === 'qa.expert@okaxis', JSON.stringify(ap.body).slice(0, 200));
        check('…the withdrawal is "processing" with the v2 transfer id stored', w1.status === 'processing' && w1.razorpayPayoutId === tid);
        setStatus(tid, 'SUCCESS', { transfer_utr: 'UTR555' });
        const sy = await api.post(`/api/admin/withdrawals/${w.id}/sync`, {}, S);
        const [w2] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, w.id));
        check('"Sync with Cashfree" after it lands: completed', sy.status === 200 && w2.status === 'completed', JSON.stringify(sy.body).slice(0, 200));

        const [wf] = await db.insert(withdrawalRequests).values({ partnerId: emp.id, amount: '3.00', method: 'upi', status: 'pending' } as any).returning();
        await api.post(`/api/admin/withdrawals/${wf.id}/approve`, {}, S);
        setStatus(`WDRW_${wf.id}`, 'FAILED', { status_description: 'Beneficiary VPA invalid' });
        const [wal0] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, emp.id));
        await api.post(`/api/admin/withdrawals/${wf.id}/sync`, {}, S);
        const [wf2] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, wf.id));
        const [wal1] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, emp.id));
        check('a transfer that fails later: withdrawal failed with Cashfree\'s reason, ₹3 back in the wallet', wf2.status === 'failed' && /VPA invalid/.test(wf2.failureReason ?? '') && Number(wal1.balanceAvailable) - Number(wal0.balanceAvailable) === 3, `${wf2.status} ${wf2.failureReason} ${wal0.balanceAvailable}→${wal1.balanceAvailable}`);
        await api.post(`/api/admin/withdrawals/${wf.id}/sync`, {}, S);
        const [wal2] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, emp.id));
        check('…syncing again does not refund twice', wal2.balanceAvailable === wal1.balanceAvailable);

        // An expert with both a UPI ID and a bank account is paid the way they asked.
        const [u2] = await db.insert(users).values({ phone: `8${String(Date.now()).slice(-9)}`, username: 'QA Payout Expert', role: 'serviceman', isActive: true, email: 'qa.payout2@example.test' } as any).returning();
        userIds.push(u2.id);
        const [emp2] = await db.insert(employees).values({ userId: u2.id, fullName: 'QA Payout Expert', upiId: 'qa.both@okicici', bankAccountNumber: '50100099887766', bankIfsc: 'HDFC0004321' } as any).returning();
        await db.insert(partnerWallets).values({ partnerId: emp2.id, balanceAvailable: '0.00', balanceHold: '0.00', totalEarned: '9.00' } as any);
        const [wu] = await db.insert(withdrawalRequests).values({ partnerId: emp2.id, amount: '4.00', method: 'upi', status: 'pending' } as any).returning();
        const apu = await api.post(`/api/admin/withdrawals/${wu.id}/approve`, {}, S);
        const tu = transfers.get(`WDRW_${wu.id}`);
        check('a UPI withdrawal from an expert who also has a bank account: paid by UPI to their UPI ID, not the bank', apu.status === 200 && tu?.transfer_mode === 'upi' && benes.get(tu?.beneficiary_details?.beneficiary_id)?.beneficiary_instrument_details?.vpa === 'qa.both@okicici', JSON.stringify(apu.body).slice(0, 200));
        const [wb] = await db.insert(withdrawalRequests).values({ partnerId: emp2.id, amount: '5.00', method: 'bank', status: 'pending' } as any).returning();
        const apb = await api.post(`/api/admin/withdrawals/${wb.id}/approve`, {}, S);
        const tb = transfers.get(`WDRW_${wb.id}`);
        check('a bank withdrawal from the same expert: IMPS to their bank account', apb.status === 200 && tb?.transfer_mode === 'imps' && benes.get(tb?.beneficiary_details?.beneficiary_id)?.beneficiary_instrument_details?.bank_account_number === '50100099887766', JSON.stringify(apb.body).slice(0, 200));
        const [wn] = await db.insert(withdrawalRequests).values({ partnerId: emp.id, amount: '1.00', method: 'bank', status: 'pending' } as any).returning();
        const sentBefore = transfers.size;
        const apn = await api.post(`/api/admin/withdrawals/${wn.id}/approve`, {}, S);
        const [wn2] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, wn.id));
        check('a bank withdrawal from an expert with only a UPI ID: refused with why, nothing sent, still pending', apn.status === 400 && /no bank account/i.test(apn.body?.error ?? '') && transfers.size === sentBefore && wn2.status === 'pending', JSON.stringify(apn.body).slice(0, 200));

        // Test payout tool, now on v2.
        const tp = await api.post('/api/admin/withdrawals/cashfree-test-payout', { name: 'Ravi Kumar', upiId: 'ravi@okhdfcbank', amount: 1 }, S);
        dupWording = 'plain';
        const tp2 = await api.post('/api/admin/withdrawals/cashfree-test-payout', { name: 'Ravi Kumar', upiId: 'ravi@okhdfcbank', amount: 1 }, S);
        dupWording = null;
        check('…and again with Cashfree saying "beneficiary_id already exists": sent, not refused', tp2.status === 200 && transfers.get(tp2.body?.data?.transferId)?.beneficiary_details?.beneficiary_id === u1, JSON.stringify(tp2.body).slice(0, 200));
        check('the go-live ₹1 test payout goes through v2 to the same beneficiary', tp.status === 200 && /^UFTEST_/.test(tp.body.data.transferId) && transfers.get(tp.body.data.transferId)?.beneficiary_details?.beneficiary_id === u1, JSON.stringify(tp.body).slice(0, 200));
    } finally {
        await close();
        fake.close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0';
    await cleanupPartners([], adminIds, [
        `DELETE FROM wallet_transactions_v2 WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM withdrawal_requests WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM partner_wallets WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM audit_logs WHERE (entity_type = 'withdrawal' AND metadata->>'partnerName' = 'QA Payout Expert') OR action = 'cashfree_test_payout'`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM employees WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
    ]);
    process.exit(summary());
});
