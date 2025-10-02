import asyncio
import json
import os
import signal
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import nats
from datetime import datetime

app = FastAPI()

# Configure CORS immediately after creating app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for testing
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

shutdown_event = asyncio.Event()

class StrategyEngine:
    def __init__(self):
        self.nc = None
        self.strategies = {}
        self.bars_data = {}  # Store recent bars for each strategy
        self.running = True  # ADD: flag to control processing
        self.message_count = 0
        self.strategy_message_counts = {}  # Add per-strategy counting

    async def connect_nats(self):
        self.nc = await nats.connect("nats://localhost:4222")
        print("Connected to NATS")
        
    async def disconnect(self):  # ADD: cleanup method
        self.running = False
        if self.nc:
            await self.nc.close()
            print("Disconnected from NATS")

    async def process_bars(self, strategy_id, strategy_type="ma_cross"):
        print(f"📊 Setting up strategy: {strategy_id} (type: {strategy_type})")

        # Initialize counter for this strategy
        self.strategy_message_counts[strategy_id] = 0
        
        async def message_handler(msg):
            print(f"Received message on {msg.subject}")  # Debug: see if messages arrive
 
            self.message_count += 1
            self.strategy_message_counts[strategy_id] += 1  # Count per strategy
            
            if not self.running:
                return

            try:
                bar = json.loads(msg.data.decode())
                print(f"Processing bar: time={bar.get('time')}, close={bar.get('close')}")  # Debug

                # Simple MA crossover logic
                if strategy_id not in self.bars_data:
                    self.bars_data[strategy_id] = []
                
                close_price = float(bar.get('close', 0))
                self.bars_data[strategy_id].append(close_price)

                # Keep only last 50 bars
                # Keep only last 50 bars (or more for RSI)
                max_bars = 50 if strategy_type != "rsi" else 60
                if len(self.bars_data[strategy_id]) > max_bars:
                    self.bars_data[strategy_id].pop(0)
                
                # Route to appropriate strategy logic
                if strategy_type == "ma_cross":
                    await self.ma_crossover_strategy(strategy_id, bar, close_price)
                elif strategy_type == "rsi":
                    await self.rsi_strategy(strategy_id, bar, close_price)
                elif strategy_type == "buy_hold":
                    await self.buy_hold_strategy(strategy_id, bar, close_price)
                else:
                    # Default to MA crossover
                    await self.ma_crossover_strategy(strategy_id, bar, close_price)
                        
            except Exception as e:
                print(f"Error processing bar: {e}")
                import traceback
                traceback.print_exc()
        
        sub = await self.nc.subscribe("md.equity.spy.bars.1m.replay", cb=message_handler)
        self.strategies[strategy_id] = {
            "sub": sub, 
            "status": "running",
            "type": strategy_type
        }
        print(f"✅ Strategy {strategy_id} ({strategy_type}) subscribed to md.equity.spy.bars.1m.replay")

    async def ma_crossover_strategy(self, strategy_id, bar, close_price):
        """Moving Average Crossover Strategy (20/50)"""
        if len(self.bars_data[strategy_id]) >= 50:
            fast_ma = sum(self.bars_data[strategy_id][-20:]) / 20
            slow_ma = sum(self.bars_data[strategy_id][-50:]) / 50
            
            # Store previous state to detect crossovers
            if not hasattr(self, 'ma_states'):
                self.ma_states = {}
            
            prev_state = self.ma_states.get(strategy_id)
            curr_state = "above" if fast_ma > slow_ma else "below"
            
            # Detect crossover
            if prev_state and prev_state != curr_state:
                action = "BUY" if curr_state == "above" else "SELL"
                signal = {
                    "strategy_id": strategy_id,
                    "strategy_type": "ma_cross",
                    "action": action,
                    "symbol": "SPY",
                    "quantity": 100,
                    "timestamp": bar.get('time'),
                    "price": close_price,
                    "fast_ma": round(fast_ma, 2),
                    "slow_ma": round(slow_ma, 2)
                }
                await self.nc.publish(
                    f"strategy.signals.{strategy_id}", 
                    json.dumps(signal).encode()
                )
                print(f"🔔 MA SIGNAL: {action} at ${close_price:.2f} (Fast MA: {fast_ma:.2f}, Slow MA: {slow_ma:.2f})")
            
            self.ma_states[strategy_id] = curr_state

    async def rsi_strategy(self, strategy_id, bar, close_price):
        """RSI Strategy (14 period)"""
        if len(self.bars_data[strategy_id]) >= 15:  # Need at least 15 bars for RSI
            # Simple RSI calculation
            prices = self.bars_data[strategy_id][-15:]
            gains = []
            losses = []
            
            for i in range(1, len(prices)):
                change = prices[i] - prices[i-1]
                if change > 0:
                    gains.append(change)
                    losses.append(0)
                else:
                    gains.append(0)
                    losses.append(abs(change))
            
            avg_gain = sum(gains) / 14
            avg_loss = sum(losses) / 14
            
            if avg_loss == 0:
                rsi = 100
            else:
                rs = avg_gain / avg_loss
                rsi = 100 - (100 / (1 + rs))
            
            # Generate signals on RSI extremes
            if rsi < 30:  # Oversold
                signal = {
                    "strategy_id": strategy_id,
                    "strategy_type": "rsi",
                    "action": "BUY",
                    "symbol": "SPY",
                    "quantity": 100,
                    "timestamp": bar.get('time'),
                    "price": close_price,
                    "rsi": round(rsi, 2),
                    "reason": "oversold"
                }
                await self.nc.publish(
                    f"strategy.signals.{strategy_id}", 
                    json.dumps(signal).encode()
                )
                print(f"🔔 RSI SIGNAL: BUY at ${close_price:.2f} (RSI: {rsi:.2f} - Oversold)")
                
            elif rsi > 70:  # Overbought
                signal = {
                    "strategy_id": strategy_id,
                    "strategy_type": "rsi",
                    "action": "SELL",
                    "symbol": "SPY",
                    "quantity": 100,
                    "timestamp": bar.get('time'),
                    "price": close_price,
                    "rsi": round(rsi, 2),
                    "reason": "overbought"
                }
                await self.nc.publish(
                    f"strategy.signals.{strategy_id}", 
                    json.dumps(signal).encode()
                )
                print(f"🔔 RSI SIGNAL: SELL at ${close_price:.2f} (RSI: {rsi:.2f} - Overbought)")

    async def buy_hold_strategy(self, strategy_id, bar, close_price):
        """Buy and Hold Strategy - only buys once at the beginning"""
        if not hasattr(self, 'buy_hold_executed'):
            self.buy_hold_executed = {}
        
        if not self.buy_hold_executed.get(strategy_id, False):
            # Buy on first bar
            signal = {
                "strategy_id": strategy_id,
                "strategy_type": "buy_hold",
                "action": "BUY",
                "symbol": "SPY",
                "quantity": 100,
                "timestamp": bar.get('time'),
                "price": close_price,
                "reason": "initial_buy"
            }
            await self.nc.publish(
                f"strategy.signals.{strategy_id}", 
                json.dumps(signal).encode()
            )
            print(f"🔔 BUY & HOLD SIGNAL: BUY at ${close_price:.2f} (Initial purchase)")
            self.buy_hold_executed[strategy_id] = True            


