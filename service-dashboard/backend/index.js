const { Pool } = require('pg');  // ADD THIS to imports

const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const { Client } = require('pg');
const { connect } = require('nats');
const net = require('net');
const http = require('http');
const { format, subDays } = require('date-fns');
const { spawn, exec } = require('child_process');  // Make sure spawn is imported
const path = require('path');  
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Configuration
const config = {
  ib: {
    url: process.env.IB_BRIDGE_URL || 'http://localhost:8081',
    checkEndpoint: '/api/connection/status',
    connectEndpoint: '/api/connection/connect',
    disconnectEndpoint: '/api/connection/disconnect',
    marketData: {
      subscribeEndpoint: '/api/marketdata/spy/subscribe',
      unsubscribeEndpoint: '/api/marketdata/spy/unsubscribe'
    }
  },
  nats: {
    url: process.env.NATS_URL || 'nats://localhost:4222'
  },
  postgres: {
    connectionString: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/stocks'
  }
};

// ADD connection pool
const pool = new Pool({
  connectionString: config.postgres.connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Service states
let services = {
  ib: {
    id: 'ib',
    name: 'IB Connection',
    status: 'unknown',
    details: null,
    lastCheck: null
  },
  nats: {
    id: 'nats',
    name: 'NATS Server',
    status: 'unknown',
    details: null,
    lastCheck: null
  },
  postgres: {
    id: 'postgres',
    name: 'PostgreSQL',
    status: 'unknown',
    details: null,
    lastCheck: null
  }
};

// Track interval for cleanup
let checkInterval = null;


// ADD to existing state objects
let ibSubscriptions = {
  // Will track all active IB market data subscriptions
  // Example structure:
  // SPY: {
  //   symbol: 'SPY',
  //   barSize: '1 min',
  //   status: 'streaming',
  //   startedAt: '2024-01-15T10:30:00Z',
  //   barsReceived: 127,
  //   lastBarTime: '2024-01-15T12:37:00Z',
  //   error: null
  // }
};

let natsSubjects = {
  // Will track all active NATS subjects
  // Example structure:
  // 'md.equity.spy.bars.1m': {
  //   subject: 'md.equity.spy.bars.1m',
  //   publishers: 1,
  //   subscribers: 3,
  //   messagesPerMin: 1.0,
  //   totalMessages: 127,
  //   lastMessageTime: '2024-01-15T12:37:00Z'
  // }
};

let marketDataState = {
  spy: {
    subscribed: false,
    lastAction: null,
    lastUpdate: null,
    error: null
  }
};

// ADD new state for historical collection tracking
let historicalCollectionState = {
  isCollecting: false,
  currentCollection: null,
  recentCollections: [],
  stats: {
    totalBars: 0,
    dateRange: null,
    coverage: 0,
    lastUpdated: null
  }
};

// MODIFY checkIBConnection to include subscription info
async function checkIBConnection() {
  try {
    const response = await axios.get(`${config.ib.url}${config.ib.checkEndpoint}`, {
      timeout: 3000
    });
    
    services.ib.status = response.data.connected ? 'online' : 'offline';
    services.ib.details = {
      connected: response.data.connected,
      nextOrderId: response.data.nextOrderId,
      // ADD subscription info
      subscriptions: ibSubscriptions
    };
    services.ib.lastCheck = new Date().toISOString();
    
    return services.ib;
  } catch (error) {
    services.ib.status = 'error';
    services.ib.details = { 
      error: error.message,
      subscriptions: {} 
    };
    services.ib.lastCheck = new Date().toISOString();
    return services.ib;
  }
}

// MODIFY checkNATS to include subject tracking
async function checkNATS() {
  try {
    const nc = await connect({
      servers: config.nats.url,
      timeout: 3000,
      maxReconnectAttempts: 1
    });
    
    const server = nc.getServer();
    await nc.close();
    
    // Get monitoring data
    let monitoringData = null;
    try {
      monitoringData = await getNATSMonitoring();
      updateNatsSubjects(monitoringData);
    } catch (err) {
      console.log('NATS monitoring not available:', err.message);
    }
    
    services.nats.status = 'online';
    services.nats.details = {
      connected: true,
      server: server,
      uptime: monitoringData?.uptime || null,
      connections: monitoringData?.connections || null,
      // ADD active subjects
      subjects: natsSubjects
    };
    services.nats.lastCheck = new Date().toISOString();
    
    return services.nats;
  } catch (error) {
    services.nats.status = 'offline';
    services.nats.details = { 
      error: error.message,
      subjects: {}
    };
    services.nats.lastCheck = new Date().toISOString();
    return services.nats;
  }
}

async function checkPostgreSQL() {
  const client = new Client({
    connectionString: config.postgres.connectionString,
    connectionTimeoutMillis: 3000
  });
  
  try {
    await client.connect();
    const result = await client.query('SELECT NOW() as time, current_database() as database');
    
    services.postgres.status = 'online';
    services.postgres.details = {
      connected: true,
      database: result.rows[0].database,
      serverTime: result.rows[0].time
    };
    services.postgres.lastCheck = new Date().toISOString();
    
    await client.end();
    return services.postgres;
  } catch (error) {
    services.postgres.status = 'offline';
    services.postgres.details = { error: error.message };
    services.postgres.lastCheck = new Date().toISOString();
    return services.postgres;
  }
}

// Check all services
async function checkAllServices() {
  console.log('Checking all services...');
  
  const results = await Promise.allSettled([
    checkIBConnection(),
    checkNATS(),
    checkPostgreSQL()
  ]);
  
  // Emit updates to all connected clients
  io.emit('services-update', services);
  
  return services;
}

// Service control functions
async function controlIBConnection(action) {
  try {
    const endpoint = action === 'start' 
      ? config.ib.connectEndpoint 
      : config.ib.disconnectEndpoint;
    
    const response = await axios.post(`${config.ib.url}${endpoint}`, {}, {
      timeout: 5000
    });
    
    // Check status after action
    await checkIBConnection();
    
    return {
      success: true,
      service: 'ib',
      action,
      status: services.ib.status
    };
  } catch (error) {
    return {
      success: false,
      service: 'ib',
      action,
      error: error.message
    };
  }
}

async function controlNATS(action) {
  // Note: This is a placeholder. In production, you'd need to:
  // - Use systemctl or docker commands
  // - Or have NATS running in a container you can control
  // - Or use a process manager like PM2
  
  console.log(`NATS ${action} requested - manual intervention required`);
  
  return {
    success: false,
    service: 'nats',
    action,
    error: 'NATS control not implemented - please manage manually'
  };
}

async function controlPostgreSQL(action) {
  // Note: Same as NATS - placeholder for manual management
  console.log(`PostgreSQL ${action} requested - manual intervention required`);
  
  return {
    success: false,
    service: 'postgres',
    action,
    error: 'PostgreSQL control not implemented - please manage manually'
  };
}

async function getNATSMonitoring() {
  return new Promise((resolve, reject) => {
    // Get general server stats
    http.get('http://localhost:8222/varz', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const varz = JSON.parse(data);
          
          // Get connections with details
          http.get('http://localhost:8222/connz?subs=1', (res2) => {
            let connData = '';
            res2.on('data', chunk => connData += chunk);
            res2.on('end', () => {
              try {
                const connz = JSON.parse(connData);
                
                // Count subscriptions by subject from connection details
                const subsBySubject = {};
                let totalSubs = 0;
                
                if (connz.connections && connz.connections.length > 0) {
                  connz.connections.forEach(conn => {
                    if (conn.subscriptions_list) {
                      conn.subscriptions_list.forEach(subject => {
                        if (!subsBySubject[subject]) {
                          subsBySubject[subject] = 0;
                        }
                        subsBySubject[subject]++;
                        totalSubs++;
                      });
                    }
                  });
                }
                
                // Alternative: Try to get subscriptions directly with detail flag
                http.get('http://localhost:8222/subsz?subs=1&offset=0&limit=1000', (res3) => {
                  let subData = '';
                  res3.on('data', chunk => subData += chunk);
                  res3.on('end', () => {
                    try {
                      const subsz = JSON.parse(subData);
                      
                      // If we got subscription details from subsz, use those instead
                      if (subsz.subscriptions_list && subsz.subscriptions_list.length > 0) {
                        // Clear and rebuild from subsz data
                        const subsBySubjectFromSubsz = {};
                        subsz.subscriptions_list.forEach(sub => {
                          if (!subsBySubjectFromSubsz[sub.subject]) {
                            subsBySubjectFromSubsz[sub.subject] = 0;
                          }
                          subsBySubjectFromSubsz[sub.subject]++;
                        });
                        
                        // Use subsz data if available
                        Object.assign(subsBySubject, subsBySubjectFromSubsz);
                      }
                      
                      resolve({
                        uptime: varz.uptime,
                        connections: connz.num_connections || 0,
                        messages: {
                          in_msgs: varz.in_msgs || 0,
                          out_msgs: varz.out_msgs || 0,
                          in_bytes: varz.in_bytes || 0,
                          out_bytes: varz.out_bytes || 0,
                          in_msgs_rate: varz.in_msgs ? (varz.in_msgs / (varz.uptime || 1)).toFixed(2) : 0,
                          out_msgs_rate: varz.out_msgs ? (varz.out_msgs / (varz.uptime || 1)).toFixed(2) : 0
                        },
                        subscriptions: subsBySubject,
                        total_subscriptions: subsz.num_subscriptions || totalSubs || 0,
                        memory: varz.mem || 0,
                        cpu: varz.cpu || 0,
                        version: varz.version || 'unknown'
                      });
                    } catch (e) {
                      // If subsz fails, still return what we have from connz
                      resolve({
                        uptime: varz.uptime,
                        connections: connz.num_connections || 0,
                        messages: {
                          in_msgs: varz.in_msgs || 0,
                          out_msgs: varz.out_msgs || 0,
                          in_bytes: varz.in_bytes || 0,
                          out_bytes: varz.out_bytes || 0,
                          in_msgs_rate: varz.in_msgs ? (varz.in_msgs / (varz.uptime || 1)).toFixed(2) : 0,
                          out_msgs_rate: varz.out_msgs ? (varz.out_msgs / (varz.uptime || 1)).toFixed(2) : 0
                        },
                        subscriptions: subsBySubject,
                        total_subscriptions: totalSubs,
                        memory: varz.mem || 0,
                        cpu: varz.cpu || 0,
                        version: varz.version || 'unknown'
                      });
                    }
                  });
                }).on('error', (err) => {
                  // If subsz endpoint fails, return what we have
                  console.log('subsz endpoint error:', err.message);
                  resolve({
                    uptime: varz.uptime,
                    connections: connz.num_connections || 0,
                    messages: {
                      in_msgs: varz.in_msgs || 0,
                      out_msgs: varz.out_msgs || 0
                    },
                    subscriptions: subsBySubject,
                    total_subscriptions: totalSubs
                  });
                });
                
              } catch (e) {
                console.error('Error parsing connz:', e);
                resolve(null);
              }
            });
          }).on('error', (err) => {
            console.error('connz endpoint error:', err.message);
            resolve(null);
          });
          
        } catch (e) {
          console.error('Error parsing varz:', e);
          reject(e);
        }
      });
    }).on('error', (err) => {
      console.error('varz endpoint error:', err.message);
      reject(err);
    });
  });
}

