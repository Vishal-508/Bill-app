const { Payment, Order, Bill, Customer, SystemSetting } = require('../models');
const razorpayService = require('./razorpayService');
const ApiError = require('./ApiError');
const logger = require('../config/logger');

/**
 * Gateway Payment Service — orchestrates online payment flow (Razorpay).
 *
 * SCOPE: gateway-driven online payments only (UPI/Card/NetBanking/Wallet).
 * SEPARATE from utils/paymentService.js (manual cash/cheque on Order.payments).
 *
 * Bridges razorpayService SDK with our Payment model.
 */

/**
 * Initiate a new payment.
 * Creates Razorpay order + Payment record.
 */
exports.initiatePayment = async (data, userId) => {
  const { orderId, amount, billId, notes } = data;

  const gatewayEnabled = await SystemSetting.getValue('PAYMENT_GATEWAY_ENABLED');
  if (!gatewayEnabled) {
    throw ApiError.badRequest('Payment gateway is currently disabled');
  }

  const order = await Order.findById(orderId);
  if (!order || order.isDeleted) {
    throw ApiError.notFound('Order not found');
  }

  if (order.status === 'CANCELLED') {
    throw ApiError.badRequest('Cannot collect payment for cancelled order');
  }

  const totalDue = order.totalAmount - (order.amountPaid || 0);
  if (amount > totalDue + 1) {
    throw ApiError.badRequest(
      `Amount exceeds outstanding balance (₹${totalDue.toFixed(2)})`
    );
  }

  const customer = await Customer.findById(order.customer);
  if (!customer) {
    throw ApiError.badRequest('Customer not found for this order');
  }

  let bill = null;
  if (billId) {
    bill = await Bill.findById(billId);
    if (!bill || bill.isDeleted) {
      throw ApiError.badRequest('Bill not found');
    }
    if (bill.order.toString() !== order._id.toString()) {
      throw ApiError.badRequest('Bill does not belong to this order');
    }
  }

  const amountPaise = razorpayService.toPaise(amount);
  const paymentReference = razorpayService.generatePaymentReference();

  const rzpOrder = await razorpayService.createOrder({
    amount: amountPaise,
    currency: 'INR',
    receipt: paymentReference,
    notes: {
      orderNumber: order.orderNumber,
      customerId: customer._id.toString(),
      customerName: customer.customerName,
      ...(bill && { billNumber: bill.billNumber }),
      ...(notes && { userNotes: notes }),
    },
  });

  const payment = await Payment.create({
    paymentReference,
    gateway: razorpayService.isMockMode() ? 'mock' : 'razorpay',
    razorpayOrderId: rzpOrder.id,
    order: order._id,
    orderNumber: order.orderNumber,
    bill: bill?._id,
    billNumber: bill?.billNumber,
    customer: customer._id,
    customerSnapshot: {
      customerName: customer.customerName,
      phone: customer.phone,
      email: customer.email,
    },
    amount: amountPaise,
    currency: 'INR',
    status: 'CREATED',
    notes,
    createdBy: userId,
  });

  logger.info(`Payment initiated: ${paymentReference} for order ${order.orderNumber} ₹${amount}`);

  return {
    payment,
    razorpayOrder: rzpOrder,
    keyId: razorpayService.getKeyId(),
  };
};

/**
 * Verify a payment after Razorpay returns success.
 */
exports.verifyPayment = async (data, userId) => {
  const { paymentReference, razorpayOrderId, razorpayPaymentId, razorpaySignature } = data;

  const payment = await Payment.findOne({ paymentReference });
  if (!payment) {
    throw ApiError.notFound('Payment record not found');
  }

  if (payment.razorpayOrderId !== razorpayOrderId) {
    throw ApiError.badRequest('Order ID mismatch');
  }

  if (payment.status === 'CAPTURED') {
    logger.info(`Payment ${paymentReference} already verified (idempotent)`);
    return payment;
  }

  const signatureValid = razorpayService.verifyPaymentSignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );

  if (!signatureValid) {
    await payment.markFailed('SIGNATURE_INVALID', 'Payment signature verification failed', {
      source: 'api',
      eventSource: 'api',
    });
    throw ApiError.forbidden('Invalid payment signature');
  }

  let rzpPayment;
  try {
    rzpPayment = await razorpayService.fetchPayment(razorpayPaymentId);
  } catch (err) {
    logger.error(`Failed to fetch payment from Razorpay: ${err.message}`);
    rzpPayment = { status: 'captured', method: 'upi' };
  }

  await payment.markCaptured(razorpayPaymentId, razorpaySignature, {
    method: rzpPayment.method,
    methodDetails: {
      vpa: rzpPayment.vpa,
      cardNetwork: rzpPayment.card?.network,
      cardLast4: rzpPayment.card?.last4,
      bank: rzpPayment.bank,
      wallet: rzpPayment.wallet,
    },
    source: 'api',
  });

  await syncOrderPaymentStatus(payment.order);

  if (payment.bill) {
    await syncBillPaymentStatus(payment.bill);
  }

  logger.info(`Payment verified: ${paymentReference} → CAPTURED`);
  return payment;
};

