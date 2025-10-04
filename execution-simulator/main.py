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
        self.sessions = {}  # Track all sessions (backtests, paper, live)
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

    @app.get("/positions")
    async def get_positions():
        """Get current positions"""
        return {
            "positions": simulator.positions,
            "fill_count": simulator.fill_count,
            "config": simulator.config
        }

    @app.post("/positions/reset")
    async def reset_positions():
        """Reset all positions to zero"""
        simulator.positions = {}
        simulator.fill_count = 0
        print("🔄 Positions reset to zero")
        return {"success": True, "message": "Positions reset"}
            
    async def handle_signal(self, msg):
        if not self.running:
            return
        
        try:
            signal = json.loads(msg.data.decode())
            
            # Extract key fields
            strategy_id = signal.get("strategy_id", "unknown")
            symbol = signal.get("symbol", "SPY")
            action = signal.get("action")
            
            # Log received signal
            print(f"📨 Received signal from {strategy_id}: {action} {signal.get('quantity', 0)} {symbol}")
            
            # Initialize session if not exists
            if strategy_id not in self.sessions:
                print(f"🔄 New session detected: {strategy_id}, initializing positions")
                self.sessions[strategy_id] = {
                    "positions": {},
                    "total_buys": 0,
                    "total_sells": 0,
                    "fills": []
                }
            
            session = self.sessions[strategy_id]

            # Initialize position for symbol if not exists
            if symbol not in session["positions"]:
                session["positions"][symbol] = 0
                print(f"📊 Initialized position for {symbol} = 0")
            
            # Validate signal has required fields
            if not action or not signal.get("quantity"):
                print(f"⚠️ Invalid signal - missing action or quantity: {signal}")
                return
            
            # Simulate the fill
            fill = await self.simulate_fill(signal, session)
            
            if fill:
                # Fill was successful, publish it
                fill_subject = f"execution.fills.{strategy_id}"
                
                # Ensure backtestId is in the fill
                fill["backtestId"] = strategy_id
                
                # Publish to NATS
                await self.nc.publish(fill_subject, json.dumps(fill).encode())
                
                print(f"📤 Published fill to {fill_subject}")
                print(f"   Details: {fill['action']} {fill['quantity']} @ ${fill['price']:.2f}, Position: {fill['position_after']}")
                
                # Track statistics
                if action == "BUY":
                    session["total_buys"] += 1
                else:
                    session["total_sells"] += 1
                
            else:
                # Fill was rejected (e.g., trying to sell without position)
                print(f"❌ Fill rejected for signal: {signal}")
                
                rejection_notice = {
                    "type": "rejection",
                    "strategy_id": strategy_id,
                    "backtestId": strategy_id,  # for compatibility
                    "reason": "Invalid position for sell" if action == "SELL" else "Unknown error",
                    "original_signal": signal,
                    "timestamp": datetime.now().isoformat()
                }
                
                # Publish rejection to a different topic if you want to track these
                rejection_subject = f"execution.rejections.{strategy_id}"
                await self.nc.publish(rejection_subject, json.dumps(rejection_notice).encode())
                print(f"📤 Published rejection notice to {rejection_subject}")
            
        except json.JSONDecodeError as e:
            print(f"❌ Error decoding signal JSON: {e}")
            print(f"   Raw message: {msg.data}")
        except Exception as e:
            print(f"❌ Error handling signal: {e}")
            import traceback
            traceback.print_exc()
            
    async def simulate_fill(self, signal, session):
        """Simulate a fill with slippage and commission"""
        
        symbol = signal.get("symbol", "SPY")
        action = signal.get("action")
        quantity = signal.get("quantity", 100)
        
        # POSITION TRACKING - Check if trade is valid
        current_position = session["positions"].get(symbol, 0)
        
        # Validate the trade
        if action == "SELL" and current_position <= 0:
            print(f"⚠️ Cannot SELL {quantity} {symbol} - no position to sell (current: {current_position})")
            return None
        
        if action == "SELL" and quantity > current_position:
            print(f"⚠️ Adjusting SELL quantity from {quantity} to {current_position} (max available)")
            quantity = current_position
        
        # Get base price from signal
        base_price = float(signal.get("price", 450.0))
        
        # If we have current market prices, use them
        if symbol in self.current_prices and self.current_prices[symbol]:
            market_data = self.current_prices[symbol]
            if action == "BUY":
                base_price = float(market_data.get("high", market_data.get("close", base_price)))
            else:  # SELL
                base_price = float(market_data.get("low", market_data.get("close", base_price)))
        
        # Calculate slippage
        slippage_pct = self.config["slippage"]  # 0.01 means 0.01%
        
        # Apply slippage based on order type
        if action == "BUY":
            slippage_amount = base_price * (slippage_pct / 100)
            fill_price = base_price + slippage_amount
        else:  # SELL
            slippage_amount = base_price * (slippage_pct / 100)
            fill_price = base_price - slippage_amount
        
        # UPDATE POSITION TRACKING
        if action == "BUY":
            session["positions"][symbol] = current_position + quantity
            print(f"📊 Position after BUY: {symbol} = {session['positions'][symbol]} shares")
        else:  # SELL
            session["positions"][symbol] = current_position - quantity
            print(f"📊 Position after SELL: {symbol} = {session['positions'][symbol]} shares")
        
        # Increment fill counter
        self.fill_count += 1
        
        # Create fill object
        fill = {
            "fill_id": f"fill_{self.fill_count}",
            "strategy_id": signal.get("strategy_id"),
            "backtestId": signal.get("strategy_id"),  # for compatibility
            "action": action,
            "symbol": symbol,
            "quantity": quantity,
            "price": round(fill_price, 2),
            "base_price": round(base_price, 2),
            "timestamp": signal.get("timestamp", datetime.now().isoformat()),
            "commission": self.config["commission"],
            "slippage_amount": round(slippage_amount, 2),
            "slippage_pct": slippage_pct,
            "fill_mode": self.config["fill_mode"],
            "position_after": session["positions"][symbol]
        }
        
        # Log the fill
        print(f"✅ Fill executed: {fill['action']} {fill['quantity']} {fill['symbol']} @ ${fill['price']:.2f}")
        print(f"   Base: ${fill['base_price']:.2f}, Slippage: ${fill['slippage_amount']:.2f}, Position: {fill['position_after']}")
        
        # Store fill in session
        session["fills"].append(fill)

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
        "sessions": len(simulator.sessions),
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
        """Get all sessions and their positions"""
        return {
            "sessions": simulator.sessions,
            "fill_count": simulator.fill_count,
            "config": simulator.config
        }

@app.post("/positions/reset")
async def reset_positions():
    """Reset all sessions and positions"""
    simulator.sessions = {}
    simulator.fill_count = 0
    print("🔄 All sessions and positions reset")
    return {"success": True, "message": "All sessions reset"}

@app.post("/positions/reset/{session_id}")
async def reset_session(session_id: str):
    """Reset specific session"""
    if session_id in simulator.sessions:
        del simulator.sessions[session_id]
        print(f"🔄 Session {session_id} reset")
        return {"success": True, "message": f"Session {session_id} reset"}
    return {"success": False, "message": f"Session {session_id} not found"}

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