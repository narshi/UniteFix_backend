/**
 * India Post for store parcels, end to end on the real route stack and the
 * local database:
 *  - article numbers (S10 check digit), event wording → status, addresses
 *  - the connector in live mode against a fake India Post server (token
 *    reuse and renewal, the booking payload, refused articles, tracking, label)
 *  - checkout refusing undeliverable pincodes and a state that does not match
 *  - staff booking UniteFix's own order: claimed once under concurrent clicks,
 *    article numbers from the allocated range, label
 *  - a partner booking from their Hub, postage on their statement
 *  - tracking job and webhook moving orders: dispatched (invoice), out for
 *    delivery, delivered (return window); late events never go backwards;
 *    a return to sender alerts and does not refund by itself
 *
 *   npx tsx scripts/smoke-india-post.ts
 */

process.env.STORE_PAYMENTS_MOCK = '1';
process.env.STORE_CHECK_PINCODES = '1';

import http from 'http';
import jwt from 'jsonwebtoken';
import { inArray, sql, eq } from 'drizzle-orm';
import { check, summary, bootServer, client, makeSuperAdmin, cleanupPartners, gstinFor, db } from './lib/hub-test-kit';
import { users, products, sellerOrders, businessPartners, adminUsers, platformConfig, indiaPostBarcodeSeries, indiaPostPincodes, storeShipmentEvents, notifications } from '../shared/schema';
import { IndiaPost, s10CheckDigit, articleNumber, isValidArticleNumber, statusOf, foldStatus, addressLines, parseIpDate, ipDateTime, mockStages } from '../server/services/store/india-post.service';
import { StoreParcels } from '../server/services/store/parcels.service';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const stamp = Date.now().toString(36);
const userIds: number[] = [], productIds: number[] = [], adminIds: number[] = [], bpIds: number[] = [], seriesIds: number[] = [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const WAREHOUSE_KEY = 'OPERATIONAL_CONFIG.STORE_WAREHOUSE';
let savedWarehouse: { value: string } | null | undefined;
let pincodesBefore = new Set<string>();

// ── A fake India Post (live mode talks to this) ──────────────────────────
const fake = { logins: 0, reject401: false, lastBooking: null as any, calls: [] as string[], auth: [] as string[] };
function fakeIndiaPost() {
    return http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            const url = new URL(req.url ?? '/', 'http://x');
            fake.calls.push(`${req.method} ${url.pathname}`);
            const json = (code: number, x: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(x)); };
            if (url.pathname === '/v1/access/login') {
                const b = JSON.parse(body || '{}');
                if (b.username !== 'qa-user' || b.password !== 'qa-pass') return json(401, { success: false, message: 'bad credentials' });
                fake.logins++;
                return json(200, { success: true, message: '', data: { access_token: `tok${fake.logins}`, refresh_token: 'r', id_token: 'i', expires_in: 900, refresh_expires_in: 1800 } });
            }
            fake.auth.push(String(req.headers.authorization));
            if (fake.reject401) { fake.reject401 = false; return json(401, { success: false, message: 'token expired' }); }
            if (url.pathname === '/v1/pincode-search') return json(200, [
                { pincode: 570001, office_name: 'Krishna Rajendra Circle S.O', office_id: '21661267', office_type_code: 'SPO', state_name: 'Karnataka', delivery_office_flag: false, city_name: 'MYSURU', is_rolled_out: true },
                { pincode: 570001, office_name: 'Mysuru H.O', office_id: '21360043', office_type_code: 'HPO', state_name: 'Karnataka', delivery_office_flag: true, city_name: 'MYSURU', is_rolled_out: true },
            ]);
            if (url.pathname === '/v1/speed-post/tariffs') return json(200, { success: true, product_code: 'SP_INLAND_PARCEL', weight: Number(url.searchParams.get('weight')), chargeable_weight: 1000, base_tariff: 72, vas_charges: 58, cgst: 12, sgst: 12, total_tax: 24, final_amount: 154, delivery_type: 'Inter-city' });
            if (url.pathname === '/process-articles/3000099999') {
                const a = JSON.parse(body).articles[0];
                fake.lastBooking = a;
                const errors = /^\d{6}$/.test(a.receiver_pincode) ? [] : ['Receiver pincode must be exactly 6 digits'];
                return json(200, { success: true, batch_id: 'batch_qa_1', custom_id: '3000099999', total: 1, processed: 1, valid_articles: errors.length ? [] : [{ barcode_no: a.barcode_no, index: 0, calculated_tariff: 154 }], error_articles: errors.length ? [{ barcode_no: a.barcode_no, index: 0, errors }] : [] });
            }
            if (url.pathname === '/v1/tracking/bulk') {
                const list = JSON.parse(body).bulk as string[];
                return json(200, { status_code: 200, success: true, data: list.map(a => ({ booking_details: { article_number: a }, tracking_details: [
                    { date: '2026-09-07T12:56:46.613Z', time: '12:56:46', office: 'Kalanjoor SO', event: 'Taken out for delivery', remarks: '', rts: false },
                    { date: '2026-09-05T23:24:16.038Z', time: '23:24:16', office: 'Changanacherry HO', event: 'Item Booked', remarks: '', rts: false },
                ] })) });
            }
            if (url.pathname === '/v1/label/create/domestic') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('%PDF-1.4 fake label'); }
            json(404, { success: false, message: 'no such endpoint' });
        });
    });
}

