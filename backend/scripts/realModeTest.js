require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const logger = require('../src/config/logger');

const BASE_URL = 'http://localhost:5000';
const BYPASS = process.env.TEST_BYPASS_SECRET;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-test-bypass-ratelimit': BYPASS },
  validateStatus: () => true,
});

async function setup() {
  logger.info('═══ Real Mode E2E Test Setup ═══');

  if (!RAZORPAY_KEY_ID || RAZORPAY_KEY_ID.includes('PLACEHOLDER')) {
    logger.error('❌ RAZORPAY_KEY_ID is still placeholder. Update .env first.');
    process.exit(1);
  }
  logger.info(`✅ Razorpay Key ID: ${RAZORPAY_KEY_ID.slice(0, 15)}...`);

  logger.info('🔐 Logging in as testadmin...');
  const loginRes = await api.post('/api/auth/login', {
    email: 'testadmin@shreegopal.com',
    password: 'TestAdmin@123',
  });

  if (loginRes.status !== 200) {
    logger.error('❌ Login failed:', loginRes.data);
    process.exit(1);
  }
  const token = loginRes.data.accessToken;
  logger.info(`✅ Logged in (token: ${token.length} chars)`);

  logger.info('📦 Fetching test order...');
  const orderRes = await api.get('/api/orders?limit=1', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const testOrder = orderRes.data.data?.[0];
  if (!testOrder) {
    logger.error('❌ No orders found. Create one first.');
    process.exit(1);
  }
  logger.info(`✅ Test order: ${testOrder.orderNumber} (${testOrder._id})`);

  logger.info('💳 Initiating real payment...');
  const payRes = await api.post('/api/payments/initiate', {
    order: testOrder._id,
    amount: 1,
    notes: 'REAL_E2E_TEST',
  }, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (payRes.status !== 201) {
    logger.error('❌ Payment initiation failed:', payRes.data);
    process.exit(1);
  }

  const { paymentId, paymentReference, razorpayOrderId, amount, isMock } = payRes.data.data;

  if (isMock) {
    logger.error('❌ Still in mock mode! Check .env and restart backend.');
    process.exit(1);
  }

  logger.info(`✅ Real Razorpay order created:`);
  logger.info(`   Payment Ref: ${paymentReference}`);
  logger.info(`   Razorpay Order: ${razorpayOrderId}`);
  logger.info(`   Amount: ${amount} paise (₹${amount / 100})`);
  logger.info(`   isMock: ${isMock}`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Razorpay Real Mode E2E Test</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .card {
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 { color: #2c3e50; }
    .details {
      background: #ecf0f1;
      padding: 15px;
      border-radius: 4px;
      margin: 20px 0;
      font-family: monospace;
      font-size: 12px;
    }
    button {
      background: #27ae60;
      color: white;
      border: none;
      padding: 15px 30px;
      font-size: 16px;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover { background: #229954; }
    .instructions {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 10px 15px;
      margin: 20px 0;
    }
    .success { color: #27ae60; }
    .fail { color: #c0392b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🧪 Razorpay Real Mode E2E Test</h1>

    <div class="details">
      <strong>Payment Reference:</strong> ${paymentReference}<br>
      <strong>Razorpay Order ID:</strong> ${razorpayOrderId}<br>
      <strong>Amount:</strong> ₹${amount / 100}<br>
      <strong>Mode:</strong> ${isMock ? 'MOCK' : 'REAL'}<br>
    </div>

    <div class="instructions">
      <strong>Test Instructions:</strong><br>
      1. Click "Pay ₹1" button<br>
      2. Razorpay checkout will open<br>
      3. Select "UPI" payment method<br>
      4. Enter UPI ID: <code>success@razorpay</code><br>
      5. Click "Verify and Pay"<br>
      6. Test payment will succeed instantly (no real money)<br>
      7. Webhook will fire to your backend automatically
    </div>

    <button id="pay-btn">Pay ₹1 (Test)</button>

    <div id="result" style="margin-top: 20px;"></div>
  </div>

  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <script>
    document.getElementById('pay-btn').onclick = function() {
      var options = {
        "key": "${RAZORPAY_KEY_ID}",
        "amount": ${amount},
        "currency": "INR",
        "name": "Shree Gopal MDF",
        "description": "Real Mode E2E Test - ${paymentReference}",
        "order_id": "${razorpayOrderId}",
        "handler": function (response) {
          document.getElementById('result').innerHTML =
            '<div class="success"><h3>✅ Payment Successful!</h3>' +
            '<div class="details">' +
            '<strong>Payment ID:</strong> ' + response.razorpay_payment_id + '<br>' +
            '<strong>Order ID:</strong> ' + response.razorpay_order_id + '<br>' +
            '<strong>Signature:</strong> ' + response.razorpay_signature.slice(0, 30) + '...<br>' +
            '</div>' +
            '<p>Webhook should fire to backend within seconds. Check audit trail.</p></div>';
          console.log('Payment response:', response);
        },
        "modal": {
          "ondismiss": function() {
            document.getElementById('result').innerHTML =
              '<div class="fail"><h3>⚠️ Payment Cancelled</h3>' +
              '<p>You closed the checkout without completing payment.</p></div>';
          }
        },
        "theme": {
          "color": "#27ae60"
        }
      };
      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function (response) {
        document.getElementById('result').innerHTML =
          '<div class="fail"><h3>❌ Payment Failed</h3>' +
          '<pre>' + JSON.stringify(response.error, null, 2) + '</pre></div>';
      });
      rzp.open();
    };
  </script>
</body>
</html>`;

  const htmlPath = path.join(__dirname, '..', 'storage', 'test-checkout.html');
  await fs.mkdir(path.dirname(htmlPath), { recursive: true });
  await fs.writeFile(htmlPath, html);

  logger.info(`\n✅ Test checkout page created:`);
  logger.info(`   File: ${htmlPath}`);
  logger.info(`\n📋 NEXT STEPS:`);
  logger.info(`   1. Open file:// path above in browser`);
  logger.info(`   2. Click "Pay ₹1" button`);
  logger.info(`   3. Razorpay checkout opens`);
  logger.info(`   4. Select UPI, enter: success@razorpay`);
  logger.info(`   5. Click "Verify and Pay"`);
  logger.info(`   6. Payment succeeds (test mode)`);
  logger.info(`   7. Webhook fires to backend`);
  logger.info(`\n📊 Monitor:`);
  logger.info(`   - Backend logs (Window 2 CMD)`);
  logger.info(`   - ngrok inspector: http://127.0.0.1:4040`);
  logger.info(`   - Audit trail: GET /api/webhooks/events`);
  logger.info(`\n💾 Payment ID for tracking: ${paymentId}`);
  logger.info(`💾 Razorpay Order ID: ${razorpayOrderId}`);
}

setup().catch(err => {
  logger.error('Setup failed:', err.message);
  process.exit(1);
});
