<template>
  <div class="backtest-panel">
    <!-- Collapsible Header -->
    <div class="panel-header" @click="toggleExpanded">
      <div class="header-left">
        <span class="panel-icon">🚀</span>
        <h3>Strategy Backtesting</h3>
        <span class="status-badge" :class="statusClass">
          {{ statusText }}
        </span>
      </div>
      <div class="connection-indicator" :class="{ connected: backtestConnected, disconnected: !backtestConnected }">
        <span class="dot" :class="backtestConnected ? 'connected' : 'disconnected'"></span>
        {{ backtestConnected ? 'Backtest server connected' : 'Backtest server offline' }}
      </div>
                 
      <div class="header-right">
        <button class="expand-btn">
          {{ isExpanded ? '▼' : '▶' }}
        </button>
      </div>
    </div>

    <!-- Expandable Body -->
    <transition name="slide">
      <div v-if="isExpanded" class="panel-body">
        <!-- Date Range Selection -->
        <div class="backtest-form">
          <h4>Select Date Range</h4>
          
          <div class="form-group">
            <label for="start-date">Start Date</label>
            <input 
              id="start-date"
              type="date" 
              v-model="startDate"
              :max="maxDate"
              :disabled="isRunning"
              class="date-input"
            />
          </div>

          <div class="form-group">
            <label for="end-date">End Date</label>
            <input 
              id="end-date"
              type="date" 
              v-model="endDate"
              :min="startDate"
              :max="maxDate"
              :disabled="isRunning"
              class="date-input"
            />
          </div>

          <!-- ADD: Simple Strategy Selection -->
          <div class="form-group">
            <label for="strategy">Strategy</label>
            <select 
              id="strategy"
              v-model="selectedStrategy"
              :disabled="isRunning"
              class="select-input"
            >
              <option value="ma_cross">Moving Average (20/50)</option>
              <option value="rsi">RSI (14)</option>
              <option value="buy_hold">Buy & Hold</option>
            </select>
          </div>

          <!-- ADD: Speed Control -->
          <div class="form-group">
            <label>Replay Speed</label>
            <div class="speed-buttons">
              <button 
                v-for="speed in speeds"
                :key="speed.value"
                @click="replaySpeed = speed.value"
                :class="['speed-btn', { active: replaySpeed === speed.value }]"
                :disabled="isRunning"
                type="button"
              >
                {{ speed.label }}
              </button>
            </div>
          </div>

          <!-- Modified info display -->
          <div class="date-info">
            <span v-if="dateRangeIsValid" class="info-text">
              {{ tradingDays }} trading days | {{ selectedStrategyName }} | {{ replaySpeedLabel }}
            </span>
            <span v-else-if="startDate && endDate" class="error-text">
              Invalid date range
            </span>
          </div>

          <button 
            v-if="!isRunning"
            @click="submitBacktest"
            :disabled="!canSubmit || !backtestConnected"
            class="submit-btn"
          >
            <span v-if="isRunning" class="spinner">⏳</span>
            <span v-else>{{ submitButtonText }}</span>
          </button>

          <button 
            v-if="isRunning"
            @click="cancelBacktest"
            class="cancel-btn"
          >
            <span class="icon">❌</span>
            Cancel Backtest
          </button>
        </div>

        <!-- Status Messages -->
        <div v-if="message" class="message-box" :class="messageClass">
          {{ message }}
        </div>

        <!-- Simple Progress Display -->
        <div v-if="isRunning" class="progress-section">
          <div class="progress-bar-container">
            <div class="progress-bar" :style="{ width: `${progress}%` }"></div>
          </div>
          <div class="progress-details">
            <span class="progress-text">{{ progress }}%</span>
            <span class="progress-message">{{ progressMessage }}</span>
            <span v-if="currentReplayTime" class="replay-time">
              Current: {{ currentReplayTime }}
            </span>
          </div>
        </div>

        <div v-if="lastCompletedBacktest" class="results-navigation">
          <button @click="viewResults" class="view-results-btn">
            <span>📊</span>
            View Full Results →
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'
import { io } from 'socket.io-client'
import { useRouter } from 'vue-router'

const router = useRouter()
const lastCompletedBacktest = ref(null)

const props = defineProps({
  socket: {
    type: Object,
    default: null
  }
})

// State
const isExpanded = ref(false)
const isRunning = ref(false)
const startDate = ref('')
const endDate = ref('')
const message = ref('')
const messageType = ref('info') // 'info', 'success', 'error'
const progress = ref(0)
//       State backtesting
const backtestProgress = ref(0)
const progressMessage = ref('')
const currentReplayTime = ref(null)

