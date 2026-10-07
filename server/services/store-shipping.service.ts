/**
 * Shipping a store order: book the courier through UniteFix's Delhivery
 * account and print a 4×6 label.
 *
 * DELHIVERY_MODE=mock (the default) gives a test waybill so the flow can be
 * used end to end before the account is live. In live mode each seller's
 * pickup address must first be registered with Delhivery as a pickup point
 * (a "warehouse" in their panel); staff record that name on the partner.
 *
 * Sellers can still ship with their own courier: dispatch takes any courier
 * and tracking id, and the label prints without a waybill barcode.
 */

import crypto from 'crypto';
import axios from 'axios';
import PDFDocument from 'pdfkit';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { sellerOrders, sellerOrderItems, businessPartners, taxDocuments, type SellerOrder } from '@shared/schema';
import { HubError, type HubContext } from './partner-hub.service';
import { BusinessPartnerService } from './business-partner.service';
import { withTransaction } from '../lib/transaction';
import logger from '../lib/logger';

type Parcel = { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number };

export class StoreShippingService {

    static mode(): 'mock' | 'live' {
        return process.env.DELHIVERY_MODE === 'live' && !!process.env.DELHIVERY_API_KEY ? 'live' : 'mock';
    }

    private static base() {
        return (process.env.DELHIVERY_BASE_URL || 'https://track.delhivery.com/api').replace(/\/api\/?$/, '');
    }

