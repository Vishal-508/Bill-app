const { amountToWords } = require('./amountToWords');
const { SystemSetting } = require('../models');

/**
 * Transform Bill model data into template-friendly structure.
 * Centralizes formatting, computations, and template-specific transformations.
 *
 * @param {Bill|Object} bill - Populated Bill document or POJO
 * @returns {Object} Template data ready for Handlebars rendering
 */
exports.mapBillToTemplate = async (bill) => {
  const b = bill.toObject ? bill.toObject() : bill;

  const terms = b.termsAndConditions ||
    await SystemSetting.getValue('INVOICE_TERMS_DEFAULT', '');

  const isIntraState = b.isIntraState !== false;
  const hasGst = b.hasGst !== false;

  const items = (b.items || []).map((item, idx) => ({
    serialNo: idx + 1,
    hsnCode: item.hsnCode || '4411',
    description: item.description || item.productName,
    productSku: item.productSku,
    productName: item.productName,
    itemType: item.itemType,
    dimensions: item.dimensions,
    dimensionsDisplay: item.dimensions?.display ||
      (item.dimensions?.lengthInches && item.dimensions?.widthInches
        ? `${item.dimensions.lengthInches}×${item.dimensions.widthInches} inch`
        : ''),
    quantity: item.quantity,
    unit: item.unit || 'pcs',
    pricePerUnit: item.pricePerUnit,
    materialCost: item.materialCost,
    cuttingCharges: item.cuttingCharges,
    discountAmount: item.discountAmount,
    taxableAmount: item.taxableAmount,
    gstRatePct: item.gstRatePct,
    cgst: item.cgst,
    sgst: item.sgst,
    igst: item.igst,
    lineTotal: item.lineTotal,
    notes: item.notes,
    hasCutting: (item.cuttingCharges || 0) > 0,
    hasDiscount: (item.discountAmount || 0) > 0,
  }));

  return {
    billNumber: b.billNumber,
    fiscalYear: b.fiscalYear,
    issueDate: b.issueDate,
    dueDate: b.dueDate,

    orderNumber: b.orderNumber,

    business: b.businessInfo || {},
    customer: b.customerInfo || {},

    hasGst,
    isIntraState,
    showShippingAddress: !!(b.customerInfo?.shippingAddress?.addressLine1),
    placeOfSupply: b.placeOfSupply || b.customerInfo?.billingAddress?.state || '',

    items,
    itemCount: items.length,

    subtotal: b.subtotal || 0,
    totalDiscount: b.totalDiscount || 0,
    additionalCharges: b.additionalCharges || 0,
    taxableAmount: b.taxableAmount || 0,
    totalCgst: b.totalCgst || 0,
    totalSgst: b.totalSgst || 0,
    totalIgst: b.totalIgst || 0,
    totalGst: b.totalGst || 0,
    roundOff: b.roundOff || 0,
    grandTotal: b.grandTotal || 0,
    amountInWords: b.amountInWords || amountToWords(b.grandTotal || 0),

    amountPaid: b.amountPaid || 0,
    amountDue: b.amountDue || 0,
    paymentStatus: b.paymentStatus || 'UNPAID',

    deliveryMethod: b.deliveryMethod,
    transportDetails: b.transportDetails,
    vehicleNumber: b.vehicleNumber,

    notesToCustomer: b.notesToCustomer,
    termsAndConditions: terms,

    customerSignature: b.customerSignature,
    issuerSignature: b.issuerSignature,

    isReprint: b.events?.some(e => e.eventType === 'PRINTED') || false,
    isRevision: (b.revisionNumber || 0) > 0,
    revisionNumber: b.revisionNumber || 0,
  };
};