engine = StrategyEngine()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await engine.connect_nats()

    # AUTO-LOAD a default strategy for testing
    # default_strategy_id = "default_ma_strategy"
    # await engine.process_bars(default_strategy_id)
    # print(f"Auto-loaded strategy: {default_strategy_id}")

    print("📊 Strategy Engine ready, waiting for strategy load requests...")

    # Start monitoring for shutdown
    asyncio.create_task(monitor_shutdown())

    yield

    # Shutdown
    await engine.disconnect()

# ADD: Monitor shutdown event
async def monitor_shutdown():
    await shutdown_event.wait()
    print("Shutdown event received, cleaning up...")
    await engine.disconnect()
    # Give FastAPI time to send response
    await asyncio.sleep(0.5)
    os._exit(0)

# Update the app to use lifespan
app.router.lifespan_context = lifespan

@app.get("/strategies/status")
async def get_strategies_status():
    """Check which strategies are loaded and their subscription status"""
    status = {}
    for strategy_id, strategy_info in engine.strategies.items():
        status[strategy_id] = {
            "status": strategy_info["status"],
            "subscription_active": strategy_info.get("sub") is not None,
            "bars_collected": len(engine.bars_data.get(strategy_id, [])),
            "messages_processed": engine.strategy_message_counts.get(strategy_id, 0),
            "last_5_closes": engine.bars_data.get(strategy_id, [])[-5:] if strategy_id in engine.bars_data else []
        }
    
    return {
        "service": "strategy-engine",
        "nats_connected": engine.nc is not None and not engine.nc.is_closed,
        "total_messages": engine.message_count,
        "strategies": status,
        "engine_running": engine.running
    }

@app.post("/strategies/load")
async def load_strategy(config: dict):
    strategy_id = config.get("id", f"strategy_{len(engine.strategies)}")
    strategy_type = config.get("strategy", "ma_cross")  # Get strategy type from config

    print(f"Loading strategy: {strategy_id} of type: {strategy_type}")

    await engine.process_bars(strategy_id, strategy_type)

    return {
        "success": True, 
        "id": strategy_id,
        "type": strategy_type
    }

@app.post("/strategies/unload/{strategy_id}")
async def unload_strategy(strategy_id: str):
    """Unload a specific strategy"""
    if strategy_id in engine.strategies:
        strategy_info = engine.strategies[strategy_id]
        if strategy_info.get("sub"):
            await strategy_info["sub"].unsubscribe()
        
        del engine.strategies[strategy_id]
        
        # Clean up associated data
        if strategy_id in engine.bars_data:
            del engine.bars_data[strategy_id]
        if strategy_id in engine.strategy_message_counts:
            del engine.strategy_message_counts[strategy_id]
        
        print(f"Unloaded strategy: {strategy_id}")
        return {"success": True, "message": f"Strategy {strategy_id} unloaded"}
    
    return {"success": False, "message": f"Strategy {strategy_id} not found"}

@app.get("/health")
async def health():
    return {
        "status": "running" if engine.running else "shutting_down",
        "strategies": len(engine.strategies),
        "connected": engine.nc is not None and not engine.nc.is_closed
    }


# ADD: Shutdown endpoint
@app.post("/api/shutdown")
async def shutdown():
    """Gracefully shutdown the service"""
    print("Shutdown requested via API")
    
    # Set the shutdown event
    shutdown_event.set()
    
    return {
        "success": True,
        "message": "Shutting down strategy engine..."
    }

# ADD: Alternative shutdown endpoint (same as above but different path)
@app.post("/shutdown")
async def shutdown_alt():
    """Alternative shutdown endpoint"""
    return await shutdown()

# ADD: Graceful shutdown handler for SIGTERM/SIGINT
def signal_handler(signum, frame):
    print(f"Received signal {signum}, shutting down...")
    shutdown_event.set()

# Register signal handlers
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)


if __name__ == "__main__":
    try:
        uvicorn.run(
            app, 
            host="0.0.0.0", 
            port=8084,
            log_level="info"
        )
    except KeyboardInterrupt:
        print("Interrupted by user")
        sys.exit(0)