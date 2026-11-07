/**
 * A service's "typical duration" (services.duration_label): staff set it in the
 * admin catalogue, the app's category page shows it with a clock.
 *
 *   npx tsx scripts/smoke-service-duration.ts
 */

import { inArray, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { serviceCategories, services } from '../shared/schema';

const stamp = Date.now().toString(36);
const catIds: number[] = [], svcIds: number[] = [], adminIds: number[] = [];

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = await api.login(sa.username, sa.password);
        const [cat] = await db.insert(serviceCategories).values({ name: `QA Plumbing ${stamp}`, sortOrder: -400 } as any).returning(); catIds.push(cat.id);

        const made = await api.post('/api/admin/catalog/services', { categoryId: cat.id, name: `QA Tap fitting ${stamp}`, basePrice: 349, status: 'ACTIVE', isActive: true, durationLabel: '  30–45   mins ' }, S);
        if (made.body?.data?.id) svcIds.push(made.body.data.id);
        check('staff create a service with a typical duration; spaces are tidied', made.status === 200 && made.body.data.durationLabel === '30–45 mins', JSON.stringify(made.body));
        const id = made.body.data.id;

        const long = await api.patch(`/api/admin/catalog/services/${id}`, { durationLabel: 'x'.repeat(90) }, S);
        check('a duration is kept to 40 characters', long.status === 200 && long.body.data.durationLabel?.length === 40);

        const other = await api.patch(`/api/admin/catalog/services/${id}`, { basePrice: 399 }, S);
        check('editing something else leaves the duration alone', other.status === 200 && other.body.data.durationLabel?.length === 40 && other.body.data.basePrice === 399);

        await api.patch(`/api/admin/catalog/services/${id}`, { durationLabel: '45–60 mins' }, S);
        const pub = await api.get('/api/services/categories');
        const item = (pub.body?.data ?? []).find((c: any) => c.id === cat.id)?.items?.find((s: any) => s.id === id);
        check('the app\'s catalogue carries the duration', item?.durationLabel === '45–60 mins', JSON.stringify(item ?? null));

        const blank = await api.patch(`/api/admin/catalog/services/${id}`, { durationLabel: '   ' }, S);
        check('blanking it hides it (null)', blank.status === 200 && blank.body.data.durationLabel === null);

        const anon = await api.patch(`/api/admin/catalog/services/${id}`, { durationLabel: '1 min' });
        check('only staff can change it', anon.status === 401 || anon.status === 403, String(anon.status));
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    if (svcIds.length) await db.delete(services).where(inArray(services.id, svcIds));
    if (catIds.length) await db.delete(serviceCategories).where(inArray(serviceCategories.id, catIds));
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id IN (${adminIds.join(',') || '0'})`)).catch(() => {});
    process.exit(summary());
});
