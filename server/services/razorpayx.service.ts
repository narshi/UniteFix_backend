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
        try {
            const api = this.getApiClient();
            const response = await api.post('/payouts', {
                account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER || process.env.RAZORPAY_X_ACCOUNT_NUMBER, // The RazorpayX Current Account Number (Usually starts with 2323)
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
            logger.error(`Failed to create Razorpay Payout: ${error?.response?.data?.error?.description || error.message}`);
            throw new Error(`Razorpay Payout Error: ${error?.response?.data?.error?.description || error.message}`);
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
