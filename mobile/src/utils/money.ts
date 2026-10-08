/**
 * Rupee amounts as people read them: ₹1,23,456 — Indian digit grouping, and
 * paise only when there are any (₹1,250 not ₹1,250.00; ₹1,250.50 stays).
 */
export function inr(value: number | string | null | undefined, opts: { paise?: 'auto' | 'always' } = {}): string {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return '₹0';
    const abs = Math.abs(n);
    const showPaise = opts.paise === 'always' || Math.round(abs * 100) % 100 !== 0;
    const s = abs.toLocaleString('en-IN', { minimumFractionDigits: showPaise ? 2 : 0, maximumFractionDigits: 2 });
    return `${n < 0 ? '−' : ''}₹${s}`;
}
