/**
 * Home screen cards: staff schedule the Home Services row (always / every year
 * between two days / on dates, highest priority wins, gaps filled from the next
 * live set). Test sets only cover far-future dates or months away from today and
 * are checked through the admin preview, so the live app's Home never sees them.
 *
 *   npx tsx scripts/smoke-home-cards.ts
 */

import { inArray, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { serviceCategories, services, homeCardSets } from '../shared/schema';
import { liveOn } from '../server/services/home-cards.service';

const stamp = Date.now().toString(36);
const catIds: number[] = [], svcIds: number[] = [], setIds: number[] = [], adminIds: number[] = [];
// A month well away from today (India time), so no test set is live on the real Home.
const now = new Date(Date.now() + 330 * 60_000);
const m = ((now.getUTCMonth() + 5) % 12) + 1;
const MM = String(m).padStart(2, '0');
const Y = 2099;

async function main() {
    // ── the window rule, without the database ──
    const base = { isActive: true, fromMmdd: null, toMmdd: null, startsOn: null, endsOn: null } as any;
    check('"always" is live any day', liveOn({ ...base, schedule: 'always' }, '2026-03-15'));
    check('every year 1 Jun – 30 Sep: live on 15 Jul, not 15 Oct', liveOn({ ...base, schedule: 'yearly', fromMmdd: '06-01', toMmdd: '09-30' }, '2031-07-15') && !liveOn({ ...base, schedule: 'yearly', fromMmdd: '06-01', toMmdd: '09-30' }, '2031-10-15'));
    check('every year 20 Dec – 10 Jan (across the new year): live on 28 Dec and 5 Jan', liveOn({ ...base, schedule: 'yearly', fromMmdd: '12-20', toMmdd: '01-10' }, '2030-12-28') && liveOn({ ...base, schedule: 'yearly', fromMmdd: '12-20', toMmdd: '01-10' }, '2031-01-05'));
    check('on dates: only between them, both days included', liveOn({ ...base, schedule: 'dates', startsOn: '2027-03-01', endsOn: '2027-03-31' }, '2027-03-31') && !liveOn({ ...base, schedule: 'dates', startsOn: '2027-03-01', endsOn: '2027-03-31' }, '2028-03-15'));
    check('a switched-off set is never live', !liveOn({ ...base, schedule: 'always', isActive: false }, '2026-03-15'));

    const { base: url, close } = await bootServer();
    const api = client(url);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = await api.login(sa.username, sa.password);
        const mkCat = async (name: string) => { const [c] = await db.insert(serviceCategories).values({ name: `QA ${name} ${stamp}`, sortOrder: -700, isActive: true } as any).returning(); catIds.push(c.id); return c; };
        const mkSvc = async (catId: number, name: string, status = 'ACTIVE') => { const [s] = await db.insert(services).values({ categoryId: catId, name: `QA ${name} ${stamp}`, basePrice: 299, isActive: true, status } as any).returning(); svcIds.push(s.id); return s; };
        const elec = await mkCat('Electrical'), plumb = await mkCat('Plumbing'), tax = await mkCat('Tax'), empty = await mkCat('Empty');
        const fan = await mkSvc(elec.id, 'Fan fitting'); await mkSvc(plumb.id, 'Tap repair'); await mkSvc(tax.id, 'ITR filing');
        const gone = await mkSvc(tax.id, 'Old service', 'DISABLED');
        const P = '/api/admin/catalog/home-cards';
        const post = async (body: any) => { const r = await api.post(`${P}/sets`, body, S); if (r.body?.data?.id) setIds.push(r.body.data.id); return r; };

        // ── staff input is checked ──
        check('a set needs a name', (await post({ schedule: 'always', cards: [] })).status === 400);
        check('every year needs real days (31 Feb refused)', (await post({ name: 'QA bad', schedule: 'yearly', fromMmdd: '02-31', toMmdd: '03-10', cards: [] })).status === 400);
        check('dates: the last day cannot be before the first', (await post({ name: 'QA bad', schedule: 'dates', startsOn: '2099-03-10', endsOn: '2099-03-01', cards: [] })).status === 400);
        const five = Array.from({ length: 5 }, () => ({ target: 'screen', screen: 'recharge' }));
        check('at most four cards', (await post({ name: 'QA bad', schedule: 'always', isActive: false, cards: five })).status === 400);
        check('the same thing twice on one set is refused', (await post({ name: 'QA bad', schedule: 'always', isActive: false, cards: [{ target: 'category', id: elec.id }, { target: 'category', id: elec.id }] })).status === 400);
        check('a category that does not exist is refused', (await post({ name: 'QA bad', schedule: 'always', isActive: false, cards: [{ target: 'category', id: 99999999 }] })).status === 400);
        check('an image link must be https', (await post({ name: 'QA bad', schedule: 'always', isActive: false, cards: [{ target: 'category', id: elec.id, photo: { kind: 'link', url: 'http://x.example/a.jpg' } }] })).status === 400);
        check('a library photo must be one the app has', (await post({ name: 'QA bad', schedule: 'always', isActive: false, cards: [{ target: 'category', id: elec.id, photo: { kind: 'library', key: 'nope' } }] })).status === 400);

        // ── a monsoon-style yearly set and a one-off campaign in the same month ──
        const monsoon = await post({
            name: `QA Monsoon ${stamp}`, heading: 'Monsoon care', schedule: 'yearly', fromMmdd: `${MM}-01`, toMmdd: `${MM}-28`, priority: 5,
            cards: [{ target: 'category', id: elec.id, photo: { kind: 'library', key: 'wiring' } }, { target: 'category', id: plumb.id }, { target: 'service', id: fan.id, label: 'Fan fix' }],
        });
        check('staff save a yearly set with three cards', monsoon.status === 201 && monsoon.body.data.cards.length === 3, JSON.stringify(monsoon.body));
        const campaign = await post({
            name: `QA Tax week ${stamp}`, heading: 'Tax week', schedule: 'dates', startsOn: `${Y}-${MM}-10`, endsOn: `${Y}-${MM}-16`, priority: 5,
            cards: [{ target: 'category', id: tax.id, label: 'File ITR' }, { target: 'service', id: gone.id }, { target: 'category', id: empty.id }, { target: 'screen', screen: 'celebrate' }],
        });
        check('…and a dated campaign inside it', campaign.status === 201);

        const preview = async (d: string) => (await api.get(`${P}/preview?date=${d}`, S)).body.data;
        const p1 = await preview(`${Y}-${MM}-05`);
        check('before the campaign the yearly set shows, with its heading', p1.setId === monsoon.body.data.id && p1.heading === 'Monsoon care', JSON.stringify(p1));
        check('…its cards in order, a custom label kept, the library photo kept', p1.cards.map((c: any) => c.key).join() === `category:${elec.id},category:${plumb.id},service:${fan.id}` && p1.cards[2].label === 'Fan fix' && p1.cards[0].photo.key === 'wiring');

        const p2 = await preview(`${Y}-${MM}-12`);
        check('during the campaign it wins at equal priority (dates beat yearly)', p2.setId === campaign.body.data.id && p2.heading === 'Tax week', JSON.stringify(p2));
        check('…a disabled service and a category with no services drop out', !p2.cards.some((c: any) => c.key === `service:${gone.id}` || c.key === `category:${empty.id}`));
        check('…and the yearly set fills the gaps to four', p2.cards.length === 4 && p2.cards[0].key === `category:${tax.id}` && p2.cards[0].label === 'File ITR' && p2.cards[1].key === 'screen:celebrate' && p2.cards[2].key === `category:${elec.id}`, JSON.stringify(p2.cards.map((c: any) => c.key)));

        const up = await api.patch(`${P}/sets/${monsoon.body.data.id}`, { priority: 9 }, S);
        check('raising the yearly set\'s priority', up.status === 200 && up.body.data.priority === 9 && up.body.data.cards.length === 3);
        check('…makes it win during the campaign too', (await preview(`${Y}-${MM}-12`)).setId === monsoon.body.data.id);
        await api.patch(`${P}/sets/${monsoon.body.data.id}`, { isActive: false }, S);
        check('switching it off hands the days back to the campaign', (await preview(`${Y}-${MM}-12`)).setId === campaign.body.data.id);
        check('a day nothing covers shows nothing from these sets', !(await preview(`${Y}-${(m % 12 + 1).toString().padStart(2, '0')}-20`)).cards.some((c: any) => [elec.id, plumb.id, tax.id].includes(c.id)));

        const list = await api.get(`${P}/sets`, S);
        const mine = (list.body.data ?? []).filter((s: any) => setIds.includes(s.id));
        check('the list describes when each set runs', mine.some((s: any) => /^Every year, 1 /.test(s.when)) && mine.some((s: any) => /2099/.test(s.when)), JSON.stringify(mine.map((s: any) => s.when)));

        // ── the app's endpoint and access ──
        const pub = await api.get('/api/home/cards');
        check('the app reads today\'s cards without signing in', pub.status === 200 && typeof pub.body.data.heading === 'string' && Array.isArray(pub.body.data.cards));
        check('…and none of these test sets is live today', !pub.body.data.cards.some((c: any) => setIds.includes(c.fromSetId)));
        check('only staff can see or change sets', (await api.get(`${P}/sets`)).status === 401 && (await api.post(`${P}/sets`, { name: 'x', schedule: 'always' })).status === 401);
        const del = await api.del(`${P}/sets/${campaign.body.data.id}`, S);
        check('staff delete a set', del.status === 200 && (await preview(`${Y}-${MM}-12`)).setId !== campaign.body.data.id);
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    if (setIds.length) await db.delete(homeCardSets).where(inArray(homeCardSets.id, setIds));
    await db.execute(sql.raw(`DELETE FROM audit_logs WHERE entity_type = 'home_card_set' AND entity_id IN (${setIds.join(',') || '0'})`));
    if (svcIds.length) await db.delete(services).where(inArray(services.id, svcIds));
    if (catIds.length) await db.delete(serviceCategories).where(inArray(serviceCategories.id, catIds));
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id IN (${adminIds.join(',') || '0'})`)).catch(() => {});
    process.exit(summary());
});
