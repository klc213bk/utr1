<!-- ============================================================================
     HistoricalDataPanel.vue - Main Historical Data Control Panel
     ============================================================================ -->

<template>
  <div class="historical-panel-container">
    <!-- Header - make it clickable -->
    <div class="panel-header" @click="toggleExpanded">
      <div class="header-left">
        <span class="panel-icon">📊</span>
        <h3>Historical Data Collection</h3>
      </div>
      <div class="header-right">
        <a href="/market-calendar.html" target="_blank" class="calendar-link">
            📅 Market Calendar
            <span class="external-icon">🔗</span>
        </a>
        <a href="/data-completeness.html" target="_blank" class="calendar-link">
            📊 Data Completeness
            <span class="external-icon">🔗</span>
        </a>
        <span class="latest-bar" v-if="latestBar && isExpanded">
          Latest Bar: {{ latestBar }}
        </span>
        <span class="latest-bar" v-else-if="!isExpanded && latestBar">
          {{ latestBar }}
        </span>
        <button class="expand-btn" @click.stop="toggleExpanded">
          {{ isExpanded ? '▼' : '▶' }}
        </button>
      </div>
    </div>

    <!-- Body -->
    <transition name="slide">
      <div v-if="isExpanded"  class="panel-body">
        <!-- API Limits Info -->
        <div class="info-box">
            ℹ️ IB API Limits: Max 30 days per request, 10 sec between requests
        </div>

        <!-- Date Range Selection -->
        <div class="date-range-section">
            <div class="date-input-group">
            <label>Start Date:</label>
            <input 
                type="date" 
                v-model="startDate" 
                :max="maxDate"
                :disabled="isCollecting"
                class="date-input"
            />
            </div>
            <div class="date-input-group">
            <label>End Date:</label>
            <input 
                type="date" 
                v-model="endDate" 
                :max="maxDate"
                :disabled="isCollecting"
                class="date-input"
            />
            </div>
        </div>

        <!-- Collect Button -->
        <div class="action-section">
            <button 
            @click="collectData"
            :disabled="!canCollect"
            class="collect-btn"
            >
            {{ isCollecting ? 'Collecting...' : 'Collect Data' }}
            </button>
            <div v-if="!ibConnected" class="warning-text">
            IB must be connected first
            </div>
        </div>

        <!-- Last Request Result -->
        <div v-if="lastRequest" class="last-request-section">
            <h4>Last Request:</h4>
            <div class="request-result" :class="lastRequest.status">
            <div class="status-line">
                Status: 
                <span v-if="lastRequest.status === 'success'">Success ✓</span>
                <span v-else-if="lastRequest.status === 'failed'">Failed ✗</span>
                <span v-else>{{ lastRequest.status }}</span>
            </div>
            
            <div v-if="lastRequest.status === 'success'">
                <div>Range: {{ lastRequest.startDate }} to {{ lastRequest.endDate }}</div>
                <div>Collected: {{ lastRequest.barsCollected }} bars 
                ({{ lastRequest.newBars }} new, {{ lastRequest.duplicates }} duplicates)</div>
                <div>Duration: {{ lastRequest.duration }} seconds</div>
            </div>
            
            <div v-else-if="lastRequest.error" class="error-message">
                Error: {{ lastRequest.error }}
            </div>
            </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'

const props = defineProps({
  ibConnected: {
    type: Boolean,
    required: true
  },
  socket: {
    type: Object,
    default: null
  }
})

// State
const isCollecting = ref(false)
const startDate = ref('')
const endDate = ref('')
const latestBar = ref(null)
const lastRequest = ref(null)
const collectionTimeout = ref(null)

// Computed
const maxDate = computed(() => {
  const today = new Date()
  return today.toISOString().split('T')[0]
})

const canCollect = computed(() => {
  return props.ibConnected && 
         !isCollecting.value && 
         startDate.value && 
         endDate.value &&
         startDate.value <= endDate.value
})

// Methods
async function fetchLatestBar() {
  try {
    const response = await axios.get('http://localhost:3000/api/historical/latest')
    if (response.data.hasData) {
      // Parse and format the latest bar time
      const barTime = response.data.latestBar
      latestBar.value = formatBarTime(barTime)
    } else {
      // No data in database yet
      latestBar.value = 'No data collected yet'
    }
    // Always set defaults after fetching latest bar info
    setSmartDefaults()
  } catch (error) {
    console.error('Failed to fetch latest bar:', error)
    latestBar.value = 'Error fetching data'
  }
}

function formatBarTime(timestamp) {
  if (!timestamp) return null
  try {
    const date = new Date(timestamp)
    return date.toLocaleString('en-US', { 
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }) + ' EST'
  } catch {
    return timestamp
  }
}

function setSmartDefaults() {
  const today = new Date()

  // End date is always yesterday
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  endDate.value = yesterday.toISOString().split('T')[0]

  // Check if we have actual bar data (not error messages)
  if (latestBar.value &&
      latestBar.value !== 'No data collected yet' &&
      latestBar.value !== 'Error fetching data') {
    // Parse latest bar date and add 1 day for start
    const latestDate = new Date(latestBar.value)
    latestDate.setDate(latestDate.getDate() + 1)
    startDate.value = latestDate.toISOString().split('T')[0]
  } else {
    // No data yet, default to 7 days ago
    const weekAgo = new Date(today)
    weekAgo.setDate(weekAgo.getDate() - 7)
    startDate.value = weekAgo.toISOString().split('T')[0]
  }
}

