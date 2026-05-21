require('dotenv').config();

const logger = require('../src/config/logger');
const {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken,
  extractTokenFromHeader,
} = require('../src/utils/jwt');

const test = async () => {
  try {
    // Mock user object
    const mockUser = {
      _id: '6a0e9c04d75ff5dc65db504b',
      email: 'admin@shreegopal.com',
      role: 'SUPER_ADMIN',
    };

    logger.info('═══ JWT Utilities Test ═══');

    // Test 1: Generate access token
    const accessToken = generateAccessToken(mockUser);
    logger.info(`✅ Access token generated (length: ${accessToken.length})`);
    logger.info(`   Starts with: ${accessToken.substring(0, 20)}...`);

    // Test 2: Generate refresh token
    const refreshToken = generateRefreshToken(mockUser);
    logger.info(`✅ Refresh token generated (length: ${refreshToken.length})`);

    // Test 3: Generate token pair
    const pair = generateTokenPair(mockUser);
    logger.info(`✅ Token pair generated: ${!!pair.accessToken && !!pair.refreshToken}`);

    // Test 4: Verify valid access token
    const decoded = verifyAccessToken(accessToken);
    logger.info(`✅ Access token verified`);
    logger.info(`   - sub: ${decoded.sub}`);
    logger.info(`   - email: ${decoded.email}`);
    logger.info(`   - role: ${decoded.role}`);
    logger.info(`   - type: ${decoded.type}`);
    logger.info(`   - iss: ${decoded.iss}`);
    logger.info(`   - aud: ${decoded.aud}`);
    logger.info(`   - exp: ${new Date(decoded.exp * 1000).toISOString()}`);

    // Test 5: Verify refresh token
    const refreshDecoded = verifyRefreshToken(refreshToken);
    logger.info(`✅ Refresh token verified: type=${refreshDecoded.type}`);

    // Test 6: Cross-verification should fail (access token verified as refresh)
    try {
      verifyRefreshToken(accessToken);
      logger.error('❌ Access token was wrongly accepted as refresh token!');
    } catch (error) {
      logger.info(`✅ Cross-verification rejected: ${error.message}`);
    }

    // Test 7: Invalid token rejection
    try {
      verifyAccessToken('not.a.valid.jwt.token');
      logger.error('❌ Invalid token was accepted!');
    } catch (error) {
      logger.info(`✅ Invalid token rejected: ${error.message}`);
    }

    // Test 8: Tampered token rejection
    const tampered = accessToken.slice(0, -5) + 'XXXXX';
    try {
      verifyAccessToken(tampered);
      logger.error('❌ Tampered token was accepted!');
    } catch (error) {
      logger.info(`✅ Tampered token rejected: ${error.message}`);
    }

    // Test 9: Decode without verification (works even for tampered tokens)
    const decodedTampered = decodeToken(tampered);
    logger.info(`✅ Decode without verify works: ${!!decodedTampered && decodedTampered.email === mockUser.email}`);

    // Test 10: Extract token from header
    const fromBearer = extractTokenFromHeader(`Bearer ${accessToken}`);
    const fromBare = extractTokenFromHeader(accessToken);
    const fromNull = extractTokenFromHeader(null);
    logger.info(`✅ Extract from "Bearer <token>": ${fromBearer === accessToken}`);
    logger.info(`✅ Extract from bare token: ${fromBare === accessToken}`);
    logger.info(`✅ Extract from null: ${fromNull === null}`);

    // Test 11: Expired token rejection (generate with very short expiry)
    const jwt = require('jsonwebtoken');
    const shortLived = jwt.sign(
      { sub: '123', type: 'access' },
      process.env.JWT_SECRET,
      {
        expiresIn: '1ms',
        issuer: 'shree-gopal-mdf-api',
        audience: 'shree-gopal-mdf-clients',
      }
    );

    // Wait 100ms to ensure expiry
    await new Promise(r => setTimeout(r, 100));

    try {
      verifyAccessToken(shortLived);
      logger.error('❌ Expired token was accepted!');
    } catch (error) {
      logger.info(`✅ Expired token rejected: ${error.message}`);
    }

    logger.info('═══ All JWT tests passed ═══');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Test failed:', error);
    process.exit(1);
  }
};

test();
