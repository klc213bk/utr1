<template>
  <div class="unified-trading-panel">
    <!-- Header -->
    <div class="panel-header">
      <div class="header-left">
        <span class="panel-icon">🎯</span>
        <h2>Trading Control</h2>
      </div>
      <div class="header-right">
        <span class="session-indicator" :class="currentMode">
          {{ currentMode.toUpperCase() }}
        </span>
      </div>
    </div>

    <!-- Mode Selector -->
    <div class="mode-selector">
      <label class="mode-option">
        <input
          type="radio"
          v-model="selectedMode"
          value="backtest"
          :disabled="isRunning && currentMode !== 'backtest'"
        />
        <span class="mode-label">
          <span class="mode-icon">📊</span>
          Backtest
          <small>Historical simulation</small>
        </span>
      </label>

      <label class="mode-option">
        <input
          type="radio"
          v-model="selectedMode"
          value="paper"
          :disabled="isRunning && currentMode !== 'paper'"
        />
        <span class="mode-label">
          <span class="mode-icon">📝</span>
          Paper Trading
          <small>Live data, simulated execution</small>
        </span>
      </label>

      <label class="mode-option">
        <input
          type="radio"
          v-model="selectedMode"
          value="live"
          :disabled="isRunning && currentMode !== 'live'"
        />
        <span class="mode-label">
          <span class="mode-icon">🔴</span>
          Live Trading
          <small>Real money - Use with caution!</small>
        </span>
      </label>
    </div>

    <!-- Backtest Mode -->
    <div v-if="selectedMode === 'backtest'" class="mode-content">
      <BacktestMode
        :is-running="isRunning"
        @start="startBacktest"
        @stop="stopBacktest"
      />
    </div>

    <!-- Paper Trading Mode -->
    <div v-else-if="selectedMode === 'paper'" class="mode-content">
      <PaperTradingMode
        :is-running="isRunning"
        :session-data="paperSession"
        @start="startPaperTrading"
        @stop="stopPaperTrading"
      />
    </div>

    <!-- Live Trading Mode -->
    <div v-else-if="selectedMode === 'live'" class="mode-content">
      <LiveTradingMode
        :is-running="isRunning"
        :session-data="liveSession"
        @start="startLiveTrading"
        @stop="stopLiveTrading"
      />
    </div>

    <!-- Warning when switching modes -->
    <div v-if="showModeWarning" class="mode-warning">
      ⚠️ Switching modes will stop the current session. Continue?
      <button @click="confirmModeSwitch">Yes</button>
      <button @click="cancelModeSwitch">No</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import axios from 'axios'
import BacktestMode from './modes/BacktestMode.vue'
import PaperTradingMode from './modes/PaperTradingMode.vue'
import LiveTradingMode from './modes/LiveTradingMode.vue'

// State
const selectedMode = ref('backtest')
const currentMode = ref('backtest')
const isRunning = ref(false)
const showModeWarning = ref(false)
const pendingMode = ref(null)

const paperSession = ref(null)
const liveSession = ref(null)

// Watch for mode changes
watch(selectedMode, (newMode, oldMode) => {
  if (isRunning.value && newMode !== currentMode.value) {
    // Show warning if switching while running
    showModeWarning.value = true
    pendingMode.value = newMode
    selectedMode.value = oldMode // Revert temporarily
  }
})

// Backtest functions
async function startBacktest(config) {
  try {
    const response = await axios.post('http://localhost:8083/api/backtest/start', config)
    isRunning.value = true
    currentMode.value = 'backtest'
  } catch (error) {
    alert(`Failed to start backtest: ${error.message}`)
  }
}

async function stopBacktest() {
  try {
    await axios.post('http://localhost:8083/api/backtest/stop')
    isRunning.value = false
  } catch (error) {
    alert(`Failed to stop backtest: ${error.message}`)
  }
}

