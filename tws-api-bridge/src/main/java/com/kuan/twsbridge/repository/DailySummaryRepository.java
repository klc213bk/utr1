// ============================================================================
// DailySummaryRepository.java
// ============================================================================

package com.kuan.twsbridge.repository;

import com.kuan.twsbridge.model.DailyCoverage;

import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

@Repository
public class DailySummaryRepository {
    
    private final JdbcTemplate jdbcTemplate;
    
    public DailySummaryRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }
    
    /**
     * Update daily summary for specific dates
     */
    @Transactional
    public void updateForDates(Set<LocalDate> dates) {
        for (LocalDate date : dates) {
            updateDailySummary(date);
        }
    }
    
    /**
     * Update daily summary for a single date
     */
    @Transactional
    public void updateDailySummary(LocalDate date) {
        // Call the stored function to update summary
    	jdbcTemplate.execute(String.format(
                "SELECT update_daily_summary('%s'::date)", 
                date.toString()
            ));
    }
    
    /**
     * Get daily coverage for date range
     */
    public List<DailyCoverage> getDailyCoverage(LocalDate startDate, LocalDate endDate) {
        String sql = """
            SELECT 
                trading_date,
                is_trading_day,
                expected_bars,
                actual_bars,
                coverage_percentage,
                is_complete,
                has_gaps,
                first_bar_time,
                last_bar_time,
                last_updated
            FROM spy_daily_summary
            WHERE trading_date >= ? AND trading_date <= ?
            ORDER BY trading_date DESC
        """;
        
        return jdbcTemplate.query(sql, DAILY_COVERAGE_ROW_MAPPER, 
            Date.valueOf(startDate), Date.valueOf(endDate));
    }
    
    /**
     * Get daily coverage for last N days
     */
    public List<DailyCoverage> getRecentDailyCoverage(int days) {
    	String sql = String.format("""
                SELECT 
                    trading_date,
                    is_trading_day,
                    expected_bars,
                    actual_bars,
                    coverage_percentage,
                    is_complete,
                    has_gaps,
                    first_bar_time,
                    last_bar_time,
                    last_updated
                FROM spy_daily_summary
                WHERE trading_date >= CURRENT_DATE - INTERVAL '%d days'
                ORDER BY trading_date DESC
            """, days);
            
            return jdbcTemplate.query(sql, DAILY_COVERAGE_ROW_MAPPER);
    }
    
    /**
     * Get incomplete trading days
     */
    public List<DailyCoverage> getIncompleteDays(int daysBack) {
    	String sql = String.format("""
                SELECT *
                FROM spy_daily_summary
                WHERE trading_date >= CURRENT_DATE - INTERVAL '%d days'
                  AND is_trading_day = true
                  AND is_complete = false
                ORDER BY trading_date DESC
            """, daysBack);
            
            return jdbcTemplate.query(sql, DAILY_COVERAGE_ROW_MAPPER);
    }
    
    /**
     * Get summary statistics
     */
    public Map<String, Object> getSummaryStatistics(int days) {
    	String sql = String.format("""
                SELECT 
                    COUNT(*) as total_days,
                    SUM(CASE WHEN is_trading_day THEN 1 ELSE 0 END) as trading_days,
                    SUM(CASE WHEN is_complete THEN 1 ELSE 0 END) as complete_days,
                    SUM(CASE WHEN is_trading_day AND NOT is_complete THEN 1 ELSE 0 END) as incomplete_days,
                    AVG(CASE WHEN is_trading_day THEN coverage_percentage ELSE NULL END) as avg_coverage,
                    SUM(actual_bars) as total_bars,
                    MIN(CASE WHEN actual_bars > 0 THEN trading_date ELSE NULL END) as earliest_data,
                    MAX(CASE WHEN actual_bars > 0 THEN trading_date ELSE NULL END) as latest_data
                FROM spy_daily_summary
                WHERE trading_date >= CURRENT_DATE - INTERVAL '%d days'
            """, days);
            
            return jdbcTemplate.queryForMap(sql);
    }
    
    /**
     * Insert or update daily summary
     */
    @Transactional
    public void upsertDailySummary(DailyCoverage coverage) {
        String sql = """
            INSERT INTO spy_daily_summary (
                trading_date, is_trading_day, expected_bars, actual_bars,
                has_gaps, first_bar_time, last_bar_time, last_collection_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (trading_date) DO UPDATE SET
                actual_bars = EXCLUDED.actual_bars,
                has_gaps = EXCLUDED.has_gaps,
                first_bar_time = EXCLUDED.first_bar_time,
                last_bar_time = EXCLUDED.last_bar_time,
                last_collection_id = EXCLUDED.last_collection_id,
                last_updated = NOW(),
                collection_count = spy_daily_summary.collection_count + 1
        """;
        
        jdbcTemplate.update(sql,
            Date.valueOf(coverage.getTradingDate()),
            coverage.isTradingDay(),
            coverage.getExpectedBars(),
            coverage.getActualBars(),
            coverage.isHasGaps(),
            coverage.getFirstBarTime() != null ? Timestamp.valueOf(coverage.getFirstBarTime()) : null,
            coverage.getLastBarTime() != null ? Timestamp.valueOf(coverage.getLastBarTime()) : null,
            coverage.getLastCollectionId()
        );
    }
    
    /**
     * Batch update daily summaries
     */
    @Transactional
    public void batchUpdateSummaries(List<DailyCoverage> summaries) {
        String sql = """
            UPDATE spy_daily_summary 
            SET actual_bars = ?, 
                has_gaps = ?,
                last_updated = NOW()
            WHERE trading_date = ?
        """;
        
        jdbcTemplate.batchUpdate(sql, new BatchPreparedStatementSetter() {
            @Override
            public void setValues(PreparedStatement ps, int i) throws SQLException {
                DailyCoverage summary = summaries.get(i);
                ps.setInt(1, summary.getActualBars());
                ps.setBoolean(2, summary.isHasGaps());
                ps.setDate(3, Date.valueOf(summary.getTradingDate()));
            }
            
            @Override
            public int getBatchSize() {
                return summaries.size();
            }
        });
    }
    
    /**
     * Find dates needing backfill
     */
    public List<LocalDate> findDatesNeedingBackfill(int daysBack, double minCoveragePercent) {
    	// FIX: Use string formatting for the interval
        String sql = String.format("""
            SELECT trading_date
            FROM spy_daily_summary
            WHERE trading_date >= CURRENT_DATE - INTERVAL '%d days'
              AND is_trading_day = true
              AND coverage_percentage < ?
            ORDER BY trading_date
        """, daysBack);
        
        return jdbcTemplate.query(sql, 
            new Object[]{minCoveragePercent},
            (rs, rowNum) -> rs.getDate("trading_date").toLocalDate()
        );
    }
    
    /**
     * Get monthly coverage summary
     */
    public List<Map<String, Object>> getMonthlyCoverage(int monthsBack) {
    	String sql = String.format("""
                SELECT 
                    DATE_TRUNC('month', trading_date) as month,
                    COUNT(*) as total_days,
                    SUM(CASE WHEN is_trading_day THEN 1 ELSE 0 END) as trading_days,
                    SUM(CASE WHEN is_complete THEN 1 ELSE 0 END) as complete_days,
                    AVG(CASE WHEN is_trading_day THEN coverage_percentage ELSE NULL END) as avg_coverage,
                    SUM(actual_bars) as total_bars
                FROM spy_daily_summary
                WHERE trading_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '%d months'
                GROUP BY DATE_TRUNC('month', trading_date)
                ORDER BY month DESC
            """, monthsBack);
            
            return jdbcTemplate.queryForList(sql);
    }
    
    /**
     * Row mapper for DailyCoverage
     */
    private static final RowMapper<DailyCoverage> DAILY_COVERAGE_ROW_MAPPER = (rs, rowNum) -> {
        DailyCoverage coverage = new DailyCoverage();
        coverage.setTradingDate(rs.getDate("trading_date").toLocalDate());
        coverage.setTradingDay(rs.getBoolean("is_trading_day"));
        coverage.setExpectedBars(rs.getInt("expected_bars"));
        coverage.setActualBars(rs.getInt("actual_bars"));
        coverage.setCoveragePercentage(rs.getDouble("coverage_percentage"));
        coverage.setComplete(rs.getBoolean("is_complete"));
        coverage.setHasGaps(rs.getBoolean("has_gaps"));
        
        // Handle nullable timestamps
        Timestamp firstBar = rs.getTimestamp("first_bar_time");
        if (firstBar != null) {
            coverage.setFirstBarTime(firstBar.toLocalDateTime());
        }
        
        Timestamp lastBar = rs.getTimestamp("last_bar_time");
        if (lastBar != null) {
            coverage.setLastBarTime(lastBar.toLocalDateTime());
        }
        
        Timestamp lastUpdated = rs.getTimestamp("last_updated");
        if (lastUpdated != null) {
            coverage.setLastUpdated(lastUpdated.toLocalDateTime());
        }
        
        return coverage;
    };
}
