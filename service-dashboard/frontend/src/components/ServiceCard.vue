<template>
  <div class="service-card" :class="statusClass">
    <div class="card-header">
      <div class="service-info">
        <span class="service-icon">{{ getIcon(service.id) }}</span>
        <h3>{{ service.name }}</h3>
      </div>
      <StatusIndicator :status="service.status" />
    </div>
    
    <div class="card-body">
      <div class="status-text">
        Status: <strong>{{ service.status }}</strong>
      </div>
      
      <div class="service-details" v-if="service.details">
        <div v-if="service.id === 'ib' && service.details.connected">
          <p>Order ID: {{ service.details.nextOrderId || 'N/A' }}</p>
        </div>
        <div v-if="service.id === 'nats'">
          <!-- Basic Info -->
          <div v-if="service.details.connected" class="detail-section">
            <p>Server: {{ service.details.server || 'Connected' }}</p>
            <p v-if="service.details.monitoring?.uptime">
              Uptime: {{ formatUptime(service.details.monitoring.uptime) }}
            </p>
            <p v-if="service.details.monitoring?.connections >= 0">
              Clients: {{ service.details.monitoring.connections }}
            </p>
          </div>
          <!-- Market Data Stream Status -->
          <div v-if="service.details.streams?.spy" class="stream-status">
            <div class="stream-header">
              <span class="stream-icon">📊</span>
              <span class="stream-title">SPY Data Stream</span>
            </div>
            <div class="stream-details">
              <div class="stream-item">
                <span class="label">Publisher:</span>
                <span :class="['value', getPublisherClass(service.details.streams.spy.publisher)]">
                  {{ getPublisherStatus(service.details.streams.spy.publisher) }}
                </span>
              </div>
            
              <div class="stream-item">
                <span class="label">Consumers:</span>
                <span :class="['value', service.details.streams.spy.consumers > 0 ? 'active' : 'inactive']">
                  {{ service.details.streams.spy.consumers }}
                </span>
              </div>
              <div class="stream-item" v-if="service.details.streams.spy.messageRate">
                <span class="label">Rate:</span>
                <span class="value">{{ service.details.streams.spy.messageRate }} msg/min</span>
              </div>
              
              <div class="stream-subject">
                <code>{{ service.details.streams.spy.subject }}</code>
              </div>
            </div>

            <!-- Visual flow indicator -->
            <div v-if="service.status === 'online'" class="flow-indicator">
              <span :class="['flow-dot', getFlowStatus(service.details.streams.spy)]"></span>
              <span class="flow-line"></span>
              <span class="flow-text">{{ getFlowText(service.details.streams.spy) }}</span>
            </div>
          </div>
          <!-- Error display -->
          <div v-if="service.details.error" class="error-text">
            Error: {{ service.details.error }}
          </div>
        </div>
        <div v-if="service.id === 'postgres' && service.details.connected">
          <p>Database: {{ service.details.database || 'Connected' }}</p>
        </div>
        <div v-if="service.details.error" class="error-text">
          Error: {{ service.details.error }}
        </div>
      </div>
      
      <div class="last-check" v-if="service.lastCheck">
        Last check: {{ formatTime(service.lastCheck) }}
      </div>
    </div>
    
    <div class="card-footer">
      <ToggleSwitch
        :enabled="service.status === 'online'"
        :loading="loading"
        :serviceId="service.id"
        @toggle="handleToggle"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import StatusIndicator from './StatusIndicator.vue'
import ToggleSwitch from './ToggleSwitch.vue'

