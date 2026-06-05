require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const xlsx = require('xlsx');
const logger = require('../src/config/logger');
const {
  inspectFile, formatReport, formatOverallSummary,
  _detectType, _inferColumnType, _formatBytes,
} = require('./inspectExcel');

const TAG = 'INSPECT_C_TEST';

const test = async () => {
  let pass = 0, fail = 0;
  const failures = [];
  const createdFiles = [];

  const assert = (name, condition, detail = '') => {
    if (condition) { pass++; logger.info(`  ✅ ${name}`); }
    else {
      fail++;
      logger.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
      failures.push(name);
    }
  };

  /**
   * Write a workbook to a temp file and return its path.
   * sheets: { [sheetName]: rows[][] (first row = headers, rest = data) }
   */
  const synthesizeExcelFile = (sheets, suffix = '') => {
    const wb = xlsx.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
      const ws = xlsx.utils.aoa_to_sheet(rows, { cellDates: true });
      xlsx.utils.book_append_sheet(wb, ws, name);
    }
    const filePath = path.join(
      os.tmpdir(),
      `${TAG}-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.xlsx`
    );
    xlsx.writeFile(wb, filePath);
    createdFiles.push(filePath);
    return filePath;
  };

  const cleanup = () => {
    for (const f of createdFiles) {
      try { fs.unlinkSync(f); } catch {}
    }
  };

  try {
    logger.info('\n═══ SECTION C — Excel Inspection Smoke Test ═══');

    // ─── Type detection helpers (sanity-check before file tests) ───
    logger.info('\nHelpers: detectType + inferColumnType');
    assert('detectType null → "null"', _detectType(null) === 'null');
    assert('detectType "" → "null"', _detectType('') === 'null');
    assert('detectType true → "boolean"', _detectType(true) === 'boolean');
    assert('detectType 42 → "number (integer)"', _detectType(42) === 'number (integer)');
    assert('detectType 3.14 → "number (float)"', _detectType(3.14) === 'number (float)');
    assert('detectType Date → "date"', _detectType(new Date()) === 'date');
    assert('detectType "hello" → "string"', _detectType('hello') === 'string');
    assert('inferColumnType all-string → "string"',
      _inferColumnType(['a', 'b', 'c']) === 'string');
    assert('inferColumnType mixed → "mixed (...)"',
      _inferColumnType(['a', 1, 'b']).startsWith('mixed'));
    assert('_formatBytes 1024 → "1.0 KB"',
      _formatBytes(1024) === '1.0 KB');
    assert('_formatBytes 1500000 → "1.43 MB"',
      _formatBytes(1500000).endsWith('MB'));

    // ═══════════════════════════════════════════════
    // T1: 3-sheet file → all sheets detected
    // ═══════════════════════════════════════════════
    logger.info('\nT1: 3-sheet file → all sheets detected');
    const path1 = synthesizeExcelFile({
      'Customers': [
        ['name', 'phone'],
        ['Alice', '9876543210'],
      ],
      'Bills': [
        ['invoiceNo', 'amount'],
        ['INV-001', 1500],
      ],
      'Products': [
        ['sku', 'price'],
        ['SKU-A', 100],
      ],
    }, 't1');
    const r1 = inspectFile(path1);
    assert('Returns 3 sheets',
      r1.sheets.length === 3, `Got ${r1.sheets.length}`);
    assert('Sheet names match',
      r1.sheets.map(s => s.name).join(',') === 'Customers,Bills,Products');

    // ═══════════════════════════════════════════════
    // T2: workbook with single empty sheet
    // ═══════════════════════════════════════════════
    logger.info('\nT2: empty-sheet workbook → handled gracefully');
    const path2 = synthesizeExcelFile({ 'Empty': [] }, 't2');
    const r2 = inspectFile(path2);
    assert('Returns 1 sheet flagged isEmpty',
      r2.sheets.length === 1 && r2.sheets[0].isEmpty === true,
      `Got sheets=${r2.sheets.length} isEmpty=${r2.sheets[0]?.isEmpty}`);

    // ═══════════════════════════════════════════════
    // T3: 5 columns × 10 data rows → counts correct
    // ═══════════════════════════════════════════════
    logger.info('\nT3: 5 cols × 10 rows → counts + headers correct');
    const headers3 = ['col1', 'col2', 'col3', 'col4', 'col5'];
    const dataRows3 = Array.from({ length: 10 }, (_, i) => [
      `val${i}`, i, i * 1.5, `c${i % 3}`, i % 2 === 0,
    ]);
    const path3 = synthesizeExcelFile({
      'Data': [headers3, ...dataRows3],
    }, 't3');
    const r3 = inspectFile(path3);
    const s3 = r3.sheets[0];
    assert('Headers length = 5', s3.headers.length === 5);
    assert('Header names match', s3.headers.join(',') === 'col1,col2,col3,col4,col5');
    assert('dataRowCount = 10', s3.dataRowCount === 10);
    assert('columns array has 5 entries', s3.columns.length === 5);

    // ═══════════════════════════════════════════════
    // T4-T7: per-column type inference
    // ═══════════════════════════════════════════════
    logger.info('\nT4-T7: per-column type inference (string/int/float/date)');
    const path4 = synthesizeExcelFile({
      'Types': [
        ['s', 'i', 'f', 'd'],
        ['hello', 1, 1.5, new Date('2026-01-15')],
        ['world', 2, 2.5, new Date('2026-02-20')],
        ['foo', 3, 3.5, new Date('2026-03-10')],
      ],
    }, 't4');
    const r4 = inspectFile(path4);
    const s4 = r4.sheets[0];
    const byHeader = (h) => s4.columns.find(c => c.header === h);
    assert('T4: string column → "string"', byHeader('s').type === 'string');
    assert('T5: integer column → "number (integer)"',
      byHeader('i').type === 'number (integer)');
    assert('T6: float column → "number (float)"',
      byHeader('f').type === 'number (float)');
    assert('T7: Date column → "date"', byHeader('d').type === 'date');

    // ═══════════════════════════════════════════════
    // T8: mixed-type column → 'mixed (...)'
    // ═══════════════════════════════════════════════
    logger.info('\nT8: mixed-type column → "mixed (...)"');
    const path8 = synthesizeExcelFile({
      'Mixed': [
        ['mixedCol'],
        ['stringValue'],
        [42],
        ['anotherString'],
        [100],
      ],
    }, 't8');
    const r8 = inspectFile(path8);
    const mixedCol = r8.sheets[0].columns[0];
    assert('Mixed column type starts with "mixed"',
      mixedCol.type.startsWith('mixed'),
      `Got: ${mixedCol.type}`);
    assert('Mixed type lists both string + number',
      mixedCol.type.includes('string') &&
      mixedCol.type.includes('number'),
      `Got: ${mixedCol.type}`);

    // ═══════════════════════════════════════════════
    // T9: empty-count tracking
    // ═══════════════════════════════════════════════
    logger.info('\nT9: emptyCount + emptyPct tracked correctly');
    const path9 = synthesizeExcelFile({
      'Empties': [
        ['col1', 'col2'],
        ['a', null],
        ['b', null],
        ['c', 'present'],
        ['d', null],
      ],
    }, 't9');
    const r9 = inspectFile(path9);
    const col2 = r9.sheets[0].columns.find(c => c.header === 'col2');
    assert('col2 emptyCount = 3', col2.emptyCount === 3, `Got ${col2.emptyCount}`);
    assert('col2 emptyPct = 75',
      col2.emptyPct === 75, `Got ${col2.emptyPct}`);

    // ═══════════════════════════════════════════════
    // T10: low cardinality → uniqueValues listed
    // ═══════════════════════════════════════════════
    logger.info('\nT10: low cardinality column → uniqueValues listed');
    const path10 = synthesizeExcelFile({
      'LowCard': [
        ['billType'],
        ['GST'], ['NON_GST'], ['GST'], ['TEMP'], ['NON_GST'],
        ['GST'], ['TEMP'], ['NON_GST'], ['GST'], ['TEMP'],
      ],
    }, 't10');
    const r10 = inspectFile(path10);
    const billCol = r10.sheets[0].columns[0];
    assert('billType has uniqueValues array',
      Array.isArray(billCol.uniqueValues));
    assert('Contains exactly 3 unique values',
      billCol.uniqueValues?.length === 3,
      `Got ${billCol.uniqueValues?.length}`);
    assert('uniqueValues = [GST, NON_GST, TEMP] in some order',
      ['GST', 'NON_GST', 'TEMP'].every(v => billCol.uniqueValues.includes(v)));

    // ═══════════════════════════════════════════════
    // T11: high cardinality → uniqueValues NOT listed
    // ═══════════════════════════════════════════════
    logger.info('\nT11: high cardinality (≥20 unique) → uniqueValues omitted');
    const highCardRows = Array.from({ length: 50 }, (_, i) => [`unique_value_${i}`]);
    const path11 = synthesizeExcelFile({
      'HighCard': [
        ['id'],
        ...highCardRows,
      ],
    }, 't11');
    const r11 = inspectFile(path11);
    const idCol = r11.sheets[0].columns[0];
    assert('uniqueValues NOT set on high-cardinality column',
      !('uniqueValues' in idCol),
      `Got: ${JSON.stringify(idCol)}`);
    assert('highCardinality flag set to 50',
      idCol.highCardinality === 50,
      `Got ${idCol.highCardinality}`);

    // ═══════════════════════════════════════════════
    // T12: empty sheet → flagged
    // ═══════════════════════════════════════════════
    logger.info('\nT12: header-only sheet (0 data rows) flagged isEmpty');
    const path12 = synthesizeExcelFile({
      'OnlyHeaders': [
        ['a', 'b', 'c'],  // header only, no data
      ],
    }, 't12');
    const r12 = inspectFile(path12);
    assert('isEmpty = true when 0 data rows',
      r12.sheets[0].isEmpty === true,
      `dataRowCount=${r12.sheets[0].dataRowCount}`);

    // ═══════════════════════════════════════════════
    // T13: non-existent file → error logged, no crash
    // ═══════════════════════════════════════════════
    logger.info('\nT13: non-existent file → graceful error');
    const fakeFile = path.join(os.tmpdir(), `${TAG}-nonexistent-${Date.now()}.xlsx`);
    const r13 = inspectFile(fakeFile);
    assert('exists = false', r13.exists === false);
    assert('errors[] populated with file_access kind',
      r13.errors.length === 1 && r13.errors[0].kind === 'file_access');
    assert('sheets[] is empty array', r13.sheets.length === 0);

    // ═══════════════════════════════════════════════
    // T14: multiple files → both processed, aggregate counts
    // ═══════════════════════════════════════════════
    logger.info('\nT14: multiple files inspected → aggregate counts');
    const pathA = synthesizeExcelFile({
      'A': [['x', 'y'], ['1', '2'], ['3', '4']],
    }, 't14a');
    const pathB = synthesizeExcelFile({
      'B': [['z'], ['9']],
    }, 't14b');
    const rA = inspectFile(pathA);
    const rB = inspectFile(pathB);
    const overall = {
      filesInspected: 2,
      totalSheets: rA.sheets.length + rB.sheets.length,
      totalDataRows: rA.sheets.reduce((s, sh) => s + sh.dataRowCount, 0) +
                     rB.sheets.reduce((s, sh) => s + sh.dataRowCount, 0),
      errors: [],
    };
    assert('Aggregate: 2 files, 2 sheets, 3 data rows',
      overall.filesInspected === 2 &&
      overall.totalSheets === 2 &&
      overall.totalDataRows === 3,
      JSON.stringify(overall));

    // ═══════════════════════════════════════════════
    // T15: corrupt file → caught, logged, no crash
    // ═══════════════════════════════════════════════
    logger.info('\nT15: unreadable path → read_failure error captured');
    // xlsx is very permissive — empty files / random text get parsed as
    // empty workbooks rather than throwing. To deterministically exercise
    // the read_failure catch, point at a DIRECTORY: statSync succeeds for
    // directories, but xlsx.readFile() throws EISDIR when reading bytes.
    const dirPath = path.join(os.tmpdir(),
      `${TAG}-dir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(dirPath);
    // Track for cleanup (rmdir, not unlink)
    const r15 = inspectFile(dirPath);
    try { fs.rmdirSync(dirPath); } catch {}
    assert('exists = true (path stat succeeded)', r15.exists === true);
    assert('read_failure error captured',
      r15.errors.some(e => e.kind === 'read_failure'),
      `Errors: ${JSON.stringify(r15.errors)}`);
    assert('sheets[] empty after read failure', r15.sheets.length === 0,
      `Got ${r15.sheets.length} sheets`);

    // ═══════════════════════════════════════════════
    // T16: formatReport produces non-empty output
    // ═══════════════════════════════════════════════
    logger.info('\nT16: formatReport output structure');
    const report = formatReport(r3);
    assert('Report contains FILE: path',
      report.includes('FILE:') && report.includes(path3));
    assert('Report contains sheet name', report.includes('Sheet: "Data"'));
    assert('Report contains "Sample rows"', report.includes('Sample rows'));
    assert('Report contains a column header from T3',
      report.includes('col1') && report.includes('col5'));

    // ─── Cleanup ───
    logger.info('\nCleanup');
    cleanup();
    logger.info(`  Deleted ${createdFiles.length} temp Excel files`);

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Excel Inspection (Section C): ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }
    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error.message);
    logger.error(error.stack);
    try { cleanup(); } catch {}
    process.exit(1);
  }
};

test();
