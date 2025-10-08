"""
Strategy Template

Copy this file to create your own strategy. Follow the instructions in each section.

Quick Start:
1. Copy this file to strategies/ directory
2. Rename file to your_strategy_name.py
3. Update strategy_name and default_params
4. Implement process_bar() method with your logic
5. Test using the unified trading panel!

Example:
    cp strategy_template.py ../my_momentum_strategy.py
"""

from strategies.base_strategy import BaseStrategy, Signal, SignalType
from typing import Dict, Any, Optional


class MyStrategy(BaseStrategy):
    """
    [EDIT THIS] Brief description of your strategy

    Explain what your strategy does, what indicators it uses,
    and under what conditions it generates buy/sell signals.

    Example:
        This strategy uses a momentum indicator to identify
        trending stocks and generates buy signals when momentum
        is strong and sell signals when momentum weakens.
    """

    # =========================================================================
    # SECTION 1: STRATEGY CONFIGURATION
    # =========================================================================

    # Strategy name (used to identify your strategy)
    # Must be unique across all strategies
    # Use lowercase with underscores (e.g., 'ma_cross', 'rsi_divergence')
    strategy_name = "my_strategy"  # [EDIT THIS]

    # Default parameters for your strategy
    # These can be overridden when starting a backtest/paper/live session
    default_params = {
        "symbol": "SPY",          # Trading symbol
        "quantity": 100,          # Default quantity to trade
        "threshold": 0.5,         # [EDIT THIS] Your strategy parameters
        "lookback_period": 20,    # [EDIT THIS] Example parameter
        # Add more parameters as needed
    }

    # =========================================================================
    # SECTION 2: INITIALIZATION
    # =========================================================================

    def __init__(self):
        """Initialize your strategy"""
        super().__init__()

        # [OPTIONAL] Set custom history size
        # Default is 100, increase if you need more historical data
        self.max_history_size = 100

        # [OPTIONAL] Define any instance variables you'll need
        # These will be accessible in process_bar()
        self.position = None  # Track current position
        self.entry_price = None
        # Add more as needed

    def initialize(self, strategy_id: str, params: Dict[str, Any]):
        """
        Called when strategy is loaded

        This is automatically called by the framework. You can override it
        to perform additional initialization based on the params.
        """
        super().initialize(strategy_id, params)

        # [OPTIONAL] Extract params to instance variables for easier access
        self.threshold = self.params.get("threshold", 0.5)
        self.lookback_period = self.params.get("lookback_period", 20)
        self.symbol = self.params.get("symbol", "SPY")
        self.quantity = self.params.get("quantity", 100)

        # [OPTIONAL] Initialize state variables
        self.state["last_signal"] = None
        self.state["signal_count"] = 0

        print(f"📊 {self.strategy_name} initialized with threshold={self.threshold}")

    # =========================================================================
    # SECTION 3: MAIN STRATEGY LOGIC
    # =========================================================================

    def process_bar(self, bar: Dict[str, Any]) -> Optional[Signal]:
        """
        Process each price bar and generate trading signals

        This is the MAIN method you need to implement. It's called for every
        new bar of data (e.g., every minute in live/paper trading, or at
        accelerated speed during backtesting).

        Args:
            bar: Dictionary with keys:
                - time: Timestamp (string)
                - open: Opening price (float)
                - high: High price (float)
                - low: Low price (float)
                - close: Closing price (float)
                - volume: Volume (int)

        Returns:
            Signal object if you want to trade, None to do nothing
        """
        # Step 1: Extract data from bar
        close_price = float(bar.get('close', 0))
        timestamp = bar.get('time')

        # Step 2: Update price history
        # This helper method maintains a rolling window of prices
        self.update_history(close_price)

        # Step 3: Check if we have enough data
        # Return None if not enough history yet
        if len(self.bars_history) < self.lookback_period:
            return None

        # =====================================================================
        # [EDIT THIS SECTION] - YOUR STRATEGY LOGIC GOES HERE
        # =====================================================================

        # Example: Simple threshold-based strategy
        # Replace this with your own logic!

        # Calculate some indicator (example)
        sma_20 = self.get_sma(20)
        sma_50 = self.get_sma(50)

        if sma_20 is None or sma_50 is None:
            return None

        # Generate signals based on your conditions
        if sma_20 > sma_50 and self.position != "long":
            # BUY SIGNAL
            self.position = "long"
            self.entry_price = close_price

            return self.create_signal(
                action=SignalType.BUY,
                bar=bar,
                quantity=self.quantity,
                confidence=0.8,  # Optional: your confidence in this signal
                # Add any extra metadata you want
                sma_20=round(sma_20, 2),
                sma_50=round(sma_50, 2),
                reason="sma_crossover_up"
            )

        elif sma_20 < sma_50 and self.position == "long":
            # SELL SIGNAL
            self.position = None
            pnl = close_price - self.entry_price if self.entry_price else 0

            return self.create_signal(
                action=SignalType.SELL,
                bar=bar,
                quantity=self.quantity,
                confidence=0.8,
                sma_20=round(sma_20, 2),
                sma_50=round(sma_50, 2),
                reason="sma_crossover_down",
                estimated_pnl=round(pnl, 2)
            )

        # No signal
        return None

    # =========================================================================
    # SECTION 4: HELPER METHODS (Optional)
    # =========================================================================

    def calculate_my_indicator(self) -> float:
        """
        [OPTIONAL] Add custom indicator calculations

        Example: Calculate a custom indicator based on price history
        """
        if len(self.bars_history) < 10:
            return 0.0

        # Your indicator logic here
        recent_prices = self.bars_history[-10:]
        return sum(recent_prices) / len(recent_prices)

    def check_entry_conditions(self, price: float) -> bool:
        """
        [OPTIONAL] Separate entry condition logic

        Returns:
            True if entry conditions are met, False otherwise
        """
        # Your entry logic here
        return False

    def check_exit_conditions(self, price: float) -> bool:
        """
        [OPTIONAL] Separate exit condition logic

        Returns:
            True if exit conditions are met, False otherwise
        """
        # Your exit logic here
        return False

    # =========================================================================
    # SECTION 5: LIFECYCLE HOOKS (Optional)
    # =========================================================================

    def on_start(self):
        """
        [OPTIONAL] Called when strategy starts

        Use this to perform any initialization that should happen
        before processing bars.
        """
        print(f"🚀 {self.strategy_name} starting...")
        # Your startup logic here

    def on_stop(self):
        """
        [OPTIONAL] Called when strategy stops

        Use this for cleanup or final calculations.
        """
        print(f"🛑 {self.strategy_name} stopping...")
        print(f"   Total signals generated: {self.state.get('signal_count', 0)}")
        # Your cleanup logic here


# =============================================================================
# TESTING YOUR STRATEGY
# =============================================================================

if __name__ == "__main__":
    """
    Quick test your strategy with sample data

    Run: python my_strategy.py
    """
    # Create strategy instance
    strategy = MyStrategy()
    strategy.initialize("test_strategy", {
        "symbol": "SPY",
        "threshold": 0.5,
        "lookback_period": 20
    })

    # Sample bar data
    sample_bars = [
        {"time": "2024-01-01 09:30", "open": 100, "high": 101, "low": 99, "close": 100.5, "volume": 1000},
        {"time": "2024-01-01 09:31", "open": 100.5, "high": 102, "low": 100, "close": 101.5, "volume": 1200},
        {"time": "2024-01-01 09:32", "open": 101.5, "high": 103, "low": 101, "close": 102.5, "volume": 1500},
        # Add more sample bars...
    ]

    # Process bars
    for bar in sample_bars:
        signal = strategy.process_bar(bar)
        if signal:
            print(f"📊 SIGNAL: {signal.action.value} at ${signal.price}")

    print(f"\n✅ Test complete. Strategy state: {strategy.get_state()}")