// ADD tracking for SPY message flow
let spyStreamTracking = {
  lastMessageTime: null,
  messageCount: 0,
  startTime: Date.now(),
  consumers: 0  // Track this separately
};

function checkSPYStreamStatus() {
  const now = Date.now();
  const timeSinceLastMessage = spyStreamTracking.lastMessageTime 
    ? (now - spyStreamTracking.lastMessageTime) / 1000 
    : null;
    
  const timeWindow = (now - spyStreamTracking.startTime) / 1000 / 60; // in minutes
  const rate = timeWindow > 0 ? (spyStreamTracking.messageCount / timeWindow).toFixed(2) : '0';
  
  return {
    lastMessage: timeSinceLastMessage,
    rate: rate,
    active: timeSinceLastMessage && timeSinceLastMessage < 120, // active if message in last 2 min
    messageCount: spyStreamTracking.messageCount
  };
}

// ADD: Subscribe to NATS to track SPY messages (for monitoring)
async function setupNATSMonitoring() {
  try {
    const nc = await connect({
      servers: config.nats.url,
      name: 'dashboard-monitor'
    });
    
    const sub = nc.subscribe('md.equity.spy.bars.1m');
    (async () => {
      for await (const msg of sub) {
        // Track message receipt
        spyStreamTracking.lastMessageTime = Date.now();
        spyStreamTracking.messageCount++;
        
        // Could emit to dashboard if needed
        io.emit('spy-data-received', {
          timestamp: new Date().toISOString(),
          size: msg.data.length
        });
      }
    })();
    
    console.log('NATS monitoring subscription setup complete');
  } catch (err) {
    console.error('Failed to setup NATS monitoring:', err);
  }
}

// ADD function to update NATS subjects from monitoring data
function updateNatsSubjects(monitoringData) {
  if (!monitoringData || !monitoringData.subscriptions) return;
  
  // Clear stale subjects (no activity for 5 minutes)
  const now = Date.now();
  Object.keys(natsSubjects).forEach(subject => {
    if (natsSubjects[subject].lastMessageTime) {
      const lastMsg = new Date(natsSubjects[subject].lastMessageTime).getTime();
      if (now - lastMsg > 300000) { // 5 minutes
        delete natsSubjects[subject];
      }
    }
  });
  
  // Update subjects from monitoring
  Object.entries(monitoringData.subscriptions).forEach(([subject, count]) => {
    if (subject.startsWith('md.')) {
      if (!natsSubjects[subject]) {
        natsSubjects[subject] = {
          subject: subject,
          subscribers: count,
          publishers: 0,
          messagesPerMin: 0,
          totalMessages: 0,
          firstSeen: new Date().toISOString()
        };
      } else {
        natsSubjects[subject].subscribers = count;
      }
    }
  });
}

// ADD: Track NATS message flow for subscribed subjects
async function setupNATSTracking() {
  try {
    const nc = await connect({
      servers: config.nats.url,
      name: 'dashboard-monitor'
    });
    
    // Subscribe to market data subjects with wildcard
    const sub = nc.subscribe('md.equity.*.bars.*');
    
    (async () => {
      for await (const msg of sub) {
        const subject = msg.subject;
        
        // Update NATS subject tracking
        if (!natsSubjects[subject]) {
          natsSubjects[subject] = {
            subject: subject,
            publishers: 1,
            subscribers: 0,
            messagesPerMin: 0,
            totalMessages: 0,
            firstSeen: new Date().toISOString()
          };
        }
        
        const subjectInfo = natsSubjects[subject];
        subjectInfo.totalMessages++;
        subjectInfo.lastMessageTime = new Date().toISOString();
        subjectInfo.publishers = 1; // We know IB Bridge is publishing
        
        // Calculate message rate
        const firstSeen = new Date(subjectInfo.firstSeen).getTime();
        const now = Date.now();
        const minutes = (now - firstSeen) / 60000;
        if (minutes > 0) {
          subjectInfo.messagesPerMin = (subjectInfo.totalMessages / minutes).toFixed(2);
        }
        
        // Update IB subscription if it exists
        const symbol = extractSymbolFromSubject(subject);
        if (symbol && ibSubscriptions[symbol]) {
          ibSubscriptions[symbol].barsReceived++;
          ibSubscriptions[symbol].lastBarTime = new Date().toISOString();
          ibSubscriptions[symbol].status = 'streaming';
        }
        
        // Emit updates
        io.emit('nats-subject-update', { subject, data: subjectInfo });
        io.emit('ib-subscriptions-update', ibSubscriptions);
      }
    })();
    
    console.log('NATS tracking setup complete');
  } catch (err) {
    console.error('Failed to setup NATS tracking:', err);
  }
}

