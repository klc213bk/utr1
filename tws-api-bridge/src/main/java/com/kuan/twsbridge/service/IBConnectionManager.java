package com.kuan.twsbridge.service;

import com.ib.client.*;
import com.ib.client.protobuf.ErrorMessageProto.ErrorMessage;
import com.ib.client.protobuf.ExecutionDetailsEndProto.ExecutionDetailsEnd;
import com.ib.client.protobuf.ExecutionDetailsProto.ExecutionDetails;
import com.ib.client.protobuf.OpenOrderProto.OpenOrder;
import com.ib.client.protobuf.OpenOrdersEndProto.OpenOrdersEnd;
import com.ib.client.protobuf.OrderStatusProto.OrderStatus;
import com.kuan.twsbridge.event.HistoricalDataEndEvent;
import com.kuan.twsbridge.event.HistoricalDataErrorEvent;
import com.kuan.twsbridge.event.HistoricalDataEvent;
import com.kuan.twsbridge.event.HistoricalDataUpdateEvent;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

@Service
public class IBConnectionManager implements EWrapper {
    
	private static final Logger log = LoggerFactory.getLogger(IBConnectionManager.class);
	
	@Autowired
	private ApplicationEventPublisher eventPublisher;
	 
    private EClientSocket client;
    private EReaderSignal signal;
    private EReader reader;

    private final AtomicBoolean connected = new AtomicBoolean(false);
    
    private final AtomicInteger nextOrderId = new AtomicInteger(-1);
    
    @Value("${ib.host:127.0.0.1}")
    private String host;
    
    @Value("${ib.port:7497}")  // 7497 for TWS Paper, 7496 for TWS Live, 4002 for IB Gateway Paper
    private int port;
    
    @Value("${ib.clientId:0}")
    private int clientId;
    
    public IBConnectionManager() {
    	log.info("==========================================");
        log.info("IBConnectionManager instance created: {}", this.hashCode());
        log.info("==========================================");
    }
    
    @PostConstruct
    public void init() {
        log.info("Initializing IB Connection Manager");
        signal = new EJavaSignal();
        client = new EClientSocket(this, signal);
    }
    
    public boolean connect() {
    	log.info("Connect called on IBConnectionManager instance: {}", this.hashCode());
        
        if (connected.get()) {
            log.info("Already connected to TWS/IB Gateway");
            return true;
        }
        
        try {
            log.info("Attempting to connect to TWS/IB Gateway at {}:{}", host, port);
            client.eConnect(host, port, clientId);
            
            if (client.isConnected()) {
                log.info("Socket connection established");
                
                // Start the reader thread
                reader = new EReader(client, signal);
                reader.start();
                
                // Start processing messages
                new Thread(() -> {
                    while (client.isConnected()) {
                        signal.waitForSignal();
                        try {
                            reader.processMsgs();
                        } catch (Exception e) {
                            log.error("Error processing messages", e);
                        }
                    }
                }, "EReader-Thread").start();
                
                // Wait a bit for connection to be fully established
                Thread.sleep(500);
                
                return connected.get();
            }
        } catch (Exception e) {
            log.error("Failed to connect to TWS/IB Gateway", e);
        }
        
        return false;
    }
    
    public void disconnect() {
        if (client != null && client.isConnected()) {
            log.info("Disconnecting from TWS/IB Gateway");
            connected.set(false);
            client.eDisconnect();
        }
    }
    
    @PreDestroy
    public void cleanup() {
        disconnect();
    }
    
    // ===== EWrapper Implementation - Only implementing essential methods =====
    
    @Override
    public void nextValidId(int orderId) {
        log.info("Next valid order ID: {}", orderId);
        nextOrderId.set(orderId);
        connected.set(true);
    }
    
    @Override
    public void connectAck() {
        log.info("Connection acknowledged by TWS/IB Gateway");
        client.startAPI();
    }
    
