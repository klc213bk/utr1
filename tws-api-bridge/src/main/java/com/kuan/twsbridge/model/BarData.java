// ============================================================================
// BarData.java (Missing model class)
// ============================================================================

package com.kuan.twsbridge.model;

import java.time.LocalDateTime;

/**
 * Represents a single bar of market data
 */
public class BarData {
    private LocalDateTime time;
    private double open;
    private double high;
    private double low;
    private double close;
    private long volume;
    private double vwap;
    private int count;
    
    // Constructors
    public BarData() {}
    
    public BarData(LocalDateTime time, double open, double high, double low, 
                   double close, long volume, double vwap, int count) {
        this.time = time;
        this.open = open;
        this.high = high;
        this.low = low;
        this.close = close;
        this.volume = volume;
        this.vwap = vwap;
        this.count = count;
    }
    
    // Business methods
    public double getRange() {
        return high - low;
    }
    
    public double getChange() {
        return close - open;
    }
    
    public double getChangePercent() {
        return open != 0 ? (close - open) / open * 100 : 0;
    }
    
    public boolean isGreen() {
        return close > open;
    }
    
    public boolean isRed() {
        return close < open;
    }
    
    // Getters and Setters
    public LocalDateTime getTime() { return time; }
    public void setTime(LocalDateTime time) { this.time = time; }
    
    public double getOpen() { return open; }
    public void setOpen(double open) { this.open = open; }
    
    public double getHigh() { return high; }
    public void setHigh(double high) { this.high = high; }
    
    public double getLow() { return low; }
    public void setLow(double low) { this.low = low; }
    
    public double getClose() { return close; }
    public void setClose(double close) { this.close = close; }
    
    public long getVolume() { return volume; }
    public void setVolume(long volume) { this.volume = volume; }
    
    public double getVwap() { return vwap; }
    public void setVwap(double vwap) { this.vwap = vwap; }
    
    public int getCount() { return count; }
    public void setCount(int count) { this.count = count; }
}
