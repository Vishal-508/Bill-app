require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Product, Customer, ShapeCuttingRate, CuttingChargeRule } = require('../src/models');
const pricingEngine = require('../src/utils/pricingEngine');
const logger = require('../src/config/logger');

const test = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    let pass = 0, fail = 0;
    const failures = [];

    const assert = (name, condition, detail = '') => {
      if (condition) {
        pass++;
        logger.info(`  ✅ ${name}`);
      } else {
        fail++;
        const msg = `${name}${detail ? ` — ${detail}` : ''}`;
        logger.error(`  ❌ ${msg}`);
        failures.push(msg);
      }
    };

    const rawSheet = await Product.findOne({ productType: 'RAW_SHEET', thicknessMM: 18 });
    const bundle = await Product.findOne({ productType: 'PRE_CUT_BUNDLE' });
    const customer = await Customer.findOne({ phone: '8000000001' });
    const rectangle = await ShapeCuttingRate.findByCode('RECTANGLE');
    const round = await ShapeCuttingRate.findByCode('ROUND');
    const perPieceRule = await CuttingChargeRule.findOne({ code: 'PER_PIECE_STD' });

    if (!rawSheet || !bundle || !customer || !rectangle || !round || !perPieceRule) {
      logger.error('Missing test data!');
      process.exit(1);
    }

    // ─── Test 1: FULL_SHEET ───
    logger.info('\nTest 1: FULL_SHEET pricing');
    const fullSheet = await pricingEngine.calculateLineItem({
      itemType: 'FULL_SHEET',
      product: rawSheet._id,
      quantity: 5,
    });
    const expectedFullSheet = rawSheet.basePrice * rawSheet.areaSqFt * 5;
    assert('Full sheet line total', Math.abs(fullSheet.lineSubtotal - expectedFullSheet) < 1,
           `Got ${fullSheet.lineSubtotal}, expected ~${expectedFullSheet}`);
    assert('No cutting charges on full sheets', fullSheet.cuttingCharges === 0);
    assert('No wastage on full sheets', fullSheet.wastageAreaSqFt === 0);

    // ─── Test 2: BUNDLE ───
    logger.info('\nTest 2: BUNDLE pricing');
    const bundleResult = await pricingEngine.calculateLineItem({
      itemType: 'BUNDLE',
      product: bundle._id,
      quantity: 2,
    });
    const expectedBundle = bundle.bundle.pricePerBundle * 2;
    assert('Bundle line total', bundleResult.lineSubtotal === expectedBundle,
           `Got ${bundleResult.lineSubtotal}, expected ${expectedBundle}`);

    // ─── Test 3: CUSTOM_CUT (rectangle) ───
    logger.info('\nTest 3: CUSTOM_CUT — Rectangle');
    const customRect = await pricingEngine.calculateLineItem({
      itemType: 'CUSTOM_CUT',
      fromRawSheet: rawSheet._id,
      dimensions: { lengthInches: 24, widthInches: 12 },
      shape: rectangle._id,
      cuttingRule: perPieceRule._id,
      quantity: 30,
    });
    assert('Rectangle cut sheets needed = 2',
           customRect.breakdown.sheetsNeeded === 2,
           `Got: ${customRect.breakdown.sheetsNeeded}`);
    assert('Rectangle cutting charge correct',
           Math.abs(customRect.cuttingCharges - 90) < 1,
           `Got: ${customRect.cuttingCharges}`);
    assert('Wastage tracked', customRect.wastageAreaSqFt > 0,
           `Got: ${customRect.wastageAreaSqFt}`);

    // ─── Test 4: CUSTOM_CUT (round) ───
    logger.info('\nTest 4: CUSTOM_CUT — Round (2.5x multiplier)');
    const customRound = await pricingEngine.calculateLineItem({
      itemType: 'CUSTOM_CUT',
      fromRawSheet: rawSheet._id,
      dimensions: { lengthInches: 24, widthInches: 12 },
      shape: round._id,
      cuttingRule: perPieceRule._id,
      quantity: 30,
    });
    assert('Round cutting charge = 2.5x rectangle',
           Math.abs(customRound.cuttingCharges - 225) < 1,
           `Got: ${customRound.cuttingCharges}`);

    // ─── Test 5: Full order calculation ───
    logger.info('\nTest 5: Complete order calculation');
    const orderPricing = await pricingEngine.calculateOrderTotal(
      [
        { itemType: 'FULL_SHEET', product: rawSheet._id, quantity: 2 },
        { itemType: 'BUNDLE', product: bundle._id, quantity: 1 },
        { itemType: 'CUSTOM_CUT', fromRawSheet: rawSheet._id,
          dimensions: { lengthInches: 24, widthInches: 12 },
          shape: rectangle._id, cuttingRule: perPieceRule._id, quantity: 10 },
      ],
      customer,
      { gstRatePct: 18, hasGstBill: true }
    );

    assert('3 items processed', orderPricing.items.length === 3);
    assert('Subtotal calculated', orderPricing.subtotal > 0);
    assert('GST calculated', orderPricing.totalGst > 0);
    assert('Total includes GST',
           Math.abs(orderPricing.totalAmount - (orderPricing.taxableAmount + orderPricing.totalGst)) < 1);

    // ─── Test 6: GST split ───
    logger.info('\nTest 6: GST split');
    if (customer.billingAddress?.state === 'Madhya Pradesh') {
      assert('Intra-state → CGST + SGST', orderPricing.isIntraState === true);
      assert('IGST = 0 for intra-state', orderPricing.igst === 0);
      assert('CGST = SGST', Math.abs(orderPricing.cgst - orderPricing.sgst) < 0.5);
    } else {
      logger.info('  (Customer not in MP — skipping intra-state check)');
    }

    // ─── Test 7: No GST mode ───
    logger.info('\nTest 7: No-GST mode');
    const noGstPricing = await pricingEngine.calculateOrderTotal(
      [{ itemType: 'FULL_SHEET', product: rawSheet._id, quantity: 1 }],
      customer,
      { hasGstBill: false }
    );
    assert('No-GST: totalGst = 0', noGstPricing.totalGst === 0);
    assert('No-GST: totalAmount = taxableAmount',
           noGstPricing.totalAmount === noGstPricing.taxableAmount);

    // ─── Test 8: Invalid input handling ───
    logger.info('\nTest 8: Error handling');
    try {
      await pricingEngine.calculateLineItem({
        itemType: 'CUSTOM_CUT',
        fromRawSheet: rawSheet._id,
        shape: rectangle._id,
        cuttingRule: perPieceRule._id,
        quantity: 10,
      });
      assert('Missing dimensions rejected', false, 'Should have thrown');
    } catch (error) {
      assert('Missing dimensions rejected', error.message.includes('dimensions'));
    }

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Pricing Engine Tests: ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    process.exit(1);
  }
};

test();
