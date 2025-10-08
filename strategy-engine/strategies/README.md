# Trading Strategies

This directory contains all trading strategy implementations for the UTR Trading System.

## Quick Start

**Create a new strategy in 3 steps:**

1. **Copy the template:**
   ```bash
   cp template/strategy_template.py my_new_strategy.py
   ```

2. **Edit 3 sections:**
   - Set `strategy_name` (unique identifier)
   - Define `default_params` (your parameters)
   - Implement `process_bar()` (your logic)

3. **Test it:**
   ```bash
   python my_new_strategy.py
   ```

**That's it!** Your strategy is now available in the unified trading panel.

## Directory Structure

```
strategies/
├── __init__.py                  # Package initialization
├── base_strategy.py             # Abstract base class (inherit from this)
├── strategy_registry.py         # Auto-discovery system
├── README.md                    # This file
│
├── template/
│   └── strategy_template.py    # Copy-paste template for new strategies
│
├── buy_and_hold.py              # Simple example
├── ma_crossover.py              # Medium complexity example
├── rsi_strategy.py              # Advanced example
│
└── YOUR_STRATEGY.py             # <-- Put your strategies here!
```

## Available Strategies

### 1. Buy and Hold (`buy_hold`)
- **Description:** Buys once and holds forever
- **Use case:** Baseline benchmark
- **Parameters:**
  - `symbol`: Trading symbol (default: SPY)
  - `quantity`: Number of shares (default: 100)

### 2. MA Crossover (`ma_cross`)
- **Description:** Moving average crossover (golden/death cross)
- **Use case:** Trend following
- **Parameters:**
  - `fast_period`: Fast MA period (default: 20)
  - `slow_period`: Slow MA period (default: 50)
  - `ma_type`: 'sma' or 'ema' (default: 'sma')

### 3. RSI Strategy (`rsi`)
- **Description:** Mean-reversion using RSI
- **Use case:** Oversold/overbought trading
- **Parameters:**
  - `rsi_period`: RSI calculation period (default: 14)
  - `oversold_threshold`: Buy threshold (default: 30)
  - `overbought_threshold`: Sell threshold (default: 70)
  - `use_confirmation`: Wait for reversal (default: True)

## Strategy Template

The template includes:

- ✅ Clear section markers for what to edit
- ✅ Comprehensive comments explaining each part
- ✅ Helper methods for common calculations (SMA, EMA, RSI)
- ✅ Built-in testing framework
- ✅ Parameter handling
- ✅ State management examples

## How Strategies Work

### 1. Auto-Discovery

When Strategy Engine starts, it:
- Scans this directory for `.py` files
- Finds classes inheriting from `BaseStrategy`
- Registers them automatically
- Makes them available via API

### 2. Strategy Lifecycle

```
1. User selects strategy in panel
2. Backend calls strategy_registry.create_strategy()
3. Strategy instance created with params
4. on_start() called
5. For each bar: process_bar() called
6. If signal returned: published to NATS
7. on_stop() called when done
```

### 3. Required Methods

Every strategy MUST implement:

```python
class MyStrategy(BaseStrategy):
    strategy_name = "my_strategy"  # Required
    default_params = {...}         # Required

    def process_bar(self, bar) -> Optional[Signal]:
        # Required - main logic here
        pass
```

### 4. Optional Methods

```python
def on_start(self):
    """Called when strategy starts"""
    pass

def on_stop(self):
    """Called when strategy stops"""
    pass

def initialize(self, strategy_id, params):
    """Override for custom initialization"""
    super().initialize(strategy_id, params)
```

## Helper Methods Available

BaseStrategy provides these helpers:

### Price History
```python
self.update_history(close_price)  # Add to history
len(self.bars_history)            # Check history size
self.bars_history[-20:]           # Last 20 prices
```

### Indicators
```python
self.get_sma(period)              # Simple Moving Average
self.get_ema(period)              # Exponential Moving Average
self.get_rsi(period)              # Relative Strength Index
```

### Signal Creation
```python
self.create_signal(
    action=SignalType.BUY,        # or SELL, HOLD
    bar=bar,
    quantity=100,
    confidence=0.85,              # Optional
    **metadata                    # Optional: your custom data
)
```

