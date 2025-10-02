<template>
  <div class="subscriptions-container" v-if="hasSubscriptions">
    <div class="subscriptions-header">
      <span class="header-icon">📊</span>
      <h4>Active Market Data Subscriptions</h4>
    </div>
    
    <div class="subscriptions-grid">
      <div 
        v-for="(sub, symbol) in subscriptions" 
        :key="symbol"
        class="subscription-card"
        :class="getStatusClass(sub.status)"
      >
        <div class="sub-header">
          <div class="sub-title">
            <span class="symbol">{{ symbol }}</span>
            <span class="bar-size">{{ sub.barSize }}</span>
          </div>
          <button 
            @click="unsubscribe(symbol)"
            class="unsub-btn"
            :disabled="unsubscribing[symbol]"
          >
            ✕
          </button>
        </div>
        
        <div class="sub-body">
          <div class="status-row">
            <span class="status-dot" :class="sub.status"></span>
            <span class="status-text">{{ getStatusText(sub.status) }}</span>
          </div>
          
          <div class="metrics">
            <div class="metric">
              <span class="metric-label">Started:</span>
              <span class="metric-value">{{ formatTime(sub.startedAt) }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Bars:</span>
              <span class="metric-value">{{ sub.barsReceived || 0 }}</span>
            </div>
            <div class="metric" v-if="sub.lastBarTime">
              <span class="metric-label">Last Bar:</span>
              <span class="metric-value">{{ formatTime(sub.lastBarTime) }}</span>
            </div>
          </div>
          
          <div v-if="sub.error" class="error-msg">
            {{ sub.error }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import axios from 'axios'

const props = defineProps({
  subscriptions: {
    type: Object,
    default: () => ({})
  },
  socket: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['unsubscribe'])
const unsubscribing = ref({})

const hasSubscriptions = computed(() => {
  return Object.keys(props.subscriptions).length > 0
})

function getStatusClass(status) {
  return {
    'status-streaming': status === 'streaming',
    'status-waiting': status === 'waiting',
    'status-error': status === 'error'
  }
}

function getStatusText(status) {
  const texts = {
    'streaming': '● Streaming',
    'waiting': '● Waiting for data',
    'error': '● Error'
  }
  return texts[status] || '● Unknown'
}

function formatTime(timestamp) {
  if (!timestamp) return 'N/A'
  const date = new Date(timestamp)
  return date.toLocaleTimeString()
}

async function unsubscribe(symbol) {
  if (symbol !== 'SPY') {
    console.log('Only SPY unsubscribe is implemented currently')
    return
  }
  
  unsubscribing.value[symbol] = true
  
  try {
    await axios.post('/api/marketdata/spy/unsubscribe')
    emit('unsubscribe', symbol)
  } catch (error) {
    console.error('Failed to unsubscribe:', error)
  } finally {
    unsubscribing.value[symbol] = false
  }
}
</script>

<style lang="scss" scoped>
.subscriptions-container {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  padding: 1rem;
  margin-top: 1rem;
}

.subscriptions-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  
  .header-icon {
    font-size: 1.2rem;
  }
  
  h4 {
    margin: 0;
    font-size: 1rem;
    color: #60a5fa;
    font-weight: 600;
  }
}

.subscriptions-grid {
  display: grid;
  gap: 0.75rem;
}

.subscription-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 0.75rem;
  transition: all 0.3s ease;
  
  &.status-streaming {
    border-color: rgba(74, 222, 128, 0.3);
  }
  
  &.status-error {
    border-color: rgba(248, 113, 113, 0.3);
  }
  
  .sub-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
    
    .sub-title {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      
      .symbol {
        font-size: 1.1rem;
        font-weight: bold;
        color: white;
      }
      
      .bar-size {
        font-size: 0.8rem;
        opacity: 0.7;
      }
    }
    
    .unsub-btn {
      background: rgba(248, 113, 113, 0.2);
      border: 1px solid rgba(248, 113, 113, 0.3);
      color: #f87171;
      width: 24px;
      height: 24px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
      
      &:hover {
        background: rgba(248, 113, 113, 0.3);
      }
      
      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }
  
  .sub-body {
    .status-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
      
      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        
        &.streaming {
          background: #4ade80;
          animation: pulse 2s infinite;
        }
        
        &.waiting {
          background: #fbbf24;
        }
        
        &.error {
          background: #f87171;
        }
      }
      
      .status-text {
        font-size: 0.85rem;
        opacity: 0.9;
      }
    }
    
    .metrics {
      display: grid;
      gap: 0.3rem;
      font-size: 0.8rem;
      
      .metric {
        display: flex;
        justify-content: space-between;
        
        .metric-label {
          opacity: 0.6;
        }
        
        .metric-value {
          font-family: monospace;
          color: #93c5fd;
        }
      }
    }
    
    .error-msg {
      margin-top: 0.5rem;
      padding: 0.4rem;
      background: rgba(248, 113, 113, 0.1);
      border-radius: 4px;
      color: #fbbf24;
      font-size: 0.75rem;
    }
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>