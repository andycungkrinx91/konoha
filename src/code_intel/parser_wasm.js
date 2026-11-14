'use strict';

/**
 * Web-Tree-Sitter WASM AST parser and structured Markdown/config extractor.
 *
 * Loads only offline MIT grammars pinned in `assets/grammars/grammars.lock.json`
 * and verifies SHA-256 digests on both `tree-sitter.wasm` and every language
 * grammar before `Language.load(bytes)`.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CHUNK_SCHEMA_VERSION } = require('./chunker');
const { parseFile: parseFallback } = require('./lexer_fallback');
const { walkAst, parseMarkdownStructured, parseConfigStructured } = require('./ast_inspectors');

const EXTRACTOR_VERSION = 'ast-extract-v1';
const GRAMMARS_DIR_ENV = 'KONOHA_GRAMMARS_DIR';

const GRAMMAR_BY_EXT = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.tsx': 'tsx',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c', '.h': 'c',
  '.cc': 'cpp', '.cpp': 'cpp', '.hpp': 'cpp',
  '.sh': 'bash', '.bash': 'bash',
  '.sql': 'sql'
};

const GRAMMAR_BY_LANG = {
  javascript: 'javascript',
  typescript: 'typescript',
  tsx: 'tsx',
  python: 'python',
  go: 'go',
  rust: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  shell: 'bash',
  bash: 'bash',
  sql: 'sql'
};

let _wtsModule = null;
let _runtimeInitPromise = null;
let _cachedLock = null;
let _cachedLockDir = null;
let _cachedParserVersion = null;
let _cachedParserVersionDir = null;
const _loadedLanguages = new Map();

function _resolveContainedWasm(grammarsDir, relFile) {
  const root = path.resolve(grammarsDir);
  const candidate = path.resolve(root, String(relFile || ''));
  const rel = path.relative(root, candidate);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`WASM_PATH_OUTSIDE_GRAMMARS: ${relFile}`);
  }
  return candidate;
}

/**
 * Resolves the bundled Tree-sitter WASM grammars directory.
 */
function getBundledGrammarsDir() {
  const overrideDir = process.env[GRAMMARS_DIR_ENV];
  if (overrideDir && overrideDir.trim()) return path.resolve(overrideDir.trim());
  const localDir = path.resolve(__dirname, '..', '..', 'assets', 'grammars');
  if (fs.existsSync(localDir)) return localDir;
  const homeDir = path.join(os.homedir(), '.konoha', 'assets', 'grammars');
  if (fs.existsSync(homeDir)) return homeDir;
  return localDir;
}