### State Management
```python
self.state["key"] = value         # Store state
self.state.get("key", default)    # Retrieve state
self.get_state()                  # Get all state (for API)
```

## Testing Your Strategy

### Method 1: Standalone Test

```python
# At bottom of your strategy file
if __name__ == "__main__":
    strategy = MyStrategy()
    strategy.initialize("test", params)

    # Test with sample bars
    for bar in sample_bars:
        signal = strategy.process_bar(bar)
        if signal:
            print(f"Signal: {signal.action}")
```

Run: `python my_strategy.py`

### Method 2: Via Unified Panel

1. Start Strategy Engine: `python main.py`
2. Open panel: http://localhost:5173/trading
3. Select your strategy
4. Configure params
5. Run backtest

### Method 3: Direct API Call

```bash
curl -X POST http://localhost:8084/strategies/load \
  -H "Content-Type: application/json" \
  -d '{
    "strategy": "my_strategy",
    "params": {"param1": value}
  }'
```

## Parameter Best Practices

✅ **DO:**
- Parameterize all important values
- Provide sensible defaults
- Document parameters in docstring
- Validate parameters in `initialize()`

❌ **DON'T:**
- Hardcode magic numbers
- Assume parameters exist without defaults
- Skip validation

**Example:**
```python
default_params = {
    "period": 20,          # Good default
    "threshold": 0.02      # 2% typical
}

def initialize(self, strategy_id, params):
    super().initialize(strategy_id, params)

    # Validate
    if self.params["period"] < 2:
        raise ValueError("period must be >= 2")
```

## Common Patterns

### Pattern 1: Crossover Strategy

```python
def process_bar(self, bar):
    self.update_history(float(bar['close']))

    indicator1 = calculate_indicator1()
    indicator2 = calculate_indicator2()

    current_state = "above" if indicator1 > indicator2 else "below"

    if self.prev_state == "below" and current_state == "above":
        return self.create_signal(SignalType.BUY, bar)

    if self.prev_state == "above" and current_state == "below":
        return self.create_signal(SignalType.SELL, bar)

    self.prev_state = current_state
    return None
```

### Pattern 2: Threshold Strategy

```python
def process_bar(self, bar):
    self.update_history(float(bar['close']))

    indicator = calculate_indicator()

    if indicator > self.buy_threshold and not self.position:
        self.position = "long"
        return self.create_signal(SignalType.BUY, bar)

    if indicator < self.sell_threshold and self.position:
        self.position = None
        return self.create_signal(SignalType.SELL, bar)

    return None
```

### Pattern 3: Confirmation Strategy

```python
def process_bar(self, bar):
    self.update_history(float(bar['close']))

    indicator = calculate_indicator()

    # Enter zone
    if indicator > threshold:
        self.in_zone = True

    # Exit zone with confirmation
    if self.in_zone and indicator < threshold:
        self.in_zone = False
        return self.create_signal(SignalType.BUY, bar,
            reason="confirmed_exit_from_zone")

    return None
```

## Debugging Tips

### Add Logging

```python
def process_bar(self, bar):
    print(f"Bar: {bar['time']} Close: {bar['close']}")
    print(f"History: {len(self.bars_history)} bars")

    indicator = self.calculate_something()
    print(f"Indicator: {indicator}")

    if condition:
        print("⚡ SIGNAL GENERATED!")
        return signal
```

### Check State via API

```bash
curl http://localhost:8084/strategies/status
```

Returns strategy state including `strategy_state` with all your state variables.

### Use Try-Except

```python
def process_bar(self, bar):
    try:
        # Your logic
        pass
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None
```

## Next Steps

1. **Read the guide:** `docs/STRATEGY_DEVELOPMENT_GUIDE.md`
2. **Copy the template:** `cp template/strategy_template.py my_strategy.py`
3. **Implement your logic**
4. **Test standalone**
5. **Run backtest**
6. **Paper trade 30 days**
7. **Go live!** 🚀

## Need Help?

- **Full documentation:** `docs/STRATEGY_DEVELOPMENT_GUIDE.md`
- **Template with comments:** `template/strategy_template.py`
- **Example strategies:** `buy_and_hold.py`, `ma_crossover.py`, `rsi_strategy.py`
- **Base class reference:** `base_strategy.py` (docstrings)

Happy trading! 📈
