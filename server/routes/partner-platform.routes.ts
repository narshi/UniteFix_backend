/**
 * Partner platform: identity checks and payouts.
 *
 *   Staff    /api/admin/hub/partners/:id/checks*      run a Cashfree check, record one by hand
 *            /api/admin/hub/partners/:id/payouts*      settings, overview, pay now
 *            /api/admin/hub/payouts/queue               requests and drafts waiting for approval
 *   Partner  /api/hub/payouts                          what is owed, schedule, recent payouts
 *            /api/hub/payouts/request                   ask to be paid now
 *
 * Money and bank decisions are super-admin only (as for settlements);
 * running and recording checks needs the partners area.
 */

import type { Express } from 'express';
import { z } from 'zod';
import { authenticateAdmin, requireSuperAdmin } from '../middleware/auth.middleware';
import { authenticateHub, hubCan, hubError, HubRequest } from '../middleware/hub-auth';
import { HubError } from '../services/partner-hub.service';
import { PartnerVerification } from '../services/partner-verification.service';
import { PartnerPayouts, PAYOUT_SCHEDULES } from '../services/partner-payouts.service';
import { CHECK_CODES, type CheckCode } from '@shared/hub';
import { SYSTEM_ROLES } from '@shared/capabilities';
import { recordAudit } from '../lib/audit';

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'BAD_INPUT');
    return r.data;
}
const adminOf = (req: any) => req.admin as { userId: number; role?: string };
const checkCode = z.enum(CHECK_CODES as [CheckCode, ...CheckCode[]]);

export function registerPartnerPlatformRoutes(app: Express) {

    // ── Staff: identity checks ───────────────────────────────────────────

    app.get('/api/admin/hub/partners/:id/checks', authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await PartnerVerification.summary(Number(req.params.id)) }); } catch (e) { hubError(e, res, next); }
    });

    /** Run one Cashfree check, or every required automatic one when no check is named. */
    app.post('/api/admin/hub/partners/:id/checks/run', authenticateAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ check: checkCode.optional(), dlNumber: z.string().max(30).optional(), dob: z.string().max(10).optional(), rcNumber: z.string().max(20).optional() }), req.body ?? {});
            const bpId = Number(req.params.id), adminId = adminOf(req).userId;
            if (!b.check) {
                const results = await PartnerVerification.runAll(bpId, adminId);
                return res.json({ success: true, message: results.length ? `Ran ${results.length} check(s).` : 'Nothing to run: every automatic check has passed or has no number to check.', data: { results, summary: await PartnerVerification.summary(bpId) } });
            }
            const c = await PartnerVerification.runAutomatic(bpId, b.check, { adminId, dlNumber: b.dlNumber, dob: b.dob, rcNumber: b.rcNumber });
            await recordAudit({ entityType: 'business_partner', entityId: bpId, action: `check_${b.check}_${c.status}_cashfree`, changedBy: adminId, metadata: { reference: c.reference } });
            const words: Record<string, string> = { verified: 'Verified', failed: 'Not verified', needs_review: 'Needs your review', manual_required: 'Check by hand' };
            res.json({ success: true, message: `${words[c.status] ?? c.status}${c.note ? `: ${c.note}` : '.'}`, data: { check: c, summary: await PartnerVerification.summary(bpId) } });
        } catch (e) { hubError(e, res, next); }
    });

    /** Record a check done by hand. A bank account (where payouts go) needs a super admin. */
    app.post('/api/admin/hub/partners/:id/checks/manual', authenticateAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({
                check: checkCode, status: z.enum(['verified', 'failed']), note: z.string().trim().min(5).max(300),
                documentId: z.number().int().positive().nullish(), validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), subject: z.string().trim().max(40).nullish(),
            }), req.body);
            const admin = adminOf(req);
            if (b.check === 'bank' && admin.role !== SYSTEM_ROLES.SUPER_ADMIN) throw new HubError('Only a super admin can verify a bank account by hand: payouts go there.', 'SUPER_ADMIN_ONLY', 403);
            const bpId = Number(req.params.id);
            const c = await PartnerVerification.recordManual(admin.userId, bpId, b.check, b);
            res.json({ success: true, message: `Recorded: ${b.check} ${b.status}.`, data: { check: c, summary: await PartnerVerification.summary(bpId) } });
        } catch (e) { hubError(e, res, next); }
    });

    // ── Staff: payouts ───────────────────────────────────────────────────

    app.get('/api/admin/hub/partners/:id/payouts', authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await PartnerPayouts.overview(Number(req.params.id)) }); } catch (e) { hubError(e, res, next); }
    });
    app.put('/api/admin/hub/partners/:id/payout-settings', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({
                schedule: z.enum(PAYOUT_SCHEDULES), autoLimitRupees: z.number().min(0).max(1_000_000).nullable(), minimumRupees: z.number().min(0).max(100_000),
                onHold: z.boolean(), holdReason: z.string().trim().max(300).nullish(),
            }), req.body);
            const s = await PartnerPayouts.saveSettings(adminOf(req).userId, Number(req.params.id), b);
            res.json({ success: true, message: 'Payout settings saved.', data: s });
        } catch (e) { hubError(e, res, next); }
    });
    /** "Please pay me now" on the phone, or approving a request or a draft: draft (or reuse the draft) and pay. */
    app.post('/api/admin/hub/partners/:id/payouts/pay-now', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ method: z.enum(['cashfree', 'manual']), reference: z.string().trim().max(60).optional() }), req.body);
            const how = b.method === 'manual' ? { method: 'manual' as const, reference: b.reference ?? '' } : { method: 'cashfree' as const };
            const run = await PartnerPayouts.pay(adminOf(req).userId, Number(req.params.id), how, 'staff');
            res.json({ success: true, message: run.status === 'paid' ? `Paid ₹${(run.payoutPaise / 100).toLocaleString('en-IN')}.` : 'Sent to Cashfree; it is on its way to the bank.', data: run });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/admin/hub/payouts/queue', authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: await PartnerPayouts.queue() }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/hub/payouts/requests/:id/decline', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ note: z.string().trim().min(3).max(300) }), req.body);
            await PartnerPayouts.decline(adminOf(req).userId, Number(req.params.id), b.note);
            res.json({ success: true, message: 'Request declined; the partner is told why.' });
        } catch (e) { hubError(e, res, next); }
    });

    // ── Partner ──────────────────────────────────────────────────────────

    const active = authenticateHub();
    app.get('/api/hub/payouts', active, hubCan('money:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await PartnerPayouts.overview((req as HubRequest).hub!.businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/payouts/request', active, hubCan('money:view'), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const b = parse(z.object({ note: z.string().trim().max(300).optional() }), req.body ?? {});
            const r = await PartnerPayouts.request(ctx.businessPartnerId, ctx.adminUserId ?? null, b.note);
            res.status(201).json({
                success: true,
                message: r.paid ? `₹${r.amount?.toLocaleString('en-IN')} is on its way to your bank.` : `Request sent. UniteFix will pay ₹${r.amount?.toLocaleString('en-IN')} soon.`,
                data: r,
            });
        } catch (e) { hubError(e, res, next); }
    });
}