async function customer(label: string) {
    const [u] = await db.insert(users).values({ phone: `6${(Date.now() * 100 + userIds.length).toString().slice(-9)}`, username: `QA IP ${label}`, role: 'user' } as any).returning();
    userIds.push(u.id);
    return { id: u.id, token: jwt.sign({ userId: u.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' }) };
}

async function main() {
    // ── Pure pieces ──────────────────────────────────────────────────────
    check('S10 check digit: India Post\'s worked example 47312482 → 9', s10CheckDigit('47312482') === 9);
    const sumOf = (x: string) => x.split('').reduce((a, d, i) => a + Number(d) * [8, 6, 4, 2, 3, 5, 9, 7][i], 0);
    const serials = [...Array(5000)].map((_, i) => String(10_000_000 + i * 17_389).slice(0, 8));
    const r1 = serials.filter(x => sumOf(x) % 11 === 1), r0 = serials.filter(x => sumOf(x) % 11 === 0);
    check('…remainder rules: 11 − r = 10 gives 0, 11 − r = 11 gives 5', r1.length > 0 && r0.length > 0 && r1.every(x => s10CheckDigit(x) === 0) && r0.every(x => s10CheckDigit(x) === 5), `${r1.length} ${r0.length}`);
    const an = articleNumber('ET', 21433001);
    check('an article number is prefix + 8 digits + check digit + IN, and validates', /^ET21433001\dIN$/.test(an) && isValidArticleNumber(an) && !isValidArticleNumber(an.replace(/\d(?=IN$)/, d => String((Number(d) + 1) % 10))), an);
    check('event wording → status (tracking text and webhook codes)', statusOf(null, 'Item Booked') === 'handed_over' && statusOf(null, 'Taken out for delivery') === 'out_for_delivery' && statusOf('ITEM_DELIVERY', 'Item Delivered(Addressee)') === 'delivered' && statusOf('ITEM_DELIVERY', 'Item Delivered(Sender)') === 'returned' && statusOf('BAG_CLOSE', 'Bag Close') === 'in_transit' && statusOf('ITEM_RETURN', 'Item Returned to Sender') === 'returning' && statusOf(null, 'Item Kept on Hold') === 'on_hold' && statusOf('Cancelled', 'Item Pickup Cancelled') === 'pickup_cancelled' && statusOf(null, 'Pickup Request Raised') === 'booked');
    check('…a dispatch on the way back counts as the return', statusOf(null, 'Item Dispatched', true) === 'returning');
    const t = (h: number) => new Date(Date.UTC(2026, 8, 1, h));
    check('status never goes backwards when an old event arrives late', foldStatus('delivered', [{ status: 'in_transit', at: t(1) }]) === 'delivered' && foldStatus('out_for_delivery', [{ status: 'in_transit', at: t(1) }]) === 'out_for_delivery');
    check('…but on hold can move on, and a return is sticky', foldStatus('on_hold', [{ status: 'in_transit', at: t(1) }]) === 'in_transit' && foldStatus('returning', [{ status: 'out_for_delivery', at: t(2) }]) === 'returning' && foldStatus('returning', [{ status: 'returned', at: t(3) }]) === 'returned');
    const lines = addressLines(['House 12, 4th Cross, Vidyanagar Extension near the big banyan tree opposite the government higher primary school', 'Behind the water tank, Sirsi Road, Uttara Kannada district, Karnataka state, India — a very long address indeed that goes on']);
    check('addresses fit India Post: at most 3 lines of 80, 240 in all', lines.length <= 3 && lines.every(l => l.length <= 80 && l.length >= 3) && lines.join(' ').length <= 242, JSON.stringify(lines));
    check('dates: ISO kept; date + time read as India time', parseIpDate('2026-09-07T12:56:46.613Z').toISOString() === '2026-09-07T12:56:46.613Z' && parseIpDate('2025-11-09', '08:37:52').toISOString() === '2025-11-09T03:07:52.000Z');
    check('pickup date in India Post\'s format (MM/DD/YYYY hh:mm:ss AM/PM, India time)', ipDateTime(new Date('2025-12-15T06:40:23Z')) === '12/15/2025 12:10:23 PM', ipDateTime(new Date('2025-12-15T06:40:23Z')));
    check('parcel limits: a document is ≤ 500 g and envelope-sized, a parcel 14×9 cm or more', IndiaPost.articleType('SP', { weightGrams: 200, lengthCm: 30, widthCm: 20, heightCm: 1 }) === 'SP_INLAND_DOC' && IndiaPost.articleType('SP', { weightGrams: 200, lengthCm: 30, widthCm: 20, heightCm: 5 }) === 'SP_INLAND_PARCEL' && !!IndiaPost.parcelProblem('SP', { weightGrams: 900, lengthCm: 10, widthCm: 5, heightCm: 5 }) && !!IndiaPost.parcelProblem('BP', { weightGrams: 40000, lengthCm: 30, widthCm: 20, heightCm: 10 }) && !IndiaPost.parcelProblem('BP', { weightGrams: 1200, lengthCm: 30, widthCm: 20, heightCm: 10 }));

    // Modes: never on by accident in production.
    const env = { mode: process.env.INDIA_POST_MODE, node: process.env.NODE_ENV };
    delete process.env.INDIA_POST_MODE; process.env.NODE_ENV = 'production';
    const prodDefault = IndiaPost.mode();
    process.env.INDIA_POST_MODE = 'live';
    const liveNoCreds = IndiaPost.mode();
    process.env.NODE_ENV = env.node ?? 'development';
    check('production with nothing set: India Post is off (no fake bookings for real orders)', prodDefault === 'off');
    check('…and "live" without credentials is off too', liveNoCreds === 'off');

    // The server first: it runs the migrations.
    const srv = await bootServer();
    const api = client(srv.base);

    // ── Live mode against a fake India Post ──────────────────────────────
    pincodesBefore = new Set((await db.select({ p: indiaPostPincodes.pincode }).from(indiaPostPincodes)).map(r => r.p));
    const fakeSrv = fakeIndiaPost();
    await new Promise<void>(r => fakeSrv.listen(0, '127.0.0.1', () => r()));
    Object.assign(process.env, { INDIA_POST_MODE: 'live', INDIA_POST_BASE_URL: `http://127.0.0.1:${(fakeSrv.address() as any).port}`, INDIA_POST_USERNAME: 'qa-user', INDIA_POST_PASSWORD: 'qa-pass', INDIA_POST_CUSTOMER_ID: '3000099999', INDIA_POST_CONTRACT_SP: '41585456' });
    IndiaPost.resetForTests();
    try {
        const [p1, p2] = await Promise.all([IndiaPost.pincode('570001', { fresh: true }), IndiaPost.pincode('570001', { fresh: true })]);
        check('live: one login for calls made together (token shared)', fake.logins === 1 && fake.auth.every(a => a === 'Bearer tok1'), `${fake.logins} ${fake.auth}`);
        check('pincode: state → GST code, city, and the booking office is the delivery office that is not a branch office', p1?.stateCode === '29' && p1.officeId === '21360043' && p1.city === 'MYSURU' && p2?.deliverable === true, JSON.stringify(p1));
        const cached = await IndiaPost.pincode('570001');
        check('…cached afterwards (no new call)', cached?.officeId === '21360043' && fake.calls.filter(c => c.includes('pincode')).length === 2);
        fake.reject401 = true;
        const tariff = await IndiaPost.tariff('SP', '570001', '110001', { weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 10 });
        check('an expired token: logs in again once and carries on', fake.logins === 2 && tariff.totalPaise === 15400 && tariff.taxPaise === 2400 && tariff.basePaise === 13000, `${fake.logins} ${JSON.stringify(tariff)}`);
        const party = { name: 'QA Sender', company: 'QA Co', lines: ['1 Main Road'], city: 'Mysuru', state: 'Karnataka', pincode: '570001', mobile: '9845000111' };
        const art = articleNumber('ET', 21433002);
        const bk = await IndiaPost.book({ product: 'SP', articleNumber: art, parcel: { weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 10 }, sender: party, receiver: { ...party, name: 'QA Buyer', pincode: '110001', mobile: '9876543210' }, handover: { kind: 'pickup', officeId: '21360043', date: new Date('2026-12-02T04:30:00Z'), slot: '10:00-13:00' }, reference: 'SO-QA-1' });
        const a = fake.lastBooking;
        check('booking: the payload India Post asked for (customer, contract, our article number, parcel type, pickup slot and date)', bk.batchId === 'batch_qa_1' && a.bulk_customer_id === '3000099999' && a.contract_id === '41585456' && a.barcode_no === art && a.article_type === 'SP_INLAND_PARCEL' && a.pickup_or_dropoff === 'PICKUP' && a.pickup_address_flag === 'TRUE' && a.pickup_schedule_slot === '10:00-13:00' && a.pickup_schedule_date === '12/02/2026 10:00:00 AM' && a.physical_weight === 900 && a.shape_of_article === 'NROL' && a.sender_mobile_no === '9845000111', JSON.stringify(a).slice(0, 400));
        let refused: any = null;
        try { await IndiaPost.book({ product: 'SP', articleNumber: articleNumber('ET', 21433003), parcel: { weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 10 }, sender: party, receiver: { ...party, pincode: '11001' }, handover: { kind: 'dropoff', officeId: '21360043' }, reference: 'SO-QA-2' }); } catch (e) { refused = e; }
        check('a refused article comes back with India Post\'s reason', refused?.code === 'REJECTED' && /Receiver pincode must be exactly 6 digits/.test(refused.message), refused?.message);
        const tr = await IndiaPost.track([art]);
        check('bulk tracking: events per article, with times', tr.get(art)?.length === 2 && tr.get(art)![0].description === 'Taken out for delivery' && tr.get(art)![1].at.toISOString() === '2026-09-05T23:24:16.038Z');
        const lbl = await IndiaPost.label({ articleNumber: art, product: 'SP', parcel: { weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 10 }, sender: party, receiver: party, bookingOffice: { name: 'Mysuru H.O', pincode: '570001' } });
        check('label: India Post\'s own PDF', lbl?.subarray(0, 4).toString() === '%PDF');
    } finally {
        fakeSrv.close();
        for (const k of ['INDIA_POST_BASE_URL', 'INDIA_POST_USERNAME', 'INDIA_POST_PASSWORD', 'INDIA_POST_CUSTOMER_ID', 'INDIA_POST_CONTRACT_SP']) delete process.env[k];
        process.env.INDIA_POST_MODE = 'mock';
        IndiaPost.resetForTests();
    }

    // ── The store, on the real routes (India Post in test mode) ──────────
    const [w0] = await db.select({ value: platformConfig.value }).from(platformConfig).where(eq(platformConfig.key, WAREHOUSE_KEY));
    savedWarehouse = w0 ?? null;
    if (w0) await db.delete(platformConfig).where(eq(platformConfig.key, WAREHOUSE_KEY));
    // Pause any range already in this database so the test's own is used (restored after).
    const pausedSeries = (await db.select({ id: indiaPostBarcodeSeries.id }).from(indiaPostBarcodeSeries).where(eq(indiaPostBarcodeSeries.isActive, true))).map(r => r.id);
    if (pausedSeries.length) await db.update(indiaPostBarcodeSeries).set({ isActive: false }).where(inArray(indiaPostBarcodeSeries.id, pausedSeries));

    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const staff = (await api.login(sa.username, sa.password))!;
        const [laptop] = await db.insert(products).values({ name: `QA IP ${stamp} Laptop bag`, category: 'QA', price: 1180, mrp: 1500, stock: 20, isActive: true, listingStatus: 'live', hsnCode: '4202', gstPercent: '18', countryOfOrigin: 'India', manufacturer: 'QA Maker', returnWindowDays: 2, weightGrams: 800, packageLengthCm: 40, packageWidthCm: 30, packageHeightCm: 8 } as any).returning();
        productIds.push(laptop.id);
        const ship = { name: 'QA Buyer', phone: '9876543210', line1: '12 MG Road, Near Bus Stand', city: 'Sirsi', pincode: '581401', stateCode: '29' };
        const a = await customer('A');
        let n = 0;
        const buy = async (u: { token: string }, productId: number, shipTo = ship) => {
            const r = await fetch(`${srv.base}/api/store/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}`, 'Idempotency-Key': `qa-ip-${stamp}-${++n}` }, body: JSON.stringify({ source: 'buy_now', items: [{ productId, quantity: 1 }], shipTo }) });
            return { status: r.status, body: await r.json() as any };
        };
        const buyAndPay = async (u: { token: string }, productId: number) => {
            const c = await buy(u, productId);
            const p = await api.post(`/api/store/checkout/${c.body.data.checkoutId}/mock-pay`, {}, u.token);
            return p.body.data.orders[0].id as number;
        };

        // Checkout: the pincode decides.
        let r = await buy(a, laptop.id, { ...ship, pincode: '999001' });
        check('checkout refuses a pincode India Post does not deliver to', r.status === 400 && r.body?.code === 'NOT_SERVICEABLE', JSON.stringify(r.body));
        r = await buy(a, laptop.id, { ...ship, pincode: '400001' });
        check('…and a state that does not match the pincode (it decides the GST)', r.status === 400 && r.body?.code === 'STATE_MISMATCH' && /Maharashtra/.test(r.body.message), JSON.stringify(r.body));
        const hint = await api.get('/api/store/pincode/581401', a.token);
        check('the address form can fill the state and city from the pincode', hint.body?.data?.known === true && hint.body.data.stateCode === '29' && hint.body.data.deliverable === true, JSON.stringify(hint.body));

        const so1 = await buyAndPay(a, laptop.id);
        await api.post(`/api/admin/store/orders/${so1}/transition`, { to: 'confirmed' }, staff);
        const setup = (await api.get('/api/admin/store/shipping', staff)).body?.data;
        check('staff see the India Post status (test mode here)', setup?.indiaPost?.mode === 'mock');
        const booking = { product: 'SP', weightGrams: 850, lengthCm: 40, widthCm: 30, heightCm: 8, handover: 'dropoff' };
        r = await api.post(`/api/admin/store/orders/${so1}/india-post`, booking, staff);
        check('booking needs UniteFix\'s shipping address first', r.status === 409 && r.body?.code === 'NO_WAREHOUSE', JSON.stringify(r.body));
        r = await api.put('/api/admin/store/shipping/warehouse', { name: 'Dispatch desk', company: 'UniteFix QA', line1: 'Warehouse 1, Industrial Area', city: 'Sirsi', pincode: '581402', stateCode: '29', phone: '9845000222' }, staff);
        check('staff set the shipping address', r.status === 200);
        r = await api.post('/api/admin/store/shipping/series', { prefix: 'qz', firstSerial: 41000001, lastSerial: 41000004, product: 'SP', note: `QA ${stamp}` }, staff);
        check('staff add the article-number range India Post allocated', r.status === 201 && r.body?.data?.prefix === 'QZ', JSON.stringify(r.body));
        seriesIds.push(r.body.data.id);
        r = await api.post('/api/admin/store/shipping/series', { prefix: 'QZ', firstSerial: 41000004, lastSerial: 41000010, product: 'SP' }, staff);
        check('…an overlapping range is refused', r.status === 409 && r.body?.code === 'OVERLAP');

        const parcel = (await api.get(`/api/admin/store/orders/${so1}/parcel`, staff)).body?.data;
        check('the parcel is suggested from the product\'s weight and size', parcel?.suggested?.weightGrams === 850 && parcel.suggested.lengthCm === 40 && parcel.suggested.complete === true, JSON.stringify(parcel?.suggested));
        const q = await api.post(`/api/admin/store/orders/${so1}/india-post/quote`, booking, staff);
        check('postage is quoted before booking', q.status === 200 && q.body?.data?.total > 0 && q.body.data.taxPaise > 0, JSON.stringify(q.body));

        const both = await Promise.all([1, 2, 3].map(() => api.post(`/api/admin/store/orders/${so1}/india-post`, booking, staff)));
        const ok = both.filter(x => x.status === 200);
        check('three clicks at once book exactly once', ok.length === 1 && both.filter(x => x.status === 409).length === 2, both.map(x => `${x.status}:${x.body?.code ?? ''}`).join(' '));
        const first = articleNumber('QZ', 41000001);
        let [o1] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so1));
        check('…with the first number of the range as the tracking id', o1.trackingId === first && o1.courier === 'India Post' && o1.carrier === 'india_post' && o1.trackingStatus === 'booked', `${o1.trackingId} vs ${first}`);
        const [srs] = await db.select().from(indiaPostBarcodeSeries).where(eq(indiaPostBarcodeSeries.id, seriesIds[0]));
        check('…and the range moves on by one (failed attempts never reuse a number)', srs.nextSerial === 41000002, String(srs.nextSerial));
        check('UniteFix pays its own postage: recorded on the order, nothing on any statement', o1.courierChargePaise > 0 && o1.sellerPartnerId === null);
        const lbl = await fetch(`${srv.base}/api/admin/store/orders/${so1}/label.pdf`, { headers: { Authorization: `Bearer ${staff}` } });
        check('label prints (UniteFix\'s own while India Post is in test mode)', lbl.status === 200 && Buffer.from(await lbl.arrayBuffer()).subarray(0, 4).toString() === '%PDF');
        check('the order is still waiting for hand-over (not dispatched yet)', o1.status === 'confirmed' && !o1.invoiceDocumentId);

        // Tracking job: India Post has the parcel → dispatched with the GST invoice.
        mockStages.set(first, { stage: 2, from: new Date(Date.now() - 3 * 3_600_000) });
        const sync = await api.post('/api/admin/store/shipping/sync', {}, staff);
        [o1] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so1));
        check('tracking: handed over → the order is dispatched and its tax invoice issued', sync.status === 200 && o1.status === 'dispatched' && !!o1.invoiceDocumentId && o1.trackingStatus === 'in_transit', `${o1.status} ${o1.trackingStatus}`);
        const ev1 = await db.select().from(storeShipmentEvents).where(eq(storeShipmentEvents.sellerOrderId, so1));
        await api.post('/api/admin/store/shipping/sync', {}, staff);
        const ev2 = await db.select().from(storeShipmentEvents).where(eq(storeShipmentEvents.sellerOrderId, so1));
        check('…every event recorded once (a second run adds nothing)', ev1.length === 4 && ev2.length === ev1.length, `${ev1.length} ${ev2.length}`);

        // Webhook: out for delivery, delivered; repeats and late events.
        process.env.INDIA_POST_WEBHOOK_SECRET = `qa-secret-${stamp}`;
        const hook = (body: unknown, secret?: string) => fetch(`${srv.base}/api/webhooks/india-post`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-webhook-secret': secret } : {}) }, body: JSON.stringify(body) }).then(async x => ({ status: x.status, body: await x.json() as any }));
        const ev = (code: string, desc: string, at: Date, article = first) => ({ article_number: article, article_type: 'SP_INLAND_PARCEL', event_date: new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10), event_time: new Date(at.getTime() + 330 * 60_000).toISOString().slice(11, 19), event_office_name: 'QA Delivery H.O', event_code: code, event_description: desc });
        r = await hook(ev('ITEM_INVOICE', 'Item Invoiced', new Date()), 'wrong');
        check('the webhook refuses a call without the shared secret', r.status === 401);
        r = await hook(ev('ITEM_INVOICE', 'Item Invoiced', new Date(Date.now() - 60_000)), process.env.INDIA_POST_WEBHOOK_SECRET);
        [o1] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so1));
        check('webhook: out for delivery', r.status === 200 && r.body.applied === 1 && o1.trackingStatus === 'out_for_delivery', JSON.stringify(r.body));
        const delivered = ev('ITEM_DELIVERY', 'Item Delivered(Addressee)', new Date(Date.now() - 1000));
        r = await hook([delivered, ev('BAG_OPEN', 'Item Received', new Date(Date.now() - 6 * 3_600_000)), { article_number: 'XX000000000IN', event_code: 'BAG_OPEN', event_description: 'x', event_date: '2026-09-01', event_time: '10:00:00' }], process.env.INDIA_POST_WEBHOOK_SECRET);
        [o1] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so1));
        check('…delivered: the order is delivered and its return window starts', o1.status === 'delivered' && o1.trackingStatus === 'delivered' && !!o1.settleAfter && r.body.unknown === 1, JSON.stringify([o1.status, o1.trackingStatus, r.body]));
        r = await hook(delivered, process.env.INDIA_POST_WEBHOOK_SECRET);
        check('…the same event again changes nothing', r.body.applied === 0);
        const mine = (await api.get(`/api/store/orders/${so1}`, a.token)).body?.data;
        check('the customer sees where the parcel is, with its events', mine?.shipment?.status === 'delivered' && mine.shipment.statusLabel === 'Delivered' && mine.shipment.events?.length >= 5 && mine.shipment.events.some((e: any) => e.description === 'Item Delivered(Addressee)') && mine.shipment.events.every((e: any, i: number, l: any[]) => i === 0 || new Date(l[i - 1].at) >= new Date(e.at)), JSON.stringify(mine?.shipment)?.slice(0, 300));
        await sleep(500);
        const notes = await db.select({ title: notifications.title }).from(notifications).where(eq(notifications.userId, a.id));
        check('…and was told: shipped, out for delivery, delivered', ['Order shipped', 'Out for delivery', 'Order delivered'].every(t => notes.some(x => x.title === t)), notes.map(x => x.title).join(', '));

        // Return to sender: alerts, no refund by itself.
        const so2 = await buyAndPay(a, laptop.id);
        await api.post(`/api/admin/store/orders/${so2}/transition`, { to: 'confirmed' }, staff);
        const tomorrow = new Date(Date.now() + 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
        r = await api.post(`/api/admin/store/orders/${so2}/india-post`, { ...booking, handover: 'pickup' }, staff);
        check('a pickup needs its day and slot', r.status === 400);
        r = await api.post(`/api/admin/store/orders/${so2}/india-post`, { ...booking, handover: 'pickup', pickupDate: tomorrow, slot: '13:00-16:00' }, staff);
        const second = articleNumber('QZ', 41000002);
        check('pickup booked with the next number', r.status === 200 && r.body?.data?.articleNumber === second, JSON.stringify(r.body));
        await hook([ev('ITEM_BOOK', 'Item Booked', new Date(Date.now() - 5 * 3_600_000), second), ev('ITEM_RETURN', 'Item Returned to Sender', new Date(Date.now() - 3_600_000), second)], process.env.INDIA_POST_WEBHOOK_SECRET);
        let [o2] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so2));
        check('returned to sender: dispatched (the goods left, so the invoice is issued), shown coming back, not refunded by itself (people decide)', o2.status === 'dispatched' && !!o2.invoiceDocumentId && o2.trackingStatus === 'returning' && !o2.refundPaise, `${o2.status} ${o2.trackingStatus}`);
        await hook(ev('ITEM_DELIVERY', 'Item Delivered(Sender)', new Date(), second), process.env.INDIA_POST_WEBHOOK_SECRET);
        [o2] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so2));
        check('…back with the sender: returned, and the order is not marked delivered', o2.trackingStatus === 'returned' && o2.status === 'dispatched');
        const n2 = await db.select({ title: notifications.title }).from(notifications).where(eq(notifications.userId, a.id));
        check('…the customer is told it is being returned', n2.some(x => x.title === 'Order being returned'));

        // A booked order cancelled before hand-over.
        const so3 = await buyAndPay(a, laptop.id);
        await api.post(`/api/admin/store/orders/${so3}/transition`, { to: 'confirmed' }, staff);
        await api.post(`/api/admin/store/orders/${so3}/india-post`, booking, staff);
        r = await api.post(`/api/admin/store/orders/${so3}/transition`, { to: 'cancelled', reason: 'QA customer changed their mind' }, staff);
        const [o3] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so3));
        check('a booked order can still be cancelled before hand-over', r.status === 200 && o3.status === 'cancelled', JSON.stringify(r.body));
        await hook(ev('ITEM_BOOK', 'Item Booked', new Date(), o3.trackingId!), process.env.INDIA_POST_WEBHOOK_SECRET);
        const [o3b] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so3));
        check('…and a late India Post event never revives a cancelled order', o3b.status === 'cancelled');

        // ── A partner books from their Hub ───────────────────────────────
        const bp = await BusinessPartnerService.create({ legalName: `QA Malnad Spices ${stamp}`, displayName: 'Malnad Spices', gstin: await gstinFor('29', 'QAMLS1234K'), contactPhone: `9${String(Date.now()).slice(-9)}`, contactEmail: `qa_ip_${stamp}@example.test`, verticalCodes: ['electronics'], approvedByAdminId: sa.id, address: 'Spice market, Sirsi', pincode: '581401' });
        bpIds.push(bp.id);
        await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka', hubPlan: 'pro', district: 'Sirsi', grievanceName: 'Asha', grievancePhone: '9811100022', grievanceEmail: 'care@malnad.example', returnPolicy: 'No returns on food' }).where(eq(businessPartners.id, bp.id));
        const login = await PartnerHubService.createOwnerLogin(bp.id, {});
        const [la] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, login.username)); if (la) adminIds.push(la.id);
        const pt = (await api.login(login.username, login.temporaryPassword))!;
        const [pepper] = await db.insert(products).values({ name: `QA IP ${stamp} Pepper 500 g`, category: 'QA', price: 450, mrp: 500, stock: 10, isActive: true, listingStatus: 'live', sellerPartnerId: bp.id, hsnCode: '0904', gstPercent: '5', countryOfOrigin: 'India', manufacturer: 'Malnad Spices', returnWindowDays: 0, weightGrams: 520 } as any).returning();
        productIds.push(pepper.id);
        const pso = await buyAndPay(a, pepper.id);
        await api.post(`/api/hub/store/orders/${pso}/transition`, { to: 'confirmed' }, pt);
        r = await api.post(`/api/admin/store/orders/${pso}/india-post`, booking, staff);
        check('staff cannot book a partner\'s parcel (the partner ships their own)', r.status === 409 && r.body?.code === 'NOT_OURS');
        const pp = (await api.get(`/api/hub/store/orders/${pso}/parcel`, pt)).body?.data;
        check('the partner sees the suggested parcel (size missing on the listing → marked incomplete)', pp?.suggested?.weightGrams === 570 && pp.suggested.complete === false, JSON.stringify(pp));
        const bal0 = await BusinessPartnerService.balancePaise(bp.id);
        r = await api.post(`/api/hub/store/orders/${pso}/india-post`, { product: 'SP', weightGrams: 570, lengthCm: 20, widthCm: 15, heightCm: 10, handover: 'dropoff' }, pt);
        const [po] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, pso));
        const charged = (await BusinessPartnerService.balancePaise(bp.id)) - bal0;
        check('the partner books India Post from their Hub', r.status === 200 && po.carrier === 'india_post' && po.trackingId === articleNumber('QZ', 41000004), JSON.stringify(r.body));
        check('…the postage (with its GST) goes on their statement', charged === po.courierChargePaise + po.courierChargeGstPaise && charged > 0, `${charged}`);
        const plabel = await fetch(`${srv.base}/api/hub/store/orders/${pso}/label.pdf`, { headers: { Authorization: `Bearer ${pt}` } });
        check('…and prints the label', plabel.status === 200);
        r = await api.post(`/api/hub/store/orders/${pso}/india-post`, { product: 'SP', weightGrams: 570, lengthCm: 20, widthCm: 15, heightCm: 10, handover: 'dropoff' }, pt);
        check('…a second booking is refused', r.status === 409);
        const so4 = await buyAndPay(a, laptop.id);
        await api.post(`/api/admin/store/orders/${so4}/transition`, { to: 'confirmed' }, staff);
        r = await api.post(`/api/admin/store/orders/${so4}/india-post`, booking, staff);
        check('…no numbers left: refused with where to add them', r.status === 409 && r.body?.code === 'NO_NUMBERS' && /Shipping setup/.test(r.body.message), JSON.stringify(r.body));
        const [o4] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so4));
        check('…and the order is free to book again (the claim is released)', o4.shipmentRef === null);
    } finally {
        delete process.env.INDIA_POST_WEBHOOK_SECRET;
        await srv.close();
        if (pausedSeries.length) await db.update(indiaPostBarcodeSeries).set({ isActive: true }).where(inArray(indiaPostBarcodeSeries.id, pausedSeries)).catch(() => null);
        await cleanup();
    }
    process.exit(summary() ? 1 : 0);
}

