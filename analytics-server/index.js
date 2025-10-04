// analytics-server/index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || 
    'postgresql://postgres:postgres@localhost:5432/stocks'
});

// Add shutdown endpoint for graceful shutdown
app.post('/api/shutdown', (req, res) => {
  console.log('Shutdown requested');
  res.json({ success: true, message: 'Shutting down...' });
  
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// Get available sessions for a specific mode
app.get('/api/:mode/sessions', async (req, res) => {
  const { mode } = req.params;
  
  const tableMap = {
    'backtest': 'backtest_results',
    'paper': 'paper_trading_results', 
    'live': 'live_trading_results'
  };
  
  if (!tableMap[mode]) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  
  try {
    const query = `
      SELECT * FROM ${tableMap[mode]}
      ORDER BY created_at DESC
      LIMIT 20
    `;
    const result = await pool.query(query);
    res.json({ sessions: result.rows, mode });
  } catch (error) {
     console.error(`Error fetching ${mode} sessions:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get metrics for specific session
app.get('/api/:mode/metrics/:sessionId', async (req, res) => {
  const { mode, sessionId } = req.params;
  
  const tableMap = {
    'backtest': { table: 'backtest_results', idColumn: 'backtest_id' },
    'paper': { table: 'paper_trading_results', idColumn: 'paper_id' },
    'live': { table: 'live_trading_results', idColumn: 'live_id' }
  };
  
  const config = tableMap[mode];
  if (!config) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  
  try {
    const query = `SELECT * FROM ${config.table} WHERE ${config.idColumn} = $1`;
    const result = await pool.query(query, [sessionId]);
    
    if (result.rows.length > 0) {
      // Return standardized metrics format
      const data = result.rows[0];
      res.json({
        totalReturn: parseFloat(data.total_return || 0),
        winRate: parseFloat(data.win_rate || 0),
        totalTrades: data.total_trades || 0,
        maxDrawdown: parseFloat(data.max_drawdown || 0),
        totalPnL: parseFloat(data.total_pnl || 0),
        // Add mode-specific fields as needed
        mode,
        rawData: data
      });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/trades/:backtestId', async (req, res) => {
  const { backtestId } = req.params;
  try {
    const query = `
      SELECT * FROM backtest_trades 
      WHERE backtest_id = $1 
      ORDER BY timestamp DESC 
      LIMIT 100
    `;
    const result = await pool.query(query, [backtestId]);
    res.json({ trades: result.rows });
  } catch (error) {
    console.error(`Error fetching trades for ${backtestId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/equity/:backtestId', async (req, res) => {
  const { backtestId } = req.params;
  try {
    const query = `
      SELECT timestamp, equity_value as value 
      FROM backtest_equity_curve 
      WHERE backtest_id = $1 
      ORDER BY timestamp
    `;
    const result = await pool.query(query, [backtestId]);
    res.json({ equityCurve: result.rows });
  } catch (error) {
    console.error(`Error fetching equity curve for ${backtestId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// New endpoint for Analytics.vue to get list of backtests
app.get('/api/analytics', async (req, res) => {
  try {
    const query = `
      SELECT backtest_id, strategy, start_date, end_date, 
             total_return, created_at
      FROM backtest_results 
      ORDER BY created_at DESC 
      LIMIT 20
    `;
    const result = await pool.query(query);
    res.json({ backtests: result.rows });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get metrics for Analytics.vue
app.get('/api/metrics/:backtestId', async (req, res) => {
  try {
    const { backtestId } = req.params;
    const query = `
      SELECT * FROM backtest_results 
      WHERE backtest_id = $1
    `;
    const result = await pool.query(query, [backtestId]);
    
    if (result.rows.length > 0) {
      const metrics = result.rows[0];
      res.json({
        totalReturn: parseFloat(metrics.total_return || 0),
        winRate: parseFloat(metrics.win_rate || 0),
        totalTrades: metrics.total_trades || 0,
        maxDrawdown: parseFloat(metrics.max_drawdown || 0),
        totalPnL: parseFloat(metrics.total_pnl || 0)
      });
    } else {
      res.status(404).json({ error: 'Backtest not found' });
    }
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'analytics-server',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 8087;
app.listen(PORT, () => {
console.log(`📊 Analytics server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});