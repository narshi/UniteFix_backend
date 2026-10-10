/**
 * The go-live checklist: every key, account and setting the Partner Hub and
 * the platform need before real money and real customers, checked live.
 * Reports presence only — never a secret's value.
 */

import bcrypt from 'bcrypt';
import { db } from '../db';
import { and, eq, isNull, isNotNull, notInArray, or, sql } from 'drizzle-orm';
import { adminUsers, spareParts, products, businessPartners } from '@shared/schema';
import { checkGstin } from '@shared/hub';
import { configService } from './config.service';
import { publicAppUrl } from '../lib/public-url';
import { cashfreeLive, cashfreeKeys, cashfreePublicKey, CASHFREE_VARS } from '../lib/cashfree-env';
import { loadSellerDetails } from './invoice-generator';

export type Check = { key: string; area: string; label: string; status: 'ok' | 'action' | 'info'; detail: string; fix?: string };

const has = (...keys: string[]) => keys.every(k => !!process.env[k]?.trim() && !/x{5,}|your[_-]|changeme|placeholder/i.test(process.env[k]!));
const PLACEHOLDER_GSTIN = '29ABCDE1234F1Z5';
const WEAK = ['admin123', 'admin', 'password', 'password123', '12345678', 'admin@123', 'unitefix', 'unitefix123'];

export class GoLiveService {

