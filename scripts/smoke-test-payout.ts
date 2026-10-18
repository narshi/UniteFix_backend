/**
 * The staff test payout (go-live page): only a super admin, only ₹1–₹10, to
 * a UPI ID or a bank account, through the same Cashfree calls a withdrawal
 * makes — with Cashfree replaced by stubs, so no money moves.
 *
 *   npm run smoke:test-payout
 */

import bcrypt from 'bcrypt';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers } from '../shared/schema';
import { CashfreeService } from '../server/services/cashfree.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [];
const calls: Array<{ fn: string; args: any[] }> = [];

async function main() {
    (CashfreeService as any).addBeneficiary = async (input: any) => { calls.push({ fn: 'addBeneficiary', args: [input] }); return input.beneId; };
    (CashfreeService as any).createPayout = async (beneId: string, amount: number, transferId: string, purpose: string) => { calls.push({ fn: 'createPayout', args: [beneId, amount, transferId, purpose] }); return { id: transferId, transferId, referenceId: 'REF1', utr: null, alreadyExisted: false, raw: {} }; };
    let statusReply: any = { status: 'processing', providerStatus: 'PENDING', utr: null, referenceId: 'REF1', raw: {} };
    (CashfreeService as any).fetchPayoutStatus = async (id: string) => { calls.push({ fn: 'fetchPayoutStatus', args: [id] }); return statusReply; };

    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;
        const pw = `Ad-${stamp}-pw!`;
        const [plain] = await db.insert(adminUsers).values({ username: `qa_ad_${stamp}`, email: `qa_ad_${stamp}@example.test`, password: await bcrypt.hash(pw, 10), role: 'admin', isActive: true } as any).returning();
        adminIds.push(plain.id);
        const A = await api.login(plain.username, pw);

        const send = (body: any, t: string | null = S) => api.post('/api/admin/withdrawals/cashfree-test-payout', body, t);
        check('signed out: refused', (await send({ name: 'Ravi Kumar', upiId: 'ravi@okhdfcbank' }, null)).status === 401);
        if (A) check('an admin who is not a super admin: refused', (await send({ name: 'Ravi Kumar', upiId: 'ravi@okhdfcbank' }, A)).status === 403);
        check('more than ₹10: refused', (await send({ name: 'Ravi Kumar', upiId: 'ravi@okhdfcbank', amount: 11 })).status === 400);
        check('less than ₹1: refused', (await send({ name: 'Ravi Kumar', upiId: 'ravi@okhdfcbank', amount: 0.5 })).status === 400);
        check('no name: refused', (await send({ upiId: 'ravi@okhdfcbank' })).status === 400);
        check('a malformed UPI ID: refused', (await send({ name: 'Ravi Kumar', upiId: 'not a upi' })).status === 400);
        check('a bad IFSC: refused', (await send({ name: 'Ravi Kumar', bankAccount: '026291800001191', ifsc: 'YESB262' })).status === 400);
        check('nothing reached Cashfree for any refused request', calls.length === 0);

        const r = await send({ name: 'Ravi Kumar', upiId: 'Ravi@OKHDFCBANK', amount: 1 });
        const bene = calls.find(c => c.fn === 'addBeneficiary')?.args[0];
        const pay = calls.find(c => c.fn === 'createPayout')?.args;
        check('₹1 to a UPI ID: beneficiary registered with that UPI ID', r.status === 200 && bene?.vpa === 'ravi@okhdfcbank' && !bene.bankAccount && bene.name === 'Ravi Kumar', JSON.stringify(r.body));
        check('…then exactly ₹1 sent, on a test transfer id', pay?.[1] === 1 && /^UFTEST_[A-Z0-9]+$/.test(pay?.[2]) && pay?.[0] === bene.beneId);
        check('…and its status read back and shown', r.body?.data?.status === 'processing' && r.body.data.providerStatus === 'PENDING' && r.body.data.transferId === pay?.[2]);

        calls.length = 0;
        const r2 = await send({ name: 'Ravi Kumar', upiId: 'ravi@okhdfcbank', amount: 2 });
        const bene2 = calls.find(c => c.fn === 'addBeneficiary')?.args[0];
        check('the same UPI ID reuses its beneficiary', r2.status === 200 && bene2?.beneId === bene.beneId);

        calls.length = 0;
        const r3 = await send({ name: 'Ravi Kumar', bankAccount: '0262 9180 0001 191', ifsc: 'yesb0000262', amount: 1 });
        const bene3 = calls.find(c => c.fn === 'addBeneficiary')?.args[0];
        check('₹1 to a bank account: registered with account and IFSC', r3.status === 200 && bene3?.bankAccount === '026291800001191' && bene3.ifsc === 'YESB0000262' && !bene3.vpa && bene3.beneId !== bene.beneId);

        statusReply = { status: 'processed', providerStatus: 'SUCCESS', utr: 'UTR123', referenceId: 'REF1', raw: {} };
        const st = await api.get(`/api/admin/withdrawals/cashfree-test-payout/${r.body.data.transferId}`, S);
        check('"Check status" shows when the money has arrived, with the UTR', st.status === 200 && st.body.data.status === 'processed' && st.body.data.utr === 'UTR123');
        check('status of a real withdrawal cannot be read through this', (await api.get('/api/admin/withdrawals/cashfree-test-payout/WDRW-5', S)).status === 400);
        if (A) check('…nor by an admin who is not a super admin', (await api.get(`/api/admin/withdrawals/cashfree-test-payout/${r.body.data.transferId}`, A)).status === 403);

        (CashfreeService as any).createPayout = async () => { throw new Error('Cashfree payout failed: Insufficient balance'); };
        const f = await send({ name: 'Ravi Kumar', upiId: 'ravi@okhdfcbank' });
        check('a Cashfree refusal is shown as it is (e.g. no balance)', f.status === 502 && /Insufficient balance/.test(f.body.message));
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await cleanupPartners([], adminIds, [`DELETE FROM audit_logs WHERE action = 'cashfree_test_payout' AND changed_by IN (${adminIds.join(',') || '0'})`]);
    process.exit(summary());
});
