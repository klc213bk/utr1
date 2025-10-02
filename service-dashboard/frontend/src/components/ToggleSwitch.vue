<template>
  <div class="toggle-container">
    <button 
      class="toggle-switch"
      :class="{ 'enabled': enabled, 'loading': loading }"
      @click="handleClick"
      :disabled="loading || isManualService"
    >
      <span class="toggle-slider"></span>
      <span class="toggle-label">{{ label }}</span>
    </button>
    <span v-if="isManualService" class="manual-note">Manual control only</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  enabled: {
    type: Boolean,
    required: true
  },
  loading: {
    type: Boolean,
    default: false
  },
  serviceId: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['toggle'])

const isManualService = computed(() => {
  // NATS and PostgreSQL need manual control in this simple implementation
  return ['nats', 'postgres'].includes(props.serviceId)
})

const label = computed(() => {
  if (props.loading) return 'Processing...'
  return props.enabled ? 'ON' : 'OFF'
})

function handleClick() {
  if (!props.loading && !isManualService.value) {
    emit('toggle')
  }
}
</script>

<style lang="scss" scoped>
.toggle-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.toggle-switch {
  position: relative;
  width: 80px;
  height: 36px;
  background: rgba(0, 0, 0, 0.3);
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 18px;
  cursor: pointer;
  transition: all 0.3s ease;
  padding: 0;
  overflow: hidden;
  
  &:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.4);
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  &.enabled {
    background: rgba(74, 222, 128, 0.3);
    border-color: rgba(74, 222, 128, 0.5);
    
    .toggle-slider {
      transform: translateX(44px);
      background: #4ade80;
    }
    
    .toggle-label {
      transform: translateX(-20px);
    }
  }
  
  &.loading {
    animation: pulse 1s infinite;
  }
  
  .toggle-slider {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 28px;
    height: 28px;
    background: #f87171;
    border-radius: 50%;
    transition: all 0.3s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }
  
  .toggle-label {
    position: relative;
    z-index: 1;
    display: block;
    font-size: 0.75rem;
    font-weight: bold;
    color: white;
    transform: translateX(20px);
    transition: all 0.3s ease;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
}

.manual-note {
  font-size: 0.75rem;
  opacity: 0.7;
  font-style: italic;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
</style>