const backtestSocket = ref(null)
const backtestConnected = ref(false)

// ADD these new refs
const selectedStrategy = ref('ma_cross')
const replaySpeed = ref(10)

// ADD speed options
const speeds = [
  { value: 1, label: 'Real' },        // Real-time
  { value: 10, label: '10x' },        // 10 minutes in 1 minute
  { value: 60, label: '1h/min' },     // 1 hour per minute
  { value: 300, label: '5h/min' },    // 5 hours per minute
  { value: 0, label: 'Max' }          // As fast as possible
]

// ADD computed properties for display
const selectedStrategyName = computed(() => {
  const strategies = {
    'ma_cross': 'MA (20/50)',
    'rsi': 'RSI (14)',
    'buy_hold': 'Buy & Hold'
  }
  return strategies[selectedStrategy.value] || 'Unknown'
})

const replaySpeedLabel = computed(() => {
  return replaySpeed.value === 0 ? 'Max speed' : `${replaySpeed.value}x speed`
})



function connectToBacktestServer() {
  if (!backtestSocket.value || !backtestSocket.value.connected) {
    backtestSocket.value = io('http://localhost:8083', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })
    
    backtestSocket.value.on('connect_error', (error) => {
      console.log('Backtest server not available:', error.message)
      backtestConnected.value = false
      // Don't show error to user - just disable backtest functionality
    })

    backtestSocket.value.io.on('reconnect_attempt', (attemptNumber) => {
      console.log('Attempting to reconnect to backtest server...', attemptNumber)
    })

    backtestSocket.value.on('connect', () => {
      console.log('Connected to backtest server')
      backtestConnected.value = true
    })
    
    backtestSocket.value.on('disconnect', () => {
      console.log('Disconnected from backtest server')
      backtestConnected.value = false
    })

    backtestSocket.value.on('backtest-progress', (data) => {
      progress.value = Math.round(data.progress || 0)
      message.value = data.message || `Processing: ${data.barsPublished}/${data.totalBars} bars`
      messageType.value = 'info'
      
      if (data.currentTime) {
        // Optional: show current replay time
        console.log('Current replay time:', new Date(data.currentTime).toLocaleTimeString())
      }
    })
    
    backtestSocket.value.on('replay-progress', (data) => {
      if (data.barsPublished && data.totalBars) {
        progress.value = Math.round((data.barsPublished / data.totalBars) * 100)
      }
    })

    backtestSocket.value.on('backtest-complete', (data) => {
      console.log('Backtest completed:', data)
      lastCompletedBacktest.value = data
      progress.value = 100
      progressMessage.value = ''  // Clear the "Calculating..." message
  
      // Show the actual results in the message
      if (data.results) {
        message.value = `Backtest completed! Return: ${data.results.totalReturn}%, Win Rate: ${data.results.winRate}%`
      } else {
        message.value = 'Backtest completed successfully!'
      }
      
      messageType.value = 'success'
      isRunning.value = false
    })
    
    backtestSocket.value.on('backtest-error', (data) => {
      isRunning.value = false
      progress.value = 0
      message.value = data.error || 'Backtest failed'
      messageType.value = 'error'
    })

  }
}

function viewResults() {
  if (lastCompletedBacktest.value?.backtestId) {
    router.push(`/analytics/backtest/${lastCompletedBacktest.value.backtestId}`)
  }
}

