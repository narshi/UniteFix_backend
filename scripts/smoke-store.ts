/**
 * Store v2 end to end, on the real route stack and the local database:
 * catalogue, cart upserts under concurrent taps, stock holds under many
 * buyers at once (no overselling), idempotent checkout, superseded and
 * expired holds, payment after a sell-out (refund), UniteFix's own orders
 * fulfilled by staff with GST documents (receipt voucher → tax invoice →
 * credit note), cancel racing cancel, returns and reviews.
 *
 *   npx tsx scripts/smoke-store.ts
 *
 * Payments are mocked (STORE_PAYMENTS_MOCK=1, never honoured in production).
 */

process.env.STORE_PAYMENTS_MOCK = '1';

import jwt from 'jsonwebtoken';
import { inArray, sql, eq } from 'drizzle-orm';
import { check, summary, bootServer, client, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, products, productVariants, adminUsers, sellerOrders, taxDocuments } from '../shared/schema';

const stamp = Date.now().toString(36);
const userIds: number[] = [], productIds: number[] = [], adminIds: number[] = [], categoryIds: number[] = [];
const rows = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ship = { name: 'QA Buyer', phone: '9876543210', line1: '12 MG Road', city: 'Sirsi', pincode: '581401', stateCode: '29' };
const key = (s: string) => `qa-${stamp}-${s}`;

