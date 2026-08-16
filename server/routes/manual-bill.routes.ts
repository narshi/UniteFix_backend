/**
 * Manual bills — counter sales for in-house visits.
 *
 * A walk-in customer brings a device to the shop: no booking, no technician
 * assignment, no OTP, no geofence, no wallet credit. Deliberately decoupled from
 * the booking state machine — those gates exist to protect an on-site job, and
 * none of them mean anything across a counter.
 *
 * What it DOES share with every other invoice: the `invoices` table, the
 * fiscal-year numbering (UF/25-26/0001 via storage.createInvoice), the GST rate
 * from platform config, and the PDF pipeline. Sharing those is the point — a
 * counter sale must not become a second, divergent billing path.
 *
 *   POST /api/admin/manual-bills            create + issue an invoice
 *   GET  /api/admin/manual-bills            list past manual bills
 *   GET  /api/admin/manual-bills/customers  customer typeahead
 */

import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { eq, desc, or, ilike, and, count, isNull, sql } from "drizzle-orm";
import { manualBills, invoices, users, type ManualBillItem } from "@shared/schema";
import { storage } from "../storage";
import { configService } from "../services/config.service";
import { recordAudit } from "../lib/audit";
import {
    parseListParams, buildOrderBy, dateRangeConditions, combine, paginationMeta,
} from "../lib/list-query";
import logger from "../lib/logger";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Indian phone, stored the same way the Truecaller auth flow stores it. */
function normalisePhone(input: string): string {
    return input.replace(/[^\d]/g, "").slice(-10);
}

interface ParsedItem extends ManualBillItem { }

