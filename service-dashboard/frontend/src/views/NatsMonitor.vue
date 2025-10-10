<template>
  <div class="nats-monitor">
    <!-- Header -->
    <div class="monitor-header">
      <div class="header-info">
        <span class="header-icon">📡</span>
        <h1>NATS Monitor</h1>
        <span class="connection-badge" :class="connectionStatus">
          {{ isConnected ? 'Connected' : 'Disconnected' }}
        </span>
      </div>
      <div class="header-stats">
        <span class="stat">Rate: {{ currentRate }} msg/s</span>
        <span class="stat">Total: {{ totalMessages.toLocaleString() }}</span>
        <span class="stat">Polling: {{ pollingRate }}s</span>
      </div>
    </div>

    <!-- Controls -->
    <div class="monitor-controls">
      <div class="control-group">
        <label>Subject Filter:</label>
        <input 
          v-model="subjectFilter" 
          placeholder="e.g. md.> or md.equity.*"
          class="filter-input"
          @keyup.enter="applyFilter"
        />
        <button @click="applyFilter" class="btn-apply">Apply</button>
      </div>
      
      <div class="control-group">
        <label>Poll Rate:</label>
        <div class="poll-rate-buttons">
          <button 
            v-for="rate in [1, 2, 5]" 
            :key="rate"
            @click="setPollingRate(rate)"
            :class="['rate-btn', { active: pollingRate === rate }]"
          >
            {{ rate }}s
          </button>
          <button 
            @click="setPollingRate(0)"
            :class="['rate-btn', { active: pollingRate === 0 }]"
          >
            Stop
          </button>
        </div>
      </div>
      
      <div class="control-group">
        <button @click="togglePolling" class="btn-toggle" :class="{ paused: isPaused }">
          {{ isPaused ? '▶ Resume' : '⏸ Pause' }}
        </button>
        <button @click="clearMessages" class="btn-clear">
          Clear Messages
        </button>
        <button @click="resetCounts" class="btn-reset">
          Reset Counts
        </button>
      </div>
    </div>

    <!-- Main Content -->
    <div class="monitor-content">
      <!-- Subjects Panel -->
      <div class="subjects-panel">
        <h3>Active Subjects</h3>
        <div class="subjects-tree">
          <div 
            v-for="(info, subject) in subjects" 
            :key="subject"
            class="subject-item"
            :class="{ active: info.new > 0, selected: selectedSubject === subject }"
            @click="selectSubject(subject)"
          >
            <span class="subject-name">{{ subject }}</span>
            <span class="subject-count" :class="{ highlight: info.new > 0 }">
              {{ info.new }}/{{ info.total }}
            </span>
          </div>
        </div>
        <div class="subjects-summary">
          <div>{{ Object.keys(subjects).length }} subjects</div>
          <div>{{ currentRate }} msg/s</div>
        </div>
      </div>

      <!-- Messages Panel -->
      <div class="messages-panel">
        <h3>Message Stream</h3>
        <div class="messages-container" ref="messagesContainer">
          <table class="messages-table">
            <thead>
              <tr>
                <th width="15%">Time</th>
                <th width="30%">Subject</th>
                <th width="15%">Messages</th>
                <th width="40%">Data</th>
              </tr>
            </thead>
            <tbody>
              <tr 
                v-for="(msg, idx) in displayedMessages" 
                :key="idx"
                class="message-row"
                :class="{ new: msg.isNew }"
                @click="selectMessage(msg)"
              >
                <td class="msg-time">{{ formatTime(msg.timestamp) }}</td>
                <td class="msg-subject">{{ msg.subject }}</td>
                <td class="msg-count">
                  {{ subjects[msg.subject]?.new }}/{{ subjects[msg.subject]?.total }}
                </td>
                <td class="msg-data">{{ formatPayload(msg.payload) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="messages-footer">
          Showing latest {{ displayedMessages.length }} messages
        </div>
      </div>
    </div>

    <!-- Message Detail Modal -->
    <div v-if="selectedMessage" class="message-modal" @click.self="selectedMessage = null">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Message Details</h3>
          <button @click="selectedMessage = null" class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <div><strong>Time:</strong> {{ formatTime(selectedMessage.timestamp) }}</div>
          <div><strong>Subject:</strong> {{ selectedMessage.subject }}</div>
          <div><strong>Payload:</strong></div>
          <pre>{{ JSON.stringify(selectedMessage.payload, null, 2) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

// State
const isConnected = ref(false)
const isPaused = ref(false)
const pollingRate = ref(1) // seconds
const subjectFilter = ref('')
const activeFilter = ref('')
const messages = ref([])
const subjects = ref({})
const totalMessages = ref(0)
const currentRate = ref(0)
const lastTimestamp = ref(null)
const selectedSubject = ref(null)
const selectedMessage = ref(null)

// Polling
let pollInterval = null

// Computed
const connectionStatus = computed(() => isConnected.value ? 'connected' : 'disconnected')

const displayedMessages = computed(() => {
  let filtered = messages.value

  if (selectedSubject.value) {
    filtered = filtered.filter(m => m.subject === selectedSubject.value)
  }

  // Keep last 100 messages, reversed so newest appears first
  return filtered.slice(-100).reverse()
})

// Methods
async function poll() {
  if (isPaused.value || pollingRate.value === 0) return
  
  try {
    const params = {
      since: lastTimestamp.value || Date.now() - 60000, // Last minute if no timestamp
    }
    
    if (activeFilter.value) {
      params.subject = activeFilter.value
    }
    
    const response = await axios.get('http://localhost:3000/api/monitor/poll', { params })
    
    if (response.data) {
      processUpdate(response.data)
    }
    
    isConnected.value = true
  } catch (error) {
    console.error('Poll error:', error)
    isConnected.value = false
  }
}

function processUpdate(data) {
  // Update timestamp
  lastTimestamp.value = data.timestamp
  
  // Add new messages
  if (data.messages && data.messages.length > 0) {
    data.messages.forEach(msg => {
      msg.isNew = true
      messages.value.push(msg)
    })
    
    // Mark old messages as not new
    setTimeout(() => {
      messages.value.forEach(m => m.isNew = false)
    }, 500)
  }
  
  // Keep only last 500 messages in memory
  if (messages.value.length > 500) {
    messages.value = messages.value.slice(-500)
  }
  
  // Update subjects with new/total counts
  if (data.subjects) {
    Object.entries(data.subjects).forEach(([subject, counts]) => {
      if (!subjects.value[subject]) {
        subjects.value[subject] = { new: 0, total: 0 }
      }
      subjects.value[subject].new = counts.new
      subjects.value[subject].total = counts.total
    })
  }
  
  // Update stats
  totalMessages.value = data.totalMessages || totalMessages.value
  currentRate.value = data.rate || 0
  
  // Auto-scroll to top (newest messages at top)
  const container = messagesContainer.value
  if (container) {
    setTimeout(() => {
      container.scrollTop = 0
    }, 10)
  }
}

function setPollingRate(rate) {
  pollingRate.value = rate
  resetPolling()
}

function togglePolling() {
  isPaused.value = !isPaused.value
  if (!isPaused.value && pollingRate.value > 0) {
    poll() // Immediate poll when resuming
  }
}

function resetPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
  }
  
  if (pollingRate.value > 0 && !isPaused.value) {
    poll() // Initial poll
    pollInterval = setInterval(poll, pollingRate.value * 1000)
  }
}

function applyFilter() {
  activeFilter.value = subjectFilter.value
  clearMessages()
  poll()
}

function clearMessages() {
  messages.value = []
}

function resetCounts() {
  subjects.value = {}
  totalMessages.value = 0
}

function selectSubject(subject) {
  selectedSubject.value = selectedSubject.value === subject ? null : subject
}

function selectMessage(msg) {
  selectedMessage.value = msg
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatPayload(payload) {
  if (typeof payload === 'string') {
    return payload.substring(0, 100) + (payload.length > 100 ? '...' : '')
  }
  const str = JSON.stringify(payload)
  return str.substring(0, 100) + (str.length > 100 ? '...' : '')
}

// Refs
const messagesContainer = ref(null)

// Lifecycle
onMounted(() => {
  resetPolling()
})

onUnmounted(() => {
  if (pollInterval) {
    clearInterval(pollInterval)
  }
})
</script>

<style scoped>
.nats-monitor {
  min-height: 100vh;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  color: #f1f5f9;
  padding: 1rem;
}

.monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: rgba(15, 23, 42, 0.98);
  border-radius: 12px;
  margin-bottom: 1rem;
}

.header-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-icon {
  font-size: 1.5rem;
}

h1 {
  margin: 0;
  font-size: 1.5rem;
  background: linear-gradient(135deg, #60a5fa, #a78bfa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.connection-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.connection-badge.connected {
  background: rgba(74, 222, 128, 0.2);
  color: #4ade80;
  border: 1px solid #4ade80;
}

.connection-badge.disconnected {
  background: rgba(248, 113, 113, 0.2);
  color: #f87171;
  border: 1px solid #f87171;
}

.header-stats {
  display: flex;
  gap: 2rem;
  font-size: 0.9rem;
}

.stat {
  opacity: 0.8;
}

.monitor-controls {
  display: flex;
  gap: 2rem;
  padding: 1rem 2rem;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 12px;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.control-group label {
  font-size: 0.9rem;
  opacity: 0.9;
}

.filter-input {
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: white;
  width: 200px;
}

.poll-rate-buttons {
  display: flex;
  gap: 0.25rem;
}

.rate-btn {
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: white;
  cursor: pointer;
  transition: all 0.2s;
}

.rate-btn.active {
  background: rgba(96, 165, 250, 0.3);
  border-color: #60a5fa;
  color: #60a5fa;
}

.rate-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.btn-toggle, .btn-clear, .btn-reset, .btn-apply {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.1);
  color: white;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-toggle.paused {
  background: rgba(74, 222, 128, 0.2);
  border-color: #4ade80;
  color: #4ade80;
}

.monitor-content {
  display: grid;
  grid-template-columns: 30% 70%;
  gap: 1rem;
  height: calc(100vh - 250px);
}

.subjects-panel, .messages-panel {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 12px;
  padding: 1rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.subjects-panel h3, .messages-panel h3 {
  margin: 0 0 1rem 0;
  font-size: 1.1rem;
  color: #93c5fd;
}

.subjects-tree {
  flex: 1;
  overflow-y: auto;
}

.subject-item {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.subject-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.subject-item.active {
  background: rgba(74, 222, 128, 0.1);
}

.subject-item.selected {
  background: rgba(96, 165, 250, 0.2);
  border: 1px solid rgba(96, 165, 250, 0.3);
}

.subject-count {
  font-family: monospace;
  font-size: 0.9rem;
  opacity: 0.7;
}

.subject-count.highlight {
  color: #4ade80;
  font-weight: bold;
}

.subjects-summary {
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  opacity: 0.8;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
}

.messages-table {
  width: 100%;
  border-collapse: collapse;
}

.messages-table th {
  text-align: left;
  padding: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  color: #93c5fd;
  font-weight: 600;
  position: sticky;
  top: 0;
  background: rgba(0, 0, 0, 0.5);
}

.message-row {
  transition: all 0.2s;
  cursor: pointer;
}

.message-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.message-row.new {
  animation: highlight 0.5s ease;
}

.message-row td {
  padding: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 0.85rem;
}

.msg-time {
  font-family: monospace;
  opacity: 0.8;
}

.msg-subject {
  color: #60a5fa;
}

.msg-count {
  font-family: monospace;
  opacity: 0.7;
}

.msg-data {
  font-family: monospace;
  font-size: 0.8rem;
  opacity: 0.7;
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.messages-footer {
  padding-top: 0.5rem;
  text-align: center;
  font-size: 0.85rem;
  opacity: 0.6;
}

.message-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: #1e293b;
  border-radius: 12px;
  width: 600px;
  max-height: 80vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-header h3 {
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
}

.modal-body {
  padding: 1rem;
}

.modal-body pre {
  background: rgba(0, 0, 0, 0.3);
  padding: 1rem;
  border-radius: 6px;
  overflow-x: auto;
}

@keyframes highlight {
  0% { background: rgba(74, 222, 128, 0.3); }
  100% { background: transparent; }
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>