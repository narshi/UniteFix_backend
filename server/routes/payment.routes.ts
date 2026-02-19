/**
 * PHASE 5: Payment & Billing API Routes
 * Technician: Enter service charge
 * Customer: Create final payment order
 * System: Razorpay webhook
 */

import type { Express, Request, Response } from "express";
import { PaymentService } from "../services/payment.service";
import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { authenticateToken, authenticatePartner } from "../middleware/auth.middleware";
import { mobileLimiter } from "../middleware/rate-limit";
import { storage } from "../storage";

export function registerPaymentRoutes(app: Express) {
    /**
     * POST /api/services/create
     * Create service and booking order
     * This replaces or enhances existing service creation
     */
    app.post("/api/services/create-with-payment", mobileLimiter, authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const { serviceType, description, address, pincode } = req.body;
            const customerId = (req as any).user?.userId;

            if (!customerId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            if (!serviceType || !description || !address) {
                return res.status(400).json({ error: "serviceType, description, and address are required" });
            }

            // Create service request via storage layer
            const serviceRequest = await storage.createServiceRequest({
                userId: customerId,
                serviceType,
                description,
                address,
                status: 'created',
            });

            // Create Razorpay order for booking charge
            const order = await PaymentService.createBookingOrder(serviceRequest.id, customerId);

            res.json({
                message: "Service created. Please complete booking payment.",
                serviceRequestId: serviceRequest.id,
                serviceId: serviceRequest.serviceId,
                razorpayOrder: order,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/technician/services/:id/enter-service-charge
     * Technician enters service charge after completing work
     */
    app.post("/api/technician/services/:id/enter-service-charge", authenticatePartner as any, async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);
            const { serviceAmount, partsUsed, notes } = req.body;
            const technicianId = (req as any).user?.userId;

            if (!technicianId) {
                return res.status(401).json({ error: "Unauthorized - Technician only" });
            }

            if (!serviceAmount || serviceAmount <= 0) {
                return res.status(400).json({ error: "Valid service amount required" });
            }

            // Insert service charge
            await db.execute(sql`
        INSERT INTO service_charges (
          service_request_id,
          service_amount,
          parts_used,
          technician_notes,
          entered_by
        ) VALUES (
          ${serviceId},
          ${serviceAmount},
          ${partsUsed || ''},
          ${notes || ''},
          ${technicianId}
        )
        ON CONFLICT (service_request_id) DO UPDATE
        SET service_amount = ${serviceAmount},
            parts_used = ${partsUsed || ''},
            technician_notes = ${notes || ''},
            entered_at = NOW()
      `);

            res.json({
                message: "Service charge recorded successfully",
                serviceAmount,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/customer/services/:id/create-final-payment
     * Customer creates final payment order after service charge entered
     */
    app.post("/api/customer/services/:id/create-final-payment", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);
            const customerId = (req as any).user?.userId;

            if (!customerId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            // Get service charge
            const serviceChargeResult = await db.execute(sql`
        SELECT service_amount FROM service_charges 
        WHERE service_request_id = ${serviceId}
      `) as any;
            const serviceCharge = serviceChargeResult?.[0];

            if (!serviceCharge) {
                return res.status(400).json({
                    error: "Service charge not entered yet by technician"
                });
            }

            const amount = parseFloat(serviceCharge.service_amount);

            // Create final payment order
            const result = await PaymentService.createFinalPaymentOrder(serviceId, amount);

            res.json({
                message: "Final payment order created",
                razorpayOrder: {
                    orderId: result.orderId,
                    amount: result.amount,
                },
                invoice: result.invoice,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/webhooks/razorpay
     * Razorpay webhook handler
     * Verifies signature and updates payment status
     */
    app.post("/api/webhooks/razorpay", async (req: Request, res: Response) => {
        try {
            const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
            if (!webhookSecret) {
                console.error('RAZORPAY_WEBHOOK_SECRET not configured');
                return res.status(500).json({ error: "Webhook not configured" });
            }
            const signature = req.headers["x-razorpay-signature"] as string;

            if (!signature) {
                return res.status(400).json({ error: "Missing signature" });
            }

            // Verify signature
            const webhookBody = JSON.stringify(req.body);
            const isValid = PaymentService.verifyWebhookSignature(
                webhookBody,
                signature,
                webhookSecret
            );

            if (!isValid) {
                return res.status(401).json({ error: "Invalid signature" });
            }

            // Handle webhook event
            const { event, payload } = req.body;
            const result = await PaymentService.handleWebhook(event, payload);

            res.json(result);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/customer/services/:id/invoice
     * Get invoice for completed service
     */
    app.get("/api/customer/services/:id/invoice", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);

            const invoiceResult = await db.execute(sql`
        SELECT * FROM invoices 
        WHERE service_request_id = ${serviceId}
      `) as any;
            const invoice = invoiceResult?.[0];

            if (!invoice) {
                return res.status(404).json({ error: "Invoice not found" });
            }

            res.json({ invoice });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });
}