    @Override
    public void connectionClosed() {
        log.warn("Connection to TWS/IB Gateway closed");
        connected.set(false);
    }
    
//    @Override
//    public void error(int id, int errorCode, String errorMsg, String advancedOrderRejectJson) {
//        String message = String.format("Error - Id: %d, Code: %d, Msg: %s", id, errorCode, errorMsg);
//        
//        // Connection-related error codes
//        if (errorCode == 502) { // Cannot connect to TWS
//            log.error(message);
//            connected.set(false);
//        } else if (errorCode == 504) { // Not connected
//            log.warn(message);
//            connected.set(false);
//        } else if (errorCode >= 2100 && errorCode < 2200) { // Connection-related warnings
//            log.warn(message);
//        } else {
//            log.info(message);
//        }
//    }
    
    // ===== Other required EWrapper methods with empty implementations =====
    
    @Override
    public void tickPrice(int tickerId, int field, double price, TickAttrib attrib) {}
    
    @Override
    public void tickSize(int tickerId, int field, Decimal size) {}
    
    @Override
    public void tickOptionComputation(int tickerId, int field, int tickAttrib, double impliedVol,
            double delta, double optPrice, double pvDividend, double gamma, double vega, 
            double theta, double undPrice) {}
    
    @Override
    public void tickGeneric(int tickerId, int tickType, double value) {}
    
    @Override
    public void tickString(int tickerId, int tickType, String value) {}
    
    @Override
    public void tickEFP(int tickerId, int tickType, double basisPoints, String formattedBasisPoints,
            double impliedFuture, int holdDays, String futureLastTradeDate, double dividendImpact,
            double dividendsToLastTradeDate) {}
    
    @Override
    public void orderStatus(int orderId, String status, Decimal filled, Decimal remaining, 
            double avgFillPrice, long permId, int parentId, double lastFillPrice, int clientId, 
            String whyHeld, double mktCapPrice) {}
	
    @Override
    public void openOrder(int orderId, Contract contract, Order order, OrderState orderState) {}
    
    @Override
    public void openOrderEnd() {}
    
    @Override
    public void updateAccountValue(String key, String value, String currency, String accountName) {}
    
    @Override
    public void updatePortfolio(Contract contract, Decimal position, double marketPrice, 
            double marketValue, double averageCost, double unrealizedPNL, double realizedPNL, 
            String accountName) {}
    
    @Override
    public void updateAccountTime(String timeStamp) {}
    
    @Override
    public void accountDownloadEnd(String accountName) {}
    
    @Override
    public void contractDetails(int reqId, ContractDetails contractDetails) {}
    
    @Override
    public void bondContractDetails(int reqId, ContractDetails contractDetails) {}
    
    @Override
    public void contractDetailsEnd(int reqId) {}
    
    @Override
    public void execDetails(int reqId, Contract contract, Execution execution) {}
    
    @Override
    public void execDetailsEnd(int reqId) {}
    
    @Override
    public void updateMktDepth(int tickerId, int position, int operation, int side, double price, 
            Decimal size) {}
    
    @Override
    public void updateMktDepthL2(int tickerId, int position, String marketMaker, int operation, 
            int side, double price, Decimal size, boolean isSmartDepth) {}
    
    @Override
    public void updateNewsBulletin(int msgId, int msgType, String message, String origExchange) {}
    
    @Override
    public void managedAccounts(String accountsList) {
        log.info("Managed accounts: {}", accountsList);
    }
    
    @Override
    public void receiveFA(int faDataType, String xml) {}
    
    @Override
    public void historicalData(int reqId, Bar bar) {
    	log.debug("Historical bar - ReqId: {}, Time: {}", reqId, bar.time());
        
        // Publish event instead of direct service call
        eventPublisher.publishEvent(new HistoricalDataEvent(this, reqId, bar));
    }
    
    @Override
    public void scannerParameters(String xml) {}
    
    @Override
    public void scannerData(int reqId, int rank, ContractDetails contractDetails, String distance, 
            String benchmark, String projection, String legsStr) {}
    
    @Override
    public void scannerDataEnd(int reqId) {}
    
    @Override
    public void realtimeBar(int reqId, long time, double open, double high, double low, double close, 
            Decimal volume, Decimal wap, int count) {}
    
    @Override
    public void currentTime(long time) {}
    
    @Override
    public void fundamentalData(int reqId, String data) {}
    
