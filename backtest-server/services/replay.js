const logger = require('../logger');

function getIO() {
  return require('../index').io;
}
const Cursor = require('pg-cursor');
const { getDatabase, getNATS } = require('../config/connections');

// Replay state management
let replayState = {
  isRunning: false,
  isPaused: false,
  startDate: null,
  endDate: null,
  currentTime: null,
  barsPublished: 0,
  totalBars: 0,
  progress: 0,
  speed: 1,
  startedAt: null,
  completedAt: null,
  error: null
};

// Start replay
async function startReplay({ startDate, endDate, speed = 1, backtestId = null }) {
  logger.business.info('Starting data replay', {
    backtestId,
    startDate,
    endDate,
    speed
  });
  if (replayState.isRunning) {
    throw new Error('Replay already in progress');
  }
  
  // Use strings directly - no Date conversion needed
  console.log(`🚀 Starting replay from ${startDate} to ${endDate} at ${speed}x speed`);

  // Reset state
  replayState = {
    isRunning: true,
    isPaused: false,
    startDate: startDate,
    endDate: endDate,
    currentTime: null,
    barsPublished: 0,
    totalBars: 0,
    progress: 0,
    speed,
    startedAt: new Date(),
    completedAt: null,
    error: null,
    backtestId: backtestId
  };
  
  // Start replay in background
  replayBars(startDate, endDate, speed).catch(error => {
    console.error('Replay error:', error);
    replayState.isRunning = false;
    replayState.error = error.message;
  });
  
  logger.business.info('Replay started', {
    startDate,
    endDate,
    speed,
    backtestId,
    sessionId: logger.currentSessionId
  });

  return replayState;
}