// Paper trading functions
async function startPaperTrading(config) {
  try {
    // Create portfolio session
    await axios.post('http://localhost:8088/api/portfolio/session/create', {
      sessionId: 'paper',
      initialCapital: config.initialCapital || 100000
    })

    // Create trading session
    await axios.post('http://localhost:3000/api/trading-sessions/create', {
      sessionId: 'paper',
      sessionType: 'paper',
      strategyName: config.strategy,
      initialCapital: config.initialCapital || 100000,
      status: 'active'
    })

    isRunning.value = true
    currentMode.value = 'paper'

    // Start polling for updates
    startSessionPolling('paper')
  } catch (error) {
    alert(`Failed to start paper trading: ${error.message}`)
  }
}

async function stopPaperTrading() {
  const confirmed = confirm(
    'Stop paper trading session?\n\n' +
    `Current P&L: $${paperSession.value?.totalPnL || 0}\n` +
    `Open Positions: ${paperSession.value?.numPositions || 0}\n\n` +
    'Continue?'
  )

  if (!confirmed) return

  try {
    await axios.post('http://localhost:8088/api/portfolio/session/close/paper')
    isRunning.value = false
    paperSession.value = null
    stopSessionPolling()
  } catch (error) {
    alert(`Failed to stop paper trading: ${error.message}`)
  }
}

// Live trading functions
async function startLiveTrading(config) {
  // Multi-step confirmation
  const step1 = confirm('⚠️ WARNING: You are about to start LIVE TRADING with REAL MONEY!\n\nContinue?')
  if (!step1) return

  const step2 = confirm(
    'RISK DISCLOSURE:\n' +
    '- You can lose all your capital\n' +
    '- Past performance does not guarantee future results\n' +
    '- Trading involves substantial risk\n\n' +
    'Do you understand and accept these risks?'
  )
  if (!step2) return

  const confirmation = prompt(
    'Type "START LIVE TRADING" to confirm:\n\n' +
    `Initial Capital: $${config.initialCapital}\n` +
    `Strategy: ${config.strategy}\n` +
    `Max Daily Loss: $5,000`
  )

  if (confirmation !== 'START LIVE TRADING') {
    alert('Live trading NOT started - confirmation failed')
    return
  }

  try {
    // Create portfolio session
    await axios.post('http://localhost:8088/api/portfolio/session/create', {
      sessionId: 'live',
      initialCapital: config.initialCapital
    })

    // Create trading session
    await axios.post('http://localhost:3000/api/trading-sessions/create', {
      sessionId: 'live',
      sessionType: 'live',
      strategyName: config.strategy,
      initialCapital: config.initialCapital,
      status: 'active'
    })

    isRunning.value = true
    currentMode.value = 'live'

    // Start polling for updates
    startSessionPolling('live')

    alert('🔴 LIVE TRADING STARTED')
  } catch (error) {
    alert(`Failed to start live trading: ${error.message}`)
  }
}

async function stopLiveTrading() {
  const confirmed = confirm(
    '⚠️ STOP LIVE TRADING?\n\n' +
    `Current P&L: $${liveSession.value?.totalPnL || 0}\n` +
    `Open Positions: ${liveSession.value?.numPositions || 0}\n\n` +
    'This will close all positions at market price.\n\n' +
    'Type "STOP LIVE TRADING" to confirm:'
  )

  const confirmation = prompt('Type "STOP LIVE TRADING":')
  if (confirmation !== 'STOP LIVE TRADING') {
    alert('Live trading NOT stopped')
    return
  }

  try {
    await axios.post('http://localhost:8088/api/portfolio/session/close/live')
    isRunning.value = false
    liveSession.value = null
    stopSessionPolling()

    alert('Live trading stopped')
  } catch (error) {
    alert(`Failed to stop live trading: ${error.message}`)
  }
}

// Session polling
let pollingInterval = null

function startSessionPolling(sessionType) {
  stopSessionPolling()

  pollingInterval = setInterval(async () => {
    try {
      const response = await axios.get(`http://localhost:8088/api/portfolio/state/${sessionType}`)
      if (sessionType === 'paper') {
        paperSession.value = response.data
      } else if (sessionType === 'live') {
        liveSession.value = response.data
      }
    } catch (error) {
      console.error('Failed to poll session state:', error)
    }
  }, 5000)
}

function stopSessionPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
}

// Mode switching
function confirmModeSwitch() {
  // Stop current session
  if (currentMode.value === 'backtest') {
    stopBacktest()
  } else if (currentMode.value === 'paper') {
    stopPaperTrading()
  } else if (currentMode.value === 'live') {
    stopLiveTrading()
  }

  // Switch to new mode
  selectedMode.value = pendingMode.value
  showModeWarning.value = false
  pendingMode.value = null
}

function cancelModeSwitch() {
  showModeWarning.value = false
  pendingMode.value = null
}

// Check for active sessions on mount
onMounted(async () => {
  // Check for active paper session
  try {
    const paperResponse = await axios.get('http://localhost:8088/api/portfolio/state/paper')
    if (paperResponse.data) {
      paperSession.value = paperResponse.data
      isRunning.value = true
      currentMode.value = 'paper'
      selectedMode.value = 'paper'
      startSessionPolling('paper')
    }
  } catch (error) {
    // No paper session
  }

  // Check for active live session
  try {
    const liveResponse = await axios.get('http://localhost:8088/api/portfolio/state/live')
    if (liveResponse.data) {
      liveSession.value = liveResponse.data
      isRunning.value = true
      currentMode.value = 'live'
      selectedMode.value = 'live'
      startSessionPolling('live')
    }
  } catch (error) {
    // No live session
  }

  // Check for active backtest
  try {
    const backtestResponse = await axios.get('http://localhost:8083/api/backtest/status')
    if (backtestResponse.data.isRunning) {
      isRunning.value = true
      currentMode.value = 'backtest'
      selectedMode.value = 'backtest'
    }
  } catch (error) {
    // No backtest running
  }
})
</script>

<style lang="scss" scoped>
.unified-trading-panel {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 2rem;
  margin: 2rem 0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;

  .header-left {
    display: flex;
    align-items: center;
    gap: 1rem;

    .panel-icon {
      font-size: 2rem;
    }

    h2 {
      margin: 0;
      color: white;
    }
  }

  .session-indicator {
    padding: 0.5rem 1rem;
    border-radius: 20px;
    font-weight: 600;
    font-size: 0.85rem;

    &.backtest {
      background: rgba(96, 165, 250, 0.2);
      color: #60a5fa;
      border: 1px solid #60a5fa;
    }

    &.paper {
      background: rgba(251, 191, 36, 0.2);
      color: #fbbf24;
      border: 1px solid #fbbf24;
    }

    &.live {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
      border: 1px solid #ef4444;
      animation: pulse 2s infinite;
    }
  }
}

.mode-selector {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 2rem;

  .mode-option {
    position: relative;
    cursor: pointer;

    input[type="radio"] {
      position: absolute;
      opacity: 0;

      &:checked + .mode-label {
        background: rgba(96, 165, 250, 0.2);
        border-color: #60a5fa;
      }

      &:disabled + .mode-label {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .mode-label {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 1.5rem;
      background: rgba(255, 255, 255, 0.05);
      border: 2px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      transition: all 0.3s ease;

      &:hover {
        background: rgba(255, 255, 255, 0.08);
      }

      .mode-icon {
        font-size: 2rem;
        margin-bottom: 0.5rem;
      }

      small {
        font-size: 0.75rem;
        opacity: 0.7;
        margin-top: 0.25rem;
      }
    }
  }
}

.mode-content {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  padding: 2rem;
  min-height: 400px;
}

.mode-warning {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(239, 68, 68, 0.95);
  color: white;
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  z-index: 1000;

  button {
    margin: 1rem 0.5rem 0;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 6px;
    cursor: pointer;

    &:first-of-type {
      background: white;
      color: #ef4444;
    }

    &:last-of-type {
      background: transparent;
      border: 1px solid white;
      color: white;
    }
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
</style>
