/**
 * inspectExcel.js (Prompt 9 Section C)
 *
 * Read-only Excel inspection utility. Reads .xlsx/.xls/.xlsm files and
 * prints their structure (sheets, columns, sample rows, inferred types,
 * cardinality hints). NO database writes; pure file analysis.
 *
 * CLI:
 *   node scripts/inspectExcel.js path1.xlsx [path2.xlsm ...]
 *   node scripts/inspectExcel.js *.xlsm > inspection.txt
 *
 * Designed to be the first step of the Excel migration workflow — the
 * user runs this to see what's in their files, then customizes the
 * MAPPING object in migrateExcel.js (Section D) accordingly.
 *
 * Module exports inspectFile() + formatReport() so tests can call
 * directly and assert on the structured output.
 */

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const SAMPLE_SIZE = 100;
const SHOW_SAMPLE_ROWS = 3;
const UNIQUE_VALUE_CARDINALITY_LIMIT = 20;

// ─── Helpers ───

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Classify a single value into a coarse type label.
 */
function detectType(value) {
  if (value === null || value === undefined || value === '') return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Date) return 'date';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'number (integer)' : 'number (float)';
  }
  return 'string';
}

/**
 * Reduce an array of values to a single column type.
 * - All non-null values same type → that type
 * - Mixed non-null types → 'mixed (a, b)'
 * - All null → 'null'
 */
function inferColumnType(values) {
  const nonNullTypes = new Set();
  for (const v of values) {
    const t = detectType(v);
    if (t !== 'null') nonNullTypes.add(t);
  }
  if (nonNullTypes.size === 0) return 'null';
  if (nonNullTypes.size === 1) return [...nonNullTypes][0];
  return `mixed (${[...nonNullTypes].sort().join(', ')})`;
}

/**
 * Format a single value for sample-row printing.
 * Truncates strings, ISO-formats dates, JSONs arrays/objects.
 */
function formatValue(v) {
  if (v === null || v === undefined) return '<null>';
  if (v === '') return '<empty>';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    return v.length > 60 ? JSON.stringify(v.slice(0, 60) + '…') : JSON.stringify(v);
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ─── Public: inspect a single file ───

/**
 * Parse + analyze an Excel file, returning a structured report object.
 * Never throws — file errors are surfaced via `errors[]` so the caller
 * can continue with the next file.
 */
exports.inspectFile = (filePath) => {
  const result = {
    filePath,
    fileName: path.basename(filePath),
    exists: false,
    size: 0,
    sizeHuman: null,
    modified: null,
    sheets: [],
    errors: [],
  };

  // Stat
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    result.errors.push({ kind: 'file_access', message: err.message });
    return result;
  }
  result.exists = true;
  result.size = stat.size;
  result.sizeHuman = formatBytes(stat.size);
  result.modified = stat.mtime.toISOString();

  // Read
  let workbook;
  try {
    workbook = xlsx.readFile(filePath, { cellDates: true, cellNF: false });
  } catch (err) {
    result.errors.push({ kind: 'read_failure', message: err.message });
    return result;
  }

  const sheetNames = workbook.SheetNames || [];
  for (const sheetName of sheetNames) {
    const sheetReport = analyzeSheet(workbook.Sheets[sheetName], sheetName);
    result.sheets.push(sheetReport);
  }

  return result;
};

/**
 * Analyze one sheet → { name, totalRows, headers, columns: [{ header, type,
 * emptyCount, uniqueValues? }], sampleRows: [...], isEmpty, dataRowCount }
 */
