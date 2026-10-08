/**
 * Browser check of UniteFix Celebrations: seeds a hall, a photographer and an
 * event planner (with generated photos), puts their pages live, books a date
 * and sends a plan, then opens every new Hub, public and staff page in
 * Chromium — failing on console errors, crashes, blank pages or sideways
 * scroll at phone width — saves screenshots, and removes everything.
 *
 *   1. npm run build
 *   2. NODE_ENV=production PORT=3056 CLIENT_URL=http://127.0.0.1:3056 SMTP_HOST= SMTP_USER= MSG91_API_KEY= TWILIO_SID= node dist/index.js
 *   3. UI_BASE=http://127.0.0.1:3056 UI_OUT=../ui-shots/celebrations npx tsx scripts/ui-check-celebrations.ts
 */
import { chromium } from 'playwright';
import fs from 'fs';
import zlib from 'zlib';
import { eq } from 'drizzle-orm';
import { client, makeSuperAdmin, gstinFor, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, businessPartners } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const BASE = process.env.UI_BASE ?? 'http://127.0.0.1:3056';
const OUT = process.env.UI_OUT ?? 'ui-shots/celebrations';
fs.mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString(36);
const adminIds: number[] = [], bpIds: number[] = [];
const ist = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A soft diagonal gradient with a "sun" — stands in for a photo. */
function png(w: number, h: number, a: [number, number, number], b: [number, number, number], seed = 0) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    const cx = w * (0.3 + (seed % 5) * 0.1), cy = h * (0.35 + (seed % 3) * 0.1), r = Math.min(w, h) * 0.18;
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        for (let x = 0; x < w; x++) {
            const t = (x / w + y / h) / 2;
            let px = [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t);
            const d = Math.hypot(x - cx, y - cy);
            if (d < r) px = px.map(v => v + (255 - v) * 0.55 * (1 - d / r));
            const o = y * (w * 3 + 1) + 1 + x * 3;
            raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2];
        }
    }
    const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
    const crc = (buf: Buffer) => { let c = -1; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
    const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const PALETTE: Array<[[number, number, number], [number, number, number]]> = [
    [[122, 54, 38], [233, 178, 120]], [[54, 38, 30], [196, 120, 82]], [[30, 52, 60], [214, 170, 120]], [[90, 40, 60], [240, 190, 160]], [[40, 70, 50], [220, 200, 140]], [[70, 50, 100], [250, 200, 170]],
];
const photo = (i: number, w = 640, h = 480) => { const fd = new FormData(); const [a, b] = PALETTE[i % PALETTE.length]; fd.append('file', new Blob([png(w, h, a, b, i)], { type: 'image/png' }), `p${i}.png`); return fd; };

let ipN = 10;
/** Each login from its own (forwarded) address, so the production login limit does not trip on a test run. */
async function login(username: string, password: string): Promise<string | null> {
    const r = await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.8.${ipN++}` }, body: JSON.stringify({ username, password }) });
    return (await r.json().catch(() => null))?.token ?? null;
}

async function main() {
    const api = client(BASE);
    const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
    const staff = (await login(sa.username, sa.password))!;
    const mk = async (name: string, verticals: string[], pan: string, p1: string) => {
        const bp = await BusinessPartnerService.create({ legalName: `${name} ${stamp}`, displayName: name, gstin: await gstinFor('29', `${pan}1234K`), contactPhone: `${p1}${String(Date.now()).slice(-9)}`, contactEmail: `qa_uic_${pan}_${stamp}@example.test`, verticalCodes: verticals, approvedByAdminId: sa.id, pincode: '581301', district: 'Uttara Kannada', address: 'Karwar' });
        bpIds.push(bp.id);
        await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka' }).where(eq(businessPartners.id, bp.id));
        const l = await PartnerHubService.createOwnerLogin(bp.id, {});
        const [r] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, l.username)); adminIds.push(r.id);
        await new Promise(res => setTimeout(res, 5));
        return { bp, t: (await login(l.username, l.temporaryPassword))!, user: { id: r.id, username: l.username, role: 'partner' } };
    };
    const hall = await mk('Sagar Convention Hall', ['hall'], 'SAGRU', '7');
    const ph = await mk('Lens & Light Studio', ['photography'], 'LENSU', '8');
    const pl = await mk('Utsav Planners', ['events'], 'UTSVU', '9');

    // hall
    const H = hall.t;
    const wed = add(ist(), 30), peak = add(ist(), 45);
    await api.put('/api/hub/venue/profile', {
        tagline: 'A 600-guest air-conditioned hall with a garden lawn, by the Kali river', about: 'Forty years of weddings in Karwar. Two halls, a garden lawn for the sangeet and six rooms for the families. Our own kitchen team or your caterer — your choice.',
        address: 'NH 66, Kodibag, Karwar, Uttara Kannada', mapUrl: 'https://maps.app.goo.gl/abc123', amenities: ['Air conditioning', 'Power backup', 'Car parking', 'Guest rooms', 'Bridal room', 'Stage', 'Dining hall', 'In-house catering', 'Open lawn'],
        rooms: 6, parking: 80, catering: 'both', rules: { vegOnly: true, alcohol: 'no', outsideCaterers: true, outsideDecorators: true, musicUntil: '22:30', notes: 'No firecrackers inside the premises.' },
        peakDates: [{ date: peak, label: 'Muhurtham' }], advancePercent: 25, depositRupees: 10000, instantBooking: true, holdHours: 24, videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    }, H);
    await api.upload('/api/hub/venue/cover', photo(0, 1600, 900), H);
    const main1 = await api.post('/api/hub/venue/spaces', { name: 'Main hall', kind: 'banquet', seated: 400, floating: 600, areaSqft: 9000, description: 'Pillar-less, central AC, a 30-foot stage and a dining hall for 250 below.', features: ['Central AC', 'Stage 30 × 20 ft', 'Dining hall for 250'], included: '500 chairs, AC for 8 hours, 2 changing rooms, cleaning', ratesRupees: { weekday: { am: 40000, pm: 60000 }, weekend: { pm: 75000 }, peak: { pm: 90000, full: 140000 } } }, H);
    const lawn = await api.post('/api/hub/venue/spaces', { name: 'Garden lawn', kind: 'lawn', floating: 300, description: 'Open-air, fairy lights, for sangeet and receptions.', ratesRupees: { weekday: { pm: 30000 } } }, H);
    for (let i = 1; i <= 4; i++) await api.upload(`/api/hub/venue/spaces/${main1.body.data.id}/photos`, photo(i), H);
    for (let i = 4; i <= 6; i++) await api.upload(`/api/hub/venue/spaces/${lawn.body.data.id}/photos`, photo(i), H);
    await api.post('/api/hub/events/packages', { name: 'Veg buffet', category: 'catering', unit: 'plate', priceRupees: 450, sac: '996337', gstRate: 5, description: '2 sweets, 2 curries, rice, rotis' }, H);
    await api.post('/api/hub/events/packages', { name: 'Floral stage décor', category: 'decor', unit: 'event', priceRupees: 18000, sac: '998596', gstRate: 18 }, H);
    await api.post('/api/hub/venue/listing/submit', {}, H);
    await api.post(`/api/admin/hub/celebrations/listings/${hall.bp.id}/venue/review`, { decision: 'approve' }, staff);
    await api.post(`/api/admin/hub/celebrations/listings/${hall.bp.id}/venue/feature`, { featured: true }, staff);
    const book = await api.post(`/api/public/halls/${hall.bp.partnerCode}/request`, { spaceId: main1.body.data.id, date: wed, slot: 'pm', guests: 300, occasion: 'Wedding reception', name: 'Priya Shetty', phone: '9876500311', email: `qa_ui_${stamp}@example.test` });
    const bookTok = book.body?.data?.link?.split('/').pop();
    const bookings = await api.get('/api/hub/events/bookings', H);
    const hallBookingId = bookings.body?.data?.[0]?.id;
    await api.post('/api/hub/venue/calendar/block', { spaceId: main1.body.data.id, from: add(wed, 2), slot: 'full', note: 'Walk-in wedding' }, H);

    // photographer
    const P = ph.t;
    await api.put('/api/hub/portfolio/profile', { tagline: 'Candid weddings across coastal Karnataka', about: 'Twelve years of weddings, from Udupi temples to Gokarna beaches. We tell your story as it happens — unposed, warm, and true to the day.', styles: ['Wedding', 'Candid', 'Cinematic films', 'Drone'], travelAreas: ['Karwar', 'Goa', 'Udupi', 'Gokarna'], languages: ['Kannada', 'Konkani', 'English', 'Hindi'], since: 2014, instagram: 'lensandlight', crews: 2, deliveryDays: 30 }, P);
    await api.upload('/api/hub/portfolio/cover', photo(3, 1600, 900), P);
    if (!P) throw new Error('photographer login failed');
    const al = await api.post('/api/hub/portfolio/albums', { title: 'Priya & Arjun, Gokarna', story: 'A sunset ceremony on Om beach, a hundred guests barefoot in the sand, and a monsoon cloud that waited until the last pheras.', location: 'Gokarna', category: 'wedding', eventDate: add(ist(), -60) }, P);
    const al2 = await api.post('/api/hub/portfolio/albums', { title: 'Baby Aarav', category: 'baby', location: 'Karwar' }, P);
    for (let i = 0; i < 9; i++) await api.upload(`/api/hub/portfolio/albums/${al.body.data.id}/photos`, photo(i, i % 3 === 0 ? 480 : 640, i % 3 === 0 ? 640 : 427), P);
    for (let i = 0; i < 4; i++) await api.upload(`/api/hub/portfolio/albums/${al2.body.data.id}/photos`, photo(i + 2), P);
    await api.post(`/api/hub/portfolio/albums/${al.body.data.id}/films`, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', caption: 'The wedding film' }, P);
    await api.post('/api/hub/events/packages', { name: 'Wedding — candid + film', category: 'photography', unit: 'day', priceRupees: 40000, description: '2 photographers, 1 videographer, 400 edited photos, a 5-minute film', sac: '998383', gstRate: 18 }, P);
    await api.post('/api/hub/events/packages', { name: 'Pre-wedding shoot', category: 'photography', unit: 'event', priceRupees: 18000, description: 'Half a day, two locations, 60 edited photos', sac: '998383', gstRate: 18 }, P);
    const drone = await api.post('/api/hub/events/packages', { name: 'Drone', category: 'photography', unit: 'event', priceRupees: 8000, isAddon: true, sac: '998383', gstRate: 18 }, P);
    await api.post('/api/hub/portfolio/listing/submit', {}, P);
    await api.post(`/api/admin/hub/celebrations/listings/${ph.bp.id}/portfolio/review`, { decision: 'approve' }, staff);

    // planner
    const L = pl.t;
    await api.put('/api/hub/events/showcase', { tagline: 'Décor and the whole day, done right', about: 'Weddings, naming ceremonies and birthdays across Uttara Kannada since 2015.' }, L);
    await api.upload('/api/hub/events/showcase/cover', photo(5, 1600, 900), L);
    for (let i = 0; i < 4; i++) await api.upload('/api/hub/events/gallery/upload', photo(i + 1), L);
    const decor = await api.post('/api/hub/events/packages', { name: 'Floral mandap', category: 'decor', unit: 'event', priceRupees: 35000, sac: '998596', gstRate: 18 }, L);
    await api.post('/api/hub/events/listing/submit', {}, L);
    await api.post(`/api/admin/hub/celebrations/listings/${pl.bp.id}/events/review`, { decision: 'approve' }, staff);

    const pk = (await api.get(`/api/public/photographers/${ph.bp.partnerCode}`)).body?.data?.packages?.[0];
    const plan = await api.post('/api/public/celebrations/plan', { date: add(ist(), 40), occasion: 'Wedding', guests: 250, name: 'Anita Rao', phone: '9876500331', items: [
        { type: 'hall', code: hall.bp.partnerCode, spaceId: main1.body.data.id, slot: 'pm' },
        { type: 'photographer', code: ph.bp.partnerCode, packageId: pk?.id, slot: 'pm', addons: [{ packageId: drone.body.data.id }] },
        { type: 'planner', code: pl.bp.partnerCode, addons: [{ packageId: decor.body.data.id }] },
    ] });
    if (plan.status !== 201) console.error('plan not sent', plan.body);

    const browser = await chromium.launch();
    const results: Array<{ path: string; ok: boolean; errors: string[]; title: string; overflow?: boolean }> = [];
    async function visit(token: string | null, user: any, path: string, shot: string, opts: { full?: boolean; width?: number } = {}) {
        const page = await browser.newPage({ viewport: { width: opts.width ?? 1360, height: opts.width ? 844 : 900 } });
        const errors: string[] = [];
        page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|youtube|ytimg|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
        page.on('pageerror', e => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(([tk, u]) => { if (tk) { localStorage.setItem('adminToken', tk); localStorage.setItem('adminUser', u); } else { localStorage.clear(); } }, [token ?? '', JSON.stringify(user)]);
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(e => errors.push(`nav: ${e.message.slice(0, 120)}`));
        await page.waitForTimeout(900);
        const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
        const h1 = await page.locator('h1').first().innerText().catch(() => '');
        const crashed = /Something went wrong|Unexpected Application Error|is not a function|Cannot read properties|not available|could not find/i.test(text) || text.trim().length < 30;
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: !!opts.full });
        results.push({ path: `${path}${opts.width ? ` @${opts.width}` : ''}`, ok: !crashed && errors.length === 0 && !overflow, errors: [...(crashed ? [`crash/blank: ${text.slice(0, 200)}`] : []), ...(overflow ? ['horizontal overflow'] : []), ...errors], title: h1, overflow });
        await page.close();
    }
    let i = 0;
    const n = () => String(++i).padStart(2, '0');
    for (const p of ['/partner/venue/page', '/partner/venue/spaces', '/partner/venue/calendar', '/partner/venue/requests', '/partner/reviews', `/partner/events/bookings/${hallBookingId}`, '/partner/events/bookings'])
        await visit(H, hall.user, p, `hub-hall-${n()}-${p.replace(/\W+/g, '_')}`);
    for (const p of ['/partner/portfolio', '/partner/portfolio/albums', `/partner/portfolio/albums/${al.body.data.id}`, '/partner/portfolio/dates', '/partner/events/packages', '/partner/events/quotations', '/partner'])
        await visit(P, ph.user, p, `hub-photo-${n()}-${p.replace(/\W+/g, '_')}`);
    await visit(L, pl.user, '/partner/events/showcase', `hub-planner-${n()}-showcase`);
    const pub = [
        '/celebrations', '/celebrations?type=photographers&city=goa', '/celebrations?type=planners', `/halls/${hall.bp.partnerCode}`, `/photographers/${ph.bp.partnerCode}`, `/photographers/${ph.bp.partnerCode}/albums/${al.body.data.id}`,
        `/celebrations/b/${bookTok}`, `/celebrations/plan/${plan.body?.data?.token}`, '/celebrations/plan',
    ];
    for (const p of pub) await visit(null, null, p, `public-${n()}-${p.replace(/\W+/g, '_').slice(0, 50)}`, { full: true });
    for (const p of ['/celebrations', `/halls/${hall.bp.partnerCode}`, `/photographers/${ph.bp.partnerCode}`, `/celebrations/b/${bookTok}`, `/celebrations/plan/${plan.body?.data?.token}`])
        await visit(null, null, p, `phone-${n()}-${p.replace(/\W+/g, '_').slice(0, 50)}`, { full: true, width: 390 });
    const [sau] = await db.select().from(adminUsers).where(eq(adminUsers.id, sa.id));
    for (const p of ['/admin/celebrations', '/']) await visit(staff, { id: sau.id, username: sau.username, role: 'super_admin' }, p, `admin-${n()}-${p.replace(/\W+/g, '_')}`);
    await visit(staff, { id: sau.id, username: sau.username, role: 'super_admin' }, `/halls/${hall.bp.partnerCode}?preview=admin&bp=${hall.bp.id}`, `admin-${n()}-preview`);
    await browser.close();
    fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
    const failed = results.filter(r => !r.ok).length;
    for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.path}  [${r.title}]${r.errors.length ? '\n     ' + r.errors.join('\n     ') : ''}`);
    console.log(`\n${results.length - failed}/${results.length} pages OK`);
    process.exitCode = failed ? 1 : 0;
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
    const bp = bpIds.join(',') || '0';
    await cleanupPartners(bpIds, adminIds, [
        ...['booking_calendar', 'partner_reviews', 'partner_listings', 'portfolio_media', 'portfolio_albums', 'venue_spaces', 'partner_pay_links', 'hub_alerts', 'event_gallery', 'event_themes'].map(x => `DELETE FROM ${x} WHERE business_partner_id IN (${bp})`),
        `DELETE FROM event_milestones WHERE booking_id IN (SELECT id FROM event_bookings WHERE business_partner_id IN (${bp}))`,
        ...['event_bookings', 'event_enquiries', 'event_packages'].map(x => `DELETE FROM ${x} WHERE business_partner_id IN (${bp})`),
        `DELETE FROM celebration_baskets WHERE phone LIKE '98765003%'`,
        `DELETE FROM audit_logs WHERE entity_type = 'business_partner' AND entity_id IN (${bp})`,
    ]);
    process.exit(process.exitCode ?? 0);
});
