require('dotenv').config();

// DNS workaround for local dev (consistent with our other scripts)
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { z } = require('zod');
const { User } = require('../src/models');
const logger = require('../src/config/logger');

/**
 * Validates the seed environment variables before attempting any DB operation.
 * Uses our Zod password rules from the auth validator for consistency.
 */
const validateEnv = () => {
  const seedSchema = z.object({
    SEED_ADMIN_EMAIL: z
      .string()
      .trim()
      .toLowerCase()
      .email('SEED_ADMIN_EMAIL must be a valid email'),
    SEED_ADMIN_PASSWORD: z
      .string()
      .min(8, 'SEED_ADMIN_PASSWORD must be at least 8 characters')
      .regex(/[A-Z]/, 'SEED_ADMIN_PASSWORD must contain an uppercase letter')
      .regex(/[a-z]/, 'SEED_ADMIN_PASSWORD must contain a lowercase letter')
      .regex(/[0-9]/, 'SEED_ADMIN_PASSWORD must contain a number'),
    SEED_ADMIN_NAME: z
      .string()
      .trim()
      .min(2, 'SEED_ADMIN_NAME must be at least 2 characters')
      .max(100, 'SEED_ADMIN_NAME cannot exceed 100 characters'),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  });

  try {
    return seedSchema.parse({
      SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL,
      SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD,
      SEED_ADMIN_NAME: process.env.SEED_ADMIN_NAME,
      MONGODB_URI: process.env.MONGODB_URI,
    });
  } catch (error) {
    logger.error('═══════════════════════════════════════');
    logger.error('❌ Seed environment validation failed:');
    logger.error('═══════════════════════════════════════');
    if (error.errors) {
      error.errors.forEach((err) => {
        logger.error(`   • ${err.path.join('.')}: ${err.message}`);
      });
    } else {
      logger.error(`   ${error.message}`);
    }
    logger.error('');
    logger.error('Set these values in backend/.env and retry:');
    logger.error('   SEED_ADMIN_EMAIL=admin@yourdomain.com');
    logger.error('   SEED_ADMIN_PASSWORD=YourStrong@Password123');
    logger.error('   SEED_ADMIN_NAME=Your Full Name');
    logger.error('═══════════════════════════════════════');
    process.exit(1);
  }
};

const seed = async () => {
  let env;
  try {
    // Step 1: Validate environment
    env = validateEnv();
    logger.info('✅ Environment validation passed');

    // Step 2: Connect to MongoDB
    await mongoose.connect(env.MONGODB_URI);
    logger.info('✅ Connected to MongoDB');

    // Step 3: Check if a SUPER_ADMIN already exists
    const existingSuperAdmin = await User.findOne({ role: 'SUPER_ADMIN' });

    if (existingSuperAdmin) {
      // Step 4a: Idempotent path — skip if already seeded
      logger.info('═══════════════════════════════════════');
      logger.info('ℹ️  SUPER_ADMIN already exists — skipping');
      logger.info('═══════════════════════════════════════');
      logger.info(`   Existing admin:`);
      logger.info(`   • Name:      ${existingSuperAdmin.name}`);
      logger.info(`   • Email:     ${existingSuperAdmin.email}`);
      logger.info(`   • Created:   ${existingSuperAdmin.createdAt.toISOString()}`);
      logger.info(`   • Last login: ${existingSuperAdmin.lastLoginAt?.toISOString() || 'never'}`);
      logger.info('');
      logger.info('   This script is idempotent — running it again is safe.');
      logger.info('   To create a different super admin, manually delete the existing one first.');
      logger.info('═══════════════════════════════════════');

      await mongoose.disconnect();
      process.exit(0);
    }

    // Step 4b: Create new SUPER_ADMIN
    logger.info('Creating SUPER_ADMIN user...');

    // Check if a user with this email already exists (but with a different role)
    const existingEmail = await User.findOne({ email: env.SEED_ADMIN_EMAIL });
    if (existingEmail) {
      logger.error(`❌ A user with email '${env.SEED_ADMIN_EMAIL}' already exists`);
      logger.error(`   Their role is: ${existingEmail.role}`);
      logger.error(`   Either delete that user manually or change SEED_ADMIN_EMAIL`);
      await mongoose.disconnect();
      process.exit(1);
    }

    const admin = new User({
      name: env.SEED_ADMIN_NAME,
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,  // virtual setter → pre-save hashes
      role: 'SUPER_ADMIN',
      isActive: true,
      permissions: [], // SUPER_ADMIN has implicit all-permissions
    });

    await admin.save();

    logger.info('═══════════════════════════════════════');
    logger.info('🎉 SUPER_ADMIN created successfully!');
    logger.info('═══════════════════════════════════════');
    logger.info(`   Name:    ${admin.name}`);
    logger.info(`   Email:   ${admin.email}`);
    logger.info(`   Role:    ${admin.role}`);
    logger.info(`   ID:      ${admin._id}`);
    logger.info(`   Created: ${admin.createdAt.toISOString()}`);
    logger.info('═══════════════════════════════════════');
    logger.info('');
    logger.info('🔑 You can now log in with:');
    logger.info(`   Email:    ${env.SEED_ADMIN_EMAIL}`);
    logger.info(`   Password: <as set in SEED_ADMIN_PASSWORD>`);
    logger.info('');
    logger.info('⚠️  IMPORTANT: Change SEED_ADMIN_PASSWORD in .env to a placeholder');
    logger.info('    once you have successfully logged in and changed your password');
    logger.info('    via POST /api/auth/change-password');
    logger.info('═══════════════════════════════════════');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('❌ Seeding failed:', error.message);
    if (error.stack && process.env.NODE_ENV !== 'production') {
      logger.error(error.stack);
    }
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

// Confirm before running in production
if (process.env.NODE_ENV === 'production') {
  logger.warn('⚠️  Running seed in PRODUCTION environment');
  logger.warn('   This script is idempotent so it should be safe, but verify intent.');
  logger.warn('   Sleeping 3 seconds — Ctrl+C to abort');
  setTimeout(seed, 3000);
} else {
  seed();
}
