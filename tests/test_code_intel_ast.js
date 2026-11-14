'use strict';

/**
 * Test Suite: Tree-sitter WASM AST parsing across all 11 locked MIT languages,
 * structured Markdown/config splitters, scope-aware chunking, .gitignore filters,
 * and content_kind classification.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-code-intel-ast-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'ast.db');

const { parseFileAsync, getParserVersion } = require('../src/code_intel/parser_wasm');
const { buildChunks } = require('../src/code_intel/chunker');
const { CHUNK_MAX_LINES, CHUNK_MAX_CHARS, CHUNK_OVERLAP_LINES } = require('../src/code_intel/config');
const { walk } = require('../src/code_intel/walker');

const GRAMMAR_SAMPLES = [
  {
    lang: 'javascript',
    rel: 'mod.js',
    code: "import fs from 'node:fs';\nexport * from './reexp';\nclass JsService { run() { return fs.existsSync('.'); } }\nconst helper = () => 1;\n",
    expectedSymbols: ['JsService', 'run', 'helper'],
    expectedImportSpec: 'node:fs'
  },
  {
    lang: 'typescript',
    rel: 'svc.ts',
    code: "import type { Req } from './types';\ninterface Token { id: string; }\nexport class SessionSvc extends BaseSvc implements Disposable { getId(): string { return 'a'; } }\n",
    expectedSymbols: ['Token', 'SessionSvc', 'getId'],
    expectedImportSpec: './types'
  },
  {
    lang: 'tsx',
    rel: 'Card.tsx',
    code: "import React from 'react';\nexport function ProfileCard() { return <div><span>ok</span></div>; }\n",
    expectedSymbols: ['ProfileCard'],
    expectedImportSpec: 'react'
  },
  {
    lang: 'python',
    rel: 'cache.py',
    code: "from pkg.core import helpers\nclass Cache:\n    def get(self, key):\n        return helpers(key)\n",
    expectedSymbols: ['Cache', 'get'],
    expectedImportSpec: 'pkg.core'
  },
  {
    lang: 'go',
    rel: 'srv.go',
    code: 'package app\nimport "github.com/acme/repo/internal/auth"\ntype Server struct{}\nfunc (s *Server) Start() error { return nil }\n',
    expectedSymbols: ['Server', 'Start'],
    expectedImportSpec: 'github.com/acme/repo/internal/auth'
  },
  {
    lang: 'rust',
    rel: 'lib.rs',
    code: 'use crate::core::engine;\npub trait Runnable { fn run(&self); }\npub struct Engine {}\nimpl Runnable for Engine { fn run(&self) {} }\n',
    expectedSymbols: ['Runnable', 'Engine'],
    expectedImportSpec: 'crate::core::engine'
  },
  {
    lang: 'java',
    rel: 'AuthController.java',
    code: 'import com.acme.core.Service;\npublic class AuthController {\n  public void login() {}\n}\n',
    expectedSymbols: ['AuthController', 'login'],
    expectedImportSpec: 'com.acme.core.Service'
  },
  {
    lang: 'c',
    rel: 'buf.c',
    code: '#include "header.h"\nstruct Buffer { int len; };\nint compute_sum(int a, int b) { return a + b; }\n',
    expectedSymbols: ['Buffer', 'compute_sum'],
    expectedImportSpec: 'header.h'
  },
  {
    lang: 'cpp',
    rel: 'runner.cpp',
    code: '#include <vector>\nnamespace engine {\nclass Runner { public: void step(); };\nvoid Runner::step() {}\n}\n',
    expectedSymbols: ['engine', 'Runner', 'step'],
    expectedImportSpec: 'vector'
  },
  {
    lang: 'shell',
    rel: 'deploy.sh',
    code: 'source ./env.sh\nfunction deploy_app() {\n  echo "ok"\n}\n',
    expectedSymbols: ['deploy_app'],
    expectedImportSpec: './env.sh'
  },
  {
    lang: 'sql',
    rel: 'schema.sql',
    code: 'CREATE TABLE users (id INTEGER PRIMARY KEY);\nCREATE VIEW active_users AS SELECT id FROM users;\n',
    expectedSymbols: ['users', 'active_users'],
    expectedImportSpec: null
  }
];

async function testAll11WasmGrammars() {
  const parserVer = getParserVersion();
  assert.ok(parserVer.startsWith('ts-wasm-v1-'), `Unexpected parser version: ${parserVer}`);

  for (const sample of GRAMMAR_SAMPLES) {
    const parsed = await parseFileAsync(sample.code, sample.lang, sample.rel);
    assert.strictEqual(parsed.parseEngine, 'tree-sitter-wasm', `${sample.lang} must use WASM engine`);
    const names = parsed.symbols.map((s) => s.name);
    for (const expected of sample.expectedSymbols) {
      assert.ok(names.includes(expected), `${sample.lang} missing symbol '${expected}' (got ${names.join(', ')})`);
    }
    if (sample.expectedImportSpec) {
      const specs = (parsed.imports || []).map((i) => i.specifier);
      assert.ok(
        specs.includes(sample.expectedImportSpec),
        `${sample.lang} missing import '${sample.expectedImportSpec}' (got ${specs.join(', ')})`
      );
    }
  }
  console.log('✓ All 11 MIT Tree-sitter WASM grammars parsed symbols and imports accurately');
}

async function testStructuredDocsAndConfigs() {
  const md = [
    '# System Architecture',
    'Overview paragraph.',
    '```markdown',
    '# FakeHeadingInsideFence',
    '```',
    '## Indexing Engine',
    'Tree-sitter pipeline.',
    '~~~',
    '## AnotherFakeHeading',
    '~~~',
    '### Chunk Boundaries',
    'Scope details.'
  ].join('\n');
  const mdParsed = await parseFileAsync(md, 'markdown', 'docs/ARCH.md');
  assert.strictEqual(mdParsed.parseEngine, 'structured-markdown');
  const mdNames = mdParsed.symbols.map((s) => s.name);
  assert.deepStrictEqual(mdNames, ['System Architecture', 'Indexing Engine', 'Chunk Boundaries']);
  const chunkSec = mdParsed.symbols.find((s) => s.name === 'Chunk Boundaries');
  assert.strictEqual(chunkSec.parentName, 'Indexing Engine');

  const jsonParsed = await parseFileAsync('{\n  "name": "konoha",\n  "scripts": {}\n}\n', 'json', 'package.json');
  assert.strictEqual(jsonParsed.parseEngine, 'structured-config');
  assert.deepStrictEqual(jsonParsed.symbols.map((s) => s.name), ['name', 'scripts']);

  const yamlParsed = await parseFileAsync('service: api\nports:\n  - 8080\n', 'yaml', 'app.yml');
  assert.deepStrictEqual(yamlParsed.symbols.map((s) => s.name), ['service', 'ports']);

  const tomlParsed = await parseFileAsync('[package]\nname = "demo"\n[dependencies]\nfoo = "1"\n', 'toml', 'Cargo.toml');
  assert.deepStrictEqual(tomlParsed.symbols.map((s) => s.name), ['package', 'dependencies']);

  console.log('✓ Structured Markdown (fence-safe) and JSON/YAML/TOML extractors verified');
}

async function testScopeAwareChunking() {
  const methodBlocks = Array.from({ length: 12 }, (_, idx) => (
    `  method${idx}() {\n    const a = ${idx};\n    const b = a + 1;\n    return b;\n  }\n`
  )).join('\n');
  const src = [
    '/** Docstring attached cleanly to BigService. */',
    'class BigService {',
    methodBlocks,
    '}',
    ''
  ].join('\n');

  const parsed = await parseFileAsync(src, 'javascript', 'big.js');
  const limits = { CHUNK_MAX_LINES, CHUNK_MAX_CHARS, CHUNK_OVERLAP_LINES };
  const chunks = buildChunks(src, parsed.symbols, limits);
  assert.ok(chunks.length >= 2, 'Oversized class should split along child methods cleanly');
  assert.ok(chunks[0].body.includes('/** Docstring attached cleanly'), 'Leading docstring must stay with class header');
  for (const ch of chunks) {
    assert.ok(ch.contentHash && ch.contentHash.length === 24, 'Each chunk must carry normalized contentHash');
  }
  console.log('✓ Scope-aware chunking preserved leading docstrings and split oversized class');
}

