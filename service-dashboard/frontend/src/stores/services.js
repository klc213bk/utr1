import { defineStore } from 'pinia'
import axios from 'axios'

export const useServicesStore = defineStore('services', {
  state: () => ({
    services: {},
    loading: false,
    error: null
  }),

  getters: {
    allServices: (state) => Object.values(state.services),
    
    onlineServices: (state) => {
      return Object.values(state.services).filter(s => s.status === 'online')
    },
    
    offlineServices: (state) => {
      return Object.values(state.services).filter(s => s.status === 'offline')
    },
    
    serviceById: (state) => (id) => {
      return state.services[id]
    }
  },

  actions: {
    async fetchServices() {
      this.loading = true
      this.error = null
      
      try {
        const response = await axios.get('/api/services')
        this.services = response.data
        return response.data
      } catch (error) {
        this.error = error.message
        console.error('Failed to fetch services:', error)
        throw error
      } finally {
        this.loading = false
      }
    },

    async fetchService(id) {
      try {
        const response = await axios.get(`/api/services/${id}`)
        if (this.services[id]) {
          this.services[id] = response.data
        }
        return response.data
      } catch (error) {
        console.error(`Failed to fetch service ${id}:`, error)
        throw error
      }
    },

    async controlService(id, action) {
      try {
        const response = await axios.post(`/api/services/${id}/${action}`)
        
        // Update local state if successful
        if (response.data.success) {
          // Fetch updated status
          await this.fetchService(id)
        }
        
        return response.data
      } catch (error) {
        console.error(`Failed to ${action} service ${id}:`, error)
        throw error
      }
    },

    updateServices(servicesData) {
      this.services = servicesData
    },

    updateService(id, serviceData) {
      if (this.services[id]) {
        this.services[id] = {
          ...this.services[id],
          ...serviceData
        }
      }
    }
  }
})