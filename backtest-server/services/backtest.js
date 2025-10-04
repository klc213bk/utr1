const { getNATS } = require('../config/connections');
const axios = require('axios');

function getIO() {
  return require('../index').io;
}

const { startReplay, getStatus: getReplayStatus } = require('./replay');

// Backtest state management
let backtestState = {
  isRunning: false,
  currentBacktest: null,
  recentBacktests: [],
  lastResults: null
};

// Run a complete backtest
// ===== FIX for backtest-server/services/backtest.js =====
// REPLACE the entire runBacktest function with this corrected version:

async function runBacktest({ startDate, endDate, symbol = 'SPY', strategy = 'ma_cross', speed = 10 }) {
  // Validation
  if (!startDate || !endDate) {
    throw new Error('Start date and end date are required');
  }
  
  // Simple string comparison works for YYYY-MM-DD format
  if (startDate > endDate) {  // Changed from >= to >
    throw new Error('Start date cannot be after end date');
  }
  
  if (backtestState.isRunning) {
    throw new Error('A backtest is already running');
  }
  
  console.log(`📊 Starting backtest from ${startDate} to ${endDate}`);
  console.log(`   Strategy: ${strategy}, Speed: ${speed}x`);
  
  // Generate backtest ID
  const backtestId = `bt_${Date.now()}`;
  
  // Initialize backtest state
  backtestState.isRunning = true;
  backtestState.currentBacktest = {
    id: backtestId,
    startDate: startDate,  // Keep as string
    endDate: endDate,      // Keep as string
    symbol,
    strategy,
    speed,
    startedAt: new Date().toISOString(),
    status: 'initializing',
    progress: 0
  };
  
  // Start the backtest asynchronously
  setImmediate(async () => {
    try {
      const natsConnection = getNATS();
      
      // PUBLISH TO NATS when starting
      natsConnection.publish('backtest-started', JSON.stringify({
        backtestId,
        startDate,
        endDate,
        strategy,
        symbol,
        speed
      }));
      console.log(`📢 Published 'backtest-started' to NATS for ${backtestId}`);

      // Step 1: Initialize the strategy in strategy-engine
      console.log(`Initializing strategy: ${strategy}`);
      try {
        const strategyResponse = await fetch('http://localhost:8084/strategies/load', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            id: backtestId,
            strategy: strategy,
            symbol: symbol
          })
        });
        
        const data = await strategyResponse.json();
        console.log(`Strategy loaded: ${data.id}`);
      } catch (error) {
        console.error('Failed to load strategy:', error.message);
      }

      // Step 2: Start historical data replay
      backtestState.currentBacktest.status = 'replaying';

      await startReplay({
        startDate: startDate,
        endDate: endDate,
        speed
      });
      
      // Step 3: Run the backtest
      backtestState.currentBacktest.status = 'running';
      const results = await executeBacktest(backtestId);
      
      // Step 4: Complete
      backtestState.currentBacktest.status = 'completed';
      backtestState.currentBacktest.completedAt = new Date().toISOString();
      backtestState.currentBacktest.results = results;
      backtestState.lastResults = results;
      
      // Add to history
      backtestState.recentBacktests.unshift(backtestState.currentBacktest);
      if (backtestState.recentBacktests.length > 20) {
        backtestState.recentBacktests.pop();
      }
      
      // Emit completion event
      const io = getIO();
      if (io) {
        io.emit('backtest-complete', {
          backtestId,
          results,
          message: 'Backtest completed successfully'
        });
      }

    } catch (error) {
      console.error('Backtest error:', error);
      backtestState.currentBacktest.status = 'failed';
      backtestState.currentBacktest.error = error.message;
      
      // PUBLISH ERROR TO NATS
      const natsConnection = getNATS();
      natsConnection.publish('backtest-error', JSON.stringify({
        backtestId,
        error: error.message
      }));
      
      const io = getIO();
      if (io) {
        io.emit('backtest-error', {
          backtestId,
          error: error.message
        });
      }
      
    } finally {
      backtestState.isRunning = false;
    }
  });

  // IMPORTANT: Return immediately with backtest ID (moved outside setImmediate)
  return {
    backtestId,
    message: 'Backtest started',
    status: 'initializing'
  };
}

