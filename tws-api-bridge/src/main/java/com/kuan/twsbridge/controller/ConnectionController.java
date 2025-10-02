package com.kuan.twsbridge.controller;

import com.kuan.twsbridge.dto.ConnectionStatus;
import com.kuan.twsbridge.service.IBConnectionManager;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/connection")
@CrossOrigin(origins = "*") // Configure appropriately for production
public class ConnectionController {
    
	private static final Logger log = LoggerFactory.getLogger(ConnectionController.class);
	
    private final IBConnectionManager connectionManager;
    
    public ConnectionController(IBConnectionManager connectionManager) {
        this.connectionManager = connectionManager;
        log.info("ConnectionController created with IBConnectionManager instance: {}", 
                connectionManager.hashCode());
    }
    
    /**
     * Check if connected to TWS/IB Gateway
     */
    @GetMapping("/status")
    public ResponseEntity<ConnectionStatus> getConnectionStatus() {
        ConnectionStatus status = new ConnectionStatus();
        status.setConnected(connectionManager.getConnected().get());
        status.setNextOrderId(connectionManager.getNextOrderId().get());
        status.setTimestamp(System.currentTimeMillis());
        
     // ADD THIS LOG to verify same instance:
        log.debug("Connection status check - IBConnectionManager instance: {}, connected: {}", 
                  connectionManager.hashCode(), connectionManager.getConnected().get());
        
        return ResponseEntity.ok(status);
    }
    
    /**
     * Connect to TWS/IB Gateway
     */
    @PostMapping("/connect")
    public ResponseEntity<ConnectionStatus> connect() {
        log.info("Connect request received");
        
        boolean success = connectionManager.connect();
        
        ConnectionStatus status = new ConnectionStatus();
        status.setConnected(success);
        status.setNextOrderId(connectionManager.getNextOrderId().get());
        status.setTimestamp(System.currentTimeMillis());
        status.setMessage(success ? "Successfully connected to TWS/IB Gateway" : "Failed to connect");
        
        return ResponseEntity.ok(status);
    }
    
    /**
     * Disconnect from TWS/IB Gateway
     */
    @PostMapping("/disconnect")
    public ResponseEntity<ConnectionStatus> disconnect() {
        log.info("Disconnect request received");
        
        connectionManager.disconnect();
        
        ConnectionStatus status = new ConnectionStatus();
        status.setConnected(false);
        status.setNextOrderId(-1);
        status.setTimestamp(System.currentTimeMillis());
        status.setMessage("Disconnected from TWS/IB Gateway");
        
        return ResponseEntity.ok(status);
    }
    
    /**
     * Health check endpoint
     */
    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("OK");
    }
}
