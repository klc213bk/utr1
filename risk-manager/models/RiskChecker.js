const { checkPositionLimits } = require('../rules/position');
const { checkPortfolioLimits } = require('../rules/portfolio');
const { checkLossLimits, checkDrawdown } = require('../rules/loss-limits');
const { checkFrequencyLimits } = require('../rules/frequency');
const { checkBuyingPower } = require('../rules/buying-power');
const logger = require('../logger');

/**
 * Orchestrates all risk checks
 */
class RiskChecker {
  constructor(config, positionTracker, database) {
    this.config = config;
    this.positionTracker = positionTracker;
    this.db = database;

    // Daily statistics
    this.dailyStats = {
      date: new Date().toISOString().split('T')[0],
      totalTrades: 0,
      approvedTrades: 0,
      rejectedTrades: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      consecutiveLosses: 0,
      consecutiveWins: 0,
      peakEquity: config.capital.initialCapital,
      currentEquity: config.capital.currentEquity
    };

    // Trade history for frequency checks
    this.tradeHistory = {
      lastTradeTime: null,
      symbolCounts: new Map(), // symbol → count
      recentTimestamps: [] // Last 100 trade timestamps
    };

    // Operating mode
    this.mode = 'NORMAL'; // NORMAL, DEFENSIVE, LOCKDOWN
  }

  /**
   * Initialize from database
   */
  async initialize() {
    logger.info('Initializing risk checker');

    // Load today's statistics from database
    await this.loadDailyStats();

    // Determine initial mode
    this.updateMode();

    logger.info('Risk checker initialized', {
      mode: this.mode,
      dailyStats: this.dailyStats
    });
  }

