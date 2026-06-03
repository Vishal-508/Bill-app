const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/email.controller');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const { emailLogsQuerySchema } = require('../validators/notificationLogs.validator');

router.use(protect);

// Logs — any authenticated staff
// IMPORTANT: /logs/stats must come BEFORE /logs/:id
router.get('/logs/stats', ctrl.statsLogs);
router.get('/logs/:id', ctrl.getLog);
router.get('/logs', validate(emailLogsQuerySchema, 'query'), ctrl.listLogs);

// Health — ADMIN/SUPER_ADMIN only
router.get('/health', requireAdmin, ctrl.health);

module.exports = router;
