/**
 * Spare parts provenance and warranty routing.
 *
 *   npm run smoke:warranty
 *
 * Run with tsx so it imports the REAL service rather than a copy of its rules —
 * a test that reimplements the logic it is checking proves only that the author
 * was consistent twice.
 *
 * The cases that matter most below:
 *   - a vendor warranty starts on the VENDOR'S bill date, not the day we fitted
 *     it, so we never print an expiry the vendor will not honour;
 *   - a customer-supplied part never counts against the technician; and
 *   - every verdict routes to exactly one cost bearer, with the customer paying
 *     nothing on any genuine failure.
 *
 * Pure-function checks need no database. The persistence checks at the end are
 * skipped automatically when DATABASE_URL is not reachable.
 */

import 'dotenv/config';
import {
    resolvePartItem, routeCost, warrantyWindow, resolveBacker, isDocumented,
    partsTotalPaise, synthesiseFromLumpSum, partStatement, backerLabel,
    WORKMANSHIP_WARRANTY_DAYS,
    type PartSource, type Verdict,
} from '../server/services/warranty.service';

const results: Array<{ name: string; pass: boolean }> = [];
const check = (name: string, pass: boolean, detail = '') => {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const DAY = 86_400_000;
const INSTALL = new Date('2026-09-01T10:00:00Z');

// ── the warranty clock ──────────────────────────────────────────────────────
// A technician fits a part bought three weeks earlier. The vendor's 90 days
// started on their bill, so it expires three weeks sooner than a naive
// "completedAt + warrantyDays" would print.
{
    const billed = new Date(INSTALL.getTime() - 21 * DAY);
    const { startsAt, expiresAt } = warrantyWindow('vendor', 90, billed, INSTALL);
    check('a vendor warranty starts on the vendor\'s bill date, not the fitting date',
        startsAt?.getTime() === billed.getTime(),
        `starts ${startsAt?.toISOString().slice(0, 10)}`);
    check('...so it expires 21 days earlier than the install date would suggest',
        expiresAt?.getTime() === billed.getTime() + 90 * DAY,
        `expires ${expiresAt?.toISOString().slice(0, 10)}`);

    const ours = warrantyWindow('unitefix', 90, null, INSTALL);
    check('our own warranty runs from the day we fitted it',
        ours.startsAt?.getTime() === INSTALL.getTime());

    const none = warrantyWindow('none', 0, null, INSTALL);
    check('no warranty means no expiry date at all, not a date in the past',
        none.startsAt === null && none.expiresAt === null);
}

// ── who backs it ────────────────────────────────────────────────────────────
{
    check('platform stock is backed by us', resolveBacker('platform', 180, true) === 'unitefix');
    check('an approved vendor backs their own part', resolveBacker('approved_vendor', 90, true) === 'vendor');
    check('a documented local part is backed by the shop',
        resolveBacker('technician_local', 90, true) === 'vendor');
    check('an UNDOCUMENTED local part is backed by nobody — never by us',
        resolveBacker('technician_local', 90, false) === 'none');
    check('zero warranty days is always backed by nobody',
        resolveBacker('platform', 0, true) === 'none');

    const locals: PartSource[] = ['technician_local', 'customer_supplied'];
    check('we never appear as the backer of a part we did not supply',
        locals.every(s => resolveBacker(s, 90, true) !== 'unitefix'));
}

// ── documentation, and who it can count against ─────────────────────────────
{
    check('a local part with a bill, a vendor and a warranty is documented',
        isDocumented('technician_local', { billPhotoUrl: 'x.jpg', vendorName: 'Sirsi Electricals', warrantyDays: 90 }));
    check('a local part with no bill photo is not documented',
        !isDocumented('technician_local', { billPhotoUrl: null, vendorName: 'Sirsi Electricals', warrantyDays: 90 }));
    check('platform stock is documented by definition',
        isDocumented('platform', { billPhotoUrl: null, vendorName: null, warrantyDays: 0 }));
    check('a CUSTOMER-supplied part never counts against the technician',
        isDocumented('customer_supplied', { billPhotoUrl: null, vendorName: null, warrantyDays: 0 }),
        'the technician did not buy it, so it is not theirs to evidence');
}

// ── cost routing: every verdict lands on exactly one bearer ─────────────────
{
    const local = (documented: boolean) => ({ sourceType: 'technician_local' as PartSource, isDocumented: documented });

    check('workmanship fault is always the technician\'s to redo',
        routeCost('workmanship_fault', local(true)) === 'technician');
    check('a failed platform part is ours',
        routeCost('part_failed', { sourceType: 'platform', isDocumented: true }) === 'unitefix');
    check('a failed approved-vendor part is the vendor\'s',
        routeCost('part_failed', { sourceType: 'approved_vendor', isDocumented: true }) === 'vendor');
    check('a failed DOCUMENTED local part is the shop\'s',
        routeCost('part_failed', local(true)) === 'vendor');
    check('a failed UNDOCUMENTED local part falls to the technician',
        routeCost('part_failed', local(false)) === 'technician');
    check('a failed customer-supplied part is the customer\'s',
        routeCost('part_failed', { sourceType: 'customer_supplied', isDocumented: true }) === 'customer');
    check('customer damage is chargeable', routeCost('customer_damage', local(true)) === 'customer');
    check('out of warranty is chargeable', routeCost('out_of_warranty', local(true)) === 'customer');
    check('an unrelated fault is chargeable', routeCost('unrelated', null) === 'customer');

    // The whole point of the routing: the customer never adjudicates.
    const genuineFailures: Array<[Verdict, any]> = [
        ['workmanship_fault', local(true)],
        ['part_failed', { sourceType: 'platform', isDocumented: true }],
        ['part_failed', { sourceType: 'approved_vendor', isDocumented: true }],
        ['part_failed', local(true)],
        ['part_failed', local(false)],
    ];
    check('on EVERY genuine failure the customer bears nothing',
        genuineFailures.every(([v, p]) => routeCost(v, p) !== 'customer'),
        'five failure paths, none of them billed to the customer');

    const verdicts: Verdict[] = ['workmanship_fault', 'part_failed', 'customer_damage', 'out_of_warranty', 'unrelated'];
    const bearers = ['unitefix', 'vendor', 'technician', 'customer'];
    check('no verdict can route to an undefined bearer',
        verdicts.every(v => bearers.includes(routeCost(v, local(true)))));
}

// ── validation and clamping: the client is never trusted ────────────────────
{
    const wild = resolvePartItem({
        partName: 'x'.repeat(500), quantity: 9999, unitPriceRupees: 9_999_999,
        warrantyDays: 99_999, sourceType: 'nonsense_source',
    }, INSTALL);
    check('quantity is clamped to the booking ceiling', wild.quantity === 50, String(wild.quantity));
    check('unit price is capped', wild.unitPricePaise === 5_000_000, String(wild.unitPricePaise));
    check('warranty days are capped at five years', wild.warrantyDays === 1825, String(wild.warrantyDays));
    check('an unknown source falls back to local, not to platform',
        wild.sourceType === 'technician_local',
        'defaulting to platform would silently make us the backer');
    check('the part name is truncated, not rejected', wild.partName.length === 120);

    const rupees = resolvePartItem({ partName: 'Capacitor', unitPriceRupees: 450, quantity: 2 }, INSTALL);
    check('rupees convert to paise without floating-point drift',
        rupees.unitPricePaise === 45_000 && partsTotalPaise([rupees]) === 90_000,
        `${rupees.unitPricePaise} paise, total ${partsTotalPaise([rupees])}`);

    const byCategory = resolvePartItem({ partName: 'Compressor', category: 'ac' }, INSTALL);
    check('a category supplies a sensible default warranty',
        byCategory.warrantyDays === 180, `${byCategory.warrantyDays} days for 'ac'`);
    const explicitZero = resolvePartItem({ partName: 'Washer', category: 'ac', warrantyDays: 0 }, INSTALL);
    check('an explicit zero overrides the category default',
        explicitZero.warrantyDays === 0);
}

// ── the older app build ─────────────────────────────────────────────────────
{
    const synthetic = synthesiseFromLumpSum(850, 'Fan capacitor');
    check('an app build sending only a lump sum still produces a record',
        synthetic.length === 1, 'an empty record would read as "no parts fitted"');

    const resolved = resolvePartItem(synthetic[0], INSTALL);
    check('...recorded honestly as local and undocumented',
        resolved.sourceType === 'technician_local' && !resolved.isDocumented);
    check('...with no warranty claimed on its behalf',
        resolved.warrantyDays === 0 && resolved.warrantyBacker === 'none');
    check('...and the money is preserved exactly',
        partsTotalPaise([resolved]) === 85_000, `${partsTotalPaise([resolved])} paise`);
    check('a zero lump sum produces no line at all',
        synthesiseFromLumpSum(0, 'nothing').length === 0);
}

// ── what the customer is actually told ──────────────────────────────────────
{
    const documented = resolvePartItem({
        partName: 'Fan capacitor', category: 'electrical', vendorName: 'Sirsi Electricals',
        billPhotoUrl: 'bill.jpg', unitPriceRupees: 450,
        vendorBillDate: new Date(Date.now() - 5 * DAY).toISOString(),
    });
    const s = partStatement(documented as any);
    check('a covered part names the shop and the date, not a policy number',
        /Sirsi Electricals/.test(s) && /handle the claim/i.test(s), s.slice(0, 90) + '...');

    const bare = resolvePartItem({ partName: 'Washer', unitPriceRupees: 20 });
    check('an uncovered part says so plainly and still promises the fitting',
        /no separate part warranty/i.test(partStatement(bare as any))
        && new RegExp(`${WORKMANSHIP_WARRANTY_DAYS}-day`).test(partStatement(bare as any)));

    const cust = resolvePartItem({ partName: 'Tap', sourceType: 'customer_supplied' });
    check('a customer-supplied part explains where its warranty actually lives',
        /supplied by you/i.test(partStatement(cust as any)));

    check('an unnamed vendor still gets a readable label, not "null"',
        backerLabel('vendor', null) === 'Supplying vendor');
}

// ── persistence (skipped without a database) ────────────────────────────────
if (process.env.DATABASE_URL) {
    const pg = (await import('pg')).default;
    const c = new pg.Client({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    });
    let userId: number | undefined, srId: number | undefined;
    try {
        await c.connect();
        const stamp = String(Date.now()).slice(-9);
        userId = (await c.query(
            `INSERT INTO users (phone, username, role, is_active, phone_verified)
             VALUES ($1,'QA Warranty','user',true,true) RETURNING id`, [`9${stamp}`])).rows[0].id;
        srId = (await c.query(
            `INSERT INTO service_requests (service_id, user_id, service_type, description, address, status, total_amount)
             VALUES ($1,$2,'AC Service','QA warranty fixture','Sirsi','completed',999) RETURNING id`,
            [`SR-QA-WTY-${stamp}`, userId])).rows[0].id;

        const { recordPartItems, getPartItems } = await import('../server/services/warranty.service');

        await recordPartItems(srId!, [
            { partName: 'Fan capacitor', category: 'electrical', vendorName: 'Sirsi Electricals', billPhotoUrl: 'b.jpg', unitPriceRupees: 450, quantity: 2 },
            { partName: 'Washer', unitPriceRupees: 20 },
        ], null);
        let rows = await getPartItems(srId!);
        check('both lines persist', rows.length === 2, `${rows.length} rows`);
        check('the documented one is stored as documented',
            rows.find(r => r.partName === 'Fan capacitor')?.isDocumented === true);
        check('the bare one is stored as undocumented',
            rows.find(r => r.partName === 'Washer')?.isDocumented === false);

        // Resubmitting a corrected bill must not double-charge the customer.
        await recordPartItems(srId!, [{ partName: 'Fan capacitor', unitPriceRupees: 450, quantity: 1 }], null);
        rows = await getPartItems(srId!);
        check('re-recording REPLACES rather than appends',
            rows.length === 1 && rows[0].quantity === 1,
            `${rows.length} row(s) after correction — appending would double the bill`);

        // ── the claim round trip the admin screen depends on ────────────────
        const { createClaim, listClaims, settleClaim } = await import('../server/services/warranty.service');

        // An undocumented local part: nobody to recover from, so it should route
        // to the technician and the screen should say so before anyone commits.
        await recordPartItems(srId!, [{ partName: 'Fan capacitor', unitPriceRupees: 450 }], null);
        const [bare] = await getPartItems(srId!);
        const claim = await createClaim({
            serviceRequestId: srId!, partItemId: bare.id, raisedByUserId: userId!,
            description: 'Stopped working after six weeks',
        });
        check('a claim can be raised against a recorded part', !!claim?.claimId, claim?.claimId);

        const listed = await listClaims({ serviceRequestId: srId! });
        const row: any = listed.find((r: any) => r.claim.id === claim.id);
        check('the admin list joins in the customer, the job and the part',
            !!row && row.customerName === 'QA Warranty' && !!row.booking?.serviceId && row.part?.partName === 'Fan capacitor',
            row ? `${row.customerName} / ${row.booking?.serviceId} / ${row.part?.partName}` : 'claim not listed');
        check('the list projects who WOULD pay, before a verdict is chosen',
            row?.wouldRoute?.part_failed === 'technician',
            `undocumented local → ${row?.wouldRoute?.part_failed}`);

        const settled = await settleClaim(claim.id, 'part_failed', 0, 'Capacitor bulged.');
        check('settling routes the cost without anyone choosing a bearer',
            settled?.costBearer === 'technician' && settled?.status === 'resolved',
            `${settled?.verdict} → ${settled?.costBearer}`);

        const openOnly = await listClaims({ status: 'open' });
        check('a settled claim leaves the open queue',
            !openOnly.some((r: any) => r.claim.id === claim.id));

        // ── adding the bill later, which the app promises when upload fails ──
        const { attachBillToPart } = await import('../server/services/warranty.service');
        const before = (await getPartItems(srId!))[0];
        check('the part starts undocumented and backed by nobody',
            !before.isDocumented && before.warrantyBacker === 'none' && before.warrantyExpiresAt === null);

        const billedOn = new Date(Date.now() - 10 * DAY);
        const after = await attachBillToPart(before.id, {
            billPhotoUrl: 'https://cdn.example/bill.jpg',
            vendorName: 'Sirsi Electricals',
            warrantyDays: 90,
            vendorBillDate: billedOn.toISOString(),
        });
        check('adding the bill makes the part documented',
            after?.isDocumented === true);
        check('...and moves the backer from nobody to the shop',
            after?.warrantyBacker === 'vendor', String(after?.warrantyBacker));
        check('...and recomputes the window from the VENDOR\'S bill date',
            !!after?.warrantyExpiresAt
            && Math.abs(new Date(after.warrantyExpiresAt).getTime() - (billedOn.getTime() + 90 * DAY)) < 2000,
            after?.warrantyExpiresAt ? new Date(after.warrantyExpiresAt).toISOString().slice(0, 10) : 'null');

        // The same part failing now costs the shop, not the technician.
        const reroute = routeCost('part_failed', {
            sourceType: after!.sourceType as PartSource, isDocumented: after!.isDocumented,
        });
        check('so a later failure now falls to the vendor, not the technician',
            reroute === 'vendor', `routes to ${reroute}`);

        const half = await attachBillToPart(before.id, { vendorName: '', warrantyDays: 0 });
        check('clearing the warranty period un-covers it rather than leaving a stale date',
            half?.warrantyBacker === 'none' && half?.warrantyExpiresAt === null);
    } catch (err: any) {
        check('persistence checks ran', false, err.message);
    } finally {
        try {
            if (srId) {
                await c.query('DELETE FROM warranty_claims WHERE service_request_id=$1', [srId]);
                await c.query('DELETE FROM service_part_items WHERE service_request_id=$1', [srId]);
                await c.query('DELETE FROM service_requests WHERE id=$1', [srId]);
            }
            if (userId) await c.query('DELETE FROM users WHERE id=$1', [userId]);
        } catch { /* fixture cleanup is best-effort */ }
        await c.end().catch(() => { });
    }
} else {
    console.log('\n  (no DATABASE_URL — persistence checks skipped)\n');
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
