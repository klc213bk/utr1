# TWS API Bridge - Spring Boot REST Service

A minimal Spring Boot application that provides a RESTful interface to Interactive Brokers TWS API.

## Prerequisites

1. **Java 17 or higher**
2. **Maven 3.6+**
3. **TWS or IB Gateway** installed and running
4. **IB Account** (paper trading account recommended for testing)

## Setup Instructions

### 1. Download and Install TWS API

1. Download TWS API from [Interactive Brokers](https://interactivebrokers.github.io/tws-api/)
2. Extract the downloaded file
3. Locate `TwsApi.jar` in the `source/JavaClient` folder
4. Install it to your local Maven repository:

```bash
mvn install:install-file \
  -Dfile=path/to/TwsApi.jar \
  -DgroupId=com.interactivebrokers \
  -DartifactId=tws-api \
  -Dversion=10.19.02 \
  -Dpackaging=jar
```

### 2. Configure TWS/IB Gateway

#### For TWS:
1. Open TWS
2. Go to **File → Global Configuration → API → Settings**
3. Enable "Enable ActiveX and Socket Clients"
4. Uncheck "Read-Only API" if you need trading capabilities
5. Add `127.0.0.1` to "Trusted IPs" (or leave "Allow connections from localhost only" checked)
6. Note the port number (default: 7497 for paper, 7496 for live)

#### For IB Gateway:
1. Open IB Gateway
2. Go to **Configure → Settings → API → Settings**
3. Same settings as TWS
4. Port: 4002 for paper, 4001 for live

### 3. Project Structure

```
tws-api-bridge/
├── src/main/java/com/example/twsbridge/
│   ├── TwsBridgeApplication.java          # Main Spring Boot application
│   ├── controller/
│   │   └── ConnectionController.java      # REST endpoints
│   ├── service/
│   │   └── IBConnectionManager.java       # IB API connection management
│   └── dto/
│       └── ConnectionStatus.java          # Data transfer objects
├── src/main/resources/
│   └── application.yml                    # Configuration
└── pom.xml                                # Maven dependencies

```

### 4. Build and Run

```bash
# Clone or create the project structure
mkdir tws-api-bridge
cd tws-api-bridge

# Create the files as shown above

# Build the project
mvn clean package

# Run the application
mvn spring-boot:run

# Or run the JAR directly
java -jar target/tws-api-bridge-0.0.1-SNAPSHOT.jar
```

### 5. Configuration Options

Edit `application.yml` to change connection settings:

```yaml
ib:
  host: 127.0.0.1     # TWS/Gateway host
  port: 7497          # TWS/Gateway port
  clientId: 0         # Client ID (use different IDs for multiple connections)
```

You can also override via command line:

```bash
java -jar target/tws-api-bridge-0.0.1-SNAPSHOT.jar \
  --ib.host=192.168.1.100 \
  --ib.port=4002
```

## API Endpoints

### Subscribe Data
```bash
POST /api/marketdata/spy/subscribe - Subscribe to SPY 1-minute bars

powershell -Command "Invoke-RestMethod -Uri http://localhost:8081/api/marketdata/spy/subscribe -Method POST -Body '{}' -ContentType 'application/json'"

powershell -Command "Invoke-RestMethod -Uri http://localhost:8081/api/marketdata/spy/unsubscribe -Method POST -Body '{}' -ContentType 'application/json'"

```


### Check Connection Status
```bash
GET http://localhost:8081/api/connection/status

powershell -Command "Invoke-RestMethod -Uri http://localhost:8081/api/connection/status -Method GET

Response:
{
  "connected": true,
  "nextOrderId": 1234,
  "timestamp": 1705332145000,
  "message": null
}
```

### Connect to TWS/IB Gateway
```bash
POST http://localhost:8081/api/connection/connect

powershell -Command "Invoke-RestMethod -Uri http://localhost:8081/api/connection/connect -Method POST -Body '{}' -ContentType 'application/json'"

Invoke-RestMethod -Uri http://localhost:8081/api/connection/connect -Method POST -Body '{}' -ContentType 'application/json'

Response:
{
  "connected": true,
  "nextOrderId": 1234,
  "timestamp": 1705332145000,
  "message": "Successfully connected to TWS/IB Gateway"
}

Invoke-RestMethod -Uri http://localhost:8081/api/historical/spy/collect -Method POST -Body '{"startDate": "2025-01-01", "endDate": "2025-01-15"}' -ContentType 'application/json'

```

### Disconnect from TWS/IB Gateway
```bash
POST http://localhost:8081/api/connection/disconnect

powershell -Command "Invoke-RestMethod -Uri http://localhost:8081/api/connection/disconnect -Method POST -Body '{}' -ContentType 'application/json'"

Response:
{
  "connected": false,
  "nextOrderId": -1,
  "timestamp": 1705332145000,
  "message": "Disconnected from TWS/IB Gateway"
}
```

### Health Check
```bash
GET http://localhost:8081/api/connection/health

powershell -Command "Invoke-RestMethod -Uri http://localhost:8081/api/connection/health -Method GET

Response: OK
```


### Command line NATS Consumer client
```powershell

.\nats.exe sub md.equity.spy.bars.1m

```


### Swagger UI (Optional)
Access API documentation at: `http://localhost:8081/swagger-ui.html`

## Testing with cURL

```bash
# Check status
curl http://localhost:8081/api/connection/status

# Connect
curl -X POST http://localhost:8081/api/connection/connect

# Disconnect  
curl -X POST http://localhost:8081/api/connection/disconnect
```

## Testing with Node.js

```javascript
// Simple Node.js test
const axios = require('axios');

async function testConnection() {
    try {
        // Connect to TWS
        const connectRes = await axios.post('http://localhost:8081/api/connection/connect');
        console.log('Connect:', connectRes.data);
        
        // Check status
        const statusRes = await axios.get('http://localhost:8081/api/connection/status');
        console.log('Status:', statusRes.data);
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testConnection();
```

## Common Issues and Solutions

### Issue: Cannot connect to TWS
- **Solution**: Ensure TWS/IB Gateway is running and API is enabled
- Check the port number matches your configuration
- Verify "Trusted IPs" includes your connection source

### Issue: "Not connected" error
- **Solution**: Wait a few seconds after starting TWS before connecting
- Check TWS logs for any error messages
- Ensure no other application is using the same client ID

### Issue: TwsApi.jar not found
- **Solution**: Make sure you've installed the JAR to your local Maven repository
- Verify the version number in pom.xml matches your installation

### Issue: Connection drops frequently
- **Solution**: TWS/IB Gateway disconnects daily around 11:45 PM - 12:45 AM ET
- Implement reconnection logic for production use

## Next Steps - Extending the Bridge

### 1. Add Market Data Endpoints
```java
@GetMapping("/market-data/{symbol}")
public ResponseEntity<MarketData> getMarketData(@PathVariable String symbol) {
    // Request market data for symbol
}
```

### 2. Add Order Management
```java
@PostMapping("/orders")
public ResponseEntity<OrderResponse> placeOrder(@RequestBody OrderRequest order) {
    // Place order logic
}
```

### 3. Add Account Information
```java
@GetMapping("/account/summary")
public ResponseEntity<AccountSummary> getAccountSummary() {
    // Get account information
}
```

### 4. Add WebSocket Support for Real-time Data
```java
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
    // Configure WebSocket for real-time market data
}
```

### 5. Add Service Monitoring for Your Dashboard

Integrate this bridge with your Node.js dashboard:

```javascript
// Node.js Dashboard Integration
const express = require('express');
const axios = require('axios');

const app = express();

// Check IB Connection Status
app.get('/api/services/ib/status', async (req, res) => {
    try {
        const response = await axios.get('http://localhost:8081/api/connection/status');
        res.json({
            name: 'IB Connection',
            status: response.data.connected ? 'running' : 'stopped',
            details: response.data
        });
    } catch (error) {
        res.json({
            name: 'IB Connection',
            status: 'error',
            error: error.message
        });
    }
});

// Start/Stop IB Connection
app.post('/api/services/ib/:action', async (req, res) => {
    const action = req.params.action;
    const endpoint = action === 'start' ? 'connect' : 'disconnect';
    
    try {
        const response = await axios.post(`http://localhost:8081/api/connection/${endpoint}`);
        res.json({
            success: true,
            data: response.data
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});
```

## Production Considerations

1. **Security**
   - Add authentication (Spring Security with JWT)
   - Use HTTPS in production
   - Restrict CORS origins
   - Implement rate limiting

2. **Reliability**
   - Add automatic reconnection logic
   - Implement circuit breaker pattern
   - Add comprehensive error handling
   - Use connection pooling for multiple accounts

3. **Monitoring**
   - Add Spring Boot Actuator for health metrics
   - Implement logging with proper log levels
   - Add performance monitoring
   - Set up alerts for disconnections

4. **Deployment**
   - Dockerize the application
   - Use environment variables for sensitive config
   - Implement graceful shutdown
   - Consider using Spring Cloud Config for configuration management

## Docker Deployment (Optional)

Create a `Dockerfile`:

```dockerfile
FROM openjdk:17-jdk-slim
VOLUME /tmp
COPY target/tws-api-bridge-0.0.1-SNAPSHOT.jar app.jar
ENTRYPOINT ["java","-jar","/app.jar"]
```

Build and run:

```bash
# Build Docker image
docker build -t tws-bridge .

# Run container
docker run -p 8081:8081 \
  -e IB_HOST=host.docker.internal \
  -e IB_PORT=7497 \
  tws-bridge
```

## License

This is a minimal implementation for demonstration purposes. Ensure you comply with Interactive Brokers' terms of service when using their API.

## Support

For issues related to:
- **IB API**: Check [IB API Documentation](https://interactivebrokers.github.io/tws-api/)
- **Spring Boot**: See [Spring Boot Documentation](https://spring.io/projects/spring-boot)
- **This Bridge**: Please create an issue in your repository