function _sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function _loadLockfile(grammarsDir) {
  if (_cachedLock && _cachedLockDir === grammarsDir) return _cachedLock;
  const lockPath = path.join(grammarsDir, 'grammars.lock.json');
  if (!fs.existsSync(lockPath)) {
    throw new Error(`WASM_GRAMMAR_LOCK_MISSING: missing ${lockPath}`);
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (!lock || !lock.runtime || !lock.grammars) {
    throw new Error(`WASM_GRAMMAR_LOCK_INVALID: malformed ${lockPath}`);
  }
  const byLanguage = {};
  const entries = Array.isArray(lock.grammars)
    ? lock.grammars
    : Object.entries(lock.grammars).map(([language, spec]) => ({ language, ...spec }));
  for (const spec of entries) {
    if (spec && spec.language) byLanguage[spec.language] = spec;
  }
  _cachedLock = { ...lock, byLanguage };
  _cachedLockDir = grammarsDir;
  return _cachedLock;
}

/**
 * Computes the deterministic parser version hash covering grammar WASMs, chunk schema, and AST extractor.
 */
function getParserVersion() {
  const grammarsDir = getBundledGrammarsDir();
  if (_cachedParserVersion && _cachedParserVersionDir === grammarsDir) return _cachedParserVersion;
  try {
    const lock = _loadLockfile(grammarsDir);
    const runtimeSha = lock.runtime.sha256 || lock.runtime.runtime_wasm_sha256 || '';
    const parts = [runtimeSha];
    for (const key of Object.keys(lock.byLanguage).sort()) {
      parts.push(`${key}:${lock.byLanguage[key].wasm_sha256 || ''}`);
    }
    parts.push(CHUNK_SCHEMA_VERSION, EXTRACTOR_VERSION);
    const digest = crypto.createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex').slice(0, 12);
    _cachedParserVersion = `ts-wasm-v1-${digest}`;
    _cachedParserVersionDir = grammarsDir;
    return _cachedParserVersion;
  } catch (_) {
    return `ts-wasm-v1-${CHUNK_SCHEMA_VERSION}`;
  }
}

function _selectGrammarKey(language, relPath) {
  const ext = relPath ? path.extname(relPath).toLowerCase() : '';
  if (ext && Object.hasOwn(GRAMMAR_BY_EXT, ext)) return GRAMMAR_BY_EXT[ext];
  return Object.hasOwn(GRAMMAR_BY_LANG, language) ? GRAMMAR_BY_LANG[language] : null;
}

function _initRuntime(grammarsDir, lock) {
  if (_runtimeInitPromise) return _runtimeInitPromise;
  _runtimeInitPromise = (async () => {
    const runtimeWasm = _resolveContainedWasm(grammarsDir, lock.runtime.file || lock.runtime.wasm || 'tree-sitter.wasm');
    if (!fs.existsSync(runtimeWasm)) {
      throw new Error(`WASM_RUNTIME_MISSING: ${runtimeWasm}`);
    }
    const bytes = fs.readFileSync(runtimeWasm);
    const actualSha = _sha256Buffer(bytes);
    const expectedSha = lock.runtime.sha256 || lock.runtime.runtime_wasm_sha256 || '';
    if (!expectedSha || actualSha !== expectedSha) {
      throw new Error(`WASM_SUPPLY_CHAIN_MISMATCH: tree-sitter.wasm sha256=${actualSha}`);
    }
    if (!_wtsModule) _wtsModule = require('web-tree-sitter');
    await _wtsModule.Parser.init({ locateFile: () => runtimeWasm });
    return _wtsModule;
  })().catch((err) => {
    _runtimeInitPromise = null;
    throw err;
  });
  return _runtimeInitPromise;
}

async function _loadGrammar(grammarKey) {
  const grammarsDir = getBundledGrammarsDir();
  const lock = _loadLockfile(grammarsDir);
  const wts = await _initRuntime(grammarsDir, lock);
  const cacheKey = `${grammarsDir}:${grammarKey}`;
  if (_loadedLanguages.has(cacheKey)) return { wts, langObj: _loadedLanguages.get(cacheKey) };

  const spec = lock.byLanguage[grammarKey];
  if (!spec) {
    throw new Error(`WASM_GRAMMAR_UNREGISTERED: ${grammarKey}`);
  }
  const wasmPath = _resolveContainedWasm(grammarsDir, spec.file);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM_GRAMMAR_MISSING: ${wasmPath}`);
  }
  const bytes = fs.readFileSync(wasmPath);
  const actualSha = _sha256Buffer(bytes);
  if (actualSha !== spec.wasm_sha256) {
    throw new Error(`WASM_SUPPLY_CHAIN_MISMATCH: ${spec.file} sha256=${actualSha} expected=${spec.wasm_sha256}`);
  }
  const langObj = await wts.Language.load(bytes);
  _loadedLanguages.set(cacheKey, langObj);
  return { wts, langObj };
}

/**
 * Parses `source` asynchronously using bundled MIT `web-tree-sitter` WASM grammars
 * for the 11 locked languages, structured extractors for Markdown/JSON/YAML/TOML,
 * or the lexical fallback for remaining extensions.
 */
async function parseFileAsync(source, language, relPath = '') {
  const text = String(source || '');
  if (language === 'markdown') return parseMarkdownStructured(text);
  if (language === 'json' || language === 'yaml' || language === 'toml') {
    return parseConfigStructured(text, language);
  }
  const grammarKey = _selectGrammarKey(language, relPath);
  if (!grammarKey) {
    const fb = parseFallback(text, language);
    return {
      ...fb,
      imports: [],
      parserVersion: 'fallback-lexer-v1',
      parseEngine: 'lexer'
    };
  }
  const { wts, langObj } = await _loadGrammar(grammarKey);
  const parser = new wts.Parser();
  parser.setLanguage(langObj);
  const tree = parser.parse(text);
  try {
    return walkAst(tree, text, language, grammarKey, getParserVersion());
  } finally {
    if (tree && typeof tree.delete === 'function') tree.delete();
    if (typeof parser.delete === 'function') parser.delete();
  }
}

module.exports = {
  EXTRACTOR_VERSION,
  GRAMMAR_BY_EXT,
  GRAMMAR_BY_LANG,
  getBundledGrammarsDir,
  getParserVersion,
  parseFileAsync
};
