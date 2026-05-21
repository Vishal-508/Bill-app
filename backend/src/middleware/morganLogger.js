const morgan = require('morgan');
const logger = require('../config/logger');

// Custom token for response body size
morgan.token('body-size', (req, res) => {
  return res.get('Content-Length') || '0';
});

// Stream morgan output through Winston
const stream = {
  write: (message) => logger.http ? logger.http(message.trim()) : logger.info(message.trim()),
};

// Skip logging in test environment
const skip = () => process.env.NODE_ENV === 'test';

const morganMiddleware = morgan(
  ':remote-addr :method :url :status :res[content-length] - :response-time ms',
  { stream, skip }
);

module.exports = morganMiddleware;
