/**
 * PHASE 7: Admin Order Management & Delhivery Integration
 * 
 * Handles:
 * - Order management (view, update status)
 * - Delhivery shipment creation
 * - Shipment tracking (admin + customer)
 * - Returns and refunds
 */

import { db } from "../db";
import { sql, eq, and, desc } from "drizzle-orm";
import { productOrders } from "@shared/schema";
import axios from "axios";

interface DelhiveryConfig {
    apiKey: string;
    baseUrl: string;
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
            conditions.push(eq(productOrders.status, status));
        }

        // Get total count
        const [countResult] = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM product_orders
      ${conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``}
    `);

        const total = parseInt(countResult?.count || "0");

        // Get orders
        const orders = await db
            .select()
            .from(productOrders)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(productOrders.createdAt))
            .limit(limit)
            .offset(offset);

        const pages = Math.ceil(total / limit);

        return { orders, total, page, pages };
    }

    /**
     * Get order details
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
        const shipment = await this.getShipmentTracking(orderId);

        return {
            order,
            shipment: shipment || null,
        };
    }

    /**
     * Update order status
     */
    static async updateOrderStatus(
        orderId: string,
        newStatus: string,
        adminId: number
    ): Promise<any> {
        const [order] = await db
            .update(productOrders)
            .set({
                status: newStatus,
                updatedAt: new Date(),
            })
            .where(eq(productOrders.orderId, orderId))
            .returning();

        // Audit log
        await db.execute(sql`
      INSERT INTO audit_logs (entity_type, entity_id, action, changed_by, metadata)
      VALUES ('product_order', ${order.id}, 'status_updated', ${adminId}, 
        ${JSON.stringify({ orderId, newStatus })})
    `);

        return order;
    }
}

/**
 * Delhivery Integration Service
 */
export class DelhiveryService {
    private static config: DelhiveryConfig = {
        apiKey: process.env.DELHIVERY_API_KEY || "",
        baseUrl: process.env.DELHIVERY_BASE_URL || "https://track.delhivery.com/api",
    };

    /**
     * Create shipment in Delhivery
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
        try {
            const payload = {
                shipments: [
                    {
                        name: orderData.customerName,
                        add: orderData.address,
                        pin: orderData.pincode,
                        city: "", // Would need pincode to city mapping
                        state: "",
                        country: "India",
                        phone: orderData.customerPhone,
                        order: orderData.orderId,
                        payment_mode: "Prepaid",
                        return_pin: "581320", // Uttara Kannada return address
                        return_city: "Uttara Kannada",
                        return_phone: "9876543210",
                        return_add: "UniteFix Warehouse, Uttara Kannada",
                        products_desc: orderData.productDetails,
                        hsn_code: "",
                        cod_amount: "0",
                        order_date: new Date().toISOString(),
                        total_amount: orderData.totalAmount.toString(),
                        seller_add: "UniteFix Warehouse, Uttara Kannada",
                        seller_name: "UniteFix",
                        seller_inv: orderData.orderId,
                        quantity: "1",
                        waybill: "", // Delhivery generates this
                        shipment_width: "10",
                        shipment_height: "10",
                        weight: "500", // grams
                        seller_gst_tin: "", // Add GST number
                        shipping_mode: "Surface",
                        address_type: "home",
                    },
                ],
                pickup_location: {
                    name: "UniteFix Warehouse",
                    city: "Uttara Kannada",
                    pin_code: "581320",
                    country: "India",
                    phone_number: "9876543210",
                },
            };

            const response = await axios.post(
                `${this.config.baseUrl}/cmu/create.json`,
                { format: "json", data: JSON.stringify(payload) },
                {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Token ${this.config.apiKey}`,
                    },
                }
            );

            const waybill = response.data.packages[0].waybill;
            const shipmentId = response.data.packages[0].refnum;

            // Save to database
            await db.execute(sql`
        INSERT INTO shipments (
          order_id, waybill, shipment_id, carrier, status, created_at
        ) VALUES (
          ${orderData.orderId}, ${waybill}, ${shipmentId}, 'delhivery', 'created', NOW()
        )
      `);

            return { waybill, shipmentId };
        } catch (error: any) {
            throw new Error(`Delhivery shipment creation failed: ${error.message}`);
        }
    }

    /**
     * Track shipment
     */
    static async trackShipment(waybill: string): Promise<any> {
        try {
            const response = await axios.get(
                `${this.config.baseUrl}/v1/packages/json/?waybill=${waybill}`,
                {
                    headers: {
                        Authorization: `Token ${this.config.apiKey}`,
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
     * Get shipment tracking for order (from database)
     */
    static async getShipmentByOrder(orderId: string): Promise<any> {
        const [shipment] = await db.execute(sql`
      SELECT * FROM shipments
      WHERE order_id = ${orderId}
      ORDER BY created_at DESC
      LIMIT 1
    `);

        if (!shipment) {
            return null;
        }

        // Get live tracking from Delhivery
        const liveTracking = await this.trackShipment(shipment.waybill);

        return {
            ...shipment,
            liveTracking,
        };
    }
}
