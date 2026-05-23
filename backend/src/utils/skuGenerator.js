const { Product, ProductGrade } = require('../models');

/**
 * Generate intelligent SKU for MDF products.
 * Format: MDF-{THICKNESS}-{LENGTH}X{WIDTH}-{GRADE_CODE}-{SEQUENCE}
 *
 * Examples:
 *   MDF-18MM-8X4-INTERIOR-001
 *   MDF-12MM-8X4-MR-002
 *   MDF-1.8MM-6X4-HDHMR-001
 *
 * @param {Object} productData - { thicknessMM, lengthFT, widthFT, grade }
 * @returns {Promise<string>} Unique SKU
 */
exports.generateSKU = async (productData) => {
  const { thicknessMM, lengthFT = 8, widthFT = 4, grade: gradeId } = productData;

  if (!thicknessMM || !gradeId) {
    throw new Error('thicknessMM and grade are required for SKU generation');
  }

  const grade = await ProductGrade.findById(gradeId);
  if (!grade) {
    throw new Error('Grade not found for SKU generation');
  }

  const thicknessStr = Number.isInteger(thicknessMM)
    ? `${thicknessMM}MM`
    : `${thicknessMM}MM`;

  const lengthStr = Number.isInteger(lengthFT) ? lengthFT : lengthFT.toFixed(1);
  const widthStr = Number.isInteger(widthFT) ? widthFT : widthFT.toFixed(1);
  const dimensionsStr = `${lengthStr}X${widthStr}`;

  const prefix = `MDF-${thicknessStr}-${dimensionsStr}-${grade.code}-`;

  const existing = await Product.find({
    sku: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` },
  })
    .select('sku')
    .sort({ sku: -1 })
    .limit(1)
    .lean();

  let sequence = 1;
  if (existing.length > 0) {
    const lastSku = existing[0].sku;
    const match = lastSku.match(/(\d+)$/);
    if (match) {
      sequence = parseInt(match[1], 10) + 1;
    }
  }

  const sequenceStr = sequence < 1000 ? String(sequence).padStart(3, '0') : String(sequence);

  return `${prefix}${sequenceStr}`;
};

/**
 * Validate a manually-provided SKU format (for admin overrides).
 */
exports.validateSKUFormat = (sku) => {
  if (!sku || sku.length < 3 || sku.length > 50) return false;
  return /^[A-Z0-9][A-Z0-9_-]*[A-Z0-9]$/.test(sku);
};