/**
 * Sync Order's amountPaid from successful gateway payments + existing manual.
 */
async function syncOrderPaymentStatus(orderId) {
  const order = await Order.findById(orderId);
  if (!order) return;

  const capturedPayments = await Payment.find({
    order: orderId,
    status: 'CAPTURED',
    isDeleted: false,
  });

  const totalCapturedRupees = capturedPayments.reduce(
    (sum, p) => sum + razorpayService.toRupees(p.amount - (p.amountRefunded || 0)),
    0
  );

  const manualPaid = (order.payments || []).reduce((s, p) => s + (p.amount || 0), 0);

  order.amountPaid = +(manualPaid + totalCapturedRupees).toFixed(2);
  order.paymentStatus = order.amountPaid >= order.totalAmount ? 'PAID' :
                       order.amountPaid > 0 ? 'PARTIAL' : 'UNPAID';

  await order.save();
  logger.info(`Order ${order.orderNumber} sync: paid=₹${order.amountPaid}, status=${order.paymentStatus}`);
}

/**
 * Sync Bill's amountPaid from gateway payments.
 */
async function syncBillPaymentStatus(billId) {
  const bill = await Bill.findById(billId);
  if (!bill) return;

  const capturedPayments = await Payment.find({
    bill: billId,
    status: 'CAPTURED',
    isDeleted: false,
  });

  const totalCaptured = capturedPayments.reduce(
    (sum, p) => sum + razorpayService.toRupees(p.amount - (p.amountRefunded || 0)),
    0
  );

  bill.amountPaid = +totalCaptured.toFixed(2);
  bill.amountDue = +(bill.grandTotal - totalCaptured).toFixed(2);

  await bill.save();
  logger.info(`Bill ${bill.billNumber} sync: paid=₹${bill.amountPaid}`);
}

exports.syncOrderPaymentStatus = syncOrderPaymentStatus;
exports.syncBillPaymentStatus = syncBillPaymentStatus;

/**
 * Initiate a refund for a captured payment.
 * @param {string} paymentId - MongoDB Payment._id
 * @param {Object} data - { amount?, reason, notes?, refundType? }
 * @param {string} userId - User initiating refund
 */
exports.initiateRefund = async (paymentId, data, userId) => {
  const { amount, reason, notes } = data;

  const payment = await Payment.findById(paymentId);
  if (!payment || payment.isDeleted) {
    throw ApiError.notFound('Payment not found');
  }

  if (payment.status !== 'CAPTURED') {
    throw ApiError.badRequest(
      `Cannot refund payment in '${payment.status}' status (only CAPTURED allowed)`
    );
  }

  const refundAmount = amount ? razorpayService.toPaise(amount) : payment.amount;
  const refundableAmount = payment.amount - (payment.amountRefunded || 0);

  if (refundAmount > refundableAmount) {
    throw ApiError.badRequest(
      `Refund amount (₹${razorpayService.toRupees(refundAmount)}) exceeds refundable balance (₹${razorpayService.toRupees(refundableAmount)})`
    );
  }

  if (refundAmount <= 0) {
    throw ApiError.badRequest('Refund amount must be positive');
  }

  const actualType = refundAmount === payment.amount ? 'full' : 'partial';

  const rzpRefund = await razorpayService.refund(payment.razorpayPaymentId, refundAmount, {
    notes: {
      reason,
      refundType: actualType,
      ...(notes && { internalNotes: notes }),
    },
  });

  payment.razorpayRefundId = rzpRefund.id;
  payment.amountRefunded = (payment.amountRefunded || 0) + refundAmount;

  if (payment.amountRefunded >= payment.amount) {
    payment.status = 'REFUNDED';
  }

  payment.addEvent('REFUND_INITIATED', {
    source: 'api',
    notes: `${actualType} refund: ${reason}`,
    payload: {
      refundId: rzpRefund.id,
      amount: refundAmount,
      refundType: actualType,
    },
  });

  payment.updatedBy = userId;
  await payment.save();

  await syncOrderPaymentStatus(payment.order);
  if (payment.bill) {
    await syncBillPaymentStatus(payment.bill);
  }

  logger.info(`Refund initiated: ${payment.paymentReference} → ₹${razorpayService.toRupees(refundAmount)} (${actualType})`);

  return {
    payment,
    razorpayRefund: rzpRefund,
    refundAmount: razorpayService.toRupees(refundAmount),
    refundType: actualType,
  };
};
