// ============================================================================
// BarDataRepository.java
// ============================================================================

package com.kuan.twsbridge.repository;

import com.ib.client.Bar;
import com.kuan.twsbridge.model.BarData;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

@Repository
public class BarDataRepository {
    
    private static final DateTimeFormatter IB_DATE_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd HH:mm:ss");
    
    private final JdbcTemplate jdbcTemplate;
    private final NamedParameterJdbcTemplate namedJdbcTemplate;
    
    public BarDataRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
        this.namedJdbcTemplate = new NamedParameterJdbcTemplate(jdbcTemplate);
    }
    
    /**
     * Save bars to database with duplicate tracking
     * @return number of bars actually saved (excluding duplicates)
     */
    @Transactional
    public int saveBars(List<Bar> bars) {
        if (bars == null || bars.isEmpty()) {
            return 0;
        }
        
        String sql = """
            INSERT INTO spy_bars_1min (time, open, high, low, close, volume, vwap, count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (time) DO NOTHING
        """;
        
        int[] results = jdbcTemplate.batchUpdate(sql, new BatchPreparedStatementSetter() {
            @Override
            public void setValues(PreparedStatement ps, int i) throws SQLException {
                Bar bar = bars.get(i);
                
                // Parse IB date format: yyyyMMdd HH:mm:ss
                LocalDateTime barTime = LocalDateTime.parse(bar.time(), IB_DATE_FORMAT);
                
                ps.setTimestamp(1, Timestamp.valueOf(barTime));
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
        return Arrays.stream(results).sum();
    }
    
    /**
     * Save bars with detailed result tracking
     */
    @Transactional
    public SaveBarsResult saveBarsWithDetails(List<Bar> bars, String symbol) {
        if (bars == null || bars.isEmpty()) {
            return new SaveBarsResult(0, 0, 0);
        }
        
        String tableName = getTableName(symbol);
        String sql = String.format("""
            INSERT INTO %s (time, open, high, low, close, volume, vwap, count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (time) DO NOTHING
        """, tableName);
        
        AtomicInteger saved = new AtomicInteger(0);
        AtomicInteger duplicates = new AtomicInteger(0);
        
        int[] results = jdbcTemplate.batchUpdate(sql, new BatchPreparedStatementSetter() {
            @Override
            public void setValues(PreparedStatement ps, int i) throws SQLException {
                Bar bar = bars.get(i);
                LocalDateTime barTime = LocalDateTime.parse(bar.time(), IB_DATE_FORMAT);
                
                ps.setTimestamp(1, Timestamp.valueOf(barTime));
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
        
        return new SaveBarsResult(bars.size(), saved.get(), duplicates.get());
    }
    
    /**
     * Get bars for a specific date range
     */
    public List<BarData> getBars(String symbol, LocalDateTime start, LocalDateTime end) {
        String tableName = getTableName(symbol);
        String sql = String.format("""
            SELECT time, open, high, low, close, volume, vwap, count
            FROM %s
            WHERE time >= ? AND time <= ?
            ORDER BY time
        """, tableName);
        
        return jdbcTemplate.query(sql, BAR_DATA_ROW_MAPPER, 
            Timestamp.valueOf(start), Timestamp.valueOf(end));
    }
    
    /**
     * Get latest bar
     */
    public BarData getLatestBar(String symbol) {
        String tableName = getTableName(symbol);
        String sql = String.format("""
            SELECT time, open, high, low, close, volume, vwap, count
            FROM %s
            ORDER BY time DESC
            LIMIT 1
        """, tableName);
        
        List<BarData> bars = jdbcTemplate.query(sql, BAR_DATA_ROW_MAPPER);
        return bars.isEmpty() ? null : bars.get(0);
    }
    
    /**
     * Count bars in date range
     */
    public long countBars(String symbol, LocalDateTime start, LocalDateTime end) {
        String tableName = getTableName(symbol);
        String sql = String.format("""
            SELECT COUNT(*) FROM %s
            WHERE time >= ? AND time <= ?
        """, tableName);
        
        return jdbcTemplate.queryForObject(sql, Long.class,
            Timestamp.valueOf(start), Timestamp.valueOf(end));
    }
    
    /**
     * Delete bars in date range (for cleanup or re-collection)
     */
    @Transactional
    public int deleteBars(String symbol, LocalDateTime start, LocalDateTime end) {
        String tableName = getTableName(symbol);
        String sql = String.format("""
            DELETE FROM %s
            WHERE time >= ? AND time <= ?
        """, tableName);
        
        return jdbcTemplate.update(sql, Timestamp.valueOf(start), Timestamp.valueOf(end));
    }
    
    /**
     * Get bar statistics for a date range
     */
    public Map<String, Object> getBarStatistics(String symbol, LocalDateTime start, LocalDateTime end) {
        String tableName = getTableName(symbol);
        String sql = String.format("""
            SELECT 
                COUNT(*) as bar_count,
                MIN(time) as first_bar,
                MAX(time) as last_bar,
                AVG(volume) as avg_volume,
                MAX(high) as period_high,
                MIN(low) as period_low,
                SUM(volume) as total_volume
            FROM %s
            WHERE time >= ? AND time <= ?
        """, tableName);
        
        return jdbcTemplate.queryForMap(sql, Timestamp.valueOf(start), Timestamp.valueOf(end));
    }
    
    /**
     * Find missing minutes (gaps) in data
     */
    public List<Map<String, Object>> findGaps(String symbol, LocalDateTime start, LocalDateTime end) {
        String sql = """
            WITH expected_minutes AS (
                SELECT generate_series(
                    ?::timestamp,
                    ?::timestamp,
                    '1 minute'::interval
                ) AS expected_time
            ),
            trading_minutes AS (
                SELECT expected_time
                FROM expected_minutes
                WHERE EXTRACT(dow FROM expected_time) BETWEEN 1 AND 5
                AND (
                    (EXTRACT(hour FROM expected_time) = 9 AND EXTRACT(minute FROM expected_time) >= 30)
                    OR EXTRACT(hour FROM expected_time) BETWEEN 10 AND 15
                    OR (EXTRACT(hour FROM expected_time) = 16 AND EXTRACT(minute FROM expected_time) = 0)
                )
            ),
            actual_minutes AS (
                SELECT DATE_TRUNC('minute', time) as actual_time
                FROM spy_bars_1min
                WHERE time >= ? AND time <= ?
            )
            SELECT 
                MIN(tm.expected_time) as gap_start,
                MAX(tm.expected_time) as gap_end,
                COUNT(*) as missing_minutes
            FROM trading_minutes tm
            LEFT JOIN actual_minutes am ON tm.expected_time = am.actual_time
            WHERE am.actual_time IS NULL
            GROUP BY (tm.expected_time - (row_number() OVER (ORDER BY tm.expected_time) * interval '1 minute'))
            ORDER BY gap_start
        """;
        
        return jdbcTemplate.queryForList(sql, 
            Timestamp.valueOf(start), Timestamp.valueOf(end),
            Timestamp.valueOf(start), Timestamp.valueOf(end));
    }
    
    /**
     * Helper to get table name (future support for multiple symbols)
     */
    private String getTableName(String symbol) {
        // For now, only SPY is supported
        if (!"SPY".equalsIgnoreCase(symbol)) {
            throw new IllegalArgumentException("Only SPY is currently supported");
        }
        return "spy_bars_1min";
    }
    
    /**
     * Row mapper for BarData
     */
    private static final RowMapper<BarData> BAR_DATA_ROW_MAPPER = (rs, rowNum) -> {
        BarData bar = new BarData();
        bar.setTime(rs.getTimestamp("time").toLocalDateTime());
        bar.setOpen(rs.getDouble("open"));
        bar.setHigh(rs.getDouble("high"));
        bar.setLow(rs.getDouble("low"));
        bar.setClose(rs.getDouble("close"));
        bar.setVolume(rs.getLong("volume"));
        bar.setVwap(rs.getDouble("vwap"));
        bar.setCount(rs.getInt("count"));
        return bar;
    };
    
    /**
     * Result class for save operations
     */
    public static class SaveBarsResult {
        private final int totalBars;
        private final int savedBars;
        private final int duplicateBars;
        
        public SaveBarsResult(int totalBars, int savedBars, int duplicateBars) {
            this.totalBars = totalBars;
            this.savedBars = savedBars;
            this.duplicateBars = duplicateBars;
        }
        
        public int getTotalBars() { return totalBars; }
        public int getSavedBars() { return savedBars; }
        public int getDuplicateBars() { return duplicateBars; }
    }
}

