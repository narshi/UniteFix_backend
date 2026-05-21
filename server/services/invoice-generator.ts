import PDFDocument from "pdfkit";
import { db } from "../db";
import { invoices, serviceRequests, users, serviceCharges, productOrders, employees } from "@shared/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

// Define strict types for invoice data
interface InvoiceData {
    invoiceId: string;
    date: Date;
    customerName: string;
    customerAddress?: string;
    providerName?: string;
    items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
    subtotal: number;
    gst: number;
    total: number;
    status: string;
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

        let items: Array<{ description: string; quantity: number; unitPrice: number; total: number }> = [];
        let providerName = "UniteFix Service Partner";

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
                            description: "Service Labor Charges",
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

        const data: InvoiceData = {
            invoiceId: invoice.invoiceId,
            date: invoice.createdAt || new Date(),
            customerName: customer?.username || "Valued Customer",
            customerAddress: customer?.homeAddress || "",
            providerName,
            items,
            subtotal: Number(invoice.baseAmount),
            gst: Number(invoice.cgst) + Number(invoice.sgst),
            total: Number(invoice.totalAmount),
            status: "PAID"
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
                .fontSize(20)
                .text("UniteFix Invoice", 110, 57)
                .font("Helvetica")
                .fontSize(10)
                .text("UniteFix Technologies Pvt Ltd", 200, 50, { align: "right" })
                .text("Bangalore, Karnataka, India", 200, 65, { align: "right" })
                .moveDown();

            // Divider
            doc.moveTo(50, 90).lineTo(550, 90).stroke();

            // Customer Details
            doc.fontSize(10).text(`Invoice Number: ${data.invoiceId}`, 50, 100)
                .text(`Invoice Date: ${data.date.toLocaleDateString()}`, 50, 115)
                .text(`Status: ${data.status.toUpperCase()}`, 50, 130)

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
                doc.text(`₹${item.unitPrice.toFixed(2)}`, 370, y, { width: 90, align: "right" });
                doc.text(`₹${item.total.toFixed(2)}`, 470, y, { width: 90, align: "right" });
                y += 20;
            });

            doc.moveTo(50, y).lineTo(550, y).stroke();

            // Totals
            y += 15;
            doc.font("Helvetica-Bold");
            doc.text("Subtotal:", 370, y, { width: 90, align: "right" });
            doc.text(`₹${data.subtotal.toFixed(2)}`, 470, y, { width: 90, align: "right" });

            y += 15;
            doc.text("GST (18%):", 370, y, { width: 90, align: "right" });
            doc.text(`₹${data.gst.toFixed(2)}`, 470, y, { width: 90, align: "right" });

            y += 20;
            doc.fontSize(12).text("Grand Total:", 370, y, { width: 90, align: "right" });
            doc.text(`₹${data.total.toFixed(2)}`, 470, y, { width: 90, align: "right" });

            // Footer
            doc.fontSize(10).font("Helvetica")
                .text("Thank you for choosing UniteFix!", 50, 700, { align: "center", width: 500 });

            doc.end();
        });
    }
}