// Main replay logic
async function replayBars(startDate, endDate, speed) {
  const pgPool = getDatabase();
  const natsConnection = getNATS();
  const client = await pgPool.connect();
  
  try {
    // Get total count for progress
    const countQuery = `
      SELECT COUNT(*) as count 
      FROM spy_bars_1min 
      WHERE time >= $1::date AND time < ($2::date + interval '1 day')
    `;
    
    const countResult = await client.query(countQuery, [startDate, endDate]);
    replayState.totalBars = parseInt(countResult.rows[0].count);
    
    console.log(`📊 Found ${replayState.totalBars} bars to replay`);
    console.log(`⚡ Speed: ${speed}x (${speed === 0 ? 'Maximum' : `1 bar every ${(60/speed).toFixed(1)} seconds`})`);

    if (replayState.totalBars === 0) {
      throw new Error('No data found for the specified date range');
    }
    
    // Create cursor for streaming
    const query = `
      SELECT time, open, high, low, close, volume, vwap, count
      FROM spy_bars_1min 
      WHERE time >= $1::date AND time < ($2::date + interval '1 day')
      ORDER BY time
    `;
    
    const cursor = client.query(new Cursor(query, [startDate, endDate]));
    const batchSize = 100;

  // Calculate delay between bars based on speed
    let delayMs;
    if (speed === 0) {
      delayMs = 0; // Max speed - no delay
    } else {
      // For 1-minute bars:
      // 1x speed = 60 seconds per bar = 60000ms
      // 10x speed = 6 seconds per bar = 6000ms
      // 60x speed = 1 second per bar = 1000ms
      delayMs = Math.round(60000 / speed); // 60 seconds / speed
    }

    console.log(`⏱️ Delay between bars: ${delayMs}ms`);
    
    let lastPublishTime = Date.now();

    // Process bars in batches
    while (replayState.isRunning) {
      // Handle pause
      while (replayState.isPaused && replayState.isRunning) {
        await sleep(100);
      }
      
      // Read next batch
      const bars = await new Promise((resolve, reject) => {
        cursor.read(batchSize, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
      
      if (bars.length === 0) break;
      
      // Process each bar
      for (const bar of bars) {
        if (!replayState.isRunning) break;
        
        // Handle pause
        while (replayState.isPaused && replayState.isRunning) {
          await sleep(100);
        }
        
        // Apply speed-based delay
        if (delayMs > 0) {
          const timeSinceLastBar = Date.now() - lastPublishTime;
          const remainingDelay = delayMs - timeSinceLastBar;
          
          if (remainingDelay > 0) {
            await sleep(remainingDelay);
          }
        }

        // Publish to NATS
        const message = {
          symbol: 'SPY',
          time: bar.time.toISOString(),
          timestamp: bar.time.getTime(),
          open: parseFloat(bar.open),
          high: parseFloat(bar.high),
          low: parseFloat(bar.low),
          close: parseFloat(bar.close),
          volume: parseInt(bar.volume),
          vwap: parseFloat(bar.vwap || 0),
          count: parseInt(bar.count || 0),
          replay: true,
          replaySpeed: speed,
          backtestId: replayState.backtestId,
          progress: ((replayState.barsPublished + 1) / replayState.totalBars) * 100
        };

        const subject = 'md.equity.spy.bars.1m.replay';
        
        try {
          natsConnection.publish(subject, JSON.stringify(message));
          
          // Update state
          replayState.barsPublished++;
          replayState.currentTime = bar.time;
          replayState.progress = (replayState.barsPublished / replayState.totalBars) * 100;
          
          // Record publish time for next iteration
          lastPublishTime = Date.now();

          // Emit progress update (every 10 bars or at completion)
          if (replayState.barsPublished % 10 === 0 || replayState.barsPublished === replayState.totalBars) {
            const io = getIO();
            if (io) {
              io.emit('replay-progress', {
                backtestId: replayState.backtestId,
                barsPublished: replayState.barsPublished,
                totalBars: replayState.totalBars,
                progress: replayState.progress,
                currentTime: replayState.currentTime,
                barsPerSecond: speed === 0 ? 'Max' : (speed / 60).toFixed(2)
              });
            }
          }

          // Log progress with timing info
          if (replayState.barsPublished % 100 === 0 || replayState.barsPublished === replayState.totalBars) {
            const elapsedTime = (Date.now() - replayState.startedAt) / 1000;
            const actualBarsPerSecond = replayState.barsPublished / elapsedTime;
            console.log(`📈 Progress: ${replayState.barsPublished}/${replayState.totalBars} bars (${replayState.progress.toFixed(1)}%)`);
            console.log(`   Actual rate: ${actualBarsPerSecond.toFixed(2)} bars/sec`);
            logger.business.debug('Replay progress', {
              backtestId: replayState.backtestId,
              barsPublished: replayState.barsPublished,
              totalBars: replayState.totalBars,
              progress: replayState.progress.toFixed(1),
              currentTime: bar.time
            });
          }
        } catch (error) {
          console.error('Failed to publish bar:', error);
          logger.business.error('Replay error', {
            backtestId: replayState.backtestId,
            error: error.message,
            stack: error.stack,
            barsPublished: replayState.barsPublished,
            progress: replayState.progress
          });
        }
      }
    }
    
    cursor.close(() => {
      console.log('✅ Replay completed');
    });
    
  } catch (error) {
    console.error('❌ Replay error:', error);
    replayState.error = error.message;
    throw error;
  } finally {
    client.release();
    replayState.isRunning = false;
    replayState.completedAt = new Date();
    
    const duration = (Date.now() - replayState.startedAt) / 1000;
    const actualRate = replayState.barsPublished / duration;
    
    console.log(`🏁 Replay finished:`);
    console.log(`   Bars published: ${replayState.barsPublished}`);
    console.log(`   Duration: ${duration.toFixed(1)} seconds`);
    console.log(`   Actual rate: ${actualRate.toFixed(2)} bars/sec`);
    console.log(`   Target rate: ${speed === 0 ? 'Max' : (speed / 60).toFixed(2)} bars/sec`);
  }
}

// Control functions
function stopReplay() {
  if (!replayState.isRunning) {
    throw new Error('No replay in progress');
  }
  replayState.isRunning = false;
  return { success: true, message: 'Replay stopped' };
}

function pauseReplay() {
  if (!replayState.isRunning) {
    throw new Error('No replay in progress');
  }
  replayState.isPaused = !replayState.isPaused;
  return {
    success: true,
    message: replayState.isPaused ? 'Replay paused' : 'Replay resumed',
    isPaused: replayState.isPaused
  };
}

function updateSpeed(speed) {
  if (speed < 0) {
    throw new Error('Invalid speed value');
  }
  replayState.speed = speed;
  return { success: true, speed: replayState.speed };
}

function getStatus() {
  return replayState;
}

// Utility
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  startReplay,
  stopReplay,
  pauseReplay,
  updateSpeed,
  getStatus
};