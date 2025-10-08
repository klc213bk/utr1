<template>
  <div class="paper-trading-mode">
    <!-- Not Running State -->
    <div v-if="!isRunning" class="start-session">
      <h3>📝 Start Paper Trading Session</h3>
      <p>Trade with live market data using simulated execution. Perfect for testing strategies risk-free.</p>

      <div class="config-form">
        <div class="form-group">
          <label>Strategy</label>
          <select v-model="config.strategy">
            <option value="momentum">Momentum Strategy</option>
            <option value="ma_crossover">MA Crossover</option>
            <option value="rsi">RSI Strategy</option>
            <option value="buy_hold">Buy & Hold</option>
          </select>
        </div>

        <div class="form-group">
          <label>Symbol</label>
          <input type="text" v-model="config.symbol" placeholder="SPY" />
        </div>

        <div class="form-group">
          <label>Initial Capital</label>
          <input type="number" v-model="config.initialCapital" placeholder="100000" />
        </div>

        <div class="form-group">
          <label>Risk Limits</label>
          <div class="limits-grid">
            <div>
              <small>Max Daily Loss</small>
              <input type="number" v-model="config.maxDailyLoss" placeholder="5000" />
            </div>
            <div>
              <small>Max Drawdown %</small>
              <input type="number" v-model="config.maxDrawdown" placeholder="10" />
            </div>
          </div>
        </div>

        <button @click="start" class="btn-start">
          Start Paper Trading
        </button>
      </div>
    </div>

    <!-- Running State -->
    <div v-else class="session-active">
      <div class="session-header">
        <h3>📝 Paper Trading Active</h3>
        <span class="status-badge">Running</span>
      </div>

      <!-- Performance Metrics -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">Portfolio Value</div>
          <div class="metric-value">
            ${{ formatNumber(sessionData?.portfolioValue || 0) }}
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-label">P&L</div>
          <div class="metric-value" :class="pnlClass">
            ${{ formatNumber(sessionData?.totalPnL || 0) }}
            <small>({{ pnlPercent }}%)</small>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-label">Cash</div>
          <div class="metric-value">
            ${{ formatNumber(sessionData?.cash || 0) }}
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-label">Buying Power</div>
          <div class="metric-value">
            ${{ formatNumber(sessionData?.buyingPower || 0) }}
          </div>
        </div>
      </div>

      <!-- Position Summary -->
      <div class="positions-section">
        <h4>Current Positions ({{ sessionData?.numPositions || 0 }})</h4>
        <div v-if="sessionData?.positions?.length" class="positions-list">
          <div v-for="pos in sessionData.positions" :key="pos.symbol" class="position-item">
            <div class="position-symbol">{{ pos.symbol }}</div>
            <div class="position-qty">{{ pos.quantity }} shares</div>
            <div class="position-price">Avg: ${{ pos.avgPrice.toFixed(2) }}</div>
            <div class="position-pnl" :class="pos.unrealizedPnL >= 0 ? 'positive' : 'negative'">
              ${{ pos.unrealizedPnL.toFixed(2) }}
            </div>
          </div>
        </div>
        <div v-else class="no-positions">No open positions</div>
      </div>

      <!-- Trade Statistics -->
      <div class="stats-section">
        <div class="stat-item">
          <span class="stat-label">Total Trades:</span>
          <span class="stat-value">{{ sessionData?.totalTrades || 0 }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Realized P&L:</span>
          <span class="stat-value" :class="sessionData?.realizedPnL >= 0 ? 'positive' : 'negative'">
            ${{ formatNumber(sessionData?.realizedPnL || 0) }}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Unrealized P&L:</span>
          <span class="stat-value" :class="sessionData?.unrealizedPnL >= 0 ? 'positive' : 'negative'">
            ${{ formatNumber(sessionData?.unrealizedPnL || 0) }}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Exposure:</span>
          <span class="stat-value">${{ formatNumber(sessionData?.exposure || 0) }}</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="actions">
        <button @click="$emit('stop')" class="btn-stop">
          Stop Paper Trading
        </button>
        <button @click="viewDetails" class="btn-secondary">
          View Details
        </button>
        <button @click="promoteToLive" class="btn-promote">
          Promote to Live Trading →
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  isRunning: Boolean,
  sessionData: Object
})

const emit = defineEmits(['start', 'stop'])

const config = ref({
  strategy: 'momentum',
  symbol: 'SPY',
  initialCapital: 100000,
  maxDailyLoss: 5000,
  maxDrawdown: 10
})

