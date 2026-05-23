const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/systemSetting.controller');
const { protect } = require('../middleware/auth');
const { requireAdmin, requireSuperAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const { updateSystemSettingSchema } = require('../validators/systemSetting.validator');

router.use(protect);

router.get('/', requireAdmin, ctrl.list);
router.get('/:key', requireAdmin, ctrl.getByKey);
router.put('/:key', requireSuperAdmin, validate(updateSystemSettingSchema, 'body'), ctrl.update);
router.post('/:key/reset', requireSuperAdmin, ctrl.reset);

module.exports = router;
