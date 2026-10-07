/**
 * Partner settlements — paying a business partner what UniteFix owes it.
 *
 * Two ledgers feed it and are never silently netted:
 *   - ftth_operator_ledger: positive = UniteFix owes the operator (recharges).
 *   - business_partner_ledger: positive = the partner owes UniteFix (parts on
 *     credit, fees); negative = UniteFix owes the partner (later phases:
 *     service value, store sales).
 *
 * A run freezes the figures (draft), then pays (manual UTR, or Cashfree
 * Payouts). Parts dues are offset against broadband money explicitly — an
 * offset line on both ledgers and on the statement — and the remainder goes
 * to the partner's verified bank account. A run refuses to pay if balances
 * moved since it was drafted; draft again.
 */

import { db } from '../db';
import { and, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import {
    settlementRuns, businessPartners, businessPartnerLedger, ftthOperators, ftthOperatorLedger, type SettlementRun,
} from '@shared/schema';
import { BusinessPartnerService } from './business-partner.service';
import { FtthService } from './ftth.service';
import { CashfreeService } from './cashfree.service';
import { TaxDocumentService } from './tax-documents.service';
import { renderSettlementPdf } from './tax-document-pdf';
import { withTransaction } from '../lib/transaction';
import logger from '../lib/logger';

export class SettlementError extends Error {
    constructor(message: string, public code: string) { super(message); }
}

export class SettlementService {

    static async position(bpId: number) {
        const [op] = await db.select({ id: ftthOperators.id }).from(ftthOperators).where(eq(ftthOperators.businessPartnerId, bpId)).limit(1);
        const ftthBalance = op ? await FtthService.operatorBalancePaise(op.id) : 0;
        const ftthOwed = Math.max(0, ftthBalance);
        const b2bBalance = await BusinessPartnerService.balancePaise(bpId);
        const offset = b2bBalance > 0 ? Math.min(b2bBalance, ftthOwed) : 0;
        const payout = ftthOwed - offset + Math.max(0, -b2bBalance);
        return { operatorId: op?.id ?? null, ftthOwed, b2bBalance, offset, payout };
    }

    /** Every active partner with something to settle — the weekly run's worklist. */
    static async worklist() {
        const bps = await db.select().from(businessPartners).where(eq(businessPartners.status, 'active'));
        const out = [];
        for (const bp of bps) {
            const p = await this.position(bp.id);
            if (p.payout <= 0 && p.offset <= 0) continue;
            const [open] = await db.select({ id: settlementRuns.id, runCode: settlementRuns.runCode, status: settlementRuns.status })
                .from(settlementRuns).where(and(eq(settlementRuns.businessPartnerId, bp.id), inArray(settlementRuns.status, ['draft', 'processing']))).limit(1);
            out.push({
                businessPartnerId: bp.id, partnerCode: bp.partnerCode, displayName: bp.displayName,
                bankReady: bp.bankStatus === 'verified' && !!bp.bankAccountNumber, ...p, openRun: open ?? null,
            });
        }
        return out;
    }

    static async create(bpId: number, adminId: number, notes?: string | null) {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) throw new SettlementError('Partner not found', 'NOT_FOUND');
        const p = await this.position(bpId);
        if (p.payout <= 0 && p.offset <= 0) throw new SettlementError('Nothing to settle: UniteFix owes this partner nothing right now.', 'NOTHING_DUE');
        const runCode = `ST_${bp.partnerCode.replace(/[^A-Z0-9]/gi, '')}_${Date.now().toString(36).toUpperCase()}`;
        try {
            const [run] = await db.insert(settlementRuns).values({
                runCode, businessPartnerId: bpId, status: 'draft',
                ftthOwedPaise: p.ftthOwed, b2bBalancePaise: p.b2bBalance, offsetPaise: p.offset, payoutPaise: p.payout,
                notes: notes ?? null, createdByAdminId: adminId,
            }).returning();
            return run;
        } catch (err: any) {
            if (err?.code === '23505') throw new SettlementError('This partner already has a settlement in progress. Pay or cancel it first.', 'OPEN_RUN');
            throw err;
        }
    }

    static async cancel(runId: number, adminId: number) {
        const [run] = await db.update(settlementRuns).set({ status: 'cancelled', notes: sql`coalesce(${settlementRuns.notes} || ' ', '') || ${`Cancelled by admin #${adminId}.`}` })
            .where(and(eq(settlementRuns.id, runId), eq(settlementRuns.status, 'draft'))).returning();
        if (!run) throw new SettlementError('Only a draft can be cancelled.', 'NOT_DRAFT');
        return run;
    }

    /**
     * Pay a draft. Manual: the admin already sent the money and gives the UTR.
     * Cashfree: the transfer is requested first (idempotent on the run code);
     * the ledgers are written only once Cashfree has accepted it.
     */
    static async pay(runId: number, adminId: number, how: { method: 'manual'; reference: string } | { method: 'cashfree' }) {
        const [run] = await db.select().from(settlementRuns).where(eq(settlementRuns.id, runId)).limit(1);
        if (!run) throw new SettlementError('Run not found', 'NOT_FOUND');
        if (run.status !== 'draft' && !(run.status === 'failed' && how.method === 'manual')) throw new SettlementError(`This run is ${run.status}.`, 'NOT_DRAFT');
        const bp = await BusinessPartnerService.byId(run.businessPartnerId);
        if (!bp) throw new SettlementError('Partner not found', 'NOT_FOUND');

        // Balances must still support what was frozen.
        const now = await this.position(run.businessPartnerId);
        const stale = now.ftthOwed < run.ftthOwedPaise
            || (run.offsetPaise > 0 && now.b2bBalance < run.offsetPaise)
            || (run.b2bBalancePaise < 0 && now.b2bBalance > run.b2bBalancePaise);
        if (stale) throw new SettlementError('Balances changed since this run was drafted. Cancel it and draft a new one.', 'STALE');

        if (run.payoutPaise > 0 && (bp.bankStatus !== 'verified' || !bp.bankAccountNumber)) {
            throw new SettlementError('The partner has no verified bank account. Verify it under Hub & KYC first.', 'BANK_NOT_VERIFIED');
        }

        let reference: string | null = how.method === 'manual' ? how.reference.trim() : null;
        let status: 'paid' | 'processing' = 'paid';
        if (how.method === 'manual' && run.payoutPaise > 0 && (!reference || reference.length < 4)) {
            throw new SettlementError('Enter the bank reference (UTR) of the transfer you made.', 'REFERENCE_REQUIRED');
        }

        if (how.method === 'cashfree' && run.payoutPaise > 0) {
            try {
                const beneId = bp.cashfreeBeneId || `BP${bp.id}`;
                if (!bp.cashfreeBeneId) {
                    await CashfreeService.addBeneficiary({
                        beneId, name: bp.beneficiaryName || bp.legalName, email: bp.contactEmail || `${bp.partnerCode.toLowerCase()}@partners.unitefix.in`,
                        phone: bp.contactPhone, bankAccount: bp.bankAccountNumber!, ifsc: bp.bankIfsc!, address1: bp.address ?? undefined,
                    });
                    await db.update(businessPartners).set({ cashfreeBeneId: beneId }).where(eq(businessPartners.id, bp.id));
                }
                const r = await CashfreeService.createPayout(beneId, run.payoutPaise / 100, run.runCode, 'settlement');
                reference = r.utr ?? r.referenceId ?? run.runCode;
                status = r.utr ? 'paid' : 'processing';
            } catch (err: any) {
                await db.update(settlementRuns).set({ status: 'failed', method: 'cashfree', failureReason: String(err?.message ?? err).slice(0, 500) }).where(eq(settlementRuns.id, run.id));
                logger.error(`[SETTLEMENT] ${run.runCode} Cashfree payout failed: ${err?.message}`);
                throw new SettlementError(`Cashfree did not accept the transfer: ${err?.message}. Nothing was recorded; you can pay by hand and enter the UTR.`, 'PAYOUT_FAILED');
            }
        }

        return withTransaction(async (tx) => {
            // Serialise against any other money movement on this partner.
            await tx.execute(sql`SELECT id FROM business_partners WHERE id = ${run.businessPartnerId} FOR UPDATE`);
            const meta = { settlementRunId: run.id, runCode: run.runCode };
            const ftthPay = run.ftthOwedPaise - run.offsetPaise;
            const b2bPay = Math.max(0, -run.b2bBalancePaise);
            const opId = now.operatorId;

            if (run.offsetPaise > 0 && opId) {
                await FtthService.ledgerInTx(tx as any, { operatorId: opId, entryType: 'settlement_paid', amountPaise: -run.offsetPaise, description: `Settled against parts dues — ${run.runCode}`, createdByAdminId: adminId, metadata: meta });
                await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: run.businessPartnerId, entryType: 'settlement_offset', amountPaise: -run.offsetPaise, description: `Parts dues settled from broadband earnings — ${run.runCode}`, createdByAdminId: adminId, metadata: meta });
            }
            if (ftthPay > 0 && opId) {
                await FtthService.ledgerInTx(tx as any, { operatorId: opId, entryType: 'settlement_paid', amountPaise: -ftthPay, description: `Paid to bank — ${run.runCode}${reference ? ` (${reference})` : ''}`, createdByAdminId: adminId, metadata: meta });
            }
            if (b2bPay > 0) {
                await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: run.businessPartnerId, entryType: 'settlement_paid', amountPaise: b2bPay, description: `Paid to bank — ${run.runCode}${reference ? ` (${reference})` : ''}`, createdByAdminId: adminId, metadata: meta });
            }
            const [updated] = await tx.update(settlementRuns).set({
                status, method: run.payoutPaise > 0 ? how.method : 'offset', payoutReference: reference,
                cashfreeTransferId: how.method === 'cashfree' ? run.runCode : null, failureReason: null,
                paidByAdminId: adminId, paidAt: new Date(),
            }).where(eq(settlementRuns.id, run.id)).returning();
            logger.info(`[SETTLEMENT] ${run.runCode} ${status}: payout ${run.payoutPaise}p, offset ${run.offsetPaise}p (${how.method})`);
            if (status === 'paid') {
                const { HubAlerts } = await import('./hub-alerts.service');
                void HubAlerts.send(run.businessPartnerId, 'settlement_paid', { title: `Settlement ${run.runCode} paid`, body: `₹${(run.payoutPaise / 100).toLocaleString('en-IN')} sent to your bank${reference ? ` (ref ${reference})` : ''}${run.offsetPaise ? `, after ₹${(run.offsetPaise / 100).toLocaleString('en-IN')} offset against parts dues` : ''}.`, link: '/partner/money', refType: 'settlement_run', refId: run.id });
            }
            return updated;
        });
    }

    /** A Cashfree transfer still in the banking rails: ask Cashfree where it is. */
    static async sync(runId: number) {
        const [run] = await db.select().from(settlementRuns).where(eq(settlementRuns.id, runId)).limit(1);
        if (!run || run.status !== 'processing' || !run.cashfreeTransferId) throw new SettlementError('Only a Cashfree transfer in progress can be synced.', 'NOT_PROCESSING');
        const st = await CashfreeService.fetchPayoutStatus(run.cashfreeTransferId);
        if (st.status === 'processed') {
            const [u] = await db.update(settlementRuns).set({ status: 'paid', payoutReference: st.utr ?? run.payoutReference }).where(eq(settlementRuns.id, runId)).returning();
            return u;
        }
        if (st.status === 'failed' || st.status === 'reversed') {
            // The ledgers said "paid"; put the money back on them so the partner is owed again.
            return withTransaction(async (tx) => {
                const meta = { settlementRunId: run.id, runCode: run.runCode, reversal: true };
                const pos = await this.position(run.businessPartnerId);
                const ftthPay = run.ftthOwedPaise - run.offsetPaise;
                const b2bPay = Math.max(0, -run.b2bBalancePaise);
                if (ftthPay > 0 && pos.operatorId) await FtthService.ledgerInTx(tx as any, { operatorId: pos.operatorId, entryType: 'adjustment', amountPaise: ftthPay, description: `Transfer ${st.status} — ${run.runCode}; amount owed again`, metadata: meta });
                if (b2bPay > 0) await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: run.businessPartnerId, entryType: 'adjustment', amountPaise: -b2bPay, description: `Transfer ${st.status} — ${run.runCode}; amount owed again`, metadata: meta });
                const [u] = await tx.update(settlementRuns).set({ status: 'failed', failureReason: `Cashfree reported ${st.status}` }).where(eq(settlementRuns.id, runId)).returning();
                return u;
            });
        }
        return run;
    }

    static async list(opts: { businessPartnerId?: number; limit?: number } = {}) {
        return db.select({
            run: settlementRuns, partnerCode: businessPartners.partnerCode, displayName: businessPartners.displayName,
        }).from(settlementRuns).innerJoin(businessPartners, eq(businessPartners.id, settlementRuns.businessPartnerId))
            .where(opts.businessPartnerId ? eq(settlementRuns.businessPartnerId, opts.businessPartnerId) : undefined)
            .orderBy(desc(settlementRuns.createdAt)).limit(opts.limit ?? 200);
    }

    /** The statement PDF: the run's figures and the ledger entries since the previous paid run. */
    static async pdf(run: SettlementRun) {
        const bp = await BusinessPartnerService.byId(run.businessPartnerId);
        if (!bp) throw new SettlementError('Partner not found', 'NOT_FOUND');
        const [prev] = await db.select({ at: settlementRuns.paidAt }).from(settlementRuns)
            .where(and(eq(settlementRuns.businessPartnerId, run.businessPartnerId), eq(settlementRuns.status, 'paid'), sql`${settlementRuns.paidAt} < ${run.createdAt}`))
            .orderBy(desc(settlementRuns.paidAt)).limit(1);
        const since = prev?.at ?? new Date(0);
        const until = run.createdAt ?? new Date();
        const pos = await this.position(run.businessPartnerId);
        const ftth = pos.operatorId ? await db.select().from(ftthOperatorLedger)
            .where(and(eq(ftthOperatorLedger.operatorId, pos.operatorId), gt(ftthOperatorLedger.createdAt, since), lte(ftthOperatorLedger.createdAt, until))) : [];
        const b2b = await db.select().from(businessPartnerLedger)
            .where(and(eq(businessPartnerLedger.businessPartnerId, run.businessPartnerId), gt(businessPartnerLedger.createdAt, since), lte(businessPartnerLedger.createdAt, until)));
        const lines = [
            ...ftth.filter(l => l.amountPaise !== 0).map(l => ({ at: l.createdAt!, source: 'Broadband', description: l.description ?? l.entryType, amountPaise: l.amountPaise })),
            // Partner ledger is "+ = partner owes"; the statement shows "+ = owed to you".
            ...b2b.map(l => ({ at: l.createdAt!, source: 'Parts/fees', description: l.description ?? l.entryType, amountPaise: -l.amountPaise })),
        ].sort((a, b) => a.at.getTime() - b.at.getTime());
        return renderSettlementPdf({
            runCode: run.runCode, createdAt: run.createdAt!, paidAt: run.paidAt, status: run.status, method: run.method, payoutReference: run.payoutReference,
            partner: { ...TaxDocumentService.partnerParty(bp), partnerCode: bp.partnerCode }, payer: await TaxDocumentService.unitefixParty(),
            ftthOwedPaise: run.ftthOwedPaise, b2bBalancePaise: run.b2bBalancePaise, offsetPaise: run.offsetPaise, payoutPaise: run.payoutPaise, lines,
        });
    }
}
