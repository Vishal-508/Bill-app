const { User } = require('../models');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');
const crypto = require('crypto');

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { user, accessToken, refreshToken }
 */
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Find user with password hash + lock fields included
  const user = await User.findByEmail(email).select(
    '+passwordHash +failedLoginAttempts +lockedUntil'
  );

  // Don't reveal whether email exists — generic message
  if (!user) {
    logger.warn(`Failed login: unknown email (${email}) from ${req.ip}`);
    throw ApiError.unauthorized('Invalid email or password');
  }

  // Check if account is locked
  if (user.isLocked()) {
    const minutesLeft = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    logger.warn(`Login attempt on locked account: ${email} from ${req.ip}`);
    throw ApiError.forbidden(
      `Account is locked due to too many failed attempts. Try again in ${minutesLeft} minute(s).`
    );
  }

  // Check if account is active
  if (!user.isActive) {
    logger.warn(`Login attempt on inactive account: ${email} from ${req.ip}`);
    throw ApiError.forbidden('Account is inactive. Contact administrator.');
  }

  // Verify password
  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    // Increment failed attempts (may lock account)
    await user.incrementFailedAttempts();
    logger.warn(`Failed login: wrong password for ${email} from ${req.ip}`);
    throw ApiError.unauthorized('Invalid email or password');
  }

  // Success — reset failed attempts
  await user.resetFailedAttempts();

  // Generate tokens
  const { accessToken, refreshToken } = generateTokenPair(user);

  // Hash refresh token before storing (security)
  const refreshTokenHash = crypto
    .createHash('sha256')
    .update(refreshToken)
    .digest('hex');

  // Calculate refresh token expiry (7 days)
  const refreshExpiresAt = new Date();
  refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 7);

  // Update user with refresh token + last login info
  user.refreshToken = refreshTokenHash;
  user.refreshTokenExpiresAt = refreshExpiresAt;
  user.lastLoginAt = new Date();
  user.lastLoginIP = req.ip;
  await user.save({ validateBeforeSave: false });

  logger.info(`✅ Successful login: ${email} (${user.role}) from ${req.ip}`);

  // Return user (toJSON auto-hides sensitive fields) + tokens
  res.json({
    status: 'success',
    user: user.toJSON(),
    accessToken,
    refreshToken,
  });
});

/**
 * POST /api/auth/logout
 * Requires: Authorization header with valid access token
 * Clears refresh token from DB
 */
exports.logout = asyncHandler(async (req, res) => {
  // req.user comes from protect middleware (Section F)
  if (req.user) {
    await User.updateOne(
      { _id: req.user._id },
      { $unset: { refreshToken: 1, refreshTokenExpiresAt: 1 } }
    );
    logger.info(`User logged out: ${req.user.email} from ${req.ip}`);
  }

  res.json({ status: 'success', message: 'Logged out successfully' });
});

/**
 * POST /api/auth/refresh
 * Body: { refreshToken }
 * Returns: new { accessToken, refreshToken }
 * Implements refresh token rotation (issues new refresh token, invalidates old)
 */
exports.refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  // Verify token signature + expiry
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (error) {
    logger.warn(`Refresh token verification failed: ${error.message} from ${req.ip}`);
    throw ApiError.unauthorized(error.message);
  }

  // Find user and check stored refresh token hash matches
  const user = await User.findById(decoded.sub).select(
    '+refreshToken +refreshTokenExpiresAt'
  );

  if (!user || !user.isActive) {
    throw ApiError.unauthorized('User not found or inactive');
  }

  // Verify the refresh token matches what's stored (defends against stolen tokens after logout)
  const incomingHash = crypto
    .createHash('sha256')
    .update(refreshToken)
    .digest('hex');

  if (!user.refreshToken || user.refreshToken !== incomingHash) {
    logger.warn(`Refresh token mismatch for user ${user.email} from ${req.ip} — possible token theft`);
    // Clear stored token as safety measure
    user.refreshToken = undefined;
    user.refreshTokenExpiresAt = undefined;
    await user.save({ validateBeforeSave: false });
    throw ApiError.unauthorized('Invalid refresh token. Please log in again.');
  }

  // Check expiry (DB-level — in case JWT lib didn't catch it)
  if (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt < new Date()) {
    throw ApiError.unauthorized('Refresh token has expired. Please log in again.');
  }

  // Generate new token pair (refresh token rotation)
  const tokens = generateTokenPair(user);

  // Store new refresh token hash
  const newRefreshHash = crypto
    .createHash('sha256')
    .update(tokens.refreshToken)
    .digest('hex');

  const newExpiresAt = new Date();
  newExpiresAt.setDate(newExpiresAt.getDate() + 7);

  user.refreshToken = newRefreshHash;
  user.refreshTokenExpiresAt = newExpiresAt;
  await user.save({ validateBeforeSave: false });

  logger.info(`Refresh token rotated for ${user.email} from ${req.ip}`);

  res.json({
    status: 'success',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

/**
 * GET /api/auth/me
 * Requires: Authorization header with valid access token
 * Returns: current user profile
 */
exports.getMe = asyncHandler(async (req, res) => {
  // req.user is attached by protect middleware (Section F)
  // For now, this controller assumes req.user is set — we'll wire middleware in Section F

  if (!req.user) {
    throw ApiError.unauthorized('Not authenticated');
  }

  res.json({
    status: 'success',
    user: req.user.toJSON ? req.user.toJSON() : req.user,
  });
});

/**
 * POST /api/auth/change-password
 * Body: { currentPassword, newPassword }
 * Requires: authenticated user
 */
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+passwordHash');

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    throw ApiError.unauthorized('Current password is incorrect');
  }

  // Set new password via virtual setter (triggers pre-save hash hook)
  user.password = newPassword;

  // Invalidate all refresh tokens (force re-login on other devices)
  user.refreshToken = undefined;
  user.refreshTokenExpiresAt = undefined;

  await user.save();

  logger.info(`Password changed for ${user.email} from ${req.ip}`);

  res.json({
    status: 'success',
    message: 'Password changed successfully. Please log in again on other devices.',
  });
});
