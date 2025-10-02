package com.kuan.twsbridge.model;

import java.time.LocalDateTime;

/**
 * Represents a collection run (historical data request)
 */
public class CollectionRun {
    private Long id;
    private String collectionType;
    private String requestParams;
    private LocalDateTime startedAt;
    private LocalDateTime completedAt;
    private Integer durationSeconds;
    private LocalDateTime periodStart;
    private LocalDateTime periodEnd;
    private String barSize;
    private Integer barsRequested;
    private Integer barsReceived;
    private Integer barsSaved;
    private Integer barsDuplicates;
    private Integer barsFailed;
    private String status;
    private Integer errorCode;
    private String errorMessage;
    private Integer ibRequestId;
    private String triggeredBy;
    
    // Constructors
    public CollectionRun() {}
    
    // Business methods
    public boolean isSuccessful() {
        return "completed".equals(status);
    }
    
    public boolean isFailed() {
        return "failed".equals(status) || "error".equals(status);
    }
    
    public boolean isRunning() {
        return "running".equals(status);
    }
    
    public double getSuccessRate() {
        if (barsRequested == null || barsRequested == 0) return 0;
        if (barsSaved == null) return 0;
        return (double) barsSaved / barsRequested * 100;
    }
    
    public String getDurationFormatted() {
        if (durationSeconds == null) return "N/A";
        int minutes = durationSeconds / 60;
        int seconds = durationSeconds % 60;
        return String.format("%d:%02d", minutes, seconds);
    }
    
    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    
    public String getCollectionType() { return collectionType; }
    public void setCollectionType(String collectionType) { this.collectionType = collectionType; }
    
    public String getRequestParams() { return requestParams; }
    public void setRequestParams(String requestParams) { this.requestParams = requestParams; }
    
    public LocalDateTime getStartedAt() { return startedAt; }
    public void setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; }
    
    public LocalDateTime getCompletedAt() { return completedAt; }
    public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }
    
    public Integer getDurationSeconds() { return durationSeconds; }
    public void setDurationSeconds(Integer durationSeconds) { this.durationSeconds = durationSeconds; }
    
    public LocalDateTime getPeriodStart() { return periodStart; }
    public void setPeriodStart(LocalDateTime periodStart) { this.periodStart = periodStart; }
    
    public LocalDateTime getPeriodEnd() { return periodEnd; }
    public void setPeriodEnd(LocalDateTime periodEnd) { this.periodEnd = periodEnd; }
    
    public String getBarSize() { return barSize; }
    public void setBarSize(String barSize) { this.barSize = barSize; }
    
    public Integer getBarsRequested() { return barsRequested; }
    public void setBarsRequested(Integer barsRequested) { this.barsRequested = barsRequested; }
    
    public Integer getBarsReceived() { return barsReceived; }
    public void setBarsReceived(Integer barsReceived) { this.barsReceived = barsReceived; }
    
    public Integer getBarsSaved() { return barsSaved; }
    public void setBarsSaved(Integer barsSaved) { this.barsSaved = barsSaved; }
    
    public Integer getBarsDuplicates() { return barsDuplicates; }
    public void setBarsDuplicates(Integer barsDuplicates) { this.barsDuplicates = barsDuplicates; }
    
    public Integer getBarsFailed() { return barsFailed; }
    public void setBarsFailed(Integer barsFailed) { this.barsFailed = barsFailed; }
    
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    
    public Integer getErrorCode() { return errorCode; }
    public void setErrorCode(Integer errorCode) { this.errorCode = errorCode; }
    
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    
    public Integer getIbRequestId() { return ibRequestId; }
    public void setIbRequestId(Integer ibRequestId) { this.ibRequestId = ibRequestId; }
    
    public String getTriggeredBy() { return triggeredBy; }
    public void setTriggeredBy(String triggeredBy) { this.triggeredBy = triggeredBy; }
}