async function collectData() {
  if (!canCollect.value) return
  
  isCollecting.value = true
  const requestStartTime = Date.now()
  
  // Reset last request
  lastRequest.value = {
    status: 'collecting',
    startDate: startDate.value,
    endDate: endDate.value
  }
  
  // Set 35-second timeout
  collectionTimeout.value = setTimeout(() => {
    isCollecting.value = false
    lastRequest.value = {
      ...lastRequest.value,
      status: 'failed',
      error: 'Request timeout after 35 seconds'
    }
  }, 35000)
  
  try {
    const response = await axios.post('http://localhost:3000/api/historical/collect', {
      startDate: startDate.value,
      endDate: endDate.value
    })
    
    clearTimeout(collectionTimeout.value)
    
    const duration = ((Date.now() - requestStartTime) / 1000).toFixed(1)
    
    if (response.data.success) {
      lastRequest.value = {
        status: 'success',
        startDate: startDate.value,
        endDate: endDate.value,
        barsCollected: response.data.barsCollected || 0,
        newBars: response.data.newBars || response.data.barsSaved || 0,
        duplicates: response.data.duplicates || 0,
        duration: duration
      }
      
      // Refresh latest bar and set new defaults
      await fetchLatestBar()
    } else {
      lastRequest.value = {
        status: 'failed',
        startDate: startDate.value,
        endDate: endDate.value,
        error: response.data.error || 'Collection failed'
      }
    }
    
  } catch (error) {
    clearTimeout(collectionTimeout.value)
    
    lastRequest.value = {
      status: 'failed',
      startDate: startDate.value,
      endDate: endDate.value,
      error: error.response?.data?.error || error.message || 'Unknown error'
    }
  } finally {
    isCollecting.value = false
  }
}

// Add this to the State section (after the other refs)
const isExpanded = ref(true)  // or false to start collapsed

// Add this function to the Methods section
function toggleExpanded() {
  isExpanded.value = !isExpanded.value
}

// Lifecycle
onMounted(() => {
  fetchLatestBar()
})
</script>

<style lang="scss" scoped>
.historical-panel-container {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  overflow: hidden;
  margin-top: 2rem;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  background: rgba(0, 0, 0, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
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
    
    .latest-bar {
      font-size: 0.9rem;
      padding: 0.5rem 1rem;
      background: rgba(96, 165, 250, 0.2);
      border-radius: 20px;
      color: #93c5fd;
    }
    
    .expand-btn {
      background: none;
      border: none;
      color: white;
      font-size: 1.2rem;
      cursor: pointer;
      padding: 0.5rem;
      transition: transform 0.3s ease;
      
      &:hover {
        transform: scale(1.2);
      }
    }
  }
}

.panel-body {
  padding: 1.5rem;
  
  .info-box {
    background: rgba(96, 165, 250, 0.1);
    border: 1px solid rgba(96, 165, 250, 0.3);
    border-radius: 8px;
    padding: 0.75rem;
    margin-bottom: 1.5rem;
    font-size: 0.9rem;
    color: #93c5fd;
  }
  
  .date-range-section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1.5rem;
    
    .date-input-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      
      label {
        font-size: 0.9rem;
        opacity: 0.9;
      }
      
      .date-input {
        padding: 0.75rem;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        color: white;
        font-size: 1rem;
        
        &:focus {
          outline: none;
          border-color: rgba(96, 165, 250, 0.5);
          background: rgba(0, 0, 0, 0.4);
        }
        
        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        // Style the calendar icon
        &::-webkit-calendar-picker-indicator {
          filter: invert(1);
          cursor: pointer;
        }
      }
    }
  }
  
  .action-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    
    .collect-btn {
      padding: 0.75rem 2rem;
      background: rgba(74, 222, 128, 0.2);
      border: 2px solid rgba(74, 222, 128, 0.5);
      color: white;
      font-size: 1rem;
      font-weight: 600;
      border-radius: 30px;
      cursor: pointer;
      transition: all 0.3s ease;
      min-width: 200px;
      
      &:hover:not(:disabled) {
        background: rgba(74, 222, 128, 0.3);
        transform: translateY(-2px);
      }
      
      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
    
    .warning-text {
      font-size: 0.85rem;
      color: #fbbf24;
      font-style: italic;
    }
  }
  
  .last-request-section {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 1rem;
    
    h4 {
      margin: 0 0 0.75rem 0;
      color: #93c5fd;
      font-size: 1rem;
    }
    
    .request-result {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 1rem;
      font-size: 0.9rem;
      
      &.success {
        border: 1px solid rgba(74, 222, 128, 0.3);
      }
      
      &.failed {
        border: 1px solid rgba(248, 113, 113, 0.3);
      }
      
      &.collecting {
        border: 1px solid rgba(251, 191, 36, 0.3);
        animation: pulse-border 2s infinite;
      }
      
      .status-line {
        margin-bottom: 0.5rem;
        font-weight: 600;
        
        span {
          margin-left: 0.5rem;
          color: #4ade80;
        }
      }
      
      &.failed .status-line span {
        color: #f87171;
      }
      
      div {
        margin: 0.25rem 0;
        opacity: 0.9;
      }
      
      .error-message {
        color: #fbbf24;
        margin-top: 0.5rem;
      }
    }
  }
}

// Add slide transition
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

.calendar-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 1rem;
  background: rgba(147, 197, 253, 0.2);
  border: 1px solid rgba(147, 197, 253, 0.3);
  border-radius: 12px;
  color: #93c5fd;
  text-decoration: none;
  font-size: 0.9rem;
  transition: all 0.3s ease;
  
  &:hover {
    background: rgba(147, 197, 253, 0.3);
    transform: translateY(-1px);
  }
  
  .external-icon {
    font-size: 0.8rem;
    opacity: 0.7;
  }
}

@keyframes pulse-border {
  0%, 100% { border-color: rgba(251, 191, 36, 0.3); }
  50% { border-color: rgba(251, 191, 36, 0.6); }
}
</style>
