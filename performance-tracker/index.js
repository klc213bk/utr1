const express = require('express');
const cors = require('cors');
const { connect } = require('nats');
const { Pool } = require('pg');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { 
  cors: { 
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ['GET', 'POST'] 
  } 
});

// Export for use in services
module.exports = { io };

// Middleware
app.use(cors());
app.use(express.json());

// Make io available to routes
app.set('io', io);

// Configuration
const config = {
  port: process.env.PORT || 8086,
  name: 'performance-tracker',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'stocks', // Changed from 'ib_data' to match other services
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  },
  nats: {
    servers: process.env.NATS_URL || 'nats://localhost:4222',
    name: 'performance-tracker',
    reconnect: true,
    maxReconnectAttempts: 10,
    reconnectTimeWait: 2000
  }
};

// Connection instances
let pgPool = null;
let natsConnection = null;

// Performance Tracker Class
class PerformanceTracker {
  constructor() {
    this.backtests = new Map();
    this.initialCapital = 100000; // $100k starting capital
  }
  
  async processFill(fill) {
    const backtestId = fill.backtestId || fill.strategy_id;
    
    if (!this.backtests.has(backtestId)) {
      console.warn(`No backtest found for ID: ${backtestId}, initializing...`);
      this.initializeBacktest({ backtestId });
    }
    
    const tracker = this.backtests.get(backtestId);
    const symbol = fill.symbol || 'SPY';
    
    // Initialize position if doesn't exist
    if (!tracker.positions[symbol]) {
      tracker.positions[symbol] = {
        quantity: 0,
        avgPrice: 0,
        realizedPnL: 0
      };
    }
    
    const position = tracker.positions[symbol];
    
    if (fill.action === 'BUY') {
      const totalCost = (position.quantity * position.avgPrice) + (fill.quantity * fill.price);
      position.quantity += fill.quantity;
      position.avgPrice = position.quantity > 0 ? totalCost / position.quantity : 0;
      
      console.log(`📈 BUY: ${fill.quantity} @ ${fill.price}, New Avg: ${position.avgPrice.toFixed(2)}`);
      
    } else if (fill.action === 'SELL') {
      if (position.quantity > 0) {
        const tradePnL = fill.quantity * (fill.price - position.avgPrice);
        position.realizedPnL += tradePnL;
        position.quantity -= fill.quantity;
        
        const trade = {
          timestamp: fill.timestamp,
          action: 'SELL',
          quantity: fill.quantity,
          price: fill.price,
          pnl: tradePnL,
          returnPct: ((fill.price - position.avgPrice) / position.avgPrice) * 100
        };
        
        tracker.trades.push(trade);
        tracker.metrics.totalTrades++;
        
        if (tradePnL > 0) {
          tracker.metrics.winningTrades++;
        } else {
          tracker.metrics.losingTrades++;
        }
        
        console.log(`📉 SELL: ${fill.quantity} @ ${fill.price}, P&L: $${tradePnL.toFixed(2)}`);
      }
    }
    
    // Update metrics
    this.updateMetrics(tracker);
    
    // Update equity curve
    const currentEquity = this.calculateEquity(tracker);
    tracker.equityCurve.push({
      timestamp: fill.timestamp || new Date().toISOString(),
      value: currentEquity
    });
    
    // Emit real-time update
    io.emit('performance-update', {
      backtestId: backtestId,
      metrics: tracker.metrics,
      currentEquity: currentEquity,
      lastFill: fill
    });
  }
  
  initializeBacktest(data) {
    const backtestId = data.backtestId;
    this.backtests.set(backtestId, {
      id: backtestId,
      startDate: data.startDate,
      endDate: data.endDate,
      strategy: data.strategy,
      initialCapital: this.initialCapital,
      currentCapital: this.initialCapital,
      positions: {},
      trades: [],
      metrics: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalPnL: 0,
        winRate: 0,
        maxDrawdown: 0
      },
      equityCurve: [{
        timestamp: new Date().toISOString(),
        value: this.initialCapital
      }]
    });
    
