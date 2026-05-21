const { ZodError } = require('zod');
const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

/**
 * 404 handler — called when no route matches
 * Must be added AFTER all routes but BEFORE errorHandler
 */
const notFoundHandler = (req, res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

/**
 * Global error handler — must be the LAST middleware in the stack.
 * Maps various error types to consistent JSON responses with proper status codes.
 */
const errorHandler = (err, req, res, next) => {
  let error = err;

  // ═══ 1. ApiError — our custom errors (already have statusCode + message) ═══
  if (error instanceof ApiError) {
    // Already properly formatted, just send it
    return sendError(req, res, error);
  }

  // ═══ 2. Mongoose ValidationError ═══
  // Triggered by required, min, max, enum, custom validators in schemas
  if (error instanceof mongoose.Error.ValidationError) {
    const errors = {};
    Object.keys(error.errors).forEach((key) => {
      errors[key] = error.errors[key].message;
    });
    error = ApiError.badRequest('Validation failed', errors);
    return sendError(req, res, error);
  }

  // ═══ 3. Mongoose CastError ═══
  // Triggered by invalid ObjectId, invalid type cast, etc.
  if (error instanceof mongoose.Error.CastError) {
    error = ApiError.badRequest(
      `Invalid ${error.path}: ${error.value} is not a valid ${error.kind}`
    );
    return sendError(req, res, error);
  }

  // ═══ 4. Mongo duplicate key (code 11000) ═══
  if (error.code === 11000 || error.code === 11001) {
    const field = Object.keys(error.keyValue || {})[0] || 'field';
    const value = error.keyValue ? error.keyValue[field] : '';
    error = ApiError.conflict(
      `${field} '${value}' already exists. Please use a different ${field}.`
    );
    return sendError(req, res, error);
  }

  // ═══ 5. Zod errors (shouldn't normally reach here — validate middleware handles them) ═══
  if (error instanceof ZodError) {
    const errors = {};
    error.errors.forEach((err) => {
      const path = err.path.join('.');
      if (!errors[path]) errors[path] = err.message;
    });
    error = ApiError.badRequest('Validation failed', errors);
    return sendError(req, res, error);
  }

  // ═══ 6. JWT errors (shouldn't normally reach here — protect middleware catches them) ═══
  if (error.name === 'JsonWebTokenError') {
    error = ApiError.unauthorized('Invalid token');
    return sendError(req, res, error);
  }
  if (error.name === 'TokenExpiredError') {
    error = ApiError.unauthorized('Token has expired');
    return sendError(req, res, error);
  }

  // ═══ 7. CORS errors ═══
  if (error.message && error.message.includes('not allowed by CORS')) {
    error = ApiError.forbidden(error.message);
    return sendError(req, res, error);
  }

  // ═══ 8. Body parser errors (oversized payload, malformed JSON, etc.) ═══
  if (error.type === 'entity.too.large') {
    error = ApiError.badRequest('Request body too large (max 1MB)');
    return sendError(req, res, error);
  }
  if (error.type === 'entity.parse.failed') {
    error = ApiError.badRequest('Malformed JSON in request body');
    return sendError(req, res, error);
  }

  // ═══ 9. Fallback — unknown errors become 500 Internal Server Error ═══
  // Log full details, but don't leak them to client
  logger.error(`UNHANDLED ERROR: ${error.message}`, {
    name: error.name,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    user: req.user?.email || 'anonymous',
  });

  error = ApiError.internal(
    process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred. Please try again.'
      : error.message
  );
  return sendError(req, res, error);
};

/**
 * Helper: Send a consistent error response.
 * Includes stack trace in non-production environments for debugging.
 */
const sendError = (req, res, error) => {
  // Log non-500 errors at warn, 500+ at error level
  const logLevel = error.statusCode >= 500 ? 'error' : 'warn';
  logger[logLevel](
    `${error.statusCode} ${error.message} - ${req.method} ${req.originalUrl} - IP: ${req.ip}`
  );

  const response = {
    status: 'error',
    message: error.message,
  };

  // Include field errors if present (validation errors)
  if (error.errors) {
    response.errors = error.errors;
  }

  // Include stack only in non-production
  if (process.env.NODE_ENV !== 'production' && error.stack) {
    response.stack = error.stack.split('\n').slice(0, 10); // First 10 lines
  }

  res.status(error.statusCode).json(response);
};

module.exports = {
  notFoundHandler,
  errorHandler,
};
