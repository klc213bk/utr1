<template>
  <div id="app">
    <!-- Navigation Bar -->
    <nav class="main-nav">
      <div class="nav-brand">
        <span class="logo">🎛️</span>
        <span class="brand-text">Trading System</span>
      </div>
      <div class="nav-links">
        <router-link to="/" class="nav-link" :class="{ active: $route.path === '/' }">
          <span class="nav-icon">🏠</span>
          <span>Dashboard</span>
        </router-link>
        <router-link to="/trading" class="nav-link">
          <span class="icon">🎯</span>
          Trading Control
        </router-link>
        <router-link to="/analytics" class="nav-link" :class="{ active: $route.path.includes('/analytics') }">
          <span class="nav-icon">📈</span>
          <span>Analytics</span>
        </router-link>
        <a 
          href="/monitor" 
          target="_blank"
          class="nav-link monitor-link"
          title="Open NATS Monitor in new tab"
        >
          <span>Monitor</span>
          <svg class="external-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M10 10H2V2h3V0H2C.9 0 0 .9 0 2v8c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7h-2v3zM7 0v2h1.59L4.29 6.29l1.42 1.42L10 3.41V5h2V0H7z"/>
          </svg>
        </a>
      </div>
      <div class="nav-status">
        <div class="connection-status">
          <span class="status-dot" :class="socketConnected ? 'connected' : 'disconnected'"></span>
          {{ socketConnected ? 'Connected' : 'Disconnected' }}
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <div class="main-content">
      <router-view :socket="socketsStore.mainSocket" :services="services" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, provide, computed, onUnmounted } from 'vue'
import { useSocketsStore } from './stores/sockets'
//import { io } from 'socket.io-client'

const socketsStore = useSocketsStore()
const services = ref({})

// Use the socket from store instead of local ref
const mainSocket = computed(() => socketsStore.mainSocket)
const socketConnected = computed(() => socketsStore.isMainConnected)

onMounted(() => {
  
  socketsStore.initMainSocket()

  // Listen for services updates when socket is available
  if (socketsStore.mainSocket) {
    socketsStore.mainSocket.on('services-update', (data) => {
      services.value = data
    })
  }

  // Wait a bit for socket to initialize, then set up listeners
  setTimeout(() => {
    if (socketsStore.mainSocket) {
      socketsStore.mainSocket.on('services-update', (data) => {
        services.value = data
      })
    }
  }, 100)

  // Provide socket to all child components
  provide('socketsStore', socketsStore)
  provide('services', services)
})

onUnmounted(() => {
  // Clean up socket listeners
  if (socketsStore.mainSocket) {
    socketsStore.mainSocket.off('services-update')
  }
})

</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
  color: #f1f5f9;
  min-height: 100vh;
}

#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.main-nav {
  background: rgba(15, 23, 42, 0.98);
  backdrop-filter: blur(10px);
  padding: 0 2rem;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  position: sticky;
  top: 0;
  z-index: 1000;
  box-shadow: 0 2px 20px rgba(0, 0, 0, 0.3);
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  
  .logo {
    font-size: 1.5rem;
  }
  
  .brand-text {
    font-size: 1.2rem;
    font-weight: 600;
    background: linear-gradient(135deg, #60a5fa, #a78bfa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
}

.nav-links {
  display: flex;
  gap: 0.5rem;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #94a3b8;
  text-decoration: none;
  padding: 0.6rem 1.2rem;
  border-radius: 10px;
  transition: all 0.3s ease;
  position: relative;
  
  .nav-icon {
    font-size: 1.1rem;
  }
  
  &:hover {
    background: rgba(255, 255, 255, 0.05);
    color: white;
    transform: translateY(-1px);
  }
  
  &.active {
    background: rgba(96, 165, 250, 0.15);
    color: #60a5fa;
    
    &::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 20%;
      right: 20%;
      height: 2px;
      background: linear-gradient(90deg, transparent, #60a5fa, transparent);
    }
  }
}

.nav-status {
  display: flex;
  align-items: center;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 20px;
  font-size: 0.9rem;
  
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    animation: pulse 2s infinite;
    
    &.connected {
      background: #10b981;
      box-shadow: 0 0 10px #10b981;
    }
    
    &.disconnected {
      background: #ef4444;
      box-shadow: 0 0 10px #ef4444;
      animation: none;
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

.main-content {
  flex: 1;
  overflow-y: auto;
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.2));
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 10px;
}

::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 5px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.nav-link.monitor-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  position: relative;
  background: rgba(147, 197, 253, 0.05);
  border: 1px solid rgba(147, 197, 253, 0.2);
  padding: 0.5rem 1rem;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.nav-link.monitor-link:hover {
  background: rgba(147, 197, 253, 0.15);
  border-color: rgba(147, 197, 253, 0.4);
  box-shadow: 0 0 10px rgba(147, 197, 253, 0.2);
}

.external-icon {
  opacity: 0.6;
  transition: opacity 0.2s;
}

.nav-link.monitor-link:hover .external-icon {
  opacity: 1;
}
</style>