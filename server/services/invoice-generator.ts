import PDFDocument from "pdfkit";
import { db } from "../db";
import { invoices, serviceRequests, users, serviceCharges, productOrders, employees } from "@shared/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { configService } from "./config.service";

// Define strict types for invoice data
interface InvoiceData {
    invoiceId: string;
    date: Date;
    customerName: string;
    customerAddress?: string;
    providerName?: string;
    items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
    subtotal: number;
    cgst: number;
    sgst: number;
    otherCharges: number;
    otherChargesLabel: string;
    otherChargesNote: string;
    total: number;
    advancePaid: number;
    status: string;
    seller: SellerDetails;
}

/** Issuer block on the invoice — edited from the admin Settings page. */
interface SellerDetails {
    name: string;
    address: string;
    gstin: string;
    placeOfSupply: string;
}

const SELLER_DEFAULTS: SellerDetails = {
    name: "UniteFix Solutions Pvt Ltd",
    address: "Yellapur, Uttara Kannada, Karnataka - 581359",
    gstin: "29ABCDE1234F1Z5",
    placeOfSupply: "Yellapur, Karnataka",
};

async function loadSellerDetails(): Promise<SellerDetails> {
    const [name, address, gstin, placeOfSupply] = await Promise.all([
        configService.get<string>('BUSINESS_CONFIG.COMPANY_NAME', SELLER_DEFAULTS.name),
        configService.get<string>('BUSINESS_CONFIG.COMPANY_ADDRESS', SELLER_DEFAULTS.address),
        configService.get<string>('BUSINESS_CONFIG.COMPANY_GSTIN', SELLER_DEFAULTS.gstin),
        configService.get<string>('BUSINESS_CONFIG.PLACE_OF_SUPPLY', SELLER_DEFAULTS.placeOfSupply),
    ]);

    return {
        name: name?.trim() || SELLER_DEFAULTS.name,
        address: address?.trim() || SELLER_DEFAULTS.address,
        gstin: gstin?.trim() || SELLER_DEFAULTS.gstin,
        placeOfSupply: placeOfSupply?.trim() || SELLER_DEFAULTS.placeOfSupply,
    };
}

function round2(x: number): number {
    return Math.round(x * 100) / 100;
}

/**
 * PDFKit's built-in Helvetica only supports WinAnsi, which predates the
 * rupee sign — '₹' silently renders as a wrong glyph. Use 'Rs.' instead.
 */
function inr(amount: number): string {
    return `Rs. ${amount.toFixed(2)}`;
}

export class InvoiceGenerator {