// Helper function to extract symbol from NATS subject
function extractSymbolFromSubject(subject) {
  // md.equity.spy.bars.1m -> SPY
  const parts = subject.split('.');
  if (parts.length >= 3 && parts[0] === 'md' && parts[1] === 'equity') {
    return parts[2].toUpperCase();
  }
  return null;
}

// REST API Routes
app.get('/api/services', async (req, res) => {
  const allServices = await checkAllServices();
  res.json(allServices);
});

app.get('/api/services/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!services[id]) {
    return res.status(404).json({ error: 'Service not found' });
  }
  
  // Check specific service
  let result;
  switch (id) {
    case 'ib':
      result = await checkIBConnection();
      break;
    case 'nats':
      result = await checkNATS();
      break;
    case 'postgres':
      result = await checkPostgreSQL();
      break;
  }
  
  res.json(result);
});

app.post('/api/services/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  
  if (!services[id]) {
    return res.status(404).json({ error: 'Service not found' });
  }
  
  if (!['start', 'stop'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Use "start" or "stop"' });
  }
  
  let result;
  switch (id) {
    case 'ib':
      result = await controlIBConnection(action);
      break;
    case 'nats':
      result = await controlNATS(action);
      break;
    case 'postgres':
      result = await controlPostgreSQL(action);
      break;
  }
  // Emit update to all clients
  io.emit('service-control', result);
  io.emit('services-update', services);
  
  res.json(result);
});

// Get market data subscription status
app.get('/api/marketdata/status', (req, res) => {
  res.json(marketDataState);
});

// MODIFY SPY subscribe endpoint to track subscription
app.post('/api/marketdata/spy/subscribe', async (req, res) => {
  try {
    if (services.ib.status !== 'online') {
      return res.status(400).json({
        success: false,
        error: 'IB Connection is not online. Please connect first.'
      });
    }
    
    const response = await axios.post(
      `${config.ib.url}${config.ib.marketData.subscribeEndpoint}`,
      {},
      { timeout: 5000 }
    );
    
    if (response.data.success) {
      // ADD to IB subscriptions
      ibSubscriptions['SPY'] = {
        symbol: 'SPY',
        barSize: '1 min',
        status: 'streaming',
        startedAt: new Date().toISOString(),
        barsReceived: 0,
        lastBarTime: null,
        error: null
      };
      
      // Update market data state
      marketDataState.spy.subscribed = true;
      marketDataState.spy.lastAction = 'subscribe';
      marketDataState.spy.lastUpdate = new Date().toISOString();
      marketDataState.spy.error = null;
    }
    
    io.emit('marketdata-update', marketDataState);
    io.emit('ib-subscriptions-update', ibSubscriptions);
    io.emit('services-update', services);
    
    res.json(response.data);
    
  } catch (error) {
    marketDataState.spy.error = error.message;
    io.emit('marketdata-update', marketDataState);
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// MODIFY SPY unsubscribe endpoint to remove subscription
app.post('/api/marketdata/spy/unsubscribe', async (req, res) => {
  try {
    const response = await axios.post(
      `${config.ib.url}${config.ib.marketData.unsubscribeEndpoint}`,
      {},
      { timeout: 5000 }
    );
    
    // Remove from IB subscriptions
    delete ibSubscriptions['SPY'];
    
    // Update market data state
    marketDataState.spy.subscribed = false;
    marketDataState.spy.lastAction = 'unsubscribe';
    marketDataState.spy.lastUpdate = new Date().toISOString();
    
    io.emit('marketdata-update', marketDataState);
    io.emit('ib-subscriptions-update', ibSubscriptions);
    io.emit('services-update', services);
    
    res.json(response.data);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ADD endpoint to get current subscriptions
app.get('/api/marketdata/subscriptions', (req, res) => {
  res.json({
    ib: ibSubscriptions,
    nats: natsSubjects
  });
});

// MODIFY WebSocket connection handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send current states
  socket.emit('services-update', services);
  socket.emit('marketdata-update', marketDataState);
  socket.emit('ib-subscriptions-update', ibSubscriptions);
  socket.emit('nats-subjects-update', natsSubjects);
  // Send current backtest state to new connections
  socket.emit('backtest-state-update', backtestState);

  // Handle backtest requests
  socket.on('backtest-get-status', () => {
    socket.emit('backtest-status', {
      isRunning: backtestState.isRunning,
      currentBacktest: backtestState.currentBacktest
    });
  });
  
  socket.on('refresh', async () => {
    await checkAllServices();
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });

  // Send current historical state to new connections
  socket.emit('historical-state-update', historicalCollectionState);

  // Handle historical data requests
  socket.on('historical-refresh-stats', async () => {
    await updateHistoricalStats();
  });

  socket.on('historical-get-coverage', async (days) => {
    try {
      const response = await axios.get(
        `${config.ib.url}/api/historical/spy/coverage`,
        { params: { days: days || 30 } }
      );
      socket.emit('historical-coverage-data', response.data);
    } catch (error) {
      socket.emit('historical-error', error.message);
    }
  });

});

// ============================================================================
// Historical Data REST Endpoints
// ============================================================================

// Get historical collection status
app.get('/api/historical/status', (req, res) => {
  res.json({
    ...historicalCollectionState,
    ibConnected: services.ib?.status === 'online'
  });
});

// Start historical data collection
app.post('/api/historical/collect', async (req, res) => {
  console.log('=== Historical Collection Request ===');
  console.log('Body:', req.body);
  try {
    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Start date and end date are required'
      });
    }
    
    // Forward to Spring Boot
    const response = await axios.post(
      `${config.ib.url}/api/historical/spy/collect`,
      { startDate, endDate },
      { timeout: 35000 }
    );
    
    res.json(response.data);
    
  } catch (error) {
    console.error('Historical collection error:', error);
    
    if (error.code === 'ECONNABORTED') {
      res.status(408).json({
        success: false,
        error: 'Request timeout after 35 seconds'
      });
    } else {
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || error.message
      });
    }
  }
});

// Get latest collected bar
app.get('/api/historical/latest', async (req, res) => {
  try {
    const response = await axios.get(`${config.ib.url}/api/historical/spy/latest`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message + ', check IB connection',
      hasData: false
    });
  }
});

