import PDFDocument from "pdfkit";
import { db } from "../db";
import { invoices, serviceRequests, users, serviceCharges, productOrders, employees, manualBills } from "@shared/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { configService } from "./config.service";
import { getPartItems, backerLabel } from "./warranty.service";
import logger from "../lib/logger";

// Define strict types for invoice data
interface InvoiceData {
    invoiceId: string;
    date: Date;
    customerName: string;
    customerAddress?: string;
    providerName?: string;
    items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
    subtotal: number;
    /**
     * Shown as its own line before tax. A GST invoice has to account for why
     * tax was charged on less than the listed value — a discount applied at the
     * time of supply is only valid if it appears on the invoice itself.
     */
    discountAmount: number;
    /** Reason printed beside the discount, e.g. "Discount (Monsoon Offer):". */
    discountLabel: string;
    /** Pre-discount value, so the customer can see what they saved. */
    grossBeforeDiscount: number;
    cgst: number;
    sgst: number;
    /** Half the GST rate — printed beside each line, e.g. "CGST (9%)". */
    halfGstRate: number;
    otherCharges: number;
    otherChargesLabel: string;
    otherChargesNote: string;
    /**
     * One line per part fitted, naming WHO backs it.
     *
     * The backer is printed because printing "UniteFix" over a part we did not
     * supply would be assuming a warranty we never agreed to — on our own
     * letterhead, in a document a consumer forum would read as our undertaking.
     * Where a local shop backs it, the invoice says so and names the shop.
     */
    warrantyLines: Array<{ label: string; backedBy: string; until: string | null }>;
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
    supportEmail?: string;
    supportPhone?: string;
}

const SELLER_DEFAULTS: SellerDetails = {
    name: "UniteFix Solutions Pvt Ltd",
    address: "Yellapur, Uttara Kannada, Karnataka - 581359",
    gstin: "29ABCDE1234F1Z5",
    placeOfSupply: "Yellapur, Karnataka",
    supportEmail: "support@unitefix.com",
    supportPhone: "+91-9876543210",
};

