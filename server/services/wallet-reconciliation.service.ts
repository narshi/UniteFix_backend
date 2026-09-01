/**
 * Does each partner's wallet balance agree with their ledger?
 *
 * WHY THIS EXISTS
 * `partner_wallets.balance_available` is not derived from the ledger — it is a
 * parallel mutable number, written by twelve separate code paths across six
 * files. Each is supposed to append a matching ledger row. Nothing enforces it,
 * and nothing noticed when it stopped being true: a live partner was found
 * holding ₹416.60 against ₹173.30 of ledger, a gap discovered only because he
 * complained about something else entirely.
 *
 * Drift is currently silent and permanent. This makes it loud.
 *
 * STRICTLY READ-ONLY. It reports; it never repairs. An automatic "fix" that
 * moved money based on a reconstruction this codebase cannot yet do reliably
 * would be considerably worse than the drift it was correcting.
 *
 * WHAT IT CAN AND CANNOT PROVE
 * Two ledgers coexist. `wallet_transactions` (v1) carries online-payment job
 * earnings and admin top-ups/deductions; `wallet_transactions_v2` carries holds,
 * withdrawals and refunds; top-ups and deductions land in both. A plain "replay
 * the log" reconstruction is therefore impossible until they are unified, and
 * this deliberately does not attempt one.
 *
 * What it CAN prove is stronger than that sounds: v2 rows record
 * balance_*_before/after, so the chain must be continuous. A break means a
 * balance moved with no ledger row to explain it, and names the entry it
 * happened after — which finds the drift without reconstructing anything.
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';
import logger from '../lib/logger';

export type Severity = 'critical' | 'warning' | 'info';

export interface WalletIssue {
    code:
    | 'HOLD_MISMATCH'          // balance_hold disagrees with unreleased holds
    | 'LEDGER_BREAK'           // the v2 before/after chain is discontinuous
    | 'NEGATIVE_BALANCE'       // should never happen
    | 'BALANCE_WITHOUT_LEDGER' // money present, no v2 history at all
    | 'OVERDUE_HOLD'           // past its release date, still held
    | 'V1_ONLY_ACTIVITY';      // history the partner's app cannot show them
    severity: Severity;
    detail: string;
    expected?: string;
    actual?: string;
    diff?: string;
}

export interface WalletReport {
    partnerId: number;
    partnerName: string | null;
    phone: string | null;
    balanceAvailable: string;
    balanceHold: string;
    issues: WalletIssue[];
}

export interface ReconciliationResult {
    checkedAt: string;
    walletsChecked: number;
    clean: number;
    reports: WalletReport[];
    totals: Record<WalletIssue['code'], number>;
    /** Absolute rupees unaccounted for in held balances, across every wallet. */
    totalHoldDrift: number;
}

