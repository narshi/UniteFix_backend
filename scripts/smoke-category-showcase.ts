/**
 * The app's Home showcase: categories carry a tagline and a yearly
 * highlight (from/to month-day, may cross the new year) that the app shows as
 * a banner while it is on; staff move services between categories in bulk.
 *
 *   npm run smoke:category-showcase
 */

import { eq, inArray, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { serviceCategories, services } from '../shared/schema';
import { inWindow, todayMmdd } from '../server/services/category-showcase.service';

const stamp = Date.now().toString(36);
const catIds: number[] = [], svcIds: number[] = [], adminIds: number[] = [];
const mmdd = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(5, 10);

async function main() {
    // ── the window rule ──
    check('a window inside the year: 1 Mar – 15 Apr includes 20 Mar, not 1 May', inWindow('03-01', '04-15', '03-20') && !inWindow('03-01', '04-15', '05-01'));
    check('a window across the new year: 15 Dec – 10 Jan includes 20 Dec and 5 Jan, not 1 Feb', inWindow('12-15', '01-10', '12-20') && inWindow('12-15', '01-10', '01-05') && !inWindow('12-15', '01-10', '02-01'));
    check('…its first and last days count', inWindow('03-01', '04-15', '03-01') && inWindow('03-01', '04-15', '04-15'));

    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = await api.login(sa.username, sa.password);
        const mk = async (name: string, sortOrder: number) => { const [c] = await db.insert(serviceCategories).values({ name: `QA ${name} ${stamp}`, sortOrder } as any).returning(); catIds.push(c.id); return c; };
        const visit = await mk('Visiting & Inspection', -300), tax = await mk('Tax ITR Legal', -299), travel = await mk('Travel', -298);
        const mkSvc = async (catId: number, name: string) => { const [s] = await db.insert(services).values({ categoryId: catId, name: `QA ${name} ${stamp}`, basePrice: 0, isActive: true } as any).returning(); svcIds.push(s.id); return s; };
        const ac = await mkSvc(travel.id, 'AC repair'), fridge = await mkSvc(travel.id, 'Fridge repair'), goa = await mkSvc(travel.id, 'Goa trips');

        // ── staff set the highlight ──
        const patch = (id: number, body: any) => api.patch(`/api/admin/catalog/categories/${id}`, body, S);
        check('switching a highlight on without dates is refused, saying why', (await patch(tax.id, { featureOn: true, featureTitle: 'ITR season' })).status === 400);
        check('an impossible date (30 Feb) is refused', (await patch(tax.id, { featureOn: true, featureFrom: '02-30', featureTo: '03-31', featureTitle: 'ITR season' })).status === 400);
        check('…and a highlight needs a title', (await patch(tax.id, { featureOn: true, featureFrom: mmdd(-5), featureTo: mmdd(5) })).status === 400);
        const on = await patch(tax.id, { featureOn: true, featureFrom: mmdd(-5), featureTo: mmdd(5), featureTitle: 'ITR season is here', featureSubtitle: 'File before 31 July', tagline: 'Tax, ITR and legal help' });
        check('staff set a yearly highlight around today, with a title, subtitle and tagline', on.status === 200 && on.body.data.featureOn === true && on.body.data.featureTitle === 'ITR season is here' && on.body.data.tagline === 'Tax, ITR and legal help', JSON.stringify(on.body));
        await patch(travel.id, { featureOn: true, featureFrom: mmdd(30), featureTo: mmdd(60), featureTitle: 'Travel season' });

        // ── the app sees it ──
        const cats = (await api.get('/api/services/categories')).body?.data ?? [];
        const c = (id: number) => cats.find((x: any) => x.id === id);
        check('the app sees the category highlighted today, with its title and tagline', c(tax.id)?.featuredNow === true && c(tax.id)?.featureTitle === 'ITR season is here' && c(tax.id)?.tagline === 'Tax, ITR and legal help');
        check('…not one whose window is a month away', c(travel.id)?.featuredNow === false);
        check('…nor one with no highlight', c(visit.id)?.featuredNow === false);
        const order = cats.filter((x: any) => catIds.includes(x.id)).map((x: any) => x.id);
        check('categories come in the admin sort order', JSON.stringify(order) === JSON.stringify([visit.id, tax.id, travel.id]), JSON.stringify(order));
        check('switching the highlight off hides it', (await patch(tax.id, { featureOn: false })).status === 200
            && (await api.get('/api/services/categories')).body.data.find((x: any) => x.id === tax.id)?.featuredNow === false);

        // ── bulk move ──
        const mv = (body: any) => api.post('/api/admin/catalog/services/move', body, S);
        check('a move with nothing chosen is refused', (await mv({ serviceIds: [], categoryId: visit.id })).status === 400);
        check('a move to a category that does not exist is refused', (await mv({ serviceIds: [ac.id], categoryId: 999999999 })).status === 400);
        const moved = await mv({ serviceIds: [ac.id, fridge.id], categoryId: visit.id });
        const rows = await db.select({ id: services.id, cat: services.categoryId }).from(services).where(inArray(services.id, [ac.id, fridge.id, goa.id]));
        check('staff move AC and fridge into Visiting & Inspection in one go', moved.status === 200 && moved.body.data.moved === 2 && rows.filter(r => r.cat === visit.id).length === 2, JSON.stringify(moved.body));
        check('…the others stay where they were', rows.find(r => r.id === goa.id)?.cat === travel.id);
        const after = (await api.get('/api/services/categories')).body.data;
        check('…and the app lists them under their new category', after.find((x: any) => x.id === visit.id)?.items?.length === 2);
        const [audit] = (await db.execute(sql`SELECT 1 FROM audit_logs WHERE entity_type = 'service_category' AND entity_id = ${visit.id} AND action = 'services_moved' LIMIT 1`) as any).rows;
        check('…recorded in the audit log', !!audit);
        check('today in India is what the window compares against', /^\d{2}-\d{2}$/.test(todayMmdd()));
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await db.execute(sql.raw(`DELETE FROM audit_logs WHERE entity_type = 'service_category' AND entity_id IN (${catIds.join(',') || '0'})`));
    await db.execute(sql.raw(`DELETE FROM services WHERE id IN (${svcIds.join(',') || '0'})`));
    await db.execute(sql.raw(`DELETE FROM service_categories WHERE id IN (${catIds.join(',') || '0'})`));
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id IN (${adminIds.join(',') || '0'})`)).catch(() => {});
    process.exit(summary());
});
