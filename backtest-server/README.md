# Historical Publisher Service

Node.js microservice that replays historical SPY market data from TimescaleDB to NATS for backtesting.

## Features

- ✅ Streams SPY 1-minute bars from TimescaleDB
- ✅ Publishes to NATS subject: `md.equity.spy.bars.1m.replay`
- ✅ Variable replay speeds (1x, 10x, 60x, max)
- ✅ REST API for control
- ✅ Pause/Resume capability
- ✅ Real-time progress tracking
- ✅ Memory-efficient streaming with pg-cursor

## Quick Start

### 1. Setup

```bash
# Create directory
mkdir historical-publisher
cd historical-publisher

# Copy files
# - index.js
# - package.json
# - .env.example

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials
```

### 2. Run

```bash
# Development
npm run dev

npm start 

# Production
npm start

# With PM2
npm run pm2:start
```

## API Endpoints

### Start Replay
```bash
curl -X POST http://localhost:8083/api/replay/start \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2024-01-01",
    "endDate": "2024-01-31",
    "speed": 10
  }'

Invoke-RestMethod -Uri http://localhost:8083/api/replay/start -Method POST -Body '{"startDate":"2025-01-01", "endDate": "2025-01-15", "speed": 10}' -ContentType 'application/json'

```

### Get Status
```bash
curl http://localhost:8083/api/replay/status
```

### Stop Replay
```bash
curl -X POST http://localhost:8083/api/replay/stop
```

### Pause/Resume
```bash
curl -X POST http://localhost:8083/api/replay/pause
```

### Update Speed
```bash
curl -X POST http://localhost:8083/api/replay/speed \
  -H "Content-Type: application/json" \
  -d '{"speed": 20}'
```

### Get Available Date Range
```bash
curl http://localhost:8083/api/data/range
```

## NATS Message Format

Published to subject: `md.equity.spy.bars.1m.replay`

```json
{
  "symbol": "SPY",
  "time": "2024-01-15T09:30:00.000Z",
  "timestamp": 1705318200000,
  "open": 470.25,
  "high": 470.50,
  "low": 470.10,
  "close": 470.45,
  "volume": 1250000,
  "vwap": 470.35,
  "count": 523,
  "replay": true,
  "replaySpeed": 10,
  "progress": 45.5
}
```

## Speed Settings

- `0` or `max` = Maximum speed (no delay)
- `1` = Real-time (1 minute = 1 minute)
- `10` = 10x speed (1 minute = 6 seconds)
- `60` = 60x speed (1 minute = 1 second)
- `3600` = 3600x speed (1 minute = 16ms)

## Integration with Dashboard

Update your main `index.js` to proxy requests:

```javascript
// Proxy to historical publisher
app.post('/api/backtest/replay/start', async (req, res) => {
  try {
    const response = await axios.post('http://localhost:8083/api/replay/start', req.body);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/backtest/replay/status', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:8083/api/replay/status');
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

## Docker Deployment

```bash
# Build image
docker build -t historical-publisher .

# Run container
docker run -d \
  --name historical-publisher \
  --network host \
  -e DATABASE_URL=postgresql://postgres:postgres@localhost:5432/stocks \
  -e NATS_URL=nats://localhost:4222 \
  -p 8083:8083 \
  historical-publisher
```

## PM2 Deployment

```bash
# Start with PM2
pm2 start ecosystem.config.js

# View logs
pm2 logs historical-publisher

# Monitor
pm2 monit

# Stop
pm2 stop historical-publisher

# Restart
pm2 restart historical-publisher
```

## Performance Considerations

- Uses `pg-cursor` for streaming large datasets
- Processes bars in batches of 100
- Caps delay at 1 second for better UX
- Efficiently handles millions of bars

## Troubleshooting

### Cannot connect to database
```bash
# Test connection
psql postgresql://postgres:postgres@localhost:5432/stocks -c "SELECT COUNT(*) FROM spy_bars_1min;"
```

### Cannot connect to NATS
```bash
# Check NATS is running
nats-server -V

# Test pub/sub
nats sub "md.equity.spy.bars.1m.replay"
```

### No data in date range
```bash
# Check available data
curl http://localhost:8083/api/data/range
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 8083 | HTTP server port |
| DATABASE_URL | postgresql://postgres:postgres@localhost:5432/stocks | TimescaleDB connection |
| NATS_URL | nats://localhost:4222 | NATS server URL |
| DEBUG | false | Enable debug logging |

## Next Steps

1. Create a Strategy Engine that subscribes to the replay data
2. Build an Execution Simulator for paper trading
3. Add Performance Tracker for metrics
4. Implement backtesting results storage

## License

MIT