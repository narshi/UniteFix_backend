/**
 * PHASE 7+10: Admin Order Management & Delhivery Integration
 * 
 * Handles:
 * - Order management (view, update status)
 * - Delhivery shipment creation (mock/live toggle)
 * - Shipment tracking (admin + customer)
 * - Reverse shipment for returns
 * - Full audit trail on status changes
 * 
 * DELHIVERY_MODE: 'mock' (default) | 'live'
 * - mock: Generates fake waybills, simulated responses (no API key needed)
 * - live: Real Delhivery API calls (requires DELHIVERY_API_KEY)
 */

import { db } from "../db";
import { sql, eq, and, desc } from "drizzle-orm";
import { productOrders, shipments, auditLogs } from "@shared/schema";
import axios from "axios";
import crypto from "crypto";

interface DelhiveryConfig {
    apiKey: string;
    baseUrl: string;
    mode: 'mock' | 'live';
}

export class AdminOrderManager {
    /**
     * Get all product orders with pagination
     */
    static async getOrders(
        status?: string,
        page: number = 1,
        limit: number = 20
    ): Promise<{ orders: any[]; total: number; page: number; pages: number }> {
        const offset = (page - 1) * limit;

        const conditions: any[] = [];
        if (status) {
            conditions.push(eq(productOrders.status, status as any));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [orders, countResult] = await Promise.all([
            db.select()
                .from(productOrders)
                .where(whereClause)
                .orderBy(desc(productOrders.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: sql<number>`count(*)::int` })
                .from(productOrders)
                .where(whereClause),
        ]);

        const total = countResult[0]?.count || 0;
        const pages = Math.ceil(total / limit);

        return { orders, total, page, pages };
    }

    /**
     * Get order details with shipment tracking
     */
    static async getOrderDetails(orderId: string): Promise<any> {
        const [order] = await db
            .select()
            .from(productOrders)
            .where(eq(productOrders.orderId, orderId));

        if (!order) {
            throw new Error("Order not found");
        }

        // Get shipment tracking if exists
        const shipment = await DelhiveryService.getShipmentByOrder(orderId);

        return {
            order,
            shipment: shipment || null,
        };
    }

    /**
     * Update order status with audit logging
     */
    static async updateOrderStatus(
        orderId: string,
        newStatus: string,
        adminId: number
    ): Promise<any> {
        // Get current order for fromState
        const [currentOrder] = await db.select()
            .from(productOrders)
            .where(eq(productOrders.orderId, orderId))
            .limit(1);

        if (!currentOrder) {
            throw new Error("Order not found");
        }

        const fromState = currentOrder.status;

        const [order] = await db
            .update(productOrders)
            .set({
                status: newStatus as any,
                updatedAt: new Date(),
            })
            .where(eq(productOrders.orderId, orderId))
            .returning();

        // Audit log using Drizzle ORM
        await db.insert(auditLogs).values({
            entityType: 'product_order',
            entityId: order.id,
            action: 'status_updated',
            fromState,
            toState: newStatus,
            changedBy: adminId,
            metadata: { orderId, newStatus },
        });

        return order;
    }

    /**
     * Get shipment tracking info for an order
     */
    private static async getShipmentTracking(orderId: string): Promise<any> {
        return DelhiveryService.getShipmentByOrder(orderId);
    }
}

/**
 * Delhivery Integration Service (Mock/Live Toggle)
 * 
 * Set DELHIVERY_MODE=mock in .env for testing without API credentials
 * Set DELHIVERY_MODE=live for production with real Delhivery API
 */
export class DelhiveryService {
    private static getConfig(): DelhiveryConfig {
        return {
            apiKey: process.env.DELHIVERY_API_KEY || "",
            baseUrl: process.env.DELHIVERY_BASE_URL || "https://track.delhivery.com/api",
            mode: (process.env.DELHIVERY_MODE as 'mock' | 'live') || 'mock',
        };
    }

    private static generateMockWaybill(): string {
        return `MOCK${Date.now()}${crypto.randomInt(10000)}`;
    }

