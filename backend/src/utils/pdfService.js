const puppeteer = require('puppeteer');
const handlebars = require('handlebars');
const fs = require('fs/promises');
const path = require('path');
const logger = require('../config/logger');

/**
 * PDF Service — generates PDFs from HTML templates using Puppeteer.
 *
 * Design principles:
 *   1. Browser instance reused across generations (10x performance)
 *   2. HTML + Handlebars for designer-friendly templates
 *   3. A4 page size (Indian invoice standard)
 *   4. Concurrent generation safe (separate page per request)
 *   5. Graceful browser lifecycle management
 */

let browserInstance = null;
let browserPromise = null;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  if (browserPromise) {
    return browserPromise;
  }

  browserPromise = puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
    ],
  });

  try {
    browserInstance = await browserPromise;
    logger.info('Puppeteer browser launched');

    browserInstance.on('disconnected', () => {
      logger.warn('Puppeteer browser disconnected');
      browserInstance = null;
      browserPromise = null;
    });

    return browserInstance;
  } finally {
    browserPromise = null;
  }
}

exports.closeBrowser = async () => {
  if (browserInstance) {
    try {
      await browserInstance.close();
      logger.info('Puppeteer browser closed');
    } catch (err) {
      logger.error('Error closing browser:', err);
    }
    browserInstance = null;
  }
};

exports.loadTemplate = async (templateName) => {
  // Backward-compatible: bare names (e.g. 'detailed-gst') resolve to templates/bills/.
  // Names with a subdir prefix (e.g. 'receipts/payment-receipt') resolve from templates/ root.
  const templatePath = templateName.includes('/')
    ? path.join(__dirname, '../templates', `${templateName}.hbs`)
    : path.join(__dirname, '../templates/bills', `${templateName}.hbs`);

  try {
    const source = await fs.readFile(templatePath, 'utf-8');
    return handlebars.compile(source);
  } catch (err) {
    throw new Error(`Template not found: ${templateName} (${templatePath})`);
  }
};

exports.renderTemplate = async (templateName, data) => {
  const template = await exports.loadTemplate(templateName);
  return template(data);
};

exports.generatePdfFromHtml = async (html, options = {}) => {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1200, height: 1600 });

    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    const pdfBuffer = await page.pdf({
      format: options.format || 'A4',
      printBackground: true,
      margin: {
        top: options.marginTop || '10mm',
        right: options.marginRight || '10mm',
        bottom: options.marginBottom || '10mm',
        left: options.marginLeft || '10mm',
      },
      preferCSSPageSize: true,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
};

exports.generatePdfFromTemplate = async (templateName, data, options = {}) => {
  const html = await exports.renderTemplate(templateName, data);
  return await exports.generatePdfFromHtml(html, options);
};

exports.savePdf = async (pdfBuffer, filename) => {
  const storageDir = path.join(__dirname, '../../storage/bills');
  await fs.mkdir(storageDir, { recursive: true });

  const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fullPath = path.join(storageDir, `${safeName}.pdf`);

  await fs.writeFile(fullPath, pdfBuffer);
  logger.info(`PDF saved: ${fullPath} (${pdfBuffer.length} bytes)`);

  return fullPath;
};

exports.generateAndSave = async (templateName, data, filename, options = {}) => {
  const pdfBuffer = await exports.generatePdfFromTemplate(templateName, data, options);
  const filePath = await exports.savePdf(pdfBuffer, filename);

  return {
    path: filePath,
    sizeBytes: pdfBuffer.length,
    buffer: pdfBuffer,
  };
};

// ─── Handlebars Helpers ───

handlebars.registerHelper('formatCurrency', function (value) {
  if (value === null || value === undefined) return '0.00';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
});

handlebars.registerHelper('formatDate', function (date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
});

handlebars.registerHelper('eq', (a, b) => a === b);
handlebars.registerHelper('ne', (a, b) => a !== b);
handlebars.registerHelper('gt', (a, b) => a > b);

handlebars.registerHelper('add', (a, b) => (a || 0) + (b || 0));
handlebars.registerHelper('multiply', (a, b) => (a || 0) * (b || 0));
handlebars.registerHelper('inc', (value) => value + 1);

handlebars.registerHelper('uppercase', (str) => (str || '').toUpperCase());
handlebars.registerHelper('lowercase', (str) => (str || '').toLowerCase());
