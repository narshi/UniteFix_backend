/**
 * Broadband subscribers: changing the mobile number, with history kept.
 *
 *   change      only to a UniteFix member's number; the connection (ISP id,
 *               recharges) stays and moves to that member's app account; the
 *               old number stays in the history; refused for a member who
 *               already holds another open connection with this partner
 *   suspend     the current number loses the connection (lost phone)
 *   reactivate  a previous number becomes current again, same checks
 *   edits       cannot change the number, cannot move validity unless sent,
 *               a typed date is the end of that day in India; closed
 *               subscribers cannot be edited, only reopened
 *   import      never changes a number on file, never reopens or unsuspends
 *   console     a data-changing statement is never classified as a read
 *
 *   npm run smoke:ftth-phones
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { and, eq, inArray } from 'drizzle-orm';
import { bootServer, client, check, summary, db } from './lib/hub-test-kit';
import { users, adminUsers, ftthOperators, ftthConnections, ftthConnectionPhones, ftthPlans, ftthRecharges, notifications } from '../shared/schema';
import { FtthService } from '../server/services/ftth.service';
import { classify } from '../server/routes/admin-db-console.routes';

const stamp = Date.now().toString(36);
const n9 = () => String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-9);
const userIds: number[] = [], adminIds: number[] = [];
let operatorId = 0;

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        const [admin] = await db.insert(adminUsers).values({ username: `qa_ph_${stamp}`, email: `qa_ph_${stamp}@example.test`, password: await bcrypt.hash('x-pass-123', 10), role: 'operator', isActive: true } as any).returning();
        adminIds.push(admin.id);
        const [op] = await db.insert(ftthOperators).values({ adminUserId: admin.id, companyName: 'QA Phones ISP', contactEmail: `qa_ph_${stamp}@example.test`, contactPhone: `9${n9()}`, status: 'active' } as any).returning();
        operatorId = op.id;
        const T = jwt.sign({ userId: admin.id, role: 'operator' }, SECRET, { expiresIn: '1h' });
        const member = async (name: string) => {
            const phone = `9${n9()}`;
            const [u] = await db.insert(users).values({ phone: `+91${phone}`, username: name, role: 'user', isActive: true } as any).returning();
            userIds.push(u.id);
            return { id: u.id, phone };
        };
        const oldM = await member('QA Old Number'), newM = await member('QA New Number'), busyM = await member('QA Busy Member');

        // A subscriber on the old number, with a paid recharge.
        const add = await api.post('/api/ftth/admin/connections', { ispConnectionId: `QAPH-${stamp}`, customerName: 'Ravi Kumar', customerPhone: oldM.phone, validTill: '2026-11-20' }, T);
        check('a subscriber is added and linked to the member on that number', add.status === 201 && add.body.data.userId === oldM.id, JSON.stringify(add.body).slice(0, 200));
        const connId = add.body.data.id;
        check('a typed date means the end of that day in India (not midnight UTC)', new Date(add.body.data.validTill).toISOString() === '2026-11-20T18:29:59.000Z', add.body.data.validTill);
        const [plan] = await db.insert(ftthPlans).values({ operatorId, name: 'QA 100', speedMbps: 100, durationMonths: 1, listPricePaise: 59900 } as any).returning();
        await db.insert(ftthRecharges).values({ connectionId: connId, planId: plan.id, userId: oldM.id, planName: 'QA 100', speedMbps: 100, durationMonths: 1, listPricePaise: 59900, totalPaise: 59900, operatorPayablePaise: 55000, platformRevenuePaise: 4900, status: 'success' } as any);
        const h0 = await api.get(`/api/ftth/admin/connections/${connId}/phones`, T);
        check('its first number is in the history from the start', h0.status === 200 && h0.body.data.history.length === 1 && h0.body.data.history[0].phone === oldM.phone && h0.body.data.history[0].status === 'active' && h0.body.data.history[0].linked);

        // Edits cannot change the number or move validity.
        const e1 = await api.patch(`/api/ftth/admin/connections/${connId}`, { customerName: 'Ravi K', customerPhone: newM.phone }, T);
        check('an edit cannot change the number — it points to Manage numbers', e1.status === 409 && e1.body.code === 'USE_CHANGE_NUMBER');
        const before = (await db.select().from(ftthConnections).where(eq(ftthConnections.id, connId)))[0];
        const e2 = await api.patch(`/api/ftth/admin/connections/${connId}`, { customerName: 'Ravi K', customerEmail: null, installationAddress: 'Karwar', currentPlanId: null }, T);
        const after = (await db.select().from(ftthConnections).where(eq(ftthConnections.id, connId)))[0];
        check('an edit that does not send validity leaves it exactly as it was', e2.status === 200 && after.validTill?.getTime() === before.validTill?.getTime() && after.customerName === 'Ravi K');

        // Change: strict membership.
        const notMember = `8${n9()}`;
        const c1 = await api.post(`/api/ftth/admin/connections/${connId}/phone`, { phone: notMember }, T);
        check('a number that is not a UniteFix member is refused, with what to do', c1.status === 422 && c1.body.code === 'NOT_MEMBER' && /sign up in the UniteFix app/.test(c1.body.message));
        check('a malformed number is refused', (await api.post(`/api/ftth/admin/connections/${connId}/phone`, { phone: '12345' }, T)).body?.code === 'BAD_PHONE');
        check('the current number again is refused', (await api.post(`/api/ftth/admin/connections/${connId}/phone`, { phone: oldM.phone }, T)).body?.code === 'SAME');
        const other = await api.post('/api/ftth/admin/connections', { ispConnectionId: `QAPH2-${stamp}`, customerName: 'Busy', customerPhone: busyM.phone }, T);
        const c2 = await api.post(`/api/ftth/admin/connections/${connId}/phone`, { phone: busyM.phone }, T);
        check('a member who already holds another connection with you is refused (one per partner)', other.status === 201 && c2.status === 409 && c2.body.code === 'MEMBER_HAS_CONNECTION' && c2.body.message.includes(`QAPH2-${stamp}`));

        const c3 = await api.post(`/api/ftth/admin/connections/${connId}/phone`, { phone: `+91 ${newM.phone.slice(0, 5)} ${newM.phone.slice(5)}`, reason: 'customer changed SIM' }, T);
        const conn3 = (await db.select().from(ftthConnections).where(eq(ftthConnections.id, connId)))[0];
        check('changing to a member\'s number moves the connection to their account', c3.status === 200 && conn3.customerPhone === newM.phone && conn3.userId === newM.id && /QA New Number/.test(c3.body.message), JSON.stringify(c3.body).slice(0, 200));
        check('…same subscriber: ISP id, validity and recharges unchanged', conn3.ispConnectionId === `QAPH-${stamp}` && conn3.validTill?.getTime() === before.validTill?.getTime() && (await db.select().from(ftthRecharges).where(eq(ftthRecharges.connectionId, connId))).length === 1);
        const hist = (await api.get(`/api/ftth/admin/connections/${connId}/phones`, T)).body.data.history;
        check('…the old number stays in the history, suspended, with why and when', hist.length === 2 && hist[0].phone === newM.phone && hist[0].status === 'active' && hist[0].reason === 'customer changed SIM' && hist[1].phone === oldM.phone && hist[1].status === 'suspended' && hist[1].endedReason === 'changed' && !!hist[1].endedAt);
        await new Promise(r => setTimeout(r, 300));
        const nNew = await db.select().from(notifications).where(and(eq(notifications.userId, newM.id), eq(notifications.type, 'ftth_connection_linked')));
        const nOld = await db.select().from(notifications).where(and(eq(notifications.userId, oldM.id), eq(notifications.type, 'ftth_connection_unlinked')));
        check('…both members are told', nNew.length === 1 && nOld.length === 1);
        const app = await api.get('/api/ftth/connections', jwt.sign({ userId: newM.id, role: 'user' }, SECRET, { expiresIn: '1h' }));
        check('…the new member sees it in the app', JSON.stringify(app.body).includes(`QAPH-${stamp}`), `${app.status}`);

        // A subscriber from before the history (number on file, no history row).
        const legacyM = await member('QA Legacy Member'), legacyNew = await member('QA Legacy New');
        const [legacy] = await db.insert(ftthConnections).values({ operatorId, ispConnectionId: `QAPHL-${stamp}`, customerName: 'Legacy', customerPhone: legacyM.phone, userId: legacyM.id, status: 'active' } as any).returning();
        const lh0 = (await api.get(`/api/ftth/admin/connections/${legacy.id}/phones`, T)).body.data.history;
        check('a subscriber from before the history shows its number as current', lh0.length === 1 && lh0[0].phone === legacyM.phone && lh0[0].id === 0);
        await api.post(`/api/ftth/admin/connections/${legacy.id}/phone`, { phone: legacyNew.phone }, T);
        const lh1 = (await api.get(`/api/ftth/admin/connections/${legacy.id}/phones`, T)).body.data.history;
        const oldL = lh1.find((h: any) => h.phone === legacyM.phone);
        check('…its first change records the old number, dated from when the subscriber was added, ending now',
            lh1.length === 2 && !!oldL && new Date(oldL.addedAt).getTime() <= new Date(oldL.endedAt).getTime() && Date.now() - new Date(oldL.addedAt).getTime() < 10 * 60_000,
            JSON.stringify(oldL));
        check('…and every row runs forwards in time', lh1.every((h: any) => !h.endedAt || new Date(h.addedAt).getTime() <= new Date(h.endedAt).getTime()));

        // Suspend the current number, then reactivate the old one.
        check('suspending needs a reason', (await api.post(`/api/ftth/admin/connections/${connId}/phone/suspend`, {}, T)).body?.code === 'NO_REASON');
        const s1 = await api.post(`/api/ftth/admin/connections/${connId}/phone/suspend`, { reason: 'phone lost' }, T);
        const conn4 = (await db.select().from(ftthConnections).where(eq(ftthConnections.id, connId)))[0];
        check('suspending the number takes the connection off it; the subscriber stays', s1.status === 200 && conn4.customerPhone === null && conn4.userId === null && conn4.status === 'active');
        const h2 = (await api.get(`/api/ftth/admin/connections/${connId}/phones`, T)).body.data.history;
        check('…and the history shows both numbers suspended, with the reason', h2.length === 2 && h2.every((h: any) => h.status === 'suspended') && /phone lost/.test(h2[0].endedReason));
        const oldRow = h2.find((h: any) => h.phone === oldM.phone);
        const r1 = await api.post(`/api/ftth/admin/connections/${connId}/phones/${oldRow.id}/reactivate`, {}, T);
        const conn5 = (await db.select().from(ftthConnections).where(eq(ftthConnections.id, connId)))[0];
        const h3 = (await db.select().from(ftthConnectionPhones).where(eq(ftthConnectionPhones.connectionId, connId)));
        check('a previous number can be made current again (a new history row; old rows untouched)', r1.status === 200 && conn5.customerPhone === oldM.phone && conn5.userId === oldM.id && h3.length === 3 && h3.filter(h => h.status === 'active').length === 1);

        // Remove → closed (has a recharge); closed cannot be edited; reopen.
        const list = await api.get('/api/ftth/admin/connections?filter=all', T);
        const row = list.body.data.find((x: any) => x.id === connId);
        check('the list shows the partner\'s number, whether it is on the app, and the recharge count', row?.customerPhone === oldM.phone && row.linked === true && row.rechargeCount === 1);
        await api.del(`/api/ftth/admin/connections/${connId}`, T);
        check('removing a subscriber with recharges closes them', (await db.select().from(ftthConnections).where(eq(ftthConnections.id, connId)))[0].status === 'closed');
        check('the Closed filter lists them', (await api.get('/api/ftth/admin/connections?filter=closed', T)).body.data.some((x: any) => x.id === connId));
        check('a closed subscriber cannot be edited', (await api.patch(`/api/ftth/admin/connections/${connId}`, { customerName: 'X' }, T)).body?.code === 'CLOSED');
        check('…nor have its number changed', (await api.post(`/api/ftth/admin/connections/${connId}/phone`, { phone: newM.phone }, T)).body?.code === 'CLOSED');
        check('…nor be suspended or reactivated — only reopened', (await api.post(`/api/ftth/admin/connections/${connId}/status`, { action: 'reactivate' }, T)).status === 409);
        const ro = await api.post(`/api/ftth/admin/connections/${connId}/status`, { action: 'reopen' }, T);
        check('reopen brings them back as they were', ro.status === 200 && (await db.select().from(ftthConnections).where(eq(ftthConnections.id, connId)))[0].status === 'active');
        check('reopen only applies to a closed subscriber', (await api.post(`/api/ftth/admin/connections/${connId}/status`, { action: 'reopen' }, T)).status === 409);

        // Import: never changes a number on file, never reopens or unsuspends.
        await api.post(`/api/ftth/admin/connections/${other.body.data.id}/status`, { action: 'suspend' }, T);
        const imp = await FtthService.bulkImportCustomers({
            operatorId, mappings: { ispConnectionId: 'id', customerName: 'name', customerPhone: 'phone' } as any,
            rows: [{ id: `QAPH-${stamp}`, name: 'Ravi Kumar', phone: newM.phone }, { id: `QAPH2-${stamp}`, name: 'Busy', phone: busyM.phone }],
        } as any).catch((e: any) => ({ error: e.message }));
        const conn6 = (await db.select().from(ftthConnections).where(eq(ftthConnections.id, connId)))[0];
        const busy6 = (await db.select().from(ftthConnections).where(eq(ftthConnections.id, other.body.data.id)))[0];
        check('an import with a different number leaves the number on file and lists the row', !('error' in imp) && conn6.customerPhone === oldM.phone && conn6.userId === oldM.id && (imp as any).numberChangesSkipped?.some((x: any) => x.ispConnectionId === `QAPH-${stamp}`), JSON.stringify(imp).slice(0, 200));
        check('…and does not lift a suspension', busy6.status === 'suspended');

        // Console: data-changing statements are never "reads".
        for (const q of ['WITH x AS (UPDATE users SET username = \'a\' RETURNING id) SELECT * FROM x', 'SELECT 1; DELETE FROM users', 'EXPLAIN ANALYZE DELETE FROM users', 'SELECT * INTO copy_users FROM users', '/* note */ delete from users'])
            check(`console treats as a write: ${q.slice(0, 40)}`, classify(q).readOnly === false);
        for (const q of ['SELECT id FROM users WHERE username = \'update me; delete\'', 'WITH t AS (SELECT 1) SELECT * FROM t', 'select created_at from audit_logs'])
            check(`console still treats as a read: ${q.slice(0, 40)}`, classify(q).readOnly === true);
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const { sql } = await import('drizzle-orm');
    const uids = userIds.join(',') || '0';
    const conns = operatorId ? (await db.select({ id: ftthConnections.id }).from(ftthConnections).where(eq(ftthConnections.operatorId, operatorId))).map(c => c.id) : [];
    const cids = conns.join(',') || '0';
    for (const st of [
        `DELETE FROM ftth_connection_phones WHERE connection_id IN (${cids})`,
        `DELETE FROM ftth_recharges WHERE connection_id IN (${cids})`,
        `DELETE FROM audit_logs WHERE entity_type = 'ftth_connection' AND entity_id IN (${cids})`,
        `DELETE FROM ftth_connections WHERE id IN (${cids})`,
        `DELETE FROM ftth_plans WHERE operator_id = ${operatorId || 0}`,
        `DELETE FROM ftth_operators WHERE id = ${operatorId || 0}`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
        `DELETE FROM admin_users WHERE id IN (${adminIds.join(',') || 0})`,
    ]) { try { await db.execute(sql.raw(st)); } catch (e: any) { console.error('cleanup', st.slice(0, 60), e.message); } }
    process.exit(summary());
});
