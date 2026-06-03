const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/whatsapp.controller');
const { protect } = require('../middleware/auth');
const { allow, requireAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const {
  sendBillSchema,
  sendPaymentLinkSchema,
  sendOrderConfirmationSchema,
  sendOrderReadySchema,
  sendTextSchema,
} = require('../validators/whatsapp.validator');
const { whatsappLogsQuerySchema } = require('../validators/notificationLogs.validator');

// ─── PUBLIC webhook routes (Section C) ───
// Must come BEFORE router.use(protect). Authentication is via the Meta
// signature header (verified inside the controller). Raw body capture is
// configured in server.js (express.raw BEFORE global express.json).
router.get('/webhook', ctrl.webhookVerify);
router.post('/webhook', ctrl.webhookEvent);

// ─── All other endpoints require JWT auth ───
router.use(protect);

const requireSendAccess = allow('SUPER_ADMIN', 'ADMIN', 'BILLING');

// Send endpoints (Section B)
router.post('/send-bill/:billId',
  requireSendAccess,
  validate(sendBillSchema, 'body'),
  ctrl.sendBill
);

router.post('/send-payment-link',
  requireSendAccess,
  validate(sendPaymentLinkSchema, 'body'),
  ctrl.sendPaymentLink
);

router.post('/send-order-confirmation/:orderId',
  requireSendAccess,
  validate(sendOrderConfirmationSchema, 'body'),
  ctrl.sendOrderConfirmation
);

router.post('/send-order-ready/:orderId',
  requireSendAccess,
  validate(sendOrderReadySchema, 'body'),
  ctrl.sendOrderReady
);

router.post('/send-text',
  requireSendAccess,
  validate(sendTextSchema, 'body'),
  ctrl.sendText
);

// Logs (Section F) — any authenticated staff can read
// IMPORTANT: /logs/stats must come BEFORE /logs/:id (else 'stats' is parsed as id)
router.get('/logs/stats', ctrl.statsLogs);
router.get('/logs/:id', ctrl.getLog);
router.get('/logs', validate(whatsappLogsQuerySchema, 'query'), ctrl.listLogs);

// Health (Section F) — ADMIN/SUPER_ADMIN only
router.get('/health', requireAdmin, ctrl.health);

module.exports = router;
