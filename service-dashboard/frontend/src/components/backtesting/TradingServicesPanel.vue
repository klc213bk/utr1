<template>
  <div class="backtest-services-panel">
    <!-- Header -->
    <div class="panel-header" @click="toggleExpanded">
      <div class="header-left">
        <span class="panel-icon">📊</span>
        <h3>Trading Services</h3>
        <span class="mode-badge" :class="tradingMode">
        {{ tradingMode.toUpperCase() }}
        </span>
      </div>
      <div class="header-right">
        <span class="status-summary" :class="overallStatus">
        {{ runningCount }}/{{ services.length }} running
        </span>
        <button class="expand-btn">
        {{ isExpanded ? '▼' : '▶' }}
        </button>
      </div>
    </div>

    <!-- Body -->
    <transition name="slide">
      <div v-if="isExpanded" class="panel-body">
        <!-- Group Controls -->
        <div class="group-controls">
          <button 
            @click="startAll" 
            :disabled="allRunning || loading"
            class="control-btn start-all"
          >
            Start All Services
          </button>
          <button 
            @click="stopAll" 
            :disabled="allStopped || loading"
            class="control-btn stop-all"
          >
            Stop All Services
          </button>
        </div>

        <!-- Services List -->
        <div class="services-list">
          <div v-for="service in services" :key="service.id" class="service-item">
            <div class="service-info">
              <span class="status-dot" :class="service.status"></span>
              <span class="service-name">{{ service.name }}</span>
              <span class="service-port">Port: {{ service.port }}</span>
            </div>
            <div class="service-controls">
              <button 
                @click="toggleService(service.id)"
                :disabled="loading"
                class="toggle-btn"
                :class="service.status"
              >
                {{ service.status === 'running' ? 'Stop' : 'Start' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Status Message -->
        <div v-if="message" class="status-message" :class="messageType">
          {{ message }}
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, inject } from 'vue'
import axios from 'axios'

// State
const isExpanded = ref(false)
const loading = ref(false)
const message = ref('')
const messageType = ref('info')

const tradingMode = ref('idle') // 'idle', 'backtest', 'live'
const socketsStore = inject('socketsStore')
console.log('Socket store in TradingServicesPanel:', socketsStore)  // Debug log

// Services configuration - only Strategy Engine for now
const services = ref([
  {
    id: 'backtest-server',
    name: 'Backtest Server',
    port: 8083,
    status: 'stopped',
    healthEndpoint: 'http://localhost:8083/health'
  },
  {
    id: 'strategy-engine',
    name: 'Strategy Engine',
    port: 8084,
    status: 'stopped', // 'running', 'stopped', 'error'
    healthEndpoint: 'http://localhost:8084/health'
  },
  {
    id: 'execution-simulator',
    name: 'Execution Simulator',
    port: 8085,
    status: 'stopped',
    healthEndpoint: 'http://localhost:8085/health'
  },
  {
    id: 'performance-tracker',
    name: 'Performance Tracker',
    status: 'stopped',
    port: 8086,
    healthEndpoint: 'http://localhost:8086/health',
    description: 'Tracks backtest performance and P&L'
  },
  {
    id: 'analytics-server',
    name: 'Analytics Server',
    status: 'stopped',
    port: 8087,
    healthEndpoint: 'http://localhost:8087/health',
    description: 'Serve historical backtest results'
  }
])

// Computed
const runningCount = computed(() => 
  services.value.filter(s => s.status === 'running').length
)

const allRunning = computed(() => 
  services.value.every(s => s.status === 'running')
)

const allStopped = computed(() => 
  services.value.every(s => s.status === 'stopped')
)

const overallStatus = computed(() => {
  if (allRunning.value) return 'all-running'
  if (allStopped.value) return 'all-stopped'
  return 'partial'
})

// Methods
function toggleExpanded() {
  isExpanded.value = !isExpanded.value
}

// Add method to check mode
async function checkTradingMode() {
  try {
    // Check if backtest is running
    const backtestResponse = await axios.get('http://localhost:8083/api/backtest/status')
    if (backtestResponse.data.isRunning) {
      tradingMode.value = 'backtest'
      return
    }
    
    // Check if live trading (future implementation)
    // const liveResponse = await axios.get('...')
    // if (liveResponse.data.isLive) {
    //   tradingMode.value = 'live'
    //   return
    // }
    
    tradingMode.value = 'idle'
  } catch (error) {
    tradingMode.value = 'idle'
  }
}

async function startAll() {
  loading.value = true
  message.value = 'Starting all services...'
  messageType.value = 'info'
  
  try {
    // Call backend to start all services
    const response = await axios.post('http://localhost:3000/api/trading-services/start-all')
    
    if (response.data.success) {
      message.value = 'All services started successfully'
      messageType.value = 'success'
      // Update status after a delay
      setTimeout(checkHealth, 2000)
    }
  } catch (error) {
    message.value = `Failed to start services: ${error.message}`
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

async function stopAll() {
  loading.value = true
  message.value = 'Stopping all services...'
  messageType.value = 'info'
  
  try {
    const response = await axios.post('http://localhost:3000/api/trading-services/stop-all')
    
    if (response.data.success) {
      message.value = 'All services stopped'
      messageType.value = 'success'
      services.value.forEach(s => s.status = 'stopped')
    }
  } catch (error) {
    message.value = `Failed to stop services: ${error.message}`
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

async function toggleService(serviceId) {
  const service = services.value.find(s => s.id === serviceId)
  if (!service) return
  
  loading.value = true
  const action = service.status === 'running' ? 'stop' : 'start'
  
  try {
    const response = await axios.post(`http://localhost:3000/api/trading-services/${serviceId}/${action}`)
    
    if (response.data.success) {
      service.status = action === 'start' ? 'running' : 'stopped'
      message.value = `${service.name} ${action}ed successfully`
      messageType.value = 'success'

      // ADD: Handle backtest socket
      if (serviceId === 'backtest-server') {
        if (action === 'start') {
          console.log('Starting backtest server, will init socket in 2s')
          setTimeout(() => {
            console.log('Initializing backtest socket, store:', socketsStore)
            if (socketsStore) {
              socketsStore.initBacktestSocket()
            } else {
              console.error('Socket store not available!')
            }
          }, 2000)
        } else {
          if (socketsStore) {
            socketsStore.disconnectBacktestSocket()
          }
        }
      }
    }
  } catch (error) {
    message.value = `Failed to ${action} ${service.name}: ${error.message}`
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

async function checkHealth() {
  // Check health of each service
  for (const service of services.value) {
    try {
      const response = await fetch(service.healthEndpoint)
      if (response.ok) {
        const wasOffline = service.status !== 'running'
        service.status = 'running'

        // If backtest server just came online, initialize its socket
        if (service.id === 'backtest-server' && wasOffline) {
          console.log('Backtest server came online, initializing socket...')
          if (socketsStore && !socketsStore.isBacktestConnected) {
            setTimeout(() => {
              socketsStore.initBacktestSocket()
            }, 500) // Small delay to ensure server is ready
          }
        }
      } else {
        service.status = 'stopped'
      }
    } catch (error) {
      service.status = 'stopped'
      
      // If backtest server went offline, disconnect socket
      if (service.id === 'backtest-server' && socketsStore && socketsStore.isBacktestConnected) {
        socketsStore.disconnectBacktestSocket()
      }
    }
  }
}

// Check health on mount
onMounted(() => {
  checkHealth()
  // Poll health every 10 seconds
  setInterval(() => {
    checkHealth()
    checkTradingMode()
  }, 10000)
})
</script>

<style lang="scss" scoped>
.backtest-services-panel {
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
  }
  
  .header-right {
    display: flex;
    align-items: center;
    gap: 1rem;
    
    .status-summary {
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.85rem;
      
      &.all-running {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
      }
      
      &.all-stopped {
        background: rgba(248, 113, 113, 0.2);
        color: #f87171;
      }
      
      &.partial {
        background: rgba(251, 191, 36, 0.2);
        color: #fbbf24;
      }
    }
    
    .expand-btn {
      background: none;
      border: none;
      color: white;
      font-size: 1.2rem;
      cursor: pointer;
    }
  }
}

.panel-body {
  padding: 0 1.5rem 1.5rem;
}

.group-controls {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  
  .control-btn {
    flex: 1;
    padding: 0.75rem;
    border-radius: 8px;
    border: none;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    
    &.start-all {
      background: rgba(74, 222, 128, 0.2);
      border: 1px solid rgba(74, 222, 128, 0.3);
      color: #4ade80;
      
      &:hover:not(:disabled) {
        background: rgba(74, 222, 128, 0.3);
      }
    }
    
    &.stop-all {
      background: rgba(248, 113, 113, 0.2);
      border: 1px solid rgba(248, 113, 113, 0.3);
      color: #f87171;
      
      &:hover:not(:disabled) {
        background: rgba(248, 113, 113, 0.3);
      }
    }
    
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.services-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.service-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  
  .service-info {
    display: flex;
    align-items: center;
    gap: 1rem;
    
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      
      &.running {
        background: #4ade80;
        animation: pulse 2s infinite;
      }
      
      &.stopped {
        background: #9ca3af;
      }
      
      &.error {
        background: #f87171;
      }
    }
    
    .service-name {
      font-weight: 500;
      color: white;
    }
    
    .service-port {
      font-size: 0.85rem;
      opacity: 0.7;
    }
  }
  
  .toggle-btn {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.1);
    color: white;
    cursor: pointer;
    transition: all 0.3s ease;
    
    &.running {
      background: rgba(248, 113, 113, 0.2);
      border-color: rgba(248, 113, 113, 0.3);
      
      &:hover {
        background: rgba(248, 113, 113, 0.3);
      }
    }
    
    &.stopped {
      background: rgba(74, 222, 128, 0.2);
      border-color: rgba(74, 222, 128, 0.3);
      
      &:hover {
        background: rgba(74, 222, 128, 0.3);
      }
    }
    
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.status-message {
  margin-top: 1rem;
  padding: 0.75rem;
  border-radius: 8px;
  font-size: 0.9rem;
  
  &.info {
    background: rgba(96, 165, 250, 0.1);
    border: 1px solid rgba(96, 165, 250, 0.3);
    color: #93c5fd;
  }
  
  &.success {
    background: rgba(74, 222, 128, 0.1);
    border: 1px solid rgba(74, 222, 128, 0.3);
    color: #4ade80;
  }
  
  &.error {
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    color: #f87171;
  }
}

// Add to .header-left section
.mode-badge {
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.5px;
  
  &.idle {
    background: rgba(156, 163, 175, 0.2);
    color: #9ca3af;
    border: 1px solid #9ca3af;
  }
  
  &.backtest {
    background: rgba(96, 165, 250, 0.2);
    color: #60a5fa;
    border: 1px solid #60a5fa;
  }
  
  &.live {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
    border: 1px solid #ef4444;
    animation: pulse 2s infinite;
  }
}

.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateY(-20px);
  opacity: 0;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>