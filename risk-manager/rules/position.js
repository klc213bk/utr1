/**
 * Position Size Limit Checks
 */

function checkPositionLimits(signal, positionTracker, config, currentPrice = null) {
  const limits = config.positionLimits;
  const currentPosition = positionTracker.getPosition(signal.symbol);
  const projectedPosition = positionTracker.calculateProjectedPosition(
    signal.symbol,
    signal.action,
    signal.quantity
  );

  const checks = [];
  const price = currentPrice || signal.price || 0;

  // Check 1: Max shares per trade
  if (signal.quantity > limits.maxSharesPerTrade) {
    return {
      passed: false,
      reason: `Trade size ${signal.quantity} exceeds max shares per trade (${limits.maxSharesPerTrade})`,
      score: signal.quantity / limits.maxSharesPerTrade,
      details: { limit: limits.maxSharesPerTrade, actual: signal.quantity }
    };
  }

  // Check 2: Max dollar value per trade
  const tradeValue = signal.quantity * price;
  if (tradeValue > limits.maxDollarValuePerTrade) {
    return {
      passed: false,
      reason: `Trade value $${tradeValue.toFixed(2)} exceeds max per trade ($${limits.maxDollarValuePerTrade})`,
      score: tradeValue / limits.maxDollarValuePerTrade,
      details: { limit: limits.maxDollarValuePerTrade, actual: tradeValue }
    };
  }

  // Check 3: Max position shares (only for BUY)
  if (signal.action === 'BUY' && projectedPosition.quantity > limits.maxPositionShares) {
    return {
      passed: false,
      reason: `Projected position ${projectedPosition.quantity} exceeds max position shares (${limits.maxPositionShares})`,
      score: projectedPosition.quantity / limits.maxPositionShares,
      details: {
        current: currentPosition.quantity,
        projected: projectedPosition.quantity,
        limit: limits.maxPositionShares
      }
    };
  }

  // Check 4: Max position dollars (only for BUY)
  if (signal.action === 'BUY' && projectedPosition.exposure > limits.maxPositionDollars) {
    return {
      passed: false,
      reason: `Projected exposure $${projectedPosition.exposure.toFixed(2)} exceeds max position dollars ($${limits.maxPositionDollars})`,
      score: projectedPosition.exposure / limits.maxPositionDollars,
      details: {
        current: currentPosition.exposure,
        projected: projectedPosition.exposure,
        limit: limits.maxPositionDollars
      }
    };
  }

  // Check 5: Can't sell more than you own
  if (signal.action === 'SELL' && signal.quantity > currentPosition.quantity) {
    return {
      passed: false,
      reason: `Cannot sell ${signal.quantity} shares, only own ${currentPosition.quantity}`,
      score: signal.quantity / (currentPosition.quantity || 1),
      details: {
        owned: currentPosition.quantity,
        trying_to_sell: signal.quantity
      }
    };
  }

  // All checks passed
  return {
    passed: true,
    reason: null,
    score: Math.max(
      signal.quantity / limits.maxSharesPerTrade,
      tradeValue / limits.maxDollarValuePerTrade
    ),
    details: {
      tradeValue,
      projectedPosition
    }
  };
}

module.exports = { checkPositionLimits };
