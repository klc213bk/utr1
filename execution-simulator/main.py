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
from typing import Dict, Optional

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ADD: Global shutdown event
shutdown_event = asyncio.Event()

class ExecutionSimulator:
    def __init__(self):
        self.nc = None
        self.positions = {}
        self.fill_count = 0
        self.current_prices = {}
        self.running = True  # ADD: flag to control processing
        self.config = {
            "slippage": 0.01,
            "commission": 1.0,
            "fill_mode": "realistic"
        }
        
    async def connect_nats(self):
        self.nc = await nats.connect("nats://localhost:4222")
        print("Execution Simulator connected to NATS")
        
    async def disconnect(self):  # ADD: cleanup method
        self.running = False
        if self.nc:
            await self.nc.close()
            print("Disconnected from NATS")

    async def start_subscriptions(self):
        # Subscribe to strategy signals
        await self.nc.subscribe("strategy.signals.*", cb=self.handle_signal)
        print("Subscribed to strategy.signals.*")
        
        # Subscribe to market data for pricing
        await self.nc.subscribe("md.equity.spy.bars.1m.replay", cb=self.handle_market_data)
        print("Subscribed to market data")
        
    async def handle_market_data(self, msg):
        """Update current market prices"""
        if not self.running:  # ADD: check if still running
            return
        
        try:
            data = json.loads(msg.data.decode())
            self.current_prices[data.get("symbol", "SPY")] = {
                "close": data.get("close"),
                "high": data.get("high"),
                "low": data.get("low"),
                "time": data.get("time")
            }
        except Exception as e:
            print(f"Error handling market data: {e}")
            
    async def handle_signal(self, msg):
        """Process strategy signals and generate fills"""
        if not self.running:  # ADD: check if still running
            return
        
        try:
            signal = json.loads(msg.data.decode())
            print(f"Received signal: {signal}")
            
            # Extract strategy ID from subject
            subject_parts = msg.subject.split(".")
            strategy_id = subject_parts[-1] if len(subject_parts) > 2 else "unknown"
            
            # Generate fill
            fill = self.simulate_fill(signal, strategy_id)
            if fill:
                # Publish fill event
                await self.nc.publish(
                    f"execution.fills.{strategy_id}",
                    json.dumps(fill).encode()
                )
                print(f"Published fill: {fill['action']} {fill['quantity']} @ {fill['price']}")
                
        except Exception as e:
            print(f"Error handling signal: {e}")
            
    def simulate_fill(self, signal: dict, strategy_id: str) -> Optional[dict]:
        """Simulate order fill with slippage"""
        symbol = signal.get("symbol", "SPY")
        action = signal.get("action")
        quantity = signal.get("quantity", 100)
        
        # Get current price
        if symbol not in self.current_prices:
            print(f"No price data for {symbol}")
            return None
            
        current = self.current_prices[symbol]
        base_price = current["close"]
        
        # Calculate fill price based on mode and action
        if self.config["fill_mode"] == "optimistic":
            fill_price = current["low"] if action == "BUY" else current["high"]
        elif self.config["fill_mode"] == "conservative":
            fill_price = current["high"] if action == "BUY" else current["low"]
        else:  # realistic
            slippage = self.config["slippage"]
            fill_price = base_price + slippage if action == "BUY" else base_price - slippage
            
        # Update position tracking
        if symbol not in self.positions:
            self.positions[symbol] = 0
            
        if action == "BUY":
            self.positions[symbol] += quantity
        elif action == "SELL":
            self.positions[symbol] -= quantity
            
        self.fill_count += 1
        
        # Create fill record
        fill = {
            "fill_id": f"fill_{self.fill_count}",
            "strategy_id": strategy_id,
            "symbol": symbol,
            "action": action,
            "quantity": quantity,
            "price": round(fill_price, 2),
            "commission": self.config["commission"],
            "timestamp": current["time"],
            "position_after": self.positions[symbol],
            "slippage": round(fill_price - base_price, 2)
        }
        
        return fill

# Create global instance
simulator = ExecutionSimulator()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await simulator.connect_nats()
    await simulator.start_subscriptions()

    # Start monitoring for shutdown
    asyncio.create_task(monitor_shutdown())

    yield

    # Shutdown
    await simulator.disconnect()

# ADD: Monitor shutdown event
async def monitor_shutdown():
    await shutdown_event.wait()
    print("Shutdown event received, cleaning up...")
    await simulator.disconnect()
    # Give FastAPI time to send response
    await asyncio.sleep(0.5)
    os._exit(0)

app.router.lifespan_context = lifespan

@app.get("/health")
async def health():
    return {
        "status": "running" if simulator.running else "shutting_down",
        "fills": simulator.fill_count,
        "positions": simulator.positions,
        "connected": simulator.nc is not None and not simulator.nc.is_closed
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
        "message": "Shutting down execution simulator..."
    }

# ADD: Alternative shutdown endpoint
@app.post("/shutdown")
async def shutdown_alt():
    """Alternative shutdown endpoint"""
    return await shutdown()

@app.post("/config")
async def update_config(config: dict):
    """Update simulator configuration"""
    simulator.config.update(config)
    return {"success": True, "config": simulator.config}

@app.get("/positions")
async def get_positions():
    """Get current positions"""
    return {
        "positions": simulator.positions,
        "fill_count": simulator.fill_count
    }

@app.post("/reset")
async def reset():
    """Reset simulator state"""
    simulator.positions = {}
    simulator.fill_count = 0
    simulator.current_prices = {}
    return {"success": True, "message": "Simulator reset"}

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
            port=8085,
            log_level="info"
        )
    except KeyboardInterrupt:
        print("Interrupted by user")
        sys.exit(0)