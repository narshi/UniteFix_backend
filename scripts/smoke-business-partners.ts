/**
 * Business partners — the party model and its ledger.
 *
 *   npm run smoke:business-partners
 *
 * What these guard:
 *   - a partner can hold several verticals, and an unknown vertical is refused;
 *   - approval is gated: credit without a GSTIN does not go active;
 *   - the ledger sign convention (positive = partner owes UniteFix) holds, and
 *     an order-bound entry cannot be written twice;
 *   - the unified statement flips FTTH's convention at read time without
 *     touching a row of ftth_operator_ledger.
 *
 * Creates its own fixtures and deletes them in a finally.
 */

import 'dotenv/config';
import { db } from '../server/db';
import { eq } from 'drizzle-orm';
import {
    businessPartners, businessPartnerLedger, businessPartnerVerticals,
    ftthOperators, ftthOperatorLedger,
} from '@shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';

const results: Array<{ name: string; pass: boolean }> = [];
const check = (name: string, pass: boolean, detail = '') => {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const R = (paise: number) => `Rs.${(paise / 100).toFixed(2)}`;

async function main() {
    const stamp = Date.now().toString(36).toUpperCase();
    let bpId = 0;
    let ispBpId = 0;
    let operatorId = 0;

    try {
        // ── a CCTV + computer shop, no profile table needed ──────────────────
        const shop = await BusinessPartnerService.create({
            legalName: `QA Shop ${stamp} Pvt Ltd`,
            displayName: `QA Shop ${stamp}`,
            contactPhone: '9000000002',
            verticalCodes: ['cctv', 'computer'],
        });
        bpId = shop.id;
        check('a business partner is created pending approval', shop.status === 'pending_approval', shop.partnerCode);
        check('...with a human-readable code', /^BP-\d{4}$/.test(shop.partnerCode), shop.partnerCode);

        const verticals = await BusinessPartnerService.verticalCodesOf(bpId);
        check('a partner can hold several verticals at once',
            verticals.length === 2 && verticals.includes('cctv') && verticals.includes('computer'), verticals.join(','));

        let refused: string | null = null;
        try { await BusinessPartnerService.setVerticals(bpId, ['cctv', 'time_travel']); } catch (e: any) { refused = e.message; }
        check('an unknown vertical is refused, not skipped', /Unknown vertical/.test(refused ?? ''), refused ?? '');
        check('...and the existing verticals are untouched by the refusal',
            (await BusinessPartnerService.verticalCodesOf(bpId)).length === 2);

        // ── the approval gate ───────────────────────────────────────────────
        let gate: string | null = null;
        try { await BusinessPartnerService.approve(bpId, 1, { creditLimitPaise: 50_000_00 }); } catch (e: any) { gate = e.message; }
        check('credit without a GSTIN does not go active', /GSTIN/.test(gate ?? ''), gate ?? '');
        check('...and the partner is still pending', (await BusinessPartnerService.byId(bpId))!.status === 'pending_approval');

        const approved = await BusinessPartnerService.approve(bpId, 1, { creditLimitPaise: 0 });
        check('prepaid-only approval needs no GSTIN', approved?.status === 'active' && approved.creditLimitPaise === 0);

        await db.update(businessPartners).set({ gstin: '29ABCDE1234F1Z5' }).where(eq(businessPartners.id, bpId));
        const credited = await BusinessPartnerService.approve(bpId, 1, { creditLimitPaise: 50_000_00 });
        check('with a GSTIN, credit can be extended', credited?.creditLimitPaise === 50_000_00, R(credited?.creditLimitPaise ?? 0));

        // ── the ledger convention ───────────────────────────────────────────
        {
            const pos0 = await BusinessPartnerService.creditPosition(bpId);
            check('a fresh ledger reads zero outstanding and full credit',
                pos0.outstandingPaise === 0 && pos0.availablePaise === 50_000_00, R(pos0.availablePaise));

            await BusinessPartnerService.recordLedgerEntry({
                businessPartnerId: bpId, entryType: 'order_invoice', amountPaise: 12_000_00, b2bOrderId: null,
                description: 'QA invoice',
            });
            const pos1 = await BusinessPartnerService.creditPosition(bpId);
            check('an invoice is POSITIVE — the partner owes UniteFix',
                pos1.balancePaise === 12_000_00 && pos1.outstandingPaise === 12_000_00, R(pos1.balancePaise));
            check('...and eats into available credit', pos1.availablePaise === 38_000_00, R(pos1.availablePaise));

            await BusinessPartnerService.recordLedgerEntry({
                businessPartnerId: bpId, entryType: 'payment_received', amountPaise: -12_000_00,
                description: 'QA payment',
            });
            const pos2 = await BusinessPartnerService.creditPosition(bpId);
            check('a payment received is NEGATIVE and clears it', pos2.balancePaise === 0 && pos2.availablePaise === 50_000_00);

            await BusinessPartnerService.recordLedgerEntry({
                businessPartnerId: bpId, entryType: 'credit_note', amountPaise: -3_000_00, description: 'QA credit note',
            });
            const pos3 = await BusinessPartnerService.creditPosition(bpId);
            check('a balance below zero means UniteFix owes them', pos3.balancePaise === -3_000_00, R(pos3.balancePaise));
            check('...but does NOT inflate their credit — no netting', pos3.availablePaise === 50_000_00, R(pos3.availablePaise));

            const running = await db.select().from(businessPartnerLedger)
                .where(eq(businessPartnerLedger.businessPartnerId, bpId)).orderBy(businessPartnerLedger.id);
            const chained = running.every((r, i) => i === 0 || r.balanceBeforePaise === running[i - 1].balanceAfterPaise);
            check('every entry carries the previous balance forward', chained, `${running.length} entries`);
        }

        // ── the unified statement over an ISP ───────────────────────────────
        {
            const [op] = await db.insert(ftthOperators).values({
                companyName: `QA ISP ${stamp}`, contactEmail: `isp-${stamp}@example.invalid`, contactPhone: '9000000003',
                status: 'active',
            }).returning();
            operatorId = op.id;

            const done = await BusinessPartnerService.backfillFromFtthOperators(false);
            const mine = done.find(d => d.operatorId === operatorId);
            check('the backfill creates a party for an unlinked operator', !!mine?.partnerCode, mine?.partnerCode ?? '');
            const [linked] = await db.select().from(ftthOperators).where(eq(ftthOperators.id, operatorId));
            ispBpId = linked.businessPartnerId!;
            check('...and links the operator to it', !!ispBpId);
            check('...with the isp vertical', (await BusinessPartnerService.verticalCodesOf(ispBpId)).includes('isp'));
            check('...copying its status', (await BusinessPartnerService.byId(ispBpId))!.status === 'active');

            const again = await BusinessPartnerService.backfillFromFtthOperators(false);
            check('the backfill is idempotent', !again.some(d => d.operatorId === operatorId));

            // FTTH ledger: UniteFix owes the operator Rs.500 (their convention: +).
            await db.insert(ftthOperatorLedger).values({
                operatorId, entryType: 'recharge_collected', amountPaise: 50_000,
                balanceBeforePaise: 0, balanceAfterPaise: 50_000, description: 'QA recharge',
            });
            // B2B ledger: they owe UniteFix Rs.200 for parts (our convention: +).
            await BusinessPartnerService.recordLedgerEntry({
                businessPartnerId: ispBpId, entryType: 'order_invoice', amountPaise: 20_000, description: 'QA parts',
            });

            const st = await BusinessPartnerService.statement(ispBpId);
            const ftthLine = st.lines.find(l => l.source === 'ftth');
            const b2bLine = st.lines.find(l => l.source === 'b2b');
            check('the statement shows both ledgers', !!ftthLine && !!b2bLine);
            check('the FTTH row is FLIPPED into our convention (we owe them → negative)',
                ftthLine?.amountPaise === -50_000, R(ftthLine?.amountPaise ?? 0));
            check('the B2B row is as written (they owe us → positive)', b2bLine?.amountPaise === 20_000);
            check('balances are shown side by side, not netted',
                st.ftthBalancePaise === -50_000 && st.b2bBalancePaise === 20_000,
                `ftth ${R(st.ftthBalancePaise)} / b2b ${R(st.b2bBalancePaise)}`);

            const [untouched] = await db.select().from(ftthOperatorLedger).where(eq(ftthOperatorLedger.operatorId, operatorId));
            check('not one row of ftth_operator_ledger was rewritten', untouched.amountPaise === 50_000 && untouched.balanceAfterPaise === 50_000);
        }

        // ── lookups for both doors ──────────────────────────────────────────
        {
            const byUser = await BusinessPartnerService.byUserId(999_999_999);
            check('an unknown mobile user resolves to nobody', byUser === null);
            const byAdmin = await BusinessPartnerService.byAdminUserId(999_999_999);
            check('an unknown portal user resolves to nobody', byAdmin === null);
        }
    } finally {
        if (operatorId) {
            await db.delete(ftthOperatorLedger).where(eq(ftthOperatorLedger.operatorId, operatorId));
            await db.delete(ftthOperators).where(eq(ftthOperators.id, operatorId));
        }
        for (const id of [bpId, ispBpId].filter(Boolean)) {
            await db.delete(businessPartnerLedger).where(eq(businessPartnerLedger.businessPartnerId, id));
            await db.delete(businessPartnerVerticals).where(eq(businessPartnerVerticals.businessPartnerId, id));
            await db.delete(businessPartners).where(eq(businessPartners.id, id));
        }
    }
}

main()
    .then(() => {
        const passed = results.filter(r => r.pass).length;
        console.log(`\n${passed}/${results.length} passed`);
        process.exit(passed === results.length ? 0 : 1);
    })
    .catch((err) => { console.error('\nSmoke run failed:', err?.message ?? err); process.exit(1); });
