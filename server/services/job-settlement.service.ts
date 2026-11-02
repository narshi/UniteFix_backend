/**
 * Settling a job whose balance the technician collected in cash.
 *
 * One place for it, because two things do it: the expert pressing "Cash
 * collected" in the app, and staff closing a job from the admin when the
 * expert could not. Both must leave the wallet in exactly the same state.
 *
 * The technician holds the cash and is owed their earning, so the wallet moves
 * by the difference (BillingEngine.calculateCashDebitAmount): positive is
 * UniteFix's fee and GST, debited and allowed to go negative (recovered from
 * later earnings); negative is the part of the advance that is theirs, credited
 * on hold like any earning.
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
        const net = BillingEngine.calculateCashDebitAmount(snapshot);
        const platformDebit = Math.max(0, net);
        const advanceCredit = Math.max(0, Math.round(-net * 100) / 100);
        let walletTransaction: any = null;

        // A partner's technician has no wallet. Under the subcontract model the
        // cash is UniteFix's (it is the provider to the customer): the partner is
        // charged what its technician collected and credited the job's value
        // after the hold — net, UniteFix's share, exactly what the wallet debit
        // would have been.
        const { PartnerFieldService } = await import('./partner-field.service');
        const employerId = await PartnerFieldService.employerOf(providerId);
        const holdDays = Number(await configService.get<number>('BUSINESS_CONFIG.WALLET_HOLD_DAYS', 7));
        if (employerId) {
            const value = Number(snapshot.technicianEarning ?? snapshot.employeeEarnings ?? 0);
            // value + net = exactly the cash the technician collected.
            walletTransaction = await PartnerFieldService.bookCashCollected(employerId, { serviceRequestId: booking.id, serviceId: booking.serviceId, amountRupees: Math.round((value + net) * 100) / 100 });
            await PartnerFieldService.holdJobValue(db, employerId, {
                serviceRequestId: booking.id, employeeId: providerId, amountRupees: value,
                releaseAt: new Date(Date.now() + holdDays * 86_400_000),
            });
            return { platformDebit, advanceCredit, walletTransaction };
        }

        const { storage } = await import('../storage');
        if (platformDebit > 0) {
            walletTransaction = await storage.deductProviderWallet(
                providerId, platformDebit,
                `Platform fee — cash payment booking #${booking.serviceId}`,
                true, // allowNegative: UniteFix always recovers its share
            );
        } else if (advanceCredit > 0) {
            // The ₹99 advance UniteFix holds is more than its fee + GST: the rest
            // is the technician's, held like any other earning.
            walletTransaction = await storage.creditWalletOnHold(
                providerId, booking.id, advanceCredit,
                new Date(Date.now() + holdDays * 86_400_000), undefined,
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
