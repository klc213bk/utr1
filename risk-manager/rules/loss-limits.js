/**
 * Loss Limit & Drawdown Checks
 */

function checkLossLimits(dailyStats, config) {
  const limits = config.lossLimits;
  const capital = config.capital;

  // Check 1: Daily loss limit (absolute)
  if (dailyStats.realizedPnL < -limits.maxDailyLoss) {
    return {
      passed: false,
      reason: `Daily loss $${Math.abs(dailyStats.realizedPnL).toFixed(2)} exceeds limit ($${limits.maxDailyLoss})`,
      score: Math.abs(dailyStats.realizedPnL) / limits.maxDailyLoss,
      details: {
        realizedPnL: dailyStats.realizedPnL,
        limit: limits.maxDailyLoss,
        mode: 'LOCKDOWN'
      }
    };
  }

  // Check 2: Daily loss limit (percentage)
  const dailyLossPct = dailyStats.realizedPnL / capital.initialCapital;
  if (dailyLossPct < -limits.maxDailyLossPct) {
    return {
      passed: false,
      reason: `Daily loss ${(Math.abs(dailyLossPct) * 100).toFixed(2)}% exceeds limit (${(limits.maxDailyLossPct * 100).toFixed(2)}%)`,
      score: Math.abs(dailyLossPct) / limits.maxDailyLossPct,
      details: {
        realizedPnL: dailyStats.realizedPnL,
        lossPct: dailyLossPct,
        limit: limits.maxDailyLossPct,
        mode: 'LOCKDOWN'
      }
    };
  }

  // Check 3: Consecutive losses
  if (dailyStats.consecutiveLosses >= limits.maxConsecutiveLosses) {
    return {
      passed: false,
      reason: `${dailyStats.consecutiveLosses} consecutive losses, exceeds limit (${limits.maxConsecutiveLosses})`,
      score: dailyStats.consecutiveLosses / limits.maxConsecutiveLosses,
      details: {
        consecutiveLosses: dailyStats.consecutiveLosses,
        limit: limits.maxConsecutiveLosses,
        mode: 'DEFENSIVE'
      }
    };
  }

  // All checks passed
  return {
    passed: true,
    reason: null,
    score: Math.max(
      Math.abs(dailyStats.realizedPnL) / limits.maxDailyLoss,
      Math.abs(dailyLossPct) / limits.maxDailyLossPct
    ),
    details: {
      realizedPnL: dailyStats.realizedPnL,
      consecutiveLosses: dailyStats.consecutiveLosses
    }
  };
}

function checkDrawdown(portfolioValue, config) {
  const limits = config.lossLimits;
  const capital = config.capital;

  const currentEquity = portfolioValue || capital.currentEquity;
  const peakEquity = capital.peakEquity || capital.initialCapital;

  // Calculate drawdown
  const drawdown = peakEquity - currentEquity;
  const drawdownPct = drawdown / peakEquity;

  // Check 1: Max drawdown percentage
  if (drawdownPct > limits.maxDrawdown) {
    return {
      passed: false,
      reason: `Drawdown ${(drawdownPct * 100).toFixed(2)}% exceeds max (${(limits.maxDrawdown * 100).toFixed(2)}%)`,
      score: drawdownPct / limits.maxDrawdown,
      details: {
        peakEquity,
        currentEquity,
        drawdown,
        drawdownPct,
        limit: limits.maxDrawdown,
        mode: 'LOCKDOWN'
      }
    };
  }

  // Check 2: Max drawdown dollars
  if (drawdown > limits.maxDrawdownDollars) {
    return {
      passed: false,
      reason: `Drawdown $${drawdown.toFixed(2)} exceeds max ($${limits.maxDrawdownDollars})`,
      score: drawdown / limits.maxDrawdownDollars,
      details: {
        peakEquity,
        currentEquity,
        drawdown,
        limit: limits.maxDrawdownDollars,
        mode: 'LOCKDOWN'
      }
    };
  }

  // Warning threshold (defensive mode trigger)
  const defensiveThreshold = config.modes.defensiveDrawdownThreshold || 0.05;
  const mode = drawdownPct > defensiveThreshold ? 'DEFENSIVE' : 'NORMAL';

  return {
    passed: true,
    reason: null,
    score: drawdownPct / limits.maxDrawdown,
    details: {
      peakEquity,
      currentEquity,
      drawdown,
      drawdownPct,
      mode
    }
  };
}

module.exports = { checkLossLimits, checkDrawdown };
