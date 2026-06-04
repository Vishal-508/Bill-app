const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/inventoryAnalytics.controller');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const {
  consumptionQuerySchema,
  byProductQuerySchema,
  bySizeQuerySchema,
  byGradeQuerySchema,
  bundlesQuerySchema,
  dashboardQuerySchema,
} = require('../validators/inventoryAnalytics.validator');

// All analytics endpoints: admin-only (internal-use insights — see
// [[prompt8_inventory_analytics_only]])
router.use(protect);
router.use(requireAdmin);

router.get('/consumption', validate(consumptionQuerySchema, 'query'), ctrl.consumption);
router.get('/by-product', validate(byProductQuerySchema, 'query'), ctrl.byProduct);
router.get('/by-size', validate(bySizeQuerySchema, 'query'), ctrl.bySize);
router.get('/by-grade', validate(byGradeQuerySchema, 'query'), ctrl.byGrade);
router.get('/bundles', validate(bundlesQuerySchema, 'query'), ctrl.bundles);
router.get('/dashboard', validate(dashboardQuerySchema, 'query'), ctrl.dashboard);

module.exports = router;
