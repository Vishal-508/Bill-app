/**
 * JWT Utilities for shree-gopal-mdf-backend
 *
 * Token structure includes a jti (JWT ID) claim — a UUIDv4 — making every
 * issued token unique even when generated within the same second. This:
 *   • Enables future jti-based blocklisting for instant logout revocation
 *   • Provides per-token identifiers for audit logging
 *   • Aligns with RFC 7519 standard claims
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../config/logger');

const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET;
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';
const REFRESH_TOKEN_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

if (!ACCESS_TOKEN_SECRET || !REFRESH_TOKEN_SECRET) {
  throw new Error('JWT secrets are not defined in environment variables');
}

/**
 * Generate an access token (short-lived, used for API calls)
 * @param {Object} user - Mongoose User document (or plain object with _id, email, role)
 * @returns {string} JWT access token
 */
const generateAccessToken = (user) => {
  const payload = {
    sub: user._id.toString(),        // subject (user ID)
    email: user.email,
    role: user.role,
    type: 'access',
    jti: crypto.randomUUID(),        // unique token ID for tracking/revocation
  };

  return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    issuer: 'shree-gopal-mdf-api',
    audience: 'shree-gopal-mdf-clients',
  });
};

/**
 * Generate a refresh token (long-lived, used to get new access tokens)
 * @param {Object} user - Mongoose User document
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (user) => {
  const payload = {
    sub: user._id.toString(),
    type: 'refresh',
    jti: crypto.randomUUID(),        // unique token ID for tracking/revocation
  };

  return jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    issuer: 'shree-gopal-mdf-api',
    audience: 'shree-gopal-mdf-clients',
  });
};

/**
 * Generate both access + refresh tokens for a user
 * @param {Object} user - Mongoose User document
 * @returns {Object} { accessToken, refreshToken }
 */
const generateTokenPair = (user) => {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(user),
  };
};

/**
 * Verify an access token
 * @param {string} token - JWT to verify
 * @returns {Object} decoded payload
 * @throws {Error} if token is invalid or expired
 */
const verifyAccessToken = (token) => {
  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET, {
      issuer: 'shree-gopal-mdf-api',
      audience: 'shree-gopal-mdf-clients',
    });

    if (decoded.type !== 'access') {
      throw new Error('Invalid token type — expected access token');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Access token has expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid access token');
    }
    throw error;
  }
};

/**
 * Verify a refresh token
 * @param {string} token - JWT to verify
 * @returns {Object} decoded payload
 * @throws {Error} if token is invalid or expired
 */
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET, {
      issuer: 'shree-gopal-mdf-api',
      audience: 'shree-gopal-mdf-clients',
    });

    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type — expected refresh token');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Refresh token has expired — please log in again');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid refresh token');
    }
    throw error;
  }
};

/**
 * Decode token without verification (useful for reading expired tokens for logging)
 * @param {string} token
 * @returns {Object|null} decoded payload or null if malformed
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    logger.warn('Failed to decode token:', error.message);
    return null;
  }
};

/**
 * Extract token from Authorization header
 * Supports both "Bearer <token>" and bare token
 * @param {string} authHeader - The Authorization header value
 * @returns {string|null}
 */
const extractTokenFromHeader = (authHeader) => {
  if (!authHeader) return null;

  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  // Allow bare token (fallback)
  return authHeader.trim();
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken,
  extractTokenFromHeader,
};
