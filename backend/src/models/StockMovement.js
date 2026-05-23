const mongoose = require('mongoose');

/**
 * StockMovement — audit log for all inventory changes.
 * Tracks WHO changed WHAT stock WHEN and WHY.
 */
const stockMovementSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    productSnapshot: {
      sku: String,
      name: String,
      productType: String,
    },

    movementType: {
      type: String,
      enum: ['DEDUCTION', 'RESTORATION', 'MANUAL_ADJUSTMENT', 'RESTOCK', 'CORRECTION'],
      required: true,
      index: true,
    },

    quantityBefore: { type: Number, required: true },
    quantityChange: { type: Number, required: true },
    quantityAfter: { type: Number, required: true },

    bundleQuantityBefore: Number,
    bundleQuantityChange: Number,
    bundleQuantityAfter: Number,

    reason: { type: String, trim: true, maxlength: 500 },
    relatedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      index: true,
    },
    relatedOrderNumber: String,

    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    performedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

stockMovementSchema.index({ product: 1, performedAt: -1 });
stockMovementSchema.index({ movementType: 1, performedAt: -1 });

module.exports = mongoose.model('StockMovement', stockMovementSchema);