const money = (v: unknown) => Number(v ?? 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const rows = (result: unknown): any[] => (result as any)?.rows ?? (Array.isArray(result) ? result : []);

/**
 * @param partnerId inspect one partner; omit to sweep every wallet.
 */
export async function reconcileWallets(partnerId?: number): Promise<ReconciliationResult> {
    const wallets = rows(await db.execute(
        partnerId
            ? sql`SELECT w.partner_id, w.balance_available, w.balance_hold, w.total_earned,
                         e.full_name, u.phone
                    FROM partner_wallets w
                    LEFT JOIN employees e ON e.id = w.partner_id
                    LEFT JOIN users u ON u.id = e.user_id
                   WHERE w.partner_id = ${partnerId}`
            : sql`SELECT w.partner_id, w.balance_available, w.balance_hold, w.total_earned,
                         e.full_name, u.phone
                    FROM partner_wallets w
                    LEFT JOIN employees e ON e.id = w.partner_id
                    LEFT JOIN users u ON u.id = e.user_id
                   ORDER BY w.partner_id`
    ));

    const reports: WalletReport[] = [];
    const totals: Record<string, number> = {
        HOLD_MISMATCH: 0, LEDGER_BREAK: 0, NEGATIVE_BALANCE: 0,
        BALANCE_WITHOUT_LEDGER: 0, OVERDUE_HOLD: 0, V1_ONLY_ACTIVITY: 0,
    };
    let totalHoldDrift = 0;

    for (const w of wallets) {
        const pid = Number(w.partner_id);
        const issues: WalletIssue[] = [];
        const available = money(w.balance_available);
        const held = money(w.balance_hold);

        const v2 = rows(await db.execute(sql`
            SELECT id, transaction_type, amount, is_released, release_date, created_at,
                   balance_available_before, balance_available_after,
                   balance_hold_before, balance_hold_after
              FROM wallet_transactions_v2
             WHERE partner_id = ${pid}
             ORDER BY id
        `));

        const v1Count = Number(rows(await db.execute(sql`
            SELECT COUNT(*)::int AS n FROM wallet_transactions WHERE provider_id = ${pid}
        `))[0]?.n ?? 0);

        // ── 1. Holds. The one figure that IS unambiguous: only v2 writes holds,
        //       so the sum of unreleased hold_credit must equal balance_hold.
        const expectedHold = r2(v2
            .filter(t => t.transaction_type === 'hold_credit' && t.is_released === false)
            .reduce((s, t) => s + money(t.amount), 0));

        if (Math.abs(expectedHold - held) >= 0.01) {
            const diff = r2(held - expectedHold);
            totalHoldDrift += Math.abs(diff);
            issues.push({
                code: 'HOLD_MISMATCH', severity: 'critical',
                detail: 'Held balance does not match the sum of unreleased hold entries.',
                expected: `₹${expectedHold.toFixed(2)}`,
                actual: `₹${held.toFixed(2)}`,
                diff: `${diff > 0 ? '+' : ''}₹${diff.toFixed(2)}`,
            });
        }

        // ── 2. Continuity. Each row states the balance before and after it, so a
        //       gap between one row's `after` and the next row's `before` is a
        //       balance that moved with nothing recording it — exactly the drift
        //       this exists to find. Reported once, at the first break: every
        //       later row inherits the same offset and is downstream noise.
        for (let i = 1; i < v2.length; i++) {
            const prev = v2[i - 1], cur = v2[i];
            const gap = r2(money(cur.balance_available_before) - money(prev.balance_available_after));
            if (Math.abs(gap) >= 0.01) {
                issues.push({
                    code: 'LEDGER_BREAK', severity: 'critical',
                    detail: `Available balance moved by ₹${gap.toFixed(2)} between entry #${prev.id} `
                        + `(${prev.transaction_type}) and #${cur.id} (${cur.transaction_type}) `
                        + `with no ledger row recording it.`,
                    expected: `₹${money(prev.balance_available_after).toFixed(2)}`,
                    actual: `₹${money(cur.balance_available_before).toFixed(2)}`,
                    diff: `${gap > 0 ? '+' : ''}₹${gap.toFixed(2)}`,
                });
                break;
            }
        }

        // ── 3. States that should be impossible.
        if (available < 0 || held < 0) {
            issues.push({
                code: 'NEGATIVE_BALANCE', severity: 'critical',
                detail: `Negative balance: available ₹${available.toFixed(2)}, held ₹${held.toFixed(2)}.`,
            });
        }

        if (v2.length === 0 && (available > 0 || held > 0)) {
            issues.push({
                code: 'BALANCE_WITHOUT_LEDGER', severity: 'critical',
                detail: `₹${(available + held).toFixed(2)} sits in this wallet with no v2 ledger history at all.`,
            });
        }

        // ── 4. The release job has stopped. Money the partner earned, whose hold
        //       period has passed, that they still cannot withdraw.
        const overdue = v2.filter(t =>
            t.transaction_type === 'hold_credit' && t.is_released === false
            && t.release_date && new Date(t.release_date) < new Date());
        if (overdue.length) {
            const amt = r2(overdue.reduce((s, t) => s + money(t.amount), 0));
            const oldest = overdue.reduce((a, b) =>
                new Date(a.release_date) < new Date(b.release_date) ? a : b);
            issues.push({
                code: 'OVERDUE_HOLD', severity: 'critical',
                detail: `₹${amt.toFixed(2)} is past its release date and still held `
                    + `(oldest due ${new Date(oldest.release_date).toISOString().slice(0, 10)}). `
                    + `The hourly release job may not be running.`,
            });
        }

        // ── 5. Split-brain. The partner's app reads v2; these entries exist only
        //       in v1, so it is history they are never shown.
        if (v1Count > 0 && v2.length === 0) {
            issues.push({
                code: 'V1_ONLY_ACTIVITY', severity: 'warning',
                detail: `${v1Count} ledger entr${v1Count === 1 ? 'y' : 'ies'} exist only in the v1 table, `
                    + `so the partner's app shows none of them.`,
            });
        }

        issues.forEach(i => { totals[i.code]++; });
        if (issues.length) {
            reports.push({
                partnerId: pid,
                partnerName: w.full_name ?? null,
                phone: w.phone ?? null,
                balanceAvailable: available.toFixed(2),
                balanceHold: held.toFixed(2),
                issues,
            });
        }
    }

    return {
        checkedAt: new Date().toISOString(),
        walletsChecked: wallets.length,
        clean: wallets.length - reports.length,
        reports,
        totals: totals as ReconciliationResult['totals'],
        totalHoldDrift: r2(totalHoldDrift),
    };
}

/**
 * Scheduled sweep. Logs loudly, so drift surfaces on its own rather than waiting
 * for a serviceman to notice his money is wrong.
 */
export async function reconciliationSweep(): Promise<void> {
    try {
        const result = await reconcileWallets();
        const critical = result.reports.filter(r => r.issues.some(i => i.severity === 'critical'));

        if (critical.length === 0) {
            logger.info('[WALLET_RECON] All wallets reconcile with their ledger', {
                checked: result.walletsChecked,
            });
            return;
        }

        logger.error('[WALLET_RECON] Wallets do NOT reconcile with their ledger', {
            checked: result.walletsChecked,
            affected: critical.length,
            holdDriftRupees: result.totalHoldDrift,
            breakdown: result.totals,
            partners: critical.slice(0, 20).map(r => ({
                partnerId: r.partnerId,
                name: r.partnerName,
                issues: r.issues.map(i => `${i.code}${i.diff ? ' ' + i.diff : ''}`),
            })),
        });
    } catch (err: any) {
        logger.error('[WALLET_RECON] Reconciliation sweep failed', { error: err.message });
    }
}
