const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/webhook.controller');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

// PUBLIC webhook endpoint (no auth — signature IS auth).
// Raw body capture handled in server.js via express.raw() applied to this
// path BEFORE the global express.json() (server.js:69-78).
router.post('/razorpay', ctrl.handleRazorpay);

// Admin-only audit-trail viewing
router.use(protect);
router.get('/events', requireAdmin, ctrl.listEvents);
router.get('/events/:id', requireAdmin, ctrl.getEvent);

module.exports = router;
