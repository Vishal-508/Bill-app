const User = require('./User');
const Customer = require('./Customer');
const BusinessSegment = require('./BusinessSegment');
const Product = require('./Product');
const ProductGrade = require('./ProductGrade');
const ProductAttribute = require('./ProductAttribute');
const StandardBundleSize = require('./StandardBundleSize');
const ShapeCuttingRate = require('./ShapeCuttingRate');
const CuttingChargeRule = require('./CuttingChargeRule');
const SystemSetting = require('./SystemSetting');
const Order = require('./Order');
const StockMovement = require('./StockMovement');
const Bill = require('./Bill');
const Payment = require('./Payment');
const WebhookEvent = require('./WebhookEvent');

module.exports = {
  User, Customer, BusinessSegment,
  Product, ProductGrade, ProductAttribute,
  StandardBundleSize, ShapeCuttingRate, CuttingChargeRule,
  SystemSetting, Order, StockMovement,
  Bill, Payment, WebhookEvent,
};
