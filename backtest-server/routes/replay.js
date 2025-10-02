const express = require('express');
const router = express.Router();
const replayService = require('../services/replay');

// Start replay
router.post('/start', async (req, res) => {
  try {
    const { startDate, endDate, speed = 1 } = req.body;
    
    // Validation
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required'
      });
    }
    
    // Validate date format with regex
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }
    
    if (start >= end) {
      return res.status(400).json({
        success: false,
        error: 'startDate must be before endDate'
      });
    }
    
    // Start replay
    const state = await replayService.startReplay({
      startDate: startDate,
      endDate: endDate,
      speed: parseFloat(speed) || 1
    });
    
    res.json({
      success: true,
      message: 'Replay started',
      data: state
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get replay status
router.get('/status', (req, res) => {
  try {
    const status = replayService.getStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Stop replay
router.post('/stop', (req, res) => {
  try {
    const result = replayService.stopReplay();
    res.json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Pause/Resume replay
router.post('/pause', (req, res) => {
  try {
    const result = replayService.pauseReplay();
    res.json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Update speed
router.post('/speed', (req, res) => {
  try {
    const { speed } = req.body;
    
    if (!speed || speed < 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid speed value'
      });
    }
    
    const result = replayService.updateSpeed(parseFloat(speed));
    res.json(result);
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;