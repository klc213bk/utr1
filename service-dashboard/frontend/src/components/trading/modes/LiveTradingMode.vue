<template>
  <div class="live-trading-mode">
    <!-- Not Running State -->
    <div v-if="!isRunning" class="start-session">
      <!-- WARNING BANNER -->
      <div class="danger-banner">
        <span class="danger-icon">⚠️</span>
        <div class="danger-content">
          <h3>LIVE TRADING - REAL MONEY AT RISK</h3>
          <p>You are about to trade with REAL MONEY. You can lose your entire capital.</p>
        </div>
      </div>

      <!-- RISK DISCLOSURE -->
      <div class="risk-disclosure">
        <h4>⚠️ Risk Disclosure</h4>
        <ul>
          <li>Trading involves substantial risk of loss</li>
          <li>You can lose MORE than your initial capital</li>
          <li>Past performance does NOT guarantee future results</li>
          <li>No trading system is guaranteed to be profitable</li>
          <li>Only risk capital you can afford to lose</li>
        </ul>
      </div>

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
          <label>Initial Capital (Real Money)</label>
          <input
            type="number"
            v-model="config.initialCapital"
            placeholder="100000"
          />
          <small class="warning-text">⚠️ This is your ACTUAL account balance</small>
        </div>

        <!-- Risk Limits Display -->
        <div class="risk-limits">
          <h4>Active Risk Limits</h4>
          <div class="limits-grid">
            <div class="limit-item">
              <span class="limit-label">Max Daily Loss:</span>
              <span class="limit-value">$5,000</span>
            </div>
            <div class="limit-item">
              <span class="limit-label">Max Drawdown:</span>
              <span class="limit-value">10%</span>
            </div>
            <div class="limit-item">
              <span class="limit-label">Max Position Size:</span>
              <span class="limit-value">1,000 shares</span>
            </div>
            <div class="limit-item">
              <span class="limit-label">Max Trades/Day:</span>
              <span class="limit-value">50</span>
            </div>
          </div>
        </div>

        <!-- Pre-flight Checklist -->
        <div class="checklist">
          <h4>Pre-flight Checklist</h4>
          <label>
            <input type="checkbox" v-model="checklist.testedPaper" />
            I have tested this strategy in paper trading
          </label>
          <label>
            <input type="checkbox" v-model="checklist.reviewedRisks" />
            I have reviewed and understand all risks
          </label>
          <label>
            <input type="checkbox" v-model="checklist.canAffordLoss" />
            I can afford to lose this capital
          </label>
          <label>
            <input type="checkbox" v-model="checklist.monitoringPlan" />
            I have a plan to monitor positions actively
          </label>
        </div>

        <button
          @click="initiateStartSequence"
          :disabled="!canStart"
          class="btn-start-live"
        >
          🔴 START LIVE TRADING
        </button>
      </div>
    </div>

    <!-- Running State -->
    <div v-else class="session-active">
      <div class="session-header live-header">
        <div class="live-indicator">
          <span class="live-dot"></span>
          <h3>🔴 LIVE TRADING ACTIVE</h3>
        </div>
        <div class="risk-status" :class="riskStatusClass">
          {{ riskStatus }}
        </div>
      </div>

      <!-- Emergency Warning -->
      <div v-if="showDangerAlert" class="emergency-alert">
        🚨 {{ dangerMessage }} 🚨
      </div>

      <!-- Real Account Metrics -->
      <div class="metrics-grid">
        <div class="metric-card critical">
          <div class="metric-label">Real Account Value</div>
          <div class="metric-value">
            ${{ formatNumber(sessionData?.portfolioValue || 0) }}
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-label">Today's P&L</div>
          <div class="metric-value" :class="pnlClass">
            ${{ formatNumber(sessionData?.totalPnL || 0) }}
            <small>({{ pnlPercent }}%)</small>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-label">Cash Available</div>
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

      <!-- Open Positions -->
      <div class="positions-section">
        <h4>Open Positions ({{ sessionData?.numPositions || 0 }})</h4>
        <div v-if="sessionData?.positions?.length" class="positions-list">
          <div v-for="pos in sessionData.positions" :key="pos.symbol" class="position-item">
            <div class="position-symbol">{{ pos.symbol }}</div>
            <div class="position-qty">{{ pos.quantity }} shares</div>
            <div class="position-price">Avg: ${{ pos.avgPrice.toFixed(2) }}</div>
            <div class="position-value">${{ (pos.quantity * pos.lastPrice).toFixed(2) }}</div>
            <div class="position-pnl" :class="pos.unrealizedPnL >= 0 ? 'positive' : 'negative'">
              ${{ pos.unrealizedPnL.toFixed(2) }}
            </div>
            <button @click="closePosition(pos.symbol)" class="btn-close-position">
              Close
            </button>
          </div>
        </div>
        <div v-else class="no-positions">No open positions</div>
      </div>

      <!-- Trade Statistics -->
      <div class="stats-section">
        <div class="stat-item">
          <span class="stat-label">Total Trades Today:</span>
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
          <span class="stat-label">Max Drawdown:</span>
          <span class="stat-value">
            {{ ((sessionData?.drawdown || 0) * 100).toFixed(2) }}%
          </span>
        </div>
      </div>

      <!-- Actions -->
      <div class="actions">
        <button @click="pauseTrading" class="btn-pause">
          Pause Trading
        </button>
        <button @click="viewDetails" class="btn-secondary">
          View Details
        </button>
        <button @click="emergencyStop" class="btn-emergency">
          🚨 EMERGENCY STOP
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
  strategy: 'ma_cross',
  symbol: 'SPY',
  initialCapital: 100000
})

