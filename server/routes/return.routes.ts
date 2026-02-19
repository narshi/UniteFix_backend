/**
 * PHASE 10: Return & Exchange API Routes
 * 
 * Customer endpoints:
 *   POST   /api/orders/:orderId/return        - Request return/exchange
 *   GET    /api/orders/:orderId/return-status  - Check return request status
 *   PATCH  /api/returns/:id/ship              - Mark return as shipped
 * 
 * Admin endpoints:
 *   GET    /api/admin/returns                  - List all return requests
 *   GET    /api/admin/returns/:id              - Return request details
 *   PATCH  /api/admin/returns/:id/approve      - Approve return
 *   PATCH  /api/admin/returns/:id/reject       - Reject return
 *   PATCH  /api/admin/returns/:id/received     - Mark return received
 *   POST   /api/admin/returns/:id/refund       - Initiate refund
 *   POST   /api/admin/returns/:id/exchange     - Process exchange
 * 
 * Payment tracking endpoints:
 *   GET    /api/payments/order/:orderId        - Get transactions for order
 *   GET    /api/payments/service/:serviceId    - Get transactions for service
 *   GET    /api/admin/payments/transactions    - Admin transaction list
 *   GET    /api/admin/payments/refunds         - Admin refund list
 */

import type { Express, Request, Response } from "express";
import { ReturnService } from "../services/return.service";
import { PaymentTrackingService } from "../services/payment-tracking.service";
import { authenticateToken } from "../middleware/auth.middleware";
import { mobileLimiter } from "../middleware/rate-limit";

