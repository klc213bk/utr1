<template>
  <div class="market-data-card">
    <div class="card-header">
      <div class="title-section">
        <span class="icon">📊</span>
        <h3>Market Data - SPY</h3>
      </div>
      <div class="status-badge" :class="statusClass">
        {{ subscribed ? 'STREAMING' : 'STOPPED' }}
      </div>
    </div>
    
    <div class="card-body">
      <p class="description">
        Stream real-time 1-minute bars for SPY to NATS
      </p>
      <p class="nats-subject">
        NATS Subject: <code>md.equity.spy.bars.1m</code>
      </p>
      
      <div v-if="error" class="error-message">
        ⚠️ {{ error }}
      </div>
      
      <div v-if="lastUpdate" class="last-update">
        Last action: {{ formatTime(lastUpdate) }}
      </div>
    </div>
    
    <div class="card-footer">
      <button 
        @click="toggleSubscription"
        :disabled="loading || !ibConnected"
        :class="buttonClass"
        class="control-button"
      >
        <span v-if="loading" class="spinner">⟳</span>
        <span v-else>
          {{ subscribed ? '⏹ Stop Streaming' : '▶️ Start Streaming' }}
        </span>
      </button>
      
      <div v-if="!ibConnected" class="warning-text">
        IB must be connected first
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { io } from 'socket.io-client'

const props = defineProps({
  ibConnected: {
    type: Boolean,
    default: false
  },
  socket: {
    type: Object,
    default: null
  }
})

const subscribed = ref(false)
const loading = ref(false)
const error = ref(null)
const lastUpdate = ref(null)

const statusClass = computed(() => ({
  'streaming': subscribed.value,
  'stopped': !subscribed.value
}))

const buttonClass = computed(() => ({
  'btn-stop': subscribed.value,
  'btn-start': !subscribed.value,
  'disabled': loading.value || !props.ibConnected
}))

function formatTime(timestamp) {
  if (!timestamp) return 'Never'
  const date = new Date(timestamp)
  return date.toLocaleTimeString()
}

async function toggleSubscription() {
  loading.value = true
  error.value = null
  
  try {
    const action = subscribed.value ? 'unsubscribe' : 'subscribe'
    const response = await axios.post(`/api/marketdata/spy/${action}`)
    
    if (response.data.success) {
      subscribed.value = !subscribed.value
      lastUpdate.value = new Date().toISOString()
    } else {
      error.value = response.data.message || 'Action failed'
    }
  } catch (err) {
    error.value = err.response?.data?.error || err.message
  } finally {
    loading.value = false
  }
}

// Load initial status
async function loadStatus() {
  try {
    const response = await axios.get('/api/marketdata/status')
    subscribed.value = response.data.spy.subscribed
    lastUpdate.value = response.data.spy.lastUpdate
    error.value = response.data.spy.error
  } catch (err) {
    console.error('Failed to load market data status:', err)
  }
}

onMounted(() => {
  loadStatus()
  
  // Listen for market data updates via WebSocket
  if (props.socket) {
    props.socket.on('marketdata-update', (data) => {
      if (data.spy) {
        subscribed.value = data.spy.subscribed
        lastUpdate.value = data.spy.lastUpdate
        error.value = data.spy.error
      }
    })
  }
})
</script>

<style lang="scss" scoped>
.market-data-card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  padding: 1.5rem;
  transition: all 0.3s ease;
  
  &:hover {
    transform: translateY(-5px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  
  .title-section {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    
    .icon {
      font-size: 1.5rem;
    }
    
    h3 {
      margin: 0;
      font-size: 1.25rem;
      color: white;
    }
  }
  
  .status-badge {
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: bold;
    letter-spacing: 1px;
    
    &.streaming {
      background: rgba(74, 222, 128, 0.2);
      color: #4ade80;
      border: 1px solid #4ade80;
      animation: pulse 2s infinite;
    }
    
    &.stopped {
      background: rgba(156, 163, 175, 0.2);
      color: #9ca3af;
      border: 1px solid #9ca3af;
    }
  }
}

.card-body {
  margin: 1.5rem 0;
  
  .description {
    color: rgba(255, 255, 255, 0.9);
    margin-bottom: 0.75rem;
  }
  
  .nats-subject {
    background: rgba(0, 0, 0, 0.2);
    padding: 0.5rem;
    border-radius: 8px;
    margin: 0.75rem 0;
    
    code {
      color: #60a5fa;
      font-family: 'Courier New', monospace;
      font-size: 0.9rem;
    }
  }
  
  .error-message {
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    color: #fbbf24;
    padding: 0.75rem;
    border-radius: 8px;
    margin-top: 0.75rem;
    font-size: 0.9rem;
  }
  
  .last-update {
    font-size: 0.85rem;
    opacity: 0.7;
    margin-top: 0.75rem;
  }
}

.card-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  
  .control-button {
    width: 200px;
    padding: 0.75rem 1.5rem;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 30px;
    background: rgba(255, 255, 255, 0.1);
    color: white;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s ease;
    
    &.btn-start {
      &:hover:not(.disabled) {
        background: rgba(74, 222, 128, 0.2);
        border-color: #4ade80;
        transform: scale(1.05);
      }
    }
    
    &.btn-stop {
      background: rgba(248, 113, 113, 0.2);
      border-color: #f87171;
      
      &:hover:not(.disabled) {
        background: rgba(248, 113, 113, 0.3);
        transform: scale(1.05);
      }
    }
    
    &.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .spinner {
      display: inline-block;
      animation: spin 1s linear infinite;
    }
  }
  
  .warning-text {
    font-size: 0.85rem;
    color: #fbbf24;
    font-style: italic;
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>