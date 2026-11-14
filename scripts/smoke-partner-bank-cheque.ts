/**
 * Partner bank verified by hand: staff verifying the cancelled cheque
 * ("bank_proof") verifies the bank account too, instead of leaving it
 * "pending" until a second, separate "Mark verified". Saving the same account
 * again keeps that; a new account resets it.
 *
 *   npx tsx scripts/smoke-partner-bank-cheque.ts
 */

// Never call the real Cashfree Verification API from a test: no keys = manual check.
delete process.env.CASHFREE_VERIFICATION_CLIENT_ID;
delete process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;

import { check, summary, bootServer, client, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { partnerDocuments } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const stamp = Date.now().toString(36);
const bpIds: number[] = [], adminIds: number[] = [];
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;

async function main() {
    const srv = await bootServer();
    try {
        const api = client(srv.base);
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const token = await api.login(sa.username, sa.password);
        const mk = async (name: string) => {
            const bp = await BusinessPartnerService.create({ legalName: `QA ${name} ${stamp}`, displayName: name, contactPhone: phone(), contactEmail: `qa_bank_${stamp}_${++n}@example.test`, verticalCodes: ['computer'] } as any);
            bpIds.push(bp.id);
            return bp;
        };
        const cheque = async (bpId: number) => {
            const [doc] = await db.insert(partnerDocuments).values({ businessPartnerId: bpId, docType: 'bank_proof', fileUrl: 'data:application/pdf;base64,JVBERi0=', fileName: 'cheque.pdf', status: 'pending' } as any).returning();
            return doc;
        };
        const bankOf = async (id: number) => (await BusinessPartnerService.byId(id))!;

        const a = await mk('Cheque Partner');
        await PartnerHubService.setBank(a.id, { beneficiaryName: 'Cheque Partner', accountNumber: '123456789012', ifsc: 'SBIN0001234' });
        check('without automatic checks a new bank account is "pending"', (await bankOf(a.id)).bankStatus === 'pending');

        const doc = await cheque(a.id);
        const r = await api.post(`/api/admin/hub/partners/${a.id}/documents/${doc.id}/review`, { status: 'verified' }, token);
        check('verifying the cheque succeeds', r.status === 200, JSON.stringify(r.body).slice(0, 200));
        const after = await bankOf(a.id);
        check('…and the bank account is now verified, not still pending', after.bankStatus === 'verified' && !!after.bankVerifiedAt);
        check('…recorded as matched against that cheque', after.bankVerificationRef === `manual:cheque matched (document #${doc.id})`);
        check('…and staff are told so', /bank account ending 9012 is now verified/.test(r.body?.message ?? ''), r.body?.message);
        const detail = await api.get(`/api/admin/hub/partners/${a.id}`, token);
        check('the admin panel shows the bank as verified', detail.body?.data?.onboarding?.bank?.status === 'verified');

        await PartnerHubService.setBank(a.id, { beneficiaryName: 'Cheque Partner', accountNumber: '123456789012', ifsc: 'SBIN0001234' });
        check('saving the same account again keeps it verified', (await bankOf(a.id)).bankStatus === 'verified');
        await PartnerHubService.setBank(a.id, { beneficiaryName: 'Cheque Partner', accountNumber: '999988887777', ifsc: 'SBIN0001234' });
        check('a different account resets it to pending', (await bankOf(a.id)).bankStatus === 'pending');

        const b = await mk('No Bank Yet');
        const doc2 = await cheque(b.id);
        const r2 = await api.post(`/api/admin/hub/partners/${b.id}/documents/${doc2.id}/review`, { status: 'verified' }, token);
        check('a cheque with no bank details entered: the cheque is verified, staff told the bank is not', r2.status === 200 && /not entered bank details/.test(r2.body?.message ?? '') && (await bankOf(b.id)).bankStatus !== 'verified', r2.body?.message);

        const c = await mk('Other Doc');
        await PartnerHubService.setBank(c.id, { beneficiaryName: 'Other Doc', accountNumber: '123456789013', ifsc: 'SBIN0001234' });
        const [pan] = await db.insert(partnerDocuments).values({ businessPartnerId: c.id, docType: 'pan_card', fileUrl: 'data:application/pdf;base64,JVBERi0=', fileName: 'pan.pdf', status: 'pending' } as any).returning();
        await api.post(`/api/admin/hub/partners/${c.id}/documents/${pan.id}/review`, { status: 'verified' }, token);
        check('verifying some other document leaves the bank alone', (await bankOf(c.id)).bankStatus === 'pending');

        const d = await mk('Rejected Cheque');
        await PartnerHubService.setBank(d.id, { beneficiaryName: 'Rejected Cheque', accountNumber: '123456789014', ifsc: 'SBIN0001234' });
        const doc4 = await cheque(d.id);
        await api.post(`/api/admin/hub/partners/${d.id}/documents/${doc4.id}/review`, { status: 'rejected', note: 'name does not match' }, token);
        check('rejecting the cheque leaves the bank pending', (await bankOf(d.id)).bankStatus === 'pending');
    } finally { await srv.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await new Promise(r => setTimeout(r, 1500));
    await cleanupPartners(bpIds, adminIds);
    process.exit(summary());
});
