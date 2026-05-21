const rateLimit = require('express-rate-limit');
const logger = require('../config/logger');

/**
 * Skip function for tests. Honors a special header — only when NODE_ENV
 * is NOT 'production'. The header value must match TEST_BYPASS_SECRET.
 * This lets the E2E test script bypass rate limits without forcing the
 * server to run in NODE_ENV=test.
 */
const skipForTesting = (req) => {
  if (process.env.NODE_ENV === 'production') return false;
  const secret = process.env.TEST_BYPASS_SECRET;
  if (!secret) return false;
  return req.headers['x-test-bypass-ratelimit'] === secret;
};

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 100000 : 300,
  standardHeaders: true,    // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,
  skip: skipForTesting,
  message: {
    status: 'error',
    message: 'Too many requests from this IP. Please try again after 15 minutes.',
  },
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip} on ${req.path}`);
    res.status(options.statusCode).json(options.message);
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins against the limit
  skip: skipForTesting,
  message: {
    status: 'error',
    message: 'Too many authentication attempts. Please try again after 15 minutes.',
  },
  handler: (req, res, next, options) => {
    logger.warn(`Auth rate limit hit for IP: ${req.ip} on ${req.path}`);
    res.status(options.statusCode).json(options.message);
  },
});

module.exports = { generalLimiter, authLimiter };
