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
const paymentRoutes = require('./payment.routes');
const webhookRoutes = require('./webhook.routes');
const reconciliationRoutes = require('./reconciliation.routes');
const whatsappRoutes = require('./whatsapp.routes');
const emailRoutes = require('./email.routes');
const notificationsRoutes = require('./notifications.routes');

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
router.use('/payments', paymentRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/reconciliation', reconciliationRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/email', emailRoutes);
router.use('/notifications', notificationsRoutes);

module.exports = router;