onMounted(() => {
  const today = new Date()
  const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000))
  
  endDate.value = formatDateForInput(today)
  startDate.value = formatDateForInput(thirtyDaysAgo)
  
  // Setup socket listeners if available
  if (props.socket) {
    setupSocketListeners()
  }

  // Connect to backtest server
  // backtestSocket.value = io('http://localhost:8083', {
  //   transports: ['websocket', 'polling'],
  //   reconnection: true,
  //   reconnectionAttempts: 5,
  //   reconnectionDelay: 1000,
  // })
  
  // backtestSocket.value.on('connect_error', (error) => {
  //   console.log('Backtest server not available:', error.message)
  //   backtestConnected.value = false
  //   // Don't show error to user - just disable backtest functionality
  // })

  // backtestSocket.value.io.on('reconnect_attempt', (attemptNumber) => {
  //   console.log('Attempting to reconnect to backtest server...', attemptNumber)
  // })

  // backtestSocket.value.on('connect', () => {
  //   console.log('Connected to backtest server')
  //   backtestConnected.value = true
  // })
  
  // backtestSocket.value.on('disconnect', () => {
  //   console.log('Disconnected from backtest server')
  //   backtestConnected.value = false
  // })

  // backtestSocket.value.on('backtest-progress', (data) => {
  //   progress.value = Math.round(data.progress || 0)
  //   message.value = data.message || `Processing: ${data.barsPublished}/${data.totalBars} bars`
  //   messageType.value = 'info'
    
  //   if (data.currentTime) {
  //     // Optional: show current replay time
  //     console.log('Current replay time:', new Date(data.currentTime).toLocaleTimeString())
  //   }
  // })
  
  // backtestSocket.value.on('replay-progress', (data) => {
  //   if (data.barsPublished && data.totalBars) {
  //     progress.value = Math.round((data.barsPublished / data.totalBars) * 100)
  //   }
  // })

  // backtestSocket.value.on('backtest-completed', (data) => {
  //   isRunning.value = false
  //   progress.value = 100
  //   message.value = `Backtest completed! Return: ${data.totalReturn}%, Sharpe: ${data.sharpe}`
  //   messageType.value = 'success'
  // })
  
  // backtestSocket.value.on('backtest-error', (data) => {
  //   isRunning.value = false
  //   progress.value = 0
  //   message.value = data.error || 'Backtest failed'
  //   messageType.value = 'error'
  // })

  // Connect to backtest server
  connectToBacktestServer()
  
  // Check connection status every 2 seconds
  setInterval(() => {
    checkBacktestServerStatus()
  }, 2000)

})

async function checkBacktestServerStatus() {
  try {
    const response = await fetch('http://localhost:8083/health')
    if (response.ok) {
      if (!backtestConnected.value) {
        // Server came online, connect socket
        connectToBacktestServer()
      }
      backtestConnected.value = true
    } else {
      backtestConnected.value = false
    }
  } catch (error) {
    backtestConnected.value = false
    // If socket is connected but server is down, disconnect
    if (backtestSocket.value && backtestSocket.value.connected) {
      backtestSocket.value.disconnect()
    }
  }
}

// Computed Properties
const maxDate = computed(() => {
  return formatDateForInput(new Date())
})

const dateRangeIsValid = computed(() => {
  if (!startDate.value || !endDate.value) return false
  const start = new Date(startDate.value)
  const end = new Date(endDate.value)
  return start <= end
})

const tradingDays = computed(() => {
  if (!dateRangeIsValid.value) return 0
  
  const start = new Date(startDate.value)
  const end = new Date(endDate.value)
  let count = 0
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) count++ // Exclude weekends
  }
  
  return count
})

const canSubmit = computed(() => {
  return dateRangeIsValid.value && 
         !isRunning.value && 
         backtestConnected.value &&
         tradingDays.value > 0
})

const submitButtonText = computed(() => {
  if (tradingDays.value === 0) return 'Select Valid Dates'
  return `Run Backtest (${tradingDays.value} days)`
})

const statusClass = computed(() => {
  if (isRunning.value) return 'status-running'
  if (message.value && messageType.value === 'error') return 'status-error'
  if (message.value && messageType.value === 'success') return 'status-success'
  return 'status-idle'
})

const statusText = computed(() => {
  if (isRunning.value) return 'RUNNING'
  if (message.value && messageType.value === 'error') return 'ERROR'
  if (message.value && messageType.value === 'success') return 'COMPLETED'
  return 'READY'
})

const messageClass = computed(() => {
  return `message-${messageType.value}`
})

// Methods
function toggleExpanded() {
  isExpanded.value = !isExpanded.value
}

async function submitBacktest() {
  if (!canSubmit.value) return
  
  isRunning.value = true
  progress.value = 0
  message.value = 'Initializing backtest...'
  messageType.value = 'info'
  
  try {
    const response = await axios.post('http://localhost:3000/api/backtest/run', {
      startDate: startDate.value,
      endDate: endDate.value,
      symbol: "SPY",
      strategy: selectedStrategy.value,  // ADD strategy
      speed: replaySpeed.value           // ADD speed
    })
    
    if (response.data.success) {
      message.value = `Backtest started. ID: ${response.data.backtestId}`
      messageType.value = 'info'
      
      // Progress will be updated via WebSocket
    } else {
      throw new Error(response.data.error || 'Failed to start backtest')
    }
    
  } catch (error) {
    console.error('Backtest submission error:', error)
    message.value = error.response?.data?.error || error.message
    messageType.value = 'error'
    isRunning.value = false
    progress.value = 0
  }
}

