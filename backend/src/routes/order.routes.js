const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/order.controller');
const analyticsCtrl = require('../controllers/orderAnalytics.controller');
const { protect } = require('../middleware/auth');
const { allow, requireAdmin, requireSuperAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const {
  createOrderSchema,
  updateOrderSchema,
  statusChangeSchema,
  cancelOrderSchema,
  softDeleteOrderSchema,
  addPaymentSchema,
  refundPaymentSchema,
} = require('../validators/order.validator');

router.use(protect);

// Specialized GETs (before /:id)
router.get('/by-customer/:customerId', ctrl.byCustomer);

// Pricing (must be before /:id routes)
router.post('/calculate-preview', allow('SUPER_ADMIN', 'ADMIN', 'BILLING'), ctrl.calculatePreview);
router.post('/:id/recalculate-pricing', allow('SUPER_ADMIN', 'ADMIN', 'BILLING'), ctrl.recalculatePricing);

// Stock pre-flight check
router.post('/check-stock', allow('SUPER_ADMIN', 'ADMIN', 'BILLING'), ctrl.checkStock);

// Outstanding payments + customer dues (must be before /:id)
router.get('/outstanding-payments', requireAdmin, ctrl.outstandingPayments);
router.get('/customer-dues/:customerId', allow('SUPER_ADMIN', 'ADMIN', 'BILLING'), ctrl.customerDues);

// Analytics endpoints (all require ADMIN+) — must be before /:id
router.get('/analytics/revenue', requireAdmin, analyticsCtrl.revenueByPeriod);
router.get('/analytics/revenue-trend', requireAdmin, analyticsCtrl.revenueTrend);
router.get('/analytics/top-customers', requireAdmin, analyticsCtrl.topCustomers);
router.get('/analytics/customer-patterns', requireAdmin, analyticsCtrl.customerPatterns);
router.get('/analytics/top-products', requireAdmin, analyticsCtrl.topProducts);
router.get('/analytics/sales-by-product-type', requireAdmin, analyticsCtrl.salesByProductType);
router.get('/analytics/status-distribution', requireAdmin, analyticsCtrl.statusDistribution);
router.get('/analytics/payment-mode-distribution', requireAdmin, analyticsCtrl.paymentModeDistribution);
router.get('/analytics/cancellation-rate', requireAdmin, analyticsCtrl.cancellationRate);
router.get('/analytics/dashboard', requireAdmin, analyticsCtrl.dashboardSummary);

// CRUD
router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.post('/', allow('SUPER_ADMIN', 'ADMIN', 'BILLING'), validate(createOrderSchema, 'body'), ctrl.create);
router.put('/:id', allow('SUPER_ADMIN', 'ADMIN', 'BILLING'), validate(updateOrderSchema, 'body'), ctrl.update);

// Status & lifecycle
router.post('/:id/status', allow('SUPER_ADMIN', 'ADMIN', 'BILLING', 'CUTTING'),
  validate(statusChangeSchema, 'body'), ctrl.changeStatus);
router.post('/:id/cancel', requireAdmin, validate(cancelOrderSchema, 'body'), ctrl.cancel);

// Payments
router.get('/:id/payments', ctrl.getPayments);
router.post(
  '/:id/payments',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(addPaymentSchema, 'body'),
  ctrl.addPayment
);
router.post(
  '/:id/refund',
  requireAdmin,
  validate(refundPaymentSchema, 'body'),
  ctrl.refund
);

// Destructive
router.delete('/:id', requireSuperAdmin, validate(softDeleteOrderSchema, 'body'), ctrl.softDelete);
router.post('/:id/restore', requireSuperAdmin, ctrl.restore);

module.exports = router;