    private static async order(bpId: number, id: number) {
        const [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, id)).limit(1);
        if (!so || so.sellerPartnerId !== bpId) throw new HubError('Order not found', 'NOT_FOUND', 404);
        return so;
    }

    /** Book a Delhivery pickup for an order and record its waybill as the tracking id. */
    static async book(ctx: Pick<HubContext, 'businessPartnerId'>, id: number, parcel: Parcel) {
        const so = await this.order(ctx.businessPartnerId, id);
        if (!['confirmed', 'packed'].includes(so.status)) throw new HubError('Book the courier once the order is confirmed and before it is dispatched.', 'BAD_STATE', 409);
        if (so.shipmentRef) throw new HubError(`A courier is already booked: ${so.courier} ${so.trackingId}.`, 'BOOKED', 409);
        if (!(parcel.weightGrams >= 50 && parcel.weightGrams <= 30000)) throw new HubError('Weight is 50 g to 30 kg.', 'BAD_PARCEL');
        for (const d of [parcel.lengthCm, parcel.widthCm, parcel.heightCm]) if (!(d >= 1 && d <= 150)) throw new HubError('Each side is 1–150 cm.', 'BAD_PARCEL');
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, so.sellerPartnerId)).limit(1);
        const items = await db.select().from(sellerOrderItems).where(eq(sellerOrderItems.sellerOrderId, so.id));
        let waybill: string, ref: string;
        if (this.mode() === 'mock') {
            waybill = `MOCK${Date.now().toString().slice(-8)}${crypto.randomInt(1000, 9999)}`;
            ref = `mock:${so.code}`;
        } else {
            if (!bp?.delhiveryPickupName) throw new HubError('Your pickup address is not registered with the courier yet. Ask UniteFix to set it up, or ship with your own courier.', 'NO_PICKUP', 409);
            const [inv] = so.invoiceDocumentId ? await db.select({ number: taxDocuments.number }).from(taxDocuments).where(eq(taxDocuments.id, so.invoiceDocumentId)).limit(1) : [];
            const shipment = {
                name: so.shipName ?? 'Customer', add: so.shipAddress ?? '', pin: so.shipPincode ?? '', phone: so.shipPhone ?? '', country: 'India',
                order: so.code, payment_mode: 'Prepaid', cod_amount: '0', total_amount: String(so.totalPaise / 100), order_date: new Date().toISOString(),
                products_desc: items.map(i => `${i.name} x${i.quantity}`).join(', ').slice(0, 240), hsn_code: items.map(i => i.hsnCode).filter(Boolean).join(','),
                quantity: String(items.reduce((a, i) => a + i.quantity, 0)), weight: String(parcel.weightGrams),
                shipment_length: String(parcel.lengthCm), shipment_width: String(parcel.widthCm), shipment_height: String(parcel.heightCm),
                seller_name: bp.legalName, seller_add: bp.address ?? '', seller_gst_tin: bp.gstin ?? '', seller_inv: inv?.number ?? so.code,
                shipping_mode: 'Surface', address_type: 'home',
            };
            try {
                const body = new URLSearchParams({ format: 'json', data: JSON.stringify({ shipments: [shipment], pickup_location: { name: bp.delhiveryPickupName } }) });
                const r = await axios.post(`${this.base()}/api/cmu/create.json`, body.toString(), { headers: { Authorization: `Token ${process.env.DELHIVERY_API_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, timeout: 20_000 });
                const pkg = r.data?.packages?.[0];
                if (!pkg?.waybill || pkg.status === 'Fail') throw new Error((pkg?.remarks ?? [r.data?.rmk ?? 'no waybill']).join?.('; ') ?? String(pkg?.remarks ?? r.data?.rmk));
                waybill = pkg.waybill; ref = pkg.refnum ?? so.code;
            } catch (e: any) {
                logger.error(`[STORE-SHIP] Delhivery booking failed for ${so.code}: ${e?.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : e?.message}`);
                throw new HubError(`The courier did not accept the booking: ${String(e?.message ?? 'error').slice(0, 160)}. Check the address and parcel, or ship with your own courier.`, 'COURIER_REJECTED', 502);
            }
        }
        const charge = await this.charge(parcel.weightGrams);
        const u = await withTransaction(async (tx) => {
            const [row] = await tx.update(sellerOrders).set({ courier: 'Delhivery', trackingId: waybill, shipmentRef: ref, parcel: parcel as any, courierChargePaise: charge.paise, courierChargeGstPaise: charge.gstPaise, updatedAt: new Date() }).where(eq(sellerOrders.id, so.id)).returning();
            if (charge.paise > 0) await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: so.sellerPartnerId, entryType: 'fee_charge', amountPaise: charge.paise + charge.gstPaise, description: `Courier for store order ${so.code} — Delhivery ${waybill}, ${parcel.weightGrams} g`, metadata: { sellerOrderId: so.id, waybill } });
            return row;
        });
        return { order: u, waybill, mode: this.mode(), trackingUrl: `https://www.delhivery.com/track/package/${waybill}`, charge: (charge.paise + charge.gstPaise) / 100 };
    }

    /** The courier charge for a parcel: per started 500 g, GST on top. Zero until UniteFix sets a rate. */
    static async charge(weightGrams: number) {
        const { MarketplaceService } = await import('./marketplace.service');
        const r = await MarketplaceService.feeRates();
        const paise = Math.round(Math.ceil(Math.max(1, weightGrams) / 500) * r.courierPer500gRupees * 100);
        return { paise, gstPaise: Math.round(paise * r.gstPercent / 100), per500g: r.courierPer500gRupees };
    }

    /** The order was cancelled: release the courier booking. Best effort. */
    static async cancelBooking(so: SellerOrder) {
        if (so.courierChargePaise > 0) {
            await withTransaction(async (tx) => {
                const [locked] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, so.id)).for('update');
                if (!locked?.courierChargePaise) return;
                await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: so.sellerPartnerId, entryType: 'adjustment', amountPaise: -(locked.courierChargePaise + locked.courierChargeGstPaise), description: `Courier for store order ${so.code} cancelled — charge returned`, metadata: { sellerOrderId: so.id } });
                await tx.update(sellerOrders).set({ courierChargePaise: 0, courierChargeGstPaise: 0 }).where(eq(sellerOrders.id, so.id));
            });
        }
        if (!so.shipmentRef || so.shipmentRef.startsWith('mock:') || this.mode() !== 'live' || !so.trackingId) return;
        try {
            await axios.post(`${this.base()}/api/p/edit`, { waybill: so.trackingId, cancellation: 'true' }, { headers: { Authorization: `Token ${process.env.DELHIVERY_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15_000 });
        } catch (e: any) {
            logger.warn(`[STORE-SHIP] Could not cancel waybill ${so.trackingId} for ${so.code}: ${e?.message}`);
        }
    }

    /** A 4×6 inch label: to, from, order, contents, and the waybill as a barcode. */
    static async label(bpId: number, id: number): Promise<Buffer> {
        const so = await this.order(bpId, id);
        if (['placed', 'cancelled'].includes(so.status)) throw new HubError('Confirm the order before printing its label.', 'BAD_STATE', 409);
        if (so.settledAt) throw new HubError('This order is closed.', 'CLOSED', 409);
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, so.sellerPartnerId)).limit(1);
        const items = await db.select().from(sellerOrderItems).where(eq(sellerOrderItems.sellerOrderId, so.id));
        const [inv] = so.invoiceDocumentId ? await db.select({ number: taxDocuments.number }).from(taxDocuments).where(eq(taxDocuments.id, so.invoiceDocumentId)).limit(1) : [];
        const bwip: any = await import('bwip-js/node');
        const barcode = async (text: string, height: number) => (bwip.default ?? bwip).toBuffer({ bcid: 'code128', text, scale: 3, height, includetext: true, textxalign: 'center', textsize: 11 });
        const waybillPng = so.trackingId ? await barcode(so.trackingId, 14) : null;
        const orderPng = await barcode(so.code, 8);

        const doc = new PDFDocument({ size: [288, 432], margin: 14 });
        const chunks: Buffer[] = [];
        doc.on('data', c => chunks.push(c));
        const done = new Promise<Buffer>(r => doc.on('end', () => r(Buffer.concat(chunks))));
        const W = 288 - 28;
        doc.font('Helvetica-Bold').fontSize(13).text(so.courier ?? 'Courier', 14, 14, { width: W / 2 });
        doc.font('Helvetica-Bold').fontSize(11).text('PREPAID — do not collect cash', 14 + W / 2, 16, { width: W / 2, align: 'right' });
        doc.moveTo(14, 34).lineTo(274, 34).stroke();
        if (waybillPng) doc.image(waybillPng, 14 + (W - 220) / 2, 40, { width: 220, height: 62 });
        else doc.font('Helvetica').fontSize(10).text('No courier waybill — write the tracking id here', 14, 62, { width: W, align: 'center' });
        doc.moveTo(14, 108).lineTo(274, 108).stroke();
        doc.font('Helvetica-Bold').fontSize(9).text('SHIP TO', 14, 114);
        doc.font('Helvetica-Bold').fontSize(12).text(so.shipName ?? 'Customer', 14, 126, { width: W });
        doc.font('Helvetica').fontSize(10).text(so.shipAddress ?? '', { width: W });
        doc.font('Helvetica-Bold').fontSize(14).text(`PIN ${so.shipPincode ?? ''}`, { width: W });
        doc.font('Helvetica').fontSize(10).text(`Phone ${so.shipPhone ?? ''}`, { width: W });
        const y1 = Math.max(doc.y + 6, 220);
        doc.moveTo(14, y1).lineTo(274, y1).stroke();
        doc.font('Helvetica-Bold').fontSize(9).text('FROM (return to)', 14, y1 + 6);
        doc.font('Helvetica').fontSize(9).text([bp?.legalName, bp?.address, [bp?.district, bp?.pincode].filter(Boolean).join(' '), bp?.contactPhone ? `Phone ${bp.contactPhone}` : null, bp?.gstin ? `GSTIN ${bp.gstin}` : null].filter(Boolean).join('\n'), { width: W });
        const y2 = doc.y + 6;
        doc.moveTo(14, y2).lineTo(274, y2).stroke();
        const contents = items.map(i => `${i.quantity} × ${i.name}`).join(', ');
        doc.font('Helvetica').fontSize(8).text(`Contents: ${contents}`.slice(0, 220), 14, y2 + 5, { width: W });
        // The standard PDF fonts have no rupee sign.
        doc.text(`Value Rs ${(so.totalPaise / 100).toLocaleString('en-IN')}${inv ? ` · Invoice ${inv.number}` : ''}${so.parcel ? ` · ${(so.parcel as any).weightGrams} g` : ''}`, { width: W });
        doc.image(orderPng, 14 + (W - 160) / 2, 432 - 14 - 44, { width: 160, height: 40 });
        doc.end();
        return done;
    }
}
