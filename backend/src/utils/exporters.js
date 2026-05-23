const ExcelJS = require('exceljs');

/**
 * Convert customer documents to CSV string
 * Handles populated references and nested fields gracefully.
 */
exports.customersToCSV = (customers) => {
  const headers = [
    'Customer Name', 'Company Name', 'Phone', 'Alt Phone', 'Email',
    'Business Segment', 'Business Sub-Segment', 'Business Size',
    'GSTIN', 'Acquisition Source',
    'Billing City', 'Billing State', 'Billing Pincode',
    'Tags', 'Preferred Unit', 'Special Discount %',
    'Credit Limit', 'Current Dues',
    'Total Orders', 'Total Revenue', 'Lifetime Value', 'Avg Order Value',
    'WhatsApp Enabled', 'Email Enabled', 'SMS Enabled',
    'Is Active', 'Created At', 'Notes',
  ];

  const escapeCSV = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const rows = customers.map((c) => [
    escapeCSV(c.customerName),
    escapeCSV(c.companyName),
    escapeCSV(c.phone),
    escapeCSV(c.altPhone),
    escapeCSV(c.email),
    escapeCSV(c.businessSegment?.label || ''),
    escapeCSV(c.businessSubSegment),
    escapeCSV(c.businessSize),
    escapeCSV(c.gstin),
    escapeCSV(c.acquisitionSource),
    escapeCSV(c.billingAddress?.city),
    escapeCSV(c.billingAddress?.state),
    escapeCSV(c.billingAddress?.pincode),
    escapeCSV(c.tags?.join('; ') || ''),
    escapeCSV(c.preferredUnit),
    escapeCSV(c.specialDiscountPct),
    escapeCSV(c.creditLimit),
    escapeCSV(c.currentDues),
    escapeCSV(c.purchaseInsights?.totalOrders || 0),
    escapeCSV(c.purchaseInsights?.totalRevenue || 0),
    escapeCSV(c.purchaseInsights?.lifetimeValue || 0),
    escapeCSV(c.purchaseInsights?.avgOrderValue || 0),
    escapeCSV(c.communicationPrefs?.whatsappEnabled),
    escapeCSV(c.communicationPrefs?.emailEnabled),
    escapeCSV(c.communicationPrefs?.smsEnabled),
    escapeCSV(c.isActive),
    escapeCSV(c.createdAt ? new Date(c.createdAt).toISOString().split('T')[0] : ''),
    escapeCSV(c.notes),
  ]);

  return [
    headers.map(escapeCSV).join(','),
    ...rows.map((r) => r.join(',')),
  ].join('\r\n');
};

/**
 * Generate a multi-sheet Excel workbook for customers
 * @param {Array} customers — populated customer documents
 * @param {Object} analytics — { segmentStats, topCustomers, summary }
 * @returns {Buffer} — Excel file as buffer
 */