    io.emit('performance-initialized', {
      backtestId: backtestId,
      initialCapital: this.initialCapital
    });
  }
  
  updateMetrics(tracker) {
    const trades = tracker.trades;
    
    if (trades.length > 0) {
      const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
      const winningTrades = trades.filter(t => t.pnl > 0);
      const losingTrades = trades.filter(t => t.pnl < 0);
      
      tracker.metrics.totalPnL = totalPnL;
      tracker.metrics.winRate = (winningTrades.length / trades.length) * 100;
      tracker.metrics.avgWin = winningTrades.length > 0 
        ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length 
        : 0;
      tracker.metrics.avgLoss = losingTrades.length > 0
        ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length
        : 0;
      
      tracker.metrics.totalReturnPct = (totalPnL / tracker.initialCapital) * 100;
      
      const equityValues = tracker.equityCurve.map(e => e.value);
      let peak = equityValues[0];
      let maxDrawdown = 0;
      
      for (const value of equityValues) {
        if (value > peak) peak = value;
        const drawdown = ((peak - value) / peak) * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      }
      
      tracker.metrics.maxDrawdown = maxDrawdown;
    }
  }
  
  calculateEquity(tracker) {
    let equity = tracker.initialCapital;
    
    for (const position of Object.values(tracker.positions)) {
      equity += position.realizedPnL;
    }
    
    return equity;
  }
  
  async finalizeBacktest(backtestId, cancelled = false) {
    const tracker = this.backtests.get(backtestId);
    if (!tracker) return;
    
    if (cancelled) {
      console.log(`🛑 Backtest ${backtestId} was cancelled`);
      tracker.metrics.status = 'cancelled';
    } else {
      console.log(`📊 Final Metrics for ${backtestId}:`);
    }
    
    console.log(`   Total P&L: $${tracker.metrics.totalPnL?.toFixed(2) || '0.00'}`);
    console.log(`   Return: ${tracker.metrics.totalReturnPct?.toFixed(2) || '0.00'}%`);
    console.log(`   Win Rate: ${tracker.metrics.winRate?.toFixed(1) || '0.0'}%`);
    console.log(`   Max Drawdown: ${tracker.metrics.maxDrawdown?.toFixed(2) || '0.00'}%`);
    
    try {
      await this.saveResults(tracker);
    } catch (error) {
      console.error('Error saving results:', error);
    }
    
    io.emit('backtest-results', {
      backtestId: backtestId,
      metrics: tracker.metrics,
      trades: tracker.trades,
      equityCurve: tracker.equityCurve
    });
  }
  
  async saveResults(tracker) {
    const query = `
      INSERT INTO backtest_metrics 
      (backtest_id, strategy, start_date, end_date, total_return, 
       win_rate, total_trades, max_drawdown, total_pnl)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (backtest_id) DO UPDATE SET
        total_return = $5,
        win_rate = $6,
        total_trades = $7,
        max_drawdown = $8,
        total_pnl = $9
    `;
    
    await pgPool.query(query, [
      tracker.id,
      tracker.strategy || 'unknown',
      tracker.startDate,
      tracker.endDate,
      tracker.metrics.totalReturnPct || 0,
      tracker.metrics.winRate || 0,
      tracker.metrics.totalTrades || 0,
      tracker.metrics.maxDrawdown || 0,
      tracker.metrics.totalPnL || 0
    ]);
    
    console.log(`💾 Results saved for backtest ${tracker.id}`);
  }
}

// Create global instance
const performanceTracker = new PerformanceTracker();

