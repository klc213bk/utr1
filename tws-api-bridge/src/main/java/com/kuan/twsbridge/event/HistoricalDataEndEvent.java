package com.kuan.twsbridge.event;

import org.springframework.context.ApplicationEvent;

public class HistoricalDataEndEvent extends ApplicationEvent {
    private final int reqId;
    private final String startDate;
    private final String endDate;
    
    public HistoricalDataEndEvent(Object source, int reqId, String startDate, String endDate) {
        super(source);
        this.reqId = reqId;
        this.startDate = startDate;
        this.endDate = endDate;
    }
    
    public int getReqId() { return reqId; }
    public String getStartDate() { return startDate; }
    public String getEndDate() { return endDate; }
}
