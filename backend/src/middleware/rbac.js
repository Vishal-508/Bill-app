const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

/**
 * Middleware factory: allow(...roles)
 * Restricts route to users with one of the specified roles.
 *
 * Usage:
 *   router.delete('/users/:id', protect, allow('SUPER_ADMIN'), deleteUser);
 *   router.get('/orders', protect, allow('ADMIN', 'BILLING', 'CUTTING'), listOrders);
 *
 * Must be used AFTER protect middleware (needs req.user).
 */
exports.allow = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      // Defensive — should never happen if protect ran first
      return next(ApiError.unauthorized('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(
        `RBAC denied: ${req.user.email} (${req.user.role}) tried to access ${req.method} ${req.originalUrl} — requires one of [${allowedRoles.join(', ')}]`
      );
      return next(
        ApiError.forbidden(
          `Access denied. This action requires one of: ${allowedRoles.join(', ')}`
        )
      );
    }

    next();
  };
};

/**
 * Middleware factory: deny(...roles)
 * Opposite of allow — blocks specific roles.
 *
 * Usage:
 *   router.post('/sensitive', protect, deny('CUTTING', 'DELIVERY'), handler);
 */
exports.deny = (...deniedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    if (deniedRoles.includes(req.user.role)) {
      logger.warn(
        `RBAC denied: ${req.user.email} (${req.user.role}) blocked from ${req.method} ${req.originalUrl}`
      );
      return next(ApiError.forbidden('Access denied for your role.'));
    }

    next();
  };
};

/**
 * Middleware: requireSuperAdmin
 * Shorthand for allow('SUPER_ADMIN') — used frequently
 */
exports.requireSuperAdmin = exports.allow('SUPER_ADMIN');

/**
 * Middleware: requireAdmin
 * Allows SUPER_ADMIN or ADMIN (admin-level actions)
 */
exports.requireAdmin = exports.allow('SUPER_ADMIN', 'ADMIN');

/**
 * Middleware: requireStaff
 * Allows any authenticated staff (any role)
 * Effectively same as just protect, but explicit for readability
 */
exports.requireStaff = (req, res, next) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required'));
  }
  next();
};

/**
 * Helper: Check if user owns a resource OR has admin role
 * Use within controllers when you need conditional access logic.
 *
 * Usage in controller:
 *   if (!ownsOrAdmin(req.user, order.assignedTo)) {
 *     throw ApiError.forbidden('You can only view your own orders');
 *   }
 */
exports.ownsOrAdmin = (user, resourceUserId) => {
  if (!user || !resourceUserId) return false;
  if (['SUPER_ADMIN', 'ADMIN'].includes(user.role)) return true;
  return user._id.toString() === resourceUserId.toString();
};
