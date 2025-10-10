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
    await subscribeToStrategySignals(nc);
    await subscribeToRiskApproved(nc);
    await subscribeToRiskRejected(nc);

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

          // Emit to activity feed
          io.emit('activity:fill', {
            type: 'fill',
            timestamp: new Date().toISOString(),
            symbol: fill.symbol,
            action: fill.action,
            quantity: fill.quantity,
            price: fill.price,
            portfolioValue: result.portfolioValue,
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

            // Emit to activity feed
            io.emit('activity:price', {
              type: 'price',
              timestamp: new Date().toISOString(),
              symbol: data.symbol,
              price: data.price
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
 * Subscribe to strategy signals
 * Subject: strategy.signals.>
 */
async function subscribeToStrategySignals(nc) {
  const sub = nc.subscribe('strategy.signals.>');

  logger.info('📡 Subscribed to strategy.signals.>');

  (async () => {
    for await (const msg of sub) {
      try {
        const signal = JSON.parse(msg.data);

        // Emit to activity feed
        if (io) {
          io.emit('activity:signal', {
            type: 'signal',
            timestamp: new Date().toISOString(),
            strategyId: signal.strategy_id,
            symbol: signal.symbol,
            action: signal.action,
            quantity: signal.quantity,
            price: signal.price
          });
        }

        logger.debug(`Strategy signal: ${signal.action} ${signal.quantity} ${signal.symbol} @ ${signal.price}`);
      } catch (error) {
        logger.error(`Error processing strategy signal: ${error.message}`);
      }
    }
  })();
}

/**
 * Subscribe to risk approved signals
 * Subject: risk.approved.>
 */
async function subscribeToRiskApproved(nc) {
  const sub = nc.subscribe('risk.approved.>');

  logger.info('📡 Subscribed to risk.approved.>');

  (async () => {
    for await (const msg of sub) {
      try {
        const signal = JSON.parse(msg.data);

        // Emit to activity feed
        if (io) {
          io.emit('activity:risk-approved', {
            type: 'risk-approved',
            timestamp: new Date().toISOString(),
            strategyId: signal.strategy_id,
            symbol: signal.symbol,
            action: signal.action,
            quantity: signal.quantity
          });
        }

        logger.debug(`Risk approved: ${signal.action} ${signal.quantity} ${signal.symbol}`);
      } catch (error) {
        logger.error(`Error processing risk approved: ${error.message}`);
      }
    }
  })();
}

/**
 * Subscribe to risk rejected signals
 * Subject: risk.rejected.>
 */
async function subscribeToRiskRejected(nc) {
  const sub = nc.subscribe('risk.rejected.>');

  logger.info('📡 Subscribed to risk.rejected.>');

  (async () => {
    for await (const msg of sub) {
      try {
        const data = JSON.parse(msg.data);

        // Emit to activity feed
        if (io) {
          io.emit('activity:risk-rejected', {
            type: 'risk-rejected',
            timestamp: new Date().toISOString(),
            strategyId: data.strategy_id,
            symbol: data.symbol,
            action: data.action,
            quantity: data.quantity,
            reason: data.rejectionReason
          });
        }

        logger.debug(`Risk rejected: ${data.action} ${data.quantity} ${data.symbol} - ${data.rejectionReason}`);
      } catch (error) {
        logger.error(`Error processing risk rejected: ${error.message}`);
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

  // Shutdown endpoint (for service dashboard control)
  app.post('/api/shutdown', (req, res) => {
    logger.info('Shutdown requested via API');

    res.json({
      success: true,
      message: 'Portfolio Manager shutting down...'
    });

    // Give response time to send, then shutdown
    setTimeout(() => {
      shutdown();
    }, 100);
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
