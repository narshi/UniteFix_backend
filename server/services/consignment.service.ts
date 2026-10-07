/**
 * Consignment: a partner's parts in UniteFix's warehouse, sold on its behalf.
 *
 *   partner proposes  → a catalogue part, a quantity, a payout per unit
 *   staff receive     → stock in (purchase_in at the payout as cost), or reject
 *   units leave       → B2B sale, issue to a technician, a job, a write-off:
 *                       consigned units go first (oldest lot first); the
 *                       partner's ledger is credited the payout (−)
 *   month end         → the partner's invoice to UniteFix for what was drawn,
 *                       in the partner's series; its GST is credited then
 *   unsold units      → staff send them back; the lot closes
 *
 * A unit later returned to the warehouse (a B2B return, a technician's kit)
 * is UniteFix's own stock: the partner was already paid for it.
 */

import { db } from '../db';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { consignmentLots, consignmentDraws, spareParts, businessPartners, taxDocuments, type ConsignmentLot } from '@shared/schema';
import { HubError, type HubContext } from './partner-hub.service';
import { BusinessPartnerService } from './business-partner.service';
import { TaxDocumentService, type Party } from './tax-documents.service';
import { withTransaction } from '../lib/transaction';
import logger from '../lib/logger';

const rs = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const left = (l: ConsignmentLot) => l.quantityReceived - l.quantitySold - l.quantityReturned;

export class ConsignmentService {

    static view(l: ConsignmentLot, part?: { name: string; partCode: string; tradePricePaise: number | null } | null) {
        return {
            id: l.id, sparePartId: l.sparePartId, partName: part?.name ?? null, partCode: part?.partCode ?? null, tradePrice: part?.tradePricePaise != null ? part.tradePricePaise / 100 : null,
            offered: l.quantityOffered, received: l.quantityReceived, sold: l.quantitySold, returned: l.quantityReturned, inStock: Math.max(0, left(l)),
            unitPayout: l.unitPayoutPaise / 100, status: l.status, notes: l.notes, reviewNote: l.reviewNote, receivedAt: l.receivedAt, createdAt: l.createdAt,
        };
    }

    private static async lots(conds: any[]) {
        const rows = await db.select({ l: consignmentLots, name: spareParts.name, partCode: spareParts.partCode, tradePricePaise: spareParts.tradePricePaise, partner: businessPartners.displayName })
            .from(consignmentLots).innerJoin(spareParts, eq(spareParts.id, consignmentLots.sparePartId)).innerJoin(businessPartners, eq(businessPartners.id, consignmentLots.businessPartnerId))
            .where(and(...conds)).orderBy(desc(consignmentLots.createdAt)).limit(500);
        return rows.map(r => ({ ...this.view(r.l, r), partner: r.partner }));
    }

    // ── partner ───────────────────────────────────────────────────────────

    static async forPartner(bpId: number) {
        const lots = await this.lots([eq(consignmentLots.businessPartnerId, bpId)]);
        const since = new Date(Date.now() - 30 * 86_400_000);
        const [m] = await db.select({ n: sql<number>`coalesce(sum(${consignmentDraws.quantity}), 0)::int`, p: sql<number>`coalesce(sum(${consignmentDraws.amountPaise}), 0)::int` })
            .from(consignmentDraws).where(and(eq(consignmentDraws.businessPartnerId, bpId), gte(consignmentDraws.createdAt, since)));
        const invoices = await db.select().from(taxDocuments).where(and(eq(taxDocuments.issuerPartnerId, bpId), eq(taxDocuments.purpose, 'consignment'))).orderBy(desc(taxDocuments.issuedAt)).limit(24);
        return { lots, last30: { units: m?.n ?? 0, payout: (m?.p ?? 0) / 100 }, invoices: invoices.map(d => ({ id: d.id, number: d.number, periodFrom: d.periodFrom, total: d.totalPaise / 100 })) };
    }

    static async propose(ctx: Pick<HubContext, 'businessPartnerId'>, input: { sparePartId: number; quantity: number; unitPayoutRupees: number; notes?: string | null }) {
        const [part] = await db.select().from(spareParts).where(eq(spareParts.id, input.sparePartId)).limit(1);
        if (!part || !part.isActive || part.status !== 'active') throw new HubError('That part is not in the catalogue.', 'NOT_FOUND', 404);
        const qty = Math.floor(Number(input.quantity));
        if (!(qty >= 1 && qty <= 10000)) throw new HubError('Quantity is 1–10,000.', 'BAD_QTY');
        const payout = Math.round(Number(input.unitPayoutRupees) * 100);
        if (!(payout > 0)) throw new HubError('Say what you want per unit.', 'BAD_PRICE');
        const ceiling = part.tradePricePaise ?? part.unitPricePaise;
        if (payout >= ceiling) throw new HubError(`UniteFix sells this at ${rs(ceiling)} before GST; your payout has to be below that.`, 'PRICE_TOO_HIGH');
        const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(consignmentLots).where(and(eq(consignmentLots.businessPartnerId, ctx.businessPartnerId), eq(consignmentLots.status, 'proposed')));
        if ((open?.n ?? 0) >= 20) throw new HubError('You have 20 offers waiting for UniteFix. Wait for those to be received first.', 'TOO_MANY');
        const [row] = await db.insert(consignmentLots).values({ businessPartnerId: ctx.businessPartnerId, sparePartId: part.id, quantityOffered: qty, unitPayoutPaise: payout, notes: input.notes?.trim() || null }).returning();
        return this.view(row, part);
    }