const props = defineProps({
  service: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['toggle'])
const loading = ref(false)

const statusClass = computed(() => ({
  'status-online': props.service.status === 'online',
  'status-offline': props.service.status === 'offline',
  'status-error': props.service.status === 'error',
  'status-unknown': props.service.status === 'unknown'
}))

function getIcon(serviceId) {
  const icons = {
    ib: '📈',
    nats: '📡',
    postgres: '🗄️'
  }
  return icons[serviceId] || '⚙️'
}

function formatTime(timestamp) {
  if (!timestamp) return 'Never'
  const date = new Date(timestamp)
  return date.toLocaleTimeString()
}

async function handleToggle() {
  loading.value = true
  emit('toggle', props.service.id, props.service.status)
  // Parent will handle the actual toggle
  setTimeout(() => {
    loading.value = false
  }, 2000)
}

function formatUptime(seconds) {
  if (!seconds) return 'Unknown';
  
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

function getPublisherClass(status) {
  return {
    'active': 'status-active',
    'inactive': 'status-inactive',
    'disconnected': 'status-disconnected'
  }[status] || 'status-unknown';
}

function getPublisherStatus(status) {
  const icons = {
    'active': '✅ Active',
    'inactive': '⏸️ Inactive',
    'disconnected': '❌ Disconnected'
  };
  return icons[status] || '❓ Unknown';
}

function getFlowStatus(stream) {
  if (stream.publisher === 'active' && stream.consumers > 0) {
    return 'flowing';
  } else if (stream.publisher === 'active' && stream.consumers === 0) {
    return 'no-consumers';
  } else {
    return 'stopped';
  }
}

function getFlowText(stream) {
  if (stream.publisher === 'active' && stream.consumers > 0) {
    return 'Data flowing';
  } else if (stream.publisher === 'active' && stream.consumers === 0) {
    return 'No consumers!';
  } else {
    return 'Not streaming';
  }
}
</script>

<style lang="scss" scoped>
.stream-status {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 0.75rem;
  margin: 0.75rem 0;
  
  .stream-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    
    .stream-icon {
      font-size: 1.2rem;
    }
    
    .stream-title {
      font-weight: 600;
      color: #60a5fa;
    }
  }

  .stream-details {
    display: grid;
    gap: 0.4rem;
    
    .stream-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.85rem;
      
      .label {
        opacity: 0.7;
      }
      
      .value {
        font-weight: 500;
        
        &.status-active {
          color: #4ade80;
        }
        
        &.status-inactive {
          color: #fbbf24;
        }
        
        &.status-disconnected {
          color: #f87171;
        }
        
        &.active {
          color: #4ade80;
        }
        
        &.inactive {
          color: #9ca3af;
        }
      }
    }
  }

  .stream-subject {
    margin-top: 0.5rem;
    padding: 0.25rem 0.5rem;
    background: rgba(96, 165, 250, 0.1);
    border-radius: 4px;
    
    code {
      font-size: 0.75rem;
      color: #93c5fd;
      font-family: monospace;
    }
  }
}

.flow-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  
  .flow-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    
    &.flowing {
      background: #4ade80;
      animation: pulse 1.5s infinite;
    }
    
    &.no-consumers {
      background: #fbbf24;
      animation: pulse 2s infinite;
    }
    
    &.stopped {
      background: #9ca3af;
    }
  }
  
  .flow-line {
    flex: 1;
    height: 2px;
    background: linear-gradient(90deg, 
      rgba(255,255,255,0.2) 0%, 
      rgba(255,255,255,0.1) 100%);
  }
  
  .flow-text {
    font-size: 0.8rem;
    font-weight: 500;
  }
}

.detail-section {
  p {
    margin: 0.25rem 0;
    font-size: 0.9rem;
    opacity: 0.9;
  }
}

.service-card {
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
  
  &.status-online {
    border-color: rgba(74, 222, 128, 0.5);
    background: rgba(74, 222, 128, 0.1);
  }
  
  &.status-offline {
    border-color: rgba(248, 113, 113, 0.5);
    background: rgba(248, 113, 113, 0.1);
  }
  
  &.status-error {
    border-color: rgba(251, 191, 36, 0.5);
    background: rgba(251, 191, 36, 0.1);
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  
  .service-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    
    .service-icon {
      font-size: 1.5rem;
    }
    
    h3 {
      margin: 0;
      font-size: 1.25rem;
    }
  }
}

.card-body {
  margin: 1.5rem 0;
  
  .status-text {
    font-size: 1rem;
    margin-bottom: 1rem;
    
    strong {
      text-transform: uppercase;
      color: white;
    }
  }
  
  .service-details {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    padding: 0.75rem;
    margin: 0.75rem 0;
    
    p {
      margin: 0.25rem 0;
      font-size: 0.9rem;
      opacity: 0.9;
    }
    
    .error-text {
      color: #fbbf24;
      font-size: 0.85rem;
    }
  }
  
  .last-check {
    font-size: 0.85rem;
    opacity: 0.7;
    margin-top: 0.75rem;
  }
}

.card-footer {
  display: flex;
  justify-content: center;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
</style>