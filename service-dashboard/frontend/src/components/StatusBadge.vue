<template>
  <span class="status-badge" :class="`status-${status}`">
    <span class="status-dot"></span>
    <span class="status-text">{{ text }}</span>
  </span>
</template>

<script setup>
defineProps({
  status: {
    type: String,
    required: true
  },
  text: {
    type: String,
    required: true
  }
})
</script>

<style lang="scss" scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  
  &.status-idle {
    .status-dot {
      background: #9ca3af;
    }
    .status-text {
      color: #9ca3af;
    }
  }
  
  &.status-collecting {
    animation: pulse 2s infinite;
    .status-dot {
      background: #fbbf24;
      animation: blink 1s infinite;
    }
    .status-text {
      color: #fbbf24;
    }
  }
  
  &.status-disconnected {
    .status-dot {
      background: #f87171;
    }
    .status-text {
      color: #f87171;
    }
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>