    static async withdraw(ctx: Pick<HubContext, 'businessPartnerId'>, id: number) {
        const [u] = await db.update(consignmentLots).set({ status: 'withdrawn', updatedAt: new Date() })
            .where(and(eq(consignmentLots.id, id), eq(consignmentLots.businessPartnerId, ctx.businessPartnerId), eq(consignmentLots.status, 'proposed'))).returning();
        if (!u) throw new HubError('Only an offer UniteFix has not received yet can be withdrawn. Ask UniteFix to send unsold stock back.', 'BAD_STATE', 409);
        return this.view(u);
    }

    // ── staff ─────────────────────────────────────────────────────────────

    static async queue(status?: string) {
        return this.lots(status ? [eq(consignmentLots.status, status)] : [inArray(consignmentLots.status, ['proposed', 'received'])]);
    }

    /** The parcel arrived: count it into the warehouse. */
    static async receive(id: number, quantity: number, adminId: number) {
        const { SparePartsService } = await import('./spare-parts.service');
        return withTransaction(async (tx) => {
            const [l] = await tx.select().from(consignmentLots).where(eq(consignmentLots.id, id)).for('update');
            if (!l) throw new HubError('Not found', 'NOT_FOUND', 404);
            if (l.status !== 'proposed') throw new HubError(`This lot is ${l.status}.`, 'BAD_STATE', 409);
            const qty = Math.floor(Number(quantity));
            if (!(qty >= 1 && qty <= l.quantityOffered)) throw new HubError(`Received is 1–${l.quantityOffered}.`, 'BAD_QTY');
            const [bp] = await tx.select({ name: businessPartners.displayName }).from(businessPartners).where(eq(businessPartners.id, l.businessPartnerId));
            await SparePartsService.move(tx as any, {
                sparePartId: l.sparePartId, movementType: 'purchase_in', delta: qty, location: 'warehouse', toLocation: 'warehouse',
                unitCostPaise: l.unitPayoutPaise, performedByAdminId: adminId, notes: `Consignment lot #${l.id} from ${bp?.name ?? `partner #${l.businessPartnerId}`}`,
            });
            const [u] = await tx.update(consignmentLots).set({ status: 'received', quantityReceived: qty, receivedAt: new Date(), receivedByAdminId: adminId, updatedAt: new Date() }).where(eq(consignmentLots.id, id)).returning();
            return this.view(u);
        });
    }

    static async reject(id: number, note: string, adminId: number) {
        const [u] = await db.update(consignmentLots).set({ status: 'rejected', reviewNote: note.trim(), receivedByAdminId: adminId, updatedAt: new Date() })
            .where(and(eq(consignmentLots.id, id), eq(consignmentLots.status, 'proposed'))).returning();
        if (!u) throw new HubError('Only an offer not yet received can be rejected.', 'BAD_STATE', 409);
        return this.view(u);
    }

    /** Send unsold units back to the partner; the lot closes. */
    static async returnUnsold(id: number, adminId: number, note?: string | null) {
        const { SparePartsService } = await import('./spare-parts.service');
        return withTransaction(async (tx) => {
            const [l] = await tx.select().from(consignmentLots).where(eq(consignmentLots.id, id)).for('update');
            if (!l) throw new HubError('Not found', 'NOT_FOUND', 404);
            if (l.status !== 'received') throw new HubError(`This lot is ${l.status}.`, 'BAD_STATE', 409);
            const n = left(l);
            if (n > 0) {
                // 'adjustment' is not a draw, so the partner is not paid for units going home.
                await SparePartsService.move(tx as any, {
                    sparePartId: l.sparePartId, movementType: 'adjustment', delta: -n, location: 'warehouse', fromLocation: 'warehouse',
                    performedByAdminId: adminId, notes: `Consignment lot #${l.id}: ${n} unsold returned to the partner${note ? ` — ${note}` : ''}`,
                });
            }
            const [u] = await tx.update(consignmentLots).set({ status: 'closed', quantityReturned: l.quantityReturned + n, reviewNote: note?.trim() || l.reviewNote, updatedAt: new Date() }).where(eq(consignmentLots.id, id)).returning();
            return this.view(u);
        });
    }

    // ── units leave the warehouse ─────────────────────────────────────────

