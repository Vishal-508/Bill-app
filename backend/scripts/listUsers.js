require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { User } = require('../src/models');
const logger = require('../src/config/logger');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const users = await User.find().sort({ createdAt: 1 });

  logger.info(`Total users in DB: ${users.length}`);
  users.forEach((u, i) => {
    logger.info(`${i + 1}. ${u.name} | ${u.email} | ${u.role} | created ${u.createdAt.toISOString()}`);
  });

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(e => { console.error(e); process.exit(1); });
