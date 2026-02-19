/**
 * PHASE 7: Admin Dashboard API Routes
 * 
 * Consolidates all admin operations:
 * - Service management
 * - Order management
 * - Technician management
 * - Support tickets
 */

import type { Express, Request, Response } from "express";
import { AdminServiceManager } from "../services/admin-service.manager";
import { AdminOrderManager, DelhiveryService } from "../services/admin-order.manager";
import { SupportTicketService } from "../services/support.service";
import { PaymentService } from "../services/payment.service";
import { storage } from "../storage";

export function registerAdminRoutes(app: Express) {
    // ==================== SERVICE MANAGEMENT ====================

    /**
     * GET /api/admin/services
     * View all service bookings with filters
     */
    app.get("/api/admin/services", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const filters = {
                status: req.query.status as string,
                technicianId: req.query.technicianId ? parseInt(req.query.technicianId as string) : undefined,
                customerId: req.query.customerId ? parseInt(req.query.customerId as string) : undefined,
                startDate: req.query.startDate as string,
                endDate: req.query.endDate as string,
                pincode: req.query.pincode as string,
            };

            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const result = await AdminServiceManager.getServiceBookings(filters, page, limit);

            res.json(result);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/admin/services/:id
     * Get service details with full history
     */
    app.get("/api/admin/services/:id", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const serviceId = parseInt(req.params.id);
            const details = await AdminServiceManager.getServiceDetails(serviceId);

            res.json(details);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/admin/services/:id/assign
     * Assign technician to service
     */
    app.post("/api/admin/services/:id/assign", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const serviceId = parseInt(req.params.id);
            const { technicianId } = req.body;
            const adminId = (req as any).user.id;

            const updated = await AdminServiceManager.assignTechnician(serviceId, technicianId, adminId);

            res.json({ message: "Technician assigned successfully", service: updated });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/admin/services/:id/reassign
     * Reassign technician
     */
    app.post("/api/admin/services/:id/reassign", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const serviceId = parseInt(req.params.id);
            const { technicianId, reason } = req.body;
            const adminId = (req as any).user.id;

            const updated = await AdminServiceManager.reassignTechnician(
                serviceId,
                technicianId,
                reason,
                adminId
            );

            res.json({ message: "Technician reassigned successfully", service: updated });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/admin/services/:id/force-transition
     * Force state transition (admin override)
     */
    app.post("/api/admin/services/:id/force-transition", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const serviceId = parseInt(req.params.id);
            const { newState, reason } = req.body;
            const adminId = (req as any).user.id;

            const updated = await AdminServiceManager.forceStateTransition(
                serviceId,
                newState,
                reason,
                adminId
            );

            res.json({ message: "State transition completed", service: updated });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * GET /api/admin/reports/services
     * Service statistics
     */
    app.get("/api/admin/reports/services", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const stats = await AdminServiceManager.getServiceStats(
                req.query.startDate as string,
                req.query.endDate as string
            );

            res.json(stats);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/admin/technicians/:id/performance
     * Technician performance metrics
     */
    app.get("/api/admin/technicians/:id/performance", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const technicianId = parseInt(req.params.id);
            const metrics = await AdminServiceManager.getTechnicianPerformance(technicianId);

            res.json(metrics);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // ==================== ORDER MANAGEMENT ====================

    /**
     * GET /api/admin/orders
     * View all product orders
     */
    app.get("/api/admin/orders", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const status = req.query.status as string;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const result = await AdminOrderManager.getOrders(status, page, limit);

            res.json(result);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/admin/orders/:orderId
     * Get order details with shipment tracking
     */
    app.get("/api/admin/orders/:orderId", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const details = await AdminOrderManager.getOrderDetails(req.params.orderId);

            res.json(details);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/admin/orders/:orderId/create-shipment
     * Create Delhivery shipment
     */
    app.post("/api/admin/orders/:orderId/create-shipment", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const { orderId } = req.params;
            const { customerName, customerPhone, address, pincode, totalAmount, productDetails } =
                req.body;

            const shipment = await DelhiveryService.createShipment({
                orderId,
                customerName,
                customerPhone,
                address,
                pincode,
                totalAmount,
                productDetails,
            });

            res.json({ message: "Shipment created successfully", shipment });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    // ==================== SUPPORT TICKETS ====================

    /**
     * GET /api/admin/tickets
     * View all support tickets
     */
    app.get("/api/admin/tickets", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const status = req.query.status as string;
            const category = req.query.category as string;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const result = await SupportTicketService.getTickets(status, category, page, limit);

            res.json(result);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/admin/tickets/:ticketId
     * View ticket details with messages
     */
    app.get("/api/admin/tickets/:ticketId", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const details = await SupportTicketService.getTicketDetails(req.params.ticketId);

            res.json(details);
        } catch (error: any) {
            res.status(404).json({ error: error.message });
        }
    });

    /**
     * POST /api/admin/tickets/:ticketId/reply
     * Reply to ticket
     */
    app.post("/api/admin/tickets/:ticketId/reply", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const { message, isInternal } = req.body;
            const adminId = (req as any).user.id;

            const msg = await SupportTicketService.addMessage(
                req.params.ticketId,
                message,
                "admin",
                adminId,
                isInternal || false
            );

            res.json({ message: "Reply sent successfully", msg });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * PUT /api/admin/tickets/:ticketId/status
     * Update ticket status
     */
    app.put("/api/admin/tickets/:ticketId/status", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const { status } = req.body;
            const adminId = (req as any).user.id;

            const ticket = await SupportTicketService.updateTicketStatus(
                req.params.ticketId,
                status,
                adminId
            );

            res.json({ message: "Ticket status updated", ticket });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    // ==================== CUSTOMER SUPPORT ROUTES ====================

    /**
     * POST /api/customer/tickets
     * Customer creates support ticket
     */
    app.post("/api/customer/tickets", async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user?.id;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const { subject, description, category, serviceRequestId, productOrderId } = req.body;

            const ticket = await SupportTicketService.createTicket({
                userId,
                subject,
                description,
                category,
                serviceRequestId,
                productOrderId,
            });

            res.json({ message: "Ticket created successfully", ticket });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * GET /api/customer/orders/:orderId/tracking
     * Customer views shipment tracking
     */
    app.get("/api/customer/orders/:orderId/tracking", async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user?.id;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const tracking = await DelhiveryService.getShipmentByOrder(req.params.orderId);

            if (!tracking) {
                return res.status(404).json({ error: "No shipment found for this order" });
            }

            res.json({ tracking });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });
    // ==================== USER MANAGEMENT ====================

    /**
     * GET /api/admin/users
     * List all users with filtering
     */
    app.get("/api/admin/users", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const filters = {
                role: req.query.role as string,
                search: req.query.search as string
            };

            const users = await storage.getUsers(filters);
            res.json({ data: users });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * PATCH /api/admin/users/:id/status
     * Update user status/role
     */
    app.patch("/api/admin/users/:id/status", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const userId = parseInt(req.params.id);
            const { isActive, role } = req.body;

            const updated = await storage.updateUser(userId, { isActive, role });

            if (!updated) {
                return res.status(404).json({ error: "User not found" });
            }

            res.json(updated);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });
}
