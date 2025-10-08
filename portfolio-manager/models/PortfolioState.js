/**
 * Portfolio State Model
 *
 * Tracks complete portfolio state including:
 * - Cash balance
 * - Positions (quantity, avg price, unrealized P&L)
 * - Portfolio value (cash + positions)
 * - P&L (realized + unrealized)
 * - Buying power
 * - Exposure and drawdown
 */

const logger = require('../utils/logger');

class PortfolioState {
  constructor(sessionId, initialCapital, db) {
    this.sessionId = sessionId;
    this.db = db;

    // Core state
    this.cash = initialCapital;
    this.initialCapital = initialCapital;
    this.positions = new Map(); // symbol -> {quantity, avgPrice, lastPrice, unrealizedPnL, realizedPnL}

    // Aggregated metrics
    this.totalRealizedPnL = 0;
    this.totalUnrealizedPnL = 0;
    this.totalCommissions = 0;
    this.totalTrades = 0;

    // Peak tracking for drawdown
    this.peakValue = initialCapital;

    // Last snapshot time
    this.lastSnapshotTime = Date.now();
  }

  /**
   * Process a fill (buy or sell)
   */
  async processFill(fill) {
    const { symbol, action, quantity, price, commission = 0, fillId, strategyId } = fill;

    const totalCost = quantity * price;
    const totalWithCommission = totalCost + commission;

    logger.info(`Processing fill: ${action} ${quantity} ${symbol} @ $${price}`);

    const cashBefore = this.cash;
    let realizedPnL = 0;

    if (action === 'BUY') {
      // Deduct from cash
      this.cash -= totalWithCommission;

      // Update position
      const position = this.positions.get(symbol) || {
        quantity: 0,
        avgPrice: 0,
        lastPrice: price,
        unrealizedPnL: 0,
        realizedPnL: 0
      };

      // Update average price (weighted average)
      const totalQuantity = position.quantity + quantity;
      const totalValue = (position.quantity * position.avgPrice) + totalCost;
      position.avgPrice = totalValue / totalQuantity;
      position.quantity = totalQuantity;
      position.lastPrice = price;

      this.positions.set(symbol, position);

    } else if (action === 'SELL') {
      // Add to cash
      this.cash += totalCost - commission;

      const position = this.positions.get(symbol);
      if (!position) {
        logger.error(`Attempted to sell ${symbol} without position`);
        return null;
      }

      // Calculate realized P&L
      realizedPnL = quantity * (price - position.avgPrice) - commission;

      // Update position
      position.quantity -= quantity;
      position.realizedPnL += realizedPnL;

      if (position.quantity === 0) {
        this.positions.delete(symbol);
      } else {
        this.positions.set(symbol, position);
      }

      this.totalRealizedPnL += realizedPnL;
    }

    this.totalCommissions += commission;
    this.totalTrades += 1;

    // Log transaction to database
    await this.logTransaction({
      timestamp: new Date(),
      transactionType: 'FILL',
      symbol,
      action,
      quantity,
      price,
      amount: action === 'BUY' ? -totalWithCommission : totalCost - commission,
      commission,
      realizedPnL: action === 'SELL' ? realizedPnL : null,
      cashBefore,
      cashAfter: this.cash,
      portfolioValueAfter: this.getPortfolioValue(),
      fillId,
      notes: `${action} fill from ${strategyId || 'unknown'}`
    });

    // Update peak if needed
    const currentValue = this.getPortfolioValue();
    if (currentValue > this.peakValue) {
      this.peakValue = currentValue;
    }

    logger.info(`Position updated: cash=$${this.cash.toFixed(2)}, portfolio=$${currentValue.toFixed(2)}`);

    return {
      cashAfter: this.cash,
      portfolioValue: currentValue,
      realizedPnL
    };
  }

