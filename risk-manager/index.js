require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const logger = require('./logger');
const { initDatabase, initNATS, getDatabase, getNATS, closeDatabase, closeNATS } = require('./config/connections');
const PositionTracker = require('./models/PositionTracker');
const RiskChecker = require('./models/RiskChecker');

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Global instances
let riskChecker = null;
let positionTracker = null;
let riskConfig = null;

/**
 * Load risk configuration
 */
function loadConfig() {
  try {
    const configPath = process.env.RISK_CONFIG_PATH || './config/risk-limits.json';
    const fullPath = path.join(__dirname, configPath);

    logger.info('Loading risk configuration', { path: fullPath });

    const configData = fs.readFileSync(fullPath, 'utf8');
    riskConfig = JSON.parse(configData);

    logger.info('Risk configuration loaded', {
      maxDailyLoss: riskConfig.lossLimits.maxDailyLoss,
      maxDrawdown: riskConfig.lossLimits.maxDrawdown,
      maxTradesPerDay: riskConfig.frequencyLimits.maxTradesPerDay
    });

    return riskConfig;
  } catch (error) {
    logger.error('Failed to load risk configuration', { error: error.message });
    throw error;
  }
}

/**
 * Initialize risk manager components
 */
async function initialize() {
  logger.info('🛡️  Starting Risk Manager...');

  try {
    // 1. Load configuration
    const config = loadConfig();

    // 2. Connect to database
    const db = await initDatabase();

    // 3. Initialize position tracker
    positionTracker = new PositionTracker(db);
    await positionTracker.initialize();

    // 4. Initialize risk checker
    riskChecker = new RiskChecker(config, positionTracker, db);
    await riskChecker.initialize();

    // 5. Connect to NATS
    const nc = await initNATS();

    // 6. Subscribe to strategy signals
    logger.info('Subscribing to strategy.signals.*');
    const signalSub = nc.subscribe('strategy.signals.*');

    (async () => {
      for await (const msg of signalSub) {
        try {
          const signal = JSON.parse(msg.data.toString());
          await handleSignal(signal, nc);
        } catch (error) {
          logger.error('Error processing signal', {
            error: error.message,
            data: msg.data.toString()
          });
        }
      }
    })();

    // 7. Subscribe to execution fills
    logger.info('Subscribing to execution.fills.*');
    const fillSub = nc.subscribe('execution.fills.>');

    (async () => {
      for await (const msg of fillSub) {
        try {
          const fill = JSON.parse(msg.data.toString());
          await handleFill(fill);
        } catch (error) {
          logger.error('Error processing fill', {
            error: error.message,
            data: msg.data.toString()
          });
        }
      }
    })();

    // 8. Periodic tasks
    setInterval(async () => {
      try {
        await riskChecker.saveDailyStats();
      } catch (error) {
        logger.error('Failed to save daily stats', { error: error.message });
      }
    }, 60000); // Save every minute

    // Publish ready event
    nc.publish('risk.manager.ready', JSON.stringify({
      timestamp: new Date().toISOString(),
      mode: riskChecker.mode
    }));

    logger.info('✅ Risk Manager ready', {
      mode: riskChecker.mode,
      positions: positionTracker.getAllPositions().length
    });

  } catch (error) {
    logger.error('Failed to initialize Risk Manager', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

/**
 * Handle incoming strategy signal
 */
async function handleSignal(signal, natsConnection) {
  const startTime = Date.now();

  logger.info('Received signal', {
    strategy_id: signal.strategy_id,
    symbol: signal.symbol,
    action: signal.action,
    quantity: signal.quantity
  });

  try {
    // Run risk checks
    const decision = await riskChecker.checkSignal(signal);

    // Log to database
    await logRiskEvent(signal, decision);

    if (decision.approved) {
      // Publish to approved channel
      natsConnection.publish(
        `risk.approved.${signal.strategy_id}`,
        JSON.stringify(signal)
      );

      logger.info('✅ Signal APPROVED', {
        strategy_id: signal.strategy_id,
        symbol: signal.symbol,
        mode: decision.mode,
        processingTime: decision.processingTime
      });
    } else {
      // Publish to rejected channel
      natsConnection.publish(
        `risk.rejected.${signal.strategy_id}`,
        JSON.stringify({
          ...signal,
          rejectionReason: decision.rejectionReason,
          rejectedAt: new Date().toISOString(),
          mode: decision.mode
        })
      );

      logger.warn('❌ Signal REJECTED', {
        strategy_id: signal.strategy_id,
        symbol: signal.symbol,
        reason: decision.rejectionReason,
        mode: decision.mode,
        processingTime: decision.processingTime
      });
    }

    // Publish decision stats
    natsConnection.publish('risk.stats', JSON.stringify({
      timestamp: new Date().toISOString(),
      dailyStats: riskChecker.dailyStats,
      mode: riskChecker.mode,
      portfolioValue: decision.portfolioValue
    }));

  } catch (error) {
    logger.error('Error handling signal', {
      error: error.message,
      stack: error.stack,
      signal
    });
  }
}

/**
 * Handle execution fill
 */
async function handleFill(fill) {
  logger.info('Received fill', {
    symbol: fill.symbol,
    action: fill.action,
    quantity: fill.quantity,
    price: fill.price
  });

  try {
    // Update risk checker with fill
    riskChecker.updateFromFill(fill);

    logger.debug('Risk state updated from fill', {
      realizedPnL: riskChecker.dailyStats.realizedPnL,
      currentEquity: riskChecker.dailyStats.currentEquity,
      mode: riskChecker.mode
    });
  } catch (error) {
    logger.error('Error handling fill', {
      error: error.message,
      fill
    });
  }
}

/**
 * Log risk event to database
 */
async function logRiskEvent(signal, decision) {
  try {
    const db = getDatabase();

    await db.query(`
      INSERT INTO risk_events (
        timestamp, strategy_id, signal, decision, rejection_reason,
        risk_scores, position_before, portfolio_state, mode, processing_time_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      new Date(),
      signal.strategy_id,
      JSON.stringify(signal),
      decision.approved ? 'approved' : 'rejected',
      decision.rejectionReason,
      JSON.stringify(decision.riskScores),
      JSON.stringify(positionTracker.getAllPositions()),
      JSON.stringify({
        portfolioValue: decision.portfolioValue,
        dailyStats: riskChecker.dailyStats
      }),
      decision.mode,
      decision.processingTime
    ]);

  } catch (error) {
    logger.error('Failed to log risk event', { error: error.message });
  }
}

// ============================================================================
// REST API Endpoints
// ============================================================================

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'risk-manager',
    mode: riskChecker ? riskChecker.mode : 'initializing',
    uptime: process.uptime()
  });
});

/**
 * Get current risk status
 */
app.get('/api/risk/status', (req, res) => {
  try {
    const status = riskChecker.getStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get current risk limits
 */
app.get('/api/risk/limits', (req, res) => {
  res.json({
    success: true,
    limits: riskConfig
  });
});

/**
 * Update risk limits (requires restart to take effect)
 */
app.post('/api/risk/limits', (req, res) => {
  try {
    // TODO: Add authentication
    const newLimits = req.body;

    // Validate limits
    if (!newLimits.positionLimits || !newLimits.portfolioLimits) {
      return res.status(400).json({
        success: false,
        error: 'Invalid limits format'
      });
    }

    // Save to file
    const configPath = process.env.RISK_CONFIG_PATH || './config/risk-limits.json';
    const fullPath = path.join(__dirname, configPath);

    fs.writeFileSync(fullPath, JSON.stringify(newLimits, null, 2));

    logger.info('Risk limits updated', { newLimits });

    res.json({
      success: true,
      message: 'Limits updated. Restart service for changes to take effect.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get recent risk events
 */
app.get('/api/risk/events', async (req, res) => {
  try {
    const { limit = 50, decision = null } = req.query;
    const db = getDatabase();

    let query = `
      SELECT *
      FROM risk_events
      ${decision ? 'WHERE decision = $1' : ''}
      ORDER BY timestamp DESC
      LIMIT $${decision ? 2 : 1}
    `;

    const params = decision ? [decision, limit] : [limit];
    const result = await db.query(query, params);

    res.json({
      success: true,
      events: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get recent rejections
 */
app.get('/api/risk/rejections', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const db = getDatabase();

    const result = await db.query(`
      SELECT timestamp, strategy_id, signal, rejection_reason, mode
      FROM risk_events
      WHERE decision = 'rejected'
      ORDER BY timestamp DESC
      LIMIT $1
    `, [limit]);

    res.json({
      success: true,
      rejections: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Reset daily statistics (admin only)
 */
app.post('/api/risk/reset-daily', async (req, res) => {
  try {
    // TODO: Add authentication

    logger.warn('Daily statistics reset requested');

    // Reset in-memory stats
    riskChecker.dailyStats = {
      date: new Date().toISOString().split('T')[0],
      totalTrades: 0,
      approvedTrades: 0,
      rejectedTrades: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      consecutiveLosses: 0,
      consecutiveWins: 0,
      peakEquity: riskConfig.capital.initialCapital,
      currentEquity: riskConfig.capital.currentEquity
    };

    // Reset trade history
    riskChecker.tradeHistory = {
      lastTradeTime: null,
      symbolCounts: new Map(),
      recentTimestamps: []
    };

    // Re-evaluate mode
    riskChecker.updateMode();

    logger.info('Daily statistics reset', { newMode: riskChecker.mode });

    res.json({
      success: true,
      message: 'Daily statistics reset',
      mode: riskChecker.mode
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Manual mode override (emergency use only)
 */
app.post('/api/risk/override-mode', (req, res) => {
  try {
    // TODO: Add strong authentication
    const { mode, reason } = req.body;

    if (!['NORMAL', 'DEFENSIVE', 'LOCKDOWN'].includes(mode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mode. Must be NORMAL, DEFENSIVE, or LOCKDOWN'
      });
    }

    logger.warn('Manual mode override', { from: riskChecker.mode, to: mode, reason });

    riskChecker.setMode(mode);

    res.json({
      success: true,
      message: `Mode manually set to ${mode}`,
      mode: mode
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown() {
  logger.info('Shutting down Risk Manager...');

  try {
    // Save final daily stats
    if (riskChecker) {
      await riskChecker.saveDailyStats();
    }

    // Close connections
    await closeNATS();
    await closeDatabase();

    logger.info('Risk Manager shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ============================================================================
// Start Server
// ============================================================================

const PORT = process.env.PORT || 8086;

app.listen(PORT, () => {
  logger.info(`Risk Manager HTTP server listening on port ${PORT}`);
});

// Initialize
initialize().catch(error => {
  logger.error('Fatal initialization error', { error: error.message, stack: error.stack });
  process.exit(1);
});
