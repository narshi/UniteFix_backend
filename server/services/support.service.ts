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
  /** Columns the Support Tickets table may be sorted by. */
  static readonly SORTABLE = {
    createdAt: supportTickets.createdAt,
    ticketId: supportTickets.ticketId,
    status: supportTickets.status,
    priority: supportTickets.priority,
    category: supportTickets.category,
  };

  static async getTickets(
    status?: string,
    category?: string,
    page: number = 1,
    limit: number = 20,
    options: { q?: string; from?: Date; to?: Date; orderBy?: any } = {},
  ): Promise<{ tickets: any[]; total: number; page: number; pages: number }> {
    const offset = (page - 1) * limit;
    const conditions: any[] = [];

    if (status) conditions.push(eq(supportTickets.status, status as any));
    if (category) conditions.push(eq(supportTickets.category, category as any));

    if (options.q) {
      const term = `%${options.q}%`;
      conditions.push(sql`(
        ${supportTickets.ticketId} ILIKE ${term}
        OR ${supportTickets.subject} ILIKE ${term}
        OR ${supportTickets.description} ILIKE ${term}
        OR EXISTS (SELECT 1 FROM users u WHERE u.id = ${supportTickets.userId}
                   AND (u.username ILIKE ${term} OR u.email ILIKE ${term}))
      )`);
    }

    if (options.from) conditions.push(sql`${supportTickets.createdAt} >= ${options.from}`);
    if (options.to) conditions.push(sql`${supportTickets.createdAt} <= ${options.to}`);

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(supportTickets)
      .where(whereCondition);

    const total = Number(countResult?.count || 0);

    // Get tickets with user info
    const rows = await db
      .select({
        ticket: supportTickets,
        customerName: users.username,
        customerEmail: users.email,
        customerPhone: users.phone,
      })
      .from(supportTickets)
      .leftJoin(users, eq(supportTickets.userId, users.id))
      .where(whereCondition)
      // Default keeps urgent tickets on top; an explicit sort from the admin
      // table replaces it entirely, since mixing the two would make a "sort by
      // date" click appear not to work for anything below an urgent ticket.
      .orderBy(
        ...(options.orderBy
          ? [options.orderBy]
          : [
            sql`CASE WHEN ${supportTickets.priority} = 'urgent' THEN 1
                     WHEN ${supportTickets.priority} = 'high' THEN 2
                     WHEN ${supportTickets.priority} = 'medium' THEN 3
                     ELSE 4 END`,
            desc(supportTickets.createdAt),
          ])
      )
      .limit(limit)
      .offset(offset);

    // Flattened to the shape the admin table actually renders. The query
    // returns { ticket, customerName, ... }, so every field the page reads
    // (status, subject, createdAt) was undefined — `ticket.status.replace(...)`
    // threw and took the whole page down as soon as a single ticket existed.
    const tickets = rows.map(({ ticket, customerName, customerEmail, customerPhone }) => ({
      ...ticket,
      user: {
        fullName: customerName ?? 'Unknown',
        phone: customerPhone ?? '',
        email: customerEmail ?? '',
        role: 'user',
      },
      // Kept alongside `user` so any existing caller reading the flat aliases
      // does not break.
      customerName,
      customerEmail,
    }));

    const pages = Math.ceil(total / limit);

    return { tickets, total, page, pages };
  }

  /**
   * Get ticket details with messages
   */

  /**
   * Resolve a ticket by EITHER its numeric primary key or its public reference
   * ("TKT-0001").
   *
   * The admin table renders rows keyed on the numeric id and passes that to
   * every detail/status/reply call, while these lookups matched only on the
   * text ticketId — so opening a ticket always 404'd and the modal stayed
   * empty. Accepting both means neither caller has to know which it holds.
   */
  private static async resolveTicket(idOrRef: string | number) {
    const asNumber = Number(idOrRef);
    const where = Number.isInteger(asNumber) && String(idOrRef).trim() !== ''
      ? eq(supportTickets.id, asNumber)
      : eq(supportTickets.ticketId, String(idOrRef));

    const [ticket] = await db.select().from(supportTickets).where(where).limit(1);
    return ticket;
  }

  static async getTicketDetails(idOrRef: string | number): Promise<any> {
    const ticket = await this.resolveTicket(idOrRef);

    if (!ticket) {
      throw new Error("Ticket not found");
    }

    const messages = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticket.id))
      .orderBy(asc(ticketMessages.createdAt));

    const [customer] = await db
      .select({ username: users.username, phone: users.phone, email: users.email })
      .from(users)
      .where(eq(users.id, ticket.userId))
      .limit(1);

    // Returned BOTH nested and flattened. The admin modal reads a single object
    // with .messages and .user on it, so handing back only { ticket, messages }
    // meant the reply thread and the customer name silently vanished.
    const flat = {
      ...ticket,
      messages,
      user: {
        fullName: customer?.username ?? 'Unknown',
        phone: customer?.phone ?? '',
        email: customer?.email ?? '',
        role: 'user',
      },
    };

    // Spread first so `flat`'s own `messages` is not overwritten by the
    // explicit key, then re-expose the nested shape older callers expect.
    return { ...flat, ticket: flat, messages };
  }

  /**
   * Add message to ticket
   */
  static async addMessage(
    idOrRef: string | number,
    message: string,
    senderType: "customer" | "admin" | "system",
    senderId?: number,
    isInternal: boolean = false
  ): Promise<any> {
    // Same numeric-id-vs-reference problem as the detail lookup: the admin modal
    // replies using the numeric id, so matching only on ticketId meant every
    // reply from the dashboard failed with "Ticket not found".
    const ticket = await this.resolveTicket(idOrRef);

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

    // Update ticket timestamp — keyed on the resolved row, so it works whether
    // the caller passed a numeric id or a TKT- reference.
    await db
      .update(supportTickets)
      .set({ updatedAt: new Date() })
      .where(eq(supportTickets.id, ticket.id));

    // Send email notification
    if (senderType === "admin" && !isInternal) {
      await this.sendReplyNotification(ticket.ticketId, message);
    }

    return msg;
  }

  /**
   * Update ticket status
   */
  static async updateTicketStatus(
    idOrRef: string | number,
    newStatus: "open" | "in_progress" | "escalated" | "resolved" | "closed",
    adminId?: number | null
  ): Promise<any> {
    const existing = await this.resolveTicket(idOrRef);
    if (!existing) {
      throw new Error("Ticket not found");
    }

    const [ticket] = await db
      .update(supportTickets)
      .set({
        status: newStatus,
        // Only claim the ticket when we actually know who acted. The admin
        // routes were reading req.user.id, which does not exist on the admin
        // shim (it is userId), so this was writing null over the assignee.
        ...(adminId ? { assignedTo: adminId } : {}),
        // Stamp on resolve, and PRESERVE it afterwards. Previously any move to
        // a non-resolved status wrote null, so closing a resolved ticket erased
        // the moment it was resolved.
        ...(newStatus === "resolved"
          ? { resolvedAt: new Date() }
          : newStatus === "closed"
            ? {}
            : { resolvedAt: null }),
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.id, existing.id))
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
