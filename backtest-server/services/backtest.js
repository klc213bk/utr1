const logger = require('../logger');
const { getNATS } = require('../config/connections');
const axios = require('axios');
const { getDatabase } = require('../config/connections');


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
  logger.setSessionId(backtestId);

  // Insert into database
  const pgPool = getDatabase();
  try {
    const insertQuery = `
      INSERT INTO trading_sessions 
      (backtest_id, session_type, strategy_name, strategy_version, strategy_params, 
      start_date, end_date, initial_capital, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8,'running')
    `;
    
    const strategyParams = {
      symbol: symbol,
      speed: speed,
      // Add strategy-specific params based on strategy type
      ...(strategy === 'ma_cross' && { short_period: 20, long_period: 50 }),
      ...(strategy === 'rsi' && { period: 14, oversold: 30, overbought: 70 })
    };

    await pgPool.query(insertQuery, [
      backtestId,
      'backtest',
      strategy,
      '1.0.0', // You might want to make this configurable
      JSON.stringify(strategyParams),
      startDate,
      endDate,
      100000.00 // Default initial capital
    ]);
    
   logger.business.info('Backtest session recorded in database', { backtestId });

  } catch (dbError) {
    logger.business.error('Failed to insert backtest session', { 
      error: dbError.message,
      backtestId 
    });
    // Decide whether to continue or abort on DB failure
    throw new Error('Failed to record backtest session: ' + dbError.message);
  }

  logger.business.info('Backtest initialized', {
    backtestId,
    startDate,
    endDate,
    symbol,
    strategy,
    speed
  });

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
        logger.business.info('Loading strategy', { 
          strategy, 
          backtestId 
        });
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
        logger.business.error('Strategy loading failed', {
          error: error.message,
          strategy,
          backtestId
        });
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
      
      // Update database status to failed
      const pgPool = getDatabase();
      try {
        await pgPool.query(
          `UPDATE backtest_sessions 
          SET status = 'failed', completed_at = CURRENT_TIMESTAMP 
          WHERE backtest_id = $1`,
          [backtestId]
        );
      } catch (dbError) {
        logger.business.error('Failed to update backtest failure status', { 
          error: dbError.message,
          backtestId 
        });
      }

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
        logger.business.info('Backtest progress', {
          backtestId,
          progress: replayStatus.progress,
          barsProcessed: replayStatus.barsPublished
        });
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
    completedAt: new Date().toISOString()
  };
  
  const pgPool = getDatabase();
  try {
    await pgPool.query(
      `UPDATE trading_sessions 
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP 
      WHERE backtest_id = $1`,
      [backtestId]
    );
  } catch (dbError) {
    logger.business.error('Failed to update backtest completion', { 
      error: dbError.message,
      backtestId 
    });
  }

  // PUBLISH COMPLETION TO NATS
  natsConnection.publish('backtest-complete', JSON.stringify({
    backtestId,
    results,
    completedAt: new Date().toISOString()
  }));
  console.log(`📢 Published 'backtest-complete' to NATS for ${backtestId}`); 
  console.log(`✅ Backtest ${backtestId} completed with results:`, results);
  logger.business.info('Backtest completed', {
    backtestId,
    results,
    duration: Date.now() - new Date(backtestState.currentBacktest.startedAt).getTime()
});

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
async function stopBacktest() {
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
  
    // Update database status to cancelled
    const pgPool = getDatabase();
    try {
      await pgPool.query(
        `UPDATE trading_sessions 
        SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP 
        WHERE backtest_id = $1`,
        [backtestId]
      );
    } catch (dbError) {
      console.error('Failed to update backtest cancellation status:', dbError);
    }
  }
  
  return { success: true, message: 'Backtest stopped' };
}

async function getBacktestHistoryFromDB(limit = 20) {
  const pgPool = getDatabase();
  try {
    const result = await pgPool.query(
      `SELECT * FROM trading_sessions 
       ORDER BY created_at DESC 
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch (error) {
    logger.business.error('Failed to fetch backtest history', { 
      error: error.message 
    });
    return [];
  }
}

module.exports = {
  runBacktest,
  stopBacktest,
  getBacktestStatus,
  getBacktestHistory,
  getBacktestHistoryFromDB  // Add this export
};

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