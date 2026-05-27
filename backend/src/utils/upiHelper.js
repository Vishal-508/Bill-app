const QRCode = require('qrcode');
const { SystemSetting } = require('../models');
const logger = require('../config/logger');

/**
 * UPI Helper — generate UPI payment URIs and QR codes.
 *
 * UPI URI Spec: https://www.npci.org.in/PDF/npci/upi/UPI-Linking-Specs.pdf
 * Format: upi://pay?pa=<VPA>&pn=<Name>&am=<Amount>&tn=<Note>&tr=<Reference>&cu=INR
 */

exports.buildUpiUri = ({ vpa, payeeName, amount, transactionRef, transactionNote }) => {
  if (!vpa) throw new Error('VPA is required');
  if (!payeeName) throw new Error('Payee name is required');
  if (!amount || amount <= 0) throw new Error('Amount must be positive');

  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: amount.toFixed(2),
    cu: 'INR',
  });

  if (transactionRef) params.append('tr', transactionRef);
  if (transactionNote) params.append('tn', transactionNote);

  return `upi://pay?${params.toString()}`;
};

exports.getBusinessVpa = async () => {
  return await SystemSetting.getValue('BUSINESS_UPI_VPA', 'shreegopal@upi');
};

exports.getBusinessName = async () => {
  return await SystemSetting.getValue('BUSINESS_NAME', 'Shree Gopal MDF');
};

exports.buildUpiUriForPayment = async (payment) => {
  const [vpa, payeeName] = await Promise.all([
    exports.getBusinessVpa(),
    exports.getBusinessName(),
  ]);

  const amountRupees = payment.amount / 100;

  return exports.buildUpiUri({
    vpa,
    payeeName,
    amount: amountRupees,
    transactionRef: payment.paymentReference,
    transactionNote: `Order ${payment.orderNumber || 'Payment'}`,
  });
};

exports.generateQrDataUrl = async (text, options = {}) => {
  try {
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      type: 'image/png',
      margin: options.margin || 1,
      width: options.width || 300,
      color: {
        dark: options.darkColor || '#000000',
        light: options.lightColor || '#FFFFFF',
      },
    });
  } catch (err) {
    logger.error('QR code generation failed:', err);
    throw new Error(`QR generation failed: ${err.message}`);
  }
};

exports.generateQrBuffer = async (text, options = {}) => {
  try {
    return await QRCode.toBuffer(text, {
      errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      type: 'png',
      margin: options.margin || 1,
      width: options.width || 300,
      color: {
        dark: options.darkColor || '#000000',
        light: options.lightColor || '#FFFFFF',
      },
    });
  } catch (err) {
    logger.error('QR buffer generation failed:', err);
    throw new Error(`QR generation failed: ${err.message}`);
  }
};

exports.generateQrSvg = async (text, options = {}) => {
  try {
    return await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      margin: options.margin || 1,
      width: options.width || 300,
      color: {
        dark: options.darkColor || '#000000',
        light: options.lightColor || '#FFFFFF',
      },
    });
  } catch (err) {
    logger.error('QR SVG generation failed:', err);
    throw new Error(`QR generation failed: ${err.message}`);
  }
};
