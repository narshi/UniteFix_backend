/**
 * PHASE 7: Support Ticketing System
 * 
 * Handles:
 * - Customer ticket creation
 * - Admin ticket management
 * - Email integration (notifications)
 * - Ticket conversation threads
 */

import { db } from "../db";
import { sql, eq, and, desc } from "drizzle-orm";
import nodemailer from "nodemailer";

interface TicketCreate {
    userId: number;
    subject: string;
    description: string;
    category: "service" | "product" | "payment" | "general";
    serviceRequestId?: number;
    productOrderId?: number;
}

export class SupportTicketService {
    /**
     * Create support ticket
     */
    static async createTicket(data: TicketCreate): Promise<any> {
        const ticketId = `TKT-${Date.now()}-${data.userId}`;

        const [ticket] = await db.execute(sql`
      INSERT INTO support_tickets (
        ticket_id, user_id, subject, description, category,
        service_request_id, product_order_id, status, priority
      ) VALUES (
        ${ticketId}, ${data.userId}, ${data.subject}, ${data.description},
        ${data.category}, ${data.serviceRequestId || null}, 
        ${data.productOrderId || null}, 'open', 'medium'
      )
      RETURNING *
    `);

        // Send email notification to admin
        await this.sendTicketNotification(ticket);

        return ticket;
    }

    /**
     * Get all tickets (admin view)
     */
    static async getTickets(
        status?: string,
        category?: string,
        page: number = 1,
        limit: number = 20
    ): Promise<{ tickets: any[]; total: number; page: number; pages: number }> {
        const offset = (page - 1) * limit;

        const conditions: string[] = [];
        if (status) conditions.push(`status = '${status}'`);
        if (category) conditions.push(`category = '${category}'`);

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        // Get total
        const [countResult] = await db.execute(sql`
      SELECT COUNT(*) as count FROM support_tickets ${sql.raw(whereClause)}
    `);

        const total = parseInt(countResult?.count || "0");

        // Get tickets
        const tickets = await db.execute(sql`
      SELECT 
        st.*,
        u.name as customer_name,
        u.email as customer_email
      FROM support_tickets st
      LEFT JOIN users u ON st.user_id = u.id
      ${sql.raw(whereClause)}
      ORDER BY 
        CASE WHEN st.priority = 'urgent' THEN 1
             WHEN st.priority = 'high' THEN 2
             WHEN st.priority = 'medium' THEN 3
             ELSE 4 END,
        st.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

        const pages = Math.ceil(total / limit);

        return { tickets, total, page, pages };
    }

    /**
     * Get ticket details with messages
     */
    static async getTicketDetails(ticketId: string): Promise<any> {
        const [ticket] = await db.execute(sql`
      SELECT * FROM support_tickets WHERE ticket_id = ${ticketId}
    `);

        if (!ticket) {
            throw new Error("Ticket not found");
        }

        // Get messages
        const messages = await db.execute(sql`
      SELECT * FROM ticket_messages
      WHERE ticket_id = ${ticket.id}
      ORDER BY created_at ASC
    `);

        return { ticket, messages };
    }

    /**
     * Add message to ticket
     */
    static async addMessage(
        ticketId: string,
        message: string,
        senderType: "customer" | "admin" | "system",
        senderId?: number,
        isInternal: boolean = false
    ): Promise<any> {
        const [ticket] = await db.execute(sql`
      SELECT id FROM support_tickets WHERE ticket_id = ${ticketId}
    `);

        if (!ticket) {
            throw new Error("Ticket not found");
        }

        const [msg] = await db.execute(sql`
      INSERT INTO ticket_messages (
        ticket_id, sender_type, sender_id, message, is_internal
      ) VALUES (
        ${ticket.id}, ${senderType}, ${senderId || null}, ${message}, ${isInternal}
      )
      RETURNING *
    `);

        // Send email notification
        if (senderType === "admin" && !isInternal) {
            await this.sendReplyNotification(ticketId, message);
        }

        return msg;
    }

    /**
     * Update ticket status
     */
    static async updateTicketStatus(
        ticketId: string,
        newStatus: "open" | "in_progress" | "resolved" | "closed",
        adminId: number
    ): Promise<any> {
        const [ticket] = await db.execute(sql`
      UPDATE support_tickets
      SET status = ${newStatus},
          assigned_to = ${adminId},
          resolved_at = ${newStatus === "resolved" ? new Date() : null},
          updated_at = NOW()
      WHERE ticket_id = ${ticketId}
      RETURNING *
    `);

        return ticket;
    }

    /**
     * Send ticket creation notification (email)
     */
    private static async sendTicketNotification(ticket: any): Promise<void> {
        // Email configuration (would use nodemailer)
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: parseInt(process.env.SMTP_PORT || "587"),
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        try {
            await transporter.sendMail({
                from: '"UniteFix Support" <support@unitefix.com>',
                to: process.env.ADMIN_EMAIL || "admin@unitefix.com",
                subject: `New Support Ticket: ${ticket.ticket_id}`,
                html: `
          <h2>New Support Ticket</h2>
          <p><strong>Ticket ID:</strong> ${ticket.ticket_id}</p>
          <p><strong>Category:</strong> ${ticket.category}</p>
          <p><strong>Subject:</strong> ${ticket.subject}</p>
          <p><strong>Description:</strong></p>
          <p>${ticket.description}</p>
          <br>
          <p><a href="https://admin.unitefix.com/tickets/${ticket.ticket_id}">View Ticket</a></p>
        `,
            });
        } catch (error) {
            console.error("Email notification failed:", error);
            // Don't throw - ticket creation should succeed even if email fails
        }
    }

    /**
     * Send reply notification to customer
     */
    private static async sendReplyNotification(ticketId: string, message: string): Promise<void> {
        const [ticket] = await db.execute(sql`
      SELECT st.*, u.email, u.name
      FROM support_tickets st
      JOIN users u ON st.user_id = u.id
      WHERE st.ticket_id = ${ticketId}
    `);

        if (!ticket || !ticket.email) return;

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: parseInt(process.env.SMTP_PORT || "587"),
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        try {
            await transporter.sendMail({
                from: '"UniteFix Support" <support@unitefix.com>',
                to: ticket.email,
                subject: `Re: ${ticket.subject} [${ticketId}]`,
                html: `
          <p>Hi ${ticket.name},</p>
          <p>You have a new reply on your support ticket:</p>
          <blockquote>${message}</blockquote>
          <br>
          <p><a href="https://app.unitefix.com/tickets/${ticketId}">View Ticket</a></p>
          <p>Best regards,<br>UniteFix Support  Team</p>
        `,
            });
        } catch (error) {
            console.error("Email notification failed:", error);
        }
    }
}
