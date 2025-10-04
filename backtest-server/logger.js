const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create separate loggers for different purposes
const businessLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  defaultMeta: { service: 'backtest-server' },
  transports: [
    // Write to business log file
    new winston.transports.File({ 
      filename: path.join(logsDir, 'business.log'),
      level: 'info'
    })
  ]
});

const technicalLogger = winston.createLogger({
  level: 'debug',
  format: logFormat,
  defaultMeta: { service: 'backtest-server' },
  transports: [
    // Write to technical log file
    new winston.transports.File({ 
      filename: path.join(logsDir, 'technical.log'),
      level: 'debug'
    }),
    // Write errors to separate file
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'),
      level: 'error'
    })
  ]
});

const serviceLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  defaultMeta: { service: 'backtest-server' },
  transports: [
    // Write to service log file
    new winston.transports.File({ 
      filename: path.join(logsDir, 'service.log'),
      level: 'info'
    })
  ]
});

// If we're not in production, also log to console
if (process.env.NODE_ENV !== 'production') {
  const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.simple()
  );
  
  businessLogger.add(new winston.transports.Console({
    format: consoleFormat,
    level: 'info'
  }));
  
  technicalLogger.add(new winston.transports.Console({
    format: consoleFormat,
    level: 'debug'
  }));
  
  serviceLogger.add(new winston.transports.Console({
    format: consoleFormat,
    level: 'info'
  }));
}

// Session ID management
let currentSessionId = null;

function setSessionId(id) {
  currentSessionId = id;
}

// Export logger with convenience methods
module.exports = {
  business: businessLogger,
  technical: technicalLogger,
  service: serviceLogger,
  
  // Session management
  setSessionId,
  currentSessionId: () => currentSessionId,
  
  // Convenience methods for backward compatibility
  info: (message, meta) => businessLogger.info(message, meta),
  error: (message, meta) => technicalLogger.error(message, meta),
  warn: (message, meta) => technicalLogger.warn(message, meta),
  debug: (message, meta) => technicalLogger.debug(message, meta)
};