// Execute the actual backtest logic
async function executeBacktest(backtestId) {
  const io = getIO();
  const natsConnection = getNATS();

  // Monitor replay progress more frequently
  let checkInterval = setInterval(() => {
    const replayStatus = getReplayStatus();
    if (replayStatus.progress) {
      backtestState.currentBacktest.progress = replayStatus.progress;
      
      // Emit progress update every check
      if (io) {
        io.emit('backtest-progress', {
          backtestId: backtestId,
          progress: replayStatus.progress,
          barsPublished: replayStatus.barsPublished,
          totalBars: replayStatus.totalBars,
          currentTime: replayStatus.currentTime,
          message: `Processing ${replayStatus.barsPublished}/${replayStatus.totalBars} bars`
        });
      }

      // Log progress every 10%
      if (Math.floor(replayStatus.progress / 10) > Math.floor((replayStatus.progress - 1) / 10)) {
        console.log(`📊 Backtest ${backtestId}: ${replayStatus.progress.toFixed(1)}% complete`);
      }
    }
  }, 250); // Check every 250ms for smoother updates
  
  // Wait for replay to complete
  await waitForReplayCompletion();
  clearInterval(checkInterval);
  
  // Final progress update
  if (io) {
    io.emit('backtest-progress', {
      backtestId: backtestId,
      progress: 100,
      status: 'calculating-results',
      message: 'Calculating final results...'
    });
  }

  // For now, return mock results
  const results = {
    backtestId,
    totalReturn: (Math.random() * 30 - 10).toFixed(2),
    sharpe: (Math.random() * 2).toFixed(2),
    maxDrawdown: (Math.random() * 20).toFixed(2),
    winRate: (Math.random() * 40 + 40).toFixed(1),
    totalTrades: Math.floor(Math.random() * 100 + 10),
    completedAt: new Date().toISOString()
  };
  
  // PUBLISH COMPLETION TO NATS
  natsConnection.publish('backtest-complete', JSON.stringify({
    backtestId,
    results,
    completedAt: new Date().toISOString()
  }));
  console.log(`📢 Published 'backtest-complete' to NATS for ${backtestId}`); 
  console.log(`✅ Backtest ${backtestId} completed with results:`, results);

  return results;
}

// Wait for replay to finish
async function waitForReplayCompletion() {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const status = getReplayStatus();
      if (!status.isRunning) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
  });
}

// Stop running backtest
function stopBacktest() {
  console.log(`📊 stopBacktest is called!!!`)
  if (!backtestState.isRunning) {
    throw new Error('No backtest is running');
  }
  
  // Get the backtestId from the current backtest state
  const backtestId = backtestState.currentBacktest?.id;
  
  // Stop the replay
  const replay = require('./replay');
  replay.stopReplay();
  
  // PUBLISH CANCELLATION TO NATS
  const natsConnection = getNATS();
  if (backtestId && natsConnection) {
    natsConnection.publish('backtest-cancelled', JSON.stringify({
      backtestId,
      cancelledAt: new Date().toISOString()
    }));
    console.log(`📢 Published 'backtest-cancelled' to NATS for ${backtestId}`);
  }

  // Update state
  backtestState.isRunning = false;
  if (backtestState.currentBacktest) {
    backtestState.currentBacktest.status = 'stopped';
    backtestState.currentBacktest.stoppedAt = new Date().toISOString();
  }
  
  return { success: true, message: 'Backtest stopped' };
}

// Get backtest status
function getBacktestStatus() {
  return {
    isRunning: backtestState.isRunning,
    currentBacktest: backtestState.currentBacktest,
    lastResults: backtestState.lastResults
  };
}

// Get backtest history
function getBacktestHistory(limit = 10) {
  return backtestState.recentBacktests.slice(0, limit);
}

module.exports = {
  runBacktest,
  stopBacktest,
  getBacktestStatus,
  getBacktestHistory
};