exports.customersToExcel = async (customers, analytics = {}) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Shree Gopal MDF System';
  workbook.created = new Date();

  // ─── Sheet 1: Customers (main data) ───
  const customerSheet = workbook.addWorksheet('Customers', {
    properties: { tabColor: { argb: 'FF4F46E5' } },
  });

  customerSheet.columns = [
    { header: 'Name', key: 'customerName', width: 25 },
    { header: 'Company', key: 'companyName', width: 25 },
    { header: 'Phone', key: 'phone', width: 14 },
    { header: 'Email', key: 'email', width: 25 },
    { header: 'Segment', key: 'segment', width: 20 },
    { header: 'Size', key: 'size', width: 12 },
    { header: 'GSTIN', key: 'gstin', width: 18 },
    { header: 'Source', key: 'source', width: 15 },
    { header: 'City', key: 'city', width: 15 },
    { header: 'State', key: 'state', width: 18 },
    { header: 'Tags', key: 'tags', width: 25 },
    { header: 'Credit Limit', key: 'creditLimit', width: 14, style: { numFmt: '₹#,##0' } },
    { header: 'Current Dues', key: 'currentDues', width: 14, style: { numFmt: '₹#,##0' } },
    { header: 'Total Orders', key: 'orders', width: 12 },
    { header: 'Lifetime Value', key: 'lifetime', width: 16, style: { numFmt: '₹#,##0' } },
    { header: 'Created', key: 'created', width: 12 },
  ];

  customers.forEach((c) => {
    customerSheet.addRow({
      customerName: c.customerName || '',
      companyName: c.companyName || '',
      phone: c.phone || '',
      email: c.email || '',
      segment: c.businessSegment?.label || '',
      size: c.businessSize || '',
      gstin: c.gstin || '',
      source: c.acquisitionSource || '',
      city: c.billingAddress?.city || '',
      state: c.billingAddress?.state || '',
      tags: c.tags?.join(', ') || '',
      creditLimit: c.creditLimit || 0,
      currentDues: c.currentDues || 0,
      orders: c.purchaseInsights?.totalOrders || 0,
      lifetime: c.purchaseInsights?.lifetimeValue || 0,
      created: c.createdAt ? new Date(c.createdAt).toISOString().split('T')[0] : '',
    });
  });

  // Style header
  customerSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  customerSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4F46E5' },
  };
  customerSheet.getRow(1).height = 25;
  customerSheet.views = [{ state: 'frozen', ySplit: 1 }];

  // ─── Sheet 2: By Segment Analytics ───
  if (analytics.segmentStats && analytics.segmentStats.length > 0) {
    const segSheet = workbook.addWorksheet('By Segment', {
      properties: { tabColor: { argb: 'FF10B981' } },
    });

    segSheet.columns = [
      { header: 'Segment', key: 'label', width: 25 },
      { header: 'Customers', key: 'count', width: 12 },
      { header: 'Total Lifetime', key: 'lifetime', width: 18, style: { numFmt: '₹#,##0' } },
      { header: 'Avg Lifetime', key: 'avg', width: 18, style: { numFmt: '₹#,##0' } },
      { header: 'Total Dues', key: 'dues', width: 16, style: { numFmt: '₹#,##0' } },
    ];

    analytics.segmentStats.forEach((s) => {
      segSheet.addRow({
        label: s.label,
        count: s.customerCount,
        lifetime: s.totalLifetimeValue,
        avg: s.avgLifetimeValue,
        dues: s.totalDues,
      });
    });

    segSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    segSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF10B981' },
    };
    segSheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  // ─── Sheet 3: Top Customers ───
  if (analytics.topCustomers && analytics.topCustomers.length > 0) {
    const topSheet = workbook.addWorksheet('Top Customers', {
      properties: { tabColor: { argb: 'FFEAB308' } },
    });

    topSheet.columns = [
      { header: 'Rank', key: 'rank', width: 8 },
      { header: 'Customer', key: 'name', width: 25 },
      { header: 'Company', key: 'company', width: 25 },
      { header: 'Segment', key: 'segment', width: 20 },
      { header: 'Lifetime Value', key: 'lifetime', width: 18, style: { numFmt: '₹#,##0' } },
      { header: 'Tags', key: 'tags', width: 25 },
    ];

    analytics.topCustomers.forEach((c, i) => {
      topSheet.addRow({
        rank: i + 1,
        name: c.customerName,
        company: c.companyName || '',
        segment: c.businessSegment?.label || '',
        lifetime: c.purchaseInsights?.lifetimeValue || 0,
        tags: c.tags?.join(', ') || '',
      });
    });

    topSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    topSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEAB308' },
    };
    topSheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  // ─── Sheet 4: Summary ───
  if (analytics.summary) {
    const sumSheet = workbook.addWorksheet('Summary', {
      properties: { tabColor: { argb: 'FFEF4444' } },
    });

    sumSheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 20 },
    ];

    const s = analytics.summary;
    const rows = [
      ['Total Customers', s.counts.total],
      ['Active Customers', s.counts.active],
      ['Inactive Customers', s.counts.inactive],
      ['Deleted Customers', s.counts.deleted],
      ['With Outstanding Dues', s.counts.withOutstandingDues],
      ['New This Month', s.counts.newThisMonth],
      ['', ''],
      ['Total Outstanding Dues', `₹${s.financial.totalOutstandingDues.toLocaleString('en-IN')}`],
      ['Total Lifetime Value', `₹${s.financial.totalLifetimeValue.toLocaleString('en-IN')}`],
      ['', ''],
      ['Report Generated', new Date().toLocaleString('en-IN')],
    ];
    rows.forEach(([metric, value]) => sumSheet.addRow({ metric, value }));

    sumSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sumSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEF4444' },
    };
  }

  // Generate buffer
  return await workbook.xlsx.writeBuffer();
};