// Initialize database connection
async function initDatabase() {
  try {
    pgPool = new Pool(config.database);
    
    // Test connection
    const result = await pgPool.query('SELECT NOW()');
    console.log('✅ Connected to PostgreSQL:', result.rows[0].now);
    
    return pgPool;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
}

// Initialize NATS connection
async function initNATS() {
  try {
    natsConnection = await connect(config.nats);
    console.log('✅ Connected to NATS');
    
    // Setup subscriptions
    await setupSubscriptions();
    
    // Handle NATS events
    natsConnection.closed().then(() => {
      console.log('NATS connection closed');
    });
    
    return natsConnection;
  } catch (error) {
    console.error('❌ NATS connection failed:', error.message);
    throw error;
  }
}

// Setup NATS subscriptions
async function setupSubscriptions() {
  console.log('📡 Setting up subscriptions...');
  
  // Subscribe to fills
  const fillsSub = natsConnection.subscribe('execution.fills.*');
  (async () => {
    for await (const msg of fillsSub) {
      try {
        const fill = JSON.parse(msg.data);
        console.log(`📊 Fill received: ${fill.action} ${fill.quantity} @ ${fill.price}`);
        await performanceTracker.processFill(fill);
      } catch (error) {
        console.error('Error processing fill:', error);
      }
    }
  })();
  
  // Subscribe to backtest events
  const backtestSub = natsConnection.subscribe('backtest-started');
  (async () => {
    for await (const msg of backtestSub) {
      const data = JSON.parse(msg.data);
      console.log(`🚀 Backtest started: ${data.backtestId}`);
      performanceTracker.initializeBacktest(data);
    }
  })();
  
  const completeSub = natsConnection.subscribe('backtest-complete');
  (async () => {
    for await (const msg of completeSub) {
      const data = JSON.parse(msg.data);
      console.log(`🏁 Backtest completed: ${data.backtestId}`);
      await performanceTracker.finalizeBacktest(data.backtestId);
    }
  })();
  
  const cancelSub = natsConnection.subscribe('backtest-cancelled');
  (async () => {
    for await (const msg of cancelSub) {
      const data = JSON.parse(msg.data);
      console.log(`🛑 Backtest cancelled: ${data.backtestId}`);
      await performanceTracker.finalizeBacktest(data.backtestId, true);
    }
  })();
}

// Get connections
function getDatabase() {
  if (!pgPool) {
    throw new Error('Database not initialized');
  }
  return pgPool;
}

function getNATS() {
  if (!natsConnection) {
    throw new Error('NATS not initialized');
  }
  return natsConnection;
}

// Close connections
async function closeDatabase() {
  if (pgPool) {
    await pgPool.end();
    console.log('Database connection closed');
  }
}

async function closeNATS() {
  if (natsConnection) {
    await natsConnection.drain();
    await natsConnection.close();
    console.log('NATS connection closed');
  }
}

// HTTP Endpoints
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: config.name,
    timestamp: new Date().toISOString()
  });
});

app.get('/metrics/:backtestId', (req, res) => {
  const tracker = performanceTracker.backtests.get(req.params.backtestId);
  if (tracker) {
    res.json(tracker.metrics);
  } else {
    res.status(404).json({ error: 'Backtest not found' });
  }
});

app.get('/status', (req, res) => {
  res.json({
    service: config.name,
    activeBacktests: performanceTracker.backtests.size,
    natsConnected: natsConnection && !natsConnection.isClosed(),
    databaseConnected: pgPool !== null
  });
});

// Shutdown endpoint
app.post('/api/shutdown', (req, res) => {
  console.log('Shutdown requested');
  res.json({ success: true, message: 'Shutting down...' });
  
  // Gracefully close connections
  setTimeout(() => {
    shutdown();
  }, 1000);
});

// WebSocket connections
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Server startup
async function start() {
  try {
    // Initialize connections
    await initDatabase();
    await initNATS();
    
    // Start HTTP server
    httpServer.listen(config.port, () => {
      console.log(`🚀 Performance Tracker running on port ${config.port}`);
      console.log(`\n📌 API Endpoints:`);
      console.log(`   Health:   /health`);
      console.log(`   Status:   /status`);
      console.log(`   Metrics:  /metrics/:backtestId`);
      console.log(`   Shutdown: /api/shutdown`);
      console.log(`\n📡 Listening to NATS subjects:`);
      console.log(`   - execution.fills.*`);
      console.log(`   - backtest-started`);
      console.log(`   - backtest-complete`);
      console.log(`   - backtest-cancelled`);
      console.log(`\n🔌 WebSocket available for real-time updates`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function shutdown() {
  console.log('\n🛑 Shutting down gracefully...');
  
  try {
    await closeNATS();
    await closeDatabase();
    
    httpServer.close(() => {
      console.log('👋 Server closed');
      process.exit(0);
    });
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Start the server
start();