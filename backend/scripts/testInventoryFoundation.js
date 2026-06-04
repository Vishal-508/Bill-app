require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const { Vendor, Purchase, Product, StockMovement } = require('../src/models');
const { generatePurchaseNumber } = require('../src/utils/purchaseNumberGenerator');
const { getFinancialYear } = require('../src/utils/orderNumberGenerator');

const TAG = 'INV_A_TEST';

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

  const seededIds = { vendors: [], purchases: [], products: [] };

  const cleanup = async () => {
    await Purchase.deleteMany({ _id: { $in: seededIds.purchases } });
    await Vendor.deleteMany({ _id: { $in: seededIds.vendors } });
    // Restore forecastData on any products we touched
    if (seededIds.products.length) {
      await Product.updateMany(
        { _id: { $in: seededIds.products } },
        { $unset: { forecastData: '' } }
      );
    }
  };

  try {
    logger.info('\n═══ SECTION A — Inventory Foundation Smoke Test ═══');

    // ─── Nostradamus library available ───
    logger.info('\n1. Library install verification');
    const nostradamus = require('nostradamus');
    assert('nostradamus module loads', typeof nostradamus === 'function');
    assert('nostradamus.memo exists', typeof nostradamus.memo === 'function');
    // Mini smoke test: forecast 4 quarters from a simple seasonal series
    const sample = [10, 20, 30, 40, 11, 21, 31, 41, 12, 22, 32, 42];
    const preds = nostradamus(sample, 0.5, 0.4, 0.6, 4, 4);
    assert('nostradamus returns array with data.length + m entries',
      Array.isArray(preds) && preds.length === sample.length + 4,
      `Got ${preds?.length}`);

    // ─── Vendor model ───
    logger.info('\n2. Vendor model');
    const vendor = await Vendor.create({
      name: `${TAG} Test Vendor`,
      companyName: `${TAG} Vendor Pvt Ltd`,
      phone: '9876500001',
      email: 'test-vendor@inv-a.test',
      gstin: '23XAAAA0000A1Z9',
      address: {
        line1: 'Test Plot 1',
        city: 'Indore',
        state: 'Madhya Pradesh',
        stateCode: '23',
        pincode: '452001',
      },
      avgLeadTimeDays: 8,
      paymentTerms: 'Net 30',
    });
    seededIds.vendors.push(vendor._id);
    assert('Vendor created', vendor._id != null);
    assert('Vendor isActive defaults true', vendor.isActive === true);
    assert('Vendor isDeleted defaults false', vendor.isDeleted === false);
    assert('Vendor address sub-doc persisted', vendor.address?.city === 'Indore');

    // Validation: bad GSTIN
    logger.info('\n3. Vendor validation');
    let badVendor;
    try {
      badVendor = await Vendor.create({ name: 'BadGstinVendor', gstin: 'NOT-VALID' });
    } catch (e) {
      // expected
    }
    assert('Invalid GSTIN rejected', badVendor == null);

    // Bad pincode
    let badPincode;
    try {
      badPincode = await Vendor.create({
        name: 'BadPincode',
        address: { pincode: '0001' },
      });
    } catch (e) {
      // expected
    }
    assert('Invalid pincode rejected', badPincode == null);

    // Bad phone
    let badPhone;
    try {
      badPhone = await Vendor.create({ name: 'BadPhone', phone: '1234567890' });
    } catch (e) {
      // expected
    }
    assert('Invalid phone rejected (must start 6-9)', badPhone == null);

    // Soft delete
    logger.info('\n4. Vendor soft-delete + restore');
    await vendor.softDelete();
    const afterDelete = await Vendor.findById(vendor._id);
    assert('Vendor soft-deleted (isDeleted=true)', afterDelete.isDeleted === true);
    assert('Vendor inactive after delete', afterDelete.isActive === false);
    assert('Vendor deletedAt set', afterDelete.deletedAt != null);
    await afterDelete.restore();
    const afterRestore = await Vendor.findById(vendor._id);
    assert('Vendor restored (isDeleted=false)', afterRestore.isDeleted === false);
    assert('Vendor active after restore', afterRestore.isActive === true);

    // ─── Purchase numbering ───
    logger.info('\n5. Purchase number generator');
    const num1 = await generatePurchaseNumber();
    const fy = getFinancialYear();
    assert(`Purchase number format PO-${fy}-NNNNN`,
      new RegExp(`^PO-${fy}-\\d{5}$`).test(num1),
      `Got ${num1}`);

    // Find a product to use in PO items
    const product = await Product.findOne({ isDeleted: false }).lean();
    assert('Product fixture found', product != null);

    if (!product) {
      throw new Error('No products in DB — cannot continue Purchase tests');
    }

    // ─── Purchase model ───
    logger.info('\n6. Purchase model');
    const po = await Purchase.create({
      vendor: vendor._id,
      vendorSnapshot: {
        name: vendor.name,
        companyName: vendor.companyName,
        gstin: vendor.gstin,
      },
      items: [{
        product: product._id,
        productSnapshot: {
          sku: product.sku,
          name: product.name,
          productType: product.productType,
          thicknessMM: product.thicknessMM,
          sizeDisplay: `${product.lengthFT}x${product.widthFT}`,
        },
        quantity: 50,
        ratePerSheet: 600,
        totalAmount: 50 * 600,
      }],
      notes: TAG,
    });
    seededIds.purchases.push(po._id);
    assert('Purchase created', po._id != null);
    assert('purchaseNo auto-generated', po.purchaseNo?.startsWith(`PO-${fy}-`),
      `Got ${po.purchaseNo}`);
    assert('Purchase status defaults to DRAFT', po.status === 'DRAFT');
    assert('Purchase subTotal computed from items',
      po.subTotal === 30000, `Got ${po.subTotal}`);
    assert('Purchase GST computed at 18% default',
      po.gstAmount === 5400, `Got ${po.gstAmount}`);
    assert('Purchase grandTotal = subTotal + GST',
      po.grandTotal === 35400, `Got ${po.grandTotal}`);
    assert('Purchase fiscalYear set', po.fiscalYear === fy);
    assert('Purchase paymentStatus defaults UNPAID', po.paymentStatus === 'UNPAID');

    // Sequential numbering
    const po2 = await Purchase.create({
      vendor: vendor._id,
      items: [{
        product: product._id,
        quantity: 10,
        ratePerSheet: 700,
        totalAmount: 7000,
      }],
      notes: TAG,
    });
    seededIds.purchases.push(po2._id);
    const seq1 = parseInt(po.purchaseNo.match(/(\d+)$/)[1], 10);
    const seq2 = parseInt(po2.purchaseNo.match(/(\d+)$/)[1], 10);
    assert('Second PO has sequential number',
      seq2 === seq1 + 1, `${po.purchaseNo} → ${po2.purchaseNo}`);

    // Validation: empty items rejected
    logger.info('\n7. Purchase validation');
    let badPO;
    try {
      badPO = await Purchase.create({ vendor: vendor._id, items: [] });
    } catch (e) {
      // expected
    }
    assert('Purchase with empty items rejected', badPO == null);

    // ─── Product.forecastData extension ───
    logger.info('\n8. Product.forecastData embedded sub-doc');
    seededIds.products.push(product._id);
    const productDoc = await Product.findById(product._id);
    // Initialize forecastData with synthetic values
    productDoc.forecastData = {
      last30Days: 120,
      last90Days: 350,
      last365Days: 1400,
      avgMonthly: 117,
      avgWeekly: 27,
      peakMonths: ['Oct', 'Nov'],
      lastForecast: {
        next30days: 130,
        next90days: 380,
        next180days: 760,
        method: 'holt-winters',
        mape: 8.5,
        computedAt: new Date(),
      },
      lastComputedAt: new Date(),
    };
    await productDoc.save();

    const reloaded = await Product.findById(product._id).lean();
    assert('forecastData.last30Days persisted', reloaded.forecastData?.last30Days === 120);
    assert('forecastData.lastForecast.method persisted',
      reloaded.forecastData?.lastForecast?.method === 'holt-winters');
    assert('forecastData.lastForecast.mape persisted',
      reloaded.forecastData?.lastForecast?.mape === 8.5);
    assert('forecastData.peakMonths array persisted',
      Array.isArray(reloaded.forecastData?.peakMonths) &&
      reloaded.forecastData.peakMonths.length === 2);

    // Method enum validation
    logger.info('\n9. forecastData method enum validation');
    productDoc.forecastData.lastForecast.method = 'invalid-method';
    let methodErr;
    try {
      await productDoc.save();
    } catch (e) {
      methodErr = e;
    }
    assert('Invalid forecast method rejected', methodErr != null);
    // Restore valid method
    productDoc.forecastData.lastForecast.method = 'naive';
    await productDoc.save();

    // ─── models/index.js exports ───
    logger.info('\n10. models/index.js exports Vendor + Purchase');
    const models = require('../src/models');
    assert('models.Vendor exported', models.Vendor === Vendor);
    assert('models.Purchase exported', models.Purchase === Purchase);

    // ─── Existing models preserved (regression check) ───
    logger.info('\n11. Existing models preserved (regression)');
    assert('StockMovement unchanged enum',
      StockMovement.schema.path('movementType').enumValues.join(',') ===
      'DEDUCTION,RESTORATION,MANUAL_ADJUSTMENT,RESTOCK,CORRECTION');
    assert('Product.currentStock field still exists',
      Product.schema.path('currentStock') != null);
    assert('Product.minStockAlert field still exists',
      Product.schema.path('minStockAlert') != null);

    // ─── Indexes verified ───
    logger.info('\n12. Indexes registered');
    const vIndexes = Vendor.schema.indexes();
    const pIndexes = Purchase.schema.indexes();
    assert('Vendor has gstin unique sparse index',
      vIndexes.some(([keys, opts]) => keys.gstin === 1 && opts.unique && opts.sparse));
    assert('Purchase has vendor+createdAt compound index',
      pIndexes.some(([keys]) => keys.vendor === 1 && keys.createdAt === -1));

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await cleanup();
    logger.info('  Seeded vendors + purchases deleted; product forecastData unset');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Inventory Foundation (Section A): ${pass}/${pass + fail} passed`);
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