    @Override
    public void deltaNeutralValidation(int reqId, DeltaNeutralContract deltaNeutralContract) {}
    
    @Override
    public void tickSnapshotEnd(int reqId) {}
    
    @Override
    public void marketDataType(int reqId, int marketDataType) {}
      
    @Override
    public void position(String account, Contract contract, Decimal pos, double avgCost) {}
    
    @Override
    public void positionEnd() {}
    
    @Override
    public void accountSummary(int reqId, String account, String tag, String value, String currency) {}
    
    @Override
    public void accountSummaryEnd(int reqId) {}
    
    @Override
    public void verifyMessageAPI(String apiData) {}
    
    @Override
    public void verifyCompleted(boolean isSuccessful, String errorText) {}
    
    @Override
    public void verifyAndAuthMessageAPI(String apiData, String xyzChallenge) {}
    
    @Override
    public void verifyAndAuthCompleted(boolean isSuccessful, String errorText) {}
    
    @Override
    public void displayGroupList(int reqId, String groups) {}
    
    @Override
    public void displayGroupUpdated(int reqId, String contractInfo) {}
    
    @Override
    public void error(Exception e) {
        log.error("Exception in IB API", e);
    }
    
    @Override
    public void error(String str) {
        log.error("IB API error: {}", str);
    }
    
    @Override
    public void positionMulti(int reqId, String account, String modelCode, Contract contract, 
            Decimal pos, double avgCost) {}
    
    @Override
    public void positionMultiEnd(int reqId) {}
    
    @Override
    public void accountUpdateMulti(int reqId, String account, String modelCode, String key, 
            String value, String currency) {}
    
    @Override
    public void accountUpdateMultiEnd(int reqId) {}
    
    @Override
    public void securityDefinitionOptionalParameter(int reqId, String exchange, int underlyingConId, 
            String tradingClass, String multiplier, Set<String> expirations, Set<Double> strikes) {}
    
    @Override
    public void securityDefinitionOptionalParameterEnd(int reqId) {}
    
    @Override
    public void softDollarTiers(int reqId, SoftDollarTier[] tiers) {}
    
    @Override
    public void familyCodes(FamilyCode[] familyCodes) {}
    
    @Override
    public void symbolSamples(int reqId, ContractDescription[] contractDescriptions) {}
    
    @Override
    public void historicalDataEnd(int reqId, String startDateStr, String endDateStr) {
    	log.info("Historical data end - ReqId: {}, Start: {}, End: {}", 
                reqId, startDateStr, endDateStr);
       
    	// Publish event
    	eventPublisher.publishEvent(new HistoricalDataEndEvent(this, reqId, startDateStr, endDateStr));
    }
    
    @Override
    public void mktDepthExchanges(DepthMktDataDescription[] depthMktDataDescriptions) {}
    
    @Override
    public void tickNews(int tickerId, long timeStamp, String providerCode, String articleId, 
            String headline, String extraData) {}
    
    @Override
    public void smartComponents(int reqId, Map<Integer, Map.Entry<String, Character>> theMap) {}
    
    @Override
    public void tickReqParams(int tickerId, double minTick, String bboExchange, int snapshotPermissions) {}
    
    @Override
    public void newsProviders(NewsProvider[] newsProviders) {}
    
    @Override
    public void newsArticle(int requestId, int articleType, String articleText) {}
    
    @Override
    public void historicalNews(int requestId, String time, String providerCode, String articleId, 
            String headline) {}
    
    @Override
    public void historicalNewsEnd(int requestId, boolean hasMore) {}
    
    @Override
    public void headTimestamp(int reqId, String headTimestamp) {}
    
    @Override
    public void histogramData(int reqId, List<HistogramEntry> items) {}
    
    @Override
    public void historicalDataUpdate(int reqId, Bar bar) {
    	log.debug("Historical data update (real-time) - ReqId: {}, Time: {}, Close: {}",
                reqId, bar.time(), bar.close());

        // Publish UPDATE event (separate from initial historical data)
        eventPublisher.publishEvent(new HistoricalDataUpdateEvent(this, reqId, bar));
    }
    
    @Override
    public void rerouteMktDataReq(int reqId, int conId, String exchange) {}
    
