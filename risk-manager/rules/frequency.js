/**
 * Trade Frequency Limit Checks
 */

function checkFrequencyLimits(signal, dailyStats, tradeHistory, config) {
  const limits = config.frequencyLimits;
  const now = Date.now();

  // Check 1: Max trades per day
  if (dailyStats.totalTrades >= limits.maxTradesPerDay) {
    return {
      passed: false,
      reason: `Daily trade limit reached (${limits.maxTradesPerDay})`,
      score: dailyStats.totalTrades / limits.maxTradesPerDay,
      details: {
        totalTrades: dailyStats.totalTrades,
        limit: limits.maxTradesPerDay
      }
    };
  }

  // Check 2: Min time between trades
  if (tradeHistory.lastTradeTime) {
    const timeSinceLastTrade = (now - tradeHistory.lastTradeTime) / 1000; // seconds
    if (timeSinceLastTrade < limits.minTimeBetweenTrades) {
      return {
        passed: false,
        reason: `Too soon since last trade (${timeSinceLastTrade.toFixed(0)}s < ${limits.minTimeBetweenTrades}s)`,
        score: limits.minTimeBetweenTrades / timeSinceLastTrade,
        details: {
          timeSinceLastTrade,
          limit: limits.minTimeBetweenTrades,
          lastTradeTime: new Date(tradeHistory.lastTradeTime).toISOString()
        }
      };
    }
  }

  // Check 3: Max trades per symbol per day
  const symbolTrades = tradeHistory.symbolCounts.get(signal.symbol) || 0;
  if (symbolTrades >= limits.maxTradesPerSymbol) {
    return {
      passed: false,
      reason: `Max trades for ${signal.symbol} reached (${limits.maxTradesPerSymbol})`,
      score: symbolTrades / limits.maxTradesPerSymbol,
      details: {
        symbol: signal.symbol,
        symbolTrades,
        limit: limits.maxTradesPerSymbol
      }
    };
  }

  // Check 4: Max trades per minute
  const recentTrades = tradeHistory.recentTimestamps.filter(ts => now - ts < 60000).length;
  if (recentTrades >= limits.maxTradesPerMinute) {
    return {
      passed: false,
      reason: `Too many trades in last minute (${recentTrades}/${limits.maxTradesPerMinute})`,
      score: recentTrades / limits.maxTradesPerMinute,
      details: {
        tradesInLastMinute: recentTrades,
        limit: limits.maxTradesPerMinute
      }
    };
  }

  // All checks passed
  return {
    passed: true,
    reason: null,
    score: dailyStats.totalTrades / limits.maxTradesPerDay,
    details: {
      totalTrades: dailyStats.totalTrades,
      symbolTrades
    }
  };
}

module.exports = { checkFrequencyLimits };
