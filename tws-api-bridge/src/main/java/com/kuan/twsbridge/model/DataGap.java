package com.kuan.twsbridge.model;

import java.time.LocalDateTime;

/**
 * Represents a gap in historical data
 */
public class DataGap {
    private Long id;
    private LocalDateTime gapStart;
    private LocalDateTime gapEnd;
    private int minutes;
    private String status;
    private int fillAttempts;
    private LocalDateTime detectedAt;
    private String detectedBy;
    private LocalDateTime filledAt;
    private Long filledByCollectionId;
    
    // Constructors
    public DataGap() {}
    
    public DataGap(LocalDateTime gapStart, LocalDateTime gapEnd) {
        this.gapStart = gapStart;
        this.gapEnd = gapEnd;
        this.minutes = (int) java.time.Duration.between(gapStart, gapEnd).toMinutes();
        this.status = "detected";
        this.detectedAt = LocalDateTime.now();
    }
    
    // Business methods
    public boolean isBeingFilled() {
        return "filling".equals(status);
    }
    
    public boolean isFilled() {
        return "filled".equals(status);
    }
    
    public int getDaysOld() {
        return (int) java.time.Duration.between(gapStart.toLocalDate().atStartOfDay(), 
                                                LocalDateTime.now()).toDays();
    }
    
    public boolean isSignificant() {
        return minutes > 5; // Gaps larger than 5 minutes are significant
    }
    
    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    
    public LocalDateTime getGapStart() { return gapStart; }
    public void setGapStart(LocalDateTime gapStart) { this.gapStart = gapStart; }
    
    public LocalDateTime getGapEnd() { return gapEnd; }
    public void setGapEnd(LocalDateTime gapEnd) { this.gapEnd = gapEnd; }
    
    public int getMinutes() { return minutes; }
    public void setMinutes(int minutes) { this.minutes = minutes; }
    
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    
    public int getFillAttempts() { return fillAttempts; }
    public void setFillAttempts(int fillAttempts) { this.fillAttempts = fillAttempts; }
    
    public LocalDateTime getDetectedAt() { return detectedAt; }
    public void setDetectedAt(LocalDateTime detectedAt) { this.detectedAt = detectedAt; }
    
    public String getDetectedBy() { return detectedBy; }
    public void setDetectedBy(String detectedBy) { this.detectedBy = detectedBy; }
    
    public LocalDateTime getFilledAt() { return filledAt; }
    public void setFilledAt(LocalDateTime filledAt) { this.filledAt = filledAt; }
    
    public Long getFilledByCollectionId() { return filledByCollectionId; }
    public void setFilledByCollectionId(Long filledByCollectionId) { this.filledByCollectionId = filledByCollectionId; }
}
