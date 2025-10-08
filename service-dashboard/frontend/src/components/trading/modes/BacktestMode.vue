<template>
  <div class="backtest-mode">
    <!-- Not Running State -->
    <div v-if="!isRunning" class="start-backtest">
      <h3>📊 Run Historical Backtest</h3>
      <p>Test your strategy against historical data at accelerated speeds.</p>

      <div class="config-form">
        <!-- Strategy Selection -->
        <div class="form-group">
          <label>Strategy</label>
          <select v-model="config.strategy">
            <option value="ma_cross">Moving Average Crossover (20/50)</option>
            <option value="rsi">RSI Strategy (14)</option>
            <option value="momentum">Momentum Strategy</option>
            <option value="buy_hold">Buy & Hold</option>
          </select>
        </div>

        <!-- Symbol -->
        <div class="form-group">
          <label>Symbol</label>
          <input type="text" v-model="config.symbol" placeholder="SPY" />
        </div>

        <!-- Date Range -->
        <div class="form-row">
          <div class="form-group">
            <label>Start Date</label>
            <input
              type="date"
              v-model="config.startDate"
              :max="config.endDate || maxDate"
            />
          </div>
          <div class="form-group">
            <label>End Date</label>
            <input
              type="date"
              v-model="config.endDate"
              :min="config.startDate"
              :max="maxDate"
            />
          </div>
        </div>

        <!-- Initial Capital -->
        <div class="form-group">
          <label>Initial Capital</label>
          <input type="number" v-model="config.initialCapital" placeholder="100000" />
        </div>

        <!-- Replay Speed -->
        <div class="form-group">
          <label>Replay Speed</label>
          <div class="speed-selector">
            <button
              v-for="speed in speeds"
              :key="speed.value"
              @click="config.replaySpeed = speed.value"
              :class="{ active: config.replaySpeed === speed.value }"
              class="speed-btn"
              type="button"
            >
              {{ speed.label }}
            </button>
          </div>
        </div>

        <!-- Info Display -->
        <div v-if="dateRangeIsValid" class="info-banner">
          📅 {{ tradingDaysEstimate }} trading days
          · {{ config.strategy }}
          · {{ replaySpeedLabel }}
        </div>

        <button @click="start" :disabled="!canStart" class="btn-start">
          Start Backtest
        </button>
      </div>
    </div>

    <!-- Running State -->
    <div v-else class="backtest-running">
      <div class="running-header">
        <h3>📊 Backtest in Progress</h3>
        <span class="status-badge">Running</span>
      </div>

      <!-- Progress Bar -->
      <div class="progress-section">
        <div class="progress-bar-container">
          <div class="progress-bar" :style="{ width: `${progress}%` }"></div>
        </div>
        <div class="progress-details">
          <span class="progress-percent">{{ progress }}%</span>
          <span class="progress-message">{{ progressMessage }}</span>
          <span v-if="currentDate" class="current-date">
            Current: {{ currentDate }}
          </span>
        </div>
      </div>

      <!-- Real-time Metrics -->
      <div v-if="liveMetrics" class="live-metrics">
        <div class="metric-card">
          <div class="metric-label">Portfolio Value</div>
          <div class="metric-value">
            ${{ formatNumber(liveMetrics.portfolioValue || 0) }}
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-label">P&L</div>
          <div class="metric-value" :class="liveMetrics.pnl >= 0 ? 'positive' : 'negative'">
            ${{ formatNumber(liveMetrics.pnl || 0) }}
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-label">Total Trades</div>
          <div class="metric-value">
            {{ liveMetrics.totalTrades || 0 }}
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-label">Win Rate</div>
          <div class="metric-value">
            {{ liveMetrics.winRate || 0 }}%
          </div>
        </div>
      </div>

      <!-- Recent Trades -->
      <div v-if="recentTrades?.length" class="recent-trades">
        <h4>Recent Trades</h4>
        <div class="trades-list">
          <div v-for="(trade, idx) in recentTrades.slice(0, 5)" :key="idx" class="trade-item">
            <span class="trade-date">{{ formatDate(trade.timestamp) }}</span>
            <span class="trade-action" :class="trade.action.toLowerCase()">
              {{ trade.action }}
            </span>
            <span class="trade-symbol">{{ trade.symbol }}</span>
            <span class="trade-qty">{{ trade.quantity }} @ ${{ trade.price.toFixed(2) }}</span>
            <span class="trade-pnl" :class="trade.pnl >= 0 ? 'positive' : 'negative'">
              {{ trade.pnl ? `$${trade.pnl.toFixed(2)}` : '-' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="actions">
        <button @click="stop" class="btn-stop">
          Cancel Backtest
        </button>
      </div>
    </div>

    <!-- Completed State -->
    <div v-if="!isRunning && lastBacktestId" class="backtest-completed">
      <div class="completed-banner">
        ✅ Backtest completed! <button @click="viewResults" class="btn-link">View Results →</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, inject } from 'vue'
import axios from 'axios'

const props = defineProps({
  isRunning: Boolean
})

const emit = defineEmits(['start', 'stop'])

// Socket store for real-time updates
const socketsStore = inject('socketsStore')

// Configuration
const config = ref({
  strategy: 'ma_cross',
  symbol: 'SPY',
  startDate: '2023-01-01',
  endDate: '2023-12-31',
  initialCapital: 100000,
  replaySpeed: 1000
})

const speeds = [
  { value: 100, label: '10x' },
  { value: 500, label: '2x' },
  { value: 1000, label: '1x' },
  { value: 2000, label: '0.5x' }
]

// State
const progress = ref(0)
const progressMessage = ref('')
const currentDate = ref('')
const liveMetrics = ref(null)
const recentTrades = ref([])
const lastBacktestId = ref(null)

// Computed
const maxDate = computed(() => {
  const today = new Date()
  return today.toISOString().split('T')[0]
})

const dateRangeIsValid = computed(() => {
  if (!config.value.startDate || !config.value.endDate) return false
  return new Date(config.value.startDate) < new Date(config.value.endDate)
})

const tradingDaysEstimate = computed(() => {
  if (!dateRangeIsValid.value) return 0
  const start = new Date(config.value.startDate)
  const end = new Date(config.value.endDate)
  const diffTime = Math.abs(end - start)
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  // Rough estimate: 252 trading days per year
  return Math.floor(diffDays * (252 / 365))
})

const replaySpeedLabel = computed(() => {
  const speed = speeds.find(s => s.value === config.value.replaySpeed)
  return speed ? speed.label : '1x'
})

const canStart = computed(() => {
  return config.value.strategy &&
         config.value.symbol &&
         dateRangeIsValid.value &&
         config.value.initialCapital > 0
})

// Methods
function formatNumber(num) {
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(timestamp) {
  const date = new Date(timestamp)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function start() {
  emit('start', config.value)
}

function stop() {
  emit('stop')
}

function viewResults() {
  if (lastBacktestId.value) {
    window.location.href = `/analytics/backtest/${lastBacktestId.value}`
  }
}

// WebSocket handlers
function handleProgress(data) {
  progress.value = data.progress || 0
  progressMessage.value = data.message || 'Processing...'
  currentDate.value = data.currentDate || ''
}

function handleMetrics(data) {
  liveMetrics.value = data
}

function handleTrade(trade) {
  recentTrades.value.unshift(trade)
  if (recentTrades.value.length > 10) {
    recentTrades.value.pop()
  }
}

function handleComplete(data) {
  lastBacktestId.value = data.backtestId
  progress.value = 100
  progressMessage.value = 'Backtest completed!'
}

// Setup WebSocket listeners
onMounted(() => {
  if (socketsStore) {
    socketsStore.on('backtest:progress', handleProgress)
    socketsStore.on('backtest:metrics', handleMetrics)
    socketsStore.on('backtest:trade', handleTrade)
    socketsStore.on('backtest:complete', handleComplete)
  }
})

onUnmounted(() => {
  if (socketsStore) {
    socketsStore.off('backtest:progress', handleProgress)
    socketsStore.off('backtest:metrics', handleMetrics)
    socketsStore.off('backtest:trade', handleTrade)
    socketsStore.off('backtest:complete', handleComplete)
  }
})
</script>

<style lang="scss" scoped>
.backtest-mode {
  color: white;
}

.start-backtest {
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

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .speed-selector {
    display: flex;
    gap: 0.5rem;

    .speed-btn {
      flex: 1;
      padding: 0.5rem;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      color: white;
      cursor: pointer;
      transition: all 0.3s ease;

      &:hover {
        background: rgba(255, 255, 255, 0.15);
      }

      &.active {
        background: rgba(96, 165, 250, 0.3);
        border-color: #60a5fa;
        color: #60a5fa;
      }
    }
  }

  .info-banner {
    padding: 1rem;
    background: rgba(96, 165, 250, 0.1);
    border: 1px solid rgba(96, 165, 250, 0.3);
    border-radius: 8px;
    margin-bottom: 1.5rem;
    color: #93c5fd;
    font-size: 0.9rem;
  }

  .btn-start {
    width: 100%;
    padding: 1rem;
    background: rgba(96, 165, 250, 0.2);
    border: 1px solid #60a5fa;
    color: #60a5fa;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;

    &:hover:not(:disabled) {
      background: rgba(96, 165, 250, 0.3);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.backtest-running {
  .running-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;

    .status-badge {
      padding: 0.5rem 1rem;
      background: rgba(96, 165, 250, 0.2);
      border: 1px solid #60a5fa;
      color: #60a5fa;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
    }
  }

  .progress-section {
    margin-bottom: 2rem;

    .progress-bar-container {
      width: 100%;
      height: 8px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 0.5rem;

      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #60a5fa, #3b82f6);
        transition: width 0.3s ease;
      }
    }

    .progress-details {
      display: flex;
      justify-content: space-between;
      font-size: 0.85rem;
      opacity: 0.8;

      .progress-percent {
        font-weight: 600;
      }
    }
  }

  .live-metrics {
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
        font-size: 1.25rem;
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

  .recent-trades {
    margin-bottom: 2rem;

    h4 {
      margin-bottom: 1rem;
    }

    .trades-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;

      .trade-item {
        display: grid;
        grid-template-columns: 120px 60px 60px 150px 100px;
        align-items: center;
        padding: 0.5rem;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 6px;
        font-size: 0.85rem;

        .trade-action {
          font-weight: 600;

          &.buy {
            color: #4ade80;
          }

          &.sell {
            color: #f87171;
          }
        }

        .trade-pnl {
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
  }

  .actions {
    .btn-stop {
      padding: 0.75rem 2rem;
      background: rgba(248, 113, 113, 0.2);
      border: 1px solid #f87171;
      color: #f87171;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;

      &:hover {
        background: rgba(248, 113, 113, 0.3);
      }
    }
  }
}

.backtest-completed {
  .completed-banner {
    padding: 1rem;
    background: rgba(74, 222, 128, 0.1);
    border: 1px solid rgba(74, 222, 128, 0.3);
    color: #4ade80;
    border-radius: 8px;
    margin-bottom: 1rem;

    .btn-link {
      background: none;
      border: none;
      color: #4ade80;
      text-decoration: underline;
      cursor: pointer;
      font-weight: 600;
      margin-left: 0.5rem;
    }
  }
}

.positive {
  color: #4ade80;
}

.negative {
  color: #f87171;
}
</style>
