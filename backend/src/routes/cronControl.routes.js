const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/cronControl.controller');
const { protect } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/rbac');

router.use(protect);
router.use(requireSuperAdmin);

router.post('/run/forecast', ctrl.runForecast);
router.post('/run/analytics', ctrl.runAnalytics);
router.post('/run/weekly-report', ctrl.runWeeklyReport);

module.exports = router;
