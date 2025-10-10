<template>
  <div class="backtest-nats-monitor">
    <div class="monitor-header">
      <h4>📡 NATS Message Flow</h4>
      <div class="monitor-stats">
        <span class="stat">{{ currentRate }} msg/s</span>
        <span class="stat">{{ totalMessages }} total</span>
      </div>
    </div>

    <div class="monitor-content">
      <!-- Active Subjects -->
      <div class="subjects-section">
        <h5>Active Subjects</h5>
        <div class="subjects-list">
          <div
            v-for="(info, subject) in filteredSubjects"
            :key="subject"
            class="subject-item"
            :class="{ active: info.new > 0 }"
          >
            <span class="subject-name">{{ subject }}</span>
            <span class="subject-count" :class="{ highlight: info.new > 0 }">
              {{ info.new }}/{{ info.total }}
            </span>
          </div>
          <div v-if="Object.keys(filteredSubjects).length === 0" class="no-messages">
            No messages yet...
          </div>
        </div>
      </div>

      <!-- Recent Messages -->
      <div class="messages-section">
        <h5>Recent Messages</h5>
        <div class="messages-list" ref="messagesContainer">
          <div
            v-for="(msg, idx) in recentMessages"
            :key="idx"
            class="message-item"
            :class="{ new: msg.isNew }"
          >
            <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
            <span class="msg-subject">{{ msg.subject }}</span>
            <span class="msg-preview">{{ formatPayload(msg.payload) }}</span>
          </div>
          <div v-if="recentMessages.length === 0" class="no-messages">
            Waiting for messages...
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import axios from 'axios'

const props = defineProps({
  backtestId: {
    type: String,
    default: null
  },
  isRunning: {
    type: Boolean,
    default: false
  }
})

// State
const messages = ref([])
const subjects = ref({})
const totalMessages = ref(0)
const currentRate = ref(0)
const lastTimestamp = ref(null)

// Polling
let pollInterval = null

// Computed
const filteredSubjects = computed(() => {
  // Filter to show only backtest-related subjects
  const filtered = {}
  Object.entries(subjects.value).forEach(([subject, info]) => {
    // Show subjects related to market data, strategy, execution, and backtest events
    if (
      subject.includes('replay') ||
      subject.includes('strategy') ||
      subject.includes('execution') ||
      subject.includes('backtest') ||
      subject.includes('md.equity')
    ) {
      filtered[subject] = info
    }
  })
  return filtered
})

const recentMessages = computed(() => {
  // Keep last 20 messages, reversed so newest appears first
  return messages.value.slice(-20).reverse()
})

// Methods
async function poll() {
  if (!props.isRunning) return

  try {
    const params = {
      since: lastTimestamp.value || Date.now() - 5000, // Last 5 seconds if no timestamp
    }

    const response = await axios.get('http://localhost:3000/api/monitor/poll', { params })

    if (response.data) {
      processUpdate(response.data)
    }
  } catch (error) {
    console.error('NATS monitor poll error:', error)
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

    // Mark old messages as not new after 500ms
    setTimeout(() => {
      messages.value.forEach(m => m.isNew = false)
    }, 500)
  }

  // Keep only last 100 messages in memory
  if (messages.value.length > 100) {
    messages.value = messages.value.slice(-100)
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
    return payload.substring(0, 60) + (payload.length > 60 ? '...' : '')
  }
  const str = JSON.stringify(payload)
  return str.substring(0, 60) + (str.length > 60 ? '...' : '')
}

function startPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
  }

  if (props.isRunning) {
    poll() // Initial poll
    pollInterval = setInterval(poll, 1000) // Poll every second
  }
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

function clearData() {
  messages.value = []
  subjects.value = {}
  totalMessages.value = 0
  lastTimestamp.value = null
}

// Refs
const messagesContainer = ref(null)

// Watch for running state changes
watch(() => props.isRunning, (newVal) => {
  if (newVal) {
    clearData()
    startPolling()
  } else {
    stopPolling()
  }
})

// Lifecycle
onMounted(() => {
  if (props.isRunning) {
    startPolling()
  }
})

onUnmounted(() => {
  stopPolling()
})
</script>

<style lang="scss" scoped>
.backtest-nats-monitor {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(96, 165, 250, 0.2);
  border-radius: 8px;
  padding: 1rem;
  margin-top: 1.5rem;
}

.monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);

  h4 {
    margin: 0;
    font-size: 1rem;
    color: #93c5fd;
  }
}

.monitor-stats {
  display: flex;
  gap: 1rem;
  font-size: 0.85rem;

  .stat {
    color: rgba(255, 255, 255, 0.7);
  }
}

.monitor-content {
  display: grid;
  grid-template-columns: 40% 60%;
  gap: 1rem;
  max-height: 300px;
}

.subjects-section, .messages-section {
  display: flex;
  flex-direction: column;

  h5 {
    margin: 0 0 0.5rem 0;
    font-size: 0.9rem;
    color: #60a5fa;
    opacity: 0.9;
  }
}

.subjects-list, .messages-list {
  flex: 1;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  padding: 0.5rem;
}

.subject-item {
  display: flex;
  justify-content: space-between;
  padding: 0.4rem 0.5rem;
  border-radius: 4px;
  margin-bottom: 0.25rem;
  font-size: 0.85rem;
  transition: all 0.2s;

  &.active {
    background: rgba(74, 222, 128, 0.1);
  }

  .subject-name {
    color: #93c5fd;
    font-family: monospace;
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subject-count {
    font-family: monospace;
    font-size: 0.8rem;
    opacity: 0.6;
    margin-left: 0.5rem;
    flex-shrink: 0;

    &.highlight {
      color: #4ade80;
      font-weight: bold;
      opacity: 1;
    }
  }
}

.message-item {
  display: grid;
  grid-template-columns: 70px 1fr 1fr;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 0.8rem;
  transition: all 0.2s;

  &.new {
    animation: highlight 0.5s ease;
  }

  .msg-time {
    font-family: monospace;
    opacity: 0.6;
    font-size: 0.75rem;
  }

  .msg-subject {
    color: #60a5fa;
    font-family: monospace;
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .msg-preview {
    font-family: monospace;
    opacity: 0.5;
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.no-messages {
  text-align: center;
  padding: 2rem 1rem;
  opacity: 0.5;
  font-size: 0.85rem;
  font-style: italic;
}

@keyframes highlight {
  0% { background: rgba(74, 222, 128, 0.3); }
  100% { background: transparent; }
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