  /**
   * Check a trading signal against all risk rules
   */
  async checkSignal(signal) {
    const startTime = Date.now();

    try {
      // If in LOCKDOWN mode, reject all signals immediately
      if (this.mode === 'LOCKDOWN') {
        return {
          approved: false,
          mode: this.mode,
          rejectionReason: 'System in LOCKDOWN mode - all trading suspended',
          checks: null,
          riskScores: null,
          processingTime: Date.now() - startTime
        };
      }

      // Calculate current portfolio value
      const portfolioValue = this.calculatePortfolioValue();

      // Run all risk checks in parallel
      const [
        positionCheck,
        portfolioCheck,
        lossCheck,
        drawdownCheck,
        frequencyCheck,
        buyingPowerCheck
      ] = await Promise.all([
        Promise.resolve(checkPositionLimits(signal, this.positionTracker, this.config, signal.price)),
        Promise.resolve(checkPortfolioLimits(signal, this.positionTracker, this.config, portfolioValue)),
        Promise.resolve(checkLossLimits(this.dailyStats, this.config)),
        Promise.resolve(checkDrawdown(portfolioValue, this.config)),
        Promise.resolve(checkFrequencyLimits(signal, this.dailyStats, this.tradeHistory, this.config)),
        Promise.resolve(checkBuyingPower(signal, this.positionTracker, this.config, portfolioValue))
      ]);

      const checks = {
        position: positionCheck,
        portfolio: portfolioCheck,
        lossLimits: lossCheck,
        drawdown: drawdownCheck,
        frequency: frequencyCheck,
        buyingPower: buyingPowerCheck
      };

      // Determine if approved (all checks must pass)
      const allPassed = Object.values(checks).every(check => check.passed);

      // Find first failing check for rejection reason
      const failedCheck = Object.entries(checks).find(([name, check]) => !check.passed);
      const rejectionReason = failedCheck ? failedCheck[1].reason : null;

      // Aggregate risk scores
      const riskScores = {
        position: positionCheck.score,
        portfolio: portfolioCheck.score,
        lossLimits: lossCheck.score,
        drawdown: drawdownCheck.score,
        frequency: frequencyCheck.score,
        buyingPower: buyingPowerCheck.score,
        overall: this.calculateOverallScore(checks)
      };

      // Update mode based on checks
      this.updateModeFromChecks(checks);

      const decision = {
        approved: allPassed,
        mode: this.mode,
        rejectionReason,
        checks,
        riskScores,
        portfolioValue,
        processingTime: Date.now() - startTime
      };

      // Update statistics
      if (allPassed) {
        this.dailyStats.approvedTrades++;
        this.recordTradeHistory(signal);
      } else {
        this.dailyStats.rejectedTrades++;
      }
      this.dailyStats.totalTrades++;

      logger.info('Risk check completed', {
        strategy_id: signal.strategy_id,
        symbol: signal.symbol,
        action: signal.action,
        approved: allPassed,
        mode: this.mode,
        reason: rejectionReason,
        processingTime: decision.processingTime
      });

      return decision;

    } catch (error) {
      logger.error('Risk check failed', {
        error: error.message,
        stack: error.stack,
        signal
      });

      // Fail safe: reject on error
      return {
        approved: false,
        mode: 'ERROR',
        rejectionReason: `Risk check error: ${error.message}`,
        checks: null,
        riskScores: null,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Calculate overall risk score
   */
  calculateOverallScore(checks) {
    const weights = {
      position: 0.2,
      portfolio: 0.2,
      lossLimits: 0.25,
      drawdown: 0.25,
      frequency: 0.05,
      buyingPower: 0.05
    };

    let score = 0;
    for (const [name, check] of Object.entries(checks)) {
      score += (check.score || 0) * (weights[name] || 0);
    }

    return Math.min(score, 1.0);
  }

  /**
   * Update operating mode based on checks
   */
  updateModeFromChecks(checks) {
    // Lockdown conditions
    if (!checks.lossLimits.passed || !checks.drawdown.passed) {
      if (checks.lossLimits.details?.mode === 'LOCKDOWN' ||
          checks.drawdown.details?.mode === 'LOCKDOWN') {
        this.setMode('LOCKDOWN');
        return;
      }
    }

    // Defensive conditions
    if (checks.drawdown.details?.mode === 'DEFENSIVE' ||
        checks.lossLimits.details?.mode === 'DEFENSIVE') {
      this.setMode('DEFENSIVE');
      return;
    }

    // Normal mode
    this.setMode('NORMAL');
  }

  /**
   * Update operating mode
   */
  updateMode() {
    const portfolioValue = this.calculatePortfolioValue();
    const peakEquity = this.dailyStats.peakEquity || this.config.capital.initialCapital;
    const drawdown = (peakEquity - portfolioValue) / peakEquity;

    // Lockdown conditions
    if (this.dailyStats.realizedPnL < -this.config.lossLimits.maxDailyLoss) {
      this.setMode('LOCKDOWN');
    } else if (drawdown > this.config.lossLimits.maxDrawdown) {
      this.setMode('LOCKDOWN');
    }
    // Defensive conditions
    else if (drawdown > this.config.modes.defensiveDrawdownThreshold) {
      this.setMode('DEFENSIVE');
    }
    // Normal
    else {
      this.setMode('NORMAL');
    }
  }

  /**
   * Set operating mode with logging
   */
  setMode(newMode) {
    if (newMode !== this.mode) {
      logger.warn('Operating mode changed', {
        from: this.mode,
        to: newMode,
        dailyPnL: this.dailyStats.realizedPnL,
        drawdown: this.calculateDrawdown()
      });

      this.mode = newMode;

      // Emit to NATS
      const natsConnection = require('../config/connections').getNATS();
      natsConnection.publish('risk.mode-change', JSON.stringify({
        mode: newMode,
        timestamp: new Date().toISOString(),
        reason: this.getModeReason()
      }));
    }
  }

  /**
   * Get reason for current mode
   */
  getModeReason() {
    if (this.mode === 'LOCKDOWN') {
      if (this.dailyStats.realizedPnL < -this.config.lossLimits.maxDailyLoss) {
        return `Daily loss limit exceeded: $${Math.abs(this.dailyStats.realizedPnL).toFixed(2)}`;
      }
      const drawdown = this.calculateDrawdown();
      if (drawdown > this.config.lossLimits.maxDrawdown) {
        return `Max drawdown exceeded: ${(drawdown * 100).toFixed(2)}%`;
      }
    } else if (this.mode === 'DEFENSIVE') {
      return 'Drawdown warning threshold reached';
    }
    return 'Normal operations';
  }

  /**
   * Calculate portfolio value
   */
  calculatePortfolioValue() {
    const exposure = this.positionTracker.getTotalExposure();
    const cash = this.config.capital.currentEquity - exposure;
    return this.config.capital.currentEquity; // Simplified - would need real-time pricing
  }

  /**
   * Calculate current drawdown
   */
  calculateDrawdown() {
    const portfolioValue = this.calculatePortfolioValue();
    const peakEquity = this.dailyStats.peakEquity || this.config.capital.initialCapital;
    return (peakEquity - portfolioValue) / peakEquity;
  }

  /**
   * Record trade in history for frequency checks
   */
  recordTradeHistory(signal) {
    const now = Date.now();
    this.tradeHistory.lastTradeTime = now;

    // Update symbol count
    const currentCount = this.tradeHistory.symbolCounts.get(signal.symbol) || 0;
    this.tradeHistory.symbolCounts.set(signal.symbol, currentCount + 1);

    // Add to recent timestamps (keep last 100)
    this.tradeHistory.recentTimestamps.push(now);
    if (this.tradeHistory.recentTimestamps.length > 100) {
      this.tradeHistory.recentTimestamps.shift();
    }
  }

  /**
   * Update from fill (track P&L)
   */
  updateFromFill(fill) {
    // Update position tracker
    this.positionTracker.updateFromFill(fill);

    // Track realized P&L if closing position
    if (fill.realized_pnl) {
      this.dailyStats.realizedPnL += fill.realized_pnl;

      // Track win/loss streaks
      if (fill.realized_pnl > 0) {
        this.dailyStats.consecutiveWins++;
        this.dailyStats.consecutiveLosses = 0;
      } else if (fill.realized_pnl < 0) {
        this.dailyStats.consecutiveLosses++;
        this.dailyStats.consecutiveWins = 0;
      }
    }

    // Update equity and peak
    this.dailyStats.currentEquity = this.calculatePortfolioValue();
    if (this.dailyStats.currentEquity > this.dailyStats.peakEquity) {
      this.dailyStats.peakEquity = this.dailyStats.currentEquity;
    }

    // Re-evaluate mode
    this.updateMode();
  }

  /**
   * Load daily statistics from database
   */
  async loadDailyStats() {
    try {
      const today = new Date().toISOString().split('T')[0];

      const result = await this.db.query(
        'SELECT * FROM risk_daily_stats WHERE date = $1',
        [today]
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        this.dailyStats = {
          date: row.date,
          totalTrades: row.total_trades || 0,
          approvedTrades: row.approved_trades || 0,
          rejectedTrades: row.rejected_trades || 0,
          realizedPnL: parseFloat(row.realized_pnl) || 0,
          unrealizedPnL: parseFloat(row.unrealized_pnl) || 0,
          consecutiveLosses: row.consecutive_losses || 0,
          consecutiveWins: row.consecutive_wins || 0,
          peakEquity: parseFloat(row.peak_equity) || this.config.capital.initialCapital,
          currentEquity: parseFloat(row.current_equity) || this.config.capital.currentEquity
        };

        logger.info('Loaded daily stats from database', this.dailyStats);
      } else {
        logger.info('No existing daily stats, using defaults');
      }
    } catch (error) {
      logger.error('Failed to load daily stats', { error: error.message });
    }
  }

  /**
   * Save daily statistics to database
   */
  async saveDailyStats() {
    try {
      await this.db.query(`
        INSERT INTO risk_daily_stats (
          date, total_trades, approved_trades, rejected_trades,
          realized_pnl, unrealized_pnl, peak_equity, current_equity,
          consecutive_losses, consecutive_wins
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (date) DO UPDATE SET
          total_trades = $2,
          approved_trades = $3,
          rejected_trades = $4,
          realized_pnl = $5,
          unrealized_pnl = $6,
          peak_equity = $7,
          current_equity = $8,
          consecutive_losses = $9,
          consecutive_wins = $10
      `, [
        this.dailyStats.date,
        this.dailyStats.totalTrades,
        this.dailyStats.approvedTrades,
        this.dailyStats.rejectedTrades,
        this.dailyStats.realizedPnL,
        this.dailyStats.unrealizedPnL,
        this.dailyStats.peakEquity,
        this.dailyStats.currentEquity,
        this.dailyStats.consecutiveLosses,
        this.dailyStats.consecutiveWins
      ]);

      logger.debug('Daily stats saved to database');
    } catch (error) {
      logger.error('Failed to save daily stats', { error: error.message });
    }
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      mode: this.mode,
      modeReason: this.getModeReason(),
      dailyStats: this.dailyStats,
      positions: this.positionTracker.getAllPositions(),
      portfolioValue: this.calculatePortfolioValue(),
      totalExposure: this.positionTracker.getTotalExposure(),
      drawdown: this.calculateDrawdown(),
      limits: this.config
    };
  }
}

module.exports = RiskChecker;