async function cancelBacktest() {
  try {
    console.log('Cancelling backtest...');
    
    // Call the stop endpoint
    const response = await axios.post('http://localhost:3000/api/backtest/stop');
    
    if (response.data.success) {
      // Reset state
      isRunning.value = false;
      progress.value = 0;
      message.value = 'Backtest cancelled';
      messageType.value = 'info';
      
      console.log('Backtest cancelled successfully');
    }
  } catch (error) {
    console.error('Failed to cancel backtest:', error);
    message.value = 'Failed to cancel backtest';
    messageType.value = 'error';
  }
}

function formatDateForInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function setupSocketListeners() {
  if (!props.socket) return
  
  props.socket.on('backtest-progress', (data) => {
    progress.value = Math.round(data.progress || 0)
    progressMessage.value = data.message || ''
    backtestProgress.value = data.progress || 0
    
    if (data.currentTime) {
      currentReplayTime.value = new Date(data.currentTime).toLocaleTimeString()
    }
  })

  props.socket.on('replay-progress', (data) => {
    if (data.barsPublished && data.totalBars) {
      progress.value = Math.round((data.barsPublished / data.totalBars) * 100)
      progressMessage.value = `Replaying: ${data.barsPublished}/${data.totalBars} bars`
    }
  })

  
  props.socket.on('backtest-complete', (data) => {
    console.log('Backtest completed (main socket):', data)
    lastCompletedBacktest.value = data
    isRunning.value = false
    progress.value = 100
    progressMessage.value = ''  // Clear the progress message
    
    if (data.results) {
      message.value = `Backtest completed! Return: ${data.results.totalReturn}%, Win Rate: ${data.results.winRate}%`
    } else {
      message.value = 'Backtest completed successfully!'
    }
    
    messageType.value = 'success'
  })
  
  props.socket.on('backtest-error', (data) => {
    isRunning.value = false
    progress.value = 0
    message.value = data.error || 'Backtest failed'
    messageType.value = 'error'
  })
}

// Cleanup
onUnmounted(() => {
  if (props.socket) {
    props.socket.off('backtest-progress')
    props.socket.off('backtest-complete')
    props.socket.off('backtest-error')
  }

  if (backtestSocket.value) {
    backtestSocket.value.disconnect()
  }
})
</script>

<style lang="scss" scoped>
.backtest-panel {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  margin-top: 2rem;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  cursor: pointer;
  transition: background 0.3s ease;
  
  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  
  .header-left {
    display: flex;
    align-items: center;
    gap: 1rem;
    
    .panel-icon {
      font-size: 1.5rem;
    }
    
    h3 {
      margin: 0;
      font-size: 1.25rem;
      color: white;
    }
    
    .status-badge {
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      
      &.status-idle {
        background: rgba(156, 163, 175, 0.2);
        color: #9ca3af;
        border: 1px solid #9ca3af;
      }
      
      &.status-running {
        background: rgba(251, 191, 36, 0.2);
        color: #fbbf24;
        border: 1px solid #fbbf24;
        animation: pulse 2s infinite;
      }
      
      &.status-success {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
        border: 1px solid #4ade80;
      }
      
      &.status-error {
        background: rgba(248, 113, 113, 0.2);
        color: #f87171;
        border: 1px solid #f87171;
      }
    }
  }
  
  .header-right {
    .expand-btn {
      background: none;
      border: none;
      color: white;
      font-size: 1.2rem;
      cursor: pointer;
      transition: transform 0.3s ease;
      
      &:hover {
        transform: scale(1.2);
      }
    }
  }
}

