<template>
  <div class="status-indicator" :class="statusClass">
    <span class="status-dot"></span>
    <span class="status-label">{{ statusLabel }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  status: {
    type: String,
    required: true,
    validator: (value) => ['online', 'offline', 'error', 'unknown'].includes(value)
  }
})

const statusClass = computed(() => `status-${props.status}`)

const statusLabel = computed(() => {
  const labels = {
    online: 'Online',
    offline: 'Offline',
    error: 'Error',
    unknown: 'Unknown'
  }
  return labels[props.status] || 'Unknown'
})
</script>

<style lang="scss" scoped>
.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.2);
  
  .status-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    position: relative;
  }
  
  .status-label {
    font-size: 0.875rem;
    font-weight: 500;
    text-transform: uppercase;
  }
  
  &.status-online {
    .status-dot {
      background: #4ade80;
      box-shadow: 0 0 10px #4ade80;
      animation: pulse 2s infinite;
    }
    .status-label {
      color: #4ade80;
    }
  }
  
  &.status-offline {
    .status-dot {
      background: #f87171;
      box-shadow: 0 0 10px #f87171;
    }
    .status-label {
      color: #f87171;
    }
  }
  
  &.status-error {
    .status-dot {
      background: #fbbf24;
      box-shadow: 0 0 10px #fbbf24;
      animation: blink 1s infinite;
    }
    .status-label {
      color: #fbbf24;
    }
  }
  
  &.status-unknown {
    .status-dot {
      background: #9ca3af;
      box-shadow: 0 0 10px #9ca3af;
    }
    .status-label {
      color: #9ca3af;
    }
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

@keyframes blink {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
</style>