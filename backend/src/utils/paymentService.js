const { Order, Customer } = require('../models');
const ApiError = require('./ApiError');
const logger = require('../config/logger');

/**
 * PaymentService — manages all payment operations with customer dues sync.
 */

/**
 * Add a payment to an order.
 * Auto-updates payment status and customer dues.
 */
exports.addPayment = async (orderId, paymentData, userId) => {
  const order = await Order.findById(orderId);
  if (!order || order.isDeleted) {
    throw ApiError.notFound('Order not found');
  }

  if (order.status === 'CANCELLED') {
    throw ApiError.badRequest('Cannot add payment to cancelled order');
  }

  const currentDue = order.totalAmount - order.amountPaid;
  if (paymentData.amount > currentDue + 0.01) {
    throw ApiError.badRequest(
      `Payment amount (₹${paymentData.amount}) exceeds outstanding balance (₹${currentDue.toFixed(2)})`
    );
  }

  order.payments.push({
    amount: paymentData.amount,
    mode: paymentData.mode,
    reference: paymentData.reference,
    paidAt: paymentData.paidAt || new Date(),
    receivedBy: userId,
    notes: paymentData.notes,
  });

  const oldAmountPaid = order.amountPaid;
  order.amountPaid = +(order.amountPaid + paymentData.amount).toFixed(2);
  order.updatedBy = userId;

  await order.save();

  await exports.syncCustomerDues(order.customer);

  logger.info(
    `Payment added: ₹${paymentData.amount} ${paymentData.mode} for ${order.orderNumber} ` +
    `(${oldAmountPaid} → ${order.amountPaid}, status: ${order.paymentStatus})`
  );

  return {
    order,
    paymentAdded: order.payments[order.payments.length - 1],
    newStatus: order.paymentStatus,
    amountDue: order.amountDue,
  };
};

/**
 * Process refund for a payment.
 */
exports.processRefund = async (orderId, paymentId, refundData, userId) => {
  const order = await Order.findById(orderId);
  if (!order || order.isDeleted) {
    throw ApiError.notFound('Order not found');
  }

  const payment = order.payments.id(paymentId);
  if (!payment) {
    throw ApiError.notFound('Payment not found');
  }

  order.payments.push({
    amount: -payment.amount,
    mode: refundData.refundMode || payment.mode,
    reference: `REFUND: ${payment._id}`,
    paidAt: new Date(),
    receivedBy: userId,
    notes: `Refund reason: ${refundData.reason}. Original ref: ${payment.reference || 'N/A'}`,
  });

  order.amountPaid = +(order.amountPaid - payment.amount).toFixed(2);
  order.updatedBy = userId;

  if (order.amountPaid <= 0.01) {
    order.amountPaid = 0;
    order.paymentStatus = 'REFUNDED';
  }

  await order.save();
  await exports.syncCustomerDues(order.customer);

  logger.info(`Refund processed: ₹${payment.amount} for order ${order.orderNumber}`);

  return {
    order,
    refundAmount: payment.amount,
    newStatus: order.paymentStatus,
  };
};

/**
 * Sync customer's currentDues based on all their active orders.
 */
exports.syncCustomerDues = async (customerId) => {
  const customer = await Customer.findById(customerId);
  if (!customer) return;

  const result = await Order.aggregate([
    {
      $match: {
        customer: customer._id,
        isDeleted: false,
        status: { $nin: ['CANCELLED'] },
      },
    },
    {
      $group: {
        _id: null,
        totalDues: { $sum: '$amountDue' },
      },
    },
  ]);

  customer.currentDues = result.length > 0 ? +result[0].totalDues.toFixed(2) : 0;
  await customer.save();

  return customer.currentDues;
};

/**
 * Get outstanding payments (for collection reminders).
 */
exports.getOutstandingPayments = async (filters = {}) => {
  const query = {
    isDeleted: false,
    status: { $nin: ['CANCELLED'] },
    amountDue: { $gt: 0 },
  };

  if (filters.olderThanDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.olderThanDays);
    query.orderDate = { $lt: cutoff };
  }

  if (filters.customerId) {
    query.customer = filters.customerId;
  }

  const orders = await Order.find(query)
    .populate('customer', 'customerName phone email')
    .sort({ orderDate: 1 })
    .lean();

  const now = new Date();
  return orders.map(o => {
    const orderDate = new Date(o.orderDate);
    const daysOutstanding = Math.floor((now - orderDate) / (1000 * 60 * 60 * 24));
    return {
      ...o,
      daysOutstanding,
      urgency: daysOutstanding > 60 ? 'CRITICAL' :
               daysOutstanding > 30 ? 'HIGH' :
               daysOutstanding > 15 ? 'MEDIUM' : 'LOW',
    };
  });
};
