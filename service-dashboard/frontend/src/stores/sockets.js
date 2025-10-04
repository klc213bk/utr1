// stores/sockets.js
import { defineStore } from 'pinia'
import { io } from 'socket.io-client'

export const useSocketsStore = defineStore('sockets', {
  state: () => ({
    mainSocket: null,
    backtestSocket: null,
    mainConnected: false,
    backtestConnected: false,
    listeners: new Map()
  }),

  getters: {
    isMainConnected: (state) => state.mainConnected,
    isBacktestConnected: (state) => state.backtestConnected
  },

  actions: {
    // Initialize main dashboard socket (port 3000)
    initMainSocket() {
      if (this.mainSocket?.connected) {
        this.mainConnected = true
        return this.mainSocket
      }

      this.mainSocket = io('http://localhost:3000', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionAttempts: 10
      })

      this.mainSocket.on('connect', () => {
        console.log('Main socket connected')
        this.mainConnected = true
      })

      this.mainSocket.on('disconnect', () => {
        console.log('Main socket disconnected')
        this.mainConnected = false
      })

      this.mainSocket.on('connect_error', (error) => {
        console.log('Main socket connection error:', error.message)
        this.mainConnected = false
      })

      return this.mainSocket
    },

    // Initialize backtest server socket (port 8083)
    initBacktestSocket() {
        console.log('initBacktestSocket called, current socket:', this.backtestSocket)
      if (this.backtestSocket?.connected) {
        console.log('Socket already connected')
        return this.backtestSocket
      }

      console.log('Creating new backtest socket connection')
      this.backtestSocket = io('http://localhost:8083', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
      })

      this.backtestSocket.on('connect', () => {
        console.log('Backtest socket connected')
        this.backtestConnected = true
      })

      this.backtestSocket.on('disconnect', () => {
        console.log('Backtest socket disconnected')
        this.backtestConnected = false
      })

      this.backtestSocket.on('connect_error', (error) => {
        console.log('Backtest connection error:', error.message)
        this.backtestConnected = false
      })

      // Set up persistent listeners for backtest events
      this.backtestSocket.on('backtest-progress', (data) => {
        // Emit to any registered listeners
        this.emit('backtest-progress', data)
      })

      this.backtestSocket.on('backtest-complete', (data) => {
        this.emit('backtest-complete', data)
      })

      this.backtestSocket.on('backtest-error', (data) => {
        this.emit('backtest-error', data)
      })

      // Force connection attempt
      if (!this.backtestSocket.connected) {
        this.backtestSocket.connect()
      }

      return this.backtestSocket
    },

    disconnectBacktestSocket() {
      if (this.backtestSocket) {
        this.backtestSocket.disconnect()
        this.backtestSocket = null
        this.backtestConnected = false
      }
    },

    // Register event listener
    on(event, callback) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, new Set())
      }
      this.listeners.get(event).add(callback)
    },

    // Remove event listener
    off(event, callback) {
      if (this.listeners.has(event)) {
        this.listeners.get(event).delete(callback)
      }
    },

    // Emit event to registered listeners
    emit(event, data) {
      if (this.listeners.has(event)) {
        this.listeners.get(event).forEach(callback => callback(data))
      }
    },

    // Check backtest server health
    async checkBacktestServerHealth() {
      try {
        const response = await fetch('http://localhost:8083/health')
        if (response.ok) {
          if (!this.backtestConnected) {
            this.initBacktestSocket()
          }
          return true
        }
      } catch (error) {
        this.backtestConnected = false
        return false
      }
    },

    // Clean up all sockets
    cleanup() {
      if (this.mainSocket) {
        this.mainSocket.disconnect()
        this.mainSocket = null
      }
      if (this.backtestSocket) {
        this.backtestSocket.disconnect()
        this.backtestSocket = null
      }
      this.listeners.clear()
    }
  }
})