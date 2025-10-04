# Service Dashboard

A simple real-time service monitoring dashboard for IB Connection, NATS Server, and PostgreSQL.

## 🚀 Quick Start

### Prerequisites

- Node.js (v16+)
- npm or yarn
- Running services:
  - IB Bridge (Spring Boot) on port 8080
  - NATS Server on port 4222
  - PostgreSQL on port 5432

### Backend Setup

```bash
cd backend
npm install

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your service configurations

# Start the backend server
npm run dev
```

The backend will run on http://localhost:3000

### Frontend Setup

```bash
cd frontend
npm install

# Start the Vue development server
npm run dev
```

The frontend will run on http://localhost:5173

## 📁 Project Structure

```
service-dashboard/
├── backend/
│   ├── index.js          # Express server with Socket.io
│   ├── package.json      # Backend dependencies
│   └── .env             # Environment configuration
│
├── frontend/
│   ├── src/
│   │   ├── App.vue      # Main app component
│   │   ├── components/  # Vue components
│   │   │   ├── ServiceCard.vue
│   │   │   ├── StatusIndicator.vue
│   │   │   └── ToggleSwitch.vue
│   │   ├── stores/      # Pinia stores
│   │   └── style.scss   # Global styles
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
└── ib-bridge/           # Your existing Spring Boot IB Bridge
```

## 🎯 Features

- **Real-time Monitoring**: WebSocket connection for live updates
- **Service Status**: Visual indicators for service health
- **Control Panel**: Start/Stop IB connection (NATS and PostgreSQL require manual control)
- **Auto-refresh**: Services checked every 10 seconds
- **Responsive Design**: Works on desktop and mobile

## 🔧 Configuration

### Backend Environment Variables (.env)

```bash
# Server Port
PORT=3000

# IB Bridge Configuration
IB_BRIDGE_URL=http://localhost:8081

# NATS Configuration
NATS_URL=nats://localhost:4222

# PostgreSQL Configuration
POSTGRES_URL=postgresql://username:password@localhost:5432/database
```

## 🎨 Dashboard Interface

The dashboard displays three service cards:

1. **IB Connection** 
   - Shows connection status
   - Displays next order ID when connected
   - Toggle switch to connect/disconnect

2. **NATS Server**
   - Shows server status
   - Displays server endpoint when connected
   - Manual control only (shows as disabled switch)

3. **PostgreSQL**
   - Shows database status  
   - Displays database name when connected
   - Manual control only (shows as disabled switch)

## 📡 API Endpoints

### REST API

- `GET /api/services` - Get all service statuses
- `GET /api/services/:id` - Get specific service status
- `POST /api/services/:id/:action` - Control service (start/stop)

### WebSocket Events

- `connect` - Client connected
- `services-update` - Service status update
- `service-control` - Control action result
- `refresh` - Manual refresh request

## 🚦 Service Status Types

- **Online** (Green) - Service is running and responsive
- **Offline** (Red) - Service is not running or not responding
- **Error** (Yellow) - Service encountered an error
- **Unknown** (Gray) - Initial state or unable to determine

## 📝 Notes

### IB Connection Control
- The IB connection can be controlled via the dashboard
- Uses the Spring Boot bridge API endpoints
- Make sure TWS/IB Gateway is running before connecting

### NATS & PostgreSQL Control
- Currently require manual management
- The dashboard shows their status but cannot start/stop them
- To implement control, you would need to:
  - Use system commands (systemctl, docker)
  - Or implement process management (PM2)
  - Or use container orchestration

## 🔨 Development

### Adding New Services

1. Add service configuration in `backend/index.js`:
```javascript
services.newService = {
  id: 'newService',
  name: 'New Service',
  status: 'unknown',
  details: null,
  lastCheck: null
}
```

2. Implement health check function
3. Implement control function (if applicable)

### Customizing Styles

The frontend uses SCSS for styling. Main theme colors are defined in component styles and can be customized in:
- `src/style.scss` - Global styles
- Component `<style>` sections - Component-specific styles

## 🐛 Troubleshooting

### Backend won't connect to services
- Check if all services are running on correct ports
- Verify environment variables in .env
- Check firewall settings

### Frontend shows disconnected
- Ensure backend is running on port 3000
- Check browser console for WebSocket errors
- Verify CORS settings if running on different ports

### IB Connection toggle not working
- Ensure IB Bridge Spring Boot app is running
- Check IB Bridge logs for connection issues
- Verify TWS/IB Gateway API is enabled

## 📄 License

MIT