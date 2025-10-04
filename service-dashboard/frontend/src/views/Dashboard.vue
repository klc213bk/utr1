<template>
  <div class="dashboard">
    <div class="dashboard-header">
      <h1>System Control Center</h1>
      <button @click="refreshAll" class="refresh-btn">
        🔄 Refresh
      </button>
    </div>

    <div class="panels-container">
      <!-- Core Services -->
      <section class="panel-section">
        <h2 class="section-title">Core Services</h2>
        <div class="services-grid">
          <ServiceCard
            v-for="service in services"
          :key="service.id"
          :service="service"
          :socket="socket"  
          @toggle="toggleService"
          />
        </div>
      </section>

      <!-- Trading Services -->
      <section class="panel-section">
        <h2 class="section-title">Trading Services</h2>
        <TradingServicesPanel :socket="socket" />
      </section>

      <!-- Data Management -->
      <section class="panel-section">
        <h2 class="section-title">Data Management</h2>
        <HistoricalDataPanel 
          :socket="socket" 
          :ibConnected="services.ib?.status === 'online'"
        />
      </section>

      <!-- Backtesting -->
      <section class="panel-section">
        <h2 class="section-title">Backtesting</h2>
        <BacktestingPanel :socket="socket" />
      </section>

      <!-- Market Data -->
      <section class="panel-section">
        <h2 class="section-title">Live Market Data</h2>
        <MarketDataCard 
          :ibConnected="services.ib?.status === 'online'"
          :socket="socket"
        />
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, onUnmounted } from 'vue'
import ServiceCard from '../components/ServiceCard.vue'
import MarketDataCard from '../components/MarketDataCard.vue'
import TradingServicesPanel from '../components/backtesting/TradingServicesPanel.vue'
import HistoricalDataPanel from '../components/HistoricalDataPanel.vue'
import BacktestingPanel from '../components/backtesting/BacktestingPanel.vue'
import { useServicesStore } from '../stores/services'

const props = defineProps(['socket', 'services'])

// Use injected services if not passed as props
// Use store
const store = useServicesStore()
const socketsStore = inject('socketsStore')
const loading = ref(false)

const services = computed(() => props.services || {})

// Get socket from props or from the store
const socket = computed(() => {
  return props.socket || socketsStore?.mainSocket || null
})

onMounted(async () => {
  // Services are already being updated via props from App.vue
  console.log('Dashboard mounted, socket available:', !!socket.value)
})

onUnmounted(() => {
  // Cleanup if needed
})

// Filter core services for the grid
const coreServices = computed(() => {
  const allServices = services.value || {}
  const coreServicesList = []
  
  if (allServices.ib) coreServicesList.push({ id: 'ib', ...allServices.ib })
  if (allServices.nats) coreServicesList.push({ id: 'nats', ...allServices.nats })
  if (allServices.postgres) coreServicesList.push({ id: 'postgres', ...allServices.postgres })
  
  return coreServicesList
})

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
  if (socket.value) {
    socket.value.emit('refresh')
  }
}
</script>

<style scoped>
.dashboard {
  max-width: 1400px;
  margin: 0 auto;
  padding: 2rem;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  
  h1 {
    font-size: 2rem;
    background: linear-gradient(135deg, #60a5fa, #a78bfa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  
  .refresh-btn {
    padding: 0.75rem 1.5rem;
    background: rgba(96, 165, 250, 0.1);
    border: 1px solid rgba(96, 165, 250, 0.3);
    color: #60a5fa;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.3s ease;
    font-size: 1rem;
    
    &:hover {
      background: rgba(96, 165, 250, 0.2);
      transform: translateY(-2px);
    }
  }
}

.panels-container {
  display: flex;
  flex-direction: column;
  gap: 2.5rem;
}

.panel-section {
  .section-title {
    font-size: 1.3rem;
    margin-bottom: 1.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    color: #cbd5e1;
  }
}

.services-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
}
</style>