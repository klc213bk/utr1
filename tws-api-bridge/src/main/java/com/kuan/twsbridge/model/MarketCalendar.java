package com.kuan.twsbridge.model;

import java.time.LocalDate;
import java.time.LocalTime;

/**
 * Market calendar entry
 */
public class MarketCalendar {
    private LocalDate date;
    private String marketStatus;
    private LocalTime marketOpen;
    private LocalTime marketClose;
    private boolean isHoliday;
    private String holidayName;
    private boolean isHalfDay;
    private String halfDayReason;
    private int expectedRegularBars;
    
    // Constructors
    public MarketCalendar() {}
    
    // Business methods
    public boolean isTradingDay() {
        return "open".equals(marketStatus) || "half_day".equals(marketStatus);
    }
    
    public boolean isNormalTradingDay() {
        return "open".equals(marketStatus);
    }
    
    // Getters and Setters
    public LocalDate getDate() { return date; }
    public void setDate(LocalDate date) { this.date = date; }
    
    public String getMarketStatus() { return marketStatus; }
    public void setMarketStatus(String marketStatus) { this.marketStatus = marketStatus; }
    
    public LocalTime getMarketOpen() { return marketOpen; }
    public void setMarketOpen(LocalTime marketOpen) { this.marketOpen = marketOpen; }
    
    public LocalTime getMarketClose() { return marketClose; }
    public void setMarketClose(LocalTime marketClose) { this.marketClose = marketClose; }
    
    public boolean isHoliday() { return isHoliday; }
    public void setHoliday(boolean holiday) { isHoliday = holiday; }
    
    public String getHolidayName() { return holidayName; }
    public void setHolidayName(String holidayName) { this.holidayName = holidayName; }
    
    public boolean isHalfDay() { return isHalfDay; }
    public void setHalfDay(boolean halfDay) { isHalfDay = halfDay; }
    
    public String getHalfDayReason() { return halfDayReason; }
    public void setHalfDayReason(String halfDayReason) { this.halfDayReason = halfDayReason; }
    
    public int getExpectedRegularBars() { return expectedRegularBars; }
    public void setExpectedRegularBars(int expectedRegularBars) { this.expectedRegularBars = expectedRegularBars; }
}
