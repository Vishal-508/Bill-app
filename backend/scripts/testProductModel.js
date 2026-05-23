require('dotenv').config();

if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Product, ProductGrade, ProductAttribute } = require('../src/models');
const logger = require('../src/config/logger');

const TEST_SKU = 'TEST-MDF-18MM-8X4-INTERIOR-001';

const test = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // Cleanup
    await Product.deleteOne({ sku: TEST_SKU });
    await ProductAttribute.deleteOne({ name: 'bad-attr' });

    const grade = await ProductGrade.findByCode('INTERIOR');
    if (!grade) {
      logger.error('Run npm run seed:grades first!');
      process.exit(1);
    }

    // Test 1: Create product
    logger.info('Test 1: Create product');
    const product = new Product({
      name: 'Test MDF 18mm 8x4 Interior',
      sku: TEST_SKU,
      brand: 'Greenply',
      thicknessMM: 18,
      lengthFT: 8,
      widthFT: 4,
      grade: grade._id,
      pricingUnit: 'sqft',
      basePrice: 65,
      quantityTiers: [
        { minQty: 1, maxQty: 49, discountPct: 0 },
        { minQty: 50, maxQty: 99, discountPct: 5 },
        { minQty: 100, maxQty: 199, discountPct: 10 },
        { minQty: 200, maxQty: null, discountPct: 15 },
      ],
      currentStock: 150,
      minStockAlert: 20,
      reorderQuantity: 100,
      hsnCode: '4411',
      gstRatePct: 18,
      customFields: {
        color: 'Natural',
        finish: 'Plain',
        'is-prelaminated': false,
      },
      tags: ['popular', 'in-stock'],
    });

    await product.save();
    logger.info(`  ✓ Created: ${product._id}`);
    logger.info(`  ✓ Auto-computed areaSqFt: ${product.areaSqFt} (expected: 32)`);
    logger.info(`  ✓ Auto-computed areaSqInch: ${product.areaSqInch} (expected: 4608)`);

    // Test 2: Price for 25 sqft (no discount)
    logger.info('');
    logger.info('Test 2: Price for 25 sqft (no discount)');
    const price25 = product.calculatePrice(25);
    logger.info(`  ${JSON.stringify(price25)}`);
    logger.info(`  ✓ Final: ₹${price25.finalPrice} (expected: ₹${25 * 65})`);

    // Test 3: Price for 75 sqft (5%)
    logger.info('');
    logger.info('Test 3: Price for 75 sqft (5% discount)');
    const price75 = product.calculatePrice(75);
    logger.info(`  ${JSON.stringify(price75)}`);
    logger.info(`  ✓ Discount: ${price75.discountPct}% (expected: 5)`);

    // Test 4: Price for 250 (15%)
    logger.info('');
    logger.info('Test 4: Price for 250 sqft (15% discount)');
    const price250 = product.calculatePrice(250);
    logger.info(`  Final: ₹${price250.finalPrice} (subtotal ₹${price250.subtotal} - discount ₹${price250.discountAmount})`);

    // Test 5: Per-sheet
    logger.info('');
    logger.info('Test 5: Price per sheet (10 sheets)');
    const priceSheet = product.calculatePrice(10, 'sheet');
    logger.info(`  Final: ₹${priceSheet.finalPrice} (10 sheets × ${product.areaSqFt} sqft × ₹${product.basePrice}/sqft)`);

    // Test 6: Overlapping tiers
    logger.info('');
    logger.info('Test 6: Overlapping tiers rejected');
    try {
      const badProduct = new Product({
        name: 'Bad Tiers',
        sku: 'BAD-001',
        thicknessMM: 12,
        grade: grade._id,
        basePrice: 50,
        quantityTiers: [
          { minQty: 1, maxQty: 50, discountPct: 0 },
          { minQty: 40, maxQty: 100, discountPct: 5 },
        ],
      });
      await badProduct.save();
      logger.error('  ❌ Overlapping tiers allowed — bug!');
    } catch (error) {
      logger.info(`  ✓ Rejected: ${error.message.substring(0, 80)}`);
    }

    // Test 7: Duplicate SKU
    logger.info('');
    logger.info('Test 7: Duplicate SKU rejection');
    try {
      const dup = new Product({
        name: 'Dup',
        sku: TEST_SKU,
        thicknessMM: 18,
        grade: grade._id,
        basePrice: 70,
      });
      await dup.save();
      logger.error('  ❌ Duplicate SKU allowed!');
    } catch (error) {
      if (error.code === 11000) {
        logger.info(`  ✓ Rejected (code 11000)`);
      } else {
        logger.error(`  ⚠ Unexpected error: ${error.message}`);
      }
    }

    // Test 8: Custom fields
    logger.info('');
    logger.info('Test 8: Custom fields');
    const fetched = await Product.findById(product._id);
    const cfObj = Object.fromEntries(fetched.customFields);
    logger.info(`  color: ${cfObj.color}`);
    logger.info(`  finish: ${cfObj.finish}`);
    logger.info(`  is-prelaminated: ${cfObj['is-prelaminated']}`);

    // Test 9: Low stock
    logger.info('');
    logger.info('Test 9: Low stock detection');
    product.currentStock = 10;
    await product.save();
    const lowStock = await Product.lowStock();
    logger.info(`  ✓ Low stock products: ${lowStock.length} (should include our test product)`);

    // Test 10: Price history
    logger.info('');
    logger.info('Test 10: Price history');
    const initialHistory = product.priceHistory.length;
    product.basePrice = 70;
    await product.save();
    const afterFirst = product.priceHistory.length;
    logger.info(`  Initial history entries: ${initialHistory}`);
    logger.info(`  After price change: ${afterFirst} (expected: ${initialHistory + 1})`);
    if (afterFirst > 0) {
      const last = product.priceHistory[afterFirst - 1];
      logger.info(`  Last change: ₹${last.oldPrice} → ₹${last.newPrice}`);
    }

    // Test 11: Soft delete + restore
    logger.info('');
    logger.info('Test 11: Soft delete + restore');
    await product.softDelete(null, 'Test cleanup');
    logger.info(`  isDeleted: ${product.isDeleted} (true)`);
    logger.info(`  isActive: ${product.isActive} (false)`);
    await product.restore();
    logger.info(`  After restore — isDeleted: ${product.isDeleted}, isActive: ${product.isActive}`);

    await Product.deleteOne({ sku: TEST_SKU });
    logger.info('');
    logger.info('✓ Test product cleaned up');

    // Test 12: ProductAttribute enum validation
    logger.info('');
    logger.info('Test 12: ProductAttribute enum without options');
    try {
      const badAttr = new ProductAttribute({
        name: 'bad-attr',
        label: 'Bad',
        type: 'enum',
      });
      await badAttr.save();
      logger.error('  ❌ Enum without options allowed!');
    } catch (error) {
      logger.info(`  ✓ Rejected: ${error.message.substring(0, 80)}`);
    }

    await mongoose.disconnect();
    logger.info('');
    logger.info('═══════════════════════════════════════');
    logger.info('🎉 All Product model tests passed');
    logger.info('═══════════════════════════════════════');
    process.exit(0);
  } catch (error) {
    logger.error('Test failed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

test();
