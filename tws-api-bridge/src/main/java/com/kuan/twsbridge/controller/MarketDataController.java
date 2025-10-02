package com.kuan.twsbridge.controller;

import com.kuan.twsbridge.service.IBConnectionManager;
import com.kuan.twsbridge.service.MarketDataService;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/marketdata")
@CrossOrigin(origins = "*")
public class MarketDataController {
    
	private static final Logger log = LoggerFactory.getLogger(MarketDataController.class);
	
    private final MarketDataService marketDataService;
    
    public MarketDataController(MarketDataService marketDataService) {
        this.marketDataService = marketDataService;
    }
    
    /**
     * Subscribe to SPY 1-minute real-time bars
     */
    @PostMapping("/spy/subscribe")
    public ResponseEntity<Map<String, Object>> subscribeSPY() {
        log.info("Received request to subscribe to SPY 1-minute bars");
        
        try {
            boolean success = marketDataService.subscribeSPYBars1Min();
            
            Map<String, Object> response = new HashMap<>();
            response.put("success", success);
            response.put("symbol", "SPY");
            response.put("barSize", "1 min");
            response.put("status", success ? "subscribed" : "failed");
            response.put("timestamp", System.currentTimeMillis());
            
            if (success) {
                response.put("message", "Successfully subscribed to SPY 1-minute bars");
                log.info("SPY subscription successful");
            } else {
                response.put("message", "Failed to subscribe - check connection and market hours");
                log.warn("SPY subscription failed");
            }
            
            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            log.error("Error subscribing to SPY bars", e);
            
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("success", false);
            errorResponse.put("error", e.getMessage());
            errorResponse.put("timestamp", System.currentTimeMillis());
            
            return ResponseEntity.status(500).body(errorResponse);
        }
    }
    
    /**
     * Unsubscribe from SPY 1-minute real-time bars
     */
    @PostMapping("/spy/unsubscribe")
    public ResponseEntity<Map<String, Object>> unsubscribeSPY() {
        log.info("Received request to unsubscribe from SPY 1-minute bars");
        
        try {
            boolean success = marketDataService.unsubscribeSPYBars();
            
            Map<String, Object> response = new HashMap<>();
            response.put("success", success);
            response.put("symbol", "SPY");
            response.put("status", success ? "unsubscribed" : "not_subscribed");
            response.put("timestamp", System.currentTimeMillis());
            
            if (success) {
                response.put("message", "Successfully unsubscribed from SPY 1-minute bars");
                log.info("SPY unsubscription successful");
            } else {
                response.put("message", "Was not subscribed to SPY bars");
                log.info("SPY was not subscribed");
            }
            
            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            log.error("Error unsubscribing from SPY bars", e);
            
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("success", false);
            errorResponse.put("error", e.getMessage());
            errorResponse.put("timestamp", System.currentTimeMillis());
            
            return ResponseEntity.status(500).body(errorResponse);
        }
    }
}
