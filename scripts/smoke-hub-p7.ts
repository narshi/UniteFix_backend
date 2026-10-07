/**
 * Partner Hub — phase 7 end to end: partners selling products through the
 * UniteFix store — listings with compliance, review, server-priced checkout
 * split per seller, fulfilment with the seller's GST invoice, cancel, return
 * with credit note, settlement with commission / TCS / TDS, reviews, tiers.
 *
 *   npm run smoke:hub-p7
 */

import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, gstinFor, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, businessPartners, businessPartnerLedger, users, products, productCategories, sellerOrders, marketCheckouts, taxDocuments, hubAlerts } from '../shared/schema';
import { configService } from '../server/services/config.service';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';
import { MarketplaceService } from '../server/services/marketplace.service';
import { TaxDocumentService } from '../server/services/tax-documents.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [];
const bpIds: number[] = [];
const userIds: number[] = [];
let categoryId = 0;

async function main() {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const staff = (await api.login(sa.username, sa.password))!;
        const s1 = await BusinessPartnerService.create({ legalName: `QA Poorvi Computers ${stamp}`, displayName: 'Poorvi Computers', gstin: await gstinFor('29', 'QAPRV1234K'), contactPhone: `7${String(Date.now()).slice(-9)}`, contactEmail: `qa_p7a_${stamp}@example.test`, verticalCodes: ['electronics'], approvedByAdminId: sa.id, address: 'Karwar', pincode: '581301' });
        const s2 = await BusinessPartnerService.create({ legalName: `QA Pune Gadgets ${stamp}`, displayName: 'Pune Gadgets', gstin: await gstinFor('27', 'QAPNG1234K'), contactPhone: `6${String(Date.now()).slice(-9)}`, contactEmail: `qa_p7b_${stamp}@example.test`, verticalCodes: ['electronics'], approvedByAdminId: sa.id });
        bpIds.push(s1.id, s2.id);
        await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka', hubPlan: 'pro' }).where(eq(businessPartners.id, s1.id));
        await db.update(businessPartners).set({ stateCode: '27', stateName: 'Maharashtra', sellerTier: 'standard', sellerTierLocked: true, grievanceName: 'Asha', grievancePhone: '9811100022', grievanceEmail: 'care@pune.example', returnPolicy: '7-day replacement' }).where(eq(businessPartners.id, s2.id));
        const l1 = await PartnerHubService.createOwnerLogin(s1.id, {});
        const l2 = await PartnerHubService.createOwnerLogin(s2.id, {});
        for (const e of [l1.username, l2.username]) { const [r] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, e)); if (r) adminIds.push(r.id); }
        const t1 = (await api.login(l1.username, l1.temporaryPassword))!;
        const t2 = (await api.login(l2.username, l2.temporaryPassword))!;
        const [cat] = await db.insert(productCategories).values({ name: `QA Networking ${stamp}`, slug: `qa-net-${stamp}` }).returning(); categoryId = cat.id;

        // ── listings ──────────────────────────────────────────────────────
        const ov = await api.get('/api/hub/store/overview', t1);
        check('a new seller is told what is missing before listing', ov.status === 200 && ov.body?.data?.gaps?.length === 2, JSON.stringify(ov.body?.data?.gaps));
        const base1 = { name: 'QA Dual-band router', categoryId: cat.id, priceRupees: 2499, mrpRupees: 2999, stock: 10, hsnCode: '85176290', gstPercent: 18, countryOfOrigin: 'India', manufacturer: 'QA Networks Pvt Ltd' };
        const aboveMrp = await api.post('/api/hub/store/listings', { ...base1, priceRupees: 3100 }, t1);
        check('a price above MRP is refused (Legal Metrology)', aboveMrp.status === 400 && aboveMrp.body?.code === 'ABOVE_MRP');
        const sac = await api.post('/api/hub/store/listings', { ...base1, hsnCode: '998713' }, t1);
        check('a service SAC is refused for goods', sac.status === 400 && sac.body?.code === 'BAD_HSN');
        const noOrigin = await api.post('/api/hub/store/listings', { ...base1, countryOfOrigin: undefined }, t1);
        check('country of origin is required', noOrigin.status === 400);
        const d1 = await api.post('/api/hub/store/listings', base1, t1);
        check('a listing is saved as a draft', d1.status === 201);
        const pid1 = d1.body.data.id;
        const list = await api.get('/api/products/list?limit=200');
        check('a draft is not in the store', !(list.body?.data ?? []).some((p: any) => p.id === pid1));
        const early = await api.post(`/api/hub/store/listings/${pid1}/submit`, {}, t1);
        check('it cannot be submitted without grievance contact and return policy', early.status === 409 && early.body?.code === 'NOT_READY');
        await api.put('/api/hub/store/profile', { grievanceName: 'Ravi Poorvi', grievancePhone: '9845000111', grievanceEmail: 'help@poorvi.example', returnPolicy: '7-day return if unused, in original box.' }, t1);
        const sub = await api.post(`/api/hub/store/listings/${pid1}/submit`, {}, t1);
        check('a new seller\'s listing goes to review', sub.status === 200 && sub.body?.data?.status === 'pending_review');
        const q = await api.get('/api/admin/hub/store/listings/pending', staff);
        check('staff see it in the review queue with its compliance fields', q.body?.data?.some((l: any) => l.id === pid1 && l.hsnCode === '85176290' && l.mrp === 2999));
        const rej = await api.post('/api/admin/hub/store/listings/review', { ids: [pid1], approve: false }, staff);
        check('a rejection needs a reason', rej.status === 400);
        await api.post('/api/admin/hub/store/listings/review', { ids: [pid1], approve: true }, staff);
        const [p1] = await db.select().from(products).where(eq(products.id, pid1));
        check('approved: live and visible in the store', p1.listingStatus === 'live' && p1.isActive === true && (await api.get('/api/products/list?limit=500')).body?.data?.some((p: any) => p.id === pid1));
        const d2 = await api.post('/api/hub/store/listings', { ...base1, name: 'QA Mesh node', priceRupees: 1500, mrpRupees: 1800, stock: 5, gstPercent: 18, returnWindowDays: 10 }, t2);
        const sub2 = await api.post(`/api/hub/store/listings/${d2.body.data.id}/submit`, {}, t2);
        check('an established seller\'s listing goes live without review', sub2.body?.data?.status === 'live');
        const pid2 = d2.body.data.id;
        check('another seller cannot edit it', (await api.patch(`/api/hub/store/listings/${pid2}`, { stock: 0 }, t1)).status === 404);

        const disc = await api.get(`/api/store/products/${pid1}/seller`);
        check('the product page discloses the seller (legal name, GSTIN, grievance, return policy) and origin', disc.status === 200 && disc.body?.data?.seller?.gstin === s1.gstin && disc.body.data.seller.grievance.phone === '9845000111' && disc.body.data.product.countryOfOrigin === 'India' && disc.body.data.product.mrp === 2999);

        // ── checkout ──────────────────────────────────────────────────────
        const [cu] = await db.insert(users).values({ phone: `8${String(Date.now()).slice(-9)}`, username: 'QA Shopper', role: 'user', homeAddress: 'Karwar', pinCode: '581301' } as any).returning();
        userIds.push(cu.id);
        const ct = jwt.sign({ userId: cu.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
        const legacy = await api.post('/api/orders/place', { products: [{ productId: pid1, quantity: 1 }], address: 'x' }, ct);
        check('the old checkout refuses partner listings (it cannot split or settle them)', legacy.status === 409 && legacy.body?.code === 'USE_STORE_CHECKOUT');
        const tooMany = await api.post('/api/store/quote', { items: [{ productId: pid2, quantity: 9 }] }, ct);
        check('more than the stock is refused', tooMany.status === 409 && tooMany.body?.code === 'STOCK');
        const qt = await api.post('/api/store/quote', { items: [{ productId: pid1, quantity: 2 }, { productId: pid2, quantity: 1 }] }, ct);
        check('the server prices the cart: two sellers, ₹6,498', qt.status === 200 && qt.body?.data?.total === 6498 && qt.body.data.sellers.length === 2);
        const co = await api.post('/api/store/checkout', { items: [{ productId: pid1, quantity: 2 }, { productId: pid2, quantity: 1 }], address: 'Main road, Karwar', pincode: '581301' }, ct);
        check('checkout opens a payment for the server\'s total', co.status === 201 && co.body?.data?.total === 6498);
        const badSig = await api.post(`/api/store/checkout/${co.body.data.checkoutId}/verify`, { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: 'nope' }, ct);
        check('a payment that cannot be verified is refused', badSig.status === 400);
        const cap = await MarketplaceService.applyCapture({ checkoutId: co.body.data.checkoutId, razorpayPaymentId: `pay_qa_${stamp}`, amountPaise: 649800 });
        const sos = await db.select().from(sellerOrders).where(eq(sellerOrders.checkoutId, co.body.data.checkoutId));
        check('payment splits into one seller order per seller', (cap as any).created === true && sos.length === 2);
        const so1 = sos.find(s => s.sellerPartnerId === s1.id)!, so2 = sos.find(s => s.sellerPartnerId === s2.id)!;
        const taxable1 = Math.round(499800 * 100 / 118);
        check('seller 1: ₹4,998 with commission 10% of pre-tax value, TCS 0.5%, TDS 0.1%', so1.totalPaise === 499800 && so1.taxablePaise === taxable1 && so1.commissionPaise === Math.round(taxable1 * 0.1) && so1.tcsPaise === Math.round(taxable1 * 0.005) && so1.tdsPaise === Math.round(taxable1 * 0.001), JSON.stringify({ t: so1.taxablePaise, c: so1.commissionPaise, tcs: so1.tcsPaise, tds: so1.tdsPaise }));
        check('stock was taken', (await db.select().from(products).where(eq(products.id, pid1)))[0].stock === 8);
        check('applying the same payment twice changes nothing', (await MarketplaceService.applyCapture({ checkoutId: co.body.data.checkoutId, razorpayPaymentId: `pay_qa_${stamp}` }) as any).created === false);

        // Sold out between quote and payment → full refund, nothing created
        const co2 = await api.post('/api/store/checkout', { items: [{ productId: pid2, quantity: 1 }], address: 'Karwar', pincode: '581301' }, ct);
        await db.update(products).set({ stock: 0 }).where(eq(products.id, pid2));
        const cap2: any = await MarketplaceService.applyCapture({ checkoutId: co2.body.data.checkoutId, razorpayPaymentId: `pay_qa2_${stamp}` });
        const [c2] = await db.select().from(marketCheckouts).where(eq(marketCheckouts.id, co2.body.data.checkoutId));
        check('sold out after paying: refund due, no seller order', !!cap2.soldOut && c2.status === 'refund_due' && (await db.select().from(sellerOrders).where(eq(sellerOrders.checkoutId, c2.id))).length === 0);

        // ── fulfilment ────────────────────────────────────────────────────
        const o1 = await api.get('/api/hub/store/orders', t1);
        check('the seller sees only their order, with the customer\'s address', o1.body?.data?.length === 1 && o1.body.data[0].code === so1.code && o1.body.data[0].shipAddress === 'Main road, Karwar' && o1.body.data[0].items.length === 1);
        check('…and its net after commission, TCS and TDS', Math.abs(o1.body.data[0].net - (so1.totalPaise - so1.commissionPaise - so1.commissionGstPaise - so1.tcsPaise - so1.tdsPaise - so1.gatewayFeePaise - so1.gatewayFeeGstPaise) / 100) < 0.01);
        check('another seller cannot touch it', (await api.post(`/api/hub/store/orders/${so1.id}/transition`, { to: 'confirmed' }, t2)).status === 404);
        await api.post(`/api/hub/store/orders/${so1.id}/transition`, { to: 'confirmed' }, t1);
        const noTrack = await api.post(`/api/hub/store/orders/${so1.id}/transition`, { to: 'dispatched' }, t1);
        check('dispatch needs a courier and tracking id', noTrack.status === 400 && noTrack.body?.code === 'NO_TRACKING');
        const disp = await api.post(`/api/hub/store/orders/${so1.id}/transition`, { to: 'dispatched', courier: 'DTDC', trackingId: 'D123456' }, t1);
        const [so1b] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so1.id));
        const [inv] = await db.select().from(taxDocuments).where(eq(taxDocuments.id, so1b.invoiceDocumentId ?? 0));
        check('dispatch issues the seller\'s GST invoice to the customer, on the seller\'s GSTIN', disp.status === 200 && !!inv && inv.issuerPartnerId === s1.id && inv.purpose === 'marketplace_sale' && inv.totalPaise === so1.totalPaise && (inv.supplier as any).gstin === s1.gstin);
        const pdf = await fetch(`${base}/api/store/orders/${so1.id}/invoice`, { headers: { Authorization: `Bearer ${ct}` } });
        check('the customer downloads the invoice', pdf.status === 200 && Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString() === '%PDF');
        const earlyRev = await api.post(`/api/store/items/${(o1.body.data[0].items[0].id)}/review`, { rating: 5 }, ct);
        check('no review before delivery', earlyRev.status === 409);
        await api.post(`/api/hub/store/orders/${so1.id}/transition`, { to: 'delivered' }, t1);
        const rv = await api.post(`/api/store/items/${o1.body.data[0].items[0].id}/review`, { rating: 4, review: 'Good range' }, ct);
        check('a verified purchase is reviewed after delivery', rv.status === 201);
        check('…once', (await api.post(`/api/store/items/${o1.body.data[0].items[0].id}/review`, { rating: 1 }, ct)).status === 409);
        const revs = await api.get('/api/hub/store/reviews', t1);
        const reply = await api.post(`/api/hub/store/reviews/${revs.body.data[0].id}/reply`, { reply: 'Thank you!' }, t1);
        check('the seller replies once', reply.status === 200 && (await api.post(`/api/hub/store/reviews/${revs.body.data[0].id}/reply`, { reply: 'again' }, t1)).status === 409);

        // ── customer cancel (seller 2, before dispatch) ───────────────────
        await db.update(products).set({ stock: 4 }).where(eq(products.id, pid2));
        const my = await api.get('/api/store/orders', ct);
        check('the customer sees one order per seller, with the seller named', my.body?.data?.length === 2 && my.body.data.some((o: any) => o.seller.name === 'Pune Gadgets' && o.canCancel));
        const cx = await api.post(`/api/store/orders/${so2.id}/cancel`, { reason: 'Ordered by mistake' }, ct);
        const [so2b] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so2.id));
        check('cancelling before dispatch refunds that seller\'s part and returns the stock', cx.status === 200 && so2b.status === 'cancelled' && so2b.refundPaise === so2.totalPaise && (await db.select().from(products).where(eq(products.id, pid2)))[0].stock === 5);

        // ── return (seller 1) ─────────────────────────────────────────────
        const ret = await api.post(`/api/store/orders/${so1.id}/return`, { reason: 'Drops connection' }, ct);
        check('a return is requested inside the window', ret.status === 200);
        const recvEarly = await api.post(`/api/hub/store/orders/${so1.id}/return`, { decision: 'received' }, t1);
        check('it must be approved before it is received', recvEarly.status === 409);
        await api.post(`/api/hub/store/orders/${so1.id}/return`, { decision: 'approve' }, t1);
        const recv = await api.post(`/api/hub/store/orders/${so1.id}/return`, { decision: 'received' }, t1);
        const [so1c] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so1.id));
        const [cn] = await db.select().from(taxDocuments).where(eq(taxDocuments.id, so1c.creditNoteDocumentId ?? 0));
        check('received: credit note against the invoice, refund, stock back', recv.status === 200 && so1c.status === 'returned' && cn?.docKind === 'credit_note' && cn.originalDocumentId === inv.id && (await db.select().from(products).where(eq(products.id, pid1)))[0].stock === 10);
        await db.update(sellerOrders).set({ settleAfter: new Date(Date.now() - 1000) }).where(eq(sellerOrders.id, so1.id));
        await MarketplaceService.settleDue();
        check('a returned order never settles', !(await db.select().from(sellerOrders).where(eq(sellerOrders.id, so1.id)))[0].settledAt);

        // ── a clean sale that settles ─────────────────────────────────────
        const co3 = await api.post('/api/store/checkout', { items: [{ productId: pid1, quantity: 1 }], address: 'Karwar', pincode: '581301' }, ct);
        await MarketplaceService.applyCapture({ checkoutId: co3.body.data.checkoutId, razorpayPaymentId: `pay_qa3_${stamp}` });
        const [so3] = await db.select().from(sellerOrders).where(eq(sellerOrders.checkoutId, co3.body.data.checkoutId));
        await api.post(`/api/hub/store/orders/${so3.id}/transition`, { to: 'confirmed' }, t1);
        await api.post(`/api/hub/store/orders/${so3.id}/transition`, { to: 'dispatched', courier: 'DTDC', trackingId: 'D999' }, t1);
        await api.post(`/api/hub/store/orders/${so3.id}/transition`, { to: 'delivered' }, t1);
        const before = await BusinessPartnerService.balancePaise(s1.id);
        await MarketplaceService.settleDue();
        check('inside the return window nothing settles', (await BusinessPartnerService.balancePaise(s1.id)) === before);
        await db.update(sellerOrders).set({ settleAfter: new Date(Date.now() - 1000) }).where(eq(sellerOrders.id, so3.id));
        const settled = await MarketplaceService.settleDue();
        const [s3] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so3.id));
        const net = s3.totalPaise - s3.commissionPaise - s3.commissionGstPaise - s3.tcsPaise - s3.tdsPaise - s3.gatewayFeePaise - s3.gatewayFeeGstPaise;
        const after = await BusinessPartnerService.balancePaise(s1.id);
        check('after the window: sale, commission + GST, TCS and TDS on the ledger — UniteFix owes the net', settled >= 1 && after - before === -net, `${after - before} vs ${-net}`);
        const lines = await db.select().from(businessPartnerLedger).where(eq(businessPartnerLedger.businessPartnerId, s1.id));
        check('each is its own line', ['marketplace_sale', 'marketplace_commission', 'tcs', 'tds'].every(k => lines.some(l => l.entryType === k)));
        check('settles once', (await MarketplaceService.settleDue()) === 0);
        const work = await api.get('/api/admin/hub/settlements/worklist', staff);
        check('the seller is on the settlement worklist for the net', Math.round((work.body?.data?.find((w: any) => w.businessPartnerId === s1.id)?.payout ?? 0) * 100) === net);

        // ── GST: seller's GSTR-1, UniteFix's commission invoice, TCS report ─
        const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
        const g = await api.get(`/api/hub/gst/gstr1.json?period=${month}`, t1);
        const eco = (await TaxDocumentService.unitefixParty()).gstin;
        check('the seller\'s GSTR-1 reports store sales as e-commerce B2C (typ E, with UniteFix\'s GSTIN)', g.status === 200 && (!eco || (g.body?.b2cs ?? []).some((r: any) => r.typ === 'E' && r.etin === eco)), JSON.stringify(g.body?.b2cs));
        const fee = await TaxDocumentService.issueFeeInvoice(s1.id, new Date(`${month}-01T00:00:00Z`), sa.id);
        const feeLines = fee ? await db.select().from((await import('../shared/schema')).taxDocumentLines).where(eq((await import('../shared/schema')).taxDocumentLines.documentId, fee.id)) : [];
        check('UniteFix\'s monthly invoice to the seller carries the store commission', feeLines.some(l => /Store commission/.test(l.description) && l.taxablePaise === s3.commissionPaise));
        const tcs = await fetch(`${base}/api/admin/hub/store/tcs.csv?month=${month}`, { headers: { Authorization: `Bearer ${staff}` } });
        const tcsCsv = await tcs.text();
        check('staff export the TCS/TDS working for GSTR-8 and 26Q', tcs.status === 200 && tcsCsv.includes(s1.gstin!));

        // ── score and tier ────────────────────────────────────────────────
        const m = await MarketplaceService.metrics(s1.id);
        check('seller metrics: on-time dispatch and return rate are measured', m.onTimeDispatch === 100 && m.returnRate === 50 && m.ratingCount === 1, JSON.stringify(m));
        await api.patch(`/api/admin/hub/partners/${s1.id}/seller`, { sellerTier: 'restricted', locked: true }, staff);
        const d3 = await api.post('/api/hub/store/listings', { ...base1, name: 'QA Switch' }, t1);
        check('a restricted seller cannot put new listings live', (await api.post(`/api/hub/store/listings/${d3.body.data.id}/submit`, {}, t1)).status === 409);
        const late = await api.get('/api/admin/hub/store/late', staff);
        check('staff have a late-dispatch board', late.status === 200 && Array.isArray(late.body?.data));
        const home = await api.get('/api/hub/summary', t1);
        check('home shows store orders', JSON.stringify(home.body?.data ?? {}).includes('Store orders to ship'));

        // ── payment collection fee ────────────────────────────────────────
        const gw1 = Math.round(499800 * 0.02);
        check('the payment collection fee (2% + GST) is fixed on the order at payment', so1.gatewayFeePaise === gw1 && so1.gatewayFeeGstPaise === Math.round(gw1 * 0.18));
        check('…charged at settlement as its own ledger line', lines.some(l => l.entryType === 'gateway_fee' && l.amountPaise === s3.gatewayFeePaise + s3.gatewayFeeGstPaise));
        check('…and invoiced on UniteFix\'s monthly invoice', feeLines.some(l => /Store payment collection — 1 order/.test(l.description) && l.taxablePaise === s3.gatewayFeePaise), JSON.stringify(feeLines.map(l => l.description)));

        // ── courier booking, label, late-dispatch charge, waiver (seller 2) ─
        // Test settings live only in this process's config cache — the config table is not touched.
        const cfg = (k: string, v: unknown) => { (configService as any).cache.set(k, v); (configService as any).cacheExpiry.set(k, Date.now() + 3_600_000); };
        cfg('BUSINESS_CONFIG.MARKETPLACE_COURIER_RATE_PER_500G_RUPEES', 40);
        const buy = async (tag: string) => {
            const c = await api.post('/api/store/checkout', { items: [{ productId: pid2, quantity: 1 }], address: 'Karwar', pincode: '581301' }, ct);
            await MarketplaceService.applyCapture({ checkoutId: c.body.data.checkoutId, razorpayPaymentId: `pay_qa${tag}_${stamp}` });
            const [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.checkoutId, c.body.data.checkoutId));
            await api.post(`/api/hub/store/orders/${so.id}/transition`, { to: 'confirmed' }, t2);
            return so;
        };
        const so4 = await buy('4');
        const bal4 = await BusinessPartnerService.balancePaise(s2.id);
        const bk = await api.post(`/api/hub/store/orders/${so4.id}/courier`, { weightGrams: 700, lengthCm: 20, widthCm: 15, heightCm: 10 }, t2);
        const [so4b] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so4.id));
        check('courier booked through UniteFix (test mode): waybill becomes the tracking id', bk.status === 200 && /^MOCK/.test(bk.body?.data?.waybill) && so4b.courier === 'Delhivery' && so4b.trackingId === bk.body.data.waybill, JSON.stringify(bk.body));
        check('courier charge: 2 × 500 g slabs at ₹40 + GST, from the settlement', so4b.courierChargePaise === 8000 && so4b.courierChargeGstPaise === 1440 && (await BusinessPartnerService.balancePaise(s2.id)) - bal4 === 9440);
        check('a second booking is refused', (await api.post(`/api/hub/store/orders/${so4.id}/courier`, { weightGrams: 700, lengthCm: 20, widthCm: 15, heightCm: 10 }, t2)).status === 409);
        check('parcel limits are checked', (await api.post(`/api/hub/store/orders/${so4.id}/courier`, { weightGrams: 10, lengthCm: 20, widthCm: 15, heightCm: 10 }, t2)).status >= 400);
        const lbl = await fetch(`${base}/api/hub/store/orders/${so4.id}/label.pdf`, { headers: { Authorization: `Bearer ${t2}` } });
        check('a 4×6 shipping label with the waybill barcode', lbl.status === 200 && Buffer.from(await lbl.arrayBuffer()).subarray(0, 4).toString() === '%PDF');
        check('another seller cannot print it', (await fetch(`${base}/api/hub/store/orders/${so4.id}/label.pdf`, { headers: { Authorization: `Bearer ${t1}` } })).status === 404);
        await db.update(sellerOrders).set({ createdAt: new Date(Date.now() - 49 * 3_600_000) }).where(eq(sellerOrders.id, so4.id));
        const lateList = await api.get('/api/hub/store/orders', t2);
        check('the seller is warned before dispatching late', lateList.body?.data?.find((o: any) => o.id === so4.id)?.lateCharge === 50);
        const d4 = await api.post(`/api/hub/store/orders/${so4.id}/transition`, { to: 'dispatched' }, t2);
        const [so4c] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so4.id));
        check('dispatch uses the booked courier; dispatching after 48 h takes the ₹50 late charge', d4.status === 200 && so4c.status === 'dispatched' && so4c.trackingId === bk.body.data.waybill && so4c.penaltyPaise === 5000, JSON.stringify([d4.body, so4c.penaltyPaise]));
        const pl = await db.select().from(businessPartnerLedger).where(eq(businessPartnerLedger.businessPartnerId, s2.id));
        check('…on the seller\'s ledger, and the seller is alerted', pl.some(l => l.entryType === 'store_penalty' && l.amountPaise === 5000) && (await db.select().from(hubAlerts).where(and(eq(hubAlerts.businessPartnerId, s2.id), eq(hubAlerts.kind, 'store_penalty')))).length === 1);
        const pens = await api.get('/api/admin/hub/store/penalties', staff);
        check('staff see the charge', pens.body?.data?.some((p: any) => p.id === so4.id && p.penalty === 50 && !p.waived));
        check('a waiver needs a reason', (await api.post(`/api/admin/hub/store/orders/${so4.id}/waive`, {}, staff)).status === 400);
        const wv = await api.post(`/api/admin/hub/store/orders/${so4.id}/waive`, { note: 'Courier pickup was late' }, staff);
        const pl2 = await db.select().from(businessPartnerLedger).where(eq(businessPartnerLedger.businessPartnerId, s2.id));
        check('staff waive it: credited back, once', wv.status === 200 && pl2.some(l => l.entryType === 'adjustment' && l.amountPaise === -5000) && (await api.post(`/api/admin/hub/store/orders/${so4.id}/waive`, { note: 'again' }, staff)).status === 409);

        // ── seller cancels a paid order ───────────────────────────────────
        const so5 = await buy('5');
        await api.post(`/api/hub/store/orders/${so5.id}/courier`, { weightGrams: 400, lengthCm: 20, widthCm: 15, heightCm: 10 }, t2);
        const bal5 = await BusinessPartnerService.balancePaise(s2.id);
        const c5 = await api.post(`/api/hub/store/orders/${so5.id}/transition`, { to: 'cancelled', reason: 'Out of stock in the shop' }, t2);
        await new Promise(r => setTimeout(r, 300));
        const [so5b] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so5.id));
        check('seller cancels a paid order: 5% charge (at least ₹25), courier charge returned', c5.status === 200 && so5b.status === 'cancelled' && so5b.penaltyPaise === 7500 && so5b.courierChargePaise === 0 && (await BusinessPartnerService.balancePaise(s2.id)) - bal5 === 7500 - 4720, JSON.stringify([so5b.penaltyPaise, so5b.courierChargePaise, (await BusinessPartnerService.balancePaise(s2.id)) - bal5]));
        const fee2 = await TaxDocumentService.issueFeeInvoice(s2.id, new Date(`${month}-01T00:00:00Z`), sa.id);
        const fee2Lines = fee2 ? await db.select().from((await import('../shared/schema')).taxDocumentLines).where(eq((await import('../shared/schema')).taxDocumentLines.documentId, fee2.id)) : [];
        check('courier charges on dispatched parcels are invoiced monthly (the cancelled one is not)', fee2Lines.some(l => /Courier bookings — 1 parcel/.test(l.description) && l.taxablePaise === 8000), JSON.stringify(fee2Lines.map(l => [l.description, l.taxablePaise])));
        configService.invalidate('BUSINESS_CONFIG.MARKETPLACE_COURIER_RATE_PER_500G_RUPEES');

        // ── bundle: product + the seller's installation ───────────────────
        await db.update(products).set({ stock: 5 }).where(eq(products.id, pid2));
        check('installation must carry a service SAC', (await api.patch(`/api/hub/store/listings/${pid2}`, { installationPriceRupees: 500, installationSac: '85176290' }, t2)).status === 400);
        const inst = await api.patch(`/api/hub/store/listings/${pid2}`, { installationPriceRupees: 500, installationSac: '998734', installationNote: 'Ceiling mount, cabling up to 10 m' }, t2);
        check('a seller offers installation with a listing', inst.status === 200 && (await api.get('/api/hub/store/listings', t2)).body.data.find((l: any) => l.id === pid2)?.installationPrice === 500);
        const bq = await api.post('/api/store/quote', { items: [{ productId: pid2, quantity: 1, withInstallation: true }] }, ct);
        check('the customer adds installation: two lines, ₹2,000', bq.status === 200 && bq.body?.data?.total === 2000 && bq.body.data.lines?.length === 2, JSON.stringify(bq.body?.data?.lines?.map((l: any) => [l.kind, l.totalPaise])));
        check('a product without installation cannot be bought with it', (await api.post('/api/store/quote', { items: [{ productId: pid1, quantity: 1, withInstallation: true }] }, ct)).body?.code === 'NO_INSTALL');
        const bco = await api.post('/api/store/checkout', { items: [{ productId: pid2, quantity: 1, withInstallation: true }], address: 'Karwar', pincode: '581301' }, ct);
        await MarketplaceService.applyCapture({ checkoutId: bco.body.data.checkoutId, razorpayPaymentId: `pay_qa6_${stamp}` });
        const [so6] = await db.select().from(sellerOrders).where(eq(sellerOrders.checkoutId, bco.body.data.checkoutId));
        const items6 = await db.select().from((await import('../shared/schema')).sellerOrderItems).where(eq((await import('../shared/schema')).sellerOrderItems.sellerOrderId, so6.id));
        check('one seller order with goods and an installation line; stock taken only for the goods', so6.totalPaise === 200000 && so6.installationStatus === 'pending' && items6.map(i => i.kind).sort().join() === 'goods,installation' && (await db.select().from(products).where(eq(products.id, pid2)))[0].stock === 4);
        await api.post(`/api/hub/store/orders/${so6.id}/transition`, { to: 'confirmed' }, t2);
        await api.post(`/api/hub/store/orders/${so6.id}/transition`, { to: 'dispatched', courier: 'DTDC', trackingId: 'D600' }, t2);
        const [so6b] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so6.id));
        const invLines6 = await db.select().from((await import('../shared/schema')).taxDocumentLines).where(eq((await import('../shared/schema')).taxDocumentLines.documentId, so6b.invoiceDocumentId ?? 0));
        check('the seller\'s invoice carries installation as a service (SAC, 18%, per job)', invLines6.some(l => l.hsnSac === '998734' && Number(l.gstRate) === 18 && l.unit === 'job') && invLines6.some(l => l.hsnSac === '85176290'), JSON.stringify(invLines6.map(l => [l.hsnSac, l.gstRate, l.unit])));
        check('installed only after delivery', (await api.post(`/api/hub/store/orders/${so6.id}/installed`, {}, t2)).status === 409);
        await api.post(`/api/hub/store/orders/${so6.id}/transition`, { to: 'delivered' }, t2);
        await db.update(sellerOrders).set({ settleAfter: new Date(Date.now() - 1000) }).where(eq(sellerOrders.id, so6.id));
        await MarketplaceService.settleDue();
        check('an order with installation to do does not settle', !(await db.select().from(sellerOrders).where(eq(sellerOrders.id, so6.id)))[0].settledAt);
        const mi = await api.post(`/api/hub/store/orders/${so6.id}/installed`, { note: 'Done, customer signed' }, t2);
        await MarketplaceService.settleDue();
        const [so6c] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so6.id));
        check('marked installed → it settles', mi.status === 200 && so6c.installationStatus === 'done' && !!so6c.settledAt);
        const my6 = (await api.get('/api/store/orders', ct)).body?.data?.find((o: any) => o.id === so6.id);
        check('the customer sees the installation done', my6?.installationStatus === 'done' && my6.items.some((i: any) => i.kind === 'installation'));
    } finally {
        await cleanup();
        await close();
    }
    process.exit(summary());
}

async function cleanup() {
    const bp = bpIds.join(',') || '0';
    const uid = userIds.join(',') || '0';
    await cleanupPartners(bpIds, adminIds, [
        `DELETE FROM product_reviews WHERE seller_partner_id IN (${bp})`,
        `UPDATE seller_orders SET invoice_document_id = NULL, credit_note_document_id = NULL WHERE seller_partner_id IN (${bp})`,
        `DELETE FROM seller_order_events WHERE seller_order_id IN (SELECT id FROM seller_orders WHERE seller_partner_id IN (${bp}))`,
        `DELETE FROM seller_order_items WHERE seller_order_id IN (SELECT id FROM seller_orders WHERE seller_partner_id IN (${bp}))`,
        `DELETE FROM seller_orders WHERE seller_partner_id IN (${bp})`,
        `DELETE FROM market_checkouts WHERE user_id IN (${uid})`,
        `DELETE FROM product_orders WHERE user_id IN (${uid})`,
        `DELETE FROM cart_items WHERE user_id IN (${uid})`,
        `DELETE FROM products WHERE seller_partner_id IN (${bp})`,
        `DELETE FROM product_categories WHERE id = ${categoryId}`,
        `DELETE FROM users WHERE id IN (${uid})`,
    ]);
}

main().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
