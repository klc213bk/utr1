"""
RSI (Relative Strength Index) Strategy

Mean-reversion strategy using RSI to identify overbought and oversold conditions.
"""

from strategies.base_strategy import BaseStrategy, Signal, SignalType
from typing import Dict, Any, Optional


class RSIStrategy(BaseStrategy):
    """
    RSI Strategy

    Uses the Relative Strength Index (RSI) indicator to identify overbought
    and oversold conditions. Generates buy signals when RSI crosses below the
    oversold threshold and sell signals when RSI crosses above the overbought
    threshold.

    This is a mean-reversion strategy that assumes prices will return to
    average after extreme moves.

    Parameters:
        - symbol: Trading symbol (default: SPY)
        - quantity: Number of shares to trade (default: 100)
        - rsi_period: RSI calculation period (default: 14)
        - oversold_threshold: RSI level considered oversold (default: 30)
        - overbought_threshold: RSI level considered overbought (default: 70)
        - use_confirmation: Wait for RSI to move back before signaling (default: True)
    """

    strategy_name = "rsi"

    default_params = {
        "symbol": "SPY",
        "quantity": 100,
        "rsi_period": 14,
        "oversold_threshold": 30,
        "overbought_threshold": 70,
        "use_confirmation": True
    }

    def __init__(self):
        super().__init__()
        self.position = None  # Track current position
        self.last_rsi = None
        self.in_oversold_zone = False
        self.in_overbought_zone = False

    def initialize(self, strategy_id: str, params: Dict[str, Any]):
        """Initialize the strategy"""
        super().initialize(strategy_id, params)

        # Extract parameters
        self.symbol = self.params.get("symbol", "SPY")
        self.quantity = self.params.get("quantity", 100)
        self.rsi_period = self.params.get("rsi_period", 14)
        self.oversold_threshold = self.params.get("oversold_threshold", 30)
        self.overbought_threshold = self.params.get("overbought_threshold", 70)
        self.use_confirmation = self.params.get("use_confirmation", True)

        # Validate parameters
        if not (0 < self.oversold_threshold < self.overbought_threshold < 100):
            raise ValueError(
                "Thresholds must satisfy: 0 < oversold < overbought < 100"
            )

        if self.rsi_period < 2:
            raise ValueError("RSI period must be at least 2")

        # Set max history to accommodate RSI calculation
        self.max_history_size = max(100, self.rsi_period + 20)

        # Initialize state
        self.position = None
        self.last_rsi = None
        self.in_oversold_zone = False
        self.in_overbought_zone = False

        print(f"📊 RSI Strategy initialized: "
              f"period={self.rsi_period}, "
              f"oversold<{self.oversold_threshold}, "
              f"overbought>{self.overbought_threshold}")

    def process_bar(self, bar: Dict[str, Any]) -> Optional[Signal]:
        """
        Process a bar and check for RSI extremes

        Args:
            bar: Price bar data

        Returns:
            Signal if RSI crosses thresholds, None otherwise
        """
        close_price = float(bar.get('close', 0))

        # Update price history
        self.update_history(close_price)

        # Need enough history for RSI
        if len(self.bars_history) < self.rsi_period + 1:
            return None

        # Calculate RSI
        current_rsi = self.get_rsi(self.rsi_period)

        if current_rsi is None:
            return None

        signal = None

        # Track zone entries
        if current_rsi < self.oversold_threshold:
            self.in_oversold_zone = True
        if current_rsi > self.overbought_threshold:
            self.in_overbought_zone = True

        # Generate signals based on strategy mode
        if self.use_confirmation:
            # Wait for RSI to exit extreme zone before signaling
            signal = self._check_confirmation_signals(bar, current_rsi, close_price)
        else:
            # Signal immediately when entering extreme zones
            signal = self._check_immediate_signals(bar, current_rsi, close_price)

        # Update state
        self.last_rsi = current_rsi
        self.state["rsi"] = round(current_rsi, 2)
        self.state["position"] = self.position
        self.state["in_oversold_zone"] = self.in_oversold_zone
        self.state["in_overbought_zone"] = self.in_overbought_zone

        return signal

    def _check_confirmation_signals(
        self,
        bar: Dict[str, Any],
        current_rsi: float,
        close_price: float
    ) -> Optional[Signal]:
        """
        Generate signals with confirmation (exit from extreme zone)

        Returns:
            Signal if conditions met, None otherwise
        """
        # BUY signal: Was oversold, now recovering
        if (self.in_oversold_zone and
            current_rsi > self.oversold_threshold and
            self.position != "long"):

            self.position = "long"
            self.in_oversold_zone = False

            print(f"🔔 RSI BUY: ${close_price:.2f} (RSI: {current_rsi:.2f} recovering from oversold)")

            return self.create_signal(
                action=SignalType.BUY,
                bar=bar,
                quantity=self.quantity,
                confidence=0.8,
                rsi=round(current_rsi, 2),
                reason="rsi_oversold_recovery",
                signal_type="confirmation"
            )

        # SELL signal: Was overbought, now weakening
        elif (self.in_overbought_zone and
              current_rsi < self.overbought_threshold and
              self.position == "long"):

            self.position = None
            self.in_overbought_zone = False

            print(f"🔔 RSI SELL: ${close_price:.2f} (RSI: {current_rsi:.2f} falling from overbought)")

            return self.create_signal(
                action=SignalType.SELL,
                bar=bar,
                quantity=self.quantity,
                confidence=0.8,
                rsi=round(current_rsi, 2),
                reason="rsi_overbought_reversal",
                signal_type="confirmation"
            )

        return None

    def _check_immediate_signals(
        self,
        bar: Dict[str, Any],
        current_rsi: float,
        close_price: float
    ) -> Optional[Signal]:
        """
        Generate signals immediately upon entering extreme zones

        Returns:
            Signal if conditions met, None otherwise
        """
        # BUY signal: Just entered oversold
        if (current_rsi < self.oversold_threshold and
            (self.last_rsi is None or self.last_rsi >= self.oversold_threshold) and
            self.position != "long"):

            self.position = "long"

            print(f"🔔 RSI BUY: ${close_price:.2f} (RSI: {current_rsi:.2f} oversold)")

            return self.create_signal(
                action=SignalType.BUY,
                bar=bar,
                quantity=self.quantity,
                confidence=0.75,  # Lower confidence for immediate entry
                rsi=round(current_rsi, 2),
                reason="rsi_oversold",
                signal_type="immediate"
            )

        # SELL signal: Just entered overbought
        elif (current_rsi > self.overbought_threshold and
              (self.last_rsi is None or self.last_rsi <= self.overbought_threshold) and
              self.position == "long"):

            self.position = None

            print(f"🔔 RSI SELL: ${close_price:.2f} (RSI: {current_rsi:.2f} overbought)")

            return self.create_signal(
                action=SignalType.SELL,
                bar=bar,
                quantity=self.quantity,
                confidence=0.75,
                rsi=round(current_rsi, 2),
                reason="rsi_overbought",
                signal_type="immediate"
            )

        return None

    def on_start(self):
        """Called when strategy starts"""
        mode = "confirmation" if self.use_confirmation else "immediate"
        print(f"🚀 RSI strategy starting ({mode} mode)")
        print(f"   RSI Period: {self.rsi_period}")
        print(f"   Oversold: <{self.oversold_threshold}")
        print(f"   Overbought: >{self.overbought_threshold}")
        print(f"   Symbol: {self.symbol}")

    def on_stop(self):
        """Called when strategy stops"""
        print(f"🛑 RSI strategy stopping")
        if self.last_rsi:
            print(f"   Final RSI: {self.last_rsi:.2f}")
        if self.position:
            print(f"   Final position: {self.position}")


# =============================================================================
# TESTING
# =============================================================================

if __name__ == "__main__":
    """Test the RSI strategy"""
    import random
    import math

    strategy = RSIStrategy()
    strategy.initialize("test_rsi", {
        "symbol": "SPY",
        "rsi_period": 14,
        "oversold_threshold": 30,
        "overbought_threshold": 70,
        "use_confirmation": True
    })

    # Generate sample oscillating data
    base_price = 100
    prices = [base_price]

    for i in range(100):
        # Create oscillating price pattern
        trend = math.sin(i / 10) * 5  # Oscillate
        noise = random.uniform(-0.5, 0.5)
        new_price = base_price + trend + noise
        prices.append(new_price)

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
            rsi = strategy.state.get('rsi', 'N/A')
            print(f"Bar {i}: {signal.action.value} signal at ${price:.2f} (RSI: {rsi})")

    print(f"\n✅ Test complete. Signals generated: {signals_generated}")
    print(f"Final state: {strategy.get_state()}")
