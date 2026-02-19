/**
 * Request Correlation ID Middleware — P2-11 fix
 * 
 * Attaches a unique X-Request-Id to every incoming request.
 * If the client already sends X-Request-Id (e.g., mobile app), it is preserved.
 * This ID is used by the logger to correlate all log entries from the same request.
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare global {
    namespace Express {
        interface Request {
            requestId?: string;
        }
    }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
}
