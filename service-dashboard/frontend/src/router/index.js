import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import Analytics from '../views/Analytics.vue'
import NatsMonitor from '../views/NatsMonitor.vue'

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: Dashboard
  },
  {
    path: '/analytics',
    name: 'Analytics',
    component: Analytics
  },
  {
    path: '/analytics/backtest/:id',
    name: 'BacktestResults',
    component: Analytics
  },
   {
    path: '/monitor',
    name: 'NatsMonitor',
    component: NatsMonitor
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router