    /**
     * Create shipment (forward or reverse)
     */
    static async createShipment(orderData: {
        orderId: string;
        customerName: string;
        customerPhone: string;
        address: string;
        pincode: string;
        totalAmount: number;
        productDetails: string;
    }): Promise<{ waybill: string; shipmentId: string }> {
        const config = this.getConfig();

        if (config.mode === 'mock') {
            return this.createMockShipment(orderData);
        }

        return this.createLiveShipment(orderData, config);
    }

    /**
     * Create a reverse shipment for returns
     */
    static async createReverseShipment(data: {
        orderId: string;
        customerName: string;
        customerPhone: string;
        pickupAddress: string;
        pickupPincode: string;
        productDetails: string;
    }): Promise<{ waybill: string; shipmentId: string }> {
        const config = this.getConfig();

        if (config.mode === 'mock') {
            const waybill = `RVS${this.generateMockWaybill()}`;
            const shipmentId = `RVSMOCK-${data.orderId}`;

            // Save reverse shipment to DB
            await db.insert(shipments).values({
                orderId: data.orderId,
                waybill,
                shipmentId,
                carrier: 'delhivery',
                status: 'created',
                trackingUrl: `https://www.delhivery.com/track/package/${waybill}`,
            });

            console.log(`[DELHIVERY MOCK] Reverse shipment created: waybill=${waybill}`);

            return { waybill, shipmentId };
        }

        // Live reverse shipment via Delhivery API
        try {
            const payload = {
                pickup: {
                    name: data.customerName,
                    phone: data.customerPhone,
                    add: data.pickupAddress,
                    pin: data.pickupPincode,
                    city: "",
                    state: "",
                    country: "India",
                },
                return_address: {
                    name: "UniteFix Warehouse",
                    add: process.env.WAREHOUSE_ADDRESS || "UniteFix Warehouse",
                    pin: process.env.WAREHOUSE_PINCODE || "581320",
                    city: process.env.WAREHOUSE_CITY || "Uttara Kannada",
                    state: process.env.WAREHOUSE_STATE || "Karnataka",
                    country: "India",
                    phone: process.env.WAREHOUSE_PHONE || "9876543210",
                },
                order_id: data.orderId,
                products_desc: data.productDetails,
            };

            const response = await axios.post(
                `${config.baseUrl}/p/packing_slip`,
                { format: "json", data: JSON.stringify(payload) },
                {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Token ${config.apiKey}`,
                    },
                }
            );

            const waybill = response.data.packages?.[0]?.waybill || this.generateMockWaybill();
            const shipmentId = response.data.packages?.[0]?.refnum || `RVS-${data.orderId}`;

            await db.insert(shipments).values({
                orderId: data.orderId,
                waybill,
                shipmentId,
                carrier: 'delhivery',
                status: 'created',
                trackingUrl: `https://www.delhivery.com/track/package/${waybill}`,
            });

            return { waybill, shipmentId };
        } catch (error: any) {
            throw new Error(`Delhivery reverse shipment failed: ${error.message}`);
        }
    }

    /**
     * Mock shipment creation (no API call)
     */
    private static async createMockShipment(orderData: {
        orderId: string;
        customerName: string;
        customerPhone: string;
        address: string;
        pincode: string;
        totalAmount: number;
        productDetails: string;
    }): Promise<{ waybill: string; shipmentId: string }> {
        const waybill = this.generateMockWaybill();
        const shipmentId = `MOCK-${orderData.orderId}`;

        // Save to database
        await db.insert(shipments).values({
            orderId: orderData.orderId,
            waybill,
            shipmentId,
            carrier: 'delhivery',
            status: 'created',
            trackingUrl: `https://www.delhivery.com/track/package/${waybill}`,
            estimatedDelivery: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // +5 days
        });

        console.log(`[DELHIVERY MOCK] Shipment created for order ${orderData.orderId}: waybill=${waybill}`);

        return { waybill, shipmentId };
    }

