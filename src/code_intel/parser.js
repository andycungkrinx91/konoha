'use strict';

/**
 * Language detection, content classification, and synchronous parser façade.
 *
 * `parseFile` stays strictly synchronous via `lexer_fallback.js` for backward
 * compatibility with sync tool handlers. Async callers (`indexer.indexRepositoryAsync`)
 * use `parser_wasm.js` (`web-tree-sitter` WASM AST + structured Markdown/config splitters).
 */

const {
  LANG_BY_EXT,
  detectLanguageByPath
} = require('./capabilities');
const { FALLBACK_PARSER_VERSION, tokenize, parseFile } = require('./lexer_fallback');
const { buildChunks } = require('./chunker');

const DOC_LANGS = new Set(['markdown']);
const CONFIG_LANGS = new Set(['json', 'yaml', 'toml']);
const TEST_PATH_RE = /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i;

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
  detectLanguage: detectLanguageByPath,
  detectContentKind,
  tokenize,
  parseFile,
  buildChunks
};
