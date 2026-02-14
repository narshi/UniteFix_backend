/**
 * PHASE 7: Support Ticketing System
 * 
 * Handles:
 * - Customer ticket creation
 * - Admin ticket management
 * - Email integration (notifications)
 * - Ticket conversation threads
 * 
 * Now uses Drizzle ORM with proper schema tables.
 */

import { db } from "../db";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import { supportTickets, ticketMessages, users } from "@shared/schema";
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

    const [ticket] = await db.insert(supportTickets).values({
      ticketId,
      userId: data.userId,
      subject: data.subject,
      description: data.description,
      category: data.category,
      serviceRequestId: data.serviceRequestId || null,
      productOrderId: data.productOrderId || null,
      status: 'open',
      priority: 'medium',
    }).returning();

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
    const conditions: any[] = [];

    if (status) conditions.push(eq(supportTickets.status, status as any));
    if (category) conditions.push(eq(supportTickets.category, category as any));

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(supportTickets)
      .where(whereCondition);

    const total = Number(countResult?.count || 0);

    // Get tickets with user info
    const tickets = await db
      .select({
        ticket: supportTickets,
        customerName: users.username,
        customerEmail: users.email,
      })
      .from(supportTickets)
      .leftJoin(users, eq(supportTickets.userId, users.id))
      .where(whereCondition)
      .orderBy(
        sql`CASE WHEN ${supportTickets.priority} = 'urgent' THEN 1
                     WHEN ${supportTickets.priority} = 'high' THEN 2
                     WHEN ${supportTickets.priority} = 'medium' THEN 3
                     ELSE 4 END`,
        desc(supportTickets.createdAt)
      )
      .limit(limit)
      .offset(offset);

    const pages = Math.ceil(total / limit);

    return { tickets, total, page, pages };
  }

  /**
   * Get ticket details with messages
   */
  static async getTicketDetails(ticketIdStr: string): Promise<any> {
    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.ticketId, ticketIdStr))
      .limit(1);

    if (!ticket) {
      throw new Error("Ticket not found");
    }

    // Get messages
    const messages = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticket.id))
      .orderBy(asc(ticketMessages.createdAt));

    return { ticket, messages };
  }

  /**
   * Add message to ticket
   */
  static async addMessage(
    ticketIdStr: string,
    message: string,
    senderType: "customer" | "admin" | "system",
    senderId?: number,
    isInternal: boolean = false
  ): Promise<any> {
    const [ticket] = await db
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(eq(supportTickets.ticketId, ticketIdStr))
      .limit(1);

    if (!ticket) {
      throw new Error("Ticket not found");
    }

    const [msg] = await db.insert(ticketMessages).values({
      ticketId: ticket.id,
      senderType,
      senderId: senderId || null,
      message,
      isInternal,
    }).returning();

    // Update ticket timestamp
    await db
      .update(supportTickets)
      .set({ updatedAt: new Date() })
      .where(eq(supportTickets.ticketId, ticketIdStr));

    // Send email notification
    if (senderType === "admin" && !isInternal) {
      await this.sendReplyNotification(ticketIdStr, message);
    }

    return msg;
  }

  /**
   * Update ticket status
   */
  static async updateTicketStatus(
    ticketIdStr: string,
    newStatus: "open" | "in_progress" | "resolved" | "closed",
    adminId: number
  ): Promise<any> {
    const [ticket] = await db
      .update(supportTickets)
      .set({
        status: newStatus,
        assignedTo: adminId,
        resolvedAt: newStatus === "resolved" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.ticketId, ticketIdStr))
      .returning();

    return ticket;
  }

  /**
   * Get tickets for a specific user (customer view)
   */
  static async getUserTickets(userId: number): Promise<any[]> {
    return db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.userId, userId))
      .orderBy(desc(supportTickets.createdAt));
  }

  /**
   * Send ticket creation notification (email)
   */
  private static async sendTicketNotification(ticket: any): Promise<void> {
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
        subject: `New Support Ticket: ${ticket.ticketId}`,
        html: `
          <h2>New Support Ticket</h2>
          <p><strong>Ticket ID:</strong> ${ticket.ticketId}</p>
          <p><strong>Category:</strong> ${ticket.category}</p>
          <p><strong>Subject:</strong> ${ticket.subject}</p>
          <p><strong>Description:</strong></p>
          <p>${ticket.description}</p>
          <br>
          <p><a href="https://admin.unitefix.com/tickets/${ticket.ticketId}">View Ticket</a></p>
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
  private static async sendReplyNotification(ticketIdStr: string, message: string): Promise<void> {
    const result = await db
      .select({
        ticketId: supportTickets.ticketId,
        subject: supportTickets.subject,
        email: users.email,
        name: users.username,
      })
      .from(supportTickets)
      .innerJoin(users, eq(supportTickets.userId, users.id))
      .where(eq(supportTickets.ticketId, ticketIdStr))
      .limit(1);

    const ticket = result[0];
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
        subject: `Re: ${ticket.subject} [${ticketIdStr}]`,
        html: `
          <p>Hi ${ticket.name},</p>
          <p>You have a new reply on your support ticket:</p>
          <blockquote>${message}</blockquote>
          <br>
          <p><a href="https://app.unitefix.com/tickets/${ticketIdStr}">View Ticket</a></p>
          <p>Best regards,<br>UniteFix Support Team</p>
        `,
      });
    } catch (error) {
      console.error("Email notification failed:", error);
    }
  }
}