.panel-body {
  padding: 0 1.5rem 1.5rem;
  
  .backtest-form {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 12px;
    padding: 1.5rem;
    
    h4 {
      margin: 0 0 1.5rem 0;
      color: #93c5fd;
      font-size: 1.1rem;
    }
    
    .form-group {
      margin-bottom: 1.25rem;
      
      label {
        display: block;
        margin-bottom: 0.5rem;
        color: rgba(255, 255, 255, 0.9);
        font-size: 0.9rem;
        font-weight: 500;
      }
      
      .date-input {
        width: 100%;
        padding: 0.75rem;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 8px;
        color: white;
        font-size: 1rem;
        transition: all 0.3s ease;
        
        &:focus {
          outline: none;
          border-color: #60a5fa;
          background: rgba(255, 255, 255, 0.15);
        }
        
        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        &::-webkit-calendar-picker-indicator {
          filter: invert(1);
          cursor: pointer;
        }
      }
    }
    
    .date-info {
      margin: 1rem 0;
      min-height: 1.5rem;
      
      .info-text {
        color: #60a5fa;
        font-size: 0.9rem;
      }
      
      .error-text {
        color: #f87171;
        font-size: 0.9rem;
      }
    }
    
    .submit-btn {
      width: 100%;
      padding: 1rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      border-radius: 8px;
      color: white;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      
      &:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
      }
      
      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: rgba(156, 163, 175, 0.3);
      }
      
      .spinner {
        display: inline-block;
        animation: spin 1s linear infinite;
      }
    }
  }
  
  .message-box {
    margin-top: 1rem;
    padding: 1rem;
    border-radius: 8px;
    font-size: 0.9rem;
    
    &.message-info {
      background: rgba(96, 165, 250, 0.1);
      border: 1px solid rgba(96, 165, 250, 0.3);
      color: #93c5fd;
    }
    
    &.message-success {
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid rgba(74, 222, 128, 0.3);
      color: #4ade80;
    }
    
    &.message-error {
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid rgba(248, 113, 113, 0.3);
      color: #f87171;
    }
  }
  
  .progress-section {
    margin-top: 1.5rem;
    
    .progress-bar-container {
      height: 24px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 0.5rem;
      
      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #4ade80 0%, #60a5fa 100%);
        transition: width 0.3s ease;
        animation: shimmer 2s infinite;
      }
    }
    
    .progress-text {
      display: block;
      text-align: center;
      font-size: 0.85rem;
      opacity: 0.8;
    }
  }
}

// Animations
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes shimmer {
  0% { opacity: 0.8; }
  50% { opacity: 1; }
  100% { opacity: 0.8; }
}

// Slide transition
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
}

.slide-enter-from {
  transform: translateY(-20px);
  opacity: 0;
}

.slide-leave-to {
  transform: translateY(-20px);
  opacity: 0;
}

// Add to the style section:
.form-actions {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;

  .submit-btn {
    flex: 1;
    // ... existing submit button styles
  }

  .cancel-btn {
    flex: 1;
    padding: 1rem;
    background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    
    .icon {
      font-size: 1.1rem;
    }
    
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(248, 113, 113, 0.4);
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    }
    
    &:active {
      transform: translateY(0);
    }
  }
}

// In BacktestingPanel.vue <style>
.progress-details {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.5rem;
  font-size: 0.85rem;
  
  .progress-text {
    font-weight: bold;
    color: #60a5fa;
  }
  
  .progress-message {
    opacity: 0.8;
  }
  
  .replay-time {
    color: #4ade80;
    font-family: monospace;
  }
}

// Add to styles
.connection-indicator {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  
  &.connected {
    background: rgba(74, 222, 128, 0.1);
    color: #4ade80;
  }
  
  &.disconnected {
    background: rgba(248, 113, 113, 0.1);
    color: #f87171;
  }
  
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    
    &.connected {
      background: #4ade80;
      animation: pulse 2s infinite;
    }
    
    &.disconnected {
      background: #f87171;
    }
  }
}

.select-input {
  width: 100%;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  color: white;
  font-size: 1rem;
  cursor: pointer;
  
  option {
    background: #1e293b;
    color: white;
  }
  
  &:focus {
    outline: none;
    border-color: #60a5fa;
    background: rgba(255, 255, 255, 0.15);
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.speed-buttons {
  display: flex;
  gap: 0.5rem;
  
  .speed-btn {
    flex: 1;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    color: white;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s ease;
    
    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.15);
      transform: translateY(-1px);
    }
    
    &.active {
      background: rgba(96, 165, 250, 0.3);
      border-color: #60a5fa;
      color: #60a5fa;
      font-weight: 600;
    }
    
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.date-info {
  /* Update existing style to center align */
  text-align: center;
  padding: 0.75rem;
  background: rgba(96, 165, 250, 0.1);
  border-radius: 8px;
  margin: 1rem 0;
}

.server-warning {
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.3);
  color: #fbbf24;
  padding: 0.75rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  text-align: center;
  font-size: 0.9rem;
}

.results-navigation {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.view-results-btn {
  width: 100%;
  padding: 0.75rem;
  background: linear-gradient(135deg, #60a5fa, #3b82f6);
  border: none;
  border-radius: 8px;
  color: white;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: all 0.3s ease;
}

.view-results-btn:hover {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  transform: translateY(-2px);
}
</style>