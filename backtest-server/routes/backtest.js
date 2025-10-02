const express = require('express');
const router = express.Router();
const backtestService = require('../services/backtest');

// Run a backtest
router.post('/run', async (req, res) => {
  console.log('=== Backtest Run Request ===');
  console.log('Body:', req.body);
  
  try {
    const result = await backtestService.runBacktest(req.body);
    
    // Emit to WebSocket clients that backtest started
    const io = req.app.get('io');
    io.emit('backtest-started', {
      ...result,
      ...req.body
    });
    
    res.json({
      success: true,
      ...result
    });
    
  } catch (error) {
    console.error('Error starting backtest:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Get backtest status
router.get('/status', (req, res) => {
  try {
    const status = backtestService.getBacktestStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Stop running backtest
router.post('/stop', (req, res) => {
  try {
    const result = backtestService.stopBacktest();
    
    // Emit to WebSocket clients
    const io = req.app.get('io');
    io.emit('backtest-stopped');
    
    res.json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Get backtest history
router.get('/history', (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const history = backtestService.getBacktestHistory(parseInt(limit));
    
    res.json({
      success: true,
      backtests: history
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;