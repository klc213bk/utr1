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
            <option value="ma_cross">Moving Average Crossover (20/50)</option>
            <option value="rsi">RSI Strategy (14)</option>
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

      <!-- Activity Feed -->
      <div class="activity-feed-section">
        <div class="activity-header">
          <h4>📊 Live Activity Feed</h4>
          <div class="activity-filters">
            <button
              v-for="filter in activityFilters"
              :key="filter.value"
              :class="['filter-btn', { active: activeFilter === filter.value }]"
              @click="activeFilter = filter.value"
            >
              {{ filter.label }}
            </button>
          </div>
        </div>
        <div class="activity-list" ref="activityListRef">
          <div
            v-for="event in filteredActivities"
            :key="event.id"
            :class="['activity-item', event.type]"
          >
            <span class="activity-icon">{{ getActivityIcon(event.type) }}</span>
            <div class="activity-content">
              <div class="activity-main">
                <span class="activity-time">{{ formatTime(event.timestamp) }}</span>
                <span class="activity-text">{{ formatActivityText(event) }}</span>
              </div>
              <div v-if="event.reason" class="activity-reason">{{ event.reason }}</div>
            </div>
          </div>
          <div v-if="filteredActivities.length === 0" class="no-activity">
            No activity yet. Waiting for trading events...
          </div>
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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { io } from 'socket.io-client'

const props = defineProps({
  isRunning: Boolean,
  sessionData: Object
})

const emit = defineEmits(['start', 'stop'])

const config = ref({
  strategy: 'ma_cross',
  symbol: 'SPY',
  initialCapital: 100000,
  maxDailyLoss: 5000,
  maxDrawdown: 10
})

// Activity feed state
const activities = ref([])
const activeFilter = ref('all')
const activityListRef = ref(null)
let activityIdCounter = 0
let socket = null

const activityFilters = [
  { label: 'All', value: 'all' },
  { label: 'Signals', value: 'signal' },
  { label: 'Risk', value: 'risk' },
  { label: 'Executions', value: 'fill' },
  { label: 'Market', value: 'price' }
]

const filteredActivities = computed(() => {
  if (activeFilter.value === 'all') {
    return activities.value
  }
  if (activeFilter.value === 'risk') {
    return activities.value.filter(a => a.type === 'risk-approved' || a.type === 'risk-rejected')
  }
  return activities.value.filter(a => a.type === activeFilter.value)
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

// Activity feed functions
function addActivity(event) {
  activities.value.unshift({
    ...event,
    id: activityIdCounter++
  })

  // Limit to 50 events
  if (activities.value.length > 50) {
    activities.value.pop()
  }

  // Auto-scroll to top
  nextTick(() => {
    if (activityListRef.value) {
      activityListRef.value.scrollTop = 0
    }
  })
}

function getActivityIcon(type) {
  const icons = {
    'signal': '📊',
    'risk-approved': '✅',
    'risk-rejected': '❌',
    'fill': '💰',
    'price': '📈'
  }
  return icons[type] || '•'
}

function formatActivityText(event) {
  switch (event.type) {
    case 'signal':
      return `${event.action} ${event.quantity} ${event.symbol} @ $${event.price?.toFixed(2) || '?'}`
    case 'risk-approved':
      return `${event.action} ${event.quantity} ${event.symbol} APPROVED`
    case 'risk-rejected':
      return `${event.action} ${event.quantity} ${event.symbol} REJECTED`
    case 'fill':
      return `FILLED: ${event.action} ${event.quantity} ${event.symbol} @ $${event.price?.toFixed(2)}`
    case 'price':
      return `${event.symbol} → $${event.price?.toFixed(2)}`
    default:
      return JSON.stringify(event)
  }
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function connectToActivityFeed() {
  // Connect to Portfolio Manager WebSocket
  socket = io('http://localhost:8088')

  socket.on('connect', () => {
    console.log('Connected to activity feed')
  })

  socket.on('activity:signal', (data) => {
    addActivity(data)
  })

  socket.on('activity:risk-approved', (data) => {
    addActivity(data)
  })

  socket.on('activity:risk-rejected', (data) => {
    addActivity(data)
  })

  socket.on('activity:fill', (data) => {
    addActivity(data)
  })

  socket.on('activity:price', (data) => {
    addActivity(data)
  })

  socket.on('disconnect', () => {
    console.log('Disconnected from activity feed')
  })
}

function disconnectFromActivityFeed() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

// Watch isRunning to connect/disconnect from activity feed
watch(() => props.isRunning, (running) => {
  if (running) {
    connectToActivityFeed()
  } else {
    disconnectFromActivityFeed()
    activities.value = []
  }
}, { immediate: true })

// Lifecycle hooks
onMounted(() => {
  if (props.isRunning) {
    connectToActivityFeed()
  }
})

onUnmounted(() => {
  disconnectFromActivityFeed()
})

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

    select option {
      background: #1e293b;
      color: white;
      padding: 0.5rem;
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

  // Activity Feed
  .activity-feed-section {
    margin-bottom: 2rem;

    .activity-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;

      h4 {
        margin: 0;
      }

      .activity-filters {
        display: flex;
        gap: 0.5rem;

        .filter-btn {
          padding: 0.4rem 0.8rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.7);
          border-radius: 6px;
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.2s ease;

          &:hover {
            background: rgba(255, 255, 255, 0.1);
            color: white;
          }

          &.active {
            background: rgba(96, 165, 250, 0.2);
            border-color: #60a5fa;
            color: #60a5fa;
          }
        }
      }
    }

    .activity-list {
      max-height: 300px;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 8px;
      padding: 1rem;

      &::-webkit-scrollbar {
        width: 6px;
      }

      &::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 3px;
      }

      &::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;

        &:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      }

      .activity-item {
        display: flex;
        gap: 0.75rem;
        padding: 0.75rem;
        margin-bottom: 0.5rem;
        background: rgba(255, 255, 255, 0.03);
        border-left: 3px solid transparent;
        border-radius: 6px;
        animation: fadeIn 0.3s ease;

        &.signal {
          border-left-color: #60a5fa;
        }

        &.risk-approved {
          border-left-color: #4ade80;
        }

        &.risk-rejected {
          border-left-color: #f87171;
        }

        &.fill {
          border-left-color: #fbbf24;
        }

        &.price {
          border-left-color: rgba(255, 255, 255, 0.2);
        }

        .activity-icon {
          font-size: 1.2rem;
          flex-shrink: 0;
        }

        .activity-content {
          flex: 1;
          min-width: 0;

          .activity-main {
            display: flex;
            gap: 0.5rem;
            align-items: baseline;

            .activity-time {
              font-size: 0.75rem;
              color: rgba(255, 255, 255, 0.5);
              flex-shrink: 0;
            }

            .activity-text {
              font-size: 0.9rem;
              color: white;
            }
          }

          .activity-reason {
            font-size: 0.8rem;
            color: #f87171;
            margin-top: 0.25rem;
            font-style: italic;
          }
        }
      }

      .no-activity {
        text-align: center;
        padding: 3rem 1rem;
        color: rgba(255, 255, 255, 0.5);
        font-style: italic;
      }
    }
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