async function cleanup() {
    const ids = (a: number[]) => a.length ? a.join(',') : '0';
    const uids = ids(userIds);
    const docs = (await db.execute(sql.raw(`SELECT unnest(ARRAY[invoice_document_id, credit_note_document_id, receipt_voucher_document_id, refund_voucher_document_id]) AS id FROM seller_orders WHERE user_id IN (${uids})`)) as any);
    const docIds = (docs.rows ?? docs).map((r: any) => r.id).filter((x: any) => x != null);
    for (const q of [
        `DELETE FROM seller_orders WHERE user_id IN (${uids})`,
        `DELETE FROM tax_document_lines WHERE document_id IN (${ids(docIds)})`,
        `DELETE FROM tax_documents WHERE id IN (${ids(docIds)})`,
        `DELETE FROM store_stock_reservations WHERE checkout_id IN (SELECT id FROM market_checkouts WHERE user_id IN (${uids}))`,
        `DELETE FROM market_checkouts WHERE user_id IN (${uids})`,
        `DELETE FROM product_orders WHERE user_id IN (${uids})`,
        `DELETE FROM store_cart_lines WHERE user_id IN (${uids})`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM india_post_barcode_series WHERE id IN (${ids(seriesIds)})`,
    ]) { try { await db.execute(sql.raw(q)); } catch (e: any) { console.warn(`cleanup: ${e.message.slice(0, 120)}`); } }
    await cleanupPartners(bpIds, [], [`DELETE FROM products WHERE id IN (${ids(productIds)})`]).catch(e => console.warn('cleanup partners', e?.message));
    await db.execute(sql.raw(`DELETE FROM products WHERE id IN (${ids(productIds)})`)).catch(() => null);
    await db.execute(sql.raw(`DELETE FROM users WHERE id IN (${uids})`)).catch(e => console.warn('cleanup users', e?.message));
    // The shipping address: back as it was.
    await db.delete(platformConfig).where(eq(platformConfig.key, WAREHOUSE_KEY)).catch(() => null);
    if (savedWarehouse) await db.insert(platformConfig).values({ key: WAREHOUSE_KEY, value: savedWarehouse.value, valueType: 'json', category: 'OPERATIONAL_CONFIG' }).catch(() => null);
    // Pincodes this run looked up (the cache), not ones that were there before.
    const now = (await db.select({ p: indiaPostPincodes.pincode }).from(indiaPostPincodes)).map(r => r.p).filter(p => !pincodesBefore.has(p));
    if (now.length) await db.delete(indiaPostPincodes).where(inArray(indiaPostPincodes.pincode, now)).catch(() => null);
    if (adminIds.length) {
        await db.execute(sql.raw(`DELETE FROM audit_logs WHERE changed_by IN (${ids(adminIds)})`)).catch(() => null);
        await cleanupPartners([], adminIds).catch(() => null);
        await db.delete(adminUsers).where(inArray(adminUsers.id, adminIds)).catch(() => null);
    }
}

main().catch(async e => { console.error(e); await cleanup().catch(() => null); process.exit(1); });
