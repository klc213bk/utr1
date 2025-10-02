<template>
  <div id="app">
    <header class="app-header">
      <h1>🎛️ Service Dashboard</h1>
      <div class="connection-status">
        <span class="status-dot" :class="socketConnected ? 'connected' : 'disconnected'"></span>
        {{ socketConnected ? 'Connected' : 'Disconnected' }}
      </div>
    </header>

    <main class="dashboard">
      <div class="services-grid">
        <ServiceCard
          v-for="service in services"
          :key="service.id"
          :service="service"
          :socket="socket"  
          @toggle="toggleService"
        />
      </div>

      <!-- ADD this market data section -->
      <div class="market-data-section">
        <h2 class="section-title">📈 Market Data Streaming</h2>
        <MarketDataCard 
          :ibConnected="services.ib?.status === 'online'"
          :socket="socket"
        />
      </div>
     
      <!-- ADD: Historical Data Section -->
      <div class="historical-data-section">
        <HistoricalDataPanel
          :ibConnected="services.ib?.status === 'online'"
          :socket="socket"
        />
      </div>

      <div class="trading-services-section">
        <TradingServicesPanel  />
      </div>

      <!-- NEW: Backtesting Section -->
      <div class="backtesting-section">
        <BacktestingPanel
          :socket="socket"
        />
      </div>

      <div class="refresh-section">
        <button @click="refreshAll" class="refresh-button" :disabled="loading">
          {{ loading ? 'Refreshing...' : '🔄 Refresh All' }}
        </button>
        <p class="last-update">Auto-refresh every 10 seconds</p>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import ServiceCard from './components/ServiceCard.vue'
import MarketDataCard from './components/MarketDataCard.vue'
import HistoricalDataPanel from './components/HistoricalDataPanel.vue'
import TradingServicesPanel  from './components/backtesting/TradingServicesPanel.vue'
import BacktestingPanel from './components/backtesting/BacktestingPanel.vue'
import { useServicesStore } from './stores/services'
import { io } from 'socket.io-client'

const store = useServicesStore()
const services = ref({})
const socketConnected = ref(false)
const loading = ref(false)
let socket = null

onMounted(() => {
  // Initialize WebSocket connection
  socket = io('http://localhost:3000', {
    transports: ['websocket', 'polling']
  })

  socket.on('connect', () => {
    console.log('Connected to server')
    socketConnected.value = true
  })

  socket.on('disconnect', () => {
    console.log('Disconnected from server')
    socketConnected.value = false
  })

  socket.on('services-update', (data) => {
    console.log('Services update received:', data)
    services.value = data
    store.updateServices(data)
  })

  socket.on('service-control', (result) => {
    console.log('Control result:', result)
  })

  socket.on('ib-subscriptions-update', (data) => {
    console.log('IB subscriptions update:', data)
    if (services.value.ib && services.value.ib.details) {
      services.value.ib.details.subscriptions = data
    }
  })

  socket.on('nats-subjects-update', (data) => {
    console.log('NATS subjects update:', data)
    if (services.value.nats && services.value.nats.details) {
      services.value.nats.details.subjects = data
    }
  })

  socket.on('nats-subject-update', (update) => {
    console.log('NATS subject update:', update)
    if (services.value.nats && services.value.nats.details && services.value.nats.details.subjects) {
      services.value.nats.details.subjects[update.subject] = update.data
    }
  })

  // Initial load
  loadServices()
})

onUnmounted(() => {
  if (socket) {
    socket.disconnect()
  }
})

async function loadServices() {
  loading.value = true
  try {
    await store.fetchServices()
    services.value = store.services
  } catch (error) {
    console.error('Failed to load services:', error)
  } finally {
    loading.value = false
  }
}

async function toggleService(serviceId, currentStatus) {
  const action = currentStatus === 'online' ? 'stop' : 'start'
  loading.value = true
  
  try {
    await store.controlService(serviceId, action)
    // The socket will receive the update
  } catch (error) {
    console.error(`Failed to ${action} service:`, error)
  } finally {
    loading.value = false
  }
}

function refreshAll() {
  if (socket) {
    socket.emit('refresh')
  }
  loadServices()
}
</script>

<style lang="scss" scoped>
#app {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.app-header {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);

  h1 {
    margin: 0;
    font-size: 2rem;
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 20px;

    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      
      &.connected {
        background: #4ade80;
        box-shadow: 0 0 10px #4ade80;
      }
      
      &.disconnected {
        background: #f87171;
        box-shadow: 0 0 10px #f87171;
      }
    }
  }
}

.dashboard {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.services-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 2rem;
  margin-bottom: 2rem;
}

.refresh-section {
  text-align: center;
  
  .refresh-button {
    background: rgba(255, 255, 255, 0.2);
    border: 2px solid rgba(255, 255, 255, 0.3);
    color: white;
    padding: 0.75rem 2rem;
    font-size: 1rem;
    border-radius: 30px;
    cursor: pointer;
    transition: all 0.3s ease;
    
    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
    }
    
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
  
  .last-update {
    margin-top: 1rem;
    opacity: 0.8;
    font-size: 0.9rem;
  }
}

.market-data-section {
  margin: 3rem 0 2rem 0;
  
  .section-title {
    font-size: 1.5rem;
    margin-bottom: 1.5rem;
    text-align: center;
    opacity: 0.95;
  }
}

.historical-data-section {
  margin: 2rem 0;
}

.backtesting-section {
  margin: 2rem 0;
}

.trading-services-section {
  margin: 2rem 0;
}

</style>