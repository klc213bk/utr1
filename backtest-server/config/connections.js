const { Pool } = require('pg');
const { connect } = require('nats');

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
  name: 'backtest-server',
  reconnect: true,
  maxReconnectAttempts: -1,  // Infinite reconnection attempts
  reconnectTimeWait: 2000,    // 2 seconds between attempts
  reconnectJitter: 100,       // Add jitter to prevent thundering herd
  waitOnFirstConnect: true    // Wait for initial connection before returning
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
    console.log('✅ Connected to TimescaleDB:', result.rows[0].now);
    
    // Check SPY data availability
    const checkTable = await pgPool.query(`
      SELECT COUNT(*) as count,
             MIN(time) as earliest,
             MAX(time) as latest
      FROM spy_bars_1min
    `);
    
    console.log('📊 SPY bars data:', {
      totalBars: parseInt(checkTable.rows[0].count),
      earliest: checkTable.rows[0].earliest,
      latest: checkTable.rows[0].latest
    });
    
    return pgPool;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
}

// Initialize NATS
async function initNATS() {
  try {
    natsConnection = await connect(natsConfig);
    console.log('✅ Connected to NATS');

    // Handle NATS lifecycle events
    (async () => {
      for await (const status of natsConnection.status()) {
        switch (status.type) {
          case 'disconnect':
            console.warn('⚠️ NATS disconnected');
            break;
          case 'reconnect':
            console.log('🔄 NATS reconnected');
            break;
          case 'reconnecting':
            console.log(`🔄 NATS reconnecting (attempt ${status.data})...`);
            break;
          case 'error':
            console.error('❌ NATS error:', status.data);
            break;
        }
      }
    })();

    // Handle graceful shutdown
    natsConnection.closed().then((err) => {
      if (err) {
        console.error('NATS connection closed with error:', err.message);
      } else {
        console.log('NATS connection closed gracefully');
      }
    });

    return natsConnection;
  } catch (error) {
    console.error('❌ NATS connection failed:', error.message);
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
    console.log('Database connection closed');
  }
}

async function closeNATS() {
  if (natsConnection) {
    await natsConnection.drain();
    await natsConnection.close();
    console.log('NATS connection closed');
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