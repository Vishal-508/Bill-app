/**
 * Raw body capture middleware (LEGACY / REFERENCE).
 *
 * NOT USED for webhook signature verification anymore.
 * That functionality moved to server.js where express.raw() is applied
 * specifically to /api/webhooks/razorpay BEFORE the global express.json().
 *
 * Why this file is kept:
 *   - Reference for other webhook routes that may be added later
 *   - Documents the failed approach (verify callback on express.json
 *     never fires because global express.json consumes the body first)
 *
 * Correct pattern (in server.js, before global express.json):
 *   app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json' }));
 *
 * The route-level express.raw() MUST come BEFORE app.use(express.json())
 * because once express.json() consumes the body stream, it cannot be re-read.
 */

const express = require('express');

exports.rawBodyMiddleware = express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
});
