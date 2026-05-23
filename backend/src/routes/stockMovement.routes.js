const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/stockMovement.controller');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

router.use(protect);
router.use(requireAdmin);

router.get('/', ctrl.list);
router.get('/by-product/:productId', ctrl.byProduct);

module.exports = router;
