package com.kuan.twsbridge.service;

import com.ib.client.*;
import com.kuan.twsbridge.event.HistoricalDataEndEvent;
import com.kuan.twsbridge.event.HistoricalDataEvent;
import com.kuan.twsbridge.event.HistoricalDataUpdateEvent;

import io.nats.client.Connection;
import io.nats.client.Nats;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Date;
import java.util.TimeZone;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.context.event.EventListener;

@Service
public class MarketDataService {
    
	private static final Logger log = LoggerFactory.getLogger(MarketDataService.class);
	
	@Autowired
    private IBConnectionManager connectionManager;
    
    @Value("${nats.url:nats://localhost:4222}")
    private String natsUrl;
    
    private Connection natsConnection;
    private final AtomicInteger requestId = new AtomicInteger(1000);
    private Integer spyRequestId = null;
    private final AtomicBoolean isSubscribed = new AtomicBoolean(false);
    private String lastPublishedBarTime = null; // Track last published bar to avoid duplicates

    private static final String NATS_SUBJECT_BARS = "md.equity.spy.bars.1m";
    private static final String NATS_SUBJECT_PRICE = "market.prices.SPY";
    private static final SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
    private static final DateTimeFormatter endTimeFormatter = DateTimeFormatter.ofPattern("yyyyMMdd HH:mm:ss");
    
    static {
        dateFormat.setTimeZone(TimeZone.getTimeZone("America/New_York"));
    }
    
    @Autowired
    public MarketDataService(IBConnectionManager connectionManager) {
        this.connectionManager = connectionManager;
        log.info("MarketDataService created");
    }
    
    @PostConstruct
    public void init() {
        try {
            // Connect to NATS
            log.info("Connecting to NATS at {}", natsUrl);
            natsConnection = Nats.connect(natsUrl);
            log.info("Successfully connected to NATS");

        } catch (Exception e) {
            log.error("Failed to connect to NATS", e);
        }
    }
    
    @PreDestroy
    public void cleanup() {
        try {
            if (isSubscribed.get()) {
                unsubscribeSPYBars();
            }
            if (natsConnection != null) {
                natsConnection.close();
                log.info("NATS connection closed");
            }
        } catch (Exception e) {
            log.error("Error during cleanup", e);
        }
    }
    
 // Event listeners for historical data
    @EventListener
    public void handleHistoricalDataEvent(HistoricalDataEvent event) {
        // Only process if it's for our subscription (initial historical bars)
    	log.debug("HistoricalDataEvent received - reqId: {}", event.getReqId());

        if (spyRequestId != null && event.getReqId() == spyRequestId) {
            onHistoricalData(event.getReqId(), event.getBar());
        }
    }

    @EventListener
    public void handleHistoricalDataUpdateEvent(HistoricalDataUpdateEvent event) {
        // Only process if it's for our subscription (real-time updates)
        log.debug("HistoricalDataUpdateEvent received - reqId: {}", event.getReqId());

        if (spyRequestId != null && event.getReqId() == spyRequestId) {
            onHistoricalDataUpdate(event.getReqId(), event.getBar());
        }
    }

    @EventListener
    public void handleHistoricalDataEndEvent(HistoricalDataEndEvent event) {
        if (spyRequestId != null && event.getReqId() == spyRequestId) {
            onHistoricalDataEnd(event.getReqId(), event.getStartDate(), event.getEndDate());
        }
    }
    
    /**
     * Subscribe to SPY 1-minute bars using Historical Data with keep-up-to-date
     * This is the BETTER approach - we get accurate 1-minute bars directly from IB
     */
    public boolean subscribeSPYBars1Min() {
        // Check if already subscribed
        if (isSubscribed.get()) {
            log.warn("Already subscribed to SPY bars");
            return true;
        }
        
        // Check IB connection
        if (!connectionManager.getConnected().get()) {
            log.error("Cannot subscribe: IB is not connected");
            return false;
        }
        
        // Check NATS connection
        if (natsConnection == null || natsConnection.getStatus() != Connection.Status.CONNECTED) {
            log.error("Cannot subscribe: NATS is not connected");
            return false;
        }
        
        try {
            // Create SPY contract
            Contract contract = new Contract();
            contract.symbol("SPY");
            contract.secType("STK");
            contract.currency("USD");
            contract.exchange("SMART");
            contract.primaryExch("ARCA");
            
            // Generate unique request ID
            spyRequestId = requestId.incrementAndGet();
            
            // Get current time for end date
            LocalDateTime now = LocalDateTime.now(ZoneId.of("America/New_York"));
            String endDateTime = ""; //now.format(endTimeFormatter) + " US/Eastern";
            
            // Request historical data with keep-up-to-date
            // This will give us 1-minute bars and continue updating with new bars
            connectionManager.getClient().reqHistoricalData(
                spyRequestId,
                contract,
                endDateTime,          // end date/time
                "1 D",                // duration (1 day of data initially)
                "1 min",              // bar size - native 1 minute bars!
                "TRADES",             // what to show
                1,                    // useRTH: 0 = include extended hours
                1,                    // formatDate: 1 = yyyyMMdd HH:mm:ss
                true,                 // keepUpToDate: true = continue receiving new bars
                null                  // chartOptions
            );
            
            isSubscribed.set(true);
            log.info("Subscribed to SPY 1-minute historical bars with keep-up-to-date, request ID: {}", spyRequestId);
            
            return true;
            
        } catch (Exception e) {
            log.error("Failed to subscribe to SPY bars", e);
            return false;
        }
    }
    
