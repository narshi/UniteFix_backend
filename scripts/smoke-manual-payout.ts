/**
 * Manual payouts of expert withdrawals: staff pay from their own bank (IMPS /
 * NEFT / RTGS) or UPI app and record it — the mode, the bank's reference
 * (UTR) and a proof screenshot. A UTR can settle one request only.
 *
 *   npm run smoke:manual-payout
 */

import { eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { users, employees, partnerWallets, withdrawalRequests } from '../shared/schema';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [];
// A 1×1 PNG: the "screenshot".
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const utr = (n: number) => `4${String(Date.now()).slice(-10)}${n}`;

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;
        const expert = async (n: number, details: Record<string, string | null>) => {
            const [u] = await db.insert(users).values({ phone: `7${String(Date.now() + n).slice(-9)}`, username: 'QA Manual Payout', role: 'serviceman', isActive: true, email: `qa.manual.${stamp}.${n}@example.test` } as any).returning();
            userIds.push(u.id);
            const [e] = await db.insert(employees).values({ userId: u.id, fullName: 'QA Manual Payout', ...details } as any).returning();
            await db.insert(partnerWallets).values({ partnerId: e.id, balanceAvailable: '0.00', balanceHold: '0.00', totalEarned: '50.00' } as any);
            return e;
        };
        const request = async (partnerId: number, method: string, amount = '10.00') =>
            (await db.insert(withdrawalRequests).values({ partnerId, amount, method, status: 'pending' } as any).returning())[0];
        const pay = async (id: number, fields: Record<string, string>, proof = true) => {
            const fd = new FormData();
            if (proof) fd.append('proof', new Blob([PNG], { type: 'image/png' }), 'proof.png');
            for (const [k, v] of Object.entries(fields)) fd.append(k, v);
            const r = await fetch(`${base}/api/admin/withdrawals/${id}/approve-manual`, { method: 'POST', headers: { Authorization: `Bearer ${S}` }, body: fd });
            return { status: r.status, body: await r.json().catch(() => ({})) as any };
        };
        const row = async (id: number) => (await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id)))[0];

        const both = await expert(1, { bankAccountNumber: '50100012345678', bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank', upiId: 'qa.manual@okhdfcbank' });
        const upiOnly = await expert(2, { upiId: 'qa.only@okaxis' });

        const w1 = await request(both.id, 'bank');
        const noUtr = await pay(w1.id, { mode: 'imps' });
        check('a bank transfer without a UTR: refused, still pending', noUtr.status === 400 && /UTR/.test(noUtr.body.error) && (await row(w1.id)).status === 'pending', JSON.stringify(noUtr.body));
        const badUtr = await pay(w1.id, { mode: 'neft', reference: 'UTR-12/34' });
        check('a reference with symbols: refused', badUtr.status === 400 && /letters and digits/.test(badUtr.body.error));
        const badMode = await pay(w1.id, { mode: 'cheque', reference: '412345678901' });
        check('an unknown mode: refused', badMode.status === 400);
        check('no proof screenshot: refused', (await pay(w1.id, { mode: 'imps', reference: '412345678901' }, false)).status === 400);

        const ref1 = utr(1);
        const ok = await pay(w1.id, { mode: 'imps', reference: ` ${ref1.slice(0, 6)} ${ref1.slice(6)} ` });
        const r1 = await row(w1.id);
        check('IMPS with a UTR and proof: completed', ok.status === 200 && r1.status === 'completed', JSON.stringify(ok.body));
        check('…mode, UTR (spaces removed), who and when are recorded', r1.payoutMode === 'imps' && r1.payoutReference === ref1 && r1.paidByAdminId === sa.id && !!r1.paidAt && !!r1.paymentProofUrl);
        check('…paying it again: refused (not pending)', (await pay(w1.id, { mode: 'imps', reference: utr(9) })).status === 400);

        const w2 = await request(both.id, 'bank');
        const dup = await pay(w2.id, { mode: 'neft', reference: ref1.toLowerCase() });
        check('the same UTR on another request (any case): refused with the request it settled', dup.status === 409 && dup.body.error.includes(`#${w1.id}`) && (await row(w2.id)).status === 'pending', JSON.stringify(dup.body));
        const rtgs = await pay(w2.id, { mode: 'rtgs', reference: `SBINR5${String(Date.now()).slice(-12)}` });
        check('RTGS with an alphanumeric UTR: completed', rtgs.status === 200 && (await row(w2.id)).payoutMode === 'rtgs');

        const w3 = await request(upiOnly.id, 'bank');
        const noBank = await pay(w3.id, { mode: 'imps', reference: utr(3) });
        check('a bank transfer for an expert with no bank account on file: refused', noBank.status === 400 && /no bank account/i.test(noBank.body.error) && (await row(w3.id)).status === 'pending');
        const upi = await pay(w3.id, { mode: 'upi' });
        check('…paid by UPI instead, without a transaction id (optional for UPI): completed', upi.status === 200 && (await row(w3.id)).payoutMode === 'upi' && (await row(w3.id)).payoutReference === null);

        const w4 = await request(both.id, 'upi');
        const ref4 = utr(4);
        const upiRef = await pay(w4.id, { mode: 'upi', reference: ref4 });
        check('UPI with its transaction id: recorded', upiRef.status === 200 && (await row(w4.id)).payoutReference === ref4, JSON.stringify(upiRef.body));

        const w5 = await request(both.id, 'upi');
        const legacy = await pay(w5.id, {});
        check('an older client sending only the proof: still works as before', legacy.status === 200 && (await row(w5.id)).status === 'completed' && (await row(w5.id)).payoutMode === null);

        const list = await api.get(`/api/admin/withdrawals?q=${encodeURIComponent('qa.manual@okhdfcbank')}`, S);
        const item = (list.body?.data ?? []).find((x: any) => x.request.id === w1.id);
        check('the list gives what a bank transfer needs (IFSC, bank) and the recorded UTR', item?.employee?.bankIfsc === 'HDFC0001234' && item?.employee?.bankName === 'HDFC Bank' && item?.request?.payoutReference === ref1, JSON.stringify(item ?? list.body).slice(0, 200));
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0';
    await cleanupPartners([], adminIds, [
        `DELETE FROM withdrawal_requests WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM partner_wallets WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM audit_logs WHERE entity_type = 'withdrawal' AND action = 'withdrawal_manual_payout' AND changed_by IN (${adminIds.join(',') || '0'})`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM employees WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
    ]);
    process.exit(summary());
});
