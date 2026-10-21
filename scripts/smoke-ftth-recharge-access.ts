/**
 * Broadband: who can find a connection in the app, who it links to, and who
 * can recharge it. The reported fault: customers saw their connection, tapped
 * recharge and got "Connection not found".
 *
 *   npm run smoke:ftth-recharge-access
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { eq, inArray } from 'drizzle-orm';
import { bootServer, client, check, summary, db } from './lib/hub-test-kit';
import { users, adminUsers, ftthOperators, ftthConnections, ftthPlans, ftthIdRequests } from '../shared/schema';

const stamp = Date.now().toString(36);
const n9 = () => String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-9);
const userIds: number[] = [], adminIds: number[] = [];
let operatorId = 0;

async function main() {
    // No payment provider in tests: an initiate that passes every check ends in
    // "Payments are unavailable" (503) instead of creating a real order.
    for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']) delete process.env[k];
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        const [admin] = await db.insert(adminUsers).values({ username: `qa_ra_${stamp}`, email: `qa_ra_${stamp}@example.test`, password: await bcrypt.hash('x-pass-123', 10), role: 'operator', isActive: true } as any).returning();
        adminIds.push(admin.id);
        const [op] = await db.insert(ftthOperators).values({ adminUserId: admin.id, companyName: 'QA Access ISP', contactEmail: `qa_ra_${stamp}@example.test`, contactPhone: `9${n9()}`, status: 'active' } as any).returning();
        operatorId = op.id;
        const T = jwt.sign({ userId: admin.id, role: 'operator' }, SECRET, { expiresIn: '1h' });
        const [plan] = await db.insert(ftthPlans).values({ operatorId, name: 'QA 50', speedMbps: 50, durationMonths: 1, listPricePaise: 49900, isActive: true } as any).returning();
        const member = async (name: string) => {
            const phone = `9${n9()}`;
            const [u] = await db.insert(users).values({ phone: `+91${phone}`, username: name, role: 'user', isActive: true, email: `qa.ra.${stamp}.${userIds.length}@example.test` } as any).returning();
            userIds.push(u.id);
            return { id: u.id, phone, token: jwt.sign({ userId: u.id, role: 'user' }, SECRET, { expiresIn: '1h' }) };
        };
        const lookup = (m: { token: string }, query: string) => api.post('/api/ftth/customers/lookup', { operatorId, query }, m.token);
        const recharge = (m: { token: string }, connectionId: number) => api.post('/api/ftth/recharges/initiate', { connectionId, planId: plan.id }, m.token);
        const passedChecks = (r: any) => r.status === 200 || (r.status === 503 && /Payments are unavailable/.test(r.body?.message ?? ''));
        const conn = async (id: number) => (await db.select().from(ftthConnections).where(eq(ftthConnections.id, id)))[0];

        const owner = await member('QA Owner'), other = await member('QA Other');

        // 1. A connection on the owner's number, linked to them.
        const a = await api.post('/api/ftth/admin/connections', { ispConnectionId: `QARA-${stamp}-1`, customerName: 'Ravi Kumar', customerPhone: owner.phone, customerEmail: 'ravi.private@example.test' }, T);
        const c1 = a.body.data.id;
        const own = await lookup(owner, `QARA-${stamp}-1`);
        check('the owner finds their connection by its ID', own.body.exists === true && own.body.data.id === c1);
        check('…and can recharge it', passedChecks(await recharge(owner, c1)));
        const byPhone = await lookup(owner, `+91 ${owner.phone.slice(0, 5)} ${owner.phone.slice(5)}`);
        check('the owner finds it by their number typed with +91 and spaces', byPhone.body.exists === true && byPhone.body.data.id === c1);
        const spaced = await lookup(owner, ` qara-${stamp}-1 `);
        check('…and by the ID typed in lower case with spaces', spaced.body.exists === true && spaced.body.data.id === c1);

        // 2. Someone else types the owner's ID.
        const peek = await lookup(other, `QARA-${stamp}-1`);
        const leaked = JSON.stringify(peek.body);
        check('another member typing that ID does not see the owner\'s phone, email or full name', !leaked.includes(owner.phone) && !leaked.includes('ravi.private') && !leaked.includes('Ravi Kumar'), leaked.slice(0, 300));
        check('…is told it is linked to another account, and what to do (a 409 the app shows)', peek.status === 409 && peek.body.code === 'NOT_YOUR_CONNECTION' && peek.body.data?.access === 'other_member' && /link request/i.test(peek.body.message ?? ''), leaked.slice(0, 300));
        const r2 = await recharge(other, c1);
        check('…and a recharge attempt says why, not "Connection not found"', r2.status === 403 && r2.body.code === 'NOT_YOUR_CONNECTION' && !/not found/i.test(r2.body.message), JSON.stringify(r2.body));
        check('…and the connection stays with its owner', (await conn(c1)).userId === owner.id);

        // 3. An unlinked connection: claimed only by the member on its number.
        const stranger = await member('QA Stranger');
        const realPhone = `8${n9()}`;   // not a member yet
        const b = await api.post('/api/ftth/admin/connections', { ispConnectionId: `QARA-${stamp}-2`, customerName: 'Sita Rao', customerPhone: realPhone }, T);
        const c2 = b.body.data.id;
        const grab = await lookup(stranger, `QARA-${stamp}-2`);
        check('a member whose number is not the one on file cannot claim an unlinked connection by typing its ID', (await conn(c2)).userId === null && grab.body.data?.access === 'other_number', JSON.stringify(grab.body).slice(0, 300));
        const [real] = await db.insert(users).values({ phone: realPhone, username: 'QA Real', role: 'user', isActive: true } as any).returning();
        userIds.push(real.id);
        const realM = { id: real.id, phone: realPhone, token: jwt.sign({ userId: real.id, role: 'user' }, SECRET, { expiresIn: '1h' }) };
        const mine = await lookup(realM, `QARA-${stamp}-2`);
        check('the member on that number finds it and it links to them', mine.body.exists === true && (await conn(c2)).userId === real.id && mine.body.data.access === 'mine');
        check('…and they can recharge', passedChecks(await recharge(realM, c2)));

        // 3b. No number on file: the first member to claim it by ID gets it, and
        // their number is recorded, so the operator sees who and can undo it.
        const d = await api.post('/api/ftth/admin/connections', { ispConnectionId: `QARA-${stamp}-3`, customerName: 'No Phone' }, T);
        const c3 = d.body.data.id;
        const claim = await lookup(stranger, `QARA-${stamp}-3`);
        const c3row = await conn(c3);
        check('a connection with no number on file: claimed by ID, and the claimant\'s number is put on file', claim.body.data?.access === 'mine' && c3row.userId === stranger.id && c3row.customerPhone === stranger.phone);
        const hist = await api.get(`/api/ftth/admin/connections/${c3}/phones`, T);
        check('…and the operator\'s number history shows it was linked from the app', hist.body.data?.history?.[0]?.phone === stranger.phone && /app/i.test(hist.body.data?.history?.[0]?.reason ?? ''), JSON.stringify(hist.body.data?.history ?? hist.body).slice(0, 200));

        // 3c. Claimed the old way: linked to someone whose number is not the one
        // on file. The member on that number gets it back when they look it up.
        const ownerOfNumber = await member('QA Number Owner');
        const [hijacked] = await db.insert(ftthConnections).values({ operatorId, ispConnectionId: `QARA-${stamp}-4`, customerName: 'Meera Naik', customerPhone: ownerOfNumber.phone, userId: stranger.id, status: 'active' } as any).returning();
        const strangerSees = await lookup(stranger, `QARA-${stamp}-4`);
        check('…while the claimer still holds it, they still see it as theirs (no change until the number owner acts)', strangerSees.status === 200 && strangerSees.body.data.access === 'mine');
        const back = await lookup(ownerOfNumber, ownerOfNumber.phone);
        check('a connection claimed the old way by someone not on its number: the member on that number gets it when they look it up', back.status === 200 && back.body.data.access === 'mine' && (await conn(hijacked.id)).userId === ownerOfNumber.id, JSON.stringify(back.body).slice(0, 200));
        check('…and the previous holder is told', (await db.execute((await import('drizzle-orm')).sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${stranger.id} AND type = 'ftth_connection_unlinked'`) as any).rows[0].n >= 1);
        check('…and it does not flip back when the previous holder looks again', (await lookup(stranger, `QARA-${stamp}-4`)).status === 409 && (await conn(hijacked.id)).userId === ownerOfNumber.id);

        // 4. Closed and duplicate rows do not shadow the live one.
        await db.insert(ftthConnections).values({ operatorId, ispConnectionId: `QARA-${stamp}-OLD`, customerName: 'Old', customerPhone: owner.phone, status: 'closed', userId: null, createdAt: new Date(Date.now() + 1000) } as any);
        const again = await lookup(owner, owner.phone);
        check('a closed connection on the same number does not shadow the live one', again.body.exists === true && again.body.data.id === c1, JSON.stringify(again.body).slice(0, 200));

        // 5. The way out for a connection on someone else's number: an ID request
        // the operator approves, which moves the existing connection to the
        // requester (refused before: "already mapped to another UniteFix account").
        const ask = await api.post('/api/ftth/id-requests', { operatorId, claimedName: 'Ravi Kumar', claimedPhone: other.phone, claimedIspId: `QARA-${stamp}-1` }, other.token);
        check('the other member can ask the operator to link that ID to them', ask.status === 201, JSON.stringify(ask.body));
        const reqId = ask.body.data?.requestId;
        const ok = await api.post(`/api/ftth/admin/id-requests/${reqId}/approve`, { ispConnectionId: `QARA-${stamp}-1` }, T);
        const moved = await conn(c1);
        check('the operator approves it for an ID already on their list: the existing connection moves to the requester', ok.status === 200 && moved.userId === other.id && moved.customerPhone === other.phone && ok.body.data?.connectionId === c1, JSON.stringify(ok.body));
        const h1 = await api.get(`/api/ftth/admin/connections/${c1}/phones`, T);
        check('…the owner\'s number stays in the history', (h1.body.data?.history ?? []).some((h: any) => h.phone === owner.phone && h.status === 'suspended'));
        const r5 = await recharge(other, c1);
        check('…and now they can recharge it', passedChecks(r5), JSON.stringify(r5.body));
        check('…and only one connection has that ID', (await db.select().from(ftthConnections).where(eq(ftthConnections.ispConnectionId, `QARA-${stamp}-1`))).length === 1);

        // 6. An order that is already open does not lock the customer out.
        const { ftthRecharges } = await import('../shared/schema');
        const { sql } = await import('drizzle-orm');
        const openRows = await db.select().from(ftthRecharges).where(eq(ftthRecharges.connectionId, c2));
        check('a payment order Razorpay could not create is closed at once, not left "in progress"', openRows.length > 0 && openRows.every(r => r.status === 'failed'), openRows.map(r => r.status).join(','));
        const [fresh] = await db.insert(ftthRecharges).values({ connectionId: c2, planId: plan.id, userId: realM.id, planName: 'QA 50', speedMbps: 50, durationMonths: 1, listPricePaise: 49900, totalPaise: 49900, operatorPayablePaise: 45000, platformRevenuePaise: 4900, status: 'pending', razorpayOrderId: `order_qa_${stamp}_1` } as any).returning();
        const tap = await recharge(realM, c2);
        check('a second tap within a minute of opening the payment sheet: "already in progress"', tap.status === 409 && tap.body.code === 'RECHARGE_IN_PROGRESS');
        await db.execute(sql`UPDATE ftth_recharges SET created_at = now() - interval '5 minutes' WHERE id = ${fresh.id}`);
        const retry = await recharge(realM, c2);
        const old = (await db.select().from(ftthRecharges).where(eq(ftthRecharges.id, fresh.id)))[0];
        check('a payment sheet closed 5 minutes ago: the customer can start again (not blocked until the sweep)', passedChecks(retry) && old.status === 'failed' && /Superseded/.test(old.failureReason ?? ''), `${JSON.stringify(retry.body)} ${old.status}`);
        const { FtthService } = await import('../server/services/ftth.service');
        const before6 = (await conn(c2)).validTill?.getTime() ?? 0;
        const late = await FtthService.applyCapture({ razorpayOrderId: `order_qa_${stamp}_1`, razorpayPaymentId: `pay_qa_${stamp}_1` });
        const after6 = await conn(c2);
        check('…and if the old order is paid after all, the recharge is still applied', late.applied && (after6.validTill?.getTime() ?? 0) > before6, JSON.stringify(late));
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const op = operatorId || 0, uids = userIds.join(',') || '0';
    const { sql } = await import('drizzle-orm');
    for (const q of [
        `DELETE FROM ftth_connection_phones WHERE connection_id IN (SELECT id FROM ftth_connections WHERE operator_id = ${op})`,
        `DELETE FROM ftth_operator_ledger WHERE operator_id = ${op}`,
        `DELETE FROM payment_transactions WHERE ftth_recharge_id IN (SELECT r.id FROM ftth_recharges r JOIN ftth_connections c ON c.id = r.connection_id WHERE c.operator_id = ${op})`,
        `DELETE FROM ftth_recharges WHERE connection_id IN (SELECT id FROM ftth_connections WHERE operator_id = ${op})`,
        `DELETE FROM ftth_id_requests WHERE operator_id = ${op}`,
        `DELETE FROM ftth_connections WHERE operator_id = ${op}`,
        `DELETE FROM ftth_plans WHERE operator_id = ${op}`,
        `DELETE FROM ftth_operators WHERE id = ${op}`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM audit_logs WHERE entity_type = 'ftth_connection' AND (metadata->>'operatorId')::int = ${op}`,
        `DELETE FROM users WHERE id IN (${uids})`,
        `DELETE FROM admin_users WHERE id IN (${adminIds.join(',') || '0'})`,
    ]) { try { await db.execute(sql.raw(q)); } catch (e: any) { console.error('cleanup:', e.message); } }
    process.exit(summary());
});
