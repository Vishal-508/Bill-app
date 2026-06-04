require('dotenv').config();

// Workaround: Node c-ares defaults to 127.0.0.1 on this Windows host
// (likely leftover state from previous DNS proxy install).
// Only needed in local development; production DNS is reliable.
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');

const connectDB = require('./config/db');
const logger = require('./config/logger');
const morganLogger = require('./middleware/morganLogger');
const { generalLimiter } = require('./middleware/rateLimiters');

const app = express();
const PORT = process.env.PORT || 5000;
const startedAt = Date.now();

// Trust proxy — important if behind Render/Vercel/nginx (correct IP detection for rate limiter)
app.set('trust proxy', 1);

// ═══ Security Middleware ═══

// 1. Helmet — sets various HTTP security headers
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// 2. CORS — whitelist frontend URLs
const allowedOrigins = [
  process.env.FRONTEND_ADMIN_URL,
  process.env.FRONTEND_CUSTOMER_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// 3. Compression — gzip responses
app.use(compression());

// 4. HTTP request logging
app.use(morganLogger);

// 5. Razorpay webhook MUST receive raw body (signature verification)
// This MUST come BEFORE express.json()
app.use('/api/payments/webhook/razorpay', express.raw({ type: 'application/json' }));

// 5b. Section D webhook endpoint — same raw-body requirement
app.use('/api/webhooks/razorpay',
  express.raw({
    type: 'application/json',
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// 5c. WhatsApp Cloud API webhook (Prompt 7 Section C) — Meta sends
// x-hub-signature-256 HMAC of the raw JSON bytes. Must run BEFORE
// express.json() so we get a Buffer body for signature verification.
app.use('/api/whatsapp/webhook',
  express.raw({
    type: 'application/json',
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// 6. Body parsers with size limits (DoS protection)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 7. MongoDB sanitization (prevent NoSQL injection by stripping $ and . from keys)
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    logger.warn(`Sanitized prohibited key in request: ${key} from ${req.ip}`);
  },
}));

// 8. General rate limiter on all routes
app.use(generalLimiter);

// ═══ Routes ═══

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: (Date.now() - startedAt) / 1000,
    environment: process.env.NODE_ENV || 'development',
    database: require('mongoose').connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// ═══ API Routes ═══
const apiRoutes = require('./routes');
app.use('/api', apiRoutes);

// ═══ Cron Jobs (Prompts 7 G + 8 F — register on import, skipped in test) ═══
require('./jobs/notificationRetry.cron');
require('./jobs/dailyForecast.cron');
require('./jobs/dailyAnalytics.cron');
require('./jobs/weeklyAdminReport.cron');

// ═══ 404 handler (must be after all routes) ═══
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
app.use(notFoundHandler);

// ═══ Global error handler (must be LAST) ═══
app.use(errorHandler);

// ═══ Server Startup ═══

const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`📍 Health check: http://localhost:${PORT}/api/health`);
      logger.info(`🛡️  Security middleware: helmet, cors, rate-limit, mongo-sanitize, compression`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// ═══ Graceful Shutdown ═══
const { closeBrowser } = require('./utils/pdfService');

async function gracefulShutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);

  try {
    await closeBrowser();
  } catch (err) {
    logger.error('Error during shutdown:', err);
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
