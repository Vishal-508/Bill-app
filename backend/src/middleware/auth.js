const { User } = require('../models');
const { verifyAccessToken, extractTokenFromHeader } = require('../utils/jwt');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

/**
 * Middleware: protect()
 * Verifies the Authorization header JWT and attaches the user to req.user
 *
 * Usage:
 *   router.get('/me', protect, (req, res) => res.json(req.user));
 *
 * Throws:
 *   401 if no token, invalid token, expired token, or user not found
 *   403 if user is inactive or locked
 */
exports.protect = asyncHandler(async (req, res, next) => {
  // 1. Extract token from Authorization header
  const authHeader = req.headers.authorization;
  const token = extractTokenFromHeader(authHeader);

  if (!token) {
    throw ApiError.unauthorized('Authentication required. Please log in.');
  }

  // 2. Verify JWT signature + expiry
  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (error) {
    // Map JWT errors to 401 with clear messages
    logger.warn(`Token verification failed: ${error.message} from ${req.ip}`);
    throw ApiError.unauthorized(error.message);
  }

  // 3. Look up user in DB (fresh data, not stale token claims)
  // We re-fetch every time so role changes/deactivation take effect immediately
  const user = await User.findById(decoded.sub);

  if (!user) {
    logger.warn(`Token references non-existent user: ${decoded.sub}`);
    throw ApiError.unauthorized('User no longer exists');
  }

  // 4. Check user is still active
  if (!user.isActive) {
    logger.warn(`Inactive user attempted access: ${user.email}`);
    throw ApiError.forbidden('Account is inactive. Contact administrator.');
  }

  // 5. Check user isn't locked (covers post-token-issuance locks)
  if (user.isLocked && user.isLocked()) {
    throw ApiError.forbidden('Account is locked. Try again later.');
  }

  // 6. Optional: Check if password was changed AFTER token was issued
  // If so, invalidate the token (forces re-login on password change)
  if (user.passwordChangedAt && decoded.iat) {
    const passwordChangedTimestamp = Math.floor(user.passwordChangedAt.getTime() / 1000);
    if (passwordChangedTimestamp > decoded.iat) {
      throw ApiError.unauthorized('Password was changed. Please log in again.');
    }
  }

  // 7. Attach user + token info to request
  req.user = user;
  req.token = decoded;

  next();
});

/**
 * Middleware: optionalAuth()
 * Like protect() but doesn't throw if no token — just leaves req.user undefined.
 * Useful for routes that behave differently for logged-in vs anonymous users.
 */
exports.optionalAuth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = extractTokenFromHeader(authHeader);

  if (!token) {
    return next(); // No token = anonymous, proceed
  }

  try {
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.sub);
    if (user && user.isActive) {
      req.user = user;
      req.token = decoded;
    }
  } catch (error) {
    // Silent failure — anonymous request
    logger.debug(`Optional auth failed: ${error.message}`);
  }

  next();
});