export function registerReturnRoutes(app: Express) {

    // ============================================================
    // CUSTOMER ENDPOINTS
    // ============================================================

    /**
     * POST /api/orders/:orderId/return
     * Customer requests a return or exchange
     */
    app.post("/api/orders/:orderId/return", mobileLimiter, authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const { orderId } = req.params;
            const userId = (req as any).user?.userId;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const { type, reason, description, photos } = req.body;

            if (!type || !['return', 'exchange'].includes(type)) {
                return res.status(400).json({ error: "Type must be 'return' or 'exchange'" });
            }

            if (!reason) {
                return res.status(400).json({ error: "Reason is required" });
            }

            const validReasons = ['defective', 'wrong_item', 'not_as_described', 'size_issue', 'changed_mind', 'other'];
            if (!validReasons.includes(reason)) {
                return res.status(400).json({ error: `Invalid reason. Must be one of: ${validReasons.join(', ')}` });
            }

            const request = await ReturnService.createReturnRequest({
                orderId,
                userId,
                type,
                reason,
                description,
                photos,
            });

            res.status(201).json({
                message: `${type === 'return' ? 'Return' : 'Exchange'} request created successfully`,
                request,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * GET /api/orders/:orderId/return-status
     * Customer checks return request status
     */
    app.get("/api/orders/:orderId/return-status", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const { orderId } = req.params;
            const userId = (req as any).user?.userId;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const request = await ReturnService.getReturnStatus(orderId, userId);

            if (!request) {
                return res.status(404).json({ error: "No return/exchange request found for this order" });
            }

            res.json({ request });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * PATCH /api/returns/:id/ship
     * Customer marks return as shipped with waybill number
     */
    app.patch("/api/returns/:id/ship", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id);
            const userId = (req as any).user?.userId;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const { waybill } = req.body;
            if (!waybill) {
                return res.status(400).json({ error: "Waybill number is required" });
            }

            const request = await ReturnService.markReturnShipped(id, userId, waybill);

            res.json({
                message: "Return marked as shipped",
                request,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    // ============================================================
    // ADMIN ENDPOINTS
    // ============================================================

    /**
     * GET /api/admin/returns
     * List all return requests with filters
     */
    app.get("/api/admin/returns", async (req: Request, res: Response) => {
        try {
            const { status, type, page, limit } = req.query;

            const result = await ReturnService.getReturnRequests({
                status: status as string,
                type: type as string,
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 20,
            });

            res.json(result);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/admin/returns/:id
     * Get return request details
     */
    app.get("/api/admin/returns/:id", async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id);
            const request = await ReturnService.getReturnRequestById(id);
            res.json({ request });
        } catch (error: any) {
            res.status(404).json({ error: error.message });
        }
    });

    /**
     * PATCH /api/admin/returns/:id/approve
     * Admin approves return/exchange request
     */
    app.patch("/api/admin/returns/:id/approve", async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id);
            const adminId = (req as any).user?.userId;

            if (!adminId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const { refundAmount } = req.body; // Optional: admin can set partial refund

            const request = await ReturnService.approveReturn(id, adminId, refundAmount);

            res.json({
                message: `${request.type === 'return' ? 'Return' : 'Exchange'} request approved`,
                request,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * PATCH /api/admin/returns/:id/reject
     * Admin rejects return/exchange request
     */
    app.patch("/api/admin/returns/:id/reject", async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id);
            const adminId = (req as any).user?.userId;

            if (!adminId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const { remarks } = req.body;
            if (!remarks) {
                return res.status(400).json({ error: "Rejection remarks are required" });
            }

            const request = await ReturnService.rejectReturn(id, adminId, remarks);

            res.json({
                message: "Return/exchange request rejected",
                request,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * PATCH /api/admin/returns/:id/received
     * Admin marks return as received at warehouse
     */
    app.patch("/api/admin/returns/:id/received", async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id);
            const adminId = (req as any).user?.userId;

            if (!adminId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const request = await ReturnService.markReturnReceived(id, adminId);

            res.json({
                message: "Return received at warehouse",
                request,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/admin/returns/:id/refund
     * Admin initiates Razorpay refund for return request
     */
    app.post("/api/admin/returns/:id/refund", async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id);
            const adminId = (req as any).user?.userId;

            if (!adminId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const request = await ReturnService.initiateRefund(id, adminId);

            res.json({
                message: "Refund initiated via Razorpay",
                request,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/admin/returns/:id/exchange
     * Admin processes exchange — ships replacement
     */
    app.post("/api/admin/returns/:id/exchange", async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id);
            const adminId = (req as any).user?.userId;

            if (!adminId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const { replacementOrderId } = req.body;

            const request = await ReturnService.processExchange(id, adminId, replacementOrderId);

            res.json({
                message: "Exchange processed. Replacement order created.",
                request,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    // ============================================================
    // PAYMENT TRACKING ENDPOINTS
    // ============================================================

    /**
     * GET /api/payments/order/:orderId
     * Get all payment transactions for a product order
     */
    app.get("/api/payments/order/:orderId", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const { orderId } = req.params;
            const transactions = await PaymentTrackingService.getTransactionsByOrder(orderId);
            res.json({ transactions });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/payments/service/:serviceId
     * Get all payment transactions for a service request
     */
    app.get("/api/payments/service/:serviceId", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.serviceId);
            const transactions = await PaymentTrackingService.getTransactionsByService(serviceId);
            res.json({ transactions });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/admin/payments/transactions
     * Admin: paginated list of all payment transactions
     */
    app.get("/api/admin/payments/transactions", async (req: Request, res: Response) => {
        try {
            const { status, eventType, page, limit } = req.query;

            const result = await PaymentTrackingService.getTransactions({
                status: status as string,
                eventType: eventType as string,
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 20,
            });

            res.json(result);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/admin/payments/refunds
     * Admin: paginated list of all refunds
     */
    app.get("/api/admin/payments/refunds", async (req: Request, res: Response) => {
        try {
            const { status, page, limit } = req.query;

            const result = await PaymentTrackingService.getRefunds(
                page ? parseInt(page as string) : 1,
                limit ? parseInt(limit as string) : 20,
                status as string,
            );

            res.json(result);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });
}
