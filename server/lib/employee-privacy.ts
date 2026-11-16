/**
 * What staff see of an expert's identity and bank details.
 *
 * The employees row carries an Aadhaar number, a PAN, a bank account number and
 * links to the identity documents themselves. Staff routes used to return the
 * whole row to any role that could open the Employees page — and no screen
 * there shows any of it. The privacy policy promises these are shown masked.
 *
 * So: every staff response carrying an expert goes through `redactEmployee`.
 *   - Aadhaar, PAN and bank account numbers come back masked, last four only.
 *     The full bank account is on the Withdrawals screen, behind the
 *     Withdrawals capability, where staff actually need it to pay someone.
 *   - Document links are replaced by "is there one" flags, unless the caller
 *     may manage experts (the people who check documents).
 *
 * Masking happens here, on the way out. The stored values are untouched, and
 * payouts, bank verification and the withdrawal screens read them as before.
 */

/** "••••1234" — or null when there is nothing to mask. */
export function maskLast4(value: unknown): string | null {
    const s = value == null ? '' : String(value).replace(/\s+/g, '');
    if (!s) return null;
    return `••••${s.slice(-4)}`;
}

type Caps = Set<string> | undefined | null;

/** An admin's capabilities, as authenticateAdmin attaches them. */
export function capsOf(req: unknown): Caps {
    return (req as any)?.admin?.capabilities as Caps;
}

const NUMBER_FIELDS = ['aadhaarNumber', 'panNumber', 'bankAccountNumber'] as const;
const DOCUMENT_FIELDS = ['aadhaarDocUrl', 'panDocUrl'] as const;

/**
 * A copy of an employees row that is safe to send to a staff screen.
 * `caps` decides only one thing: whether document links are included.
 */
export function redactEmployee<T extends Record<string, any>>(row: T, caps?: Caps): T {
    if (!row || typeof row !== 'object') return row;
    const out: Record<string, any> = { ...row };
    for (const f of NUMBER_FIELDS) {
        if (f in out) out[f] = maskLast4(out[f]);
    }
    const mayCheckDocuments = !!caps?.has('employees:manage');
    out.hasAadhaarDoc = !!row.aadhaarDocUrl;
    out.hasPanDoc = !!row.panDocUrl;
    if (!mayCheckDocuments) {
        for (const f of DOCUMENT_FIELDS) delete out[f];
    }
    return out as T;
}
