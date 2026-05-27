const mongoose = require('mongoose');
const { Payment, Order, Customer } = require('../models');
const razorpayService = require('./razorpayService');
const logger = require('../config/logger');

/**
 * Reconciliation Service — aggregation queries over Payment + Order data.
 *
 * All amounts in returned data are in RUPEES (converted from paise where needed).
 * All queries respect isDeleted: false.
 */

exports.getSummary = async (options = {}) => {
  const toDate = options.toDate ? new Date(options.toDate) : new Date();
  const fromDate = options.fromDate
    ? new Date(options.fromDate)
    : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const paymentStats = await Payment.aggregate([
    {
      $match: {
        createdAt: { $gte: fromDate, $lte: toDate },
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        totalRefunded: { $sum: '$amountRefunded' },
      },
    },
  ]);

  const gatewayStats = await Payment.aggregate([
    {
      $match: {
        createdAt: { $gte: fromDate, $lte: toDate },
        isDeleted: false,
        status: 'CAPTURED',
      },
    },
    {
      $group: {
        _id: '$gateway',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
      },
    },
  ]);

  const methodStats = await Payment.aggregate([
    {
      $match: {
        createdAt: { $gte: fromDate, $lte: toDate },
        isDeleted: false,
        status: 'CAPTURED',
        method: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: '$method',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
      },
    },
  ]);

  const orderStats = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: fromDate, $lte: toDate },
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: '$paymentStatus',
        count: { $sum: 1 },
        totalOrderValue: { $sum: '$totalAmount' },
        totalPaid: { $sum: '$amountPaid' },
      },
    },
  ]);

  const byStatus = {};
  paymentStats.forEach(s => {
    byStatus[s._id] = {
      count: s.count,
      amount: razorpayService.toRupees(s.totalAmount),
      refunded: razorpayService.toRupees(s.totalRefunded || 0),
    };
  });

  const byGateway = gatewayStats.map(g => ({
    gateway: g._id,
    count: g.count,
    amount: razorpayService.toRupees(g.totalAmount),
  }));

  const byMethod = methodStats.map(m => ({
    method: m._id,
    count: m.count,
    amount: razorpayService.toRupees(m.totalAmount),
  }));

  const orderSummary = {};
  let totalOrderValue = 0;
  let totalPaid = 0;
  orderStats.forEach(o => {
    orderSummary[o._id] = {
      count: o.count,
      orderValue: o.totalOrderValue,
      paid: o.totalPaid,
    };
    totalOrderValue += o.totalOrderValue;
    totalPaid += o.totalPaid;
  });

  return {
    dateRange: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      days: Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24)),
    },
    payments: {
      byStatus,
      byGateway,
      byMethod,
      totalSuccessful: byStatus.CAPTURED?.amount || 0,
      totalFailed: byStatus.FAILED?.amount || 0,
      totalRefunded: Object.values(byStatus).reduce((s, v) => s + (v.refunded || 0), 0),
    },
    orders: {
      byPaymentStatus: orderSummary,
      totalValue: totalOrderValue,
      totalPaid,
      totalOutstanding: totalOrderValue - totalPaid,
    },
  };
};

exports.getOutstanding = async (options = {}) => {
  const limit = Math.min(parseInt(options.limit) || 50, 200);
  const skip = parseInt(options.skip) || 0;

  const filter = {
    isDeleted: false,
    status: { $nin: ['CANCELLED'] },
    paymentStatus: { $in: ['UNPAID', 'PARTIAL'] },
  };

  if (options.customer && mongoose.Types.ObjectId.isValid(options.customer)) {
    filter.customer = options.customer;
  }

  if (options.minDueDays) {
    const dueDateBefore = new Date(Date.now() - options.minDueDays * 24 * 60 * 60 * 1000);
    filter.createdAt = { $lte: dueDateBefore };
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate('customer', 'customerName phone email companyName')
      .select('orderNumber customer totalAmount amountPaid paymentStatus status createdAt'),
    Order.countDocuments(filter),
  ]);

  const now = Date.now();
  const data = orders.map(o => {
    const ageDays = Math.floor((now - o.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    return {
      orderNumber: o.orderNumber,
      orderId: o._id,
      customer: o.customer,
      totalAmount: o.totalAmount,
      amountPaid: o.amountPaid || 0,
      amountDue: o.totalAmount - (o.amountPaid || 0),
      paymentStatus: o.paymentStatus,
      orderStatus: o.status,
      createdAt: o.createdAt,
      ageDays,
      urgency: ageDays > 30 ? 'CRITICAL' : ageDays > 14 ? 'HIGH' : ageDays > 7 ? 'MEDIUM' : 'LOW',
    };
  });

  const totalOutstanding = data.reduce((s, o) => s + o.amountDue, 0);

  return {
    count: data.length,
    total,
    totalOutstandingAmount: totalOutstanding,
    data,
  };
};

exports.getDailyReconciliation = async (dateStr) => {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date format');
  }

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const captured = await Payment.find({
    capturedAt: { $gte: dayStart, $lte: dayEnd },
    status: 'CAPTURED',
    isDeleted: false,
  })
    .populate('customer', 'customerName phone')
    .select('paymentReference amount method gateway orderNumber customer capturedAt')
    .lean();

  const refunded = await Payment.find({
    refundedAt: { $gte: dayStart, $lte: dayEnd },
    amountRefunded: { $gt: 0 },
    isDeleted: false,
  })
    .populate('customer', 'customerName')
    .select('paymentReference amount amountRefunded refundedAt customer orderNumber')
    .lean();

  const orderCount = await Order.countDocuments({
    createdAt: { $gte: dayStart, $lte: dayEnd },
    isDeleted: false,
  });

  const orderValue = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: dayStart, $lte: dayEnd },
        isDeleted: false,
      },
    },
    { $group: { _id: null, total: { $sum: '$totalAmount' } } },
  ]);

  const totalCaptured = captured.reduce((s, p) => s + p.amount, 0);
  const totalRefunded = refunded.reduce((s, p) => s + (p.amountRefunded || 0), 0);

  return {
    date: dateStr,
    payments: {
      count: captured.length,
      total: razorpayService.toRupees(totalCaptured),
      data: captured.map(p => ({
        paymentReference: p.paymentReference,
        orderNumber: p.orderNumber,
        customer: p.customer,
        amount: razorpayService.toRupees(p.amount),
        method: p.method,
        gateway: p.gateway,
        capturedAt: p.capturedAt,
      })),
    },
    refunds: {
      count: refunded.length,
      total: razorpayService.toRupees(totalRefunded),
      data: refunded.map(r => ({
        paymentReference: r.paymentReference,
        orderNumber: r.orderNumber,
        customer: r.customer,
        refundedAmount: razorpayService.toRupees(r.amountRefunded),
        refundedAt: r.refundedAt,
      })),
    },
    orders: {
      count: orderCount,
      totalValue: orderValue[0]?.total || 0,
    },
    netCollection: razorpayService.toRupees(totalCaptured - totalRefunded),
  };
};