async function loadSellerDetails(): Promise<SellerDetails> {
    const [name, address, gstin, placeOfSupply, supportEmail, supportPhone] = await Promise.all([
        configService.get<string>('BUSINESS_CONFIG.COMPANY_NAME', SELLER_DEFAULTS.name),
        configService.get<string>('BUSINESS_CONFIG.COMPANY_ADDRESS', SELLER_DEFAULTS.address),
        configService.get<string>('BUSINESS_CONFIG.COMPANY_GSTIN', SELLER_DEFAULTS.gstin),
        configService.get<string>('BUSINESS_CONFIG.PLACE_OF_SUPPLY', SELLER_DEFAULTS.placeOfSupply),
        configService.get<string>('BUSINESS_CONFIG.SUPPORT_EMAIL', SELLER_DEFAULTS.supportEmail),
        configService.get<string>('BUSINESS_CONFIG.SUPPORT_PHONE', SELLER_DEFAULTS.supportPhone),
    ]);

    return {
        name: name?.trim() || SELLER_DEFAULTS.name,
        address: address?.trim() || SELLER_DEFAULTS.address,
        gstin: gstin?.trim() || SELLER_DEFAULTS.gstin,
        placeOfSupply: placeOfSupply?.trim() || SELLER_DEFAULTS.placeOfSupply,
        supportEmail: supportEmail?.trim() || SELLER_DEFAULTS.supportEmail,
        supportPhone: supportPhone?.trim() || SELLER_DEFAULTS.supportPhone,
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
        // Hoisted like the parts values above: the snapshot is only in scope
        // inside the service branch below, but the totals block needs this.
        let discountAmount = 0;
        let discountLabel = "";
        /**
         * The contracted GST rate, halved for the CGST and SGST lines.
         *
         * Taken from the booking's frozen snapshot rather than today's config,
         * for the same reason every other figure is: a reprint must show the
         * rate that applied when the bill was raised, not the current one.
         */
        let gstPercent = 18;

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
                // Read straight off the frozen snapshot, never recomputed here -
                // an invoice reprinted after a promotion ends must still show the
                // promotion that was actually applied.
                discountAmount = round2(Number(snapshot?.discountAmount ?? 0));
                discountLabel = typeof snapshot?.discountLabel === 'string' ? snapshot.discountLabel.slice(0, 40) : "";
                if (Number.isFinite(Number(snapshot?.gstPercent))) {
                    gstPercent = Number(snapshot.gstPercent);
                }
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
                        // Itemise by quantity when the booking covered more than
                        // one unit. Every line here used to be hardcoded to
                        // quantity 1, so a two-AC job printed a single opaque
                        // "Service Charges" figure and the customer had no way to
                        // check the arithmetic — the one thing a tax invoice is
                        // for. The per-unit rate is divided out of the frozen
                        // service value rather than read from the catalog, so a
                        // reprint years later still shows the rate that actually
                        // applied rather than today's price.
                        const bookedQty = Math.max(1, Number(snapshot.quantity) || 1);
                        const laborTotal = Number(snapshot.serviceLaborCost);
                        items.push({
                            // v2 fixed-price bookings have no separate labor entry —
                            // the catalog price's service value IS the charge.
                            description: snapshot.snapshotVersion === 2
                                ? (bookedQty > 1
                                    ? `${service.serviceType || "Service"} (Fixed Price)`
                                    : "Service Charges (Fixed Price)")
                                : "Service Labor Charges",
                            quantity: bookedQty,
                            unitPrice: round2(laborTotal / bookedQty),
                            total: laborTotal
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

        // Manual counter sale: neither a booking nor a product order, so the line
        // items live in `manual_bills`. Without this branch the PDF would fall
        // through to the reconciliation below and print the whole bill as a
        // single "Other Service Charges" line.
        else {
            const [bill] = await db.select().from(manualBills)
                .where(eq(manualBills.invoiceId, invoice.id)).limit(1);
            if (bill && Array.isArray(bill.items)) {
                (bill.items as any[]).forEach((line) => {
                    items.push({
                        description: String(line.description ?? "Item"),
                        quantity: Number(line.quantity ?? 1),
                        unitPrice: Number(line.unitPrice ?? 0),
                        total: Number(line.total ?? 0),
                    });
                });
                providerName = "UniteFix (in-house)";
            }
        }

        // Parts provenance, if this job recorded any. These replace the single
        // opaque "Approved Spare Parts" figure with a line per part, and supply
        // the warranty block printed under the totals. A customer who can read
        // what was fitted and who stands behind it does not have to ring us to
        // find out three months later.
        const warrantyLines: InvoiceData['warrantyLines'] = [];
        if (invoice.serviceRequestId) {
            try {
                const partRows = await getPartItems(invoice.serviceRequestId);
                if (partRows.length) {
                    approvedPartsNote = partRows
                        .map(p => `${p.partName}${p.quantity > 1 ? ` x${p.quantity}` : ''}`)
                        .join(', ').slice(0, 120);
                    for (const p of partRows) {
                        warrantyLines.push({
                            label: `${p.partName}${p.quantity > 1 ? ` x${p.quantity}` : ''}`,
                            backedBy: backerLabel(p.warrantyBacker as any, p.vendorName),
                            until: p.warrantyExpiresAt
                                ? new Date(p.warrantyExpiresAt).toLocaleDateString('en-IN')
                                : null,
                        });
                    }
                }
            } catch (err: any) {
                // An invoice must still print if the parts lookup fails.
                logger.warn(`[INVOICE] Could not load parts for SR #${invoice.serviceRequestId}: ${err?.message}`);
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
            discountAmount,
            discountLabel,
            grossBeforeDiscount: round2(taxableAmount + discountAmount),
            cgst,
            sgst,
            halfGstRate: round2(gstPercent / 2),
            otherCharges,
            otherChargesLabel,
            otherChargesNote: approvedPartsCost > 0 ? approvedPartsNote.slice(0, 80) : "",
            warrantyLines,
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

            // Header — try multiple logo paths and formats
            const logoCandidates = [
                path.join(process.cwd(), "client", "public", "logo_clean.png"),
                path.join(process.cwd(), "client", "public", "logo_clean.jpg"),
                path.join(process.cwd(), "client", "public", "logo.png"),
                path.join(process.cwd(), "client", "public", "logo.jpg"),
                path.join(process.cwd(), "logo.jpg"),
                path.join(process.cwd(), "logo.png"),
            ];
            let hasLogo = false;
            for (const candidate of logoCandidates) {
                try {
                    if (fs.existsSync(candidate)) {
                        doc.image(candidate, 50, 45, { width: 50 });
                        hasLogo = true;
                        break;
                    }
                } catch (e) {
                    // Try next candidate
                }
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
                .text(`GSTIN: ${data.seller.gstin}`, 200, 69, { align: "right" });

            let sellerTopY = 69;
            if (data.seller.supportPhone) {
                sellerTopY += 12;
                doc.text(`Phone: ${data.seller.supportPhone}`, 200, sellerTopY, { align: "right" });
            }
            if (data.seller.supportEmail) {
                sellerTopY += 12;
                doc.text(`Email: ${data.seller.supportEmail}`, 200, sellerTopY, { align: "right" });
            }

            doc.moveDown();

            // Divider
            const dividerY = Math.max(90, sellerTopY + 15);
            doc.moveTo(50, dividerY).lineTo(550, dividerY).stroke();

            // Invoice meta + customer details
            const invoiceDate = data.date.toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
            });

            const metaY = dividerY + 10;
            doc.fontSize(10).text(`Invoice Number: ${data.invoiceId}`, 50, metaY)
                .text(`Invoice Date: ${invoiceDate}`, 50, metaY + 15)
                .text(`Status: ${data.status.toUpperCase()}`, 50, metaY + 30)
                .text(`Place of Supply: ${data.seller.placeOfSupply}`, 50, metaY + 45)

                .text(`Billed To:`, 300, metaY)
                .font("Helvetica-Bold").text(data.customerName, 300, metaY + 15)
                .font("Helvetica").text(data.customerAddress || "Address on file", 300, metaY + 30);

            doc.moveDown();

            // Table Header using manual layout
            const tableTop = metaY + 80;
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
            // Only when there was one — an invoice with a "Discount: ₹0.00" line
            // reads like a mistake.
            if (data.discountAmount > 0.01) {
                y += 15;
                doc.font("Helvetica");
                doc.text("Value Before Discount:", 320, y, { width: 140, align: "right" });
                doc.text(inr(data.grossBeforeDiscount), 470, y, { width: 90, align: "right" });

                y += 15;
                // The reason belongs on the invoice, not just in the app: a GST
                // discount is only valid if the invoice itself accounts for it.
                const discountCaption = data.discountLabel
                    ? `Discount (${data.discountLabel}):`
                    : "Discount:";
                doc.text(discountCaption, 260, y, { width: 200, align: "right" });
                doc.text("-" + inr(data.discountAmount), 470, y, { width: 90, align: "right" });
            }

            y += 15;
            doc.font("Helvetica-Bold");
            doc.text("Taxable Amount:", 350, y, { width: 110, align: "right" });
            doc.text(inr(data.subtotal), 470, y, { width: 90, align: "right" });

            // Rate in brackets, as a tax invoice should carry. Trailing ".0" is
            // dropped so 9% reads as "9%" rather than "9.0%", while a half-point
            // rate would still show.
            const ratePrint = `${Number(data.halfGstRate.toFixed(2))}%`;

            y += 15;
            doc.text(`CGST (${ratePrint}):`, 330, y, { width: 130, align: "right" });
            doc.text(inr(data.cgst), 470, y, { width: 90, align: "right" });

            y += 15;
            doc.text(`SGST (${ratePrint}):`, 330, y, { width: 130, align: "right" });
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

            // ── Warranty ───────────────────────────────────────────────────
            // Our own guarantee on the work, then each part and who backs it.
            // Naming the backer is the whole point: it is the difference between
            // telling the customer what they have and quietly underwriting a
            // local shop's paper card in our own name.
            if (data.warrantyLines.length > 0) {
                y += 26;
                doc.fontSize(9).font("Helvetica-Bold").text("Warranty", 50, y);
                y += 13;
                doc.fontSize(8).font("Helvetica")
                    .text("Our workmanship on this job is guaranteed for 30 days by UniteFix.", 50, y, { width: 500 });
                y += 12;

                for (const w of data.warrantyLines) {
                    const cover = w.until
                        ? `${w.backedBy} — until ${w.until}`
                        : `${w.backedBy}`;
                    doc.fontSize(8).font("Helvetica")
                        .text(`• ${w.label}: ${cover}`, 56, y, { width: 494 });
                    y += 11;
                }

                y += 2;
                doc.fontSize(7.5).font("Helvetica-Oblique")
                    .text("Raise any warranty issue with UniteFix and we will handle the claim for you, "
                        + "including with the supplying vendor.", 50, y, { width: 500 });
                doc.font("Helvetica-Bold").fontSize(12);
                y += 6;
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