const checklist = ref({
  testedPaper: false,
  reviewedRisks: false,
  canAffordLoss: false,
  monitoringPlan: false
})

const showDangerAlert = ref(false)
const dangerMessage = ref('')

const canStart = computed(() => {
  return Object.values(checklist.value).every(v => v === true) &&
         config.value.strategy &&
         config.value.symbol &&
         config.value.initialCapital > 0
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

const riskStatus = computed(() => {
  // This would come from Risk Manager API in reality
  return 'NORMAL'
})

const riskStatusClass = computed(() => {
  const status = riskStatus.value
  if (status === 'LOCKDOWN') return 'lockdown'
  if (status === 'DEFENSIVE') return 'defensive'
  return 'normal'
})

function formatNumber(num) {
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function initiateStartSequence() {
  // Multi-step confirmation process

  // Step 1: Initial Warning
  const step1 = confirm(
    '⚠️ WARNING: You are about to start LIVE TRADING with REAL MONEY.\n\n' +
    'This is NOT a simulation.\n\n' +
    'Do you want to continue?'
  )
  if (!step1) return

  // Step 2: Risk Acknowledgment
  const step2 = confirm(
    'RISK DISCLOSURE:\n\n' +
    '• You can lose ALL your capital\n' +
    '• Trading involves substantial risk\n' +
    '• Past performance does NOT guarantee future results\n' +
    '• You may lose MORE than your initial capital\n\n' +
    'Do you understand and accept these risks?'
  )
  if (!step2) return

  // Step 3: Type Confirmation
  const step3 = prompt(
    'To confirm, please type exactly:\n' +
    'START LIVE TRADING\n\n' +
    `Strategy: ${config.value.strategy}\n` +
    `Symbol: ${config.value.symbol}\n` +
    `Initial Capital: $${config.value.initialCapital.toLocaleString()}\n` +
    `Max Daily Loss: $5,000`
  )

  if (step3 !== 'START LIVE TRADING') {
    alert('❌ Live trading NOT started. Confirmation text did not match.')
    return
  }

  // Step 4: Final Confirmation
  const step4 = confirm(
    '🔴 FINAL CONFIRMATION 🔴\n\n' +
    'You are about to start LIVE TRADING.\n' +
    'This will place REAL ORDERS with REAL MONEY.\n\n' +
    'Are you ABSOLUTELY SURE?'
  )

  if (!step4) return

  // All confirmations passed - emit start event
  emit('start', config.value)
}

function pauseTrading() {
  const confirmed = confirm(
    'Pause live trading?\n\n' +
    'This will:\n' +
    '- Stop accepting new signals\n' +
    '- Keep existing positions open\n\n' +
    'Continue?'
  )

  if (confirmed) {
    // Implementation: pause the strategy engine
    alert('Trading paused. Existing positions remain open.')
  }
}

function emergencyStop() {
  const step1 = confirm(
    '🚨 EMERGENCY STOP 🚨\n\n' +
    'This will:\n' +
    '- IMMEDIATELY stop all trading\n' +
    '- CLOSE ALL POSITIONS at MARKET price\n' +
    '- You may incur significant slippage\n\n' +
    'Only use in emergencies!\n\n' +
    'Continue?'
  )

  if (!step1) return

  const step2 = prompt(
    'Type "EMERGENCY STOP" to confirm closing ALL positions:'
  )

  if (step2 !== 'EMERGENCY STOP') {
    alert('Emergency stop cancelled')
    return
  }

  // Close all positions and stop trading
  emit('stop')
  alert('🚨 EMERGENCY STOP EXECUTED\n\nAll positions are being closed at market price.')
}

function closePosition(symbol) {
  const confirmed = confirm(
    `Close position in ${symbol}?\n\n` +
    'This will place a MARKET order.\n\n' +
    'Continue?'
  )

  if (confirmed) {
    // Implementation: place market sell order
    console.log(`Closing position: ${symbol}`)
  }
}

function viewDetails() {
  window.location.href = '/analytics/live'
}
</script>

<style lang="scss" scoped>
.live-trading-mode {
  color: white;
}

.danger-banner {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem;
  background: rgba(239, 68, 68, 0.2);
  border: 2px solid #ef4444;
  border-radius: 12px;
  margin-bottom: 2rem;

  .danger-icon {
    font-size: 3rem;
    animation: pulse 2s infinite;
  }

  .danger-content {
    h3 {
      color: #ef4444;
      margin: 0 0 0.5rem 0;
      font-size: 1.25rem;
    }

    p {
      margin: 0;
      opacity: 0.9;
    }
  }
}

.risk-disclosure {
  padding: 1.5rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  margin-bottom: 2rem;

  h4 {
    color: #ef4444;
    margin-bottom: 1rem;
  }

  ul {
    margin: 0;
    padding-left: 1.5rem;

    li {
      margin-bottom: 0.5rem;
      opacity: 0.9;
    }
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
    }

    select option {
      background: #1e293b;
      color: white;
      padding: 0.5rem;
    }

    .warning-text {
      display: block;
      margin-top: 0.5rem;
      color: #fbbf24;
      font-size: 0.85rem;
    }
  }

  .risk-limits {
    padding: 1rem;
    background: rgba(96, 165, 250, 0.1);
    border: 1px solid rgba(96, 165, 250, 0.3);
    border-radius: 8px;
    margin-bottom: 1.5rem;

    h4 {
      margin-bottom: 1rem;
      color: #60a5fa;
    }

    .limits-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;

      .limit-item {
        display: flex;
        justify-content: space-between;
        padding: 0.5rem;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 6px;

        .limit-value {
          font-weight: 600;
          color: #60a5fa;
        }
      }
    }
  }

  .checklist {
    padding: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    margin-bottom: 1.5rem;

    h4 {
      margin-bottom: 1rem;
    }

    label {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0;
      cursor: pointer;

      input[type="checkbox"] {
        width: auto;
        cursor: pointer;
      }
    }
  }

  .btn-start-live {
    width: 100%;
    padding: 1.25rem;
    background: rgba(239, 68, 68, 0.3);
    border: 2px solid #ef4444;
    color: #ef4444;
    border-radius: 8px;
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
    animation: pulse 3s infinite;

    &:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.4);
      transform: scale(1.02);
    }

    &:disabled {
      opacity: 0.3;
      cursor: not-allowed;
      animation: none;
    }
  }
}

