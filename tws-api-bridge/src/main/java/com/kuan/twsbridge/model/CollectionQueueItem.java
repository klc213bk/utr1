package com.kuan.twsbridge.model;

import java.time.LocalDateTime;

/**
 * Collection queue item
 */
public class CollectionQueueItem {
    private Long id;
    private int priority;
    private String collectionType;
    private LocalDateTime periodStart;
    private LocalDateTime periodEnd;
    private String barSize;
    private String status;
    private int retryCount;
    private int maxRetries;
    private LocalDateTime scheduledFor;
    private LocalDateTime pickedUpAt;
    private LocalDateTime completedAt;
    private String lastError;
    private String requestSource;
    
    // Constructors
    public CollectionQueueItem() {
        this.priority = 5;
        this.status = "pending";
        this.maxRetries = 3;
        this.barSize = "1 min";
    }
    
    // Business methods
    public boolean canRetry() {
        return retryCount < maxRetries;
    }
    
    public boolean isReady() {
        return "pending".equals(status) && 
               (scheduledFor == null || scheduledFor.isBefore(LocalDateTime.now()));
    }
    
    public void incrementRetry() {
        this.retryCount++;
    }
    
    // Getters and Setters (abbreviated for space - add all fields)
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    
    public int getPriority() { return priority; }
    public void setPriority(int priority) { this.priority = priority; }
    
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    
    // ... add remaining getters/setters
}