let seq = 0;
async function customer(label: string) {
    const n = ++seq;
    const [u] = await db.insert(users).values({ phone: `6${(Date.now() * 100 + n).toString().slice(-9)}`, username: `QA ${label}`, role: 'user' } as any).returning();
    userIds.push(u.id);
    return { id: u.id, token: jwt.sign({ userId: u.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' }) };
}

async function product(name: string, v: Record<string, unknown>) {
    const [p] = await db.insert(products).values({
        name: `QA ${stamp} ${name}`, category: 'QA', price: 1180, mrp: 1500, stock: 10, isActive: true, listingStatus: 'live',
        hsnCode: '8471', gstPercent: '18', countryOfOrigin: 'India', manufacturer: 'QA Maker', returnWindowDays: 2, ...v,
    } as any).returning();
    productIds.push(p.id);
    return p;
}

async function main() {
    const laptop = await product('Laptop', { stock: 10 });
    const lastUnits = await product('Last three', { stock: 3, price: 590 });
    const food = await product('Kashaya powder', { stock: 5, price: 105, hsnCode: '0910', gstPercent: '5', returnWindowDays: 0 });
    const noHsn = await product('No HSN', { hsnCode: null });
    const nuts = await product('Cashew', { stock: 0, price: 300, hsnCode: '0801', gstPercent: '5', returnWindowDays: 0 });
    const [v250] = await db.insert(productVariants).values({ productId: nuts.id, sku: `QA-${stamp}-250`, variantLabel: '250 g', price: 32000, mrp: 35000, stock: 4, isActive: true }).returning();
    const [v500] = await db.insert(productVariants).values({ productId: nuts.id, sku: `QA-${stamp}-500`, variantLabel: '500 g', price: 61000, mrp: 70000, stock: 2, isActive: true }).returning();

    const srv = await bootServer();
    try {
        const api = client(srv.base);
        const a = await customer('A'), b = await customer('B');

        // ── Catalogue ────────────────────────────────────────────────────
        const list = (await api.get(`/api/store/products?search=${encodeURIComponent(`QA ${stamp}`)}&limit=40`)).body?.data;
        const names = (list?.items ?? []).map((i: any) => i.name);
        check('the catalogue lists UniteFix products that can be invoiced', names.includes(laptop.name) && names.includes(food.name));
        check('…and hides one with no HSN code (it could not be invoiced)', !names.includes(noHsn.name));
        check('…sold by UniteFix', list.items.find((i: any) => i.id === laptop.id)?.soldByUnitefix === true);
        const nutsCard = list.items.find((i: any) => i.id === nuts.id);
        check('a product with options shows its lowest option price and is in stock', nutsCard?.price === 320 && nutsCard.hasOptions && nutsCard.inStock, JSON.stringify(nutsCard));
        const detail = (await api.get(`/api/store/products/${nuts.id}`)).body?.data;
        check('product page: options with what is left of each', detail?.options?.length === 2 && detail.options.find((o: any) => o.id === v500.id)?.available === 2);
        check('…and the disclosures (origin, maker, return policy, seller grievance contact)', detail.details.countryOfOrigin === 'India' && detail.returnPolicy.returnable === false && !!detail.seller.grievance);

        // ── Cart ─────────────────────────────────────────────────────────
        let r = await api.post('/api/store/cart/lines', { productId: nuts.id, quantity: 1 }, a.token);
        check('a product with options needs one chosen', r.status === 409 && r.body?.code === 'CHOOSE_VARIANT');
        r = await api.post('/api/store/cart/lines', { productId: laptop.id, quantity: 1 }, a.token);
        check('add to cart', r.status === 201 && r.body?.data?.lines?.length === 1);
        await Promise.all(Array.from({ length: 5 }, () => api.post('/api/store/cart/lines', { productId: laptop.id, quantity: 1 }, a.token)));
        let cart = (await api.get('/api/store/cart', a.token)).body?.data;
        check('five taps at once add five, in one line (no lost or duplicate rows)', cart.lines.length === 1 && cart.lines[0].quantity === 6, JSON.stringify(cart.lines));
        r = await api.post('/api/store/cart/lines', { productId: laptop.id, quantity: 5 }, a.token);
        check('adding past the stock is refused with what is left', r.status === 409 && r.body?.code === 'LOW_STOCK');
        await api.post('/api/store/cart/lines', { productId: nuts.id, variantId: v250.id, quantity: 2 }, a.token);
        cart = (await api.get('/api/store/cart', a.token)).body?.data;
        check('cart total is the sum of its lines', cart.total === 6 * 1180 + 2 * 320 && cart.canCheckout, `${cart.total}`);
        const lid = cart.lines.find((l: any) => l.productId === laptop.id).id;
        cart = (await api.patch(`/api/store/cart/lines/${lid}`, { quantity: 1 }, a.token)).body?.data;
        check('change a quantity', cart.lines.find((l: any) => l.id === lid).quantity === 1);
        r = await api.get('/api/store/cart', b.token);
        check('one customer never sees another\'s cart', r.body?.data?.lines?.length === 0);
        r = await api.patch(`/api/store/cart/lines/${lid}`, { quantity: 2 }, b.token);
        check('…nor changes it', r.status === 404);

        // ── Checkout: preview, idempotency, holds ────────────────────────
        const pv = (await api.post('/api/store/checkout/preview', { source: 'cart' }, a.token)).body?.data;
        check('order summary before paying, with GST inside the total', pv?.total === 1180 + 640 && pv.tax > 0 && pv.stockIssues.length === 0);
        const k1 = key('a1');
        const start = (body: any, token: string, k: string) => fetch(`${srv.base}/api/store/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': k }, body: JSON.stringify(body) }).then(async x => ({ status: x.status, body: await x.json() }));
        const s1 = await start({ source: 'cart', shipTo: ship }, a.token, k1);
        const s1b = await start({ source: 'cart', shipTo: ship }, a.token, k1);
        check('checkout starts and holds the stock', s1.status === 201 && s1.body?.data?.payment?.provider === 'mock', JSON.stringify(s1.body).slice(0, 300));
        check('the same Idempotency-Key returns the same checkout (a retried tap never charges twice)', s1b.status === 200 && s1b.body?.data?.checkoutId === s1.body.data.checkoutId && s1b.body.data.replay === true);
        const held = rows(await db.execute(sql`SELECT COALESCE(SUM(quantity),0)::int AS n FROM store_stock_reservations WHERE checkout_id = ${s1.body.data.checkoutId} AND status = 'held'`))[0]?.n;
        check('…holding exactly what is being bought', held === 3);
        const after = (await api.get(`/api/store/products/${nuts.id}`)).body?.data;
        check('held stock is not offered to others', after.options.find((o: any) => o.id === v250.id)?.available === 2);

        const s2 = await start({ source: 'cart', shipTo: ship }, a.token, key('a2'));
        const first = rows(await db.execute(sql`SELECT status FROM market_checkouts WHERE id = ${s1.body.data.checkoutId}`))[0]?.status;
        const firstHeld = rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM store_stock_reservations WHERE checkout_id = ${s1.body.data.checkoutId} AND status = 'held'`))[0]?.n;
        check('a new checkout by the same customer supersedes the old one and frees its hold', s2.status === 201 && first === 'superseded' && firstHeld === 0);

        r = await start({ source: 'cart', shipTo: { ...ship, stateCode: '99' } }, a.token, key('bad'));
        check('the state (place of supply) is required', r.status === 400 || r.status === 409 ? true : false);

        // Pay (mock): the cart order becomes UniteFix's own seller order
        r = await api.post(`/api/store/checkout/${s2.body.data.checkoutId}/mock-pay`, {}, a.token);
        check('payment places the order', r.status === 200 && r.body?.data?.orders?.length === 1, JSON.stringify(r.body));
        const soId = r.body.data.orders[0].id;
        check('…as a UniteFix order (SO-…-UF)', /^SO-\d+-UF$/.test(r.body.data.orders[0].code));
        r = await api.post(`/api/store/checkout/${s2.body.data.checkoutId}/mock-pay`, {}, a.token);
        check('paying twice creates nothing more', r.status === 200 && r.body?.data?.orders?.length === 1);
        cart = (await api.get('/api/store/cart', a.token)).body?.data;
        check('what was bought leaves the cart', cart.lines.length === 0);
        const [lap] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, laptop.id));
        const [v] = await db.select({ stock: productVariants.stock }).from(productVariants).where(eq(productVariants.id, v250.id));
        check('stock is taken: product and option', lap.stock === 9 && v.stock === 2, `${lap.stock} ${v.stock}`);
        let so: any;
        for (let i = 0; i < 20; i++) { [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, soId)); if (so.receiptVoucherDocumentId) break; await sleep(150); }
        check('a receipt voucher is issued for the payment', !!so.receiptVoucherDocumentId);
        check('…with the delivery state as place of supply, no commission and no TCS on UniteFix\'s own sale', so.shipStateCode === '29' && so.commissionPaise === 0 && so.tcsPaise === 0 && so.sellerPartnerId === null);

        // ── Many buyers, three units ─────────────────────────────────────
        const buyers = await Promise.all(Array.from({ length: 10 }, (_, i) => customer(`Rush ${i}`)));
        const rush = await Promise.all(buyers.map((u, i) => start({ source: 'buy_now', items: [{ productId: lastUnits.id, quantity: 1 }], shipTo: ship }, u.token, key(`rush${i}`))));
        const won = rush.filter(x => x.status === 201), lost = rush.filter(x => x.status === 409);
        check('ten buyers, three units: exactly three get a hold', won.length === 3 && lost.length === 7, rush.map(x => x.status).join(','));
        check('…the rest are told it is out of stock before paying', lost.every(x => x.body?.code === 'OUT_OF_STOCK'));
        const paid = await Promise.all(won.map(x => { const u = buyers[rush.indexOf(x)]; return api.post(`/api/store/checkout/${x.body.data.checkoutId}/mock-pay`, {}, u.token); }));
        const [lu] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, lastUnits.id));
        check('all three pay; stock ends at exactly zero (never negative)', paid.every(p => p.status === 200) && lu.stock === 0, `stock ${lu.stock}`);

        // ── A hold that lapsed, and a payment after a sell-out ───────────
        const x = await customer('Late'), y = await customer('Quick');
        const hx = await start({ source: 'buy_now', items: [{ productId: nuts.id, variantId: v500.id, quantity: 2 }], shipTo: ship }, x.token, key('late'));
        await db.execute(sql`UPDATE store_stock_reservations SET expires_at = NOW() - INTERVAL '1 minute' WHERE checkout_id = ${hx.body.data.checkoutId}`);
        const { StoreCheckout } = await import('../server/services/store/checkout.service');
        await StoreCheckout.expireHolds();
        const hy = await start({ source: 'buy_now', items: [{ productId: nuts.id, variantId: v500.id, quantity: 2 }], shipTo: ship }, y.token, key('quick'));
        check('a lapsed hold frees the stock for the next buyer', hy.status === 201);
        await api.post(`/api/store/checkout/${hy.body.data.checkoutId}/mock-pay`, {}, y.token);
        r = await api.post(`/api/store/checkout/${hx.body.data.checkoutId}/mock-pay`, {}, x.token);
        const hxRow = rows(await db.execute(sql`SELECT status FROM market_checkouts WHERE id = ${hx.body.data.checkoutId}`))[0];
        check('paying after the stock went: no order, full refund due', r.status === 409 && hxRow.status === 'refund_due' && (await db.select().from(sellerOrders).where(eq(sellerOrders.checkoutId, hx.body.data.checkoutId))).length === 0);

        // ── Staff fulfil UniteFix's order; GST documents ─────────────────
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const at = await api.login(sa.username, sa.password);
        let list2 = (await api.get('/api/admin/store/orders?status=to_ship', at)).body?.data;
        check('staff see UniteFix orders to ship', list2?.items?.some((o: any) => o.id === soId));
        r = await api.post(`/api/admin/store/orders/${soId}/transition`, { to: 'confirmed' }, at);
        check('staff confirm', r.status === 200);
        r = await api.post(`/api/admin/store/orders/${soId}/transition`, { to: 'dispatched', courier: 'India Post', trackingId: 'EE123456789IN' }, at);
        check('staff dispatch with the Speed Post article number', r.status === 200, JSON.stringify(r.body));
        [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, soId));
        const [inv] = await db.select().from(taxDocuments).where(eq(taxDocuments.id, so.invoiceDocumentId!));
        check('dispatch issues UniteFix\'s tax invoice in its store series', !!inv && inv.issuer === 'unitefix' && /^UF\/\d\d-\d\d\/S\d{5}$/.test(inv.number) && inv.purpose === 'store_sale', inv?.number);
        check('…intra-state Karnataka: CGST + SGST, totals match the order', !inv.isInterstate && inv.cgstPaise > 0 && inv.igstPaise === 0 && inv.totalPaise === so.totalPaise);
        const [rv] = await db.select().from(taxDocuments).where(eq(taxDocuments.id, so.receiptVoucherDocumentId!));
        check('…and links the receipt voucher to it (advance adjusted)', rv.originalDocumentId === inv.id);
        const mine = (await api.get(`/api/store/orders/${soId}`, a.token)).body?.data;
        check('the customer sees it shipped, with tracking and a timeline', mine?.status === 'dispatched' && mine.shipment?.trackingId === 'EE123456789IN' && mine.timeline?.length >= 3);
        r = await fetch(`${srv.base}/api/store/orders/${soId}/invoice`, { headers: { Authorization: `Bearer ${a.token}` } }) as any;
        check('…and downloads the invoice PDF', r.status === 200 && (r.headers.get('content-type') ?? '').includes('pdf'));
        r = await fetch(`${srv.base}/api/store/orders/${soId}/invoice`, { headers: { Authorization: `Bearer ${b.token}` } }) as any;
        check('another customer cannot', r.status === 404);
        await api.post(`/api/admin/store/orders/${soId}/transition`, { to: 'delivered' }, at);
        r = await api.post(`/api/store/orders/${soId}/return`, { reason: 'Screen has a dead pixel' }, a.token);
        check('return requested within the window', r.status === 200);
        await api.post(`/api/admin/store/orders/${soId}/return`, { decision: 'approve' }, at);
        const rec = await Promise.all([1, 2].map(() => api.post(`/api/admin/store/orders/${soId}/return`, { decision: 'received' }, at)));
        [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, soId));
        check('return received twice at once: refunded once, credit note once', rec.filter(q => q.status === 200).length === 1 && so.status === 'returned' && !!so.creditNoteDocumentId && so.refundStatus === 'initiated');
        const [lap2] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, laptop.id));
        check('…and the stock is back', lap2.stock === 10);

        // ── Opening a document from the app: a signed link, not the token ─
        const invDoc = mine.documents.find((x: any) => x.kind === 'tax_invoice');
        const link = (await api.post(`/api/store/orders/${soId}/documents/${invDoc.id}/link`, {}, a.token)).body?.data?.url as string;
        r = await fetch(link) as any;
        check('the app gets a short-lived signed link that opens the invoice PDF', !!link && r.status === 200 && (r.headers.get('content-type') ?? '').includes('pdf'));
        r = await fetch(link.replace(/sig=([0-9a-f])/, (_m: string, c: string) => `sig=${c === 'a' ? 'b' : 'a'}`)) as any;
        check('…a tampered link is refused', r.status === 403);
        r = await api.post(`/api/store/orders/${soId}/documents/${invDoc.id}/link`, {}, b.token);
        check('…and nobody else can get a link to it', r.status === 404);

        // ── Staff add a UniteFix product: invoice fields checked, Shop category set ─
        const catName = `QA Spices ${stamp}`;
        r = await api.post('/api/admin/inventory', { name: `QA ${stamp} Pepper`, category: catName, price: 250, mrp: 200, stock: 4, hsnCode: '0904', gstPercent: '5', returnWindowDays: 0, isActive: true }, at);
        check('a price above the MRP is refused', r.status === 400);
        r = await api.post('/api/admin/inventory', { name: `QA ${stamp} Pepper`, category: catName, price: 250, mrp: 300, stock: 4, hsnCode: '9987', gstPercent: '5', returnWindowDays: 0, isActive: true }, at);
        check('a service code (99…) as HSN is refused', r.status === 400);
        r = await api.post('/api/admin/inventory', { name: `QA ${stamp} Pepper`, category: catName, price: 250, mrp: 300, stock: 4, hsnCode: '0904', gstPercent: '5', returnWindowDays: 0, countryOfOrigin: 'India', manufacturer: 'QA Estates', isActive: true }, at);
        if (r.body?.id) productIds.push(r.body.id);
        const cats = (await api.get('/api/store/categories')).body?.data ?? [];
        const qaCat = cats.find((c: any) => c.name === catName);
        check('staff add a product: it gets a Shop category and appears in the Shop', r.status === 201 && !!qaCat && qaCat.count === 1, JSON.stringify(r.body).slice(0, 200));
        const inCat = (await api.get(`/api/store/products?categoryId=${qaCat?.id}`)).body?.data;
        check('…filtering by that category shows it', inCat?.items?.length === 1 && inCat.items[0].name === `QA ${stamp} Pepper`);
        if (qaCat) categoryIds.push(qaCat.id);

        // ── Cancel racing cancel; non-returnable food; reviews ───────────
        const c = await customer('Cancel');
        const hc = await start({ source: 'buy_now', items: [{ productId: food.id, quantity: 2 }], shipTo: { ...ship, stateCode: '27' } }, c.token, key('cancel'));
        const pc = await api.post(`/api/store/checkout/${hc.body.data.checkoutId}/mock-pay`, {}, c.token);
        const cid = pc.body.data.orders[0].id;
        const cc = await Promise.all([1, 2].map(() => api.post(`/api/store/orders/${cid}/cancel`, { reason: 'Ordered by mistake' }, c.token)));
        const [fs] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, food.id));
        check('two cancels at once: one wins, stock back once', cc.filter(q => q.status === 200).length === 1 && fs.stock === 5, cc.map(q => q.status).join(','));
        let cso: any;
        for (let i = 0; i < 20; i++) { [cso] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, cid)); if (cso.refundVoucherDocumentId) break; await sleep(150); }
        check('cancelled before dispatch: refund voucher against the receipt voucher', !!cso.receiptVoucherDocumentId && !!cso.refundVoucherDocumentId);
        const [rcv] = await db.select().from(taxDocuments).where(eq(taxDocuments.id, cso.receiptVoucherDocumentId));
        check('…Maharashtra delivery from Karnataka: inter-state place of supply', rcv.isInterstate && rcv.placeOfSupplyCode === '27');

        const d = await customer('Food');
        const hd = await start({ source: 'buy_now', items: [{ productId: food.id, quantity: 1 }], shipTo: ship }, d.token, key('food'));
        const did = (await api.post(`/api/store/checkout/${hd.body.data.checkoutId}/mock-pay`, {}, d.token)).body.data.orders[0].id;
        for (const to of ['confirmed', 'dispatched', 'delivered']) await api.post(`/api/admin/store/orders/${did}/transition`, { to, courier: 'India Post', trackingId: 'EE987654321IN' }, at);
        r = await api.post(`/api/store/orders/${did}/return`, { reason: 'Changed my mind' }, d.token);
        check('food is not returnable', r.status === 409 && r.body?.code === 'NOT_RETURNABLE');
        const dItem = (await api.get(`/api/store/orders/${did}`, d.token)).body.data.items[0].id;
        r = await api.post(`/api/store/items/${dItem}/review`, { rating: 5, review: 'Tastes like home' }, d.token);
        check('a delivered item can be reviewed', r.status === 201);
        r = await api.post(`/api/store/items/${dItem}/review`, { rating: 4 }, d.token);
        check('…once', r.status === 409);
        const pr = (await api.get(`/api/store/products/${food.id}`)).body?.data;
        check('the rating shows on the product', pr?.rating?.count === 1 && pr.rating.average === 5);
        list2 = (await api.get('/api/store/orders', d.token)).body?.data;
        check('order history lists the customer\'s orders', list2?.items?.length === 1 && list2.items[0].id === did);
    } finally {
        await srv.close();
        await cleanup();
    }
    process.exit(summary());
}

