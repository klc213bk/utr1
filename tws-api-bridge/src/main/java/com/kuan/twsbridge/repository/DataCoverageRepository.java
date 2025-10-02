package com.kuan.twsbridge.repository;

import org.springframework.stereotype.Repository;

import com.kuan.twsbridge.model.DailyCoverage;
import com.kuan.twsbridge.model.DataGap;

import java.time.LocalDate;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

@Repository
public class DataCoverageRepository {
    
    private final JdbcTemplate jdbcTemplate;
    
    public DataCoverageRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }
    
    /**
     * Get daily coverage data - PURE DATABASE ACCESS
     */
    public List<DailyCoverage> getDailyCoverage(int days) {
    	String sql = String.format("""
                SELECT 
                    trading_date,
                    is_trading_day,
                    expected_bars,
                    actual_bars,
                    coverage_percentage,
                    is_complete,
                    has_gaps,
                    last_updated
                FROM spy_daily_summary
                WHERE trading_date >= CURRENT_DATE - INTERVAL '%d days'
                ORDER BY trading_date DESC
            """, days);
        
        return jdbcTemplate.query(sql, dailyCoverageRowMapper());
    }
    
    /**
     * Detect gaps in data
     */
    public List<DataGap> detectGaps(LocalDate startDate, LocalDate endDate) {
    	String sql = """
                SELECT gap_start, gap_end, minutes_missing
                FROM (
                    SELECT generate_series(
                        ?::date::timestamp,
                        ?::date::timestamp,
                        '1 day'::interval
                    ) AS date
                ) dates,
                LATERAL detect_gaps_for_date(date::date) AS gaps
                WHERE is_trading_day(date::date)
            """;
        
        return jdbcTemplate.query(sql, new Object[]{startDate, endDate}, dataGapRowMapper());
    }
    
    /**
     * Row mapper for daily coverage
     */
    private RowMapper<DailyCoverage> dailyCoverageRowMapper() {
    	return (rs, rowNum) -> {
            DailyCoverage coverage = new DailyCoverage();
            coverage.setTradingDate(rs.getDate("trading_date").toLocalDate());
            coverage.setTradingDay(rs.getBoolean("is_trading_day"));
            coverage.setExpectedBars(rs.getInt("expected_bars"));
            coverage.setActualBars(rs.getInt("actual_bars"));
            coverage.setCoveragePercentage(rs.getDouble("coverage_percentage"));
            coverage.setComplete(rs.getBoolean("is_complete"));
            
            // Handle nullable columns
            if (rs.getObject("has_gaps") != null) {
                coverage.setHasGaps(rs.getBoolean("has_gaps"));
            }
            
            if (rs.getTimestamp("last_updated") != null) {
                coverage.setLastUpdated(rs.getTimestamp("last_updated").toLocalDateTime());
            }
            
            return coverage;
        };
    }
    
    private RowMapper<DataGap> dataGapRowMapper() {
    	return (rs, rowNum) -> {
            DataGap gap = new DataGap();
            gap.setGapStart(rs.getTimestamp("gap_start").toLocalDateTime());
            gap.setGapEnd(rs.getTimestamp("gap_end").toLocalDateTime());
            gap.setMinutes(rs.getInt("minutes_missing"));
            return gap;
        };
    }
}
