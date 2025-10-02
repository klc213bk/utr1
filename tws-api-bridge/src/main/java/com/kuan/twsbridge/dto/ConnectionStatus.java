package com.kuan.twsbridge.dto;

public class ConnectionStatus {
    private boolean connected;
    private int nextOrderId;
    private long timestamp;
    private String message;
    
    // Default constructor
    public ConnectionStatus() {
    }
    
    // Constructor with all fields
    public ConnectionStatus(boolean connected, int nextOrderId, long timestamp, String message) {
        this.connected = connected;
        this.nextOrderId = nextOrderId;
        this.timestamp = timestamp;
        this.message = message;
    }
    
    // Getters and Setters
    public boolean isConnected() {
        return connected;
    }
    
    public void setConnected(boolean connected) {
        this.connected = connected;
    }
    
    public int getNextOrderId() {
        return nextOrderId;
    }
    
    public void setNextOrderId(int nextOrderId) {
        this.nextOrderId = nextOrderId;
    }
    
    public long getTimestamp() {
        return timestamp;
    }
    
    public void setTimestamp(long timestamp) {
        this.timestamp = timestamp;
    }
    
    public String getMessage() {
        return message;
    }
    
    public void setMessage(String message) {
        this.message = message;
    }
    
    @Override
    public String toString() {
        return "ConnectionStatus{" +
                "connected=" + connected +
                ", nextOrderId=" + nextOrderId +
                ", timestamp=" + timestamp +
                ", message='" + message + '\'' +
                '}';
    }
}
