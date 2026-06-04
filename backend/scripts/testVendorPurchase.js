require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const { Vendor, Purchase, Product, StockMovement, User } = require('../src/models');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const BYPASS = process.env.TEST_BYPASS_SECRET;

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-test-bypass-ratelimit': BYPASS },
  validateStatus: () => true,
});

const TAG = 'VENDOR_PURCHASE_TEST';

const test = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  let pass = 0, fail = 0;
  const failures = [];

  const assert = (name, condition, detail = '') => {
    if (condition) { pass++; logger.info(`  ✅ ${name}`); }
    else {
      fail++;
      logger.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
      failures.push(name);
    }
  };

  let billingUserId;
  const seededVendorIds = [];
  const seededPurchaseIds = [];
  const touchedProductIds = new Set();
  const productStockSnapshots = new Map();

  const cleanup = async () => {
    // Restore product stock + lastRestockedAt to original
    for (const [pid, snap] of productStockSnapshots.entries()) {
      await Product.updateOne({ _id: pid }, {
        $set: { currentStock: snap.currentStock, lastRestockedAt: snap.lastRestockedAt },
      });
    }
    // Delete stock movements linked to test purchases
    await StockMovement.deleteMany({ reason: { $regex: `^PO PO-` } });
    await Purchase.deleteMany({ _id: { $in: seededPurchaseIds } });
    await Vendor.deleteMany({ _id: { $in: seededVendorIds } });
    if (billingUserId) await User.deleteOne({ _id: billingUserId });
  };

  try {
    logger.info('\n═══ SECTION E — Vendor + Purchase CRUD Smoke Test ═══');

    // ─── Setup ───
    logger.info('\nSetup: Auth + fixtures');
    const loginRes = await api.post('/api/auth/login', {
      email: 'testadmin@shreegopal.com',
      password: 'TestAdmin@123',
    });
    assert('Admin login (200)', loginRes.status === 200);
    const h = { Authorization: `Bearer ${loginRes.data.accessToken}` };

    const billingEmail = `billing-${TAG.toLowerCase()}@e.test`;
    await User.deleteMany({ email: billingEmail });
    const billingUser = await User.create({
      name: 'BILLING Vendor Test',
      email: billingEmail,
      password: 'BillingE@123',
      role: 'BILLING',
      isActive: true,
    });
    billingUserId = billingUser._id;
    const bLogin = await api.post('/api/auth/login', { email: billingEmail, password: 'BillingE@123' });
    assert('BILLING login (200)', bLogin.status === 200);
    const bh = { Authorization: `Bearer ${bLogin.data.accessToken}` };

    // 3 products; snapshot their stock so we can restore
    const products = await Product.find({
      productType: 'RAW_SHEET', isDeleted: false,
    }).select('_id sku name currentStock lastRestockedAt').limit(3).lean();
    assert('At least 3 RAW_SHEET products', products.length >= 3);
    const [prodA, prodB, prodC] = products;
    for (const p of products) {
      productStockSnapshots.set(String(p._id), {
        currentStock: p.currentStock || 0,
        lastRestockedAt: p.lastRestockedAt,
      });
      touchedProductIds.add(String(p._id));
    }
    // Reset all three to 0 for clean stock-tracking assertions
    await Product.updateMany(
      { _id: { $in: products.map(p => p._id) } },
      { $set: { currentStock: 0 } }
    );

    // ═══════════════════════════════════════════════
    // Vendor CRUD (8 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Vendor CRUD ---');

    logger.info('\nT1: POST /vendors → 201');
    let res = await api.post('/api/vendors', {
      name: `${TAG} Vendor`,
      companyName: 'Test Vendor Pvt Ltd',
      phone: '9876500099',
      email: 'vendor@e.test',
      gstin: '23TESTV0001V1Z2',
      address: { line1: 'Test St', city: 'Indore', state: 'MP', stateCode: '23', pincode: '452001' },
      avgLeadTimeDays: 7,
      paymentTerms: 'Net 30',
    }, { headers: h });
    assert('Create vendor → 201', res.status === 201, `Got ${res.status} body=${JSON.stringify(res.data).slice(0,150)}`);
    const vendor1 = res.data.data;
    seededVendorIds.push(vendor1._id);

    logger.info('\nT2: GET /vendors → paginated list');
    res = await api.get('/api/vendors?limit=50', { headers: h });
    assert('List → 200', res.status === 200);
    assert('Pagination present', res.data.pagination?.total != null);
    assert('Our vendor in list', res.data.data.some(v => v._id === vendor1._id));

    logger.info('\nT3: GET /vendors/:id → detail with stats');
    res = await api.get(`/api/vendors/${vendor1._id}`, { headers: h });
    assert('Detail → 200', res.status === 200);
    assert('Has stats object', res.data.data?.stats?.totalPurchases === 0);

    logger.info('\nT4: PATCH /vendors/:id → updated');
    res = await api.patch(`/api/vendors/${vendor1._id}`, {
      notes: 'Updated notes from test',
      avgLeadTimeDays: 10,
    }, { headers: h });
    assert('Patch → 200', res.status === 200);
    assert('Notes updated', res.data.data?.notes === 'Updated notes from test');
    assert('avgLeadTimeDays updated', res.data.data?.avgLeadTimeDays === 10);

    logger.info('\nT5: PATCH GSTIN change → 400 (immutable)');
    res = await api.patch(`/api/vendors/${vendor1._id}`, {
      gstin: '23TESTV9999V1Z9',
    }, { headers: h });
    assert('GSTIN change → 400', res.status === 400, `Got ${res.status}`);

    logger.info('\nT6: DELETE /vendors/:id → soft delete');
    res = await api.delete(`/api/vendors/${vendor1._id}`, { headers: h });
    assert('Delete → 200', res.status === 200);
    const deletedCheck = await Vendor.findById(vendor1._id);
    assert('isDeleted=true', deletedCheck.isDeleted === true);
    assert('isActive=false after soft delete', deletedCheck.isActive === false);

    logger.info('\nT7: POST /vendors/:id/restore → restored');
    res = await api.post(`/api/vendors/${vendor1._id}/restore`, {}, { headers: h });
    assert('Restore → 200', res.status === 200);
    const restoredCheck = await Vendor.findById(vendor1._id);
    assert('isDeleted=false after restore', restoredCheck.isDeleted === false);
    assert('isActive=true after restore', restoredCheck.isActive === true);

    // ═══════════════════════════════════════════════
    // Purchase Order Lifecycle (10 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Purchase Order Lifecycle ---');

    logger.info('\nT8: POST /purchases (DRAFT) → 201 with auto-computed totals');
    res = await api.post('/api/purchases', {
      vendorId: vendor1._id,
      items: [
        { productId: prodA._id, quantity: 50, ratePerSheet: 600 },
        { productId: prodB._id, quantity: 25, ratePerSheet: 400 },
      ],
      gstRatePct: 18,
      notes: TAG,
    }, { headers: h });
    assert('Create PO → 201', res.status === 201, `Got ${res.status}`);
    const po1 = res.data.data;
    seededPurchaseIds.push(po1._id);
    assert('Status defaults DRAFT', po1.status === 'DRAFT');
    assert('subTotal = 50*600 + 25*400 = 40000', po1.subTotal === 40000,
      `Got ${po1.subTotal}`);
    assert('GST = 18% of 40000 = 7200', po1.gstAmount === 7200);
    assert('grandTotal = 47200', po1.grandTotal === 47200);
    assert('purchaseNo auto-generated PO-YY-YY-NNNNN',
      /^PO-\d{4}-\d{2}-\d{5}$/.test(po1.purchaseNo), `Got ${po1.purchaseNo}`);

    logger.info('\nT9: PATCH /purchases/:id on DRAFT → updated');
    res = await api.patch(`/api/purchases/${po1._id}`, {
      items: [
        { productId: prodA._id, quantity: 60, ratePerSheet: 600 },
        { productId: prodB._id, quantity: 25, ratePerSheet: 400 },
      ],
    }, { headers: h });
    assert('Patch DRAFT → 200', res.status === 200);
    assert('Updated subTotal = 60*600 + 25*400 = 46000',
      res.data.data?.subTotal === 46000,
      `Got ${res.data.data?.subTotal}`);

    logger.info('\nT10: POST /:id/order → 200 + status=ORDERED');
    res = await api.post(`/api/purchases/${po1._id}/order`, {}, { headers: h });
    assert('Mark ordered → 200', res.status === 200);
    assert('Status = ORDERED', res.data.data?.status === 'ORDERED');
    assert('orderedAt timestamp set', res.data.data?.orderedAt != null);

    logger.info('\nT11: PATCH non-DRAFT → 409');
    res = await api.patch(`/api/purchases/${po1._id}`, { notes: 'should fail' }, { headers: h });
    assert('Patch ORDERED → 409', res.status === 409, `Got ${res.status}`);

    logger.info('\nT12: Order on already-ORDERED → 409');
    res = await api.post(`/api/purchases/${po1._id}/order`, {}, { headers: h });
    assert('Order on ORDERED → 409', res.status === 409);

    logger.info('\nT13: Receive (full) → 200 + status=RECEIVED');
    // capture pre-receive stock
    const prodAPre = await Product.findById(prodA._id).select('currentStock').lean();
    const prodBPre = await Product.findById(prodB._id).select('currentStock').lean();
    res = await api.post(`/api/purchases/${po1._id}/receive`, {
      items: [
        { productId: prodA._id, receivedQuantity: 60 },
        { productId: prodB._id, receivedQuantity: 25 },
      ],
      invoiceNo: 'VENDOR-INV-001',
    }, { headers: h });
    assert('Receive → 200', res.status === 200, `Got ${res.status} body=${JSON.stringify(res.data).slice(0,200)}`);
    assert('Status = RECEIVED', res.data.data?.purchase?.status === 'RECEIVED',
      `Got ${res.data.data?.purchase?.status}`);
    assert('invoiceNo recorded', res.data.data?.purchase?.invoiceNo === 'VENDOR-INV-001');

    logger.info('\nT14: Stock updated (Product.currentStock += quantity)');
    const prodAPost = await Product.findById(prodA._id).select('currentStock lastRestockedAt').lean();
    const prodBPost = await Product.findById(prodB._id).select('currentStock').lean();
    assert(`Product A stock: ${prodAPre.currentStock} → ${prodAPost.currentStock} (expected +60)`,
      prodAPost.currentStock === (prodAPre.currentStock || 0) + 60);
    assert(`Product B stock: ${prodBPre.currentStock} → ${prodBPost.currentStock} (expected +25)`,
      prodBPost.currentStock === (prodBPre.currentStock || 0) + 25);
    assert('lastRestockedAt updated', prodAPost.lastRestockedAt != null);

    logger.info('\nT15: StockMovement created (type=RESTOCK)');
    const movementsForA = await StockMovement.find({
      product: prodA._id,
      reason: { $regex: po1.purchaseNo },
    }).lean();
    assert('1 movement created for product A',
      movementsForA.length === 1, `Got ${movementsForA.length}`);
    const movA = movementsForA[0];
    assert('movementType=RESTOCK (existing enum, not new)',
      movA.movementType === 'RESTOCK');
    assert('quantityChange=+60', movA.quantityChange === 60);
    assert(`quantityAfter=quantityBefore+60: ${movA.quantityBefore}+60=${movA.quantityAfter}`,
      movA.quantityAfter === movA.quantityBefore + 60);
    assert('performedBy set', movA.performedBy != null);

    logger.info('\nT16: Partial receive (new PO) → status=PARTIAL_RECEIVED');
    // Create + order a new PO
    res = await api.post('/api/purchases', {
      vendorId: vendor1._id,
      items: [
        { productId: prodC._id, quantity: 100, ratePerSheet: 500 },
      ],
      notes: TAG,
    }, { headers: h });
    const po2 = res.data.data;
    seededPurchaseIds.push(po2._id);
    await api.post(`/api/purchases/${po2._id}/order`, {}, { headers: h });
    // Receive only 40 of 100
    res = await api.post(`/api/purchases/${po2._id}/receive`, {
      items: [{ productId: prodC._id, receivedQuantity: 40 }],
    }, { headers: h });
    assert('Partial receive → 200', res.status === 200);
    assert('Status = PARTIAL_RECEIVED',
      res.data.data?.purchase?.status === 'PARTIAL_RECEIVED',
      `Got ${res.data.data?.purchase?.status}`);
    // Verify the per-item receivedQuantity is tracked
    const po2Reload = await Purchase.findById(po2._id).lean();
    assert('Item receivedQuantity=40 tracked',
      po2Reload.items[0].receivedQuantity === 40,
      `Got ${po2Reload.items[0].receivedQuantity}`);

    logger.info('\nT17: Cancel PO → 200 + status=CANCELLED');
    res = await api.post(`/api/purchases/${po2._id}/cancel`, {
      reason: 'Vendor unable to deliver remainder',
    }, { headers: h });
    assert('Cancel → 200', res.status === 200);
    assert('Status = CANCELLED', res.data.data?.status === 'CANCELLED');
    assert('cancelledAt set', res.data.data?.cancelledAt != null);
    assert('cancellationReason set',
      res.data.data?.cancellationReason === 'Vendor unable to deliver remainder');

    logger.info('\nT18: DELETE vendor blocked when active PO exists');
    // Create an active PO for vendor1
    res = await api.post('/api/purchases', {
      vendorId: vendor1._id,
      items: [{ productId: prodA._id, quantity: 5, ratePerSheet: 600 }],
      notes: TAG,
    }, { headers: h });
    const blockingPO = res.data.data;
    seededPurchaseIds.push(blockingPO._id);
    await api.post(`/api/purchases/${blockingPO._id}/order`, {}, { headers: h }); // status=ORDERED
    // Now try to delete vendor
    res = await api.delete(`/api/vendors/${vendor1._id}`, { headers: h });
    assert('Delete blocked → 409', res.status === 409, `Got ${res.status}`);
    // Cancel the blocking PO so cleanup works
    await api.post(`/api/purchases/${blockingPO._id}/cancel`, { reason: 'cleanup' }, { headers: h });

    // ═══════════════════════════════════════════════
    // Filters & Search (3 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Filters ---');

    logger.info('\nT19: GET /purchases filter status=CANCELLED');
    res = await api.get('/api/purchases?status=CANCELLED&limit=50', { headers: h });
    assert('Status filter 200', res.status === 200);
    assert('All results CANCELLED',
      res.data.data.every(p => p.status === 'CANCELLED'));

    logger.info('\nT20: GET /purchases filter by vendor');
    res = await api.get(`/api/purchases?vendorId=${vendor1._id}&limit=50`, { headers: h });
    assert('Vendor filter 200', res.status === 200);
    assert('All results for vendor1',
      res.data.data.every(p => String(p.vendor?._id || p.vendor) === String(vendor1._id)));

    logger.info('\nT21: GET /purchases search by purchaseNo');
    res = await api.get(`/api/purchases?search=${encodeURIComponent(po1.purchaseNo)}`,
      { headers: h });
    assert('Search 200', res.status === 200);
    assert('po1 found in search', res.data.data.some(p => p._id === po1._id));

    logger.info('\nT22: GET /purchases/stats → dashboard shape');
    res = await api.get('/api/purchases/stats', { headers: h });
    assert('Stats 200', res.status === 200, `Got ${res.status}`);
    assert('Has activeCount + pendingValue + thisMonth + topVendor keys',
      'activeCount' in res.data.data &&
      'pendingValue' in res.data.data &&
      'thisMonth' in res.data.data &&
      'topVendor' in res.data.data);

    // ═══════════════════════════════════════════════
    // RBAC (1 test)
    // ═══════════════════════════════════════════════
    logger.info('\nT23: BILLING → 403 on POST/PATCH/DELETE');
    let r403 = await api.post('/api/vendors', { name: 'Block' }, { headers: bh });
    assert('BILLING POST /vendors → 403', r403.status === 403);
    r403 = await api.patch(`/api/vendors/${vendor1._id}`, { notes: 'x' }, { headers: bh });
    assert('BILLING PATCH /vendors → 403', r403.status === 403);
    r403 = await api.post('/api/purchases', { vendorId: vendor1._id, items: [] }, { headers: bh });
    assert('BILLING POST /purchases → 403', r403.status === 403);

    // ═══════════════════════════════════════════════
    // Edge cases (2 tests)
    // ═══════════════════════════════════════════════
    logger.info('\nT24: Non-existent product in items → 400');
    const fakeProdId = new mongoose.Types.ObjectId();
    res = await api.post('/api/purchases', {
      vendorId: vendor1._id,
      items: [{ productId: fakeProdId, quantity: 1, ratePerSheet: 100 }],
    }, { headers: h });
    assert('Non-existent product → 400', res.status === 400, `Got ${res.status}`);

    logger.info('\nT25: Inactive vendor → 400 on create');
    // Soft-deactivate vendor temporarily
    await Vendor.updateOne({ _id: vendor1._id }, { $set: { isActive: false } });
    res = await api.post('/api/purchases', {
      vendorId: vendor1._id,
      items: [{ productId: prodA._id, quantity: 1, ratePerSheet: 100 }],
    }, { headers: h });
    assert('Inactive vendor → 400', res.status === 400, `Got ${res.status}`);
    // Restore
    await Vendor.updateOne({ _id: vendor1._id }, { $set: { isActive: true } });

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await cleanup();
    logger.info('  Test vendors, purchases, stock movements deleted; product stock restored');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Vendor + Purchase CRUD (Section E): ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }
    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    try { await cleanup(); } catch {}
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
};

test();
