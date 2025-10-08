/**
 * Buying Power / Cash Availability Checks
 *
 * NOW USES PORTFOLIO MANAGER for accurate buying power data
 */

const axios = require('axios');
const logger = require('../utils/logger');

const PORTFOLIO_MANAGER_URL = process.env.PORTFOLIO_MANAGER_URL || 'http://localhost:8088';

/**
 * Check buying power by querying Portfolio Manager
 */
async function checkBuyingPower(signal, positionTracker, config, portfolioValue) {
  // Only check for BUY orders
  if (signal.action !== 'BUY') {
    return {
      passed: true,
      reason: null,
      score: 0,
      details: { action: 'SELL', check_skipped: true }
    };
  }

  const tradeValue = signal.quantity * (signal.price || 0);

  try {
    // Query Portfolio Manager for accurate buying power
    const sessionId = signal.backtestId || 'paper'; // Default to paper trading
    const response = await axios.get(
      `${PORTFOLIO_MANAGER_URL}/api/portfolio/buying-power/${sessionId}`,
      { timeout: 2000 }
    );

    const buyingPower = response.data.buyingPower;

    // Check if we have sufficient buying power
    if (tradeValue > buyingPower) {
      return {
        passed: false,
        reason: `Insufficient buying power: need $${tradeValue.toFixed(2)}, have $${buyingPower.toFixed(2)}`,
        score: tradeValue / (buyingPower || 1),
        details: {
          requiredCash: tradeValue,
          availableCash: buyingPower,
          shortfall: tradeValue - buyingPower,
          source: 'portfolio-manager'
        }
      };
    }

    return {
      passed: true,
      reason: null,
      score: tradeValue / buyingPower,
      details: {
        requiredCash: tradeValue,
        availableCash: buyingPower,
        cashRemaining: buyingPower - tradeValue,
        source: 'portfolio-manager'
      }
    };

  } catch (error) {
    logger.warn(`Failed to query Portfolio Manager: ${error.message}. Falling back to local calculation.`);

    // FALLBACK: Use local position tracker if Portfolio Manager is unavailable
    const capital = config.capital;
    const totalValue = portfolioValue || capital.currentEquity;
    const currentExposure = positionTracker.getTotalExposure();
    const availableCash = totalValue - currentExposure;

    if (tradeValue > availableCash) {
      return {
        passed: false,
        reason: `Insufficient buying power: need $${tradeValue.toFixed(2)}, have $${availableCash.toFixed(2)} (fallback)`,
        score: tradeValue / (availableCash || 1),
        details: {
          requiredCash: tradeValue,
          availableCash,
          totalValue,
          currentExposure,
          shortfall: tradeValue - availableCash,
          source: 'fallback'
        }
      };
    }

    // Check leverage
    const leverage = (currentExposure + tradeValue) / totalValue;
    if (leverage > 1.0) {
      return {
        passed: false,
        reason: `Trade would create leverage (${leverage.toFixed(2)}x), not allowed (fallback)`,
        score: leverage,
        details: {
          leverage,
          currentExposure,
          tradeValue,
          totalValue,
          source: 'fallback'
        }
      };
    }

    return {
      passed: true,
      reason: null,
      score: tradeValue / availableCash,
      details: {
        requiredCash: tradeValue,
        availableCash,
        cashRemaining: availableCash - tradeValue,
        source: 'fallback'
      }
    };
  }
}

module.exports = { checkBuyingPower };
