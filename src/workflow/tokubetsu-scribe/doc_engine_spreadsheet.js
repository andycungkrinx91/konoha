'use strict';

const fs = require('fs');
const { cleanHexColor, resolveDynamicOutputPath } = require('./document_engine_common');

function sanitizeFormula(formula) {
  if (typeof formula !== 'string') return '';
  const clean = formula.startsWith('=') ? formula.slice(1).trim() : formula.trim();
  if (/(WEBSERVICE\(|ENCODEURL\(|HYPERLINK\(|CALL\(|REGISTER\.|DDEREFERENCE\(|SQL\.REQUEST\()/i.test(clean)) {
    throw new Error(`Formula rejected: function not allowed: ${clean}`);
  }
  return clean;
}

const EXCEL_PALETTE_HEX = [
  '#3B82F6', '#14B8A6', '#8B5CF6', '#F97316', '#EAB308',
  '#EC4899', '#84CC16', '#06B6D4', '#6366F1', '#F43F5E'
];
const EXCEL_PALETTE_ARGB = EXCEL_PALETTE_HEX.map((h) => 'FF' + h.replace('#', ''));

function getXlsxPopulate() {
  return require('xlsx-populate');
}

function _renderSheetTitle(sheet, sheetDef, headers, startRow) {
  if (!sheetDef.title) return startRow;
  let currentRow = startRow;
  const endColLetter = String.fromCharCode(64 + Math.max(headers.length, 5));
  sheet.range(`A${currentRow}:${endColLetter}${currentRow}`).merged(true);
  const titleCell = sheet.cell(`A${currentRow}`);
  titleCell.value(sheetDef.title);
  titleCell.style({
    fontFamily: 'Segoe UI', fontSize: 12.5, bold: true, fontColor: '1E293B',
    fill: 'F5F3FF', horizontalAlignment: 'left', verticalAlignment: 'center'
  });
  sheet.row(currentRow).height(24);
  currentRow++;

  if (sheetDef.subtitle) {
    sheet.range(`A${currentRow}:${endColLetter}${currentRow}`).merged(true);
    const subCell = sheet.cell(`A${currentRow}`);
    subCell.value(sheetDef.subtitle);
    subCell.style({
      fontFamily: 'Segoe UI', fontSize: 9, fontColor: '64748B',
      fill: 'FAF5FF', horizontalAlignment: 'left', verticalAlignment: 'center'
    });
    sheet.row(currentRow).height(20);
    currentRow++;
  }
  sheet.row(currentRow).height(10);
  return currentRow + 1;
}

function _renderSingleKpiCard(sheet, kpi, cIdx, cfg) {
  const { currentRow, mergeTwoCols, kpiAccentColors } = cfg;
  const startCol = mergeTwoCols ? (1 + cIdx * 2) : (1 + cIdx);
  const endCol = mergeTwoCols ? (startCol + 1) : startCol;
  const accentColor = cleanHexColor(kpiAccentColors[cIdx % kpiAccentColors.length]);

  if (mergeTwoCols) {
    sheet.range(currentRow, startCol, currentRow, endCol).merged(true);
    sheet.range(currentRow + 1, startCol, currentRow + 1, endCol).merged(true);
  }

  const labelCell = sheet.row(currentRow).cell(startCol);
  labelCell.value((kpi.label || '').toUpperCase());
  labelCell.style({
    fontFamily: 'Segoe UI', fontSize: 8, bold: true, fontColor: '64748B', fill: 'F1F5F9',
    horizontalAlignment: 'center', verticalAlignment: 'center', topBorder: 'thin', topBorderColor: 'CBD5E1',
    leftBorder: 'thin', leftBorderColor: 'CBD5E1', rightBorder: 'thin', rightBorderColor: 'CBD5E1'
  });
  if (mergeTwoCols) {
    sheet.row(currentRow).cell(endCol).style({ topBorder: 'thin', topBorderColor: 'CBD5E1', rightBorder: 'thin', rightBorderColor: 'CBD5E1' });
  }

  const valCell = sheet.row(currentRow + 1).cell(startCol);
  if (typeof kpi.formula === 'string') {
    valCell.formula(sanitizeFormula(kpi.formula).replace(/^=/, ''));
  } else {
    valCell.value(kpi.value);
  }
  valCell.style({
    fontFamily: 'Segoe UI', fontSize: 15, bold: true, fontColor: accentColor, fill: 'F1F5F9',
    horizontalAlignment: 'center', verticalAlignment: 'center', leftBorder: 'thin', leftBorderColor: 'CBD5E1',
    rightBorder: 'thin', rightBorderColor: 'CBD5E1', bottomBorder: 'medium', bottomBorderColor: accentColor
  });
  if (mergeTwoCols) {
    sheet.row(currentRow + 1).cell(endCol).style({ rightBorder: 'thin', rightBorderColor: 'CBD5E1', bottomBorder: 'medium', bottomBorderColor: accentColor });
  }

  if (kpi.format === 'currency') valCell.style('numberFormat', '"$"#,##0');
  else if (kpi.format === 'percent') valCell.style('numberFormat', '0.0%');
  else if (kpi.format === 'integer') valCell.style('numberFormat', '#,##0');
}

function _renderSheetKpiCards(sheet, sheetDef, headers, currentRow) {
  if (!Array.isArray(sheetDef.kpi_cards) || sheetDef.kpi_cards.length === 0) return currentRow;
  const kpiAccentColors = [...EXCEL_PALETTE_ARGB].sort(() => Math.random() - 0.5);
  const mergeTwoCols = sheetDef.kpi_cards.length <= 4 && headers.length >= 6;

  sheet.row(currentRow).height(18);
  sheet.row(currentRow + 1).height(28);

  const cfg = { currentRow, mergeTwoCols, kpiAccentColors };
  sheetDef.kpi_cards.forEach((kpi, kIdx) => _renderSingleKpiCard(sheet, kpi, kIdx, cfg));

  currentRow += 2;
  sheet.row(currentRow).height(12);
  return currentRow + 1;
}

function _renderHeaders(sheet, headers, currentRow) {
  const headerRow = sheet.row(currentRow);
  headerRow.height(26);

  for (let cIdx = 1; cIdx <= headers.length; cIdx++) {
    const hCell = headerRow.cell(cIdx);
    hCell.value(headers[cIdx - 1]);
    hCell.style({
      fontFamily: 'Segoe UI', fontSize: 9, bold: true, fontColor: '1E293B', fill: 'EEF2F6',
      topBorder: 'thin', topBorderColor: 'CBD5E1', leftBorder: 'thin', leftBorderColor: 'CBD5E1',
      rightBorder: 'thin', rightBorderColor: 'CBD5E1', bottomBorder: 'medium', bottomBorderColor: '94A3B8',
      horizontalAlignment: 'left', verticalAlignment: 'center', wrapText: true
    });
  }
  return currentRow + 1;
}

function _applyFormatToCell(cell, cellVal, format) {
  if (format === 'currency') {
    cell.style('numberFormat', '"$"#,##0');
    cell.style('horizontalAlignment', 'right');
  } else if (format === 'percent') {
    cell.style('numberFormat', '0.0%');
    cell.style('horizontalAlignment', 'right');
  } else if (format === 'integer') {
    cell.style('numberFormat', '#,##0');
    cell.style('horizontalAlignment', 'right');
  } else if (format === 'duration_hrs') {
    cell.style('numberFormat', '0.0 "hrs"');
    cell.style('horizontalAlignment', 'right');
  } else if (format === 'duration_mins') {
    cell.style('numberFormat', '0 "mins"');
    cell.style('horizontalAlignment', 'right');
  } else if (typeof cellVal === 'number') {
    if (cellVal > 0 && cellVal < 1) {
      cell.style('numberFormat', '0.0%');
      cell.style('horizontalAlignment', 'right');
    } else if (Number.isInteger(cellVal)) {
      cell.style('numberFormat', '#,##0');
      cell.style('horizontalAlignment', 'right');
    }
  }
}

function _applyStatusHighlight(cell, strVal) {
  if (/(?:DEPRECATED|CRITICAL|FAILED|HIGH|ERROR|EOS|EOL)/i.test(strVal)) {
    cell.style({ fill: 'FEE2E2', fontColor: '991B1B', bold: true, fontSize: 8.5, horizontalAlignment: 'center' });
  } else if (/(?:ACTIVE|HEALTHY|OPERATIONAL|SUCCESS|PASSED|STABLE)/i.test(strVal)) {
    cell.style({ fill: 'DCFCE7', fontColor: '166534', bold: true, fontSize: 8.5, horizontalAlignment: 'center' });
  } else if (/(?:TIER|CORE|PRIMARY)/i.test(strVal)) {
    cell.style({ fill: 'E0E7FF', fontColor: '3730A3', bold: true, fontSize: 8.5, horizontalAlignment: 'center' });
  } else if (/(?:WARNING|PENDING|MIGRATING|SPOT)/i.test(strVal)) {
    cell.style({ fill: 'FEF3C7', fontColor: '92400E', bold: true, fontSize: 8.5, horizontalAlignment: 'center' });
  }
}

function _renderSingleRowCell(cell, cellVal, zebraBg, colDef) {
  if (cellVal && typeof cellVal === 'object' && cellVal.formula) {
    cell.formula(sanitizeFormula(cellVal.formula).replace(/^=/, ''));
  } else {
    cell.value(cellVal);
  }

  cell.style({
    fontFamily: 'Segoe UI', fontSize: 9, fontColor: '0F172A', fill: zebraBg,
    topBorder: 'thin', topBorderColor: 'CBD5E1', bottomBorder: 'thin', bottomBorderColor: 'CBD5E1',
    leftBorder: 'thin', leftBorderColor: 'CBD5E1', rightBorder: 'thin', rightBorderColor: 'CBD5E1',
    horizontalAlignment: 'left', verticalAlignment: 'center'
  });

  _applyFormatToCell(cell, cellVal, colDef?.format);
  const strVal = String(typeof cellVal === 'object' && cellVal?.result !== undefined ? cellVal.result : (cellVal || ''));
  _applyStatusHighlight(cell, strVal);
}

function _renderDataRows(sheet, rows, sheetDef, currentRow) {
  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const rowData = rows[rIdx];
    const row = sheet.row(currentRow);
    row.height(20);
    const zebraBg = rIdx % 2 === 1 ? 'F8FAFC' : 'FFFFFF';

    for (let cIdx = 0; cIdx < rowData.length; cIdx++) {
      const cell = row.cell(cIdx + 1);
      const colDef = sheetDef.columns?.[cIdx];
      _renderSingleRowCell(cell, rowData[cIdx], zebraBg, colDef);
    }
    currentRow++;
  }
  return currentRow;
}

function _renderSummary(sheet, sheetDef, currentRow) {
  if (!sheetDef.summary) return currentRow;
  const sumRow = sheet.row(currentRow);
  sumRow.height(22);

  for (let cIdx = 0; cIdx < sheetDef.summary.length; cIdx++) {
    const item = sheetDef.summary[cIdx];
    const cell = sumRow.cell(cIdx + 1);
    if (item && typeof item === 'object' && item.formula) {
      cell.formula(sanitizeFormula(item.formula).replace(/^=/, ''));
    } else {
      cell.value(item);
    }

    cell.style({
      fontFamily: 'Segoe UI', fontSize: 9.5, bold: true, fontColor: '0F172A', fill: 'F1F5F9',
      topBorder: 'thin', topBorderColor: 'CBD5E1', bottomBorder: 'double', bottomBorderColor: '64748B',
      leftBorder: 'thin', leftBorderColor: 'CBD5E1', rightBorder: 'thin', rightBorderColor: 'CBD5E1',
      horizontalAlignment: 'left', verticalAlignment: 'center'
    });

    _applyFormatToCell(cell, item, sheetDef.columns?.[cIdx]?.format);
  }
  return currentRow + 1;
}

function _renderSingleSheet(workbook, sheetDef, sIdx) {
  const headers = sheetDef.headers || [];
  const rows = sheetDef.rows || [];
  const sheet = sIdx === 0 ? workbook.sheet(0).name(sheetDef.name || 'Sheet1') : workbook.addSheet(sheetDef.name || `Sheet${sIdx + 1}`);

  let ySplit = 1;
  if (sheetDef.kpi_cards?.length > 0) ySplit = sheetDef.title ? 6 : 4;
  else if (sheetDef.title) ySplit = sheetDef.subtitle ? 4 : 3;
  try { sheet.freezePanes(0, ySplit); } catch (_) { /* ignore */ }

  let currentRow = _renderSheetTitle(sheet, sheetDef, headers, 1);
  currentRow = _renderSheetKpiCards(sheet, sheetDef, headers, currentRow);

  if (sheetDef.section_title) {
    const secCell = sheet.row(currentRow).cell(1);
    secCell.value(sheetDef.section_title);
    secCell.style({ fontFamily: 'Segoe UI', fontSize: 11, bold: true, fontColor: '1E293B' });
    sheet.row(currentRow).height(24);
    currentRow++;
  }

  const headerRowIdx = currentRow;
  currentRow = _renderHeaders(sheet, headers, currentRow);
  const endDataRow = _renderDataRows(sheet, rows, sheetDef, currentRow) - 1;

  if (sheetDef.auto_filter !== false && headers.length > 0 && rows.length > 0) {
    try { sheet.autoFilter(sheet.range(headerRowIdx, 1, endDataRow, headers.length)); } catch (_) { /* ignore */ }
  }

  _renderSummary(sheet, sheetDef, endDataRow + 1);

  headers.forEach((h, idx) => {
    let maxLen = h ? Math.max(14, String(h).length + 4) : 14;
    if (sheetDef.columns?.[idx]?.width) maxLen = sheetDef.columns[idx].width;
    try { sheet.column(idx + 1).width(maxLen); } catch (_) { /* ignore */ }
  });
}

async function spreadsheetCreate(options = {}) {
  const outputPath = resolveDynamicOutputPath(options.output_path, 'spreadsheet.xlsx');
  const XlsxPopulate = getXlsxPopulate();
  const workbook = await XlsxPopulate.fromBlankAsync();

  if (options.author) {
    try {
      workbook.property('Author', options.author);
      workbook.property('LastModifiedBy', options.author);
    } catch (_) { /* ignore */ }
  }

  const sheets = options.sheets || [
    {
      name: 'Overview',
      title: 'Operations & Performance Matrix',
      headers: ['Component', 'Region', 'Requests/sec', 'Latency P99', 'Status'],
      rows: [
        ['Edge Gateway', 'us-east-1', 14200, 4.2, 'Operational'],
        ['Core Ingress', 'us-west-2', 12800, 3.8, 'Operational'],
        ['Redis Cluster', 'us-east-1', 45000, 1.1, 'Operational']
      ]
    }
  ];

  for (let sIdx = 0; sIdx < sheets.length; sIdx++) {
    _renderSingleSheet(workbook, sheets[sIdx], sIdx);
  }

  await workbook.toFileAsync(outputPath);
  try {
    const buf = fs.readFileSync(outputPath);
    if (buf.includes('Sh33tJ5')) {
      throw new Error('Supply-chain security violation: Sh33tJ5 anomalous marker detected in spreadsheet output');
    }
  } catch (err) {
    if (err.message.includes('Supply-chain security violation')) throw err;
  }

  return { success: true, file_path: outputPath, sheet_count: sheets.length };
}

module.exports = {
  spreadsheetCreate,
  sanitizeFormula
};
