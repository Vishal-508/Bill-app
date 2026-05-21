// Disable rate limiters for end-to-end testing
// (must be set BEFORE any require() that reads NODE_ENV)
process.env.NODE_ENV = 'test';

require('dotenv').config();

if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const logger = require('../src/config/logger');

const TEST_BYPASS_SECRET = process.env.TEST_BYPASS_SECRET;
if (!TEST_BYPASS_SECRET) {
  logger.error('TEST_BYPASS_SECRET is not set in .env — tests would hit rate limits.');
  process.exit(1);
}

const BASE_URL = `http://localhost:${process.env.PORT || 5000}/api`;
const ADMIN_EMAIL = 'testadmin@shreegopal.com';
const ADMIN_PASSWORD = 'TestAdmin@123';
const SUPER_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const SUPER_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

// Test result tracking
let passed = 0;
let failed = 0;
const failures = [];

// Mask emails for safe logging
const maskEmail = (email) => {
  if (!email) return '<no email>';
  const [local, domain] = email.split('@');
  if (!domain) return '<invalid>';
  return `${local[0]}***@${domain}`;
};

const test = (name, condition, details = '') => {
  if (condition) {
    passed++;
    logger.info(`  ✅ ${name}${details ? ' — ' + details : ''}`);
    return true;
  } else {
    failed++;
    const failure = `${name}${details ? ' — ' + details : ''}`;
    failures.push(failure);
    logger.error(`  ❌ ${name}${details ? ' — ' + details : ''}`);
    return false;
  }
};

