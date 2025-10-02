package com.kuan.twsbridge.model;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Statistics summary object
 */
public class DataStatistics {
    private long totalBars;
    private LocalDateTime earliestBar;
    private LocalDateTime latestBar;
    private int tradingDays;
    private int completeDays;
    private int incompleteDays;
    private double averageCoverage;
    private List<DataGap> recentGaps;
    private List<CollectionRun> recentRuns;
    
    // Constructor
    public DataStatistics() {}
    
    // Getters and Setters
    public long getTotalBars() { return totalBars; }
    public void setTotalBars(long totalBars) { this.totalBars = totalBars; }
    
    public LocalDateTime getEarliestBar() { return earliestBar; }
    public void setEarliestBar(LocalDateTime earliestBar) { this.earliestBar = earliestBar; }
    
    public LocalDateTime getLatestBar() { return latestBar; }
    public void setLatestBar(LocalDateTime latestBar) { this.latestBar = latestBar; }
    
    public int getTradingDays() { return tradingDays; }
    public void setTradingDays(int tradingDays) { this.tradingDays = tradingDays; }
    
    public int getCompleteDays() { return completeDays; }
    public void setCompleteDays(int completeDays) { this.completeDays = completeDays; }
    
    public int getIncompleteDays() { return incompleteDays; }
    public void setIncompleteDays(int incompleteDays) { this.incompleteDays = incompleteDays; }
    
    public double getAverageCoverage() { return averageCoverage; }
    public void setAverageCoverage(double averageCoverage) { this.averageCoverage = averageCoverage; }
    
    public List<DataGap> getRecentGaps() { return recentGaps; }
    public void setRecentGaps(List<DataGap> recentGaps) { this.recentGaps = recentGaps; }
    
    public List<CollectionRun> getRecentRuns() { return recentRuns; }
    public void setRecentRuns(List<CollectionRun> recentRuns) { this.recentRuns = recentRuns; }
}