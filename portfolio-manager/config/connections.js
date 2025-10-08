/**
 * Database and NATS connection management
 */

const { Pool } = require('pg');
const { connect } = require('nats');
const logger = require('../utils/logger');

let dbPool;
let natsConnection;

/**
 * Initialize PostgreSQL connection pool
 */
async function initDatabase() {
  if (dbPool) {
    logger.warn('Database already initialized');
    return dbPool;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not set in environment');
  }

  dbPool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Test connection
  try {
    const client = await dbPool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    logger.info('✅ Connected to TimescaleDB');
    logger.debug(`Database time: ${result.rows[0].now}`);
    return dbPool;
  } catch (error) {
    logger.error(`❌ Failed to connect to database: ${error.message}`);
    throw error;
  }
}

/**
 * Initialize NATS connection
 */
async function initNATS() {
  if (natsConnection) {
    logger.warn('NATS already initialized');
    return natsConnection;
  }

  const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';

  const natsConfig = {
    servers: natsUrl,
    name: 'portfolio-manager',
    reconnect: true,
    maxReconnectAttempts: -1,  // Infinite reconnection
    reconnectTimeWait: 2000,
    reconnectJitter: 100,
    waitOnFirstConnect: true
  };

  try {
    natsConnection = await connect(natsConfig);
    logger.info('✅ Connected to NATS');

    // Handle connection status events
    (async () => {
      for await (const status of natsConnection.status()) {
        switch (status.type) {
          case 'disconnect':
            logger.warn('⚠️  NATS disconnected');
            break;
          case 'reconnect':
            logger.info('🔄 NATS reconnected');
            break;
          case 'update':
            logger.debug(`NATS update: ${status.data}`);
            break;
          case 'error':
            logger.error(`NATS error: ${status.data}`);
            break;
        }
      }
    })();

    return natsConnection;
  } catch (error) {
    logger.error(`❌ Failed to connect to NATS: ${error.message}`);
    throw error;
  }
}

/**
 * Close database connection
 */
async function closeDatabase() {
  if (dbPool) {
    await dbPool.end();
    dbPool = null;
    logger.info('Database connection closed');
  }
}

/**
 * Close NATS connection
 */
async function closeNATS() {
  if (natsConnection) {
    await natsConnection.close();
    natsConnection = null;
    logger.info('NATS connection closed');
  }
}

/**
 * Get database pool
 */
function getDatabase() {
  if (!dbPool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbPool;
}

/**
 * Get NATS connection
 */
function getNATS() {
  if (!natsConnection) {
    throw new Error('NATS not initialized. Call initNATS() first.');
  }
  return natsConnection;
}

module.exports = {
  initDatabase,
  initNATS,
  closeDatabase,
  closeNATS,
  getDatabase,
  getNATS
};
