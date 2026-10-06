/**
 * E-invoicing (IRN) — the hook, not a fake.
 *
 * Businesses above ₹5 crore aggregate turnover must register B2B invoices
 * with the Invoice Registration Portal and print the IRN and signed QR. That
 * needs a GSP / IRP integration with credentials (decision 5: pick a
 * provider). Until EINVOICE_PROVIDER and its credentials are configured,
 * nothing here generates an IRN — the invoice is marked `pending_provider`
 * and the Hub tells the partner plainly that it still needs one.
 */

import logger from '../lib/logger';

export type IrnResult = { status: 'generated'; irn: string; ackNo?: string; signedQr?: string } | { status: 'pending_provider'; reason: string };

export class EInvoiceService {
    static configured(): boolean {
        return !!process.env.EINVOICE_PROVIDER && !!process.env.EINVOICE_CLIENT_ID && !!process.env.EINVOICE_CLIENT_SECRET;
    }

    /** Required when the supplier is above the threshold and the buyer is GST-registered (B2B). */
    static required(supplierAbove5cr: boolean, buyerGstin: string | null | undefined): boolean {
        return supplierAbove5cr && !!buyerGstin;
    }

    static async generate(documentNumber: string): Promise<IrnResult> {
        if (!this.configured()) {
            return { status: 'pending_provider', reason: 'No e-invoice provider is configured yet. Generate the IRN on the IRP portal and record it, or wait until UniteFix connects one.' };
        }
        // A provider is named but its adapter is not implemented — say so rather than pretend.
        logger.warn(`[EINVOICE] Provider ${process.env.EINVOICE_PROVIDER} configured but no adapter is implemented; ${documentNumber} left pending.`);
        return { status: 'pending_provider', reason: `E-invoice provider "${process.env.EINVOICE_PROVIDER}" is not integrated yet.` };
    }
}
