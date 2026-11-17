/**
 * Two gaps found while tracing tenant isolation (FTTH operators, Partner Hub).
 *
 *  1. FTTH customer bulk import: a STAFF login names the operator, so it needs
 *     the FTTH manage capability on every path — not only under /api/admin.
 *  2. B2B portal (/api/b2b/*): a portal login that staff switch off or remove
 *     is refused at once, not when its 8-hour token runs out.
 *
 *   npm run smoke:tenant-fixes
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, adminRoles, adminRoleCapabilities, businessPartners } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [], roleIds: number[] = [], bpIds: number[] = [];

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;

    const makeStaff = async (tag: string, capabilities: string[]) => {
        const [role] = await db.insert(adminRoles).values({ slug: `qa_ten_${tag}_${stamp}`, name: `QA Ten ${tag} ${stamp}`, scope: 'staff' } as any).returning();
        roleIds.push(role.id);
        if (capabilities.length) await db.insert(adminRoleCapabilities).values(capabilities.map(capability => ({ roleId: role.id, capability })));
        const password = `Staff-${tag}-${stamp}-pw!`;
        const [row] = await db.insert(adminUsers).values({ username: `qa_ten_${tag}_${stamp}`, email: `qa_ten_${tag}_${stamp}@example.test`, password: await bcrypt.hash(password, 10), role: role.slug, roleId: role.id, isActive: true } as any).returning();
        adminIds.push(row.id);
        return (await api.login(row.username, password))!;
    };

    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;

        // ══ 1. FTTH bulk import, staff side ══
        const support = await makeStaff('support', ['support:view']);
        const ftthStaff = await makeStaff('ftth', ['ftth:manage']);
        // An operator id that does not exist: nothing can be written, whoever gets through.
        const body = { operatorId: 999999999, mappings: { ispConnectionId: 'id', customerName: 'name', customerPhone: 'phone' }, rows: [{ id: `QA-${stamp}`, name: 'QA Tenant', phone: '9000000000' }] };
        for (const path of ['/api/ftth/staff/customers/bulk-import', '/api/ftth/admin/customers/bulk-import', '/api/admin/ftth/customers/bulk-import']) {
            const r = await api.post(path, body, support);
            check(`a staff role without FTTH access cannot bulk-import through ${path}`, r.status === 403, `${r.status} ${r.body?.code ?? ''}`);
        }
        for (const [who, t] of [['a role with FTTH manage', ftthStaff], ['a super admin', S]] as const) {
            const r = await api.post('/api/ftth/staff/customers/bulk-import', body, t);
            check(`…${who} gets past the access check`, r.status !== 403 && r.status !== 401, `${r.status}`);
        }

        // ══ 2. B2B portal login liveness ══
        const bp = await BusinessPartnerService.create({ legalName: `QA Tenant ${stamp}`, contactPhone: `6${String(Date.now()).slice(-9)}`, contactEmail: null, verticalCodes: ['electrical'], approvedByAdminId: sa.id } as any);
        bpIds.push(bp.id);
        const [owner] = await db.insert(adminUsers).values({ username: `qa_ten_owner_${stamp}`, email: `qa_ten_owner_${stamp}@example.test`, password: await bcrypt.hash(`Owner-${stamp}`, 10), role: 'partner', isActive: true } as any).returning();
        adminIds.push(owner.id);
        await db.update(businessPartners).set({ adminUserId: owner.id, status: 'active' } as any).where(eq(businessPartners.id, bp.id));
        const portal = jwt.sign({ userId: owner.id, role: 'partner' }, SECRET, { expiresIn: '8h' });

        const live = await api.get('/api/b2b/me', portal);
        check('a live portal login reaches the B2B portal', live.status === 200, `${live.status} ${live.body?.message ?? ''}`);
        await db.update(adminUsers).set({ isActive: false }).where(eq(adminUsers.id, owner.id));
        const off = await api.get('/api/b2b/me', portal);
        check('…switched off by staff, the same token is refused at once', off.status === 403 && off.body?.code === 'LOGIN_DISABLED', `${off.status} ${off.body?.code ?? ''}`);
        await db.update(adminUsers).set({ isActive: true, deletedAt: new Date() } as any).where(eq(adminUsers.id, owner.id));
        const removed = await api.get('/api/b2b/me', portal);
        check('…and so is a removed login', removed.status === 403, `${removed.status}`);
    } finally {
        await cleanupPartners(bpIds, adminIds, [
            `DELETE FROM admin_role_capabilities WHERE role_id IN (${roleIds.join(',') || 0})`,
            `DELETE FROM audit_logs WHERE changed_by IN (${adminIds.join(',') || 0}) AND created_at > now() - interval '1 hour'`,
        ]);
        await db.delete(adminRoles).where(eq(adminRoles.id, roleIds[0] ?? 0)).catch(() => {});
        for (const id of roleIds.slice(1)) await db.delete(adminRoles).where(eq(adminRoles.id, id)).catch(() => {});
        await close();
    }
    process.exit(summary());
}

main().catch(e => { console.error(e); process.exit(1); });
