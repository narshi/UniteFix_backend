import axios from 'axios';
import { db } from '../db';
import { employees, users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import logger from '../lib/logger';

export class RazorpayXService {
    private static getAuthHeader() {
        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        
        if (!keyId || !keySecret) {
            throw new Error('Razorpay keys not found in environment');
        }
        
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        return `Basic ${auth}`;
    }

    private static getApiClient() {
        return axios.create({
            baseURL: 'https://api.razorpay.com/v1',
            headers: {
                'Authorization': this.getAuthHeader(),
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Creates a Contact in RazorpayX
     */
    static async createContact(name: string, email: string, contact: string, referenceId: string): Promise<string> {
        try {
            const api = this.getApiClient();
            const response = await api.post('/contacts', {
                name,
                email,
                contact,
                type: 'employee',
                reference_id: referenceId
            });
            return response.data.id;
        } catch (error: any) {
            logger.error(`Failed to create Razorpay Contact: ${error?.response?.data?.error?.description || error.message}`);
            throw new Error(`Razorpay Contact Error: ${error?.response?.data?.error?.description || error.message}`);
        }
    }

    /**
     * Creates a Fund Account in RazorpayX
     */
    static async createFundAccount(contactId: string, accountType: 'bank_account' | 'vpa', details: any): Promise<string> {
        try {
            const api = this.getApiClient();
            const response = await api.post('/fund_accounts', {
                contact_id: contactId,
                account_type: accountType,
                [accountType]: details
            });
            return response.data.id;
        } catch (error: any) {
            logger.error(`Failed to create Razorpay Fund Account: ${error?.response?.data?.error?.description || error.message}`);
            throw new Error(`Razorpay Fund Account Error: ${error?.response?.data?.error?.description || error.message}`);
        }
    }

    /**
     * Creates a Payout in RazorpayX
     */
    /**
     * @param idempotencyKey Sent as X-Payout-Idempotency. RazorpayX returns the
     *   ORIGINAL payout for a repeated key rather than disbursing again, so a
     *   retried or duplicated approval cannot pay a partner twice.
     *   Note: `reference_id` is NOT an idempotency key — it is only a label.
     */
    static async createPayout(
        fundAccountId: string,
        amountInRupees: number,
        referenceId: string,
        purpose: string = 'payout',
        idempotencyKey?: string,
    ): Promise<any> {
        // Payouts are debited from the RazorpayX current account. Without this the
        // request goes out with account_number: undefined and Razorpay rejects it
        // with a confusing error — fail early with a clear, actionable message.
        const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER || process.env.RAZORPAY_X_ACCOUNT_NUMBER;
        if (!accountNumber) {
            throw new Error(
                'RazorpayX is not configured: set RAZORPAYX_ACCOUNT_NUMBER (your RazorpayX current account number, usually starts with 2323) in the server environment.'
            );
        }

        try {
            const api = this.getApiClient();
            const response = await api.post('/payouts', {
                account_number: accountNumber,
                fund_account_id: fundAccountId,
                amount: Math.round(amountInRupees * 100), // Amount in paise
                currency: 'INR',
                mode: 'IMPS',
                purpose,
                queue_if_low_balance: true,
                reference_id: referenceId,
                narration: 'UniteFix Wallet Withdrawal'
            }, idempotencyKey ? { headers: { 'X-Payout-Idempotency': idempotencyKey } } : undefined);
            return response.data;
        } catch (error: any) {
            const description = error?.response?.data?.error?.description || error.message;
            const status = error?.response?.status;

            // A 404 "URL was not found" on /payouts does not mean a bad code path —
            // it means the Razorpay account cannot reach the Payouts API at all.
            // Almost always: RazorpayX (Payouts) is not activated for these keys, or
            // test-mode keys are being used against the live payouts endpoint. Give
            // the admin the real cause instead of the raw "URL not found".
            const urlNotFound = status === 404 || /url was not found/i.test(String(description));
            if (urlNotFound) {
                logger.error(`RazorpayX payouts unreachable (404). Keys likely lack RazorpayX access. Raw: ${description}`);
                throw new Error(
                    'RazorpayX Payouts is not enabled for this Razorpay account (or test-mode keys are being used). ' +
                    'Activate RazorpayX in the Razorpay dashboard and use that account\'s API keys to send payouts.'
                );
            }

            logger.error(`Failed to create Razorpay Payout: ${description}`);
            throw new Error(`Razorpay Payout Error: ${description}`);
        }
    }
    
    /**
     * Fetch a payout's current state directly from RazorpayX.
     *
     * Payout completion otherwise depends entirely on the payout.processed
     * webhook. While that webhook fails, every successful payout stays stuck at
     * 'processing' and — worse — a reversed payout never returns the money to the
     * partner's wallet. Unlike the QR flow there is no client in the loop, so this
     * is the only available fallback.
     */
    static async fetchPayoutStatus(payoutId: string): Promise<{
        status: string;
        failureReason?: string;
    }> {
        try {
            const api = this.getApiClient();
            const { data } = await api.get(`/payouts/${payoutId}`);
            return { status: data.status, failureReason: data.failure_reason };
        } catch (error: any) {
            const description = error?.response?.data?.error?.description || error.message;
            logger.error(`Failed to fetch payout ${payoutId}: ${description}`);
            throw new Error(`Razorpay Payout Fetch Error: ${description}`);
        }
    }

    /**
     * End-to-end sync for an employee to ensure they have a Contact and Fund Account
     */
    static async syncEmployeeForPayouts(employee: typeof employees.$inferSelect): Promise<string> {
        let contactId = employee.razorpayContactId;
        let fundAccountId = employee.razorpayFundAccountId;
        let updated = false;

        // 1. Ensure Contact
        if (!contactId) {
            // Fetch User for phone/email
            const [user] = await db.select().from(users).where(eq(users.id, employee.userId)).limit(1);
            if (!user) throw new Error("Could not find base user for employee");

            contactId = await this.createContact(
                employee.fullName || user.username || 'Service Provider',
                user.email || 'partner@unitefix.com',
                user.phone || '9999999999',
                `EMP-${employee.id}`
            );
            updated = true;
        }

        // 2. Ensure Fund Account
        if (!fundAccountId && contactId) {
            if (employee.bankAccountNumber && employee.bankIfsc) {
                fundAccountId = await this.createFundAccount(contactId, 'bank_account', {
                    name: employee.bankName || employee.fullName || 'Service Provider',
                    ifsc: employee.bankIfsc,
                    account_number: employee.bankAccountNumber
                });
            } else if (employee.upiId) {
                fundAccountId = await this.createFundAccount(contactId, 'vpa', {
                    address: employee.upiId
                });
            } else {
                throw new Error("No Bank Account or UPI ID found for the employee.");
            }
            updated = true;
        }

        if (updated) {
            await db.update(employees).set({
                razorpayContactId: contactId,
                razorpayFundAccountId: fundAccountId
            }).where(eq(employees.id, employee.id));
        }

        if (!fundAccountId) throw new Error("Could not determine Fund Account ID");

        return fundAccountId;
    }
}
