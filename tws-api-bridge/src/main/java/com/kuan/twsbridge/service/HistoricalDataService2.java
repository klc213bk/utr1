package com.kuan.twsbridge.service;

import com.ib.client.*;
import com.kuan.twsbridge.controller.HistoricalDataController;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.stereotype.Service;

import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
public class HistoricalDataService2 {
    
	private static final Logger log = LoggerFactory.getLogger(HistoricalDataService2.class);
	
    @Autowired
    private IBConnectionManager connectionManager;
    
    @Autowired
    private JdbcTemplate jdbcTemplate;
    
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
     * Collect historical data for any symbol
     */
    public Map<String, Object> collectHistoricalData(String symbol, String endDate, String duration, String barSize) {
        Map<String, Object> result = new HashMap<>();
        
        // Check IB connection
        if (!connectionManager.getConnected().get()) {
            result.put("success", false);
            result.put("error", "IB is not connected");
            return result;
        }
        
        try {
            // Apply rate limiting
            enforceRateLimit();
            
            // Create contract
            Contract contract = new Contract();
            contract.symbol(symbol);
            contract.secType("STK");
            contract.currency("USD");
            contract.exchange("SMART");
            if (symbol.equals("SPY")) {
                contract.primaryExch("ARCA");
            }
            
            // Generate request ID
            int reqId = requestId.incrementAndGet();
            
            // Create request tracking
            HistoricalDataRequest request = new HistoricalDataRequest(symbol, endDate, duration, barSize);
            activeRequests.put(reqId, request);
            collectedBars.put(reqId, new ArrayList<>());
            
            // Create latch to wait for completion
            CountDownLatch latch = new CountDownLatch(1);
            requestLatches.put(reqId, latch);
            
            log.info("Requesting historical data - Symbol: {}, End: {}, Duration: {}, BarSize: {}", 
                     symbol, endDate, duration, barSize);
            
            // Request historical data
            connectionManager.getClient().reqHistoricalData(
                reqId,
                contract,
                endDate + " US/Eastern",  // Add timezone
                duration,
                barSize,
                "TRADES",
                1,  // useRTH: 1 = Regular Trading Hours only
                1,  // formatDate: 1 = yyyyMMdd HH:mm:ss
                false,  // keepUpToDate: false for pure historical
                null
            );
            
            // Wait for data with timeout
            boolean completed = latch.await(30, TimeUnit.SECONDS);
            
            if (completed) {
                // Get collected bars
                List<Bar> bars = collectedBars.get(reqId);
                request.status = "COMPLETED";
                request.barCount = bars.size();
                
                // Save to database
                int saved = saveBarsToDatabase(symbol, bars);
                
                result.put("success", true);
                result.put("symbol", symbol);
                result.put("barsRequested", bars.size());
                result.put("barsSaved", saved);
                result.put("period", duration);
                result.put("endDate", endDate);
                
                log.info("Historical data collection completed - {} bars collected, {} saved", 
                         bars.size(), saved);
            } else {
                request.status = "TIMEOUT";
                result.put("success", false);
                result.put("error", "Request timeout after 30 seconds");
                log.error("Historical data request timeout");
            }
            
            // Cleanup
            activeRequests.remove(reqId);
            collectedBars.remove(reqId);
            requestLatches.remove(reqId);
            
        } catch (Exception e) {
            log.error("Error collecting historical data", e);
            result.put("success", false);
            result.put("error", e.getMessage());
        }
        
        return result;
    }
    
