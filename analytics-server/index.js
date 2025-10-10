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
// UNIFIED: Uses trading_results table with session_type filter
app.get('/api/:mode/sessions', async (req, res) => {
  const { mode } = req.params;

  // Validate mode
  if (!['backtest', 'paper', 'live'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode. Must be: backtest, paper, or live' });
  }

  try {
    const query = `
      SELECT
        r.session_id,
        r.session_type,
        r.strategy_name,
        r.started_at,
        r.ended_at,
        r.total_return,
        r.total_pnl,
        r.win_rate,
        r.total_trades,
        r.calculated_at as created_at,
        s.start_date,
        s.end_date,
        s.initial_capital
      FROM trading_results r
      LEFT JOIN trading_sessions s ON r.session_id = s.session_id
      WHERE r.session_type = $1
      ORDER BY r.calculated_at DESC
      LIMIT 20
    `;
    const result = await pool.query(query, [mode]);
    res.json({ sessions: result.rows, mode });
  } catch (error) {
    console.error(`Error fetching ${mode} sessions:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get metrics for specific session
// UNIFIED: Uses trading_results with session_id
app.get('/api/:mode/metrics/:sessionId', async (req, res) => {
  const { mode, sessionId } = req.params;

  // Validate mode
  if (!['backtest', 'paper', 'live'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  try {
    const query = `
      SELECT * FROM trading_results
      WHERE session_id = $1 AND session_type = $2
    `;
    const result = await pool.query(query, [sessionId, mode]);

    if (result.rows.length > 0) {
      // Return standardized metrics format
      const data = result.rows[0];
      res.json({
        sessionId: data.session_id,
        sessionType: data.session_type,
        strategyName: data.strategy_name,
        totalReturn: parseFloat(data.total_return || 0),
        winRate: parseFloat(data.win_rate || 0),
        totalTrades: data.total_trades || 0,
        maxDrawdown: parseFloat(data.max_drawdown || 0),
        totalPnL: parseFloat(data.total_pnl || 0),
        sharpeRatio: parseFloat(data.sharpe_ratio || 0),
        profitFactor: parseFloat(data.profit_factor || 0),
        avgWin: parseFloat(data.avg_win || 0),
        avgLoss: parseFloat(data.avg_loss || 0),
        bestTrade: parseFloat(data.best_trade || 0),
        worstTrade: parseFloat(data.worst_trade || 0),
        mode,
        rawData: data
      });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } catch (error) {
    console.error(`Error fetching metrics for ${sessionId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get trades for a session (any mode)
// UNIFIED: Uses trading_trades table
app.get('/api/trades/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const query = `
      SELECT * FROM trading_trades
      WHERE session_id = $1
      ORDER BY timestamp DESC
      LIMIT 100
    `;
    const result = await pool.query(query, [sessionId]);
    res.json({ trades: result.rows });
  } catch (error) {
    console.error(`Error fetching trades for ${sessionId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get equity curve for a session (any mode)
// UNIFIED: Uses trading_equity_curve table
app.get('/api/equity/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const query = `
      SELECT timestamp, equity_value as value, cumulative_return, drawdown
      FROM trading_equity_curve
      WHERE session_id = $1
      ORDER BY timestamp
    `;
    const result = await pool.query(query, [sessionId]);
    res.json({ equityCurve: result.rows });
  } catch (error) {
    console.error(`Error fetching equity curve for ${sessionId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get all sessions for analytics view
// UNIFIED: Queries across all modes
app.get('/api/analytics', async (req, res) => {
  try {
    const query = `
      SELECT
        r.session_id,
        r.session_type,
        r.strategy_name,
        s.start_date,
        s.end_date,
        r.total_return,
        r.total_pnl,
        r.win_rate,
        r.total_trades,
        r.calculated_at as created_at
      FROM trading_results r
      LEFT JOIN trading_sessions s ON r.session_id = s.session_id
      ORDER BY r.calculated_at DESC
      LIMIT 50
    `;
    const result = await pool.query(query);

    // Group by session type for easy filtering on frontend
    const sessions = result.rows;
    const backtests = sessions.filter(s => s.session_type === 'backtest');
    const paperSessions = sessions.filter(s => s.session_type === 'paper');
    const liveSessions = sessions.filter(s => s.session_type === 'live');

    res.json({
      all: sessions,
      backtests,
      paper: paperSessions,
      live: liveSessions
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get metrics for a specific session (backward compatible endpoint)
// UNIFIED: Uses trading_results table
app.get('/api/metrics/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const query = `
      SELECT * FROM trading_results
      WHERE session_id = $1
    `;
    const result = await pool.query(query, [sessionId]);

    if (result.rows.length > 0) {
      const metrics = result.rows[0];
      res.json({
        sessionId: metrics.session_id,
        sessionType: metrics.session_type,
        strategyName: metrics.strategy_name,
        totalReturn: parseFloat(metrics.total_return || 0),
        winRate: parseFloat(metrics.win_rate || 0),
        totalTrades: metrics.total_trades || 0,
        maxDrawdown: parseFloat(metrics.max_drawdown || 0),
        totalPnL: parseFloat(metrics.total_pnl || 0),
        sharpeRatio: parseFloat(metrics.sharpe_ratio || 0),
        avgWin: parseFloat(metrics.avg_win || 0),
        avgLoss: parseFloat(metrics.avg_loss || 0),
        bestTrade: parseFloat(metrics.best_trade || 0),
        worstTrade: parseFloat(metrics.worst_trade || 0)
      });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'analytics-server',
    database: 'unified tables (trading_results, trading_trades, trading_equity_curve)',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 8087;
app.listen(PORT, () => {
  console.log(`📊 Analytics server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Using UNIFIED database tables (backtest/paper/live)`);
});