  /**
   * Update market prices for unrealized P&L calculation
   */
  updateMarketPrices(prices) {
    // prices = { symbol: currentPrice }
    let totalUnrealized = 0;

    for (const [symbol, position] of this.positions.entries()) {
      if (prices[symbol]) {
        position.lastPrice = prices[symbol];
        position.unrealizedPnL = position.quantity * (position.lastPrice - position.avgPrice);
        totalUnrealized += position.unrealizedPnL;
      }
    }

    this.totalUnrealizedPnL = totalUnrealized;
  }

  /**
   * Get current portfolio value (cash + positions)
   */
  getPortfolioValue() {
    let positionsValue = 0;

    for (const position of this.positions.values()) {
      const lastPrice = position.lastPrice || position.avgPrice;
      positionsValue += position.quantity * lastPrice;
    }

    return this.cash + positionsValue;
  }

  /**
   * Get current drawdown from peak
   */
  getDrawdown() {
    const currentValue = this.getPortfolioValue();
    if (this.peakValue === 0) return 0;
    return (this.peakValue - currentValue) / this.peakValue;
  }

  /**
   * Get buying power (cash available for trading)
   */
  getBuyingPower() {
    // For now, buying power = available cash
    // Could add margin support later
    return this.cash;
  }

  /**
   * Get total market exposure
   */
  getExposure() {
    let exposure = 0;

    for (const position of this.positions.values()) {
      const lastPrice = position.lastPrice || position.avgPrice;
      exposure += Math.abs(position.quantity * lastPrice);
    }

    return exposure;
  }

  /**
   * Get current state summary
   */
  getState() {
    const portfolioValue = this.getPortfolioValue();
    const drawdown = this.getDrawdown();
    const exposure = this.getExposure();

    // Convert positions map to array
    const positionsArray = Array.from(this.positions.entries()).map(([symbol, pos]) => ({
      symbol,
      quantity: pos.quantity,
      avgPrice: pos.avgPrice,
      lastPrice: pos.lastPrice || pos.avgPrice,
      marketValue: pos.quantity * (pos.lastPrice || pos.avgPrice),
      unrealizedPnL: pos.unrealizedPnL || 0,
      realizedPnL: pos.realizedPnL || 0
    }));

    return {
      sessionId: this.sessionId,
      cash: this.cash,
      portfolioValue,
      buyingPower: this.getBuyingPower(),
      exposure,
      drawdown,
      peakValue: this.peakValue,
      totalPnL: this.totalRealizedPnL + this.totalUnrealizedPnL,
      realizedPnL: this.totalRealizedPnL,
      unrealizedPnL: this.totalUnrealizedPnL,
      totalCommissions: this.totalCommissions,
      totalTrades: this.totalTrades,
      numPositions: this.positions.size,
      positions: positionsArray
    };
  }

  /**
   * Get position for a specific symbol
   */
  getPosition(symbol) {
    const position = this.positions.get(symbol);
    if (!position) return null;

    return {
      symbol,
      quantity: position.quantity,
      avgPrice: position.avgPrice,
      lastPrice: position.lastPrice || position.avgPrice,
      marketValue: position.quantity * (position.lastPrice || position.avgPrice),
      unrealizedPnL: position.unrealizedPnL || 0,
      realizedPnL: position.realizedPnL || 0
    };
  }

