require('dotenv').config();

if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { User } = require('../src/models');
const logger = require('../src/config/logger');

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const email = 'testadmin@shreegopal.com';
    const password = 'TestAdmin@123';

    // Delete existing test user if any
    await User.deleteOne({ email });

    const user = new User({
      name: 'Test Admin',
      email,
      password,             // virtual setter
      role: 'ADMIN',
      phone: '9876543210',
    });

    await user.save();

    logger.info('═══════════════════════════════════');
    logger.info('✅ Test user created successfully');
    logger.info('═══════════════════════════════════');
    logger.info(`   Email:    ${email}`);
    logger.info(`   Password: ${password}`);
    logger.info(`   Role:     ${user.role}`);
    logger.info(`   ID:       ${user._id}`);
    logger.info('═══════════════════════════════════');
    logger.info('Now you can test login at POST /api/auth/login');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Failed to create test user:', error);
    process.exit(1);
  }
};

run();
