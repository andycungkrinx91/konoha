#!/usr/bin/env node
'use strict';

// xlsx-populate ships `lodash` (1051 files) only for 27 helpers and never touches
// its `template`/`Function` sink. patches/xlsx-populate@1.21.0.patch replaces it
// with lib/lodash-lite.js. This suite pins the helper semantics against lodash 4
// and proves the patched workbook writer still produces a valid, feature-complete
// XLSX.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const XP_DIR = path.join(ROOT, 'node_modules', 'xlsx-populate');

console.log('Running test_xlsx_populate_lodash_lite: patched xlsx-populate lodash subset...');

assert.ok(fs.existsSync(XP_DIR), 'xlsx-populate must be installed (run pnpm install)');
const lite = require(path.join(XP_DIR, 'lib', 'lodash-lite.js'));

// --- 1. The real lodash must not be reachable from xlsx-populate -------------
let lodashResolved = null;
try {
  lodashResolved = require.resolve('lodash', { paths: [XP_DIR] });
} catch (_) {
  lodashResolved = null;
}
assert.strictEqual(lodashResolved, null, `lodash must not resolve from xlsx-populate, got ${lodashResolved}`);

const xpManifest = JSON.parse(fs.readFileSync(path.join(XP_DIR, 'package.json'), 'utf8'));
assert.strictEqual(xpManifest.dependencies.lodash, undefined, 'patched xlsx-populate must not declare lodash');
assert.strictEqual(xpManifest.browser, undefined, 'patched xlsx-populate must drop the pre-bundled browser build');
console.log('  ok   lodash unreachable from xlsx-populate');

