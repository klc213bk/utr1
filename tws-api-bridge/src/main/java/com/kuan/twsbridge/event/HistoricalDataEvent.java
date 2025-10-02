package com.kuan.twsbridge.event;

import com.ib.client.Bar;
import org.springframework.context.ApplicationEvent;

public class HistoricalDataEvent extends ApplicationEvent {
    private final int reqId;
    private final Bar bar;
    
    public HistoricalDataEvent(Object source, int reqId, Bar bar) {
        super(source);
        this.reqId = reqId;
        this.bar = bar;
    }
    
    public int getReqId() { return reqId; }
    public Bar getBar() { return bar; }
}
