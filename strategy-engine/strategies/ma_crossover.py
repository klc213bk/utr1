"""
Moving Average Crossover Strategy

Classic technical analysis strategy that generates signals when a fast-moving
average crosses above or below a slow-moving average.
"""

from strategies.base_strategy import BaseStrategy, Signal, SignalType
from typing import Dict, Any, Optional


class MACrossoverStrategy(BaseStrategy):
    """
    Moving Average Crossover Strategy

    Generates buy signals when the fast MA crosses above the slow MA
    (golden cross) and sell signals when the fast MA crosses below
    the slow MA (death cross).

    Parameters:
        - symbol: Trading symbol (default: SPY)
        - quantity: Number of shares to trade (default: 100)
        - fast_period: Fast MA period (default: 20)
        - slow_period: Slow MA period (default: 50)
        - ma_type: Type of MA - 'sma' or 'ema' (default: 'sma')
    """

    strategy_name = "ma_cross"

    default_params = {
        "symbol": "SPY",
        "quantity": 100,
        "fast_period": 20,
        "slow_period": 50,
        "ma_type": "sma"  # 'sma' or 'ema'
    }

    def __init__(self):
        super().__init__()
        self.previous_state = None  # Track previous MA relationship
        self.position = None  # Track if we're long, short, or flat

    def initialize(self, strategy_id: str, params: Dict[str, Any]):
        """Initialize the strategy"""
        super().initialize(strategy_id, params)

        # Extract parameters
        self.symbol = self.params.get("symbol", "SPY")
        self.quantity = self.params.get("quantity", 100)
        self.fast_period = self.params.get("fast_period", 20)
        self.slow_period = self.params.get("slow_period", 50)
        self.ma_type = self.params.get("ma_type", "sma").lower()

        # Validate parameters
        if self.fast_period >= self.slow_period:
            raise ValueError("fast_period must be less than slow_period")

        if self.ma_type not in ['sma', 'ema']:
            raise ValueError("ma_type must be 'sma' or 'ema'")

        # Set max history to accommodate slow MA
        self.max_history_size = max(100, self.slow_period + 10)

        # Initialize state
        self.previous_state = None
        self.position = None

        print(f"📊 MA Crossover initialized: {self.fast_period}/{self.slow_period} {self.ma_type.upper()}")

    def process_bar(self, bar: Dict[str, Any]) -> Optional[Signal]:
        """
        Process a bar and check for MA crossovers

        Args:
            bar: Price bar data

        Returns:
            Signal if crossover detected, None otherwise
        """
        close_price = float(bar.get('close', 0))

        # Update price history
        self.update_history(close_price)

        # Need enough history for slow MA
        if len(self.bars_history) < self.slow_period:
            return None

        # Calculate moving averages based on type
        if self.ma_type == 'sma':
            fast_ma = self.get_sma(self.fast_period)
            slow_ma = self.get_sma(self.slow_period)
        else:  # ema
            fast_ma = self.get_ema(self.fast_period)
            slow_ma = self.get_ema(self.slow_period)

        if fast_ma is None or slow_ma is None:
            return None

        # Determine current state
        current_state = "above" if fast_ma > slow_ma else "below"

        # Detect crossover
        signal = None

        if self.previous_state and self.previous_state != current_state:
            # Crossover detected!

            if current_state == "above" and self.position != "long":
                # Golden Cross - BUY signal
                self.position = "long"

                signal = self.create_signal(
                    action=SignalType.BUY,
                    bar=bar,
                    quantity=self.quantity,
                    confidence=0.85,
                    fast_ma=round(fast_ma, 2),
                    slow_ma=round(slow_ma, 2),
                    crossover_type="golden_cross",
                    ma_type=self.ma_type,
                    reason=f"Fast {self.ma_type.upper()}({self.fast_period}) crossed above Slow {self.ma_type.upper()}({self.slow_period})"
                )

                print(f"🔔 GOLDEN CROSS: BUY at ${close_price:.2f} "
                      f"(Fast MA: {fast_ma:.2f}, Slow MA: {slow_ma:.2f})")

            elif current_state == "below" and self.position == "long":
                # Death Cross - SELL signal
                self.position = None

                signal = self.create_signal(
                    action=SignalType.SELL,
                    bar=bar,
                    quantity=self.quantity,
                    confidence=0.85,
                    fast_ma=round(fast_ma, 2),
                    slow_ma=round(slow_ma, 2),
                    crossover_type="death_cross",
                    ma_type=self.ma_type,
                    reason=f"Fast {self.ma_type.upper()}({self.fast_period}) crossed below Slow {self.ma_type.upper()}({self.slow_period})"
                )

                print(f"🔔 DEATH CROSS: SELL at ${close_price:.2f} "
                      f"(Fast MA: {fast_ma:.2f}, Slow MA: {slow_ma:.2f})")

        # Update state for next bar
        self.previous_state = current_state

        # Update state tracking
        self.state["fast_ma"] = round(fast_ma, 2)
        self.state["slow_ma"] = round(slow_ma, 2)
        self.state["position"] = self.position
        self.state["ma_relationship"] = current_state

        return signal

    def on_start(self):
        """Called when strategy starts"""
        print(f"🚀 MA Crossover strategy starting")
        print(f"   Fast MA: {self.fast_period} {self.ma_type.upper()}")
        print(f"   Slow MA: {self.slow_period} {self.ma_type.upper()}")
        print(f"   Symbol: {self.symbol}")

    def on_stop(self):
        """Called when strategy stops"""
        print(f"🛑 MA Crossover strategy stopping")
        if self.position:
            print(f"   Final position: {self.position}")
        print(f"   Final MAs: Fast={self.state.get('fast_ma', 'N/A')}, "
              f"Slow={self.state.get('slow_ma', 'N/A')}")


# =============================================================================
# TESTING
# =============================================================================

if __name__ == "__main__":
    """Test the MA Crossover strategy"""
    import random

    strategy = MACrossoverStrategy()
    strategy.initialize("test_ma_cross", {
        "symbol": "SPY",
        "fast_period": 5,
        "slow_period": 10,
        "ma_type": "sma"
    })

    # Generate sample trending data
    base_price = 100
    prices = [base_price]
    for i in range(100):
        # Create uptrend then downtrend
        if i < 50:
            change = random.uniform(-0.5, 1.5)  # Uptrend
        else:
            change = random.uniform(-1.5, 0.5)  # Downtrend
        prices.append(prices[-1] + change)

    # Process bars
    signals_generated = 0
    for i, price in enumerate(prices):
        bar = {
            "time": f"2024-01-01 09:{i:02d}",
            "open": price,
            "high": price + 0.5,
            "low": price - 0.5,
            "close": price,
            "volume": 1000
        }

        signal = strategy.process_bar(bar)
        if signal:
            signals_generated += 1
            print(f"Bar {i}: {signal.action.value} signal at ${price:.2f}")

    print(f"\n✅ Test complete. Signals generated: {signals_generated}")
    print(f"Final state: {strategy.get_state()}")