    static async run(): Promise<{ checks: Check[]; summary: { ok: number; action: number; info: number } }> {
        const c: Check[] = [];
        const add = (x: Check) => c.push(x);

        // ── Tax identity ──────────────────────────────────────────────────
        const seller = await loadSellerDetails();
        const g = checkGstin(seller.gstin);
        add(seller.gstin === PLACEHOLDER_GSTIN || !g.valid
            ? { key: 'gstin', area: 'Tax', label: 'UniteFix GSTIN on invoices', status: 'action', detail: seller.gstin === PLACEHOLDER_GSTIN ? 'Still the sample GSTIN — every UniteFix invoice and the store\'s e-commerce operator GSTIN would be wrong.' : 'The GSTIN does not pass the checksum.', fix: 'Settings → Business config → COMPANY_GSTIN, COMPANY_NAME, COMPANY_ADDRESS.' }
            : { key: 'gstin', area: 'Tax', label: 'UniteFix GSTIN on invoices', status: 'ok', detail: `${seller.gstin} (${seller.name})` });
        const [noHsn] = await db.select({ n: sql<number>`count(*)::int` }).from(spareParts).where(and(eq(spareParts.isActive, true), or(isNull(spareParts.hsnCode), eq(spareParts.hsnCode, ''))));
        add({ key: 'parts_hsn', area: 'Tax', label: 'HSN on every spare part', status: (noHsn?.n ?? 0) ? 'action' : 'ok', detail: (noHsn?.n ?? 0) ? `${noHsn.n} active part(s) have no HSN — their B2B invoices would go out without one.` : 'Every active part has an HSN.', fix: 'Spare parts → edit each part without HSN.' });
        const [noHsnStore] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(and(isNotNull(products.sellerPartnerId), eq(products.listingStatus, 'live'), or(isNull(products.hsnCode), eq(products.hsnCode, ''))));
        if ((noHsnStore?.n ?? 0) > 0) add({ key: 'store_hsn', area: 'Tax', label: 'HSN on live store listings', status: 'action', detail: `${noHsnStore.n} live partner listing(s) without HSN.`, fix: 'Marketplace → pause them until the seller adds it.' });
        add(has('EINVOICE_PROVIDER', 'EINVOICE_CLIENT_ID', 'EINVOICE_CLIENT_SECRET')
            ? { key: 'einvoice', area: 'Tax', label: 'E-invoice (IRN) provider', status: 'ok', detail: `Provider: ${process.env.EINVOICE_PROVIDER}.` }
            : { key: 'einvoice', area: 'Tax', label: 'E-invoice (IRN) provider', status: 'info', detail: 'Not connected. Partners above ₹5 crore record IRNs by hand from the IRP portal; UniteFix needs it only if its own turnover crosses ₹5 crore.', fix: 'EINVOICE_PROVIDER, EINVOICE_CLIENT_ID, EINVOICE_CLIENT_SECRET (a GSP such as ClearTax, Masters India).' });

        // ── Money ─────────────────────────────────────────────────────────
        const rzpKey = process.env.RAZORPAY_KEY_ID ?? '';
        add(!has('RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET')
            ? { key: 'razorpay', area: 'Money', label: 'Razorpay payments', status: 'action', detail: 'No keys — bookings are marked paid without payment (development behaviour), store checkout and pay links cannot take money.', fix: 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET from the Razorpay dashboard (live mode).' }
            : rzpKey.startsWith('rzp_test_')
                ? { key: 'razorpay', area: 'Money', label: 'Razorpay payments', status: 'action', detail: 'Test-mode keys: no real money moves.', fix: 'Swap in the live-mode key pair.' }
                : { key: 'razorpay', area: 'Money', label: 'Razorpay payments', status: 'ok', detail: 'Live keys present.' });
        add(has('RAZORPAY_WEBHOOK_SECRET')
            ? { key: 'razorpay_webhook', area: 'Money', label: 'Razorpay webhook', status: 'ok', detail: 'Secret present. Captures settle even if the customer closes the app.' }
            : { key: 'razorpay_webhook', area: 'Money', label: 'Razorpay webhook', status: 'action', detail: 'No webhook secret — a payment whose page was closed early is never recorded (store orders, pay links, B2B, recharges).', fix: 'Razorpay → Webhooks → payment.captured and payment.failed to /api/payments/webhook; put the secret in RAZORPAY_WEBHOOK_SECRET.' });
        {
            const live = cashfreeLive();
            const envNote = `CASHFREE_ENVIRONMENT is "${process.env.CASHFREE_ENVIRONMENT || 'unset'}" — calls go to Cashfree's test system.`;
            const P = CASHFREE_VARS;
            const payLabel = 'Cashfree Payouts (withdrawals, settlements, refunds)';
            add(!cashfreeKeys()
                ? { key: 'cashfree_payouts', area: 'Money', label: payLabel, status: 'action', detail: 'Not connected — withdrawals and settlement runs can only be paid by hand (bank transfer + reference).', fix: `${P.id} and ${P.secret}: the Payouts keys (not Payment Gateway keys).` }
                : !live
                    ? { key: 'cashfree_payouts', area: 'Money', label: payLabel, status: 'action', detail: `Payouts keys present, but ${envNote}`, fix: 'CASHFREE_ENVIRONMENT=PROD with the live Payouts keys.' }
                    : !cashfreePublicKey()
                        ? { key: 'cashfree_payouts', area: 'Money', label: payLabel, status: 'action', detail: 'Live Payouts keys present, but no public key. Cashfree refuses live calls from an address it has not whitelisted, and Render’s outgoing address is not fixed.', fix: `Cashfree Payouts → Developers → Two-Factor Authentication → Public Key → paste it into ${P.key}. Then "Test connection".` }
                        : { key: 'cashfree_payouts', area: 'Money', label: payLabel, status: 'ok', detail: 'Live Payouts keys and public key present. Use "Test connection" to confirm Cashfree accepts them.' });
        }
        add(has('CASHFREE_VERIFICATION_CLIENT_ID', 'CASHFREE_VERIFICATION_CLIENT_SECRET')
            ? { key: 'cashfree_verify', area: 'Money', label: 'Bank / PAN / GSTIN verification', status: 'ok', detail: 'Cashfree Verification keys present.' }
            : { key: 'cashfree_verify', area: 'Money', label: 'Bank / PAN / GSTIN verification', status: 'action', detail: 'Not connected — partner bank accounts and GSTINs are checked by format only, and staff verify by hand.', fix: 'CASHFREE_VERIFICATION_CLIENT_ID / _SECRET (Cashfree Secure ID).' });
        const fee = async (k: string, d: number) => Number(await configService.get<number>(`BUSINESS_CONFIG.${k}`, d));
        const [pro, coll, gw, courier] = await Promise.all([fee('HUB_PRO_FEE_PAISE', 49900), fee('PARTNER_COLLECTION_FEE_PERCENT', 2), fee('MARKETPLACE_GATEWAY_FEE_PERCENT', 2), fee('MARKETPLACE_COURIER_RATE_PER_500G_RUPEES', 0)]);
        add({ key: 'fees', area: 'Money', label: 'Partner fees in force', status: 'info', detail: `Hub Pro ₹${pro / 100}/month + GST · pay-link collection ${coll}% · store payment collection ${gw}% · courier ${courier ? `₹${courier} per 500 g` : 'not charged'}.`, fix: 'Settings → Business config.' });

        // ── Messages ──────────────────────────────────────────────────────
        add(has('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS')
            ? { key: 'smtp', area: 'Messages', label: 'Email', status: 'ok', detail: `SMTP via ${process.env.SMTP_HOST}. If mail stops arriving, check the mailbox provider has not put the account on hold for unusual activity.` }
            : { key: 'smtp', area: 'Messages', label: 'Email', status: 'action', detail: 'No SMTP — partner alerts, invites and receipts by email are not sent.', fix: 'SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (a transactional sender such as Amazon SES or Zoho ZeptoMail suits volume better than a mailbox).' });
        add(has('MSG91_API_KEY') || has('TWILIO_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE')
            ? { key: 'sms', area: 'Messages', label: 'SMS', status: 'ok', detail: has('MSG91_API_KEY') ? 'MSG91.' : 'Twilio.' }
            : { key: 'sms', area: 'Messages', label: 'SMS', status: 'action', detail: 'No SMS provider — OTP and urgent partner alerts by text are not sent.', fix: 'MSG91_API_KEY + MSG91_FLOW_ID (DLT-registered templates), or Twilio.' });
        add(has('FCM_SERVICE_ACCOUNT_JSON') || has('GOOGLE_APPLICATION_CREDENTIALS')
            ? { key: 'push', area: 'Messages', label: 'App push notifications', status: 'ok', detail: 'Firebase credential present.' }
            : { key: 'push', area: 'Messages', label: 'App push notifications', status: 'info', detail: 'No explicit Firebase credential — works only where the host supplies Google credentials (Cloud Run).', fix: 'FCM_SERVICE_ACCOUNT_JSON.' });
        {
            const url = publicAppUrl();
            add(!url
                ? { key: 'links', area: 'Messages', label: 'Web address for links', status: 'action', detail: 'No PUBLIC_APP_URL — links in alert emails are relative and do not open.', fix: 'PUBLIC_APP_URL=https://app.unitefix.com and ADMIN_APP_URL=https://admin.unitefix.com, once both domains are verified on Render.' }
                : /onrender.com/i.test(url)
                    ? { key: 'links', area: 'Messages', label: 'Web address for links', status: 'action', detail: `Links point to ${url} — the Render address, not UniteFix's own domain.`, fix: 'Add app.unitefix.com on Render, then PUBLIC_APP_URL=https://app.unitefix.com.' }
                    : { key: 'links', area: 'Messages', label: 'Web address for links', status: 'ok', detail: `Links point to ${url}; pages opened on the Render address move there.` });
        }

        // ── Operations ────────────────────────────────────────────────────
        const live = process.env.DELHIVERY_MODE === 'live' && has('DELHIVERY_API_KEY');
        // Sellers: active partners with at least one store listing.
        const sellers = await db.selectDistinct({ id: businessPartners.id, pickup: businessPartners.delhiveryPickupName }).from(businessPartners)
            .innerJoin(products, eq(products.sellerPartnerId, businessPartners.id)).where(eq(businessPartners.status, 'active'));
        const noPickup = sellers.filter(s => !s.pickup).length;
        add(!live
            ? { key: 'courier', area: 'Operations', label: 'Courier (Delhivery) for store orders', status: 'info', detail: 'Test mode — "Book courier" makes test waybills. Sellers can ship with their own courier meanwhile.', fix: 'DELHIVERY_MODE=live and DELHIVERY_API_KEY; register each seller\'s pickup address in the Delhivery panel and enter its name on the partner (Partners → Store seller).' }
            : { key: 'courier', area: 'Operations', label: 'Courier (Delhivery) for store orders', status: noPickup ? 'action' : 'ok', detail: noPickup ? `${noPickup} active seller(s) without a registered pickup point.` : 'Live; every seller has a pickup point.' });
        add(has('CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET')
            ? { key: 'uploads', area: 'Operations', label: 'File uploads', status: 'ok', detail: 'Cloudinary connected.' }
            : { key: 'uploads', area: 'Operations', label: 'File uploads', status: 'action', detail: 'No Cloudinary — KYC documents, listing photos, technician papers and newspaper editions cannot be uploaded.', fix: 'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.' });

        // ── Security ──────────────────────────────────────────────────────
        add((process.env.JWT_SECRET ?? '').length >= 32
            ? { key: 'jwt', area: 'Security', label: 'Sign-in token secret', status: 'ok', detail: 'Long enough.' }
            : { key: 'jwt', area: 'Security', label: 'Sign-in token secret', status: 'action', detail: 'JWT_SECRET is short or missing — sign-in tokens could be forged.', fix: 'A random value of 32+ characters; everyone signs in again after it changes.' });
        const staff = await db.select({ id: adminUsers.id, email: adminUsers.email, password: adminUsers.password }).from(adminUsers)
            .where(and(eq(adminUsers.isActive, true), notInArray(adminUsers.role, ['partner', 'operator']))).limit(50);
        let weak = 0;
        for (const s of staff) {
            for (const w of WEAK) { if (await bcrypt.compare(w, s.password).catch(() => false)) { weak++; break; } }
        }
        add(weak
            ? { key: 'weak_passwords', area: 'Security', label: 'Staff passwords', status: 'action', detail: `${weak} staff account(s) still use a well-known password (such as admin123).`, fix: 'Each of them: sign in and change it from the banner at the top of the admin.' }
            : { key: 'weak_passwords', area: 'Security', label: 'Staff passwords', status: 'ok', detail: `${staff.length} staff account(s) checked; none use a well-known password.` });

        const summary = { ok: c.filter(x => x.status === 'ok').length, action: c.filter(x => x.status === 'action').length, info: c.filter(x => x.status === 'info').length };
        return { checks: c, summary };
    }
}