// Helper: make request, catch errors gracefully
const api = async (method, path, data, token) => {
  try {
    const config = {
      method,
      url: `${BASE_URL}${path}`,
      headers: {
        'X-Test-Bypass-Ratelimit': TEST_BYPASS_SECRET,
      },
    };
    if (data) {
      config.data = data;
      config.headers['Content-Type'] = 'application/json';
    }
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const res = await axios(config);
    return { status: res.status, data: res.data, ok: true };
  } catch (error) {
    if (error.response) {
      return { status: error.response.status, data: error.response.data, ok: false };
    }
    return { status: 0, data: { message: error.message }, ok: false };
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════
// TEST SUITES
// ════════════════════════════════════════════════════════════

const runTests = async () => {
  logger.info('═══════════════════════════════════════════════════');
  logger.info('🧪 END-TO-END AUTH SYSTEM TESTS');
  logger.info('═══════════════════════════════════════════════════');

  // ────────────────────────────────────────────────────────────
  // SUITE 1: Server health
  // ────────────────────────────────────────────────────────────
  logger.info('');
  logger.info('📋 Suite 1: Server health');

  const health = await api('GET', '/health');
  test('Server is reachable', health.ok && health.status === 200);
  test('Health endpoint returns status:ok', health.data?.status === 'ok');
  test('Database is connected', health.data?.database === 'connected');

  if (!health.ok) {
    logger.error('Server is not running. Start it with: npm run dev');
    return;
  }

  // ────────────────────────────────────────────────────────────
  // SUITE 2: Unauthenticated access protection
  // ────────────────────────────────────────────────────────────
  logger.info('');
  logger.info('📋 Suite 2: Unauthenticated access blocked');

  const noAuth = await api('GET', '/auth/me');
  test('GET /auth/me without token returns 401', noAuth.status === 401);
  test('Error response has consistent format', !!noAuth.data?.message);

  // ────────────────────────────────────────────────────────────
  // SUITE 3: Input validation (Zod)
  // ────────────────────────────────────────────────────────────
  logger.info('');
  logger.info('📋 Suite 3: Input validation');

  const emptyLogin = await api('POST', '/auth/login', {});
  test('Empty login body returns 400', emptyLogin.status === 400);
  test('Validation error includes errors object', !!emptyLogin.data?.errors);
  test('Email field has error', !!emptyLogin.data?.errors?.email);
  test('Password field has error', !!emptyLogin.data?.errors?.password);

  const badEmail = await api('POST', '/auth/login', {
    email: 'not-an-email',
    password: 'whatever',
  });
  test('Invalid email format rejected with 400', badEmail.status === 400);
  test('Specific email error returned', /email/i.test(badEmail.data?.errors?.email || ''));

  // ────────────────────────────────────────────────────────────
  // SUITE 4: Login as ADMIN (testadmin)
  // ────────────────────────────────────────────────────────────
  logger.info('');
  logger.info('📋 Suite 4: ADMIN login flow');

  const wrongPw = await api('POST', '/auth/login', {
    email: ADMIN_EMAIL,
    password: 'WrongPassword',
  });
  test('Wrong password returns 401', wrongPw.status === 401);
  test('Generic error message (no email enumeration)',
       wrongPw.data?.message === 'Invalid email or password');

  const unknownEmail = await api('POST', '/auth/login', {
    email: 'nobody@example.com',
    password: 'anything',
  });
  test('Unknown email returns 401 (same message)',
       unknownEmail.status === 401 && unknownEmail.data?.message === 'Invalid email or password');

  // Successful login
  const adminLogin = await api('POST', '/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  test('Valid ADMIN credentials login', adminLogin.ok && adminLogin.status === 200);
  test('Login returns accessToken', !!adminLogin.data?.accessToken);
  test('Login returns refreshToken', !!adminLogin.data?.refreshToken);
  test('Login returns user object', !!adminLogin.data?.user);
  test('User role is ADMIN', adminLogin.data?.user?.role === 'ADMIN');
  test('Sensitive: passwordHash NOT in response', !('passwordHash' in (adminLogin.data?.user || {})));
  test('Sensitive: refreshToken (DB) NOT in response', !('refreshToken' in (adminLogin.data?.user || {})));
  test('Sensitive: failedLoginAttempts NOT in response',
       !('failedLoginAttempts' in (adminLogin.data?.user || {})));

  const adminToken = adminLogin.data?.accessToken;
  const adminRefresh = adminLogin.data?.refreshToken;

  // ────────────────────────────────────────────────────────────
  // SUITE 5: Authenticated requests as ADMIN
  // ────────────────────────────────────────────────────────────
  logger.info('');
  logger.info('📋 Suite 5: Authenticated requests');

  const me = await api('GET', '/auth/me', null, adminToken);
  test('GET /auth/me with valid token returns 200', me.status === 200);
  test('GET /auth/me returns user with correct role', me.data?.user?.role === 'ADMIN');
  test('Returned email is lowercased', me.data?.user?.email === ADMIN_EMAIL.toLowerCase());

  const badToken = await api('GET', '/auth/me', null, 'not.a.real.token');
  test('Invalid token returns 401', badToken.status === 401);

  const tamperedToken = adminToken.slice(0, -5) + 'XXXXX';
  const tampered = await api('GET', '/auth/me', null, tamperedToken);
  test('Tampered token rejected with 401', tampered.status === 401);

  // ────────────────────────────────────────────────────────────
  // SUITE 6: Token refresh + rotation
  // ────────────────────────────────────────────────────────────
  logger.info('');
  logger.info('📋 Suite 6: Token refresh and rotation');

  const refresh1 = await api('POST', '/auth/refresh', { refreshToken: adminRefresh });
  test('Refresh with valid token returns 200', refresh1.status === 200);
  test('Refresh returns NEW accessToken',
       !!refresh1.data?.accessToken && refresh1.data?.accessToken !== adminToken);
  test('Refresh returns NEW refreshToken (rotation)',
       !!refresh1.data?.refreshToken && refresh1.data?.refreshToken !== adminRefresh);

  const newAdminToken = refresh1.data?.accessToken;
  const newAdminRefresh = refresh1.data?.refreshToken;

  // Old refresh should now be invalid
  const reuseOld = await api('POST', '/auth/refresh', { refreshToken: adminRefresh });
  test('Old refresh token rejected after rotation', reuseOld.status === 401);

  // New refresh should work
  const meAfterRefresh = await api('GET', '/auth/me', null, newAdminToken);
  test('New access token works for protected route', meAfterRefresh.status === 200);

  // Invalid refresh token
  const badRefresh = await api('POST', '/auth/refresh', { refreshToken: 'invalid.token.here' });
  test('Invalid refresh token returns 401', badRefresh.status === 401);

  // ────────────────────────────────────────────────────────────
  // SUITE 7: SUPER_ADMIN login + role hierarchy
  // ────────────────────────────────────────────────────────────
  logger.info('');
  logger.info('📋 Suite 7: SUPER_ADMIN login + role differentiation');

  if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
    logger.warn('  ⚠ SUPER_ADMIN credentials not in env — skipping this suite');
  } else {
    const superLogin = await api('POST', '/auth/login', {
      email: SUPER_ADMIN_EMAIL,
      password: SUPER_ADMIN_PASSWORD,
    });
    test('SUPER_ADMIN can log in', superLogin.ok);
    test('SUPER_ADMIN role correctly returned', superLogin.data?.user?.role === 'SUPER_ADMIN');
    test('SUPER_ADMIN email returned (masked in log)',
         !!superLogin.data?.user?.email,
         `email: ${maskEmail(superLogin.data?.user?.email)}`);
    test('lastLoginAt updated after SUPER_ADMIN login', !!superLogin.data?.user?.lastLoginAt);
  }

  // ────────────────────────────────────────────────────────────
  // SUITE 8: Logout flow
  // ────────────────────────────────────────────────────────────
  logger.info('');
  logger.info('📋 Suite 8: Logout flow');

  const logout = await api('POST', '/auth/logout', null, newAdminToken);
  test('Logout returns 200', logout.status === 200);
  test('Logout returns success message', logout.data?.message?.includes('Logged out'));

  // After logout, refresh token should be invalidated
  const refreshAfterLogout = await api('POST', '/auth/refresh', { refreshToken: newAdminRefresh });
  test('Refresh after logout fails with 401', refreshAfterLogout.status === 401);

  // Access token is still technically valid (until expiry) but stateless — protect middleware
  // will allow it. This is by design with JWTs. Worth noting.

  // ────────────────────────────────────────────────────────────
  // SUITE 9: Change password flow
  // ────────────────────────────────────────────────────────────
  logger.info('');
  logger.info('📋 Suite 9: Change password flow');

  // Re-login first (we logged out above)
  const reLogin = await api('POST', '/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  test('Re-login after logout works', reLogin.ok);

  const reLoginToken = reLogin.data?.accessToken;

  // Wrong current password
  const wrongCurrent = await api('POST', '/auth/change-password', {
    currentPassword: 'WrongCurrent',
    newPassword: 'NewPassword@123',
  }, reLoginToken);
  test('Wrong current password rejected', wrongCurrent.status === 401);

  // Weak new password
  const weak = await api('POST', '/auth/change-password', {
    currentPassword: ADMIN_PASSWORD,
    newPassword: 'weak',
  }, reLoginToken);
  test('Weak new password rejected with 400', weak.status === 400);
  test('Weak password error mentions newPassword field', !!weak.data?.errors?.newPassword);

  // Same as current
  const same = await api('POST', '/auth/change-password', {
    currentPassword: ADMIN_PASSWORD,
    newPassword: ADMIN_PASSWORD,
  }, reLoginToken);
  test('Same-as-current rejected with 400', same.status === 400);

  // Successful change
  const TEMP_PASSWORD = 'TempChange@456';
  const change = await api('POST', '/auth/change-password', {
    currentPassword: ADMIN_PASSWORD,
    newPassword: TEMP_PASSWORD,
  }, reLoginToken);
  test('Valid password change succeeds', change.ok && change.status === 200);

  // Old password should no longer work
  const oldPwLogin = await api('POST', '/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  test('Old password no longer works', oldPwLogin.status === 401);

  // New password should work
  const newPwLogin = await api('POST', '/auth/login', {
    email: ADMIN_EMAIL,
    password: TEMP_PASSWORD,
  });
  test('New password works for login', newPwLogin.ok);

  // Restore original password (for next test runs)
  const restoreToken = newPwLogin.data?.accessToken;
  const restore = await api('POST', '/auth/change-password', {
    currentPassword: TEMP_PASSWORD,
    newPassword: ADMIN_PASSWORD,
  }, restoreToken);
  test('Restore original password succeeds', restore.ok);

  // ────────────────────────────────────────────────────────────
  // SUITE 10: 404 + Method Not Allowed + Edge cases
  // ────────────────────────────────────────────────────────────
  logger.info('');
  logger.info('📋 Suite 10: Edge cases');

  const notFound = await api('GET', '/nonexistent-route');
  test('Unknown route returns 404', notFound.status === 404);
  test('404 response has consistent format', !!notFound.data?.message);

  // Malformed JSON would require a raw request, skip this complex case.

  // ────────────────────────────────────────────────────────────
  // FINAL SUMMARY
  // ────────────────────────────────────────────────────────────
  logger.info('');
  logger.info('═══════════════════════════════════════════════════');
  logger.info('🏁 TEST RESULTS');
  logger.info('═══════════════════════════════════════════════════');
  logger.info(`   Total:  ${passed + failed}`);
  logger.info(`   Passed: ${passed} ✅`);
  logger.info(`   Failed: ${failed} ${failed > 0 ? '❌' : ''}`);

  if (failures.length > 0) {
    logger.info('');
    logger.info('Failures:');
    failures.forEach((f, i) => logger.info(`   ${i + 1}. ${f}`));
  }

  logger.info('═══════════════════════════════════════════════════');

  if (failed === 0) {
    logger.info('🎉 ALL TESTS PASSED — Prompt 2 backend foundation is solid');
  } else {
    logger.error('⚠️  Some tests failed — review above');
  }

  process.exit(failed === 0 ? 0 : 1);
};

runTests().catch((err) => {
  logger.error('Test runner crashed:', err);
  process.exit(1);
});
