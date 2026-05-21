/**
 * Custom error class for API errors with HTTP status codes.
 * Used throughout the app for consistent error responses.
 */
class ApiError extends Error {
  constructor(statusCode, message, errors = null, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;          // Field-level errors (for validation)
    this.isOperational = isOperational;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  // Common factories for readability
  static badRequest(message, errors) { return new ApiError(400, message, errors); }
  static unauthorized(message = 'Unauthorized') { return new ApiError(401, message); }
  static forbidden(message = 'Forbidden') { return new ApiError(403, message); }
  static notFound(message = 'Resource not found') { return new ApiError(404, message); }
  static conflict(message = 'Conflict') { return new ApiError(409, message); }
  static tooManyRequests(message = 'Too many requests') { return new ApiError(429, message); }
  static internal(message = 'Internal server error') { return new ApiError(500, message, null, false); }
}

module.exports = ApiError;