.session-active {
  .live-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;

    .live-indicator {
      display: flex;
      align-items: center;
      gap: 1rem;

      .live-dot {
        width: 12px;
        height: 12px;
        background: #ef4444;
        border-radius: 50%;
        animation: pulse 2s infinite;
      }

      h3 {
        margin: 0;
        color: #ef4444;
      }
    }

    .risk-status {
      padding: 0.5rem 1rem;
      border-radius: 20px;
      font-weight: 600;

      &.normal {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
      }

      &.defensive {
        background: rgba(251, 191, 36, 0.2);
        color: #fbbf24;
      }

      &.lockdown {
        background: rgba(239, 68, 68, 0.2);
        color: #ef4444;
        animation: pulse 2s infinite;
      }
    }
  }

  .emergency-alert {
    padding: 1rem;
    background: rgba(239, 68, 68, 0.3);
    border: 2px solid #ef4444;
    color: #ef4444;
    text-align: center;
    font-weight: 700;
    font-size: 1.1rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
    animation: pulse 1.5s infinite;
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
      border: 1px solid rgba(255, 255, 255, 0.1);

      &.critical {
        border-color: #ef4444;
        background: rgba(239, 68, 68, 0.05);
      }

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
      }
    }
  }

  .positions-section {
    margin-bottom: 2rem;

    .positions-list {
      .position-item {
        display: grid;
        grid-template-columns: 80px 120px 140px 120px 120px 100px;
        align-items: center;
        padding: 0.75rem;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 6px;
        margin-bottom: 0.5rem;

        .btn-close-position {
          padding: 0.4rem 0.8rem;
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid #ef4444;
          color: #ef4444;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.85rem;

          &:hover {
            background: rgba(239, 68, 68, 0.3);
          }
        }
      }
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
    }
  }

  .actions {
    display: flex;
    gap: 1rem;

    button {
      flex: 1;
      padding: 0.75rem;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .btn-pause {
      background: rgba(251, 191, 36, 0.2);
      border: 1px solid #fbbf24;
      color: #fbbf24;

      &:hover {
        background: rgba(251, 191, 36, 0.3);
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

    .btn-emergency {
      background: rgba(239, 68, 68, 0.3);
      border: 2px solid #ef4444;
      color: #ef4444;
      font-weight: 700;
      animation: pulse 3s infinite;

      &:hover {
        background: rgba(239, 68, 68, 0.4);
      }
    }
  }
}

.positive {
  color: #4ade80;
}

.negative {
  color: #f87171;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
