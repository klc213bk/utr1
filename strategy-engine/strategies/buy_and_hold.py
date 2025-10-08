"""
Buy and Hold Strategy

A simple baseline strategy that buys once at the beginning and holds forever.
Useful as a benchmark to compare other strategies against.
"""

from strategies.base_strategy import BaseStrategy, Signal, SignalType
from typing import Dict, Any, Optional


class BuyAndHoldStrategy(BaseStrategy):
    """
    Buy and Hold Strategy

    This strategy simply buys the asset on the first bar and holds it.
    It's the simplest possible strategy and serves as a baseline benchmark.

    Parameters:
        - symbol: Trading symbol (default: SPY)
        - quantity: Number of shares to buy (default: 100)
    """

    strategy_name = "buy_hold"

    default_params = {
        "symbol": "SPY",
        "quantity": 100
    }

    def __init__(self):
        super().__init__()
        self.has_bought = False

    def initialize(self, strategy_id: str, params: Dict[str, Any]):
        """Initialize the strategy"""
        super().initialize(strategy_id, params)
        self.has_bought = False
        self.symbol = self.params.get("symbol", "SPY")
        self.quantity = self.params.get("quantity", 100)

    def process_bar(self, bar: Dict[str, Any]) -> Optional[Signal]:
        """
        Process a bar - buy once on first bar, then hold

        Args:
            bar: Price bar data

        Returns:
            BUY signal on first bar, None thereafter
        """
        # Only buy on the first bar
        if not self.has_bought:
            self.has_bought = True

            return self.create_signal(
                action=SignalType.BUY,
                bar=bar,
                quantity=self.quantity,
                confidence=1.0,
                reason="initial_buy",
                strategy_description="Buy and hold baseline"
            )

        # After first buy, do nothing
        return None

    def on_start(self):
        """Called when strategy starts"""
        print(f"🚀 Buy & Hold strategy starting - will buy {self.quantity} shares of {self.symbol}")

    def on_stop(self):
        """Called when strategy stops"""
        if self.has_bought:
            print(f"🛑 Buy & Hold strategy stopping - position held throughout")
        else:
            print(f"⚠️  Buy & Hold strategy stopping - no position taken")