  /**
   * Save snapshot to database
   */
  async saveSnapshot() {
    const state = this.getState();

    try {
      await this.db.query(`
        INSERT INTO portfolio_snapshots (
          session_id, cash_balance, positions, portfolio_value,
          realized_pnl, unrealized_pnl, total_pnl, buying_power,
          exposure, drawdown, peak_value, num_positions
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        this.sessionId,
        state.cash,
        JSON.stringify(state.positions),
        state.portfolioValue,
        state.realizedPnL,
        state.unrealizedPnL,
        state.totalPnL,
        state.buyingPower,
        state.exposure,
        state.drawdown,
        state.peakValue,
        state.numPositions
      ]);

      this.lastSnapshotTime = Date.now();
      logger.debug(`Snapshot saved for ${this.sessionId}`);
    } catch (error) {
      logger.error(`Failed to save snapshot: ${error.message}`);
    }
  }

  /**
   * Log transaction to database
   */
  async logTransaction(tx) {
    try {
      await this.db.query(`
        INSERT INTO transactions (
          session_id, transaction_type, symbol, action, quantity,
          price, amount, commission, realized_pnl, cash_before,
          cash_after, portfolio_value_after, fill_id, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [
        this.sessionId,
        tx.transactionType,
        tx.symbol,
        tx.action,
        tx.quantity,
        tx.price,
        tx.amount,
        tx.commission,
        tx.realizedPnL,
        tx.cashBefore,
        tx.cashAfter,
        tx.portfolioValueAfter,
        tx.fillId,
        tx.notes
      ]);
    } catch (error) {
      logger.error(`Failed to log transaction: ${error.message}`);
    }
  }

  /**
   * Restore state from database
   */
  async restoreFromDatabase() {
    try {
      // Get latest portfolio state
      const stateResult = await this.db.query(`
        SELECT * FROM portfolio_state WHERE session_id = $1
      `, [this.sessionId]);

      if (stateResult.rows.length > 0) {
        const state = stateResult.rows[0];
        this.cash = parseFloat(state.current_cash);
        this.peakValue = parseFloat(state.peak_value);
        this.totalRealizedPnL = parseFloat(state.total_realized_pnl);
        this.totalCommissions = parseFloat(state.total_commissions);
        this.totalTrades = parseInt(state.total_trades);
        // Note: initialCapital comes from trading_sessions table, not portfolio_state
      }

      // Restore positions
      const positionsResult = await this.db.query(`
        SELECT * FROM positions WHERE session_id = $1
      `, [this.sessionId]);

      for (const row of positionsResult.rows) {
        this.positions.set(row.symbol, {
          quantity: parseInt(row.quantity),
          avgPrice: parseFloat(row.avg_price),
          lastPrice: row.last_price ? parseFloat(row.last_price) : null,
          unrealizedPnL: row.unrealized_pnl ? parseFloat(row.unrealized_pnl) : 0,
          realizedPnL: row.realized_pnl ? parseFloat(row.realized_pnl) : 0
        });
      }

      logger.info(`Restored state for ${this.sessionId}: ${this.positions.size} positions, cash=$${this.cash.toFixed(2)}`);
    } catch (error) {
      logger.error(`Failed to restore from database: ${error.message}`);
    }
  }

  /**
   * Persist current state to database
   */
  async persistState() {
    try {
      // Upsert portfolio state
      await this.db.query(`
        INSERT INTO portfolio_state (
          session_id, current_cash, portfolio_value, peak_value,
          total_realized_pnl, total_unrealized_pnl, total_commissions,
          total_trades, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (session_id) DO UPDATE SET
          current_cash = $2,
          portfolio_value = $3,
          peak_value = $4,
          total_realized_pnl = $5,
          total_unrealized_pnl = $6,
          total_commissions = $7,
          total_trades = $8,
          updated_at = NOW()
      `, [
        this.sessionId,
        this.cash,
        this.getPortfolioValue(),
        this.peakValue,
        this.totalRealizedPnL,
        this.totalUnrealizedPnL,
        this.totalCommissions,
        this.totalTrades
      ]);

      // Update positions
      for (const [symbol, position] of this.positions.entries()) {
        await this.db.query(`
          INSERT INTO positions (
            session_id, symbol, quantity, avg_price, last_price,
            market_value, unrealized_pnl, realized_pnl, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (session_id, symbol) DO UPDATE SET
            quantity = $3,
            avg_price = $4,
            last_price = $5,
            market_value = $6,
            unrealized_pnl = $7,
            realized_pnl = $8,
            updated_at = NOW()
        `, [
          this.sessionId,
          symbol,
          position.quantity,
          position.avgPrice,
          position.lastPrice || position.avgPrice,
          position.quantity * (position.lastPrice || position.avgPrice),
          position.unrealizedPnL || 0,
          position.realizedPnL || 0
        ]);
      }

      logger.debug(`State persisted for ${this.sessionId}`);
    } catch (error) {
      logger.error(`Failed to persist state: ${error.message}`);
    }
  }
}

module.exports = PortfolioState;
