package com.kuan.twsbridge.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ib.client.*;
import com.kuan.twsbridge.controller.HistoricalDataController;
import com.kuan.twsbridge.repository.BarDataRepository;
import com.kuan.twsbridge.repository.CollectionRunRepository;
import com.kuan.twsbridge.repository.DailySummaryRepository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.stereotype.Service;

import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Time;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import java.util.concurrent.atomic.AtomicBoolean;

import java.sql.ResultSet;
import java.sql.Types;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.context.event.EventListener;
import com.kuan.twsbridge.event.*;

@Service
@Transactional
public class HistoricalDataService {
    
	private static final Logger log = LoggerFactory.getLogger(HistoricalDataService.class);
	
	@Autowired
    private IBConnectionManager connectionManager;
    
	@Autowired
    private JdbcTemplate jdbcTemplate;
    
    private final ObjectMapper objectMapper = new ObjectMapper();
    
    private final AtomicInteger requestId = new AtomicInteger(2000);
    private final Map<Integer, HistoricalDataRequest> activeRequests = new ConcurrentHashMap<>();
    private final Map<Integer, List<Bar>> collectedBars = new ConcurrentHashMap<>();
    private final Map<Integer, CountDownLatch> requestLatches = new ConcurrentHashMap<>();
    
    // IB Rate limiting
    private final Semaphore rateLimiter = new Semaphore(1);
    private long lastRequestTime = 0;
    private static final long MIN_REQUEST_INTERVAL = 10000; // 10 seconds between requests
    
    // Date formatter for IB API
    private static final DateTimeFormatter IB_DATE_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd HH:mm:ss");
    
    // ADD new field for tracking collection run
//    private final Map<Integer, Long> requestToCollectionRun = new ConcurrentHashMap<>();

    @Autowired
    public HistoricalDataService(IBConnectionManager connectionManager,JdbcTemplate jdbcTemplate,
    		CollectionRunRepository runRepository,
    		BarDataRepository barRepository) {
    	this.connectionManager = connectionManager;
    	this.jdbcTemplate = jdbcTemplate;
    	log.info("HistoricalDataService created with IBConnectionManager instance: {}", 
                connectionManager.hashCode());
    }
    
    @Scheduled(fixedDelay = 300000) // Every 5 minutes
    public void cleanupStaleRequests() {
        long staleThreshold = System.currentTimeMillis() - 300000; // 5 minutes
        activeRequests.entrySet().removeIf(entry -> {
            HistoricalDataRequest request = entry.getValue();
            return request.requestTime.isBefore(
                LocalDateTime.ofInstant(Instant.ofEpochMilli(staleThreshold), 
                ZoneId.systemDefault()));
        });
    }
    
    // ADD: Event listeners instead of being called directly
    @EventListener
    public void handleHistoricalDataEvent(HistoricalDataEvent event) {
        onHistoricalData(event.getReqId(), event.getBar());
    }
    
    @EventListener
    public void handleHistoricalDataEndEvent(HistoricalDataEndEvent event) {
        onHistoricalDataEnd(event.getReqId(), event.getStartDate(), event.getEndDate());
    }
    
    @EventListener
    public void handleHistoricalDataErrorEvent(HistoricalDataErrorEvent event) {
        onHistoricalDataError(event.getReqId(), event.getErrorCode(), event.getErrorMsg());
    }
    
    /**
     * Request object to track historical data requests
     */
    private static class HistoricalDataRequest {
        String symbol;
        String endDateTime;
        String duration;
        String barSize;
        LocalDateTime requestTime;
        String status;
        int barCount;
        
        HistoricalDataRequest(String symbol, String endDateTime, String duration, String barSize) {
            this.symbol = symbol;
            this.endDateTime = endDateTime;
            this.duration = duration;
            this.barSize = barSize;
            this.requestTime = LocalDateTime.now();
            this.status = "PENDING";
            this.barCount = 0;
        }
    }
    