const pnlClass = computed(() => {
  const pnl = props.sessionData?.totalPnL || 0
  return pnl >= 0 ? 'positive' : 'negative'
})

const pnlPercent = computed(() => {
  if (!props.sessionData) return '0.00'
  const initial = props.sessionData.portfolioValue - props.sessionData.totalPnL
  return ((props.sessionData.totalPnL / initial) * 100).toFixed(2)
})

function formatNumber(num) {
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function start() {
  emit('start', config.value)
}

function viewDetails() {
  // Navigate to detailed analytics view
  window.location.href = '/analytics/paper'
}

function promoteToLive() {
  const confirmed = confirm(
    '⚠️ Promote to Live Trading?\n\n' +
    'This will:\n' +
    '- Stop paper trading session\n' +
    '- Copy current configuration to live\n' +
    '- Start trading with REAL MONEY\n\n' +
    'Continue?'
  )

  if (confirmed) {
    // Emit event to parent to switch to live mode
    window.dispatchEvent(new CustomEvent('switch-to-live', { detail: config.value }))
  }
}
</script>

<style lang="scss" scoped>
.paper-trading-mode {
  color: white;
}

.start-session {
  h3 {
    margin-bottom: 0.5rem;
  }

  p {
    opacity: 0.8;
    margin-bottom: 2rem;
  }
}

.config-form {
  .form-group {
    margin-bottom: 1.5rem;

    label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 500;
    }

    input, select {
      width: 100%;
      padding: 0.75rem;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      color: white;
      font-size: 1rem;

      &::placeholder {
        color: rgba(255, 255, 255, 0.5);
      }
    }
  }

  .limits-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;

    small {
      display: block;
      margin-bottom: 0.25rem;
      opacity: 0.7;
    }

    input {
      width: 100%;
    }
  }

  .btn-start {
    width: 100%;
    padding: 1rem;
    background: rgba(251, 191, 36, 0.2);
    border: 1px solid #fbbf24;
    color: #fbbf24;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;

    &:hover {
      background: rgba(251, 191, 36, 0.3);
    }
  }
}

.session-active {
  .session-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;

    .status-badge {
      padding: 0.5rem 1rem;
      background: rgba(74, 222, 128, 0.2);
      border: 1px solid #4ade80;
      color: #4ade80;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
    }
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 2rem;

    .metric-card {
      background: rgba(255, 255, 255, 0.05);
      padding: 1rem;
      border-radius: 8px;

      .metric-label {
        font-size: 0.85rem;
        opacity: 0.7;
        margin-bottom: 0.5rem;
      }

      .metric-value {
        font-size: 1.5rem;
        font-weight: 600;

        small {
          font-size: 0.85rem;
          opacity: 0.7;
        }

        &.positive {
          color: #4ade80;
        }

        &.negative {
          color: #f87171;
        }
      }
    }
  }

  .positions-section {
    margin-bottom: 2rem;

    h4 {
      margin-bottom: 1rem;
    }

    .positions-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;

      .position-item {
        display: grid;
        grid-template-columns: 100px 150px 150px 1fr;
        align-items: center;
        padding: 0.75rem;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 6px;

        .position-symbol {
          font-weight: 600;
        }

        .position-pnl {
          text-align: right;

          &.positive {
            color: #4ade80;
          }

          &.negative {
            color: #f87171;
          }
        }
      }
    }

    .no-positions {
      padding: 2rem;
      text-align: center;
      opacity: 0.5;
    }
  }

  .stats-section {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
    margin-bottom: 2rem;

    .stat-item {
      display: flex;
      justify-content: space-between;
      padding: 0.75rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 6px;

      .stat-label {
        opacity: 0.7;
      }

      .stat-value {
        font-weight: 600;

        &.positive {
          color: #4ade80;
        }

        &.negative {
          color: #f87171;
        }
      }
    }
  }

  .actions {
    display: flex;
    gap: 1rem;

    button {
      flex: 1;
      padding: 0.75rem;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .btn-stop {
      background: rgba(248, 113, 113, 0.2);
      border: 1px solid #f87171;
      color: #f87171;

      &:hover {
        background: rgba(248, 113, 113, 0.3);
      }
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: white;

      &:hover {
        background: rgba(255, 255, 255, 0.15);
      }
    }

    .btn-promote {
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid #ef4444;
      color: #ef4444;

      &:hover {
        background: rgba(239, 68, 68, 0.3);
      }
    }
  }
}
</style>