    /**
     * Live shipment creation via Delhivery API
     */
    private static async createLiveShipment(
        orderData: {
            orderId: string;
            customerName: string;
            customerPhone: string;
            address: string;
            pincode: string;
            totalAmount: number;
            productDetails: string;
        },
        config: DelhiveryConfig
    ): Promise<{ waybill: string; shipmentId: string }> {
        try {
            const payload = {
                shipments: [
                    {
                        name: orderData.customerName,
                        add: orderData.address,
                        pin: orderData.pincode,
                        city: "",
                        state: "",
                        country: "India",
                        phone: orderData.customerPhone,
                        order: orderData.orderId,
                        payment_mode: "Prepaid",
                        return_pin: process.env.WAREHOUSE_PINCODE || "581320",
                        return_city: process.env.WAREHOUSE_CITY || "Uttara Kannada",
                        return_phone: process.env.WAREHOUSE_PHONE || "9876543210",
                        return_add: process.env.WAREHOUSE_ADDRESS || "UniteFix Warehouse, Uttara Kannada",
                        products_desc: orderData.productDetails,
                        hsn_code: "",
                        cod_amount: "0",
                        order_date: new Date().toISOString(),
                        total_amount: orderData.totalAmount.toString(),
                        seller_add: process.env.WAREHOUSE_ADDRESS || "UniteFix Warehouse, Uttara Kannada",
                        seller_name: "UniteFix",
                        seller_inv: orderData.orderId,
                        quantity: "1",
                        waybill: "",
                        shipment_width: "10",
                        shipment_height: "10",
                        weight: process.env.DEFAULT_WEIGHT_GRAMS || "500",
                        seller_gst_tin: process.env.GST_NUMBER || "",
                        shipping_mode: "Surface",
                        address_type: "home",
                    },
                ],
                pickup_location: {
                    name: "UniteFix Warehouse",
                    city: process.env.WAREHOUSE_CITY || "Uttara Kannada",
                    pin_code: process.env.WAREHOUSE_PINCODE || "581320",
                    country: "India",
                    phone_number: process.env.WAREHOUSE_PHONE || "9876543210",
                },
            };

            const response = await axios.post(
                `${config.baseUrl}/cmu/create.json`,
                { format: "json", data: JSON.stringify(payload) },
                {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Token ${config.apiKey}`,
                    },
                }
            );

            const waybill = response.data.packages[0].waybill;
            const shipmentId = response.data.packages[0].refnum;

            // Save to database using Drizzle ORM
            await db.insert(shipments).values({
                orderId: orderData.orderId,
                waybill,
                shipmentId,
                carrier: 'delhivery',
                status: 'created',
                trackingUrl: `https://www.delhivery.com/track/package/${waybill}`,
            });

            return { waybill, shipmentId };
        } catch (error: any) {
            throw new Error(`Delhivery shipment creation failed: ${error.message}`);
        }
    }

    /**
     * Track shipment (mock or live)
     */
    static async trackShipment(waybill: string): Promise<any> {
        const config = this.getConfig();

        if (config.mode === 'mock') {
            return {
                waybill,
                status: "In Transit",
                currentLocation: "Bangalore Hub",
                expectedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                scans: [
                    {
                        time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                        location: "Uttara Kannada",
                        activity: "Picked up by courier",
                    },
                    {
                        time: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
                        location: "Hubli Hub",
                        activity: "In transit",
                    },
                    {
                        time: new Date().toISOString(),
                        location: "Bangalore Hub",
                        activity: "Arrived at destination hub",
                    },
                ],
                _mode: "mock",
            };
        }

        try {
            const response = await axios.get(
                `${config.baseUrl}/v1/packages/json/?waybill=${waybill}`,
                {
                    headers: {
                        Authorization: `Token ${config.apiKey}`,
                    },
                }
            );

            const tracking = response.data.ShipmentData[0];

            return {
                waybill,
                status: tracking.Shipment.Status.Status,
                currentLocation: tracking.Shipment.Status.StatusLocation,
                expectedDelivery: tracking.Shipment.ExpectedDeliveryDate,
                scans: tracking.Shipment.Scans || [],
            };
        } catch (error: any) {
            throw new Error(`Tracking failed: ${error.message}`);
        }
    }

    /**
     * Get shipment tracking for order (from database + live/mock tracking)
     */
    static async getShipmentByOrder(orderId: string): Promise<any> {
        const [shipment] = await db.select()
            .from(shipments)
            .where(eq(shipments.orderId, orderId))
            .orderBy(desc(shipments.createdAt))
            .limit(1);

        if (!shipment) {
            return null;
        }

        try {
            const liveTracking = await this.trackShipment(shipment.waybill);
            return {
                ...shipment,
                liveTracking,
            };
        } catch {
            // If tracking fails, return DB data only
            return shipment;
        }
    }
}