    /**
     * Collect historical data for SPY
     * @param endDate End date in format "yyyyMMdd HH:mm:ss"
     * @param duration Duration string like "30 D", "1 M", "1 Y"
     * @return Collection status
     */
    public Map<String, Object> collectSPYHistoricalData(String endDate, String duration) {
        return collectHistoricalData("SPY", endDate, duration, "1 min");
    }
    
    /**
     * SIMPLIFIED: Collect historical data for date range
     * Dates come as date-only, we add market hours
     */
    @Transactional
    public Map<String, Object> collectHistoricalDataForDateRange(LocalDate startDate, LocalDate endDate) {
        // Add market hours
        String endDateTime = endDate.atTime(16, 0, 0).format(IB_DATE_FORMAT) + " US/Eastern";
        
        // Calculate duration in days
        long days = java.time.temporal.ChronoUnit.DAYS.between(startDate, endDate) + 1;
        if (days > 30) {
            Map<String, Object> error = new HashMap<>();
            error.put("success", false);
            error.put("error", "Maximum 30 days allowed per request");
            return error;
        }
        
        String duration = days + " D";
        
        // Call existing method
        return collectHistoricalData("SPY", endDateTime, duration, "1 min");
    }
    
    /**
     * Collect historical data for any symbol
     */
    @Transactional
    public Map<String, Object> collectHistoricalData(String symbol, String endDate, String duration, String barSize) {
    	Map<String, Object> result = new HashMap<>();
        
        log.info("Starting historical data collection - Symbol: {}, EndDate: {}, Duration: {}", 
                 symbol, endDate, duration);
        
        // Check IB connection
        if (!connectionManager.getConnected().get()) {
            log.error("IB is not connected");
            result.put("success", false);
            result.put("error", "IB not connected");
            return result;
        }
        
        long startTime = System.currentTimeMillis();
        
        try {
            // PHASE 1: COMMENT OUT - Collection run tracking
            /*
            Long collectionRunId = null;
            try {
                collectionRunId = createCollectionRun(symbol, endDate, duration, barSize);
                log.info("Created collection run with ID: {}", collectionRunId);
            } catch (Exception e) {
                log.warn("Could not create collection run record: {}", e.getMessage());
            }
            */
            
            // Apply rate limiting - KEEP THIS
            enforceRateLimit();
            
            // Create contract - KEEP THIS
            Contract contract = new Contract();
            contract.symbol(symbol);
            contract.secType("STK");
            contract.currency("USD");
            contract.exchange("SMART");
            contract.primaryExch("ARCA");
            
            // Generate request ID - KEEP THIS (different range from MarketDataService)
            int reqId = requestId.incrementAndGet();
            log.info("Generated request ID: {} (Historical collection)", reqId);
            
            // Create request tracking - KEEP THIS
            HistoricalDataRequest request = new HistoricalDataRequest(symbol, endDate, duration, barSize);
            activeRequests.put(reqId, request);
            
            List<Bar> barsList = new ArrayList<>();
            collectedBars.put(reqId, barsList);
            
            // PHASE 1: COMMENT OUT
            /*
            if (collectionRunId != null) {
                requestToCollectionRun.put(reqId, collectionRunId);
            }
            */
            
            // Create latch to wait for completion - KEEP THIS
            CountDownLatch latch = new CountDownLatch(1);
            requestLatches.put(reqId, latch);
            
            log.info("Requesting historical data from IB - ReqId: {}", reqId);
            
            // Add timezone if not present
            String endDateTime = endDate;
            if (!endDate.contains("US/Eastern") && !endDate.contains("EST") && !endDate.contains("EDT")) {
                endDateTime = endDate + " US/Eastern";
            }
            
            // Request historical data - KEEP THIS
            connectionManager.getClient().reqHistoricalData(
                reqId,
                contract,
                endDateTime,
                duration,
                barSize,
                "TRADES",
                1,  // useRTH: 1 = Regular Trading Hours only
                1,  // formatDate: 1 = yyyyMMdd HH:mm:ss
                false,  // keepUpToDate: false for historical collection
                null
            );
            
            // Wait for data with 35-second timeout
            boolean completed = latch.await(35, TimeUnit.SECONDS);
            
            if (completed) {
                List<Bar> bars = collectedBars.get(reqId);
                request.status = "COMPLETED";
                request.barCount = bars != null ? bars.size() : 0;
                
                log.info("Data collection completed - {} bars received", request.barCount);
                
                // SIMPLIFIED: Save to database with transaction
                SaveResult saveResult = saveBarsToDatabase(symbol, bars);
                log.info("newBars:", saveResult.saved + ", duplicates:" + saveResult.duplicates);
                
                // PHASE 1: COMMENT OUT - Collection run update
                /*
                if (collectionRunId != null) {
                    updateCollectionRunSuccess(collectionRunId, request.barCount, saveResult.saved);
                }
                */
                
                // PHASE 1: COMMENT OUT - Daily summary updates
                /*
                updateDailySummaries(bars);
                */
                
                // Query latest bar for response
                String latestBar = getLatestBarTime();
                
                long duration_ms = System.currentTimeMillis() - startTime;
                
                // Build response
                result.put("success", true);
                result.put("barsCollected", request.barCount);
                result.put("newBars", saveResult.saved);
                result.put("duplicates", saveResult.duplicates);
                result.put("duration", duration_ms);
                result.put("latestBar", latestBar);
                
                log.info("Historical data collection completed successfully");
                
            } else {
                // Timeout
                request.status = "TIMEOUT";
                log.error("Historical data request timeout after 35 seconds");
                
                result.put("success", false);
                result.put("error", "Request timeout after 35 seconds");
            }
            
        } catch (Exception e) {
            log.error("Error collecting historical data", e);
            result.put("success", false);
            result.put("error", e.getMessage());
            
        } finally {
            // Cleanup - KEEP THIS
            activeRequests.remove(requestId);
            collectedBars.remove(requestId);
            requestLatches.remove(requestId);
            // PHASE 1: COMMENT OUT
            // requestToCollectionRun.remove(requestId);
        }
        
        return result;
    }

    
    /**
     * SIMPLIFIED: Save bars with transaction
     */
    @Transactional
    private SaveResult saveBarsToDatabase(String symbol, List<Bar> bars) {
        if (bars == null || bars.isEmpty()) {
            return new SaveResult(0, 0);
        }
        
        String sql = "INSERT INTO spy_bars_1min (time, open, high, low, close, volume, vwap, count) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
                    "ON CONFLICT (time) DO NOTHING";
        
        AtomicInteger saved = new AtomicInteger(0);
        AtomicInteger duplicates = new AtomicInteger(0);
        
        int[] results = jdbcTemplate.batchUpdate(sql, new BatchPreparedStatementSetter() {
            @Override
            public void setValues(PreparedStatement ps, int i) throws SQLException {
                Bar bar = bars.get(i);
                
                // bartime: "20250829 21:30:00 Asia/Taipei"
                DateTimeFormatter inFmt = DateTimeFormatter.ofPattern("yyyyMMdd HH:mm:ss VV");

	            // 1) parse with zone from the string
	            ZonedDateTime zdt = ZonedDateTime.parse(bar.time(), inFmt);

	            // 2) convert to UTC *same instant*
	            ZonedDateTime utc = zdt.withZoneSameInstant(ZoneOffset.UTC);

	            // 3a) Postgres/Timescale friendly (space, offset)
	      //      String pgTs = utc.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ssXXX"));
             
             //   LocalDateTime barTime = LocalDateTime.parse(bar.time(), IB_DATE_FORMAT);
                
                ps.setTimestamp(1, Timestamp.from(utc.toInstant()));
                ps.setDouble(2, bar.open());
                ps.setDouble(3, bar.high());
                ps.setDouble(4, bar.low());
                ps.setDouble(5, bar.close());
                ps.setLong(6, bar.volume().longValue());
                ps.setDouble(7, bar.wap().value().doubleValue());
                ps.setInt(8, bar.count());
            }
            
            @Override
            public int getBatchSize() {
                return bars.size();
            }
        });
        
        // Count saves and duplicates
        for (int result : results) {
            if (result > 0) {
                saved.incrementAndGet();
            } else {
                duplicates.incrementAndGet();
            }
        }
        
        log.info("result length {}, Saved {} new bars, skipped {} duplicates", results.length, saved.get(), duplicates.get());
        return new SaveResult(saved.get(), duplicates.get());
    }
    
