/**
 * A broadband partner's Broadband pages run on an FTTH operator. Approval
 * created it; a partner created by staff (approved on creation), or switched
 * to broadband later, never went through approval and had none — every
 * Broadband page was refused and the browser signed them out.
 *
 *   npm run smoke:partner-setup
 */

import { eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, ftthOperators } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [], bpIds: number[] = [];
const opsOf = (bpId: number) => db.select({ id: ftthOperators.id, status: ftthOperators.status }).from(ftthOperators).where(eq(ftthOperators.businessPartnerId, bpId));

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    let n = 0;
    const partner = (v: string[]) => ({ legalName: `QA Setup ${v.join('+')} ${stamp} ${++n}`, contactPhone: `6${String(Date.now() + n).slice(-9)}`, contactEmail: `qa_setup_${stamp}_${n}@example.test`, verticalCodes: v });
    const signIn = async (bpId: number, S: string) => {
        const ol = await api.post(`/api/admin/hub/partners/${bpId}/owner-login`, {}, S);
        const [row] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, ol.body.data.username)); adminIds.push(row.id);
        return (await api.login(ol.body.data.username, ol.body.data.temporaryPassword))!;
    };
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;

        // Staff create a broadband partner.
        const c = await api.post('/api/admin/business-partners', partner(['isp']), S);
        bpIds.push(c.body.data.id);
        const ops = await opsOf(c.body.data.id);
        check('staff create a broadband partner: its FTTH operator is created, active', c.status === 201 && ops.length === 1 && ops[0].status === 'active', JSON.stringify(ops));
        const t = await signIn(c.body.data.id, S);
        const me = await api.get('/api/ftth/admin/me', t);
        const plans = await api.get('/api/ftth/admin/plans', t);
        check('…its owner opens Broadband: allowed (no 403)', me.status === 200 && plans.status === 200, `${me.status} ${plans.status} ${JSON.stringify(me.body).slice(0, 150)}`);
        check('…and the Hub reports the operator', (await api.get('/api/hub/me', t)).body?.data?.ftthOperatorId === ops[0].id);

        // A non-broadband partner gets none.
        const c2 = await api.post('/api/admin/business-partners', partner(['computer']), S);
        bpIds.push(c2.body.data.id);
        check('a computer-service partner: no FTTH operator', (await opsOf(c2.body.data.id)).length === 0);
        await api.patch(`/api/admin/business-partners/${c2.body.data.id}`, { verticalCodes: ['computer', 'isp'] }, S);
        check('…switched to broadband by staff: its operator is created then', (await opsOf(c2.body.data.id)).length === 1);

        // Made before this fix: a staff-created broadband partner with no operator.
        const old = await BusinessPartnerService.create({ ...partner(['isp']), approvedByAdminId: sa.id } as any);
        bpIds.push(old.id);
        const tOld = await signIn(old.id, S);
        const before = await api.get('/api/ftth/admin/plans', tOld);
        check('an existing broadband partner with no operator: Broadband refused (the reported fault)', before.status === 403, String(before.status));
        const hub = await api.get('/api/hub/me', tOld);
        const after = await api.get('/api/ftth/admin/plans', tOld);
        check('…opening the Hub sets the operator up, and Broadband opens', hub.status === 200 && (await opsOf(old.id)).length === 1 && after.status === 200 && hub.body?.data?.ftthOperatorId != null, `${hub.status} ${after.status}`);
        await api.get('/api/hub/me', tOld);
        check('…opening the Hub again does not make a second one', (await opsOf(old.id)).length === 1);

        // A paused operator stays paused: the Hub only creates, never re-activates.
        const [op] = await opsOf(old.id);
        await db.update(ftthOperators).set({ status: 'paused' } as any).where(eq(ftthOperators.id, op.id));
        await api.get('/api/hub/me', tOld);
        check('a paused operator is left paused by the Hub', (await opsOf(old.id))[0].status === 'paused');

        // A partner still pending approval gets nothing until approved.
        const pend = await BusinessPartnerService.create({ ...partner(['isp']) } as any);
        bpIds.push(pend.id);
        const { PartnerHubService } = await import('../server/services/partner-hub.service');
        check('a partner pending approval: no operator yet', (await PartnerHubService.ensureFtthOperator(pend.id, sa.id)) === null && (await opsOf(pend.id)).length === 0);
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await cleanupPartners(bpIds, adminIds, [`DELETE FROM audit_logs WHERE entity_type = 'business_partner' AND entity_id IN (${bpIds.join(',') || '0'})`]);
    process.exit(summary());
});
