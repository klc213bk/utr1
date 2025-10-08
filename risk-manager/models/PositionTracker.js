const logger = require('../logger');

/**
 * Tracks current positions in real-time
 * Hybrid approach: In-memory for speed + periodic DB reconciliation
 */
class PositionTracker {
  constructor(database) {
    this.db = database;
    this.positions = new Map(); // symbol → { quantity, avgPrice, exposure }
    this.lastReconciliation = null;
    this.reconciliationInterval = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Initialize positions from database
   */
  async initialize() {
    logger.info('Initializing position tracker from database');
    await this.reconcileWithDatabase();

    // Schedule periodic reconciliation
    setInterval(() => {
      this.reconcileWithDatabase().catch(err => {
        logger.error('Position reconciliation failed', { error: err.message });
      });
    }, this.reconciliationInterval);
  }

  /**
   * Update position from a fill
   */
  updateFromFill(fill) {
    const symbol = fill.symbol;
    const current = this.positions.get(symbol) || { quantity: 0, avgPrice: 0, exposure: 0 };

    if (fill.action === 'BUY') {
      const newQuantity = current.quantity + fill.quantity;
      const newAvgPrice = ((current.quantity * current.avgPrice) + (fill.quantity * fill.price)) / newQuantity;

      this.positions.set(symbol, {
        quantity: newQuantity,
        avgPrice: newAvgPrice,
        exposure: newQuantity * newAvgPrice
      });
    } else if (fill.action === 'SELL') {
      const newQuantity = current.quantity - fill.quantity;

      if (newQuantity === 0) {
        this.positions.delete(symbol);
      } else {
        this.positions.set(symbol, {
          quantity: newQuantity,
          avgPrice: current.avgPrice, // Keep same avg price on exit
          exposure: newQuantity * current.avgPrice
        });
      }
    }

    logger.debug('Position updated', {
      symbol,
      action: fill.action,
      quantity: fill.quantity,
      newPosition: this.positions.get(symbol)
    });
  }

  /**
   * Get current position for a symbol
   */
  getPosition(symbol) {
    return this.positions.get(symbol) || { quantity: 0, avgPrice: 0, exposure: 0 };
  }

  /**
   * Get all positions
   */
  getAllPositions() {
    return Array.from(this.positions.entries()).map(([symbol, pos]) => ({
      symbol,
      ...pos
    }));
  }

  /**
   * Get total portfolio exposure
   */
  getTotalExposure() {
    let total = 0;
    for (const [symbol, pos] of this.positions) {
      total += pos.exposure;
    }
    return total;
  }

  /**
   * Reconcile with database
   */
  async reconcileWithDatabase() {
    try {
      // Query database for net positions from fills
      const result = await this.db.query(`
        SELECT
          symbol,
          SUM(CASE WHEN action = 'BUY' THEN quantity ELSE -quantity END) as net_quantity,
          AVG(CASE WHEN action = 'BUY' THEN price END) as avg_buy_price
        FROM fills
        WHERE timestamp >= CURRENT_DATE  -- Today's fills only
        GROUP BY symbol
        HAVING SUM(CASE WHEN action = 'BUY' THEN quantity ELSE -quantity END) != 0
      `);

      const dbPositions = new Map();
      for (const row of result.rows) {
        dbPositions.set(row.symbol, {
          quantity: parseInt(row.net_quantity),
          avgPrice: parseFloat(row.avg_buy_price || 0),
          exposure: parseInt(row.net_quantity) * parseFloat(row.avg_buy_price || 0)
        });
      }

      // Compare with in-memory positions
      let discrepancies = 0;
      for (const [symbol, dbPos] of dbPositions) {
        const memPos = this.positions.get(symbol);

        if (!memPos || memPos.quantity !== dbPos.quantity) {
          discrepancies++;
          logger.warn('Position discrepancy detected', {
            symbol,
            memory: memPos,
            database: dbPos
          });

          // Update to match database (source of truth)
          this.positions.set(symbol, dbPos);
        }
      }

      // Check for positions in memory but not in DB
      for (const [symbol, memPos] of this.positions) {
        if (!dbPositions.has(symbol) && memPos.quantity !== 0) {
          discrepancies++;
          logger.warn('Position in memory but not in database', {
            symbol,
            memory: memPos
          });

          // Remove from memory
          this.positions.delete(symbol);
        }
      }

      this.lastReconciliation = new Date();

      if (discrepancies > 0) {
        logger.warn('Position reconciliation completed with discrepancies', {
          count: discrepancies
        });
      } else {
        logger.info('Position reconciliation completed successfully');
      }

    } catch (error) {
      logger.error('Position reconciliation failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Calculate what position would be after a signal is executed
   */
  calculateProjectedPosition(symbol, action, quantity) {
    const current = this.getPosition(symbol);

    if (action === 'BUY') {
      return {
        quantity: current.quantity + quantity,
        avgPrice: current.avgPrice, // Simplified - would need fill price
        exposure: (current.quantity + quantity) * current.avgPrice
      };
    } else if (action === 'SELL') {
      return {
        quantity: current.quantity - quantity,
        avgPrice: current.avgPrice,
        exposure: (current.quantity - quantity) * current.avgPrice
      };
    }

    return current;
  }
}

module.exports = PositionTracker;
