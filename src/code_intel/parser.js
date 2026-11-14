'use strict';

/**
 * Language detection, content classification, and synchronous parser façade.
 *
 * `parseFile` stays strictly synchronous via `lexer_fallback.js` for backward
 * compatibility with sync tool handlers. Async callers (`indexer.indexRepositoryAsync`)
 * use `parser_wasm.js` (`web-tree-sitter` WASM AST + structured Markdown/config splitters).
 */

const { FALLBACK_PARSER_VERSION, tokenize, parseFile } = require('./lexer_fallback');
const { buildChunks } = require('./chunker');

const LANG_BY_EXT = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.py': 'python', '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.cs': 'csharp', '.kt': 'kotlin', '.swift': 'swift',
  '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.hpp': 'cpp',
  '.rb': 'ruby', '.php': 'php',
  '.sh': 'shell', '.bash': 'shell',
  '.sql': 'sql',
  '.md': 'markdown', '.markdown': 'markdown', '.mdx': 'markdown',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml'
};

const DOC_LANGS = new Set(['markdown']);
const CONFIG_LANGS = new Set(['json', 'yaml', 'toml']);
const TEST_PATH_RE = /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i;

function detectLanguage(relPath) {
  const dot = String(relPath || '').lastIndexOf('.');
  if (dot < 0) return null;
  const ext = String(relPath).slice(dot).toLowerCase();
  return Object.hasOwn(LANG_BY_EXT, ext) ? LANG_BY_EXT[ext] : null;
}

function detectContentKind(relPath, language) {
  const norm = String(relPath || '').replace(/\\/g, '/');
  if (DOC_LANGS.has(language)) return 'docs';
  if (CONFIG_LANGS.has(language)) return 'config';
  if (TEST_PATH_RE.test(norm)) return 'test';
  return 'code';
}

module.exports = {
  LANG_BY_EXT,
  FALLBACK_PARSER_VERSION,
  detectLanguage,
  detectContentKind,
  tokenize,
  parseFile,
  buildChunks
};
