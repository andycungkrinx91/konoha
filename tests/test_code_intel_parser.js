/**
 * Test Suite: code-intelligence parser.
 *
 * The parser is a hand-written lexer, so the failure modes worth pinning are
 * the ones a lexer gets wrong: string and comment contents leaking into the
 * reference table, regex literals swallowing the rest of a line, symbol spans
 * that stop at the opening brace, and methods being reported as top-level
 * functions.
 */

'use strict';

const assert = require('assert');
const { detectLanguage, parseFile, buildChunks, tokenize } = require('../src/code_intel/parser');

const LIMITS = { CHUNK_MAX_LINES: 40, CHUNK_MAX_CHARS: 2000, CHUNK_OVERLAP_LINES: 8 };

function names(symbols, kind) {
  return symbols.filter((s) => !kind || s.kind === kind).map((s) => s.name);
}

function run() {
  console.log('Running test_code_intel_parser tests...');

  // --- Language detection -------------------------------------------------
  assert.strictEqual(detectLanguage('a/b.ts'), 'typescript');
  assert.strictEqual(detectLanguage('a/b.py'), 'python');
  assert.strictEqual(detectLanguage('Makefile'), null);
  assert.strictEqual(detectLanguage('a.min.js'), 'javascript', 'detectLanguage keys off the final extension only');

  // --- JavaScript symbols and spans --------------------------------------
  const js = `
import fs from 'fs';

const helper = (x) => x * 2;

class Store {
  constructor(db) { this.db = db; }
  load(id) {
    return helper(this.db.get(id));
  }
  static create() { return new Store(null); }
}

function topLevel(a, b) { return helper(a) + b; }
export default function main() { return topLevel(1, 2); }
`;
  const parsed = parseFile(js, 'javascript');
  assert.deepStrictEqual(names(parsed.symbols).sort(),
    ['Store', 'constructor', 'create', 'helper', 'load', 'main', 'topLevel'].sort());

  const store = parsed.symbols.find((s) => s.name === 'Store');
  assert.strictEqual(store.kind, 'class');
  assert.strictEqual(store.startLine, 6);
  assert.strictEqual(store.endLine, 12, 'Class span must reach the closing brace, not stop at the opening one');

  const load = parsed.symbols.find((s) => s.name === 'load');
  assert.strictEqual(load.kind, 'method', 'A method inside a class must not be reported as a function');
  assert.strictEqual(load.parentName, 'Store');
  assert.strictEqual(load.endLine, 10, 'Method span must cover its body');

  const helper = parsed.symbols.find((s) => s.name === 'helper');
  assert.strictEqual(helper.kind, 'function');
  assert.strictEqual(helper.endLine, 4, 'Arrow-function span must cover the expression body');

  // --- Declarations are not references -----------------------------------
  assert.ok(!parsed.refs.some((r) => r.targetName === 'Store' && r.line === 6),
    'The class declaration line must not be indexed as a reference');
  assert.ok(parsed.refs.some((r) => r.targetName === 'Store' && r.kind === 'call'),
    '`new Store(null)` must be indexed as a call');
  const helperCalls = parsed.refs.filter((r) => r.targetName === 'helper' && r.kind === 'call');
  assert.ok(helperCalls.length >= 2, 'Both helper(...) call sites must be recorded');

  // --- String and comment bodies must not leak identifiers ----------------
  const leaky = `
// ghostInComment should not appear
/* ghostInBlockComment too */
const s = "ghostInString";
const t = 'ghostInSingle';
function real() { return 1; }
`;
  const leakParsed = parseFile(leaky, 'javascript');
  for (const ghost of ['ghostInComment', 'ghostInBlockComment', 'ghostInString', 'ghostInSingle']) {
    assert.ok(!leakParsed.refs.some((r) => r.targetName === ghost),
      `${ghost} must not be indexed: string and comment contents are not code`);
  }
  assert.ok(names(leakParsed.symbols).includes('real'));

  // --- Regex literals must not swallow the rest of the line --------------
  const regexSrc = `
const re = /[a-z]+\\/ghostInRegex/g;
function afterRegex() { return re; }
`;
  const regexParsed = parseFile(regexSrc, 'javascript');
  assert.ok(!regexParsed.refs.some((r) => r.targetName === 'ghostInRegex'),
    'Regex literal bodies must be skipped');
  assert.ok(names(regexParsed.symbols).includes('afterRegex'),
    'A regex literal must not consume the following declaration');

  // --- Unterminated block must not throw --------------------------------
  const broken = 'function broken() { if (x) { return 1; }';
  const brokenParsed = parseFile(broken, 'javascript');
  assert.ok(names(brokenParsed.symbols).includes('broken'),
    'An unbalanced file must still yield its symbols');

  // --- Python ------------------------------------------------------------
  const py = `
import os

class Widget:
    def render(self):
        return os.name

    def resize(self, n):
        if n:
            return n
        return 0

def main():
    w = Widget()
    return w.render()
`;
  const pyParsed = parseFile(py, 'python');
  assert.deepStrictEqual(names(pyParsed.symbols).sort(), ['Widget', 'main', 'render', 'resize']);
  const render = pyParsed.symbols.find((s) => s.name === 'render');
  assert.strictEqual(render.startLine, 5);
  assert.strictEqual(render.endLine, 6, 'Indent-based span must stop at the dedent');
  const resize = pyParsed.symbols.find((s) => s.name === 'resize');
  assert.strictEqual(resize.endLine, 11, 'Indent-based span must include nested blocks');
  assert.ok(pyParsed.refs.some((r) => r.targetName === 'Widget' && r.kind === 'call'));

  // --- Unsupported languages return empty, never throw -------------------
  const unknown = parseFile('SELECT 1;', 'sql');
  assert.deepStrictEqual(unknown, { symbols: [], refs: [] });
  assert.deepStrictEqual(parseFile('x', 'cobol'), { symbols: [], refs: [] });

  // --- Chunking ----------------------------------------------------------
  const longSrc = Array.from({ length: 200 }, (_, i) => `line${i + 1}()`).join('\n');
  const chunks = buildChunks(longSrc, [], LIMITS);
  assert.ok(chunks.length > 1, 'A 200-line file must split into multiple chunks');
  for (const c of chunks) {
    assert.ok(c.endLine - c.startLine + 1 <= LIMITS.CHUNK_MAX_LINES, 'Chunk must respect the line cap');
    assert.ok(c.body.length <= LIMITS.CHUNK_MAX_CHARS, 'Chunk must respect the character cap');
  }
  assert.ok(chunks.some((c) => c.startLine > 1), 'Chunks must advance rather than restart at line 1');

  // Nested symbols are covered by the outer chunk, not duplicated inside it.
  const nested = buildChunks(js, parsed.symbols, LIMITS);
  const coveringLoad = nested.filter((c) => c.startLine <= 9 && c.endLine >= 9);
  assert.strictEqual(coveringLoad.length, 1, 'A method must be covered by exactly one chunk, not one per symbol');

  // --- Tokenizer line accounting ----------------------------------------
  const multiline = 'const a = `line1\nline2\nline3`;\nconst b = 1;\n';
  const tokens = tokenize(multiline, 'javascript');
  const bToken = tokens.find((t) => t.v === 'b');
  assert.strictEqual(bToken.line, 4, 'Newlines inside template literals must advance the line counter');

  console.log('✓ Parser symbols, spans, refs, chunking, and line accounting verified.');
}

run();
