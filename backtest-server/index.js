const logger = require('./logger');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { createServer } = require('http');


require('dotenv').config();

const { initDatabase, initNATS } = require('./config/connections');
const backtestRoutes = require('./routes/backtest');
const replayRoutes = require('./routes/replay');
const dataRoutes = require('./routes/data');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
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
  port: process.env.PORT || 8083,
  name: 'backtest-server'
};

app.post('/api/shutdown', (req, res) => {
  console.log('Shutdown requested');
  res.json({ success: true, message: 'Shutting down...' });
  
  // Gracefully close connections
  setTimeout(() => {
    shutdown();
  }, 1000);
});

// Routes
app.use('/api/backtest', backtestRoutes);
app.use('/api/replay', replayRoutes);
app.use('/api/data', dataRoutes);

// Health check
app.get('/health', (req, res) => {
  logger.service.debug('Health check requested');
  res.json({ 
    status: 'ok',
    service: config.name,
    timestamp: new Date().toISOString()
  });
});

// WebSocket connections
io.on('connection', (socket) => {
  logger.service.info('Client connected', {
    socketId: socket.id,
    address: socket.handshake.address
  });
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    logger.service.info('Client disconnected', {
      socketId: socket.id
    });
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
      logger.service.info('Backtest server started', {
        port: config.port,
        pid: process.pid,
        nodeVersion: process.version
      });
      console.log(`🚀 Backtest Server running on port ${config.port}`);
      console.log(`\n📌 API Endpoints:`);
      console.log(`   Backtest: /api/backtest/*`);
      console.log(`   Replay:   /api/replay/*`);
      console.log(`   Data:     /api/data/*`);
      console.log(`   Health:   /health`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.service.error('Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

async function shutdown() {
  logger.service.info('SIGTERM received, shutting down gracefully');
  
  try {
    const { closeDatabase, closeNATS } = require('./config/connections');
    await closeNATS();
    await closeDatabase();
    
    httpServer.close(() => {
      logger.service.info('Server closed');
      process.exit(0);
    });
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Start the server
start();