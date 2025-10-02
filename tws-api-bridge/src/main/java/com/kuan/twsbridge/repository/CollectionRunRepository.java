package com.kuan.twsbridge.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import com.kuan.twsbridge.model.CollectionRun;
import com.kuan.twsbridge.model.CollectionRunRequest;
import com.kuan.twsbridge.model.DataGap;

@Repository
public class CollectionRunRepository {
    
    private final JdbcTemplate jdbcTemplate;
    private final NamedParameterJdbcTemplate namedJdbcTemplate;
    
    public CollectionRunRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
        this.namedJdbcTemplate = new NamedParameterJdbcTemplate(jdbcTemplate);
    }
    
    /**
     * Create new collection run
     */
    public Long createCollectionRun(CollectionRunRequest request) {
        String sql = """
            INSERT INTO spy_collection_runs 
            (collection_type, request_params, period_start, period_end, bar_size, status)
            VALUES (:type, :params::jsonb, :start, :end, :barSize, :status)
            RETURNING id
        """;
        
        Map<String, Object> params = new HashMap<>();
        params.put("type", request.getType());
        params.put("params", request.getParamsJson());
        params.put("start", request.getPeriodStart());
        params.put("end", request.getPeriodEnd());
        params.put("barSize", request.getBarSize());
        params.put("status", "running");
        
        return namedJdbcTemplate.queryForObject(sql, params, Long.class);
    }
    
    /**
     * Get recent collection runs
     */
    public List<CollectionRun> getRecentRuns(int limit) {
        String sql = """
            SELECT * FROM spy_collection_runs
            ORDER BY started_at DESC
            LIMIT ?
        """;
        
        return jdbcTemplate.query(sql, new Object[]{limit}, collectionRunRowMapper());
    }
    
    /**
     * Update run status
     */
    @Transactional
    public void updateRunStatus(Long runId, String status, Map<String, Object> metrics) {
        String sql = """
            UPDATE spy_collection_runs 
            SET status = :status,
                completed_at = NOW(),
                bars_received = :barsReceived,
                bars_saved = :barsSaved,
                bars_duplicates = :barsDuplicates,
                error_message = :errorMessage
            WHERE id = :id
        """;
        
        Map<String, Object> params = new HashMap<>(metrics);
        params.put("status", status);
        params.put("id", runId);
        
        namedJdbcTemplate.update(sql, params);
    }
    
    /**
     * Queue gap fill task
     */
    public void queueGapFill(DataGap gap) {
        String sql = """
            INSERT INTO spy_collection_queue 
            (collection_type, period_start, period_end, priority, request_source)
            VALUES ('gap_fill', ?, ?, 8, 'gap_detector')
        """;
        
        jdbcTemplate.update(sql, gap.getGapStart(), gap.getGapEnd());
    }
    
    /**
     * Row mapper for CollectionRun entity
     * Maps all fields from spy_collection_runs table to CollectionRun object
     */
    private RowMapper<CollectionRun> collectionRunRowMapper() {
        return new RowMapper<CollectionRun>() {
            @Override
            public CollectionRun mapRow(ResultSet rs, int rowNum) throws SQLException {
                CollectionRun run = new CollectionRun();
                
                // Primary key
                run.setId(rs.getLong("id"));
                
                // Collection type and parameters
                run.setCollectionType(rs.getString("collection_type"));
                run.setRequestParams(rs.getString("request_params"));
                
                // Timestamps - handle nulls appropriately
                run.setStartedAt(toLocalDateTime(rs.getTimestamp("started_at")));
                run.setCompletedAt(toLocalDateTime(rs.getTimestamp("completed_at")));
                
                // Duration (might be null if not completed)
                Integer duration = rs.getObject("duration_seconds", Integer.class);
                run.setDurationSeconds(duration);
                
                // Period information
                run.setPeriodStart(toLocalDateTime(rs.getTimestamp("period_start")));
                run.setPeriodEnd(toLocalDateTime(rs.getTimestamp("period_end")));
                run.setBarSize(rs.getString("bar_size"));
                
                // Bar counts - using getObject to handle nulls properly
                run.setBarsRequested(rs.getObject("bars_requested", Integer.class));
                run.setBarsReceived(rs.getObject("bars_received", Integer.class));
                run.setBarsSaved(rs.getObject("bars_saved", Integer.class));
                run.setBarsDuplicates(rs.getObject("bars_duplicates", Integer.class));
                run.setBarsFailed(rs.getObject("bars_failed", Integer.class));
                
                // Status and error information
                run.setStatus(rs.getString("status"));
                run.setErrorCode(rs.getObject("error_code", Integer.class));
                run.setErrorMessage(rs.getString("error_message"));
                
                // IB specific fields
                run.setIbRequestId(rs.getObject("ib_request_id", Integer.class));
                
                // Metadata
                run.setTriggeredBy(rs.getString("triggered_by"));
                
                return run;
            }
        };
    }
    private LocalDateTime toLocalDateTime(Timestamp timestamp) {
        return timestamp != null ? timestamp.toLocalDateTime() : null;
    }
}
