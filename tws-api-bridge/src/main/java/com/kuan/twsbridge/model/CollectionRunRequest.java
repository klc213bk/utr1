package com.kuan.twsbridge.model;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * Request object for creating a collection run
 */
public class CollectionRunRequest {
    private String type;
    private String symbol;
    private LocalDateTime periodStart;
    private LocalDateTime periodEnd;
    private String duration;
    private String barSize;
    private String triggeredBy;
    private Map<String, Object> additionalParams;
    
    // Constructors
    public CollectionRunRequest() {
        this.barSize = "1 min";
        this.type = "historical";
        this.triggeredBy = "api";
    }
    
    public CollectionRunRequest(String symbol, LocalDateTime periodStart, 
                                LocalDateTime periodEnd, String duration) {
        this();
        this.symbol = symbol;
        this.periodStart = periodStart;
        this.periodEnd = periodEnd;
        this.duration = duration;
    }
    
    // Convert to JSON for storage
    public String getParamsJson() {
        Map<String, Object> params = new HashMap<>();
        params.put("symbol", symbol);
        params.put("duration", duration);
        params.put("periodStart", periodStart);
        params.put("periodEnd", periodEnd);
        if (additionalParams != null) {
            params.putAll(additionalParams);
        }
        
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                    .writeValueAsString(params);
        } catch (Exception e) {
            return "{}";
        }
    }
    
    // Getters and Setters
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    
    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }
    
    public LocalDateTime getPeriodStart() { return periodStart; }
    public void setPeriodStart(LocalDateTime periodStart) { this.periodStart = periodStart; }
    
    public LocalDateTime getPeriodEnd() { return periodEnd; }
    public void setPeriodEnd(LocalDateTime periodEnd) { this.periodEnd = periodEnd; }
    
    public String getDuration() { return duration; }
    public void setDuration(String duration) { this.duration = duration; }
    
    public String getBarSize() { return barSize; }
    public void setBarSize(String barSize) { this.barSize = barSize; }
    
    public String getTriggeredBy() { return triggeredBy; }
    public void setTriggeredBy(String triggeredBy) { this.triggeredBy = triggeredBy; }
    
    public Map<String, Object> getAdditionalParams() { return additionalParams; }
    public void setAdditionalParams(Map<String, Object> additionalParams) { this.additionalParams = additionalParams; }
}