function analyzeSheet(sheet, sheetName) {
  const report = {
    name: sheetName,
    totalRows: 0,
    dataRowCount: 0,
    headers: [],
    columns: [],
    sampleRows: [],
    isEmpty: false,
  };

  if (!sheet) {
    report.isEmpty = true;
    return report;
  }

  // Array-of-arrays form gives the raw structure (header + data rows)
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: false,  // strings retain their formatting
    dateNF: 'yyyy-mm-dd',
  });
  // Note: raw:false keeps dates as strings; but cellDates:true on read
  // gave us Date instances on the underlying cells. For type detection
  // we want the raw values (Date instances, numbers, etc.) — so read
  // again with raw:true.
  const rowsRaw = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });

  report.totalRows = rowsRaw.length;
  if (rowsRaw.length === 0) {
    report.isEmpty = true;
    return report;
  }

  // First row = headers
  const rawHeaders = rowsRaw[0] || [];
  const headers = rawHeaders.map((h, i) => {
    if (h == null || h === '') return `__empty_col_${i + 1}__`;
    return String(h);
  });
  report.headers = headers;

  // Deduplicate headers — append .1, .2 etc. (xlsx convention)
  const seen = new Map();
  const dedupedHeaders = headers.map(h => {
    const count = seen.get(h) || 0;
    seen.set(h, count + 1);
    return count === 0 ? h : `${h}.${count}`;
  });
  report.headers = dedupedHeaders;

  // Data rows = everything after header
  const dataRows = rowsRaw.slice(1);
  report.dataRowCount = dataRows.length;
  if (dataRows.length === 0) {
    report.isEmpty = true;
    return report;
  }

  // Sample first N for type inference + cardinality
  const sample = dataRows.slice(0, SAMPLE_SIZE);
  const sampleSize = sample.length;

  report.columns = dedupedHeaders.map((header, colIdx) => {
    const colValues = sample.map(row => row[colIdx]);
    const nonNullValues = colValues.filter(
      v => v !== null && v !== undefined && v !== ''
    );
    const emptyCount = sampleSize - nonNullValues.length;
    const type = inferColumnType(colValues);

    const col = {
      header,
      type,
      emptyCount,
      emptyPct: sampleSize > 0
        ? +((emptyCount / sampleSize) * 100).toFixed(1)
        : 0,
      sampleSize,
    };

    // Cardinality — list unique values only if low cardinality
    const unique = [...new Set(nonNullValues.map(v => {
      if (v instanceof Date) return v.toISOString();
      return String(v);
    }))];
    if (unique.length > 0 && unique.length < UNIQUE_VALUE_CARDINALITY_LIMIT) {
      col.uniqueValues = unique;
    } else if (unique.length >= UNIQUE_VALUE_CARDINALITY_LIMIT) {
      col.highCardinality = unique.length;
    }
    return col;
  });

  // Sample rows for display — first SHOW_SAMPLE_ROWS data rows
  // (preserving raw types for downstream formatting).
  report.sampleRows = dataRows
    .slice(0, SHOW_SAMPLE_ROWS)
    .map((row, i) => {
      const obj = {};
      dedupedHeaders.forEach((header, idx) => {
        obj[header] = row[idx];
      });
      return { rowIndex: i + 2, values: obj }; // +2 because row 1 is header
    });

  return report;
}

// ─── Public: format an analysis report as human-readable text ───

