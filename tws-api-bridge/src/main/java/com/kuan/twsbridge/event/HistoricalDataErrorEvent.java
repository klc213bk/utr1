package com.kuan.twsbridge.event;

import org.springframework.context.ApplicationEvent;

public class HistoricalDataErrorEvent extends ApplicationEvent {
    private final int reqId;
    private final int errorCode;
    private final String errorMsg;
    
    public HistoricalDataErrorEvent(Object source, int reqId, int errorCode, String errorMsg) {
        super(source);
        this.reqId = reqId;
        this.errorCode = errorCode;
        this.errorMsg = errorMsg;
    }
    
    public int getReqId() { return reqId; }
    public int getErrorCode() { return errorCode; }
    public String getErrorMsg() { return errorMsg; }
}