    /**
     * Collect multiple periods of historical data
     */
    public Map<String, Object> collectMultiplePeriods(String symbol, int months) {
        Map<String, Object> result = new HashMap<>();
        List<Map<String, Object>> periods = new ArrayList<>();
        
        LocalDateTime endDate = LocalDateTime.now();
        int totalBars = 0;
        int totalSaved = 0;
        
        // Calculate number of 30-day periods needed
        int periods30Day = (months + 1) / 1;  // Round up
        
        for (int i = 0; i < periods30Day && i < months; i++) {
            // Calculate end date for this period
            LocalDateTime periodEnd = endDate.minusDays(30L * i);
            String endDateStr = periodEnd.format(IB_DATE_FORMAT);
            
            // Collect 30 days of data
            Map<String, Object> periodResult = collectHistoricalData(
                symbol, 
                endDateStr, 
                "30 D", 
                "1 min"
            );
            
            periods.add(periodResult);
            
            if ((Boolean) periodResult.get("success")) {
                totalBars += (Integer) periodResult.get("barsRequested");
                totalSaved += (Integer) periodResult.get("barsSaved");
            } else {
                log.warn("Failed to collect period ending {}: {}", 
                         endDateStr, periodResult.get("error"));
            }
            
            // Wait between requests to respect rate limits
            try {
                Thread.sleep(11000); // 11 seconds to be safe
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        
        result.put("success", true);
        result.put("symbol", symbol);
        result.put("monthsRequested", months);
        result.put("periodsCollected", periods.size());
        result.put("totalBars", totalBars);
        result.put("totalSaved", totalSaved);
        result.put("periods", periods);
        
        return result;
    }
    
    /**
     * Save bars to TimescaleDB
     */
    private int saveBarsToDatabase(String symbol, List<Bar> bars) {
        if (bars == null || bars.isEmpty()) {
            return 0;
        }
        
        String sql = "INSERT INTO spy_bars_1min (time, open, high, low, close, volume, vwap, count) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
                    "ON CONFLICT (time) DO NOTHING";  // Ignore duplicates
        
        try {
            int[] results = jdbcTemplate.batchUpdate(sql, new BatchPreparedStatementSetter() {
                @Override
                public void setValues(PreparedStatement ps, int i) throws SQLException {
                    Bar bar = bars.get(i);
                    
                    // Parse IB date format: yyyyMMdd HH:mm:ss
                    LocalDateTime barTime = LocalDateTime.parse(bar.time(), IB_DATE_FORMAT);
                    Timestamp timestamp = Timestamp.valueOf(barTime);
                    
                    ps.setTimestamp(1, timestamp);
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
            
            // Count actual inserts (excluding conflicts)
            int inserted = Arrays.stream(results).sum();
            log.info("Saved {} new bars to database (skipped {} duplicates)", 
                     inserted, bars.size() - inserted);
            return inserted;
            
        } catch (Exception e) {
            log.error("Error saving bars to database", e);
            return 0;
        }
    }
    
    /**
     * Find gaps in the data
     */
    public List<Map<String, Object>> findDataGaps(String symbol, LocalDateTime startDate, LocalDateTime endDate) {
        String sql = """
            WITH expected_minutes AS (
                SELECT generate_series(
                    ?::timestamp,
                    ?::timestamp,
                    '1 minute'::interval
                ) AS expected_time
            ),
            trading_hours AS (
                SELECT expected_time
                FROM expected_minutes
                WHERE EXTRACT(dow FROM expected_time) BETWEEN 1 AND 5  -- Monday to Friday
                AND (
                    (EXTRACT(hour FROM expected_time) = 9 AND EXTRACT(minute FROM expected_time) >= 30)
                    OR EXTRACT(hour FROM expected_time) BETWEEN 10 AND 15
                    OR (EXTRACT(hour FROM expected_time) = 16 AND EXTRACT(minute FROM expected_time) = 0)
                )
            )
            SELECT 
                th.expected_time as missing_time,
                LAG(th.expected_time) OVER (ORDER BY th.expected_time) as prev_time,
                LEAD(th.expected_time) OVER (ORDER BY th.expected_time) as next_time
            FROM trading_hours th
            LEFT JOIN spy_bars_1min b ON DATE_TRUNC('minute', b.time) = th.expected_time
            WHERE b.time IS NULL
            ORDER BY th.expected_time
        """;
        
        List<Map<String, Object>> gaps = jdbcTemplate.queryForList(
            sql, 
            Timestamp.valueOf(startDate),
            Timestamp.valueOf(endDate)
        );
        
        log.info("Found {} missing bars between {} and {}", gaps.size(), startDate, endDate);
        return gaps;
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
        if (collectedBars.containsKey(reqId)) {
            collectedBars.get(reqId).add(bar);
            log.debug("Received bar for request {}: {}", reqId, bar.time());
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
        if (errorCode == 162) {
        	log.error("Historical data request failed");
        } else if (errorCode == 200) {
        	log.error("No security definition found");
        } else if (errorCode == 321) {
        	log.error("Error validating request");
        } else if (errorCode == 366) {
        	log.error("No historical data for the requested period");
        } else if (errorCode == 420) {
        	log.error("Error validating request");
        } else {
        	log.error("Other error");
        }
        CountDownLatch latch = requestLatches.get(reqId);
        if (latch != null) {
            latch.countDown();
        }
    }
}
