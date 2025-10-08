/**
 * Portfolio Manager REST API Routes
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// Will be injected by main app
let portfolioManager;

function setPortfolioManager(pm) {
  portfolioManager = pm;
}

/**
 * GET /api/portfolio/state/:sessionId
 * Get current portfolio state for a session
 */
router.get('/state/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const state = portfolioManager.getState(sessionId);

    if (!state) {
      return res.status(404).json({
        error: 'Session not found',
        sessionId
      });
    }

    res.json(state);
  } catch (error) {
    logger.error(`Error getting state: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/portfolio/state
 * Get state for all active sessions
 */
router.get('/state', (req, res) => {
  try {
    const states = portfolioManager.getAllStates();
    res.json({
      sessions: states.length,
      states
    });
  } catch (error) {
    logger.error(`Error getting all states: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/portfolio/position/:sessionId/:symbol
 * Get position for a specific symbol in a session
 */
router.get('/position/:sessionId/:symbol', (req, res) => {
  try {
    const { sessionId, symbol } = req.params;
    const position = portfolioManager.getPosition(sessionId, symbol);

    if (!position) {
      return res.status(404).json({
        error: 'Position not found',
        sessionId,
        symbol
      });
    }

    res.json(position);
  } catch (error) {
    logger.error(`Error getting position: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/portfolio/buying-power/:sessionId
 * Get available buying power for a session
 */
router.get('/buying-power/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const buyingPower = portfolioManager.getBuyingPower(sessionId);

    if (buyingPower === null) {
      return res.status(404).json({
        error: 'Session not found',
        sessionId
      });
    }

    res.json({
      sessionId,
      buyingPower,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting buying power: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/portfolio/session/create
 * Create a new portfolio session
 */
router.post('/session/create', async (req, res) => {
  try {
    const { sessionId, initialCapital, mode } = req.body;

    if (!sessionId || !initialCapital) {
      return res.status(400).json({
        error: 'Missing required fields: sessionId, initialCapital'
      });
    }

    await portfolioManager.createSession(sessionId, initialCapital, mode);

    res.json({
      success: true,
      sessionId,
      initialCapital,
      mode: mode || 'active'
    });
  } catch (error) {
    logger.error(`Error creating session: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/portfolio/session/close/:sessionId
 * Close a portfolio session
 */
router.post('/session/close/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    await portfolioManager.closeSession(sessionId);

    res.json({
      success: true,
      sessionId,
      message: 'Session closed'
    });
  } catch (error) {
    logger.error(`Error closing session: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/portfolio/transactions/:sessionId
 * Get transaction history for a session
 */
router.get('/transactions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const transactions = await portfolioManager.getTransactions(sessionId, limit, offset);

    res.json({
      sessionId,
      count: transactions.length,
      transactions
    });
  } catch (error) {
    logger.error(`Error getting transactions: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/portfolio/snapshots/:sessionId
 * Get portfolio snapshots (time-series data)
 */
router.get('/snapshots/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const startTime = req.query.start ? new Date(req.query.start) : null;
    const endTime = req.query.end ? new Date(req.query.end) : null;

    const snapshots = await portfolioManager.getSnapshots(sessionId, { limit, startTime, endTime });

    res.json({
      sessionId,
      count: snapshots.length,
      snapshots
    });
  } catch (error) {
    logger.error(`Error getting snapshots: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/portfolio/performance/:sessionId
 * Get performance metrics for a session
 */
router.get('/performance/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const performance = await portfolioManager.getPerformanceMetrics(sessionId);

    res.json({
      sessionId,
      performance
    });
  } catch (error) {
    logger.error(`Error getting performance: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/portfolio/reset/:sessionId
 * Reset a session to initial state
 */
router.post('/reset/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    await portfolioManager.resetSession(sessionId);

    res.json({
      success: true,
      sessionId,
      message: 'Session reset to initial state'
    });
  } catch (error) {
    logger.error(`Error resetting session: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

module.exports = {
  router,
  setPortfolioManager
};
