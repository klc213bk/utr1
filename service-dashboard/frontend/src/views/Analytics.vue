<template>
  <div class="analytics-page">
    <div class="analytics-header">
      <h1>📈 Performance Analytics</h1>
      
      <!-- Mode Selector -->
      <div class="mode-selector">
        <label>Mode:</label>
        <select v-model="selectedMode" @change="onModeChange">
          <option value="backtest">Backtesting</option>
          <option value="paper" disabled>Paper Trading (Coming Soon)</option>
          <option value="live" disabled>Live Trading (Coming Soon)</option>
        </select>
      </div>

      <!-- Backtest Selector -->
      <div v-if="selectedMode === 'backtest'" class="session-selector">
        <label>Select Backtest:</label>
        <select v-model="selectedBacktestId" @change="loadBacktestResults">
          <option value="">-- Select --</option>
          <option v-for="bt in availableBacktests" :key="bt.backtest_id" :value="bt.backtest_id">
            {{ bt.backtest_id }} - {{ bt.strategy }} ({{ formatDate(bt.created_at) }})
          </option>
        </select>
      </div>
    </div>

    <!-- Results Display -->
    <div v-if="resultsLoaded" class="results-container">
      <!-- Metrics Overview -->
      <div class="metrics-overview">
        <div class="metric-card">
          <span class="label">Total Return</span>
          <span class="value" :class="metrics.totalReturn >= 0 ? 'positive' : 'negative'">
            {{ metrics.totalReturn?.toFixed(2) || 0 }}%
          </span>
        </div>
        <div class="metric-card">
          <span class="label">Win Rate</span>
          <span class="value">{{ metrics.winRate?.toFixed(1) || 0 }}%</span>
        </div>
        <div class="metric-card">
          <span class="label">Total Trades</span>
          <span class="value">{{ metrics.totalTrades || 0 }}</span>
        </div>
        <div class="metric-card">
          <span class="label">Max Drawdown</span>
          <span class="value negative">{{ metrics.maxDrawdown?.toFixed(2) || 0 }}%</span>
        </div>
        <div class="metric-card">
          <span class="label">Total P&L</span>
          <span class="value" :class="metrics.totalPnL >= 0 ? 'positive' : 'negative'">
            ${{ metrics.totalPnL?.toFixed(2) || 0 }}
          </span>
        </div>
      </div>

      <!-- Equity Curve Chart (placeholder for now) -->
      <div class="chart-container">
        <h3>Equity Curve</h3>
        <div class="chart-placeholder">
          <canvas ref="equityChart"></canvas>
        </div>
      </div>

      <!-- Trades Table -->
      <div class="trades-section">
        <h3>Recent Trades</h3>
        <table class="trades-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Quantity</th>
              <th>Price</th>
              <th>P&L</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="trade in trades" :key="trade.id">
              <td>{{ formatTime(trade.timestamp) }}</td>
              <td>{{ trade.symbol }}</td>
              <td :class="trade.action === 'BUY' ? 'buy' : 'sell'">{{ trade.action }}</td>
              <td>{{ trade.quantity }}</td>
              <td>${{ trade.price?.toFixed(2) }}</td>
              <td :class="(trade.pnl || 0) >= 0 ? 'positive' : 'negative'">
                {{ trade.pnl ? `$${trade.pnl.toFixed(2)}` : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-state">
      <p>Select a backtest to view results</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import Chart from 'chart.js/auto'

const route = useRoute()
const selectedMode = ref('backtest')
const selectedBacktestId = ref('')
const availableBacktests = ref([])
const resultsLoaded = ref(false)
const metrics = ref({})
const trades = ref([])
const equityChart = ref(null)
let chartInstance = null

onMounted(async () => {
  // Wait a moment for socket to connect if needed
  await new Promise(resolve => setTimeout(resolve, 100))

  await loadAvailableBacktests()
  
  // Check if backtest ID in route params
  if (route.params.id) {
    selectedBacktestId.value = route.params.id
    await loadBacktestResults()
  }
})

async function loadAvailableBacktests() {
  try {
    const response = await axios.get('http://localhost:8087/api/analytics')
    availableBacktests.value = response.data.backtests || []
  } catch (error) {
    console.error('Error loading backtests:', error)
  }
}

async function loadBacktestResults() {
  if (!selectedBacktestId.value) return
  
  try {
    resultsLoaded.value = false
    
    // Load metrics
    const metricsResponse = await axios.get(
      `http://localhost:8087/api/metrics/${selectedBacktestId.value}`
    )
    metrics.value = metricsResponse.data
    
    // Load trades
    const tradesResponse = await axios.get(
      `http://localhost:8087/api/trades/${selectedBacktestId.value}`
    )
    trades.value = tradesResponse.data.trades || []
    
    // Load and draw equity curve
    const equityResponse = await axios.get(
      `http://localhost:8087/api/equity/${selectedBacktestId.value}`
    )
    drawEquityCurve(equityResponse.data.equityCurve || [])
    
    resultsLoaded.value = true
  } catch (error) {
    console.error('Error loading results:', error)
  }
}

function drawEquityCurve(data) {
  if (chartInstance) {
    chartInstance.destroy()
  }
  
  if (!data || data.length === 0) return
  
  const ctx = equityChart.value?.getContext('2d')
  if (!ctx) return
  
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => formatTime(d.timestamp)),
      datasets: [{
        label: 'Equity',
        data: data.map(d => d.value),
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96, 165, 250, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          display: true,
          grid: {
            display: false
          }
        },
        y: {
          display: true,
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            callback: (value) => '$' + value.toLocaleString()
          }
        }
      }
    }
  })
}

function onModeChange() {
  resultsLoaded.value = false
  selectedBacktestId.value = ''
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString()
}

function formatTime(timeStr) {
  return new Date(timeStr).toLocaleString()
}
</script>

<style scoped>
.analytics-page {
  min-height: 100vh;
  padding: 2rem;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  color: white;
}

.analytics-header {
  display: flex;
  align-items: center;
  gap: 2rem;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.analytics-header h1 {
  margin: 0;
  font-size: 2rem;
}

.mode-selector, .session-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.mode-selector select, .session-selector select {
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  font-size: 1rem;
  min-width: 200px;
}

.metrics-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.metric-card {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.metric-card .label {
  font-size: 0.9rem;
  color: #94a3b8;
}

.metric-card .value {
  font-size: 1.8rem;
  font-weight: bold;
}

.metric-card .positive {
  color: #10b981;
}

.metric-card .negative {
  color: #ef4444;
}

.chart-container {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 2rem;
  height: 400px;
}

.chart-placeholder {
  height: 350px;
  position: relative;
}

.trades-section {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 1.5rem;
}

.trades-table {
  width: 100%;
  border-collapse: collapse;
}

.trades-table th {
  text-align: left;
  padding: 0.75rem;
  border-bottom: 2px solid rgba(255, 255, 255, 0.2);
  color: #94a3b8;
  font-weight: 600;
}

.trades-table td {
  padding: 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.trades-table .buy {
  color: #10b981;
  font-weight: 600;
}

.trades-table .sell {
  color: #ef4444;
  font-weight: 600;
}

.empty-state {
  text-align: center;
  padding: 4rem;
  color: #64748b;
  font-size: 1.2rem;
}
</style>