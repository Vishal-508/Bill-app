const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const customerRoutes = require('./customer.routes');
const segmentRoutes = require('./businessSegment.routes');
const productRoutes = require('./product.routes');
const gradeRoutes = require('./productGrade.routes');
const attributeRoutes = require('./productAttribute.routes');
const orderRoutes = require('./order.routes');
const settingsRoutes = require('./systemSetting.routes');
const stockMovementRoutes = require('./stockMovement.routes');
const billRoutes = require('./bill.routes');

router.use('/auth', authRoutes);
router.use('/customers', customerRoutes);
router.use('/business-segments', segmentRoutes);
router.use('/products', productRoutes);
router.use('/product-grades', gradeRoutes);
router.use('/product-attributes', attributeRoutes);
router.use('/orders', orderRoutes);
router.use('/system-settings', settingsRoutes);
router.use('/stock-movements', stockMovementRoutes);
router.use('/bills', billRoutes);

module.exports = router;
