/**
 * Portfolio Manager Service
 *
 * Tracks portfolio state across all trading modes (backtest, paper, live)
 * - Subscribes to execution fills
 * - Subscribes to market data for unrealized P&L
 * - Provides REST API for portfolio queries
 * - Emits real-time updates via WebSocket
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { initDatabase, initNATS, closeDatabase, closeNATS, getDatabase, getNATS } = require('./config/connections');
const PortfolioManager = require('./models/PortfolioManager');
const { router: apiRouter, setPortfolioManager } = require('./routes/api');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 8088;
const INITIAL_CAPITAL = parseFloat(process.env.INITIAL_CAPITAL) || 100000;

let portfolioManager;
let io;

/**
 * Initialize the service
 */
async function init() {
  try {
    logger.info('🚀 Starting Portfolio Manager...');

    // Initialize connections
    const db = await initDatabase();
    const nc = await initNATS();

    // Create portfolio manager
    portfolioManager = new PortfolioManager(db, INITIAL_CAPITAL);
    setPortfolioManager(portfolioManager);

    // Start periodic snapshots (every 1 minute)
    portfolioManager.startSnapshotTimer(60000);

    // Subscribe to NATS subjects
    await subscribeToFills(nc);
    await subscribeToMarketData(nc);

    logger.info('✅ Portfolio Manager ready');

    return { db, nc };
  } catch (error) {
    logger.error(`❌ Initialization failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Subscribe to execution fills
 * Subject: execution.fills.>
 */
async function subscribeToFills(nc) {
  const sub = nc.subscribe('execution.fills.>');

  logger.info('📡 Subscribed to execution.fills.>');

  (async () => {
    for await (const msg of sub) {
      try {
        const fill = JSON.parse(msg.data);
        logger.info(`📥 Fill received: ${fill.action} ${fill.quantity} ${fill.symbol} @ ${fill.price}`);

        // Process fill
        const result = await portfolioManager.processFill(fill);

        // Emit update via WebSocket
        if (io) {
          io.emit('portfolio:update', {
            sessionId: result.sessionId,
            type: 'fill',
            fill,
            portfolioValue: result.portfolioValue,
            cash: result.cashAfter,
            realizedPnL: result.realizedPnL
          });
        }

        logger.debug(`Portfolio updated: cash=${result.cashAfter.toFixed(2)}, value=${result.portfolioValue.toFixed(2)}`);
      } catch (error) {
        logger.error(`Error processing fill: ${error.message}`);
      }
    }
  })();
}

/**
 * Subscribe to market data updates
 * Subject: market.prices.<symbol>
 */
async function subscribeToMarketData(nc) {
  const sub = nc.subscribe('market.prices.>');

  logger.info('📡 Subscribed to market.prices.>');

  (async () => {
    for await (const msg of sub) {
      try {
        const data = JSON.parse(msg.data);
        // data = { symbol, price, timestamp }

        // Update all active sessions with new price
        const states = portfolioManager.getAllStates();
        for (const state of states) {
          portfolioManager.updateMarketPrices(state.sessionId, {
            [data.symbol]: data.price
          });

          // Emit unrealized P&L update
          if (io) {
            const updatedState = portfolioManager.getState(state.sessionId);
            io.emit('portfolio:price-update', {
              sessionId: state.sessionId,
              symbol: data.symbol,
              price: data.price,
              unrealizedPnL: updatedState.unrealizedPnL
            });
          }
        }
      } catch (error) {
        logger.error(`Error processing market data: ${error.message}`);
      }
    }
  })();
}

/**
 * Create Express app
 */
function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/health', (req, res) => {
    const activeSessions = portfolioManager.getAllStates().length;
    res.json({
      status: 'healthy',
      service: 'portfolio-manager',
      uptime: process.uptime(),
      activeSessions,
      timestamp: new Date().toISOString()
    });
  });

  // API routes
  app.use('/api/portfolio', apiRouter);

  return app;
}

/**
 * Main
 */
async function main() {
  // Initialize service
  await init();

  // Create Express app
  const app = createApp();
  const server = http.createServer(app);

  // Setup Socket.IO for real-time updates
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    logger.info(`WebSocket client connected: ${socket.id}`);

    // Send current states to new client
    const states = portfolioManager.getAllStates();
    socket.emit('portfolio:initial-state', states);

    socket.on('disconnect', () => {
      logger.info(`WebSocket client disconnected: ${socket.id}`);
    });
  });

  // Start HTTP server
  server.listen(PORT, () => {
    logger.info(`Portfolio Manager HTTP server listening on port ${PORT}`);
    logger.info(`WebSocket server ready for real-time updates`);
  });

  // Graceful shutdown
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Shutdown gracefully
 */
async function shutdown() {
  logger.info('\n🛑 Shutting down gracefully...');

  try {
    // Save all portfolio states
    if (portfolioManager) {
      await portfolioManager.shutdown();
    }

    // Close connections
    await closeNATS();
    await closeDatabase();

    logger.info('✅ Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error(`Error during shutdown: ${error.message}`);
    process.exit(1);
  }
}

// Start the service
main().catch((error) => {
  logger.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