function testGitignoreAndContentKind() {
  const repo = path.join(tmpRoot, 'walker_repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\ndist/\n!dist/keep.js\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'function a() {}\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'tests', 'app.test.js'), 'test("x", () => {});\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'docs', 'GUIDE.md'), '# Guide\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'config.yaml'), 'mode: prod\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'debug.log'), 'ignored\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'dist', 'bundle.js'), 'ignored\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'dist', 'keep.js'), 'export const ok = 1;\n', 'utf8');

  const walked = walk(repo);
  const byRel = new Map(walked.files.map((f) => [f.relPath, f]));
  assert.ok(byRel.has('src/app.js'));
  assert.strictEqual(byRel.get('src/app.js').contentKind, 'code');
  assert.strictEqual(byRel.get('tests/app.test.js').contentKind, 'test');
  assert.strictEqual(byRel.get('docs/GUIDE.md').contentKind, 'docs');
  assert.strictEqual(byRel.get('config.yaml').contentKind, 'config');
  assert.strictEqual(byRel.has('dist/bundle.js'), false, 'dist/ must exclude bundle.js');
  console.log('✓ .gitignore filtering and content_kind classification verified');
}

(async () => {
  try {
    console.log('Running test_code_intel_ast tests...');
    await testAll11WasmGrammars();
    await testStructuredDocsAndConfigs();
    await testScopeAwareChunking();
    testGitignoreAndContentKind();
    console.log('test_code_intel_ast passed cleanly.');
  } catch (err) {
    console.error('test_code_intel_ast failed:', err);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
})();