    /**
     * Simple result class
     */
    private static class SaveResult {
        final int saved;
        final int duplicates;
        
        SaveResult(int saved, int duplicates) {
            this.saved = saved;
            this.duplicates = duplicates;
        }
    }
    
    /**
     * Get latest bar time from database
     */
    public String getLatestBarTime() {
        try {
            Timestamp latest = jdbcTemplate.queryForObject(
                "SELECT MAX(time) AT TIME ZONE 'UTC' AS utc_time FROM spy_bars_1min", 
                Timestamp.class
            );
            
            if (latest != null) {
                // Convert to EST/EDT for display
                LocalDateTime ldt = latest.toLocalDateTime();
                log.info("LocalDateTime:" + ldt.toString());
                ZonedDateTime zdt = ldt.atZone(ZoneId.of("UTC"))
                                       .withZoneSameInstant(ZoneId.of("America/New_York"));
                log.info("EST zone time:" + zdt.toString());
                return zdt.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss z"));
            }
        } catch (Exception e) {
            log.error("Error getting latest bar time", e);
        }
        return null;
    }
    
    /**
     * Enforce IB rate limiting
     */
    private void enforceRateLimit() throws InterruptedException {
        rateLimiter.acquire();
        try {
            long now = System.currentTimeMillis();
            long timeSinceLastRequest = now - lastRequestTime;
            
            if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
                long waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
                log.debug("Rate limiting: waiting {} ms", waitTime);
                Thread.sleep(waitTime);
            }
            
            lastRequestTime = System.currentTimeMillis();
        } finally {
            rateLimiter.release();
        }
    }
    
    /**
     * Called by IBConnectionManager when historical data is received
     */
    public void onHistoricalData(int reqId, Bar bar) {
        List<Bar> bars = collectedBars.get(reqId);
        if (bars != null) {
            bars.add(bar);
            log.debug("Received bar for request {}: {}", reqId, bar.time());
        } else {
            log.warn("Received bar for unknown request {}", reqId);
        }
    }
    
    /**
     * Called by IBConnectionManager when historical data is complete
     */
    public void onHistoricalDataEnd(int reqId, String startDate, String endDate) {
        HistoricalDataRequest request = activeRequests.get(reqId);
        if (request != null) {
            request.status = "COMPLETED";
            log.info("Historical data complete for request {} - Start: {}, End: {}", 
                     reqId, startDate, endDate);
        }
        
        CountDownLatch latch = requestLatches.get(reqId);
        if (latch != null) {
            latch.countDown();
        }
    }
    
    /**
     * Called by IBConnectionManager on error
     */
    public void onHistoricalDataError(int reqId, int errorCode, String errorMsg) {
        HistoricalDataRequest request = activeRequests.get(reqId);
        if (request != null) {
            request.status = "ERROR: " + errorMsg;
            log.error("Historical data error for request {}: {} - {}", reqId, errorCode, errorMsg);
        }
        
        CountDownLatch latch = requestLatches.get(reqId);
        if (latch != null) {
            latch.countDown();
        }
    }
    
    /**
     * Get collection statistics
     */
    public Map<String, Object> getCollectionStats(String symbol) {
        Map<String, Object> stats = new HashMap<>();
        
        String sql = """
            SELECT 
                COUNT(*) as total_bars,
                MIN(time) as earliest_bar,
                MAX(time) as latest_bar,
                COUNT(DISTINCT DATE(time)) as trading_days
            FROM spy_bars_1min
        """;
        
        Map<String, Object> dbStats = jdbcTemplate.queryForMap(sql);
        
        stats.put("symbol", symbol);
        stats.put("totalBars", dbStats.get("total_bars"));
        stats.put("earliestBar", dbStats.get("earliest_bar"));
        stats.put("latestBar", dbStats.get("latest_bar"));
        stats.put("tradingDays", dbStats.get("trading_days"));
        stats.put("activeRequests", activeRequests.size());
        
        return stats;
    }
}
