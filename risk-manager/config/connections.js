const { Pool } = require('pg');
const { connect } = require('nats');
const logger = require('../logger');

// Database configuration
const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/stocks',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

// NATS configuration
const natsConfig = {
  servers: process.env.NATS_URL || 'nats://localhost:4222',
  name: 'risk-manager',
  reconnect: true,
  maxReconnectAttempts: -1,  // Infinite reconnection
  reconnectTimeWait: 2000,
  reconnectJitter: 100,
  waitOnFirstConnect: true
};

// Connection instances
let pgPool = null;
let natsConnection = null;

// Initialize database
async function initDatabase() {
  try {
    pgPool = new Pool(dbConfig);

    // Test connection
    const result = await pgPool.query('SELECT NOW()');
    logger.info('Connected to TimescaleDB', { time: result.rows[0].now });

    return pgPool;
  } catch (error) {
    logger.error('Database connection failed', { error: error.message });
    throw error;
  }
}

// Initialize NATS
async function initNATS() {
  try {
    natsConnection = await connect(natsConfig);
    logger.info('Connected to NATS');

    // Handle NATS lifecycle events
    (async () => {
      for await (const status of natsConnection.status()) {
        switch (status.type) {
          case 'disconnect':
            logger.warn('NATS disconnected');
            break;
          case 'reconnect':
            logger.info('NATS reconnected');
            break;
          case 'reconnecting':
            logger.info('NATS reconnecting', { attempt: status.data });
            break;
          case 'error':
            logger.error('NATS error', { error: status.data });
            break;
        }
      }
    })();

    // Handle graceful shutdown
    natsConnection.closed().then((err) => {
      if (err) {
        logger.error('NATS connection closed with error', { error: err.message });
      } else {
        logger.info('NATS connection closed gracefully');
      }
    });

    return natsConnection;
  } catch (error) {
    logger.error('NATS connection failed', { error: error.message });
    throw error;
  }
}

// Get connections
function getDatabase() {
  if (!pgPool) {
    throw new Error('Database not initialized');
  }
  return pgPool;
}

function getNATS() {
  if (!natsConnection) {
    throw new Error('NATS not initialized');
  }
  return natsConnection;
}

// Close connections
async function closeDatabase() {
  if (pgPool) {
    await pgPool.end();
    logger.info('Database connection closed');
  }
}

async function closeNATS() {
  if (natsConnection) {
    await natsConnection.drain();
    await natsConnection.close();
    logger.info('NATS connection closed');
  }
}

module.exports = {
  initDatabase,
  initNATS,
  getDatabase,
  getNATS,
  closeDatabase,
  closeNATS
};
