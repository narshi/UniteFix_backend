import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { pool } from "./db";
import logger from "./lib/logger";
import { startBackgroundJobs, stopBackgroundJobs } from "./services/task_queues";
import { requestIdMiddleware } from "./middleware/request-id";

const app = express();

const isProduction = process.env.NODE_ENV === 'production';

// Security headers — CSP enabled in production, disabled in dev (Vite needs inline scripts)
app.use(helmet({
  contentSecurityPolicy: isProduction
    ? {
      useDefaults: true,
      directives: {
        // Helmet's default img-src is ["'self'", "data:"], which blocked every
        // remotely-hosted image in the admin dashboard: Cloudinary avatars and
        // KYC documents, and external product catalog images. They render as
        // broken images in production without this.
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      },
    }
    : false,
}));

// CORS — allow admin dashboard + React Native app
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5000",
  "http://localhost:5001",
  "http://localhost:8081", // React Native Metro
  process.env.CLIENT_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS not allowed"));
    }
  },
  credentials: true,
}));

// P2: Request correlation ID — attaches X-Request-Id to every request
app.use(requestIdMiddleware);

// P0: Body size limit to prevent DoS via large payloads
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// P1: Health check endpoint (before auth/logging middleware)
app.get("/api/health", async (_req: Request, res: Response) => {
  try {
    // Quick DB ping
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || "1.0.0",
    });
  } catch (error: any) {
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

// P1: Google Play Account Deletion Requirement
app.get("/delete-account", (_req: Request, res: Response) => {
  res.send(`
    <html>
      <head>
        <title>Delete Account - UniteFix</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: system-ui, sans-serif; padding: 40px 20px; max-width: 600px; margin: 0 auto; line-height: 1.6; color: #333; }
          h1 { color: #153980; }
          .container { background: #f9f9f9; padding: 30px; border-radius: 12px; border: 1px solid #eee; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Request Account Deletion</h1>
          <p>If you would like to permanently delete your UniteFix account and all associated data, please contact our support team.</p>
          <p><strong>Email:</strong> <a href="mailto:support@unitefix.com">support@unitefix.com</a></p>
          <p>Please include your registered phone number in the email. Our team will process your deletion request within 48 hours.</p>
        </div>
      </body>
    </html>
  `);
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api") && path !== "/api/health") {
      const meta: Record<string, any> = {
        requestId: req.requestId,
        method: req.method,
        path,
        status: res.statusCode,
        duration: `${duration}ms`,
      };

      if (res.statusCode >= 400 && capturedJsonResponse) {
        meta.response = capturedJsonResponse;
      }

      if (res.statusCode >= 500) {
        logger.error(`${req.method} ${path} ${res.statusCode}`, meta);
      } else if (res.statusCode >= 400) {
        logger.warn(`${req.method} ${path} ${res.statusCode}`, meta);
      } else {
        logger.info(`${req.method} ${path} ${res.statusCode}`, meta);
      }
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  // Global JSON Error Handler — ALWAYS returns JSON, never HTML
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', {
      message: err.message,
      stack: isProduction ? undefined : err.stack,
    });

    const status = err.status || err.statusCode || 500;
    const message = isProduction && status === 500
      ? "Internal Server Error"
      : err.message || "Internal Server Error";

    res.status(status).json({
      success: false,
      message: message
    });
  });

  // Catch-all for undefined API routes to return 404 JSON instead of HTML
  app.use("/api/*", (req: Request, res: Response) => {
    res.status(404).json({ success: false, message: "API endpoint not found" });
  });

  // Setup Vite in development, static serving in production
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  server.listen(port, "0.0.0.0", () => {
    logger.info(`Server started`, { port, env: process.env.NODE_ENV || 'development' });
    // Start background jobs after server is listening
    startBackgroundJobs();
  });

  // P1: Graceful shutdown — drain connections, close DB pool
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(async () => {
      logger.info('HTTP server closed');

      // Stop background jobs
      stopBackgroundJobs();

      try {
        await pool.end();
        logger.info('Database pool closed');
      } catch (err: any) {
        logger.error('Error closing DB pool', { error: err.message });
      }

      process.exit(0);
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Graceful shutdown timeout. Forcing exit.');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})();
