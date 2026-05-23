/**
 * Universal unit conversion for MDF dimensions.
 * All internal storage is in INCHES.
 */

const TO_INCHES = {
  inch: 1,
  in: 1,
  ft: 12,        // 1 ft = 12 inches
  feet: 12,
  cm: 0.3937,    // 1 cm = 0.3937 inches
  mm: 0.03937,   // 1 mm = 0.03937 inches
  m: 39.37,      // 1 m = 39.37 inches
  meter: 39.37,
};

const SUPPORTED_UNITS = ['inch', 'ft', 'cm', 'mm'];

/**
 * Convert value from any unit to inches (internal storage)
 */
exports.toInches = (value, fromUnit) => {
  const unit = fromUnit?.toLowerCase();
  if (!TO_INCHES[unit]) {
    throw new Error(`Unsupported unit: ${fromUnit}. Use: ${SUPPORTED_UNITS.join(', ')}`);
  }
  return +(value * TO_INCHES[unit]).toFixed(4);
};

/**
 * Convert inches to target unit for display
 */
exports.fromInches = (inches, toUnit) => {
  const unit = toUnit?.toLowerCase();
  if (!TO_INCHES[unit]) {
    throw new Error(`Unsupported unit: ${toUnit}`);
  }
  return +(inches / TO_INCHES[unit]).toFixed(4);
};

/**
 * Format dimensions for display
 * @returns "12×8 inch" or "1×0.67 ft" etc.
 */
exports.formatDimensions = (lengthIn, widthIn, displayUnit = 'inch') => {
  const l = exports.fromInches(lengthIn, displayUnit);
  const w = exports.fromInches(widthIn, displayUnit);
  const unitLabel = displayUnit === 'inch' ? 'inch' : displayUnit;
  return `${l}×${w} ${unitLabel}`;
};

/**
 * Calculate area in sq inches
 */
exports.areaSqInches = (lengthIn, widthIn) => {
  return +(lengthIn * widthIn).toFixed(4);
};

/**
 * Convert sq inches to sq feet
 */
exports.sqInchesToSqFt = (sqIn) => {
  return +(sqIn / 144).toFixed(4);
};

exports.SUPPORTED_UNITS = SUPPORTED_UNITS;
