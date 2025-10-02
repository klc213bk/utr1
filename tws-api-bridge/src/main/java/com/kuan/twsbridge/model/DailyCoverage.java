package com.kuan.twsbridge.model;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.math.BigDecimal;

/**
 * Daily coverage statistics for SPY data
 */
public class DailyCoverage {
    private LocalDate tradingDate;
    private boolean isTradingDay;
    private int expectedBars;
    private int actualBars;
    private double coveragePercentage;
    private boolean isComplete;
    private boolean hasGaps;
    private LocalDateTime lastUpdated;
    
 // Additional fields for database integration
    private LocalDateTime firstBarTime;
    private LocalDateTime lastBarTime;
    private Long lastCollectionId;
    
    // Constructors
    public DailyCoverage() {}
    
    public DailyCoverage(LocalDate tradingDate, boolean isTradingDay, int expectedBars, 
                         int actualBars, double coveragePercentage, boolean isComplete) {
        this.tradingDate = tradingDate;
        this.isTradingDay = isTradingDay;
        this.expectedBars = expectedBars;
        this.actualBars = actualBars;
        this.coveragePercentage = coveragePercentage;
        this.isComplete = isComplete;
    }
    
    // Calculated properties
    public int getMissingBars() {
        return expectedBars - actualBars;
    }
    
    public boolean needsBackfill() {
        return isTradingDay && !isComplete && coveragePercentage < 95.0;
    }
    
    // Getters and Setters
    public LocalDate getTradingDate() { return tradingDate; }
    public void setTradingDate(LocalDate tradingDate) { this.tradingDate = tradingDate; }
    
    public boolean isTradingDay() { return isTradingDay; }
    public void setTradingDay(boolean tradingDay) { isTradingDay = tradingDay; }
    
    public int getExpectedBars() { return expectedBars; }
    public void setExpectedBars(int expectedBars) { this.expectedBars = expectedBars; }
    
    public int getActualBars() { return actualBars; }
    public void setActualBars(int actualBars) { this.actualBars = actualBars; }
    
    public double getCoveragePercentage() { return coveragePercentage; }
    public void setCoveragePercentage(double coveragePercentage) { this.coveragePercentage = coveragePercentage; }
    
    public boolean isComplete() { return isComplete; }
    public void setComplete(boolean complete) { isComplete = complete; }
    
    public boolean isHasGaps() { return hasGaps; }
    public void setHasGaps(boolean hasGaps) { this.hasGaps = hasGaps; }
    
    public LocalDateTime getLastUpdated() { return lastUpdated; }
    public void setLastUpdated(LocalDateTime lastUpdated) { this.lastUpdated = lastUpdated; }
    
 // Getters and Setters for new fields
    public LocalDateTime getFirstBarTime() { return firstBarTime; }
    public void setFirstBarTime(LocalDateTime firstBarTime) { this.firstBarTime = firstBarTime; }
    
    public LocalDateTime getLastBarTime() { return lastBarTime; }
    public void setLastBarTime(LocalDateTime lastBarTime) { this.lastBarTime = lastBarTime; }
    
    public Long getLastCollectionId() { return lastCollectionId; }
    public void setLastCollectionId(Long lastCollectionId) { this.lastCollectionId = lastCollectionId; }
    
}