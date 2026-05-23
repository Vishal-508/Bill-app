const express = require('express');
const router = express.Router();

const customerController = require('../controllers/customer.controller');
const { protect } = require('../middleware/auth');
const { allow, requireAdmin, requireSuperAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const {
  createCustomerSchema,
  updateCustomerSchema,
  softDeleteCustomerSchema,
  bulkUpdateSchema,
  bulkDeleteSchema,
  bulkRestoreSchema,
  bulkTagSchema,
} = require('../validators/customer.validator');

// All customer routes require authentication
router.use(protect);

// ─── Read operations (any authenticated user) ───
router.get('/', customerController.list);

// Analytics routes (ADMIN+) — MUST come BEFORE /:id routes
router.get(
  '/analytics/summary',
  requireAdmin,
  customerController.analyticsSummary
);

router.get(
  '/analytics/by-segment',
  requireAdmin,
  customerController.analyticsBySegment
);

router.get(
  '/analytics/by-source',
  requireAdmin,
  customerController.analyticsBySource
);

router.get(
  '/analytics/top-customers',
  requireAdmin,
  customerController.analyticsTopCustomers
);

// ─── Export endpoints (ADMIN+) ───
router.get('/export/csv', requireAdmin, customerController.exportCSV);
router.get('/export/excel', requireAdmin, customerController.exportExcel);

// ─── Bulk operations ───
router.post(
  '/bulk-update',
  requireAdmin,
  validate(bulkUpdateSchema, 'body'),
  customerController.bulkUpdate
);

router.post(
  '/bulk-delete',
  requireAdmin,
  validate(bulkDeleteSchema, 'body'),
  customerController.bulkSoftDelete
);

router.post(
  '/bulk-restore',
  requireSuperAdmin,
  validate(bulkRestoreSchema, 'body'),
  customerController.bulkRestore
);

router.post(
  '/bulk-add-tag',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(bulkTagSchema, 'body'),
  customerController.bulkAddTag
);

router.post(
  '/bulk-remove-tag',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(bulkTagSchema, 'body'),
  customerController.bulkRemoveTag
);

router.get('/:id', customerController.getById);
router.get('/:id/insights', customerController.getInsights);

// ─── Write operations (ADMIN + BILLING) ───
router.post(
  '/',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(createCustomerSchema, 'body'),
  customerController.create
);

router.put(
  '/:id',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(updateCustomerSchema, 'body'),
  customerController.update
);

// ─── Destructive operations (ADMIN/SUPER_ADMIN only) ───
router.delete(
  '/:id',
  requireAdmin,  // Both ADMIN and SUPER_ADMIN
  validate(softDeleteCustomerSchema, 'body'),
  customerController.softDelete
);

router.post(
  '/:id/restore',
  requireSuperAdmin,
  customerController.restore
);

router.delete(
  '/:id/hard-delete',
  requireSuperAdmin,
  customerController.hardDelete
);

module.exports = router;
