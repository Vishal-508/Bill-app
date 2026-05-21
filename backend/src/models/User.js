const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'BILLING', 'CUTTING', 'DELIVERY'];

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format'],
    },
    phone: {
      type: String,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Phone must be a valid 10-digit Indian mobile number'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password is required'],
      select: false, // Don't return by default in queries
    },
    role: {
      type: String,
      enum: {
        values: ROLES,
        message: '{VALUE} is not a valid role',
      },
      default: 'CUTTING',
      required: true,
      index: true,
    },
    permissions: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastLoginAt: {
      type: Date,
    },
    lastLoginIP: {
      type: String,
    },
    refreshToken: {
      type: String,
      select: false, // Hidden by default
    },
    refreshTokenExpiresAt: {
      type: Date,
      select: false,
    },
    passwordChangedAt: {
      type: Date,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    lockedUntil: {
      type: Date,
      select: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true, // Adds createdAt + updatedAt
    toJSON: {
      transform: (doc, ret) => {
        delete ret.passwordHash;
        delete ret.refreshToken;
        delete ret.refreshTokenExpiresAt;
        delete ret.failedLoginAttempts;
        delete ret.lockedUntil;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ═══ Indexes ═══
// Compound index for common queries
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ email: 1, isActive: 1 });

// Phone is optional but unique when present
userSchema.index({ phone: 1 }, { unique: true, sparse: true });

// ═══ Pre-save: Hash password if modified ═══
userSchema.pre('save', async function (next) {
  // Only hash if password field was modified (use virtual 'password' setter — see below)
  if (!this.isModified('passwordHash')) return next();

  try {
    // Check if it's already hashed (starts with $2a$ or $2b$)
    if (this.passwordHash.startsWith('$2a$') || this.passwordHash.startsWith('$2b$')) {
      return next();
    }

    const salt = await bcrypt.genSalt(12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    this.passwordChangedAt = new Date();
    next();
  } catch (error) {
    next(error);
  }
});

// ═══ Virtual: 'password' setter for convenience ═══
// Allows setting user.password = 'plain' and the pre-save hook will hash it
userSchema.virtual('password').set(function (plainPassword) {
  this.passwordHash = plainPassword;
});

// ═══ Instance Method: Compare password ═══
userSchema.methods.comparePassword = async function (plainPassword) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plainPassword, this.passwordHash);
};

// ═══ Instance Method: Check if account is locked ═══
userSchema.methods.isLocked = function () {
  return !!(this.lockedUntil && this.lockedUntil > Date.now());
};

// ═══ Instance Method: Increment failed login attempts ═══
userSchema.methods.incrementFailedAttempts = async function () {
  const MAX_ATTEMPTS = 5;
  const LOCK_TIME_MS = 30 * 60 * 1000; // 30 minutes

  // If previously locked but lock has expired, reset
  if (this.lockedUntil && this.lockedUntil < Date.now()) {
    return this.updateOne({
      $set: { failedLoginAttempts: 1, lockedUntil: null },
    });
  }

  const updates = { $inc: { failedLoginAttempts: 1 } };

  // Lock account after MAX_ATTEMPTS
  if (this.failedLoginAttempts + 1 >= MAX_ATTEMPTS && !this.isLocked()) {
    updates.$set = { lockedUntil: new Date(Date.now() + LOCK_TIME_MS) };
  }

  return this.updateOne(updates);
};

// ═══ Instance Method: Reset failed attempts on successful login ═══
userSchema.methods.resetFailedAttempts = async function () {
  return this.updateOne({
    $set: { failedLoginAttempts: 0, lockedUntil: null },
  });
};

// ═══ Instance Method: Update last login info ═══
userSchema.methods.updateLastLogin = async function (ip) {
  this.lastLoginAt = new Date();
  this.lastLoginIP = ip;
  return this.save({ validateBeforeSave: false });
};

// ═══ Static: Find by email (case-insensitive) ═══
userSchema.statics.findByEmail = function (email) {
  return this.findOne({ email: email.toLowerCase().trim() });
};

// ═══ Static: Get all roles (utility) ═══
userSchema.statics.getRoles = function () {
  return ROLES;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
