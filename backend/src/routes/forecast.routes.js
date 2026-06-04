const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/forecast.controller');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const { forecastSummaryQuerySchema } = require('../validators/forecast.validator');

router.use(protect);

// ─── IMPORTANT: route order — literals BEFORE /:productId ───
// Otherwise Express matches 'run-all', 'run', 'health' as a productId.
// Same pattern enforced in Prompt 7 Section F (whatsapp /logs/stats).

// Batch trigger — admin only, rate-limited inside controller
router.post('/run-all', requireAdmin, ctrl.runAll);

// Single trigger — admin only
router.post('/run/:productId', requireAdmin, ctrl.runOne);

// Health widget — admin only
router.get('/health', requireAdmin, ctrl.health);

// Detail — any staff
router.get('/:productId', ctrl.getOne);

// Summary list — any staff
router.get('/', validate(forecastSummaryQuerySchema, 'query'), ctrl.list);

module.exports = router;
