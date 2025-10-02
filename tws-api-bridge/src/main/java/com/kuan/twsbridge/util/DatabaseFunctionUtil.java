package com.kuan.twsbridge.util;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import java.time.LocalDate;
import java.sql.Date;

@Component
public class DatabaseFunctionUtil {
    
    private final JdbcTemplate jdbcTemplate;
    
    public DatabaseFunctionUtil(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }
    
    /**
     * Call a void PostgreSQL function
     */
    public void callVoidFunction(String functionName, Object... params) {
        StringBuilder sql = new StringBuilder("SELECT ");
        sql.append(functionName).append("(");
        
        for (int i = 0; i < params.length; i++) {
            sql.append("?");
            if (i < params.length - 1) sql.append(", ");
        }
        sql.append(")");
        
        jdbcTemplate.execute(sql.toString());
    }
    
    /**
     * Call a PostgreSQL function that returns a value
     */
    public <T> T callFunction(String functionName, Class<T> returnType, Object... params) {
        StringBuilder sql = new StringBuilder("SELECT ");
        sql.append(functionName).append("(");
        
        for (int i = 0; i < params.length; i++) {
            sql.append("?");
            if (i < params.length - 1) sql.append(", ");
        }
        sql.append(")");
        
        return jdbcTemplate.queryForObject(sql.toString(), returnType, params);
    }
    
    /**
     * Update daily summary using the utility
     */
    public void updateDailySummary(LocalDate date) {
        // For VOID function:
        callVoidFunction("update_daily_summary", Date.valueOf(date));
        
        // OR for function returning INTEGER:
        // Integer result = callFunction("update_daily_summary", Integer.class, Date.valueOf(date));
    }
}