    @Override
    public void rerouteMktDepthReq(int reqId, int conId, String exchange) {}
    
    @Override
    public void marketRule(int marketRuleId, PriceIncrement[] priceIncrements) {}
    
    @Override
    public void pnl(int reqId, double dailyPnL, double unrealizedPnL, double realizedPnL) {}
    
    @Override
    public void pnlSingle(int reqId, Decimal pos, double dailyPnL, double unrealizedPnL, 
            double realizedPnL, double value) {}
    
    @Override
    public void historicalTicks(int reqId, List<HistoricalTick> ticks, boolean done) {}
    
    @Override
    public void historicalTicksBidAsk(int reqId, List<HistoricalTickBidAsk> ticks, boolean done) {}
    
    @Override
    public void historicalTicksLast(int reqId, List<HistoricalTickLast> ticks, boolean done) {}
    
    @Override
    public void tickByTickAllLast(int reqId, int tickType, long time, double price, Decimal size, 
            TickAttribLast tickAttribLast, String exchange, String specialConditions) {}
    
    @Override
    public void tickByTickBidAsk(int reqId, long time, double bidPrice, double askPrice, 
            Decimal bidSize, Decimal askSize, TickAttribBidAsk tickAttribBidAsk) {}
    
    @Override
    public void tickByTickMidPoint(int reqId, long time, double midPoint) {}
    
    @Override
    public void orderBound(long orderId, int apiClientId, int apiOrderId) {}
    
    @Override
    public void completedOrder(Contract contract, Order order, OrderState orderState) {}
    
    @Override
    public void completedOrdersEnd() {}
    
    @Override
    public void replaceFAEnd(int reqId, String text) {}
    
    @Override
    public void wshMetaData(int reqId, String dataJson) {}
    
    @Override
    public void wshEventData(int reqId, String dataJson) {}
    
    @Override
    public void historicalSchedule(int reqId, String startDateTime, String endDateTime, 
            String timeZone, List<HistoricalSession> sessions) {}
    
    @Override
    public void userInfo(int reqId, String whiteBrandingId) {}

	@Override
	public void commissionAndFeesReport(CommissionAndFeesReport arg0) {
		// TODO Auto-generated method stub
		
	}

	@Override
	public void currentTimeInMillis(long arg0) {
		// TODO Auto-generated method stub
		
	}

	@Override
	public void error(int id, long errorTime, int errorCode, String errorMsg, String advancedOrderRejectJson) {
		// Connection-related error codes
        if (errorCode == 502 || errorCode == 504) {
            log.error(errorMsg);
            connected.set(false);
        } else if (errorCode >= 2100 && errorCode < 2200) {
            log.warn(errorMsg);
        } else if (errorCode == 162 || errorCode == 366 || errorCode == 321) {
            // Historical data related errors
            log.error("Historical data error - ReqId: {}, Code: {}, Msg: {}", id, errorCode, errorMsg);
            eventPublisher.publishEvent(new HistoricalDataErrorEvent(this, id, errorCode, errorMsg));
        } else {
            log.info(errorMsg);
        }
	}

	@Override
	public void errorProtoBuf(ErrorMessage arg0) {
		// TODO Auto-generated method stub
		
	}

	@Override
	public void execDetailsEndProtoBuf(ExecutionDetailsEnd arg0) {
		// TODO Auto-generated method stub
		
	}

	@Override
	public void execDetailsProtoBuf(ExecutionDetails arg0) {
		// TODO Auto-generated method stub
		
	}

	@Override
	public void openOrderProtoBuf(OpenOrder arg0) {
		// TODO Auto-generated method stub
		
	}

	@Override
	public void openOrdersEndProtoBuf(OpenOrdersEnd arg0) {
		// TODO Auto-generated method stub
		
	}

	@Override
	public void orderStatusProtoBuf(OrderStatus arg0) {
		// TODO Auto-generated method stub
		
	}

	public AtomicBoolean getConnected() {
		return connected;
	}

	public AtomicInteger getNextOrderId() {
		return nextOrderId;
	}


	public EClientSocket getClient() {
		return client;
	}


}
