/**
 * Database Transaction Helper
 * 
 * Wraps critical multi-step operations in PostgreSQL transactions
 * to ensure atomicity (all succeed or all rollback).
 * 
 * Usage:
 *   const result = await withTransaction(async (tx) => {
 *     await tx.insert(users).values(...);
 *     await tx.update(wallets).set(...).where(...);
 *     return { success: true };
 *   });
 */

import { pool, db } from "../db";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import logger from "../lib/logger";

type TransactionCallback<T> = (tx: typeof db) => Promise<T>;

/**
 * Execute a callback within a database transaction.
 * If the callback throws, the transaction is rolled back.
 * If the callback returns, the transaction is committed.
 */
export async function withTransaction<T>(
    callback: TransactionCallback<T>,
    description?: string
): Promise<T> {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        logger.debug(`Transaction started${description ? `: ${description}` : ''}`);

        // Create a transaction-scoped Drizzle instance
        const txDb = drizzle(client, { schema });

        const result = await callback(txDb as unknown as typeof db);

        await client.query('COMMIT');
        logger.debug(`Transaction committed${description ? `: ${description}` : ''}`);

        return result;
    } catch (error: any) {
        await client.query('ROLLBACK');
        logger.error(`Transaction rolled back${description ? `: ${description}` : ''}`, {
            error: error.message,
        });
        throw error;
    } finally {
        client.release();
    }
}