// --- 2. Helper semantics (expected values captured from lodash@4.18.1) ------
const cases = [
  ['assign', [{ a: 1 }, { b: 2 }, { a: 3 }], { a: 3, b: 2 }],
  ['assign', [{}, null, undefined, { x: 1 }], { x: 1 }],
  ['defaults', [{ a: 1 }, { a: 2, b: 2 }, { c: 3 }], { a: 1, b: 2, c: 3 }],
  ['defaults', [{}, { a: undefined }, { a: 5 }], { a: 5 }],
  ['clone', [[1, 2, 3]], [1, 2, 3]],
  ['clone', [{ a: { b: 1 } }], { a: { b: 1 } }],
  ['clone', [null], null],
  ['clone', [5], 5],
  ['cloneDeep', [{ a: { b: [1, { c: 2 }] }, d: 'x' }], { a: { b: [1, { c: 2 }] }, d: 'x' }],
  ['cloneDeep', [[1, [2, [3]]]], [1, [2, [3]]]],
  ['escapeRegExp', ['a.b*c+d?e(f)g[h]i{j}k|l\\m^n$o'], 'a\\.b\\*c\\+d\\?e\\(f\\)g\\[h\\]i\\{j\\}k\\|l\\\\m\\^n\\$o'],
  ['escapeRegExp', ['plain'], 'plain'],
  ['isArray', [[]], true],
  ['isArray', [{}], false],
  ['isObject', [() => {}], true],
  ['isObject', [null], false],
  ['isObject', [[]], true],
  ['isFunction', [() => {}], true],
  ['isFunction', ['x'], false],
  ['isEmpty', [{}], true],
  ['isEmpty', [{ a: 1 }], false],
  ['isEmpty', ['abc'], false],
  ['isEmpty', [[1]], false],
  ['isEmpty', [null], true],
  ['isNil', [undefined], true],
  ['isNil', [0], false],
  ['isNumber', [NaN], true],
  ['isNumber', ['1'], false],
  ['isInteger', [1.5], false],
  ['isInteger', [-0], true],
  ['isInteger', ['1'], false],
  ['isNaN', [NaN], true],
  ['isNaN', ['NaN'], false],
  ['isNaN', [1], false],
  ['isEqual', [{ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }], true],
  ['isEqual', [{ a: 1 }, { a: 2 }], false],
  ['isEqual', [[1, 2], [1, 2, 3]], false],
  ['isEqual', [NaN, NaN], true],
  ['isEqual', [null, undefined], false],
  ['isEqual', [new Date(0), new Date(0)], true],
  ['values', [{ a: 1, b: 2 }], [1, 2]],
  ['values', [[3, 4]], [3, 4]],
  ['values', [null], []],
  ['mapValues', [{ a: 1, b: 2 }, (v) => v * 2], { a: 2, b: 4 }],
  ['mapValues', [null, (v) => v], {}],
  ['forEach', [[1, 2], (v) => v], [1, 2]],
  ['map', [[1, 2, 3], (v) => v * 2], [2, 4, 6]],
  ['map', [{ a: 1, b: 2 }, (v, k) => `${k}${v}`], ['a1', 'b2']],
  ['filter', [[1, 2, 3, 4], (v) => v % 2 === 0], [2, 4]],
  ['filter', [{ a: 1, b: 2, c: 3 }, (v) => v > 1], [2, 3]],
  ['find', [[{ name: 'x' }, { name: 'y' }], { name: 'y' }], { name: 'y' }],
  ['find', [[{ name: 'x' }], { name: 'z' }], undefined],
  ['find', [[{ v: 1 }, { v: 3 }], (r) => r.v === 3], { v: 3 }],
  ['find', [[{ v: 1 }]], { v: 1 }],
  ['findIndex', [[0, 0, 3, 0]], 2],
  ['findIndex', [[1, 2, 3], (v) => v > 1], 1],
  ['findIndex', [[]], -1],
  ['every', [[1, 2], (v) => v > 0], true],
  ['every', [[], (v) => v > 0], true],
  ['every', [{ a: 1 }, (v) => v > 0], true],
  ['some', [[{ name: 'x' }], { name: 'x' }], true],
  ['some', [[{ name: 'x' }], { name: 'q' }], false],
  // xlsx-populate keeps rows and column nodes in index-keyed sparse arrays. lodash visits the
  // holes; Array.prototype.forEach/map skip them, so a native swap would drop whole rows.
  ['forEach', [Object.assign(new Array(3), { 2: 'c' }), () => {}], Object.assign(new Array(3), { 2: 'c' })],
  ['map', [Object.assign(new Array(3), { 2: 'c' }), (v) => v], [undefined, undefined, 'c']],
  ['filter', [Object.assign(new Array(3), { 1: 'b' }), (v) => v === 'b'], ['b']],
  ['some', [[1, 2], (v) => v > 3], false],
  ['remove', [[{ name: 'a', v: 1 }, { name: 'b', v: 2 }, { name: 'a', v: 3 }], { name: 'a' }], [{ name: 'a', v: 1 }, { name: 'a', v: 3 }]],
  ['remove', [[1, 2, 3, 4], (v) => v % 2 === 0], [2, 4]],
  ['includes', [[1, 2, 3], 2], true],
  ['includes', [[1, 2, 3], 4], false],
  ['includes', ['hello\nworld', '\n'], true],
  ['includes', [{ a: 1, b: 2 }, 2], true],
  ['includes', [[NaN], NaN], true],
  ['sortBy', [['c', 'a', 'b']], ['a', 'b', 'c']],
  ['sortBy', [[{ v: 3 }, { v: 1 }, { v: 2 }], 'v'], [{ v: 1 }, { v: 2 }, { v: 3 }]],
  ['sortBy', [[{ v: 3 }, { v: 1 }, { v: 2 }], (o) => o.v], [{ v: 1 }, { v: 2 }, { v: 3 }]],
  ['sortBy', [[{ a: 1, b: 2 }, { a: 1, b: 1 }, { a: 0, b: 5 }], ['a', 'b']], [{ a: 0, b: 5 }, { a: 1, b: 1 }, { a: 1, b: 2 }]]
];

for (const [fn, args, expected] of cases) {
  assert.strictEqual(typeof lite[fn], 'function', `lodash-lite must export ${fn}`);
  const actual = lite[fn](...args);
  assert.deepStrictEqual(actual, expected, `lodash-lite.${fn}(${args.map((a) => (typeof a === 'function' ? '[fn]' : JSON.stringify(a))).join(', ')})`);
}

// remove() mutates its input, exactly like lodash.
const mutable = [1, 2, 3, 4];
lite.remove(mutable, (v) => v % 2 === 0);
assert.deepStrictEqual(mutable, [1, 3], 'lodash-lite.remove must mutate the source array');
console.log(`  ok   ${cases.length} helper semantics match lodash 4`);

