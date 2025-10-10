package com.kuan.twsbridge.event;

import com.ib.client.Bar;
import org.springframework.context.ApplicationEvent;

/**
 * Event published when a real-time historical data update is received
 * (when keepUpToDate=true for historical data requests)
 */
public class HistoricalDataUpdateEvent extends ApplicationEvent {
    private final int reqId;
    private final Bar bar;

    public HistoricalDataUpdateEvent(Object source, int reqId, Bar bar) {
        super(source);
        this.reqId = reqId;
        this.bar = bar;
    }

    public int getReqId() { return reqId; }
    public Bar getBar() { return bar; }
}