    /**
     * Unsubscribe from SPY 1-minute bars
     */
    public boolean unsubscribeSPYBars() {
        if (!isSubscribed.get() || spyRequestId == null) {
            log.warn("Not subscribed to SPY bars");
            return false;
        }

        if (!connectionManager.getConnected().get()) {
            log.warn("IB is not connected, marking as unsubscribed");
            isSubscribed.set(false);
            spyRequestId = null;
            lastPublishedBarTime = null; // Reset for next subscription
            return true;
        }

        try {
            // Cancel historical data subscription
            connectionManager.getClient().cancelHistoricalData(spyRequestId);
            isSubscribed.set(false);

            log.info("Unsubscribed from SPY bars (request ID: {})", spyRequestId);
            spyRequestId = null;
            lastPublishedBarTime = null; // Reset for next subscription

            return true;

        } catch (Exception e) {
            log.error("Failed to unsubscribe from SPY bars", e);
            return false;
        }
    }
    
    /**
     * Called by IBConnectionManager when historical bar data is received
     * This includes both initial historical bars and new real-time bars (when keepUpToDate=true)
     */
    public void onHistoricalData(int reqId, Bar bar) {
        if (reqId != spyRequestId) {
            return; // Not our subscription
        }
        
        // This is a proper 1-minute bar from IB - no aggregation needed!
        publishToNats(bar);
    }
    
    /**
     * Called when initial historical data load is complete
     * After this, we'll continue receiving real-time bars
     */
    public void onHistoricalDataEnd(int reqId, String startDateStr, String endDateStr) {
        if (reqId != spyRequestId) {
            return;
        }
        
        log.info("Historical data initial load complete. Start: {}, End: {}. Now receiving real-time updates...", 
                 startDateStr, endDateStr);
    }
    
    /**
     * Called when a new bar is received (real-time update when keepUpToDate=true)
     */
    public void onHistoricalDataUpdate(int reqId, Bar bar) {
        if (reqId != spyRequestId) {
            return;
        }
        
        log.debug("Real-time bar update received");
        publishToNats(bar);
    }
    
    /**
     * Publish bar data to NATS
     * Dual-publish: full bars + simple price for trading system
     * Deduplicates bars with same timestamp (IB sends multiple updates as bar forms)
     */
    private void publishToNats(Bar bar) {
        if (natsConnection == null || natsConnection.getStatus() != Connection.Status.CONNECTED) {
            log.warn("Cannot publish to NATS: not connected");
            return;
        }

        try {
            // Parse the bar time (format: yyyyMMdd HH:mm:ss)
            String barTimeStr = bar.time();

            // Deduplicate: Only publish if this is a new bar (different timestamp)
            if (barTimeStr.equals(lastPublishedBarTime)) {
                log.debug("Skipping duplicate bar with timestamp: {}", barTimeStr);
                return;
            }

            log.info("Publishing new bar: {} (price: {}, volume: {})",
                     barTimeStr, bar.close(), bar.volume().longValue());

            // Update last published timestamp
            lastPublishedBarTime = barTimeStr;

            // 1. Publish full OHLCV bar data to md.equity.spy.bars.1m
            String barJson = String.format(
                "{\"symbol\":\"SPY\",\"datetime\":\"%s\",\"open\":%.2f,\"high\":%.2f,\"low\":%.2f,\"close\":%.2f,\"volume\":%d,\"wap\":%.2f,\"count\":%d,\"barType\":\"1min\"}",
                barTimeStr,
                bar.open(),
                bar.high(),
                bar.low(),
                bar.close(),
                bar.volume().longValue(),
                bar.wap().value(),
                bar.count()
            );

            natsConnection.publish(NATS_SUBJECT_BARS, barJson.getBytes(StandardCharsets.UTF_8));
            log.debug("Published SPY 1-min bar to {}", NATS_SUBJECT_BARS);

            // 2. Publish simple price to market.prices.SPY (for trading system)
            String priceJson = String.format(
                "{\"symbol\":\"SPY\",\"price\":%.2f,\"timestamp\":\"%s\"}",
                bar.close(),
                barTimeStr
            );

            natsConnection.publish(NATS_SUBJECT_PRICE, priceJson.getBytes(StandardCharsets.UTF_8));
            log.debug("Published SPY price to {}", NATS_SUBJECT_PRICE);

        } catch (Exception e) {
            log.error("Failed to publish to NATS", e);
        }
    }
}