async function cleanup() {
    const uids = userIds.length ? userIds : [0], pids = productIds.length ? productIds : [0];
    const so = await db.select({ id: sellerOrders.id, a: sellerOrders.invoiceDocumentId, b: sellerOrders.creditNoteDocumentId, c: sellerOrders.receiptVoucherDocumentId, d: sellerOrders.refundVoucherDocumentId }).from(sellerOrders).where(inArray(sellerOrders.userId, uids));
    const docs = so.flatMap(s => [s.a, s.b, s.c, s.d]).filter((x): x is number => x != null);
    const ids = (xs: number[]) => (xs.length ? xs.join(',') : '0');
    for (const q of [
        `DELETE FROM product_reviews WHERE user_id IN (${ids(uids)})`,
        `DELETE FROM seller_orders WHERE user_id IN (${ids(uids)})`,
        `UPDATE tax_documents SET original_document_id = NULL WHERE id IN (${ids(docs)})`,
        `DELETE FROM tax_document_lines WHERE document_id IN (${ids(docs)})`,
        `DELETE FROM tax_documents WHERE id IN (${ids(docs)})`,
        `DELETE FROM store_stock_reservations WHERE checkout_id IN (SELECT id FROM market_checkouts WHERE user_id IN (${ids(uids)}))`,
        `DELETE FROM market_checkouts WHERE user_id IN (${ids(uids)})`,
        `DELETE FROM product_orders WHERE user_id IN (${ids(uids)})`,
        `DELETE FROM store_cart_lines WHERE user_id IN (${ids(uids)})`,
        `DELETE FROM notifications WHERE user_id IN (${ids(uids)})`,
        `DELETE FROM product_variants WHERE product_id IN (${ids(pids)})`,
        `DELETE FROM products WHERE id IN (${ids(pids)})`,
        `DELETE FROM product_categories WHERE id IN (${ids(categoryIds)})`,
        `DELETE FROM users WHERE id IN (${ids(uids)})`,
    ]) { try { await db.execute(sql.raw(q)); } catch (e: any) { console.warn(`cleanup: ${e.message.slice(0, 120)}`); } }
    if (adminIds.length) {
        await db.execute(sql.raw(`DELETE FROM audit_logs WHERE changed_by IN (${ids(adminIds)})`)).catch(() => null);
        await db.delete(adminUsers).where(inArray(adminUsers.id, adminIds)).catch(() => null);
    }
}

main().catch(async e => { console.error(e); await cleanup().catch(() => null); process.exit(1); });
