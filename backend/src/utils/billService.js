const { Bill, Order, Customer, SystemSetting } = require('../models');
const { getFiscalYear } = require('./billNumberGenerator');
const ApiError = require('./ApiError');
const logger = require('../config/logger');

/**
 * Bill Service — orchestrates bill creation from orders.
 * Handles snapshot capture, computation, and pre-save data prep.
 */

exports.buildBillFromOrder = async (order, options = {}) => {
  if (!order) throw new Error('Order is required');

  const [
    businessName,
    businessAddress,
    businessPhone,
    businessEmail,
    businessGstin,
    businessState,
    businessBankDetails,
    defaultTerms,
  ] = await Promise.all([
    SystemSetting.getValue('BUSINESS_NAME', 'Shree Gopal MDF'),
    SystemSetting.getValue('BUSINESS_ADDRESS', ''),
    SystemSetting.getValue('BUSINESS_PHONE', ''),
    SystemSetting.getValue('BUSINESS_EMAIL', ''),
    SystemSetting.getValue('BUSINESS_GSTIN', ''),
    SystemSetting.getValue('BUSINESS_STATE', 'Madhya Pradesh'),
    SystemSetting.getValue('BUSINESS_BANK_DETAILS', ''),
    SystemSetting.getValue('INVOICE_TERMS_DEFAULT', ''),
  ]);

  const customer = await Customer.findById(order.customer).lean();
  if (!customer) {
    throw ApiError.badRequest('Customer not found for this order');
  }

  const customerInfo = {
    customerName: customer.customerName,
    companyName: customer.companyName,
    phone: customer.phone,
    email: customer.email,
    gstin: customer.gstin,
    billingAddress: customer.billingAddress,
    shippingAddress: customer.shippingAddress,
  };

  const businessInfo = {
    name: businessName,
    address: businessAddress,
    phone: businessPhone,
    email: businessEmail,
    gstin: businessGstin,
    state: businessState,
    bankDetails: businessBankDetails,
  };

  const hasGst = options.hasGst !== false;

  const items = order.items.map((item, idx) => ({
    serialNo: idx + 1,
    hsnCode: item.hsnCode || '4411',
    description: item.productSnapshot?.name || 'Item',
    productSku: item.productSnapshot?.sku,
    productName: item.productSnapshot?.name,
    itemType: item.itemType,
    dimensions: item.dimensions ? {
      lengthInches: item.dimensions.lengthInches,
      widthInches: item.dimensions.widthInches,
      display: item.dimensions.lengthDisplay && item.dimensions.widthDisplay
        ? `${item.dimensions.lengthDisplay} × ${item.dimensions.widthDisplay}`
        : item.dimensions.lengthInches && item.dimensions.widthInches
        ? `${item.dimensions.lengthInches}×${item.dimensions.widthInches} inch`
        : null,
    } : undefined,
    quantity: item.quantity,
    unit: item.itemType === 'BUNDLE' ? 'bundles' :
          item.itemType === 'CUSTOM_CUT' ? 'pieces' : 'sheets',
    pricePerUnit: item.pricePerUnit,
    materialCost: item.materialCost,
    cuttingCharges: item.cuttingCharges || 0,
    discountAmount: item.discountAmount || 0,
    taxableAmount: item.lineSubtotal,
    gstRatePct: order.gstRatePct || 18,
    cgst: hasGst && order.isIntraState ? +(item.lineSubtotal * 0.09).toFixed(2) : 0,
    sgst: hasGst && order.isIntraState ? +(item.lineSubtotal * 0.09).toFixed(2) : 0,
    igst: hasGst && !order.isIntraState ? +(item.lineSubtotal * 0.18).toFixed(2) : 0,
    lineTotal: +(item.lineSubtotal * (hasGst ? 1.18 : 1)).toFixed(2),
    notes: item.notes,
  }));

  return {
    customer: order.customer,
    order: order._id,
    orderNumber: order.orderNumber,
    fiscalYear: getFiscalYear(),

    format: options.format || 'detailed',
    language: options.language || 'en',
    hasGst,

    customerInfo,
    businessInfo,
    items,

    subtotal: order.subtotal,
    additionalCharges: order.additionalCharges || 0,
    totalDiscount: order.discountAmount || 0,
    taxableAmount: order.taxableAmount,
    isIntraState: order.isIntraState,
    totalCgst: hasGst ? (order.cgst || 0) : 0,
    totalSgst: hasGst ? (order.sgst || 0) : 0,
    totalIgst: hasGst ? (order.igst || 0) : 0,
    totalGst: hasGst ? (order.totalGst || 0) : 0,
    grandTotal: hasGst ? order.totalAmount : order.taxableAmount,

    amountPaid: order.amountPaid || 0,
    amountDue: hasGst
      ? (order.totalAmount - (order.amountPaid || 0))
      : (order.taxableAmount - (order.amountPaid || 0)),
    paymentStatus: order.paymentStatus || 'UNPAID',

    deliveryMethod: options.deliveryMethod || order.deliveryMethod,
    transportDetails: options.transportDetails,
    vehicleNumber: options.vehicleNumber,
    placeOfSupply: customer.billingAddress?.state || businessState,

    notesToCustomer: options.notesToCustomer,
    internalNotes: options.internalNotes,
    termsAndConditions: options.termsAndConditions || defaultTerms,
    dueDate: options.dueDate,
  };
};

exports.syncPaymentFromOrder = async (bill) => {
  const order = await Order.findById(bill.order);
  if (!order) return bill;

  bill.amountPaid = order.amountPaid || 0;
  bill.amountDue = bill.grandTotal - bill.amountPaid;

  await bill.save();

  logger.info(`Bill ${bill.billNumber} payment synced: ₹${bill.amountPaid} paid, ₹${bill.amountDue} due`);
  return bill;
};
