/**
 * Generate a human-readable session ID for trading sessions
 *
 * Format: {type}_{YYYYMMDD}_{HHMMSS}_{strategy}
 * Examples:
 *   - bt_20251010_143022_ma_cross
 *   - paper_20251010_143530_rsi
 *   - live_20251010_150000_momentum
 *
 * @param {string} type - Session type: 'bt', 'paper', or 'live'
 * @param {string} strategy - Strategy name (e.g., 'ma_cross', 'rsi', 'buy_hold')
 * @returns {string} Generated session ID
 */
export function generateSessionId(type, strategy) {
  const now = new Date()

  // Format date as YYYYMMDD
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const dateStr = `${year}${month}${day}`

  // Format time as HHMMSS
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  const timeStr = `${hours}${minutes}${seconds}`

  // Build session ID
  const strategyPart = strategy ? `_${strategy}` : ''
  return `${type}_${dateStr}_${timeStr}${strategyPart}`
}

/**
 * Parse a session ID to extract its components
 *
 * @param {string} sessionId - Session ID to parse
 * @returns {object} Parsed components: { type, date, time, strategy }
 */
export function parseSessionId(sessionId) {
  const parts = sessionId.split('_')

  if (parts.length < 3) {
    return null
  }

  return {
    type: parts[0],
    date: parts[1], // YYYYMMDD
    time: parts[2], // HHMMSS
    strategy: parts[3] || null
  }
}

/**
 * Format a session ID for display
 *
 * @param {string} sessionId - Session ID to format
 * @returns {string} Human-readable format
 */
export function formatSessionId(sessionId) {
  const parsed = parseSessionId(sessionId)
  if (!parsed) return sessionId

  // Format date as YYYY-MM-DD
  const date = `${parsed.date.slice(0, 4)}-${parsed.date.slice(4, 6)}-${parsed.date.slice(6, 8)}`

  // Format time as HH:MM:SS
  const time = `${parsed.time.slice(0, 2)}:${parsed.time.slice(2, 4)}:${parsed.time.slice(4, 6)}`

  const typeMap = {
    'bt': 'Backtest',
    'paper': 'Paper',
    'live': 'Live'
  }

  const typeLabel = typeMap[parsed.type] || parsed.type
  const strategyLabel = parsed.strategy ? ` (${parsed.strategy})` : ''

  return `${typeLabel}${strategyLabel} - ${date} ${time}`
}
