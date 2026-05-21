const mongoose = require('mongoose');
const logger = require('./logger');

const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wire up connection event listeners + graceful shutdown.
// Called exactly once after the first successful connect.
let listenersWired = false;
const setupEventListeners = () => {
  if (listenersWired) return;
  listenersWired = true;

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected. Attempting to reconnect...');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed due to app termination');
    process.exit(0);
  });
};

const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not defined in environment variables');
  }

  const options = {
    maxPoolSize: 10,           // Maximum 10 simultaneous connections
    minPoolSize: 2,            // Maintain 2 idle connections
    serverSelectionTimeoutMS: 5000,  // 5s timeout for initial connection
    socketTimeoutMS: 45000,    // 45s timeout for operations
    family: 4,                 // Use IPv4 (avoids some network issues)
  };

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const conn = await mongoose.connect(mongoUri, options);

      logger.info(`✅ MongoDB connected: ${conn.connection.host}`);
      logger.info(`📊 Database: ${conn.connection.name}`);

      setupEventListeners();
      return conn;
    } catch (error) {
      attempt++;
      logger.error(
        `❌ Connection attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`
      );

      if (attempt >= MAX_RETRIES) {
        throw new Error(
          `Failed to connect to MongoDB after ${MAX_RETRIES} attempts: ${error.message}`
        );
      }

      logger.info(`🔄 Retrying in ${RETRY_DELAY / 1000}s...`);
      await sleep(RETRY_DELAY);
    }
  }
};

module.exports = connectDB;
