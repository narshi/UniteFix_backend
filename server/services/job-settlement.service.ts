/**
 * Settling a job whose balance the technician collected in cash.
 *
 * One place for it, because two things do it: the expert pressing "Cash
 * collected" in the app, and staff closing a job from the admin when the
 * expert could not. Both must leave the wallet in exactly the same state.
 *
 * The technician holds the cash and is owed their earning, so the wallet moves
 * by the difference (BillingEngine.calculateCashDebitAmount): positive is
 * UniteFix's fee and GST (plus a partner's commission, for a partner's
 * technician), debited and allowed to go negative (recovered from later
 * earnings); negative is the part of the advance that is theirs, credited on
 * hold like any earning.
 */

import { configService } from './config.service';
import { BillingEngine, type PricingSnapshot } from './billing-engine';
import { db } from '../db';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

export interface CashSettlement {
    platformDebit: number;
    advanceCredit: number;
    walletTransaction: any;
}

export class JobSettlementService {
    static async settleCash(booking: { id: number; serviceId: string }, snapshot: PricingSnapshot, providerId: number): Promise<CashSettlement> {
        let net = BillingEngine.calculateCashDebitAmount(snapshot);
        let walletTransaction: any = null;
        const holdDays = Number(await configService.get<number>('BUSINESS_CONFIG.WALLET_HOLD_DAYS', 7));
        const releaseAt = new Date(Date.now() + holdDays * 86_400_000);

        // A partner's technician keeps the cash like any expert, and also owes
        // the partner's commission: UniteFix takes it from the wallet with its
        // own share and holds it for the partner.
        const { PartnerFieldService } = await import('./partner-field.service');
        const value = Number(snapshot.technicianEarning ?? snapshot.employeeEarnings ?? 0);
        const split = await PartnerFieldService.commissionSplit(providerId, value);
        if (split && split.commission > 0) {
            await PartnerFieldService.holdJobValue(db, split.bpId, {
                serviceRequestId: booking.id, employeeId: providerId, amountRupees: split.commission, releaseAt,
                note: `Commission ${split.rule} of ₹${value}, from a cash job`, countService: false,
            });
            net = Math.round((net + split.commission) * 100) / 100;
        }
        const platformDebit = Math.max(0, net);
        const advanceCredit = Math.max(0, Math.round(-net * 100) / 100);
        const partnerNote = split && split.commission > 0 ? ` and ${split.partnerName}'s commission` : '';

        const { storage } = await import('../storage');
        if (platformDebit > 0) {
            walletTransaction = await storage.deductProviderWallet(
                providerId, platformDebit,
                `Platform fee${partnerNote} — cash payment booking #${booking.serviceId}`,
                true, // allowNegative: UniteFix always recovers its share
            );
        } else if (advanceCredit > 0) {
            // The ₹99 advance UniteFix holds is more than its fee + GST: the rest
            // is the technician's, held like any other earning.
            walletTransaction = await storage.creditWalletOnHold(
                providerId, booking.id, advanceCredit,
                releaseAt, undefined,
                { description: `Balance of booking advance — cash payment booking #${booking.serviceId}`, countService: false },
            );
        }
        return { platformDebit, advanceCredit, walletTransaction };
    }

    /**
     * A cash settlement that failed must not vanish into a log: it is UniteFix's
     * fee and GST, still with the technician. Written to the audit trail so it
     * can be found and recovered.
     */
    static async recordFailedSettlement(bookingId: number, providerId: number, err: unknown) {
        const message = (err as any)?.message ?? String(err);
        logger.error(`[CASH] Wallet settlement failed for booking ${bookingId}: ${message}`);
        await recordAudit({
            entityType: 'service_request', entityId: bookingId, action: 'cash_settlement_failed',
            changedBy: null, metadata: { providerId, error: message.slice(0, 500) },
        });
    }
}
