/**
 * Account deletion is a request UniteFix approves or denies.
 *
 *   npm run smoke:account-deletion
 */

import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db, cleanupPartners } from './lib/hub-test-kit';
import { users, employees, partnerWallets, accountDeletionRequests, refreshTokens } from '../shared/schema';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [];

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    const n = () => String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-9);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const st = (await api.login(sa.username, sa.password))!;
        const mk = async (role: 'user' | 'serviceman', name: string) => {
            const [u] = await db.insert(users).values({ phone: `${role === 'user' ? 8 : 9}${n()}`, username: name, role, homeAddress: 'Sirsi 581401', pinCode: '581401', isActive: true } as any).returning();
            userIds.push(u.id);
            return { u, t: jwt.sign({ userId: u.id, role }, SECRET, { expiresIn: '1h' }) };
        };
        const C = await mk('user', 'QA Leaving Customer');
        const L = await mk('user', 'QA Legacy Customer');

        const g0 = await api.get('/api/client/account/deletion-request', C.t);
        check('no request yet; the reasons to choose from', g0.status === 200 && g0.body.data.request === null && g0.body.data.reasons.length >= 5);
        check('a reason must be chosen', (await api.post('/api/client/account/deletion-request', { reasonCategory: 'nope', reason: 'I just do not use it any more.' }, C.t)).body?.code === 'NO_CATEGORY');
        check('…and a few words written', (await api.post('/api/client/account/deletion-request', { reasonCategory: 'not_using', reason: 'bye' }, C.t)).body?.code === 'NO_REASON');
        const r1 = await api.post('/api/client/account/deletion-request', { reasonCategory: 'not_using', reason: 'I moved to Pune and no longer need home services here.' }, C.t);
        check('the customer sends a request', r1.status === 201 && r1.body.data.status === 'pending');
        check('only one open request at a time', (await api.post('/api/client/account/deletion-request', { reasonCategory: 'other', reason: 'Asking a second time today.' }, C.t)).status === 409);
        const [u1] = await db.select().from(users).where(eq(users.id, C.u.id));
        check('the account keeps working while it is reviewed', u1.isActive === true && !u1.deletedAt && (await api.get('/api/client/account/deletion-request', C.t)).status === 200);
        const ov = await api.get('/api/admin/reports/overview?range=7d', st);
        check('the admin dashboard flags requests to review', ov.body?.data?.attention?.some((a: any) => a.key === 'deletions' && a.count >= 1), JSON.stringify(ov.body?.data?.attention?.map((a: any) => a.key)));

        const w = await api.del('/api/client/account/deletion-request', C.t);
        check('the customer can withdraw it', w.status === 200 && w.body.data.status === 'cancelled');
        check('…once', (await api.del('/api/client/account/deletion-request', C.t)).status === 404);

        // Denied, with a note the customer sees.
        await api.post('/api/client/account/deletion-request', { reasonCategory: 'privacy', reason: 'I do not want my address stored any more.' }, C.t);
        const list = await api.get('/api/admin/accounts/deletion-requests?status=pending', st);
        const mine = list.body?.data?.requests?.find((r: any) => r.userId === C.u.id);
        check('staff see it with the reason and what is still open', !!mine && mine.reasonLabel === 'Privacy concerns' && Array.isArray(mine.impact?.blockers) && mine.impact.blockers.length === 0 && list.body.data.pending >= 1);
        check('denying needs a note', (await api.post(`/api/admin/accounts/deletion-requests/${mine.id}/deny`, { note: '' }, st)).status === 400);
        const d = await api.post(`/api/admin/accounts/deletion-requests/${mine.id}/deny`, { note: 'Your booking on 12 Oct is still open. Complete or cancel it, then ask again.' }, st);
        const g1 = await api.get('/api/client/account/deletion-request', C.t);
        check('denied: the customer sees why', d.status === 200 && g1.body.data.request.status === 'denied' && /12 Oct/.test(g1.body.data.request.adminNote));
        check('a decided request cannot be decided again', (await api.post(`/api/admin/accounts/deletion-requests/${mine.id}/approve`, {}, st)).status === 409);

        // Approved: closed and signed out.
        await db.insert(refreshTokens).values({ userId: C.u.id, tokenHash: `qa-${stamp}-${C.u.id}`, userRole: 'user', expiresAt: new Date(Date.now() + 86_400_000) } as any);
        const again = await api.post('/api/client/account/deletion-request', { reasonCategory: 'moving', reason: 'Moving abroad for work next month.' }, C.t);
        const ap = await api.post(`/api/admin/accounts/deletion-requests/${again.body.data.id}/approve`, { note: 'Checked — nothing open.' }, st);
        const [u2] = await db.select().from(users).where(eq(users.id, C.u.id));
        const tokens = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, C.u.id));
        check('approved: the account is closed and its sessions revoked', ap.status === 200 && u2.isActive === false && !!u2.deletedAt && tokens.length === 0);
        check('…and its token stops working at once', (await api.get('/api/client/account/deletion-request', C.t)).status === 403);

        // An expert with money in the wallet.
        const E = await mk('serviceman', 'QA Leaving Expert');
        const [emp] = await db.insert(employees).values({ userId: E.u.id, fullName: 'QA Leaving Expert', isActive: true, documentVerificationStatus: 'verified' as any } as any).returning();
        await db.insert(partnerWallets).values({ partnerId: emp.id, balanceAvailable: '640.00', balanceHold: '0.00' } as any);
        const er = await api.post('/api/client/account/deletion-request', { reasonCategory: 'other', reason: 'Joining a company full time, no more freelance jobs.' }, E.t);
        const blocked = await api.post(`/api/admin/accounts/deletion-requests/${er.body.data.id}/approve`, {}, st);
        check('an expert with ₹640 in the wallet is not closed by accident', blocked.status === 409 && /640/.test(blocked.body?.message ?? ''), blocked.body?.message);
        const forced = await api.post(`/api/admin/accounts/deletion-requests/${er.body.data.id}/approve`, { force: true, note: 'Paid out by bank transfer.' }, st);
        const [e2] = await db.select().from(employees).where(eq(employees.id, emp.id));
        check('…unless staff deliberately approve anyway; the expert is taken off duty', forced.status === 200 && e2.isActive === false && e2.documentVerificationStatus === 'suspended');

        // An older app's one-tap delete files a request instead.
        const old = await api.del('/api/client/account', L.t, );
        const old2 = await fetch(`${base}/api/client/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${L.t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmDelete: true }) }).then(r => r.json());
        const [lr] = await db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.userId, L.u.id));
        const [lu] = await db.select().from(users).where(eq(users.id, L.u.id));
        check('an older app version\'s delete becomes a request — nothing is deleted', old.status === 400 && old2.success === true && lr?.source === 'legacy_app' && lr.status === 'pending' && lu.isActive === true && !lu.deletedAt, JSON.stringify(old2));
    } finally {
        const uids = userIds.join(',') || '0';
        await cleanupPartners([], adminIds, [
            `DELETE FROM account_deletion_requests WHERE user_id IN (${uids})`,
            `DELETE FROM audit_logs WHERE entity_type = 'user' AND entity_id IN (${uids})`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM partner_wallets WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
            `DELETE FROM employees WHERE user_id IN (${uids})`,
            `DELETE FROM refresh_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM users WHERE id IN (${uids})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(e => { console.error(e); process.exit(1); });
