const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/notifications.controller');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

router.use(protect);

// Combined health — any authenticated staff (dashboard widget)
router.get('/health', ctrl.health);

// Manual retry trigger (Section G) — ADMIN / SUPER_ADMIN only
router.post('/retry-now', requireAdmin, ctrl.retryNow);

module.exports = router;
