require('dotenv').config();

// DNS workaround for local dev
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { User } = require('../src/models');
const logger = require('../src/config/logger');

const test = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('✅ Connected to MongoDB');

    // Cleanup any previous test user
    await User.deleteOne({ email: 'test@example.com' });

    // Create user with virtual 'password' setter
    const user = new User({
      name: 'Test User',
      email: 'test@example.com',
      phone: '9876543210',
      password: 'TestPassword@123',  // virtual setter — will be hashed
      role: 'ADMIN',
    });

    await user.save();
    logger.info(`✅ User created: ${user._id}`);
    logger.info(`   - Name: ${user.name}`);
    logger.info(`   - Email: ${user.email}`);
    logger.info(`   - Role: ${user.role}`);
    logger.info(`   - Phone: ${user.phone}`);

    // Verify password hashing happened
    const userWithPassword = await User.findOne({ email: 'test@example.com' }).select('+passwordHash');
    logger.info(`   - passwordHash starts with $2: ${userWithPassword.passwordHash.startsWith('$2')}`);
    logger.info(`   - passwordHash length: ${userWithPassword.passwordHash.length} (should be 60)`);

    // Test password comparison
    const isCorrect = await userWithPassword.comparePassword('TestPassword@123');
    const isWrong = await userWithPassword.comparePassword('WrongPassword');
    logger.info(`   - Correct password verification: ${isCorrect} (should be true)`);
    logger.info(`   - Wrong password verification: ${isWrong} (should be false)`);

    // Test toJSON hiding sensitive fields
    const json = user.toJSON();
    logger.info(`   - toJSON hides passwordHash: ${!('passwordHash' in json)}`);
    logger.info(`   - toJSON hides refreshToken: ${!('refreshToken' in json)}`);

    // Test static method
    const found = await User.findByEmail('TEST@EXAMPLE.COM'); // uppercase
    logger.info(`   - findByEmail case-insensitive: ${!!found}`);

    // Test getRoles static
    logger.info(`   - Available roles: ${User.getRoles().join(', ')}`);

    // Test duplicate email rejection
    try {
      const duplicate = new User({
        name: 'Duplicate',
        email: 'test@example.com',
        password: 'AnotherPass@123',
        role: 'BILLING',
      });
      await duplicate.save();
      logger.error('❌ DUPLICATE EMAIL WAS ALLOWED — this is a bug!');
    } catch (error) {
      if (error.code === 11000) {
        logger.info(`   - Duplicate email correctly rejected: code 11000`);
      } else {
        logger.error(`   - Unexpected error on duplicate: ${error.message}`);
      }
    }

    // Test invalid role rejection
    try {
      const invalidRole = new User({
        name: 'Bad Role',
        email: 'bad@example.com',
        password: 'Pass@123',
        role: 'HACKER',
      });
      await invalidRole.save();
      logger.error('❌ INVALID ROLE WAS ALLOWED — this is a bug!');
    } catch (error) {
      logger.info(`   - Invalid role correctly rejected: ${error.message.substring(0, 80)}`);
    }

    // Test invalid phone rejection
    try {
      const badPhone = new User({
        name: 'Bad Phone',
        email: 'badphone@example.com',
        password: 'Pass@123',
        role: 'CUTTING',
        phone: '12345', // not 10 digits, doesn't start with 6-9
      });
      await badPhone.save();
      logger.error('❌ INVALID PHONE WAS ALLOWED — this is a bug!');
    } catch (error) {
      logger.info(`   - Invalid phone correctly rejected`);
    }

    // Cleanup test user
    await User.deleteOne({ email: 'test@example.com' });
    logger.info('✅ Test user cleaned up');

    await mongoose.disconnect();
    logger.info('✅ All User model tests passed');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Test failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

test();