/** Validate and normalise the line items. Throws with a caller-facing message. */
function parseItems(raw: unknown): ParsedItem[] {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error("At least one line item is required");
    }
    if (raw.length > 50) {
        throw new Error("A bill cannot have more than 50 line items");
    }

    return raw.map((row: any, i: number) => {
        const description = typeof row?.description === "string" ? row.description.trim() : "";
        const quantity = Number(row?.quantity);
        const unitPrice = Number(row?.unitPrice);

        if (!description) throw new Error(`Line ${i + 1}: description is required`);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Line ${i + 1}: quantity must be greater than zero`);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`Line ${i + 1}: price cannot be negative`);

        return {
            description: description.slice(0, 200),
            quantity,
            unitPrice: round2(unitPrice),
            total: round2(quantity * unitPrice),
        };
    });
}

export function registerManualBillRoutes(app: Express) {

    /**
     * GET /api/admin/manual-bills/customers?q=
     * Typeahead for the customer field. Registered before the /:id-style routes
     * so "customers" is never read as an id.
     */
    app.get("/api/admin/manual-bills/customers", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
            if (q.length < 2) return res.json({ success: true, data: [] });

            const term = `%${q.toLowerCase()}%`;
            const rows = await db
                .select({ id: users.id, username: users.username, phone: users.phone, email: users.email })
                .from(users)
                .where(and(
                    eq(users.role, "user" as any),
                    isNull(users.deletedAt),
                    or(ilike(users.username, term), ilike(users.phone, term), ilike(users.email, term)),
                ))
                .limit(10);

            res.json({ success: true, data: rows });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/admin/manual-bills
     * Body: { userId? , customerName?, customerPhone?, items[], notes?, discount? }
     *
     * Either an existing userId, or a name + phone for a walk-in. `invoices.user_id`
     * is NOT NULL, so a walk-in gets a real users row — which also means they can
     * later sign in with that phone and find this invoice in the app.
     */
    app.post("/api/admin/manual-bills", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const adminId = (req as any).admin?.userId ?? null;
            const { userId, customerName, customerPhone, notes } = req.body ?? {};

            let items: ParsedItem[];
            try {
                items = parseItems(req.body?.items);
            } catch (e: any) {
                return res.status(400).json({ success: false, message: e.message });
            }

            const discount = round2(Math.max(0, Number(req.body?.discount) || 0));

            // ── Resolve the customer ──────────────────────────────────────
            let customerId: number | null = null;

            if (userId) {
                const existing = await storage.getUser(Number(userId));
                if (!existing) {
                    return res.status(404).json({ success: false, message: "Customer not found" });
                }
                customerId = existing.id;
            } else {
                const name = typeof customerName === "string" ? customerName.trim() : "";
                const phone = typeof customerPhone === "string" ? normalisePhone(customerPhone) : "";

                if (!name || phone.length !== 10) {
                    return res.status(400).json({
                        success: false,
                        message: "Select an existing customer, or provide a name and a 10-digit phone number.",
                    });
                }

                // Reuse the account if that phone is already known — a walk-in is
                // often an existing app customer, and a duplicate users row would
                // split their invoice history in two.
                const existing = await storage.getUserByPhone(phone);
                if (existing) {
                    customerId = existing.id;
                } else {
                    const created = await storage.createUser({
                        username: name,
                        phone,
                        role: "user",
                        isActive: true,
                    } as any);
                    customerId = created.id;
                    logger.info(`[MANUAL_BILL] Created walk-in customer ${name} (${phone}) as users.id=${created.id}`);
                }
            }

            // ── Money ─────────────────────────────────────────────────────
            // GST comes from the same config key BillingEngine reads, so a rate
            // change can never leave counter sales on a stale number.
            const gstPercentStr = await configService.get<string>("BUSINESS_CONFIG.GST_PERCENTAGE");
            const gstPercent = parseFloat(gstPercentStr || "18");

            const subtotal = round2(items.reduce((sum, i) => sum + i.total, 0));
            const taxable = round2(Math.max(0, subtotal - discount));
            const gstTotal = round2((taxable * gstPercent) / 100);
            // Intrastate supply: GST splits evenly into CGST + SGST. Halving the
            // total and rounding each half separately can drift a paisa, so the
            // second half is derived by subtraction.
            const cgst = round2(gstTotal / 2);
            const sgst = round2(gstTotal - cgst);
            const total = round2(taxable + gstTotal);

            // ── Issue ─────────────────────────────────────────────────────
            // storage.createInvoice allocates the UF/25-26/NNNN id with retry.
            const invoice = await storage.createInvoice({
                userId: customerId!,
                serviceRequestId: null,
                productOrderId: null,
                providerId: null,
                baseAmount: String(taxable),
                cgst: String(cgst),
                sgst: String(sgst),
                discount: String(discount),
                totalAmount: String(total),
            } as any);

            const [bill] = await db
                .insert(manualBills)
                .values({
                    invoiceId: invoice.id,
                    items,
                    notes: typeof notes === "string" ? notes.trim().slice(0, 1000) : null,
                    createdBy: adminId,
                })
                .returning();

            logger.info(`[MANUAL_BILL] ${invoice.invoiceId} issued for users.id=${customerId} — ₹${total} by admin ${adminId}`);

            await recordAudit({
                entityType: "payment",
                entityId: invoice.id,
                action: "manual_bill_created",
                changedBy: adminId,
                metadata: {
                    invoiceId: invoice.invoiceId,
                    customerId,
                    subtotal, discount, gstPercent, total,
                    lineCount: items.length,
                },
            });

            res.status(201).json({
                success: true,
                message: `Invoice ${invoice.invoiceId} created.`,
                data: {
                    manualBillId: bill.id,
                    invoiceRowId: invoice.id,
                    invoiceId: invoice.invoiceId,
                    customerId,
                    items,
                    subtotal, discount, gstPercent, cgst, sgst, total,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/admin/invoices/:id/pdf
     * Any invoice by its row id — manual bill, booking or product order. The
     * existing PDF route is keyed on a service request, which a counter sale
     * does not have.
     */
    app.get("/api/admin/invoices/:id/pdf", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = parseInt(req.params.id);
            if (Number.isNaN(id)) {
                return res.status(400).json({ success: false, message: "Invalid invoice id" });
            }

            const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
            if (!invoice) {
                return res.status(404).json({ success: false, message: "Invoice not found" });
            }

            const { InvoiceGenerator } = await import("../services/invoice-generator");
            const pdf = await InvoiceGenerator.generatePDF(invoice.id);

            // The id contains slashes (UF/25-26/0001) — unusable in a filename.
            const safeName = invoice.invoiceId.replace(/[\/\\]/g, "-");
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=${safeName}.pdf`);
            res.send(pdf);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/admin/manual-bills
     * Standard admin list contract.
     */
    app.get("/api/admin/manual-bills", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const listOptions = {
                defaultSort: "createdAt",
                sortable: {
                    createdAt: manualBills.createdAt,
                    id: manualBills.id,
                    totalAmount: invoices.totalAmount,
                    invoiceId: invoices.invoiceId,
                },
            };
            const params = parseListParams(req.query, listOptions);

            const conditions: any[] = [];
            if (params.q) {
                const term = `%${params.q}%`;
                conditions.push(or(
                    ilike(invoices.invoiceId, term),
                    ilike(users.username, term),
                    ilike(users.phone, term),
                ));
            }
            conditions.push(...dateRangeConditions(params, manualBills.createdAt));
            const where = combine(conditions);

            const base = db
                .select({
                    id: manualBills.id,
                    invoiceRowId: invoices.id,
                    invoiceId: invoices.invoiceId,
                    items: manualBills.items,
                    notes: manualBills.notes,
                    createdAt: manualBills.createdAt,
                    customerName: users.username,
                    customerPhone: users.phone,
                    baseAmount: invoices.baseAmount,
                    cgst: invoices.cgst,
                    sgst: invoices.sgst,
                    discount: invoices.discount,
                    totalAmount: invoices.totalAmount,
                })
                .from(manualBills)
                .innerJoin(invoices, eq(invoices.id, manualBills.invoiceId))
                .leftJoin(users, eq(users.id, invoices.userId));

            const [{ total }] = await db
                .select({ total: count() })
                .from(manualBills)
                .innerJoin(invoices, eq(invoices.id, manualBills.invoiceId))
                .leftJoin(users, eq(users.id, invoices.userId))
                .where(where as any);

            const rows = await base
                .where(where as any)
                .orderBy(buildOrderBy(params, listOptions))
                .limit(params.limit)
                .offset(params.offset);

            res.json({ success: true, data: rows, pagination: paginationMeta(params, Number(total)) });
        } catch (error) {
            next(error);
        }
    });
}