// Market Calendar endpoint
app.get('/api/market-calendar/holidays', async (req, res) => {
  const client = new Client({
    connectionString: config.postgres.connectionString
  });
  
  try {
    await client.connect();
    
    const currentYear = new Date().getFullYear();

    const query = `
      SELECT 
        id,
        date,
        holiday_name,
        session_type,
        market_open,
        market_close
      FROM us_market_calendar
      WHERE EXTRACT(YEAR FROM date) >= $1
      ORDER BY date ASC
    `;
    
    const result = await client.query(query, [currentYear]);
    
    res.json({
      success: true,
      data: result.rows,
      filterYear: currentYear
    });
    
  } catch (error) {
    console.error('Error fetching market calendar:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    await client.end();
  }
});

// Data Completeness Check endpoints

// Get min and max dates from spy_bars_1min
app.get('/api/data-completeness/date-range', async (req, res) => {
  const client = new Client({
    connectionString: config.postgres.connectionString
  });
  
  try {
    await client.connect();
    
    const query = `
      SELECT 
        MIN(time) as min_date,
        MAX(time) as max_date
      FROM spy_bars_1min
    `;
    
    const result = await client.query(query);
    
    res.json({
      success: true,
      minDate: result.rows[0]?.min_date,
      maxDate: result.rows[0]?.max_date
    });
    
  } catch (error) {
    console.error('Error getting date range:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    await client.end();
  }
});

// Check data completeness
app.post('/api/data-completeness/check', async (req, res) => {
  const { startDate, endDate } = req.body;
  
  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      error: 'Start date and end date are required'
    });
  }
  
  const client = new Client({
    connectionString: config.postgres.connectionString
  });
  
  try {
    await client.connect();
    
    const results = [];
    const currentDate = new Date(startDate);
    const lastDate = new Date(endDate);
    
    while (currentDate <= lastDate) {
      // Skip weekends
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }
      
      const dateStr = currentDate.toISOString().split('T')[0];
      
      // Get market calendar info
      const calendarQuery = `
        SELECT 
          date,
          holiday_name,
          session_type,
          market_open,
          market_close
        FROM us_market_calendar
        WHERE date = $1
      `;
      
      const calendarResult = await client.query(calendarQuery, [dateStr]);
      const calendarData = calendarResult.rows[0];
      
      // Determine expected bars
      let expectedBars = 390; // Default regular hours
      let sessionType = 'regular';
      let holidayName = null;
      
      if (calendarData) {
        sessionType = calendarData.session_type;
        holidayName = calendarData.holiday_name;
        
        if (sessionType === 'closed') {
          expectedBars = 0;
        } else if (sessionType === 'half_day') {
          expectedBars = 210;
        }
      }
      
      // Count actual bars for this date
      const barsQuery = `
        SELECT COUNT(*) as bar_count
        FROM spy_bars_1min
        WHERE DATE(time AT TIME ZONE 'America/New_York') = $1
          AND EXTRACT(HOUR FROM time AT TIME ZONE 'America/New_York') * 60 + 
              EXTRACT(MINUTE FROM time AT TIME ZONE 'America/New_York') >= 570  -- 9:30 AM = 570 minutes
          AND EXTRACT(HOUR FROM time AT TIME ZONE 'America/New_York') * 60 + 
              EXTRACT(MINUTE FROM time AT TIME ZONE 'America/New_York') < 960   -- 4:00 PM = 960 minutes
      `;
      
      const barsResult = await client.query(barsQuery, [dateStr]);
      const actualBars = parseInt(barsResult.rows[0]?.bar_count || 0);
      
      // Determine status
      let status = 'Complete';
      if (sessionType === 'closed') {
        status = expectedBars === actualBars ? 'Complete' : 'Unexpected Data';
      } else if (actualBars === 0) {
        status = 'Missing';
      } else if (actualBars < expectedBars) {
        status = 'Partial';
      }
      
      results.push({
        date: dateStr,
        holiday_name: holidayName,
        session_type: sessionType,
        expected_bars: expectedBars,
        actual_bars: actualBars,
        status: status
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    res.json({
      success: true,
      data: results
    });
    
  } catch (error) {
    console.error('Error checking completeness:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    await client.end();
  }
});

// Static file serving
app.use(express.static('public'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  // Don't exit, but log the error
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});

// Add timeout middleware to prevent hanging requests
app.use((req, res, next) => {
  // Set a timeout for all requests
  res.setTimeout(40000, () => {
    console.error('Request timeout:', req.path);
    res.status(408).json({ error: 'Request timeout' });
  });
  next();
});

// Collect multiple periods
app.post('/api/historical/collect-multiple', async (req, res) => {
  console.log('/api/historical/collect-multiple is called!')
  try {
    if (services.ib?.status !== 'online') {
      return res.status(400).json({
        success: false,
        error: 'IB Connection is not online'
      });
    }

    if (historicalCollectionState.isCollecting) {
      return res.status(400).json({
        success: false,
        error: 'Collection already in progress'
      });
    }

    const { months = 3 } = req.body;

    historicalCollectionState.isCollecting = true;
    historicalCollectionState.currentCollection = {
      id: `coll_multi_${Date.now()}`,
      startedAt: new Date().toISOString(),
      type: 'multi-period',
      totalPeriods: months,
      currentPeriod: 0,
      status: 'running',
      params: { months }
    };

    io.emit('historical-collection-started', historicalCollectionState.currentCollection);

    // Start background collection
    collectMultiplePeriods(months);

    res.json({
      success: true,
      message: `Started collecting ${months} months of data`,
      estimatedTime: `${months * 11} seconds`,
      collectionId: historicalCollectionState.currentCollection.id
    });

  } catch (error) {
    historicalCollectionState.isCollecting = false;
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get collection statistics
app.get('/api/historical/stats', async (req, res) => {
  try {
    const response = await axios.get(`${config.ib.url}/api/historical/spy/stats`);
    
    historicalCollectionState.stats = {
      ...response.data,
      lastQueried: new Date().toISOString()
    };

    res.json(historicalCollectionState.stats);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get data coverage information
app.get('/api/historical/coverage', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const response = await axios.get(
      `${config.ib.url}/api/historical/spy/coverage`,
      { params: { days } }
    );

    res.json(response.data);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get collection history
app.get('/api/historical/history', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const response = await axios.get(
      `${config.ib.url}/api/historical/spy/history`,
      { params: { limit } }
    );

    res.json({
      success: true,
      history: response.data.history,
      local: historicalCollectionState.recentCollections
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Detect and fill gaps
app.post('/api/historical/gaps/detect', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    const response = await axios.post(
      `${config.ib.url}/api/historical/spy/gaps`,
      { startDate, endDate }
    );

    res.json(response.data);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Cancel current collection (if supported)
app.post('/api/historical/cancel', (req, res) => {
  if (!historicalCollectionState.isCollecting) {
    return res.status(400).json({
      success: false,
      error: 'No collection in progress'
    });
  }

  // Note: This would need Spring Boot support to actually cancel
  historicalCollectionState.isCollecting = false;
  if (historicalCollectionState.currentCollection) {
    historicalCollectionState.currentCollection.status = 'cancelled';
    historicalCollectionState.currentCollection.completedAt = new Date().toISOString();
  }

  io.emit('historical-collection-cancelled', historicalCollectionState.currentCollection);

  res.json({
    success: true,
    message: 'Collection cancelled'
  });
});

// app.get('/api/analytics/backtests', async (req, res) => {
//   try {
//     const query = `
//       SELECT backtest_id, strategy, start_date, end_date, 
//              total_return, created_at
//       FROM backtest_results 
//       ORDER BY created_at DESC 
//       LIMIT 20
//     `;
//     const result = await pool.query(query);
//     res.json({ backtests: result.rows });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// app.get('/api/analytics/metrics/:backtestId', async (req, res) => {
//   try {
//     const { backtestId } = req.params;
//     const query = `
//       SELECT * FROM backtest_results 
//       WHERE backtest_id = $1
//     `;
//     const result = await pool.query(query, [backtestId]);
    
//     if (result.rows.length > 0) {
//       const metrics = result.rows[0];
//       res.json({
//         totalReturn: parseFloat(metrics.total_return),
//         winRate: parseFloat(metrics.win_rate),
//         totalTrades: metrics.total_trades,
//         maxDrawdown: parseFloat(metrics.max_drawdown),
//         totalPnL: parseFloat(metrics.total_pnl)
//       });
//     } else {
//       res.status(404).json({ error: 'Backtest not found' });
//     }
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// app.get('/api/analytics/trades/:backtestId', async (req, res) => {
//   try {
//     const { backtestId } = req.params;
//     const query = `
//       SELECT * FROM backtest_trades 
//       WHERE backtest_id = $1 
//       ORDER BY timestamp DESC 
//       LIMIT 100
//     `;
//     const result = await pool.query(query, [backtestId]);
//     res.json({ trades: result.rows });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// app.get('/api/analytics/equity/:backtestId', async (req, res) => {
//   try {
//     const { backtestId } = req.params;
//     const query = `
//       SELECT timestamp, equity_value as value 
//       FROM backtest_equity_curve 
//       WHERE backtest_id = $1 
//       ORDER BY timestamp
//     `;
//     const result = await pool.query(query, [backtestId]);
//     res.json({ equityCurve: result.rows });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// ============================================================================
// Helper Functions
// ============================================================================

// Background collection for multiple periods
async function collectMultiplePeriods(months) {
  try {
    const periods = [];
    const endDate = new Date();

    for (let i = 0; i < months; i++) {
      const periodEnd = subDays(endDate, i * 30);
      periods.push({
        period: i + 1,
        endDate: format(periodEnd, 'yyyyMMdd HH:mm:ss'),
        duration: '30 D'
      });
    }

    for (const period of periods) {
      if (!historicalCollectionState.isCollecting) {
        break; // Cancelled
      }

      // Update progress
      historicalCollectionState.currentCollection.currentPeriod = period.period;
      historicalCollectionState.currentCollection.progress = 
        Math.round((period.period / months) * 100);

      io.emit('historical-collection-progress', {
        collectionId: historicalCollectionState.currentCollection.id,
        currentPeriod: period.period,
        totalPeriods: months,
        progress: historicalCollectionState.currentCollection.progress,
        message: `Collecting period ${period.period} of ${months}`
      });

      try {
        // Call Spring Boot API
        const response = await axios.post(
          `${config.ib.url}/api/historical/spy/collect`,
          {
            endDate: period.endDate,
            duration: period.duration
          },
          { timeout: 35000 }
        );

        period.result = response.data;
        period.status = 'completed';

      } catch (error) {
        period.status = 'failed';
        period.error = error.message;
        console.error(`Failed to collect period ${period.period}:`, error.message);
      }

      // Wait between requests (IB rate limiting)
      if (period.period < months) {
        await sleep(11000); // 11 seconds
      }
    }

    // Collection complete
    historicalCollectionState.currentCollection.status = 'completed';
    historicalCollectionState.currentCollection.completedAt = new Date().toISOString();
    historicalCollectionState.currentCollection.periods = periods;

    const successful = periods.filter(p => p.status === 'completed').length;
    historicalCollectionState.currentCollection.summary = {
      successful,
      failed: periods.length - successful,
      totalBarsCollected: periods.reduce((sum, p) => 
        sum + (p.result?.barsSaved || 0), 0)
    };

    historicalCollectionState.recentCollections.unshift(historicalCollectionState.currentCollection);
    
    io.emit('historical-collection-completed', historicalCollectionState.currentCollection);

    // Update stats
    await updateHistoricalStats();

  } catch (error) {
    console.error('Multi-period collection error:', error);
    historicalCollectionState.currentCollection.status = 'failed';
    historicalCollectionState.currentCollection.error = error.message;
    io.emit('historical-collection-error', historicalCollectionState.currentCollection);

  } finally {
    historicalCollectionState.isCollecting = false;
  }
}

// Update historical data statistics
async function updateHistoricalStats() {
  try {
    const response = await axios.get(`${config.ib.url}/api/historical/spy/stats`);
    historicalCollectionState.stats = {
      ...response.data,
      lastUpdated: new Date().toISOString()
    };
    io.emit('historical-stats-update', historicalCollectionState.stats);
  } catch (error) {
    console.error('Failed to update historical stats:', error);
  }
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Preset collection configurations
const COLLECTION_PRESETS = {
  'last-day': {
    duration: '1 D',
    endDate: null,
    description: 'Last trading day'
  },
  'last-week': {
    duration: '5 D',  // Changed from '1 W' to '5 D' for compatibility
    endDate: null,
    description: 'Last 5 trading days'
  },
  'last-month': {
    duration: '30 D',  // Changed from '1 M' to '30 D' for compatibility
    endDate: null,
    description: 'Last 30 days'
  },
  'three-months': {
    duration: '3 M',
    endDate: null,
    description: 'Last 3 months',
    useMultiPeriod: true,
    months: 3
  }
};

// Execute preset collection
app.post('/api/historical/collect-preset', async (req, res) => {
  console.log('=== Collect Preset Request ===');
  console.log('Body:', req.body);
  console.log('Preset:', req.body.preset);
  console.log('Step 1: Received preset request');
console.log('Step 2: Config found:', config);
console.log('Step 3: About to call Spring Boot');
console.log('Step 4: Spring Boot URL:', `${config.ib.url}/api/historical/spy/collect`);

  try {
    const { preset } = req.body;
    const config = COLLECTION_PRESETS[preset];
    
    if (!config) {
      return res.status(400).json({
        success: false,
        error: 'Invalid preset'
      });
    }

    if (config.useMultiPeriod) {
      console.log('Using multi-period collection for months:', config.months);
      
      // FIX: Don't try to re-handle the request, call the function directly
      const response = await handleMultiPeriodCollection(config.months);
      return res.json(response);
    } else {
      console.log('Using single collection');
      console.log('Duration:', config.duration);
      console.log('End Date:', config.endDate);
      
      // FIX: Call the collection function directly
      const response = await handleSingleCollection({
        duration: config.duration,
        endDate: config.endDate || format(new Date(), 'yyyyMMdd HH:mm:ss')
      });
      return res.json(response);
    }

  } catch (error) {
    console.error('❌ Collect preset error:', error);
    console.error('Stack:', error.stack);
    
    // Always send a response to prevent ECONNRESET
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});


// FIX: Extract the collection logic into separate functions
async function handleSingleCollection(params) {
  console.log('Starting single collection with params:', params);
  
  // Validate IB connection
  if (services.ib?.status !== 'online') {
    console.error('IB Connection is not online');
    return {
      success: false,
      error: 'IB Connection is not online'
    };
  }

  // Check if already collecting
  if (historicalCollectionState.isCollecting) {
    console.warn('Collection already in progress');
    return {
      success: false,
      error: 'Collection already in progress'
    };
  }

  try {
    // Set collection state
    historicalCollectionState.isCollecting = true;
    historicalCollectionState.currentCollection = {
      id: `coll_${Date.now()}`,
      startedAt: new Date().toISOString(),
      params: params,
      status: 'running',
      progress: 0
    };

    // Notify clients
    io.emit('historical-collection-started', historicalCollectionState.currentCollection);

    console.log('Calling Spring Boot API...');
    console.log('URL:', `${config.ib.url}/api/historical/spy/collect`);
    console.log('Params:', params);

    // Call Spring Boot API
    const response = await axios.post(
      `${config.ib.url}/api/historical/spy/collect`,
      params,
      { 
        timeout: 35000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Spring Boot response:', response.data);

    // Update state with results
    historicalCollectionState.currentCollection = {
      ...historicalCollectionState.currentCollection,
      completedAt: new Date().toISOString(),
      status: 'completed',
      progress: 100,
      result: response.data
    };

    // Add to recent collections
    historicalCollectionState.recentCollections.unshift(historicalCollectionState.currentCollection);
    if (historicalCollectionState.recentCollections.length > 10) {
      historicalCollectionState.recentCollections.pop();
    }

    // Notify clients
    io.emit('historical-collection-completed', historicalCollectionState.currentCollection);

    return {
      success: true,
      collection: historicalCollectionState.currentCollection
    };

  } catch (error) {
    console.error('Collection error:', error.message);
    
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    
    // Update state
    const errorCollection = {
      ...historicalCollectionState.currentCollection,
      completedAt: new Date().toISOString(),
      status: 'failed',
      error: error.response?.data?.error || error.message
    };

    historicalCollectionState.currentCollection = errorCollection;
    historicalCollectionState.recentCollections.unshift(errorCollection);

    io.emit('historical-collection-error', errorCollection);

    return {
      success: false,
      error: error.response?.data?.error || error.message
    };

  } finally {
    historicalCollectionState.isCollecting = false;
  }
}

async function handleMultiPeriodCollection(months) {
  console.log('Starting multi-period collection for months:', months);
  
  // Validate IB connection
  if (services.ib?.status !== 'online') {
    return {
      success: false,
      error: 'IB Connection is not online'
    };
  }

  if (historicalCollectionState.isCollecting) {
    return {
      success: false,
      error: 'Collection already in progress'
    };
  }

  historicalCollectionState.isCollecting = true;
  historicalCollectionState.currentCollection = {
    id: `coll_multi_${Date.now()}`,
    startedAt: new Date().toISOString(),
    type: 'multi-period',
    totalPeriods: months,
    currentPeriod: 0,
    status: 'running',
    params: { months }
  };

  io.emit('historical-collection-started', historicalCollectionState.currentCollection);

  // Start background collection
  collectMultiplePeriods(months).catch(error => {
    console.error('Background collection error:', error);
  });

  return {
    success: true,
    message: `Started collecting ${months} months of data`,
    estimatedTime: `${months * 11} seconds`,
    collectionId: historicalCollectionState.currentCollection.id
  };
}

// Get available presets
app.get('/api/historical/presets', (req, res) => {
  res.json({
    presets: Object.keys(COLLECTION_PRESETS).map(key => ({
      id: key,
      ...COLLECTION_PRESETS[key]
    }))
  });
});

// Start periodic health checks
checkInterval = setInterval(checkAllServices, 10000); // Check every 10 seconds

// Update historical stats every 5 minutes
setInterval(async () => {
  if (!historicalCollectionState.isCollecting) {
    await updateHistoricalStats();
  }
}, 300000);

// Initial check on startup
checkAllServices();

function setupSimpleMonitoring() {
  // Just track based on marketDataState
  setInterval(() => {
    if (marketDataState.spy.subscribed) {
      // Assume messages are flowing if subscribed
      spyStreamTracking.lastMessageTime = Date.now();
      spyStreamTracking.messageCount++;
    }
  }, 60000); // Check every minute
}


// Add this to your dashboard server index.js

// ============================================================================
// Backtest Services Management
// ============================================================================

// Track service processes
let serviceProcesses = {
  'strategy-engine': null
  // Future: executor, tracker, risk
};

// Start all trading services
app.post('/api/trading-services/start-all', async (req, res) => {
  console.log('Starting all trading services...');
  
  try {
    // Start strategy engine
    const strategyEngineStarted = await startService('strategy-engine');
    
    // Future: Start other services
    // const executorStarted = await startService('executor');
    // const trackerStarted = await startService('tracker');
    
    res.json({
      success: true,
      services: {
        'strategy-engine': strategyEngineStarted
      }
    });
    
  } catch (error) {
    console.error('Failed to start services:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Stop all trading services
app.post('/api/trading-services/stop-all', async (req, res) => {
  console.log('Stopping all trading services...');
  
  try {
    const results = {};
    
    // Stop each service
    for (const serviceId in serviceProcesses) {
      results[serviceId] = await stopService(serviceId);
    }
    
    res.json({
      success: true,
      services: results
    });
    
  } catch (error) {
    console.error('Failed to stop services:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start specific service
app.post('/api/trading-services/:serviceId/start', async (req, res) => {
  console.log(`/api/trading-services/:serviceId/start is called`);
  
  const { serviceId } = req.params;
  
  try {
    const started = await startService(serviceId);
    
    res.json({
      success: started,
      service: serviceId
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper: Start a service
async function startService(serviceId) {
  console.log(`startService is called for: ${serviceId}`);
  console.log(`Checking if ${serviceId} is already running...`);

  // Check if already running via health endpoint
  const healthEndpoints = {
    'backtest-server': 'http://localhost:8083/health',
    'strategy-engine': 'http://localhost:8084/health',
    'execution-simulator': 'http://localhost:8085/health',
    'performance-tracker': 'http://localhost:8086/health',
    'analytics-server': 'http://localhost:8087/health'
  };
  try {
    const response = await axios.get(healthEndpoints[serviceId], { timeout: 1000 });
    if (response.status === 200) {
      console.log(`Service ${serviceId} is already running`);
      return true;
    }
  } catch (error) {
    console.log(`Service ${serviceId} is not responding, attempting to start...`);
  }

  // Clear any existing reference
  serviceProcesses[serviceId] = null;

  try {
    let command, args, cwd;
    
    switch (serviceId) {
      case 'backtest-server':
        command = 'node';
        args = ['index.js'];
        cwd = path.join(__dirname, '../../backtest-server');
        break;
      case 'strategy-engine':
        // Assuming Python strategy engine
        command = 'python';
        args = ['main.py'];
        cwd = path.join(__dirname, '../../strategy-engine');
        break;
      case 'execution-simulator':
        // Assuming Python strategy engine
        command = 'python';
        args = ['main.py'];
        cwd = path.join(__dirname, '../../execution-simulator');
        break;
      case 'performance-tracker':
        command = 'node';
        args = ['index.js'];
        cwd = path.join(__dirname, '../../performance-tracker');
        break;
      case 'analytics-server':  // Add this case
        command = 'node';
        args = ['index.js'];
        cwd = path.join(__dirname, '../../analytics-server');
        break;  
      default:
        throw new Error(`Unknown service: ${serviceId}`);
    }
    
    console.log(`Starting ${serviceId} in ${cwd}`);
    console.log(`Command: ${command} ${args.join(' ')}`);
    
    const serviceConfigs = {
      'backtest-server': { port: 8083 },
      'strategy-engine': { port: 8084 },
      'execution-simulator': { port: 8085 },
      'performance-tracker': { port: 8086 },
      'analytics-server': { port: 8087 }
    };

    const childProcess = spawn(command, args, {
      cwd,
      detached: false,
      stdio: 'pipe',
      shell: true,
      env: {
        ...process.env,
        PORT: serviceConfigs[serviceId]?.port || process.env.PORT
      }
    });
    
    if (!childProcess || !childProcess.pid) {
      throw new Error(`Failed to spawn process for ${serviceId}`);
    }
    
    console.log(`Started ${serviceId} with PID: ${childProcess.pid}`);

    childProcess.stdout.on('data', (data) => {
      console.log(`[${serviceId}] ${data}`);
    });
    
    childProcess.stderr.on('data', (data) => {
      console.error(`[${serviceId}] ERROR: ${data}`);
    });
    
    childProcess.on('exit', (code) => {
      console.log(`[${serviceId}] exited with code ${code}`);
      serviceProcesses[serviceId] = null;
    });
    
    childProcess.on('error', (err) => {
      console.error(`[${serviceId}] Process error:`, err);
      serviceProcesses[serviceId] = null;
    });

    serviceProcesses[serviceId] = childProcess;
    
    // Wait a bit to ensure service starts
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify it started
    try {
      await axios.get(healthEndpoints[serviceId], { timeout: 2000 });
      console.log(`${serviceId} is now responding on port ${serviceConfigs[serviceId]?.port}`);
      return true;
    } catch (error) {
      console.warn(`${serviceId} started but not yet responding`);
      return true; // Still consider it success as process started
    }
    
    
  } catch (error) {
    console.error(`Failed to start ${serviceId}:`, error);
    return false;
  }
}

// Helper: Stop a service (handles both managed and independent services)
async function stopService(serviceId) {
  console.log(`====== Stopping Service: ${serviceId} ======`);
  
  // Define shutdown endpoints for services that support HTTP shutdown
  const shutdownEndpoints = {
    'backtest-server': 'http://localhost:8083/api/shutdown',
    'strategy-engine': 'http://localhost:8084/api/shutdown',
    'execution-simulator': 'http://localhost:8085/api/shutdown',
    'performance-tracker': 'http://localhost:8086/api/shutdown',
    'analytics-server': 'http://localhost:8087/api/shutdown'
  };
  
  // Check if we're managing this process
  const managedProcess = serviceProcesses[serviceId];
  
  if (managedProcess && managedProcess.pid) {
    // TYPE 1: Process managed by dashboard
    console.log(`Found managed process for ${serviceId} (PID: ${managedProcess.pid})`);
    
    try {
      // First, try graceful shutdown via HTTP if available
      if (shutdownEndpoints[serviceId]) {
        try {
          console.log(`Attempting graceful HTTP shutdown for ${serviceId}...`);
          await axios.post(shutdownEndpoints[serviceId], {}, { timeout: 2000 });
          console.log(`Sent HTTP shutdown signal to ${serviceId}`);
          
          // Give it time to shutdown gracefully
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (httpError) {
          console.log(`HTTP shutdown failed or not supported, will use process kill`);
        }
      }
      
      // Then kill the process if it's still running
      try {
        // Check if process is still alive
        process.kill(managedProcess.pid, 0); // 0 = check if process exists
        
        console.log(`Process still running, sending SIGTERM to ${serviceId}...`);
        managedProcess.kill('SIGTERM');
        
        // Wait for graceful exit with timeout
        await new Promise((resolve) => {
          let forceKillTimeout = setTimeout(() => {
            try {
              console.log(`Process didn't exit gracefully, sending SIGKILL...`);
              managedProcess.kill('SIGKILL');
            } catch (e) {
              console.log(`Process might already be dead: ${e.message}`);
            }
            resolve();
          }, 5000); // 5 second timeout
          
          managedProcess.once('exit', () => {
            console.log(`${serviceId} process exited gracefully`);
            clearTimeout(forceKillTimeout);
            resolve();
          });
          
          managedProcess.once('error', (err) => {
            console.log(`Process error during shutdown: ${err.message}`);
            clearTimeout(forceKillTimeout);
            resolve();
          });
        });
        
      } catch (killError) {
        console.log(`Process ${managedProcess.pid} no longer exists`);
      }
      
      serviceProcesses[serviceId] = null;
      console.log(`✅ ${serviceId} stopped successfully (was managed)`);
      return true;
      
    } catch (error) {
      console.error(`Error stopping managed process: ${error.message}`);
      serviceProcesses[serviceId] = null;
      return false;
    }
    
  } else {
    // TYPE 2: Independent service (not managed by dashboard)
    console.log(`No managed process for ${serviceId}, checking if running independently...`);
    
    // First check if service is actually running
    const healthEndpoints = {
      'backtest-server': 'http://localhost:8083/health',
      'strategy-engine': 'http://localhost:8084/health',  
      'execution-simulator': 'http://localhost:8085/health',
      'performance-tracker': 'http://localhost:8086/health',
      'analytics-server': 'http://localhost:8087/health'
    };
    
    let isRunning = false;
    try {
      const healthCheck = await axios.get(healthEndpoints[serviceId], { timeout: 1000 });
      isRunning = healthCheck.status === 200;
      console.log(`Health check shows ${serviceId} is ${isRunning ? 'running' : 'not responding'}`);
    } catch (error) {
      console.log(`${serviceId} health check failed - might be stopped already`);
      isRunning = false;
    }
    
    if (isRunning && shutdownEndpoints[serviceId]) {
      // Try to stop via HTTP shutdown endpoint
      try {
        console.log(`Sending HTTP shutdown request to independent ${serviceId}...`);
        await axios.post(shutdownEndpoints[serviceId], {}, { timeout: 3000 });
        
        // Wait a bit for shutdown
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verify it stopped
        try {
          await axios.get(healthEndpoints[serviceId], { timeout: 1000 });
          console.warn(`${serviceId} still responding after shutdown request`);
          return false;
        } catch (error) {
          console.log(`✅ ${serviceId} stopped successfully (was independent)`);
          return true;
        }
        
      } catch (shutdownError) {
        if (shutdownError.code === 'ECONNREFUSED') {
          console.log(`✅ ${serviceId} already stopped or shut down successfully`);
          return true;
        } else {
          console.error(`Failed to stop independent service: ${shutdownError.message}`);
          return false;
        }
      }
    } else {
      // Service is not running or doesn't support HTTP shutdown
      console.log(`${serviceId} is not running or cannot be stopped via HTTP`);
      
      if (isRunning) {
        console.warn(`⚠️  ${serviceId} is running but cannot be stopped from dashboard`);
        console.warn(`   Please stop it manually using Ctrl+C in its terminal`);
        return false;
      } else {
        console.log(`✅ ${serviceId} is already stopped`);
        return true;
      }
    }
  }
}

// Also update the stop endpoint to provide better feedback
app.post('/api/trading-services/:serviceId/stop', async (req, res) => {
  const { serviceId } = req.params;
  console.log(`Stop request received for: ${serviceId}`);
  
  try {
    const stopped = await stopService(serviceId);
    
    if (stopped) {
      res.json({
        success: true,
        service: serviceId,
        message: `${serviceId} stopped successfully`
      });
    } else {
      res.status(500).json({
        success: false,
        service: serviceId,
        message: `Failed to stop ${serviceId}. It might be running independently - stop it manually.`
      });
    }
    
  } catch (error) {
    console.error(`Unexpected error stopping ${serviceId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint for all services
app.get('/api/trading-services/health', async (req, res) => {
  const health = {};
  
  // Check each service
  for (const serviceId in serviceProcesses) {
    if (serviceProcesses[serviceId]) {
      // Process is running
      health[serviceId] = 'running';
    } else {
      health[serviceId] = 'stopped';
    }
  }
  
  res.json({
    services: health,
    timestamp: new Date().toISOString()
  });
});

// Clean up on server shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  shutdown();
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  shutdown();
});

// Clean up on server shutdown - simplified version
process.on('beforeExit', () => {
  console.log('Process about to exit, cleaning up...');
});

async function shutdown() {
  console.log('Starting graceful shutdown...');
  
  // Set a hard timeout for shutdown
  const shutdownTimeout = setTimeout(() => {
    console.log('Shutdown timeout reached, forcing exit...');
    process.exit(0);
  }, 5000); // 5 second timeout
  
  try {
    // Stop checking services
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    
    // Don't try to stop services on shutdown - just cleanup our own resources
    console.log('Stopping managed services...');
    
    // Stop only processes we directly manage (not independent services)
    for (const serviceId in serviceProcesses) {
      const proc = serviceProcesses[serviceId];
      if (proc && proc.pid) {
        try {
          console.log(`Stopping managed process: ${serviceId} (PID: ${proc.pid})`);
          proc.kill('SIGTERM');
          // Don't wait for confirmation, just continue
        } catch (error) {
          console.log(`Could not stop ${serviceId}: ${error.message}`);
        }
      }
    }
    
    // Close database pool
    if (pool) {
      console.log('Closing database connection pool...');
      await pool.end().catch(err => console.log('Error closing pool:', err.message));
    }
    
    // Close HTTP server
    console.log('Closing HTTP server...');
    httpServer.close(() => {
      clearTimeout(shutdownTimeout);
      console.log('Server closed successfully');
      process.exit(0);
    });
    
    // Force exit after a short delay if server doesn't close
    setTimeout(() => {
      clearTimeout(shutdownTimeout);
      console.log('Forcing exit...');
      process.exit(0);
    }, 2000);
    
  } catch (error) {
    console.error('Error during shutdown:', error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// ============================================================================
// Backtesting API Endpoints
// ============================================================================

// State for backtesting
let backtestState = {
  isRunning: false,
  currentBacktest: null,
  recentBacktests: [],
  lastResults: null
};

// Run a backtest
app.post('/api/backtest/run', async (req, res) => {
  console.log('=== Backtest Run Request ===');
  console.log('Body:', req.body);
  
  try {
    // Simple validation
    const { startDate, endDate, strategy, speed } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Start and end dates are required'
      });
    }
    
    // Set defaults if not provided
    const backtestRequest = {
      startDate,
      endDate,
      symbol: req.body.symbol || 'SPY',
      strategy: strategy || 'ma_cross',
      speed: speed || 10
    };
    
    console.log('Forwarding to backtest server:', backtestRequest);
    
    // Forward to backtest server
    const response = await axios.post(
      'http://localhost:8083/api/backtest/run', 
      backtestRequest,
      { timeout: 10000 }
    );
    
    res.json(response.data);
    
  } catch (error) {
    console.error('Error forwarding to backtest server:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: 'Backtest server is not running. Please start it first.'
      });
    } else {
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || error.message
      });
    }
  }
});

app.post('/api/backtest/stop', async (req, res) => {
  try {
    console.log('Forwarding to backtest server STOP');
    
    // Forward to backtest server
    const response = await axios.post('http://localhost:8083/api/backtest/stop');
    
    // Notify WebSocket clients
    io.emit('backtest-cancelled');
    
    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get backtest status
app.get('/api/backtest/status', (req, res) => {
  res.json({
    isRunning: backtestState.isRunning,
    currentBacktest: backtestState.currentBacktest,
    lastResults: backtestState.lastResults
  });
});

// Stop running backtest
app.post('/api/backtest/stop', (req, res) => {
  if (!backtestState.isRunning) {
    return res.status(400).json({
      success: false,
      error: 'No backtest is running'
    });
  }
  
  // Update state
  backtestState.isRunning = false;
  if (backtestState.currentBacktest) {
    backtestState.currentBacktest.status = 'stopped';
    backtestState.currentBacktest.stoppedAt = new Date().toISOString();
  }
  
  // Notify clients
  io.emit('backtest-stopped', backtestState.currentBacktest);
  
  res.json({
    success: true,
    message: 'Backtest stopped'
  });
});

// Get backtest history
app.get('/api/backtest/history', (req, res) => {
  const { limit = 10 } = req.query;
  
  res.json({
    success: true,
    backtests: backtestState.recentBacktests.slice(0, limit)
  });
});

// ============================================================================
// NATS Monitor API
// ============================================================================

// State for NATS monitoring
let monitorState = {
  messages: [],        // Circular buffer of recent messages
  subjects: {},        // Subject statistics
  totalMessages: 0,
  startTime: Date.now(),
  maxBufferSize: 200   // Keep last 200 messages
};

// Subscribe to NATS for monitoring (add this to your startup)
async function setupNATSMonitor() {
  try {
    const nc = await connect({
      servers: config.nats.url,
      name: 'dashboard-monitor'
    });
    
    // Subscribe to all messages with wildcard
    const sub = nc.subscribe('>');
    
    (async () => {
      for await (const msg of sub) {
        processMonitorMessage(msg);
      }
    })();
    
    console.log('NATS monitor subscription setup complete');
  } catch (err) {
    console.error('Failed to setup NATS monitor:', err);
  }
}

// Process incoming NATS messages for monitoring
function processMonitorMessage(msg) {
  const now = Date.now();
  const subject = msg.subject;
  
  // Create message object
  const monitorMsg = {
    timestamp: now,
    subject: subject,
    payload: msg.data ? JSON.parse(msg.data.toString()) : null,
    size: msg.data ? msg.data.length : 0
  };
  
  // Add to buffer (circular)
  monitorState.messages.push(monitorMsg);
  if (monitorState.messages.length > monitorState.maxBufferSize) {
    monitorState.messages.shift(); // Remove oldest
  }

  // Update subject statistics
  if (!monitorState.subjects[subject]) {
    monitorState.subjects[subject] = {
      total: 0,
      lastSeen: now,
      firstSeen: now
    };
  }
  
  monitorState.subjects[subject].total++;
  monitorState.subjects[subject].lastSeen = now;
  
  // Update total count
  monitorState.totalMessages++;
}

// API endpoint for monitor polling
app.get('/api/monitor/poll', (req, res) => {
  const { since, subject: subjectFilter } = req.query;
  const sinceTime = parseInt(since) || (Date.now() - 60000); // Default to last minute
  
  // Filter messages
  let filteredMessages = monitorState.messages;
  
  if (sinceTime) {
    filteredMessages = filteredMessages.filter(m => m.timestamp > sinceTime);
  }
  
  if (subjectFilter) {
    // Support wildcard patterns
    const pattern = subjectFilter.replace(/\*/g, '.*').replace(/>/g, '.*');
    const regex = new RegExp('^' + pattern);
    filteredMessages = filteredMessages.filter(m => regex.test(m.subject));
  }
  
  // Calculate subject counts (new messages since last poll)
  const subjectCounts = {};
  const currentTime = Date.now();
  
  // Count all messages for subjects seen in this response
  const uniqueSubjects = [...new Set(filteredMessages.map(m => m.subject))];
  uniqueSubjects.forEach(subject => {
    const total = monitorState.subjects[subject]?.total || 0;
    const newCount = filteredMessages.filter(m => m.subject === subject).length;
    
    subjectCounts[subject] = {
      new: newCount,
      total: total
    };
  });
  
  // Add subjects with no new messages but have totals
  Object.entries(monitorState.subjects).forEach(([subject, stats]) => {
    if (!subjectCounts[subject] && stats.total > 0) {
      // Check if subject matches filter
      if (subjectFilter) {
        const pattern = subjectFilter.replace(/\*/g, '.*').replace(/>/g, '.*');
        const regex = new RegExp('^' + pattern);
        if (!regex.test(subject)) return;
      }
      
      subjectCounts[subject] = {
        new: 0,
        total: stats.total
      };
    }
  });
  
  // Calculate current message rate
  const timeWindow = 5000; // 5 second window
  const recentMessages = monitorState.messages.filter(m => 
    m.timestamp > currentTime - timeWindow
  );
  const rate = Math.round((recentMessages.length / timeWindow) * 1000); // messages per second
  
  res.json({
    messages: filteredMessages,
    subjects: subjectCounts,
    timestamp: currentTime,
    totalMessages: monitorState.totalMessages,
    rate: rate,
    count: filteredMessages.length
  });
});

// Clear monitor state endpoint
app.post('/api/monitor/clear', (req, res) => {
  const { type } = req.body;
  
  if (type === 'messages') {
    monitorState.messages = [];
  } else if (type === 'counts') {
    monitorState.subjects = {};
    monitorState.totalMessages = 0;
  } else {
    // Clear everything
    monitorState.messages = [];
    monitorState.subjects = {};
    monitorState.totalMessages = 0;
  }
  
  res.json({ success: true });
});

// Get monitor stats endpoint
app.get('/api/monitor/stats', (req, res) => {
  const stats = {
    totalMessages: monitorState.totalMessages,
    bufferedMessages: monitorState.messages.length,
    activeSubjects: Object.keys(monitorState.subjects).length,
    uptime: Date.now() - monitorState.startTime,
    subjects: monitorState.subjects
  };
  
  res.json(stats);
});

// Call this after NATS is initialized
// Add to your startup sequence after checkAllServices()
setupNATSMonitor();

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  setupNATSTracking();
});