    /**
     * Called by the stock mover inside its transaction. Takes the units from
     * the oldest open lots of this part and credits each partner its payout.
     */
    static async draw(tx: any, input: { sparePartId: number; quantity: number; movementId: number; reason: string }) {
        let want = input.quantity;
        const lots: ConsignmentLot[] = await tx.select().from(consignmentLots)
            .where(and(eq(consignmentLots.sparePartId, input.sparePartId), eq(consignmentLots.status, 'received')))
            .orderBy(asc(consignmentLots.receivedAt), asc(consignmentLots.id)).for('update');
        for (const l of lots) {
            if (want <= 0) break;
            const n = Math.min(want, left(l));
            if (n <= 0) continue;
            const amount = n * l.unitPayoutPaise;
            const [d] = await tx.insert(consignmentDraws).values({ lotId: l.id, businessPartnerId: l.businessPartnerId, sparePartId: l.sparePartId, movementId: input.movementId, quantity: n, unitPayoutPaise: l.unitPayoutPaise, amountPaise: amount })
                .onConflictDoNothing().returning();
            if (!d) continue;
            const [part] = await tx.select({ name: spareParts.name }).from(spareParts).where(eq(spareParts.id, l.sparePartId));
            await tx.update(consignmentLots).set({ quantitySold: l.quantitySold + n, updatedAt: new Date() }).where(eq(consignmentLots.id, l.id));
            await BusinessPartnerService.appendLedger(tx, {
                businessPartnerId: l.businessPartnerId, entryType: 'consignment_sale', amountPaise: -amount,
                description: `Consigned ${part?.name ?? 'part'} × ${n} sold (lot #${l.id}) at ${rs(l.unitPayoutPaise)} — GST on your monthly invoice`,
                metadata: { lotId: l.id, movementId: input.movementId, drawId: d.id },
            });
            want -= n;
        }
    }

    // ── month end ─────────────────────────────────────────────────────────

    /** The partner's invoice to UniteFix for consigned units drawn in the month (issued in the partner's series). */
    static async issueMonthlyInvoice(bpId: number, month: Date) {
        const from = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
        const to = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
        const periodFrom = from.toISOString().slice(0, 10);
        const periodTo = new Date(to.getTime() - 86_400_000).toISOString().slice(0, 10);
        const rows = await db.select({ d: consignmentDraws, name: spareParts.name, hsn: spareParts.hsnCode, gst: spareParts.gstPercent, unit: spareParts.unit }).from(consignmentDraws)
            .innerJoin(spareParts, eq(spareParts.id, consignmentDraws.sparePartId))
            .where(and(eq(consignmentDraws.businessPartnerId, bpId), gte(consignmentDraws.createdAt, from), lt(consignmentDraws.createdAt, to)));
        if (!rows.length) return null;
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) return null;
        const registered = !!bp.gstin;
        // One line per part and price.
        const byKey = new Map<string, { name: string; hsn: string | null; gst: number; unit: string; qty: number; rate: number }>();
        for (const r of rows) {
            const k = `${r.d.sparePartId}:${r.d.unitPayoutPaise}`;
            const x = byKey.get(k) ?? { name: r.name, hsn: r.hsn, gst: registered ? Number(r.gst ?? 18) : 0, unit: r.unit, qty: 0, rate: r.d.unitPayoutPaise };
            x.qty += r.d.quantity; byKey.set(k, x);
        }
        const { PartnerSalesService } = await import('./partner-sales.service');
        const prefix = await PartnerSalesService.prefixFor(bpId);
        const uf = await TaxDocumentService.unitefixParty();
        const label = from.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        try {
            return await withTransaction(async (tx) => {
                const doc = await TaxDocumentService.create(tx as any, {
                    docKind: registered ? 'tax_invoice' : 'bill_of_supply', issuer: 'partner', issuerPartnerId: bpId,
                    seriesKey: `bp-${bpId}-inv`, prefix, letter: '', numberWidth: 4, purpose: 'consignment',
                    supplier: TaxDocumentService.partnerParty(bp), recipient: uf as Party, periodFrom, periodTo,
                    lines: Array.from(byKey.values()).map(x => ({ description: `${x.name} — consigned stock sold, ${label}`, hsnSac: x.hsn, quantity: x.qty, unit: x.unit, ratePaise: x.rate, taxablePaise: x.qty * x.rate, gstRate: x.gst })),
                    notes: 'Generated by the UniteFix Partner Hub from consigned units UniteFix drew from its warehouse. Sale-or-return: ownership passed when each unit was drawn.',
                });
                const gst = doc.cgstPaise + doc.sgstPaise + doc.igstPaise;
                if (gst > 0) {
                    await BusinessPartnerService.appendLedger(tx as any, {
                        businessPartnerId: bpId, entryType: 'consignment_sale', amountPaise: -gst,
                        description: `GST on your consignment invoice ${doc.number} to UniteFix`, metadata: { documentId: doc.id, gstOnConsignment: true },
                    });
                }
                return doc;
            });
        } catch (e: any) {
            if (e?.code === '23505') return null;   // already issued for the month
            throw e;
        }
    }

    static async runMonthlyInvoices(month: Date) {
        const bps = await db.selectDistinct({ id: consignmentDraws.businessPartnerId }).from(consignmentDraws);
        const out: string[] = [];
        for (const { id } of bps) {
            try { const d = await this.issueMonthlyInvoice(id, month); if (d) out.push(d.number); }
            catch (e: any) { logger.error(`[CONSIGNMENT] Invoice for partner #${id} failed`, { error: e?.message }); }
        }
        return out;
    }
}