exports.getCustomerReconciliation = async (customerId) => {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    throw new Error('Invalid customer ID');
  }

  const customer = await Customer.findById(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }

  const orderStats = await Order.aggregate([
    {
      $match: {
        customer: new mongoose.Types.ObjectId(customerId),
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: '$paymentStatus',
        count: { $sum: 1 },
        totalAmount: { $sum: '$totalAmount' },
        totalPaid: { $sum: '$amountPaid' },
      },
    },
  ]);

  const paymentStats = await Payment.aggregate([
    {
      $match: {
        customer: new mongoose.Types.ObjectId(customerId),
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        totalRefunded: { $sum: '$amountRefunded' },
      },
    },
  ]);

  let totalOrderValue = 0;
  let totalPaid = 0;
  const orderSummary = {};
  orderStats.forEach(o => {
    orderSummary[o._id] = { count: o.count, value: o.totalAmount, paid: o.totalPaid };
    totalOrderValue += o.totalAmount;
    totalPaid += o.totalPaid;
  });

  const paymentSummary = {};
  paymentStats.forEach(p => {
    paymentSummary[p._id] = {
      count: p.count,
      amount: razorpayService.toRupees(p.totalAmount),
      refunded: razorpayService.toRupees(p.totalRefunded || 0),
    };
  });

  return {
    customer: {
      _id: customer._id,
      customerName: customer.customerName,
      phone: customer.phone,
      companyName: customer.companyName,
      currentDues: customer.currentDues,
    },
    orders: {
      byPaymentStatus: orderSummary,
      totalValue: totalOrderValue,
      totalPaid,
      outstanding: totalOrderValue - totalPaid,
    },
    payments: {
      byStatus: paymentSummary,
      totalCaptured: paymentSummary.CAPTURED?.amount || 0,
      totalRefunded: Object.values(paymentSummary).reduce((s, v) => s + (v.refunded || 0), 0),
    },
  };
};

exports.detectDiscrepancies = async (options = {}) => {
  const limit = Math.min(parseInt(options.limit) || 50, 200);

  const orders = await Order.find({
    isDeleted: false,
    status: { $ne: 'CANCELLED' },
  })
    .populate('customer', 'customerName phone')
    .select('orderNumber customer totalAmount amountPaid paymentStatus payments')
    .limit(500)
    .lean();

  const discrepancies = [];

  for (const order of orders) {
    const capturedPayments = await Payment.find({
      order: order._id,
      status: 'CAPTURED',
      isDeleted: false,
    }).select('amount amountRefunded').lean();

    const gatewayPaidPaise = capturedPayments.reduce((s, p) =>
      s + (p.amount - (p.amountRefunded || 0)), 0
    );
    const gatewayPaidRupees = razorpayService.toRupees(gatewayPaidPaise);

    const manualPaid = (order.payments || []).reduce((s, p) => s + (p.amount || 0), 0);

    const expectedTotal = manualPaid + gatewayPaidRupees;
    const recordedTotal = order.amountPaid || 0;
    const diff = Math.abs(expectedTotal - recordedTotal);

    if (diff > 0.01) {
      discrepancies.push({
        orderNumber: order.orderNumber,
        orderId: order._id,
        customer: order.customer,
        orderTotal: order.totalAmount,
        recordedAmountPaid: recordedTotal,
        manualPayments: manualPaid,
        gatewayPayments: gatewayPaidRupees,
        expectedTotal,
        difference: expectedTotal - recordedTotal,
        paymentStatus: order.paymentStatus,
      });
    }

    if (discrepancies.length >= limit) break;
  }

  return {
    count: discrepancies.length,
    totalChecked: orders.length,
    data: discrepancies,
  };
};
