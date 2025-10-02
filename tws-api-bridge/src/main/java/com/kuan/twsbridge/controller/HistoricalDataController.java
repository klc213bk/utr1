package com.kuan.twsbridge.controller;

import com.kuan.twsbridge.service.DataCoverageService;
import com.kuan.twsbridge.service.HistoricalDataService;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/historical")
@CrossOrigin(origins = "*")
public class HistoricalDataController {
    
	private static final Logger log = LoggerFactory.getLogger(HistoricalDataController.class);
	
    private final HistoricalDataService historicalDataService;
    
    public HistoricalDataController(HistoricalDataService historicalDataService) {
        this.historicalDataService = historicalDataService;
    }
    
    /**
     * Collect historical data for SPY
     */
    @PostMapping("/spy/collect")
    public ResponseEntity<Map<String, Object>> collectSPYData(@RequestBody Map<String, String> request) {
    	log.info("Received request to collect SPY historical data: {}", request);
        
        try {
            String startDateStr = request.get("startDate");
            String endDateStr = request.get("endDate");
            
            if (startDateStr == null || endDateStr == null) {
                Map<String, Object> error = new HashMap<>();
                error.put("success", false);
                error.put("error", "Start date and end date are required");
                return ResponseEntity.badRequest().body(error);
            }
            
            // Parse dates
            LocalDate startDate = LocalDate.parse(startDateStr);
            LocalDate endDate = LocalDate.parse(endDateStr);
            
            log.info("startDate:" + startDate + ", endDate:" + endDate);
            
            // Validate date range
            long days = java.time.temporal.ChronoUnit.DAYS.between(startDate, endDate) + 1;
            if (days > 30) {
                Map<String, Object> error = new HashMap<>();
                error.put("success", false);
                error.put("error", "Maximum 30 days allowed per request. You requested " + days + " days.");
                return ResponseEntity.badRequest().body(error);
            }
            
            if (endDate.isAfter(LocalDate.now())) {
                Map<String, Object> error = new HashMap<>();
                error.put("success", false);
                error.put("error", "End date cannot be in the future");
                return ResponseEntity.badRequest().body(error);
            }
            
            // Call service
            Map<String, Object> result = historicalDataService.collectHistoricalDataForDateRange(
                startDate, endDate);
            
            log.info("newBars:", result.get("newBars") + ", duplicates:" + result.get("duplicates"));
            
            
            // Add date range to response
            Map<String, String> dateRange = new HashMap<>();
            dateRange.put("start", startDateStr);
            dateRange.put("end", endDateStr);
            result.put("dateRange", dateRange);
            
            if ((Boolean) result.get("success")) {
                return ResponseEntity.ok(result);
            } else {
                return ResponseEntity.status(500).body(result);
            }
            
        } catch (Exception e) {
            log.error("Error collecting historical data", e);
            Map<String, Object> error = new HashMap<>();
            error.put("success", false);
            error.put("error", e.getMessage());
            return ResponseEntity.status(500).body(error);
        }
    }
    
    @GetMapping("/spy/latest")
    public ResponseEntity<Map<String, Object>> getLatestBar() {
        try {
            String latestBar = historicalDataService.getLatestBarTime();
            
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("latestBar", latestBar != null ? latestBar : "No data collected yet");
            response.put("hasData", latestBar != null);
            
            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            log.error("Error getting latest bar", e);
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
}
