const { SystemSetting } = require('../models');
const razorpayService = require('./razorpayService');
const { amountToWords } = require('./amountToWords');

/**
 * Transform Payment data into receipt template format.
 */
exports.mapPaymentToReceipt = async (payment) => {
  const p = payment.toObject ? payment.toObject() : payment;

  const [businessName, businessAddress, businessPhone, businessEmail, businessGstin, businessState] = await Promise.all([
    SystemSetting.getValue('BUSINESS_NAME', 'Shree Gopal MDF'),
    SystemSetting.getValue('BUSINESS_ADDRESS', ''),
    SystemSetting.getValue('BUSINESS_PHONE', ''),
    SystemSetting.getValue('BUSINESS_EMAIL', ''),
    SystemSetting.getValue('BUSINESS_GSTIN', ''),
    SystemSetting.getValue('BUSINESS_STATE', 'Madhya Pradesh'),
  ]);

  const captureEvent = p.events?.find(e => e.eventType === 'CAPTURED');

  const amountRupees = razorpayService.toRupees(p.amount);
  const amountRefundedRupees = razorpayService.toRupees(p.amountRefunded || 0);
  const netAmountRupees = amountRupees - amountRefundedRupees;

  const methodDisplay = {
    upi: 'UPI',
    card: 'Card',
    netbanking: 'Net Banking',
    wallet: 'Wallet',
    emi: 'EMI',
    other: 'Other',
  }[p.method] || p.method || 'Unknown';

  let methodDetailDisplay = '';
  if (p.methodDetails) {
    if (p.method === 'upi' && p.methodDetails.vpa) {
      methodDetailDisplay = `VPA: ${p.methodDetails.vpa}`;
    } else if (p.method === 'card' && p.methodDetails.cardLast4) {
      methodDetailDisplay = `${p.methodDetails.cardNetwork || 'Card'} ending in ${p.methodDetails.cardLast4}`;
    } else if (p.method === 'netbanking' && p.methodDetails.bank) {
      methodDetailDisplay = `Bank: ${p.methodDetails.bank}`;
    } else if (p.method === 'wallet' && p.methodDetails.wallet) {
      methodDetailDisplay = `Wallet: ${p.methodDetails.wallet}`;
    }
  }

  const refunds = (p.events || [])
    .filter(e => ['REFUND_INITIATED', 'REFUNDED'].includes(e.eventType))
    .map(e => ({
      eventType: e.eventType,
      eventAt: e.eventAt,
      notes: e.notes,
    }));

  return {
    paymentReference: p.paymentReference,
    razorpayPaymentId: p.razorpayPaymentId,
    razorpayOrderId: p.razorpayOrderId,
    razorpayRefundId: p.razorpayRefundId,

    capturedAt: p.capturedAt || captureEvent?.eventAt,
    receiptDate: new Date(),

    business: {
      name: businessName,
      address: businessAddress,
      phone: businessPhone,
      email: businessEmail,
      gstin: businessGstin,
      state: businessState,
    },

    customer: p.customerSnapshot || {},

    orderNumber: p.orderNumber,
    billNumber: p.billNumber,

    amount: amountRupees,
    amountInWords: amountToWords(amountRupees),
    amountRefunded: amountRefundedRupees,
    netAmount: netAmountRupees,
    netAmountInWords: amountToWords(netAmountRupees),
    currency: p.currency || 'INR',

    method: p.method,
    methodDisplay,
    methodDetailDisplay,
    gateway: p.gateway,

    status: p.status,
    isRefunded: p.status === 'REFUNDED',
    isPartiallyRefunded: amountRefundedRupees > 0 && amountRefundedRupees < amountRupees,
    hasRefund: amountRefundedRupees > 0,

    refunds,

    showRefundSection: amountRefundedRupees > 0,
  };
};
