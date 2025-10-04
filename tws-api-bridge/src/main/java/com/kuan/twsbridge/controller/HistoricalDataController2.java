package com.kuan.twsbridge.controller;

import com.kuan.twsbridge.service.HistoricalDataService2;
import com.kuan.twsbridge.service.MarketDataService;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/historical2")
@CrossOrigin(origins = "*")
public class HistoricalDataController2 {
    
	private static final Logger log = LoggerFactory.getLogger(HistoricalDataController2.class);
	
    private final HistoricalDataService2 historicalDataService;
    
    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd HH:mm:ss");
    
    public HistoricalDataController2(HistoricalDataService2 historicalDataService) {
        this.historicalDataService = historicalDataService;
    }
    
    /**
     * Collect historical data for SPY
     */
    @PostMapping("/spy/collect")
    public ResponseEntity<Map<String, Object>> collectSPYData(@RequestBody Map<String, String> request) {
        log.info("Received request to collect SPY historical data: {}", request);
        
        try {
            // Default values if not provided
            String endDate = request.getOrDefault("endDate", 
                LocalDateTime.now().format(DATE_FORMAT));
            String duration = request.getOrDefault("duration", "30 D");
            
            Map<String, Object> result = historicalDataService.collectSPYHistoricalData(
                endDate, duration);
            
            return ResponseEntity.ok(result);
            
        } catch (Exception e) {
            log.error("Error collecting historical data", e);
            Map<String, Object> error = new HashMap<>();
            error.put("success", false);
            error.put("error", e.getMessage());
            return ResponseEntity.status(500).body(error);
        }
    }
    
    /**
     * Collect multiple periods of historical data
     */
    @PostMapping("/spy/collect-multiple")
    public ResponseEntity<Map<String, Object>> collectMultiplePeriods(@RequestBody Map<String, Object> request) {
        log.info("Received request to collect multiple periods: {}", request);
        
        try {
            Integer months = (Integer) request.getOrDefault("months", 3);
            
            Map<String, Object> result = historicalDataService.collectMultiplePeriods("SPY", months);
            
            return ResponseEntity.ok(result);
            
        } catch (Exception e) {
            log.error("Error collecting multiple periods", e);
            Map<String, Object> error = new HashMap<>();
            error.put("success", false);
            error.put("error", e.getMessage());
            return ResponseEntity.status(500).body(error);
        }
    }
    
    /**
     * Get collection statistics
     */
    @GetMapping("/spy/stats")
    public ResponseEntity<Map<String, Object>> getStats() {
        try {
            Map<String, Object> stats = historicalDataService.getCollectionStats("SPY");
            return ResponseEntity.ok(stats);
        } catch (Exception e) {
            log.error("Error getting stats", e);
            Map<String, Object> error = new HashMap<>();
            error.put("success", false);
            error.put("error", e.getMessage());
            return ResponseEntity.status(500).body(error);
        }
    }
    
    /**
     * Find gaps in the data
     */
    @PostMapping("/spy/gaps")
    public ResponseEntity<Map<String, Object>> findGaps(@RequestBody Map<String, String> request) {
        try {
            String startDateStr = request.get("startDate");
            String endDateStr = request.get("endDate");
            
            LocalDateTime startDate = LocalDateTime.parse(startDateStr, DATE_FORMAT);
            LocalDateTime endDate = LocalDateTime.parse(endDateStr, DATE_FORMAT);
            
            List<Map<String, Object>> gaps = historicalDataService.findDataGaps(
                "SPY", startDate, endDate);
            
            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("gapCount", gaps.size());
            result.put("gaps", gaps.size() > 100 ? gaps.subList(0, 100) : gaps); // Limit response size
            
            return ResponseEntity.ok(result);
            
        } catch (Exception e) {
            log.error("Error finding gaps", e);
            Map<String, Object> error = new HashMap<>();
            error.put("success", false);
            error.put("error", e.getMessage());
            return ResponseEntity.status(500).body(error);
        }
    }
    
    /**
     * Automated collection - collect last N months
     */
    @PostMapping("/spy/auto-collect")
    public ResponseEntity<Map<String, Object>> autoCollect(@RequestBody Map<String, Object> request) {
        log.info("Starting automated collection: {}", request);
        
        try {
            Integer months = (Integer) request.getOrDefault("months", 3);
            Boolean fillGaps = (Boolean) request.getOrDefault("fillGaps", true);
            
            // Start collection in background
            new Thread(() -> {
                try {
                    historicalDataService.collectMultiplePeriods("SPY", months);
                    log.info("Automated collection completed for {} months", months);
                } catch (Exception e) {
                    log.error("Error in automated collection", e);
                }
            }).start();
            
            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("message", "Collection started in background");
            result.put("months", months);
            result.put("estimatedTime", (months * 11) + " seconds");
            
            return ResponseEntity.ok(result);
            
        } catch (Exception e) {
            log.error("Error starting automated collection", e);
            Map<String, Object> error = new HashMap<>();
            error.put("success", false);
            error.put("error", e.getMessage());
            return ResponseEntity.status(500).body(error);
        }
    }
}
