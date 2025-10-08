/**
 * Risk Manager Test Suite
 *
 * Run this after starting the risk-manager service
 */

const { connect } = require('nats');
const axios = require('axios');

const RISK_MANAGER_URL = 'http://localhost:8086';
const NATS_URL = 'nats://localhost:4222';

let nc;

async function main() {
  console.log('🧪 Risk Manager Test Suite\n');
  console.log('='.repeat(60));

  try {
    // 1. Connect to NATS
    console.log('\n1. Connecting to NATS...');
    nc = await connect({ servers: NATS_URL });
    console.log('✅ Connected to NATS\n');

    // 2. Check Risk Manager health
    console.log('2. Checking Risk Manager health...');
    const health = await axios.get(`${RISK_MANAGER_URL}/health`);
    console.log('✅ Risk Manager is healthy');
    console.log('   Status:', health.data.status);
    console.log('   Mode:', health.data.mode);
    console.log('   Uptime:', Math.floor(health.data.uptime), 'seconds\n');

    // 3. Get current status
    console.log('3. Getting current risk status...');
    const status = await axios.get(`${RISK_MANAGER_URL}/api/risk/status`);
    console.log('✅ Current Status:');
    console.log('   Mode:', status.data.mode);
    console.log('   Reason:', status.data.modeReason);
    console.log('   Daily Trades:', status.data.dailyStats.totalTrades);
    console.log('   Approved:', status.data.dailyStats.approvedTrades);
    console.log('   Rejected:', status.data.dailyStats.rejectedTrades);
    console.log('   Realized P&L:', status.data.dailyStats.realizedPnL);
    console.log('   Portfolio Value:', status.data.portfolioValue);
    console.log('   Drawdown:', (status.data.drawdown * 100).toFixed(2) + '%\n');

    // 4. Subscribe to approved/rejected signals
    console.log('4. Setting up NATS subscriptions...');
    const approvedSub = nc.subscribe('risk.approved.*');
    const rejectedSub = nc.subscribe('risk.rejected.*');

    let approvedCount = 0;
    let rejectedCount = 0;

    (async () => {
      for await (const msg of approvedSub) {
        approvedCount++;
        const signal = JSON.parse(msg.data);
        console.log(`   ✅ APPROVED: ${signal.symbol} ${signal.action} ${signal.quantity} @ ${signal.price}`);
      }
    })();

    (async () => {
      for await (const msg of rejectedSub) {
        rejectedCount++;
        const signal = JSON.parse(msg.data);
        console.log(`   ❌ REJECTED: ${signal.symbol} ${signal.action} ${signal.quantity} - ${signal.rejectionReason}`);
      }
    })();

    console.log('✅ Subscribed to risk.approved.* and risk.rejected.*\n');

    // Wait a moment for subscriptions to be ready
    await sleep(500);

    // 5. Run test signals
    console.log('5. Running test signals...\n');
    console.log('='.repeat(60));

    // Test 1: Normal signal (should approve)
    console.log('\n📤 TEST 1: Normal Buy Signal (100 shares @ $450)');
    await publishSignal({
      strategy_id: 'test_001',
      symbol: 'SPY',
      action: 'BUY',
      quantity: 100,
      price: 450
    });
    await sleep(1000);

    // Test 2: Another normal signal
    console.log('\n📤 TEST 2: Another Normal Buy (200 shares @ $450)');
    await publishSignal({
      strategy_id: 'test_002',
      symbol: 'SPY',
      action: 'BUY',
      quantity: 200,
      price: 450
    });
    await sleep(1000);

    // Test 3: Oversized position (should reject)
    console.log('\n📤 TEST 3: Oversized Trade (5000 shares - exceeds limit)');
    await publishSignal({
      strategy_id: 'test_003',
      symbol: 'SPY',
      action: 'BUY',
      quantity: 5000,
      price: 450
    });
    await sleep(1000);

    // Test 4: Expensive trade (should reject)
    console.log('\n📤 TEST 4: Expensive Trade ($100k - exceeds limit)');
    await publishSignal({
      strategy_id: 'test_004',
      symbol: 'SPY',
      action: 'BUY',
      quantity: 300,
      price: 350
    });
    await sleep(1000);

    // Test 5: Sell without position (should reject)
    console.log('\n📤 TEST 5: Sell Without Position');
    await publishSignal({
      strategy_id: 'test_005',
      symbol: 'AAPL',
      action: 'SELL',
      quantity: 100,
      price: 180
    });
    await sleep(1000);

    // Test 6: Normal sell
    console.log('\n📤 TEST 6: Normal Sell (50 shares of SPY)');
    await publishSignal({
      strategy_id: 'test_006',
      symbol: 'SPY',
      action: 'SELL',
      quantity: 50,
      price: 451
    });
    await sleep(1000);

    console.log('\n' + '='.repeat(60));

    // 6. Check updated status
    console.log('\n6. Checking updated status...');
    const updatedStatus = await axios.get(`${RISK_MANAGER_URL}/api/risk/status`);
    console.log('✅ Updated Status:');
    console.log('   Total Trades:', updatedStatus.data.dailyStats.totalTrades);
    console.log('   Approved:', updatedStatus.data.dailyStats.approvedTrades);
    console.log('   Rejected:', updatedStatus.data.dailyStats.rejectedTrades);
    console.log('   Positions:', updatedStatus.data.positions.length);

    if (updatedStatus.data.positions.length > 0) {
      console.log('\n   Current Positions:');
      updatedStatus.data.positions.forEach(pos => {
        console.log(`     ${pos.symbol}: ${pos.quantity} shares @ avg $${pos.avgPrice.toFixed(2)}`);
      });
    }

    // 7. Get recent events from database
    console.log('\n7. Checking recent risk events...');
    const events = await axios.get(`${RISK_MANAGER_URL}/api/risk/events?limit=10`);
    console.log(`✅ Found ${events.data.count} recent events`);

    // 8. Get rejections
    console.log('\n8. Checking recent rejections...');
    const rejections = await axios.get(`${RISK_MANAGER_URL}/api/risk/rejections?limit=10`);
    console.log(`✅ Found ${rejections.data.count} rejections:`);
    rejections.data.rejections.forEach((rej, i) => {
      const signal = rej.signal;
      console.log(`   ${i + 1}. ${signal.symbol} ${signal.action} ${signal.quantity} - ${rej.rejection_reason}`);
    });

    // 9. Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Signals Published: 6`);
    console.log(`Signals Approved: ${approvedCount}`);
    console.log(`Signals Rejected: ${rejectedCount}`);
    console.log('\nExpected Results:');
    console.log('  ✅ Approved: 3 (Tests 1, 2, 6)');
    console.log('  ❌ Rejected: 3 (Tests 3, 4, 5)');
    console.log('\nActual Results:');
    console.log(`  ✅ Approved: ${approvedCount}`);
    console.log(`  ❌ Rejected: ${rejectedCount}`);

    if (approvedCount === 3 && rejectedCount === 3) {
      console.log('\n🎉 ALL TESTS PASSED! Risk Manager is working correctly.\n');
    } else {
      console.log('\n⚠️  TEST MISMATCH - Check logs for details.\n');
    }

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Make sure Risk Manager is running on port 8086');
      console.error('   Run: cd risk-manager && npm run dev\n');
    }
  } finally {
    if (nc) {
      await nc.close();
      console.log('Disconnected from NATS');
    }
  }
}

async function publishSignal(signal) {
  nc.publish('strategy.signals.test', JSON.stringify(signal));
  console.log(`   Published: ${signal.symbol} ${signal.action} ${signal.quantity}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run tests
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
