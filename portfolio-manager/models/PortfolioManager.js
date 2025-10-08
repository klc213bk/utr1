/**
 * Portfolio Manager
 *
 * Manages multiple portfolio sessions (backtest, paper, live)
 * Handles NATS subscriptions for fills and market data
 */

const PortfolioState = require('./PortfolioState');
const logger = require('../utils/logger');

class PortfolioManager {
  constructor(db, initialCapital) {
    this.db = db;
    this.initialCapital = initialCapital;
    this.sessions = new Map(); // sessionId -> PortfolioState
    this.snapshotInterval = null;
  }

  /**
   * Create a new portfolio session
   */
  async createSession(sessionId, initialCapital = null, mode = 'active') {
    if (this.sessions.has(sessionId)) {
      logger.warn(`Session ${sessionId} already exists`);
      return this.sessions.get(sessionId);
    }

    const capital = initialCapital || this.initialCapital;
    const portfolio = new PortfolioState(sessionId, capital, this.db);

    // Try to restore from database
    await portfolio.restoreFromDatabase();

    this.sessions.set(sessionId, portfolio);
    logger.info(`✅ Created portfolio session: ${sessionId} with $${capital.toLocaleString()}`);

    return portfolio;
  }

  /**
   * Close a portfolio session
   */
  async closeSession(sessionId) {
    const portfolio = this.sessions.get(sessionId);
    if (!portfolio) {
      logger.warn(`Session ${sessionId} not found`);
      return;
    }

    // Save final state
    await portfolio.persistState();
    await portfolio.saveSnapshot();

    // Update session status in trading_sessions table
    await this.db.query(`
      UPDATE trading_sessions SET status = 'completed', completed_at = NOW()
      WHERE session_id = $1
    `, [sessionId]);

    this.sessions.delete(sessionId);
    logger.info(`Session closed: ${sessionId}`);
  }

  /**
   * Process a fill from execution
   */
  async processFill(fill) {
    const { backtestId, strategyId, symbol, action, quantity, price, commission, fillId } = fill;

    // Determine session ID (backtest_id or 'paper' or 'live')
    let sessionId = backtestId || 'paper'; // Default to paper if no backtest_id

    // Get or create session
    let portfolio = this.sessions.get(sessionId);
    if (!portfolio) {
      portfolio = await this.createSession(sessionId);
    }

    // Process the fill
    const result = await portfolio.processFill(fill);

    // Persist state
    await portfolio.persistState();

    logger.info(`Fill processed for ${sessionId}: ${action} ${quantity} ${symbol} @ ${price}`);

    return {
      sessionId,
      ...result
    };
  }

  /**
   * Update market prices for unrealized P&L
   */
  updateMarketPrices(sessionId, prices) {
    const portfolio = this.sessions.get(sessionId);
    if (!portfolio) {
      logger.warn(`Session ${sessionId} not found for price update`);
      return;
    }

    portfolio.updateMarketPrices(prices);
  }

  /**
   * Get current state for a session
   */
  getState(sessionId) {
    const portfolio = this.sessions.get(sessionId);
    if (!portfolio) return null;
    return portfolio.getState();
  }

  /**
   * Get states for all active sessions
   */
  getAllStates() {
    const states = [];
    for (const [sessionId, portfolio] of this.sessions.entries()) {
      states.push(portfolio.getState());
    }
    return states;
  }

  /**
   * Get position for a symbol in a session
   */
  getPosition(sessionId, symbol) {
    const portfolio = this.sessions.get(sessionId);
    if (!portfolio) return null;
    return portfolio.getPosition(symbol);
  }

  /**
   * Get buying power for a session
   */
  getBuyingPower(sessionId) {
    const portfolio = this.sessions.get(sessionId);
    if (!portfolio) return null;
    return portfolio.getBuyingPower();
  }

  /**
   * Get transaction history from database
   */
  async getTransactions(sessionId, limit = 50, offset = 0) {
    try {
      const result = await this.db.query(`
        SELECT * FROM transactions
        WHERE session_id = $1
        ORDER BY timestamp DESC
        LIMIT $2 OFFSET $3
      `, [sessionId, limit, offset]);

      return result.rows.map(row => ({
        id: row.id,
        timestamp: row.timestamp,
        transactionType: row.transaction_type,
        symbol: row.symbol,
        action: row.action,
        quantity: row.quantity,
        price: row.price ? parseFloat(row.price) : null,
        amount: parseFloat(row.amount),
        commission: parseFloat(row.commission),
        realizedPnL: row.realized_pnl ? parseFloat(row.realized_pnl) : null,
        cashAfter: parseFloat(row.cash_after),
        portfolioValueAfter: parseFloat(row.portfolio_value_after),
        notes: row.notes
      }));
    } catch (error) {
      logger.error(`Error getting transactions: ${error.message}`);
      return [];
    }
  }

