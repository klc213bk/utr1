const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/connections');

// Get available date range for SPY data
router.get('/range', async (req, res) => {
  try {
    const pgPool = getDatabase();
    const result = await pgPool.query(`
      SELECT 
        MIN(time) as earliest,
        MAX(time) as latest,
        COUNT(*) as total_bars
      FROM spy_bars_1min
    `);
    
    res.json({
      success: true,
      data: {
        earliest: result.rows[0].earliest,
        latest: result.rows[0].latest,
        totalBars: parseInt(result.rows[0].total_bars)
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get data statistics for a date range
router.post('/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const pgPool = getDatabase();
    
    const result = await pgPool.query(`
      SELECT 
        COUNT(*) as bar_count,
        MIN(time) as first_bar,
        MAX(time) as last_bar,
        AVG(volume) as avg_volume,
        MIN(low) as period_low,
        MAX(high) as period_high
      FROM spy_bars_1min
      WHERE time >= $1 AND time <= $2
    `, [startDate, endDate]);
    
    res.json({
      success: true,
      data: result.rows[0]
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Check data quality for a date range
router.post('/quality', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const pgPool = getDatabase();
    
    // Check for gaps in data
    const gapQuery = `
      WITH time_series AS (
        SELECT 
          time,
          LAG(time) OVER (ORDER BY time) as prev_time
        FROM spy_bars_1min
        WHERE time >= $1 AND time <= $2
      )
      SELECT 
        COUNT(*) as gap_count,
        MAX(EXTRACT(EPOCH FROM (time - prev_time))/60) as max_gap_minutes
      FROM time_series
      WHERE EXTRACT(EPOCH FROM (time - prev_time))/60 > 1.5
    `;
    
    const gapResult = await pgPool.query(gapQuery, [startDate, endDate]);
    
    // Check for null values
    const nullQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE open IS NULL) as null_open,
        COUNT(*) FILTER (WHERE high IS NULL) as null_high,
        COUNT(*) FILTER (WHERE low IS NULL) as null_low,
        COUNT(*) FILTER (WHERE close IS NULL) as null_close,
        COUNT(*) FILTER (WHERE volume IS NULL) as null_volume
      FROM spy_bars_1min
      WHERE time >= $1 AND time <= $2
    `;
    
    const nullResult = await pgPool.query(nullQuery, [startDate, endDate]);
    
    res.json({
      success: true,
      data: {
        gaps: gapResult.rows[0],
        nullValues: nullResult.rows[0]
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;