    /**
     * Generates a PDF buffer for a given invoice ID
     */
    static async generatePDF(invoiceId: number): Promise<Buffer> {
        // 1. Fetch invoice and related data
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
        if (!invoice) throw new Error("Invoice not found");

        const [customer] = await db.select().from(users).where(eq(users.id, invoice.userId)).limit(1);
        const seller = await loadSellerDetails();

        let items: Array<{ description: string; quantity: number; unitPrice: number; total: number }> = [];
        let providerName = "UniteFix Service Partner";
        // Customer-approved parts added at request-payment time (v2). These are
        // a pass-through to the technician: they raise grossTotal but are NOT
        // folded into taxableAmount/cgst/sgst, so they need their own line or
        // the invoice does not add up to what the customer actually paid.
        let approvedPartsCost = 0;
        let approvedPartsNote = "";

        // If Service Invoice
        if (invoice.serviceRequestId) {
            const [service] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, invoice.serviceRequestId)).limit(1);
            if (service) {
                // Fetch provider name if assigned
                if (service.providerId) {
                    const [provider] = await db.select().from(employees).where(eq(employees.id, service.providerId)).limit(1);
                    if (provider) {
                        providerName = provider.fullName || "Service Partner";
                    }
                }

                // PREFER pricing snapshot for accurate billing breakdown
                const snapshot = service.pricingSnapshot as any;
                if (snapshot?.extraPartsCost > 0) {
                    approvedPartsCost = Number(snapshot.extraPartsCost);
                    approvedPartsNote = typeof snapshot.partsNote === 'string' ? snapshot.partsNote : "";
                }
                if (snapshot && snapshot.snapshotVersion && snapshot.subtotal) {
                    // Use exact frozen values from BillingEngine
                    if (snapshot.sparePartsCost > 0) {
                        items.push({
                            description: "Spare Parts",
                            quantity: 1,
                            unitPrice: Number(snapshot.sparePartsCost),
                            total: Number(snapshot.sparePartsCost)
                        });
                    }
                    if (snapshot.serviceLaborCost > 0) {
                        items.push({
                            // v2 fixed-price bookings have no separate labor entry —
                            // the catalog price's service value IS the charge.
                            description: snapshot.snapshotVersion === 2
                                ? "Service Charges (Fixed Price)"
                                : "Service Labor Charges",
                            quantity: 1,
                            unitPrice: Number(snapshot.serviceLaborCost),
                            total: Number(snapshot.serviceLaborCost)
                        });
                    }
                    if (snapshot.platformFee > 0) {
                        items.push({
                            description: `UniteFix Platform Fee (${snapshot.platformFeePercent || 15}%)`,
                            quantity: 1,
                            unitPrice: Number(snapshot.platformFee),
                            total: Number(snapshot.platformFee)
                        });
                    }
                } else {
                    // Legacy fallback: use service_charges table
                    const [charges] = await db.select().from(serviceCharges).where(eq(serviceCharges.serviceRequestId, service.id)).limit(1);

                    if (charges) {
                        if (Number(charges.serviceAmount) > 0) {
                            items.push({
                                description: "Service Labor Charges",
                                quantity: 1,
                                unitPrice: Number(charges.serviceAmount),
                                total: Number(charges.serviceAmount)
                            });
                        }
                        if (charges.partsUsed) {
                            try {
                                const parts = JSON.parse(charges.partsUsed);
                                if (Array.isArray(parts)) {
                                    parts.forEach((part: any) => {
                                        items.push({
                                            description: part.name || "Part",
                                            quantity: part.quantity || 1,
                                            unitPrice: Number(part.price || 0),
                                            total: Number(part.price || 0) * (part.quantity || 1)
                                        });
                                    });
                                } else {
                                    throw new Error("Not array");
                                }
                            } catch (e) {
                                items.push({
                                    description: `Parts: ${charges.partsUsed}`,
                                    quantity: 1,
                                    unitPrice: 0,
                                    total: 0
                                });
                            }
                        }
                    } else {
                        items.push({
                            description: `Service Charges: ${service.serviceType}`,
                            quantity: 1,
                            unitPrice: Number(invoice.baseAmount),
                            total: Number(invoice.baseAmount)
                        });
                    }
                }
            }
        }
        // If Product Order Invoice
        else if (invoice.productOrderId) {
            const [order] = await db.select().from(productOrders).where(eq(productOrders.id, invoice.productOrderId)).limit(1);
            if (order && order.products && Array.isArray(order.products)) {
                (order.products as any[]).forEach((prod: any) => {
                    items.push({
                        description: prod.name || "Product Item",
                        quantity: prod.quantity || 1,
                        unitPrice: Number(prod.price || 0),
                        total: Number(prod.price || 0) * (prod.quantity || 1)
                    });
                });
            }
        }

        const taxableAmount = Number(invoice.baseAmount || 0);
        const cgst = Number(invoice.cgst || 0);
        const sgst = Number(invoice.sgst || 0);
        const total = Number(invoice.totalAmount || 0);

        // The line items must add up to the taxable amount the tax was computed
        // on. Snapshot-backed invoices already do; legacy rows (built from
        // service_charges or with no charge row at all) can drift, which would
        // print a table that visibly disagrees with its own total.
        const itemsSum = round2(items.reduce((sum, i) => sum + i.total, 0));
        const itemsGap = round2(taxableAmount - itemsSum);
        if (Math.abs(itemsGap) > 0.01) {
            if (items.length > 0 && Math.abs(itemsGap) < 1) {
                // Sub-rupee rounding: absorb it into the largest line rather than
                // printing a "Rs. -0.18 Adjustment" row that reads like an error.
                const largest = items.reduce((a, b) => (b.total > a.total ? b : a));
                largest.total = round2(largest.total + itemsGap);
                largest.unitPrice = round2(largest.unitPrice + itemsGap);
            } else {
                items.push({
                    description: itemsGap > 0 ? "Other Service Charges" : "Adjustment",
                    quantity: 1,
                    unitPrice: itemsGap,
                    total: itemsGap,
                });
            }
        }

        // Anything the customer paid beyond taxable + tax. Normally this is the
        // approved-parts pass-through; deriving it as a remainder also catches
        // any other future component so the invoice can never under-report the
        // amount actually collected.
        const derivedOther = round2(total - (taxableAmount + cgst + sgst));
        const otherCharges = approvedPartsCost > 0 ? approvedPartsCost : Math.max(0, derivedOther);
        // Kept short so the label stays on one line in the totals column.
        const otherChargesLabel = approvedPartsCost > 0
            ? "Approved Spare Parts:"
            : "Additional Charges:";

        const data: InvoiceData = {
            invoiceId: invoice.invoiceId,
            date: invoice.createdAt || new Date(),
            customerName: customer?.username || "Valued Customer",
            customerAddress: customer?.homeAddress || "",
            providerName,
            items,
            subtotal: taxableAmount,
            cgst,
            sgst,
            otherCharges,
            otherChargesLabel,
            otherChargesNote: approvedPartsCost > 0 ? approvedPartsNote.slice(0, 80) : "",
            total,
            // The booking fee is an ADVANCE inside the total, not an extra
            // charge — shown so the paid amounts reconcile: advance + balance = total.
            advancePaid: Number(invoice.discount || 0),
            status: "PAID",
            seller,
        };

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50 });
            const buffers: Buffer[] = [];

            doc.on("data", (chunk) => buffers.push(chunk));
            doc.on("end", () => resolve(Buffer.concat(buffers)));
            doc.on("error", (err) => reject(err));

            // Header
            const logoPath = path.join(process.cwd(), "client", "public", "logo_clean.png");
            let hasLogo = false;
            try {
                if (fs.existsSync(logoPath)) {
                    doc.image(logoPath, 50, 45, { width: 50 });
                    hasLogo = true;
                }
            } catch (e) {
                // Ignore error
            }

            if (!hasLogo) {
                // Vector fallback: Draw an elegant blue badge
                doc.save()
                   .roundedRect(50, 45, 50, 40, 8)
                   .fill("#2563eb");
                doc.fillColor("#ffffff")
                   .font("Helvetica-Bold")
                   .fontSize(16)
                   .text("UF", 63, 57);
                doc.restore();
            }

            doc.fillColor("#444444")
                .font("Helvetica-Bold")
                .fontSize(18)
                .text("Tax Invoice", 110, 52)
                .font("Helvetica")
                .fontSize(9)
                .text(data.seller.name, 200, 45, { align: "right" })
                .text(data.seller.address, 200, 57, { align: "right" })
                .text(`GSTIN: ${data.seller.gstin}`, 200, 69, { align: "right" })
                .moveDown();

            // Divider
            doc.moveTo(50, 90).lineTo(550, 90).stroke();

            // Invoice meta + customer details
            const invoiceDate = data.date.toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
            });

            doc.fontSize(10).text(`Invoice Number: ${data.invoiceId}`, 50, 100)
                .text(`Invoice Date: ${invoiceDate}`, 50, 115)
                .text(`Status: ${data.status.toUpperCase()}`, 50, 130)
                .text(`Place of Supply: ${data.seller.placeOfSupply}`, 50, 145)

                .text(`Billed To:`, 300, 100)
                .font("Helvetica-Bold").text(data.customerName, 300, 115)
                .font("Helvetica").text(data.customerAddress || "Address on file", 300, 130);

            doc.moveDown();

            // Table Header using manual layout
            const tableTop = 180;
            doc.font("Helvetica-Bold");
            doc.text("Item", 50, tableTop);
            doc.text("Quantity", 280, tableTop, { width: 90, align: "right" });
            doc.text("Unit Price", 370, tableTop, { width: 90, align: "right" });
            doc.text("Total", 470, tableTop, { width: 90, align: "right" });
            doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

            // Table Rows
            let y = tableTop + 25;
            doc.font("Helvetica");

            data.items.forEach(item => {
                doc.text(item.description, 50, y);
                doc.text(item.quantity.toString(), 280, y, { width: 90, align: "right" });
                doc.text(inr(item.unitPrice), 370, y, { width: 90, align: "right" });
                doc.text(inr(item.total), 470, y, { width: 90, align: "right" });
                y += 20;
            });

            doc.moveTo(50, y).lineTo(550, y).stroke();

            // Totals — CGST and SGST are printed as the stored amounts rather
            // than a claimed percentage: v2 fixed-price bookings carve GST out
            // of the catalog price, so a hardcoded "(18%)" label would not
            // match the numbers on the page.
            y += 15;
            doc.font("Helvetica-Bold");
            doc.text("Taxable Amount:", 350, y, { width: 110, align: "right" });
            doc.text(inr(data.subtotal), 470, y, { width: 90, align: "right" });

            y += 15;
            doc.text("CGST:", 350, y, { width: 110, align: "right" });
            doc.text(inr(data.cgst), 470, y, { width: 90, align: "right" });

            y += 15;
            doc.text("SGST:", 350, y, { width: 110, align: "right" });
            doc.text(inr(data.sgst), 470, y, { width: 90, align: "right" });

            if (data.otherCharges > 0.01) {
                y += 15;
                doc.text(data.otherChargesLabel, 280, y, { width: 180, align: "right" });
                doc.text(inr(data.otherCharges), 470, y, { width: 90, align: "right" });
            }

            y += 20;
            doc.fontSize(12).text("Grand Total:", 350, y, { width: 110, align: "right" });
            doc.text(inr(data.total), 470, y, { width: 90, align: "right" });

            if (data.otherChargesNote) {
                y += 18;
                doc.fontSize(8).font("Helvetica")
                    .text(`Approved spare parts: ${data.otherChargesNote}`, 50, y, { width: 400 });
                doc.font("Helvetica-Bold").fontSize(12);
            }

            // Payment reconciliation — the booking fee is an advance credited
            // against the bill, so advance + balance always equals the total.
            if (data.advancePaid > 0) {
                y += 20;
                doc.fontSize(10).font("Helvetica");
                doc.text("Advance Paid (Booking Fee):", 320, y, { width: 140, align: "right" });
                doc.text(inr(data.advancePaid), 470, y, { width: 90, align: "right" });

                y += 15;
                doc.text("Balance Paid:", 320, y, { width: 140, align: "right" });
                doc.text(inr(Math.max(0, data.total - data.advancePaid)), 470, y, { width: 90, align: "right" });
            }

            // Footer
            doc.fontSize(10).font("Helvetica")
                .text("Thank you for choosing UniteFix!", 50, 700, { align: "center", width: 500 });

            doc.end();
        });
    }
}
