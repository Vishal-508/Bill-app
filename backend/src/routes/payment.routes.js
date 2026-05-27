const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/payment.controller');
const { protect } = require('../middleware/auth');
const { allow } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const {
  initiatePaymentSchema,
  verifyPaymentSchema,
  cancelPaymentSchema,
  initiateRefundSchema,
} = require('../validators/payment.validator');

router.use(protect);

// Config (anyone authenticated)
router.get('/config', ctrl.getConfig);

// Specialized GETs (before /:id)
router.get('/by-order/:orderId', ctrl.byOrder);
router.get('/by-customer/:customerId', ctrl.byCustomer);

// Refunds (must come before /:id to avoid /refunds being captured as ":id")
router.get('/refunds', ctrl.listRefunds);
router.get('/refunds/:id', ctrl.getRefundDetail);

// UPI QR endpoints (must come before /:id to avoid path-segment collision)
router.get('/:id/upi-uri', ctrl.getUpiUri);
router.get('/:id/qr', ctrl.getQrCode);

// Payment receipt PDF
router.get('/:id/receipt', ctrl.getReceipt);

// Core CRUD
router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);

// Payment lifecycle
router.post('/initiate',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(initiatePaymentSchema, 'body'),
  ctrl.initiate
);

router.post('/verify',
  validate(verifyPaymentSchema, 'body'),
  ctrl.verify
);

router.post('/:id/cancel',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(cancelPaymentSchema, 'body'),
  ctrl.cancel
);

router.post('/:id/refund',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(initiateRefundSchema, 'body'),
  ctrl.initiateRefund
);

module.exports = router;