  /**
   * Get portfolio snapshots from database
   */
  async getSnapshots(sessionId, options = {}) {
    const { limit = 100, startTime, endTime } = options;

    try {
      let query = `
        SELECT * FROM portfolio_snapshots
        WHERE session_id = $1
      `;
      const params = [sessionId];

      if (startTime) {
        params.push(startTime);
        query += ` AND timestamp >= $${params.length}`;
      }

      if (endTime) {
        params.push(endTime);
        query += ` AND timestamp <= $${params.length}`;
      }

      query += ` ORDER BY timestamp DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await this.db.query(query, params);

      return result.rows.map(row => ({
        timestamp: row.timestamp,
        cash: parseFloat(row.cash_balance),
        portfolioValue: parseFloat(row.portfolio_value),
        realizedPnL: parseFloat(row.realized_pnl),
        unrealizedPnL: parseFloat(row.unrealized_pnl),
        totalPnL: parseFloat(row.total_pnl),
        buyingPower: parseFloat(row.buying_power),
        exposure: parseFloat(row.exposure),
        drawdown: parseFloat(row.drawdown),
        peakValue: parseFloat(row.peak_value),
        numPositions: row.num_positions,
        positions: row.positions
      }));
    } catch (error) {
      logger.error(`Error getting snapshots: ${error.message}`);
      return [];
    }
  }

  /**
   * Get performance metrics for a session
   */
  async getPerformanceMetrics(sessionId) {
    try {
      // Get current state
      const currentState = this.getState(sessionId);
      if (!currentState) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Get all snapshots for this session
      const snapshots = await this.getSnapshots(sessionId, { limit: 10000 });

      if (snapshots.length === 0) {
        return {
          totalReturn: 0,
          totalReturnPct: 0,
          sharpeRatio: 0,
          maxDrawdown: 0,
          winRate: 0,
          profitFactor: 0
        };
      }

      // Calculate metrics
      const returns = [];
      for (let i = 1; i < snapshots.length; i++) {
        const prevValue = snapshots[i].portfolioValue;
        const currValue = snapshots[i - 1].portfolioValue;
        const returnPct = (currValue - prevValue) / prevValue;
        returns.push(returnPct);
      }

      // Total return
      const initialValue = snapshots[snapshots.length - 1].portfolioValue;
      const finalValue = currentState.portfolioValue;
      const totalReturn = finalValue - initialValue;
      const totalReturnPct = (totalReturn / initialValue) * 100;

      // Sharpe ratio (assuming daily returns)
      const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
      const stdDev = Math.sqrt(variance);
      const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

      // Max drawdown
      const maxDrawdown = Math.max(...snapshots.map(s => s.drawdown));

      // Win rate and profit factor (from transactions)
      const transactions = await this.getTransactions(sessionId, 1000);
      const closingTrades = transactions.filter(t => t.action === 'SELL' && t.realizedPnL !== null);
      const wins = closingTrades.filter(t => t.realizedPnL > 0);
      const losses = closingTrades.filter(t => t.realizedPnL < 0);
      const winRate = closingTrades.length > 0 ? (wins.length / closingTrades.length) * 100 : 0;

      const totalWins = wins.reduce((sum, t) => sum + t.realizedPnL, 0);
      const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.realizedPnL, 0));
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

      return {
        totalReturn,
        totalReturnPct,
        sharpeRatio,
        maxDrawdown,
        winRate,
        profitFactor,
        totalTrades: closingTrades.length,
        wins: wins.length,
        losses: losses.length
      };
    } catch (error) {
      logger.error(`Error calculating performance metrics: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reset session to initial state
   */
  async resetSession(sessionId) {
    const portfolio = this.sessions.get(sessionId);
    if (!portfolio) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Archive old data (optional)
    // ...

    // Delete portfolio data (keep trading_sessions record for history)
    await this.db.query('DELETE FROM transactions WHERE session_id = $1', [sessionId]);
    await this.db.query('DELETE FROM portfolio_snapshots WHERE session_id = $1', [sessionId]);
    await this.db.query('DELETE FROM positions WHERE session_id = $1', [sessionId]);
    await this.db.query('DELETE FROM portfolio_state WHERE session_id = $1', [sessionId]);

    // Remove from memory
    this.sessions.delete(sessionId);

    // Recreate with initial capital
    await this.createSession(sessionId, portfolio.initialCapital);

    logger.info(`Session reset: ${sessionId}`);
  }

  /**
   * Start periodic snapshot saving
   */
  startSnapshotTimer(intervalMs = 60000) {
    if (this.snapshotInterval) {
      logger.warn('Snapshot timer already running');
      return;
    }

    this.snapshotInterval = setInterval(async () => {
      logger.debug('Saving portfolio snapshots...');
      for (const [sessionId, portfolio] of this.sessions.entries()) {
        try {
          await portfolio.saveSnapshot();
        } catch (error) {
          logger.error(`Failed to save snapshot for ${sessionId}: ${error.message}`);
        }
      }
    }, intervalMs);

    logger.info(`Snapshot timer started (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop periodic snapshot saving
   */
  stopSnapshotTimer() {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
      logger.info('Snapshot timer stopped');
    }
  }

  /**
   * Shutdown - save all states
   */
  async shutdown() {
    logger.info('Shutting down Portfolio Manager...');

    this.stopSnapshotTimer();

    // Save final states
    for (const [sessionId, portfolio] of this.sessions.entries()) {
      try {
        await portfolio.persistState();
        await portfolio.saveSnapshot();
      } catch (error) {
        logger.error(`Failed to save final state for ${sessionId}: ${error.message}`);
      }
    }

    logger.info('Portfolio Manager shutdown complete');
  }
}

module.exports = PortfolioManager;
