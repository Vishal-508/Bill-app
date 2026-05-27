const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/reconciliation.controller');
const { protect } = require('../middleware/auth');
const { allow } = require('../middleware/rbac');

router.use(protect);

const requireBillingAccess = allow('SUPER_ADMIN', 'ADMIN', 'BILLING');

router.get('/summary', requireBillingAccess, ctrl.getSummary);
router.get('/outstanding', requireBillingAccess, ctrl.getOutstanding);
router.get('/discrepancies', requireBillingAccess, ctrl.getDiscrepancies);
router.get('/daily/:date', requireBillingAccess, ctrl.getDailyReconciliation);
router.get('/customer/:customerId', requireBillingAccess, ctrl.getCustomerReconciliation);

module.exports = router;