// --- 3. Workbook round-trip through the real engine -------------------------
(async () => {
  const { spreadsheetCreate } = require(path.join(ROOT, 'src', 'workflow', 'tokubetsu-scribe', 'doc_engine_spreadsheet.js'));
  const XlsxPopulate = require(XP_DIR);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-xlsx-lite-'));
  const outputPath = path.join(tmpDir, 'roundtrip.xlsx');

  try {
    const result = await spreadsheetCreate({
      output_path: outputPath,
      author: 'Konoha Regression',
      sheets: [{
        name: 'Posture',
        title: 'Dependency Posture Matrix',
        subtitle: 'Patched xlsx-populate with a lodash-free helper subset',
        headers: ['Component', 'Requests/sec', 'Latency P99', 'Status'],
        kpi_cards: [
          { label: 'Throughput', value: '14200', formula: '=SUM(B8:B10)' },
          { label: 'P99', value: '4.2', formula: '=AVERAGE(C8:C10)' }
        ],
        rows: [
          ['Edge Gateway', 14200, 4.2, 'Operational'],
          ['Core Ingress', 12800, 3.8, 'Degraded'],
          ['Redis Cluster', 45000, 1.1, 'Operational']
        ],
        summary: [{ formula: '=SUM(B8:B10)' }, { formula: '=AVERAGE(C8:C10)' }, null, null],
        columns: [{ width: 24 }, { width: 18, format: 'number' }, { width: 18, format: 'number' }, { width: 16 }]
      }]
    });

    assert.strictEqual(result.success, true, 'spreadsheetCreate must succeed');
    assert.strictEqual(result.sheet_count, 1);
    assert.ok(fs.existsSync(outputPath), 'workbook file must be written');
    assert.ok(fs.statSync(outputPath).size > 2000, 'workbook must not be a stub');

    const workbook = await XlsxPopulate.fromFileAsync(outputPath);
    const sheet = workbook.sheet('Posture');
    assert.ok(sheet, 'sheet must round-trip by name');

    // Title + subtitle merges (lodash `cloneDeep`/`isEqual` paths in Sheet.js).
    assert.strictEqual(sheet.merged('A1:E1'), true, 'title row must stay merged');
    assert.strictEqual(sheet.merged('A2:E2'), true, 'subtitle row must stay merged');
    assert.strictEqual(sheet.merged('A8:D8'), false, 'data rows must stay unmerged');

    // Freeze panes (Sheet.js freezePanes → pane attributes via clone/assign).
    assert.strictEqual(typeof sheet.freezePanes, 'function');

    // Data cells, formulas and styles survive the write (Style.js `mapValues`/`forOwn`).
    assert.strictEqual(sheet.cell('A8').value(), 'Edge Gateway');
    assert.strictEqual(sheet.cell('B9').value(), 12800);
    assert.strictEqual(sheet.cell('D10').value(), 'Operational');
    const summaryCell = sheet.cell('A11');
    assert.ok(
      String(summaryCell.formula() || '').toUpperCase().includes('SUM'),
      `summary formula must survive, got ${summaryCell.formula()}`
    );
    assert.strictEqual(String(sheet.cell('A7').style('bold')), 'true', 'header cell must stay bold');

    // Autofilter + freeze panes survive as OOXML (Sheet.js `_.includes`/`_.values`/`_.remove` paths).
    const JSZip = require(require.resolve('jszip', { paths: [fs.realpathSync(XP_DIR)] }));
    const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    assert.ok(/<autoFilter ref="A7:D10"\/>/.test(sheetXml), `autoFilter must survive, got ${sheetXml.match(/<autoFilter[^>]*>/)}`);
    assert.ok(/<pane[^>]*state="frozen"/.test(sheetXml), 'freeze panes must survive as a frozen pane element');
    assert.ok(/<mergeCell ref="A1:E1"\/>/.test(sheetXml), 'title merge must survive');
    assert.ok(/<f>SUM\(B8:B10\)<\/f>/.test(sheetXml), 'summary formula must survive in the XML');

    // The workbook must not carry the historical supply-chain marker.
    const buf = fs.readFileSync(outputPath);
    assert.strictEqual(buf.includes('Sh33tJ5'), false, 'workbook must not contain the Sh33tJ5 marker');

    console.log('  ok   xlsx round-trip preserves merges, formulas, styles, autofilter');
    console.log('\nAll test_xlsx_populate_lodash_lite checks passed successfully!');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error('test_xlsx_populate_lodash_lite FAILED:', err.message);
  process.exit(1);
});
