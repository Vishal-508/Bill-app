const mongoose = require('mongoose');

const businessSegmentSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z_]+$/, 'Code must be UPPERCASE with underscores only'],
      maxlength: [50, 'Code cannot exceed 50 characters'],
    },
    label: {
      type: String,
      required: [true, 'Label is required'],
      trim: true,
      maxlength: [100, 'Label cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    iconName: {
      type: String,
      trim: true,
      // For future UI (lucide-react icon names: 'camera', 'palette', 'gift', etc.)
    },
    displayOrder: {
      type: Number,
      default: 100,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isSystemDefault: {
      type: Boolean,
      default: false,
      // System defaults cannot be deleted (only deactivated)
      // Custom segments added by admin can be fully deleted
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

businessSegmentSchema.index({ displayOrder: 1, label: 1 });

// Static: Get all active segments sorted by display order
businessSegmentSchema.statics.getActive = function () {
  return this.find({ isActive: true }).sort({ displayOrder: 1, label: 1 });
};

// Static: Find by code (case-insensitive)
businessSegmentSchema.statics.findByCode = function (code) {
  return this.findOne({ code: code.toUpperCase() });
};

module.exports = mongoose.model('BusinessSegment', businessSegmentSchema);
