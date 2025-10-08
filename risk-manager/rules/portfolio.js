/**
 * Portfolio Exposure Limit Checks
 */

function checkPortfolioLimits(signal, positionTracker, config, portfolioValue) {
  const limits = config.portfolioLimits;
  const capital = config.capital;

  const currentExposure = positionTracker.getTotalExposure();
  const currentPosition = positionTracker.getPosition(signal.symbol);
  const price = signal.price || 0;

  // Calculate projected exposure after trade
  let projectedExposure = currentExposure;
  if (signal.action === 'BUY') {
    projectedExposure += signal.quantity * price;
  } else if (signal.action === 'SELL') {
    projectedExposure -= signal.quantity * price;
  }

  // Calculate projected position value
  const projectedPosition = positionTracker.calculateProjectedPosition(
    signal.symbol,
    signal.action,
    signal.quantity
  );
  const projectedPositionValue = projectedPosition.quantity * price;

  const totalValue = portfolioValue || capital.currentEquity;

  // Check 1: Max portfolio exposure
  const exposurePct = projectedExposure / totalValue;
  if (exposurePct > limits.maxPortfolioExposure) {
    return {
      passed: false,
      reason: `Portfolio exposure ${(exposurePct * 100).toFixed(1)}% would exceed max (${(limits.maxPortfolioExposure * 100).toFixed(1)}%)`,
      score: exposurePct / limits.maxPortfolioExposure,
      details: {
        currentExposure,
        projectedExposure,
        totalValue,
        exposurePct,
        limit: limits.maxPortfolioExposure
      }
    };
  }

  // Check 2: Max single position percentage (only for BUY)
  if (signal.action === 'BUY') {
    const positionPct = projectedPositionValue / totalValue;
    if (positionPct > limits.maxSinglePositionPct) {
      return {
        passed: false,
        reason: `Position in ${signal.symbol} would be ${(positionPct * 100).toFixed(1)}% of portfolio, exceeds max (${(limits.maxSinglePositionPct * 100).toFixed(1)}%)`,
        score: positionPct / limits.maxSinglePositionPct,
        details: {
          symbol: signal.symbol,
          projectedPositionValue,
          totalValue,
          positionPct,
          limit: limits.maxSinglePositionPct
        }
      };
    }
  }

  // Check 3: Reserve cash check (only for BUY)
  if (signal.action === 'BUY') {
    const requiredCash = totalValue * limits.reserveCashPct;
    const availableCash = totalValue - currentExposure;
    const cashAfterTrade = availableCash - (signal.quantity * price);

    if (cashAfterTrade < requiredCash) {
      return {
        passed: false,
        reason: `Trade would leave only $${cashAfterTrade.toFixed(2)} cash, need $${requiredCash.toFixed(2)} reserve (${(limits.reserveCashPct * 100).toFixed(1)}%)`,
        score: requiredCash / (cashAfterTrade || 1),
        details: {
          availableCash,
          cashAfterTrade,
          requiredCash,
          reservePct: limits.reserveCashPct
        }
      };
    }
  }

  // All checks passed
  return {
    passed: true,
    reason: null,
    score: Math.max(
      exposurePct / limits.maxPortfolioExposure,
      projectedPositionValue / totalValue / limits.maxSinglePositionPct
    ),
    details: {
      currentExposure,
      projectedExposure,
      exposurePct,
      projectedPositionValue
    }
  };
}

module.exports = { checkPortfolioLimits };