exports.formatReport = (analysis) => {
  const lines = [];
  const div = '='.repeat(60);

  lines.push(div);
  lines.push(`FILE: ${analysis.filePath}`);
  if (!analysis.exists) {
    lines.push('  (file not accessible)');
    if (analysis.errors.length) {
      lines.push(`  Errors: ${analysis.errors.map(e => `${e.kind}: ${e.message}`).join('; ')}`);
    }
    lines.push(div);
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`Size: ${analysis.sizeHuman}`);
  lines.push(`Modified: ${analysis.modified}`);
  lines.push(div);
  lines.push('');

  if (analysis.errors.length > 0) {
    lines.push('Errors during read:');
    for (const e of analysis.errors) {
      lines.push(`  - ${e.kind}: ${e.message}`);
    }
    lines.push('');
  }

  if (analysis.sheets.length === 0) {
    lines.push('(No sheets in workbook)');
    lines.push('');
    return lines.join('\n');
  }

  for (const sheet of analysis.sheets) {
    lines.push(`--- Sheet: "${sheet.name}" ---`);
    if (sheet.isEmpty || sheet.dataRowCount === 0) {
      lines.push(`(Empty sheet — ${sheet.dataRowCount} data rows)`);
      lines.push('--- End of sheet ---');
      lines.push('');
      continue;
    }
    lines.push(`Total rows: ${sheet.totalRows} (including header row)`);
    lines.push(`Total data rows: ${sheet.dataRowCount}`);
    lines.push(`Columns (${sheet.headers.length}): [${sheet.headers.map(h => JSON.stringify(h)).join(', ')}]`);
    lines.push('');

    // Type table
    lines.push(`Detected column types (sampled from first ${Math.min(sheet.dataRowCount, SAMPLE_SIZE)} rows):`);
    for (const col of sheet.columns) {
      lines.push(`  ${col.header}: ${col.type}`);
    }
    lines.push('');

    // Empty counts
    const colsWithEmpty = sheet.columns.filter(c => c.emptyCount > 0);
    if (colsWithEmpty.length > 0) {
      lines.push(`Empty values per column (in sample):`);
      for (const col of colsWithEmpty) {
        lines.push(`  ${col.header}: ${col.emptyCount}/${col.sampleSize} (${col.emptyPct}% empty)`);
      }
      lines.push('');
    }

    // Unique values (low cardinality)
    const colsWithUniques = sheet.columns.filter(c => c.uniqueValues);
    if (colsWithUniques.length > 0) {
      lines.push(`Unique values per column (cardinality < ${UNIQUE_VALUE_CARDINALITY_LIMIT}, in sample):`);
      for (const col of colsWithUniques) {
        lines.push(`  ${col.header}: [${col.uniqueValues.map(v => JSON.stringify(v)).join(', ')}]`);
      }
      lines.push('');
    }

    // High-cardinality flag
    const colsHighCard = sheet.columns.filter(c => c.highCardinality);
    if (colsHighCard.length > 0) {
      lines.push(`High-cardinality columns (>= ${UNIQUE_VALUE_CARDINALITY_LIMIT} unique values, not listed):`);
      for (const col of colsHighCard) {
        lines.push(`  ${col.header}: ${col.highCardinality} unique values in sample`);
      }
      lines.push('');
    }

    // Sample rows
    if (sheet.sampleRows.length > 0) {
      lines.push(`Sample rows (first ${sheet.sampleRows.length} data rows):`);
      for (const row of sheet.sampleRows) {
        lines.push(`Row ${row.rowIndex}:`);
        for (const [k, v] of Object.entries(row.values)) {
          lines.push(`  ${k}: ${formatValue(v)}`);
        }
      }
      lines.push('');
    }
    lines.push('--- End of sheet ---');
    lines.push('');
  }

  return lines.join('\n');
};

exports.formatOverallSummary = (overall) => {
  const div = '='.repeat(60);
  const lines = [div, 'SUMMARY', div];
  lines.push(`Files inspected: ${overall.filesInspected}`);
  lines.push(`Total sheets: ${overall.totalSheets}`);
  lines.push(`Total data rows across all sheets: ${overall.totalDataRows}`);
  if (overall.errors.length > 0) {
    lines.push(`Errors encountered: ${overall.errors.length}`);
    for (const e of overall.errors) {
      lines.push(`  - [${e.file || '?'}] ${e.kind}: ${e.message}`);
    }
  } else {
    lines.push('Errors encountered: none');
  }
  lines.push(div);
  return lines.join('\n');
};

// ─── Test-only helpers ───
exports._detectType = detectType;
exports._inferColumnType = inferColumnType;
exports._formatBytes = formatBytes;

// ─── CLI entry ───
if (require.main === module) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node scripts/inspectExcel.js <file1.xlsx> [file2.xlsm ...]');
    console.error('       node scripts/inspectExcel.js *.xlsm > inspection.txt');
    process.exit(1);
  }

  const overall = {
    filesInspected: 0,
    totalSheets: 0,
    totalDataRows: 0,
    errors: [],
  };

  for (const filePath of files) {
    const analysis = exports.inspectFile(filePath);
    console.log(exports.formatReport(analysis));
    overall.filesInspected++;
    overall.totalSheets += analysis.sheets.length;
    overall.totalDataRows += analysis.sheets.reduce(
      (s, sh) => s + (sh.dataRowCount || 0), 0
    );
    overall.errors.push(...analysis.errors.map(e => ({ ...e, file: analysis.fileName })));
  }

  console.log(exports.formatOverallSummary(overall));
  process.exit(overall.errors.length > 0 ? 1 : 0);
}
