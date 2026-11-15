'use strict';

/**
 * Canonical Language Capability Registry for Konoha Native Code Intelligence.
 *
 * Single source of truth for the 16 supported programming languages, their file
 * extensions, Tree-sitter WASM vs lexical fallback routing, LSP server candidates,
 * and import-resolution strategies. Structured documentation/config formats
 * (Markdown, JSON, YAML, TOML) are handled alongside for repository retrieval.
 *
 * Explicitly excluded languages (no WASM grammar, no extension detection, no fallback):
 * Java (`java`), C# (`csharp`), and Lua (`lua`).
 */

const PATH_MODULE = require('node:path');

const EXCLUDED_LANGUAGES = Object.freeze(['java', 'csharp', 'lua']);
const EXCLUDED_EXTENSIONS = Object.freeze(['.java', '.cs', '.lua']);
const EXCLUDED_ALIAS_SET = new Set(['java', 'csharp', 'cs', 'c#', 'lua']);

function _langCap(id, extensions, {
  wasmGrammar = null,
  grammarByExt = null,
  fallbackMode = 'brace',
  importStrategy = 'relative',
  lsp = []
} = {}) {
  const extMap = grammarByExt || (wasmGrammar ? Object.fromEntries(extensions.map((ext) => [ext, wasmGrammar])) : {});
  return Object.freeze({
    id,
    extensions: Object.freeze(extensions),
    wasmGrammar,
    grammarByExt: Object.freeze(extMap),
    fallbackMode,
    importStrategy,
    lsp: Object.freeze(lsp.map(([command, args, languageId = id]) => ({ command, args, languageId })))
  });
}

const LANGUAGE_CAPABILITIES = Object.freeze({
  javascript: _langCap('javascript', ['.js', '.mjs', '.cjs', '.jsx'], {
    wasmGrammar: 'javascript',
    importStrategy: 'jsts',
    lsp: [['typescript-language-server', ['--stdio']]]
  }),
  typescript: _langCap('typescript', ['.ts', '.mts', '.cts', '.tsx'], {
    wasmGrammar: 'typescript',
    grammarByExt: { '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx' },
    importStrategy: 'jsts',
    lsp: [['typescript-language-server', ['--stdio']]]
  }),
  python: _langCap('python', ['.py', '.pyi'], {
    wasmGrammar: 'python',
    fallbackMode: 'python',
    importStrategy: 'python',
    lsp: [['pyright-langserver', ['--stdio']], ['pylsp', []]]
  }),
  go: _langCap('go', ['.go'], {
    wasmGrammar: 'go',
    importStrategy: 'go',
    lsp: [['gopls', ['serve']]]
  }),
  rust: _langCap('rust', ['.rs'], {
    wasmGrammar: 'rust',
    importStrategy: 'rust',
    lsp: [['rust-analyzer', []]]
  }),
  c: _langCap('c', ['.c', '.h'], {
    wasmGrammar: 'c',
    importStrategy: 'c_cpp',
    lsp: [['clangd', []]]
  }),
  cpp: _langCap('cpp', ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'], {
    wasmGrammar: 'cpp',
    importStrategy: 'c_cpp',
    lsp: [['clangd', []]]
  }),
  shell: _langCap('shell', ['.sh', '.bash'], {
    wasmGrammar: 'bash',
    fallbackMode: 'minimal',
    importStrategy: 'shell',
    lsp: [['bash-language-server', ['start'], 'shellscript']]
  }),
  sql: _langCap('sql', ['.sql'], {
    wasmGrammar: 'sql',
    fallbackMode: 'minimal',
    importStrategy: 'none',
    lsp: [['sqls', []]]
  }),
  php: _langCap('php', ['.php'], { lsp: [['intelephense', ['--stdio']]] }),
  ruby: _langCap('ruby', ['.rb'], {
    fallbackMode: 'indent_keyword',
    lsp: [['solargraph', ['stdio']], ['ruby-lsp', []]]
  }),
  kotlin: _langCap('kotlin', ['.kt', '.kts'], { lsp: [['kotlin-language-server', []]] }),
  swift: _langCap('swift', ['.swift'], { lsp: [['sourcekit-lsp', []]] }),
  dart: _langCap('dart', ['.dart'], { lsp: [['dart', ['language-server', '--protocol=lsp']]] }),
  elixir: _langCap('elixir', ['.ex', '.exs'], {
    fallbackMode: 'indent_keyword',
    lsp: [['elixir-ls', []]]
  }),
  zig: _langCap('zig', ['.zig'], { lsp: [['zls', []]] })
});

const SUPPORTED_LANGUAGES = Object.freeze(Object.keys(LANGUAGE_CAPABILITIES));
const SUPPORTED_SET = new Set(SUPPORTED_LANGUAGES);

const STRUCTURED_DOC_CAPABILITIES = Object.freeze({
  markdown: Object.freeze({ id: 'markdown', extensions: Object.freeze(['.md', '.markdown', '.mdx']), contentKind: 'docs' }),
  json: Object.freeze({ id: 'json', extensions: Object.freeze(['.json']), contentKind: 'config' }),
  yaml: Object.freeze({ id: 'yaml', extensions: Object.freeze(['.yaml', '.yml']), contentKind: 'config' }),
  toml: Object.freeze({ id: 'toml', extensions: Object.freeze(['.toml']), contentKind: 'config' })
});

const STRUCTURED_FORMATS = Object.freeze(Object.keys(STRUCTURED_DOC_CAPABILITIES));
const STRUCTURED_SET = new Set(STRUCTURED_FORMATS);

const _langByExtMutable = {};
const _grammarByExtMutable = {};
const _resolveExtensionsMutable = [];

for (const cap of Object.values(LANGUAGE_CAPABILITIES)) {
  for (const ext of cap.extensions) {
    _langByExtMutable[ext] = cap.id;
    _resolveExtensionsMutable.push(ext);
    if (Object.hasOwn(cap.grammarByExt, ext)) {
      _grammarByExtMutable[ext] = cap.grammarByExt[ext];
    }
  }
}

for (const docCap of Object.values(STRUCTURED_DOC_CAPABILITIES)) {
  for (const ext of docCap.extensions) {
    _langByExtMutable[ext] = docCap.id;
  }
}

const LANG_BY_EXT = Object.freeze(_langByExtMutable);
const GRAMMAR_BY_EXT = Object.freeze(_grammarByExtMutable);
const RESOLVE_EXTENSIONS = Object.freeze(_resolveExtensionsMutable);

const GRAMMAR_BY_LANG = Object.freeze({
  javascript: 'javascript',
  typescript: 'typescript',
  tsx: 'tsx',
  python: 'python',
  go: 'go',
  rust: 'rust',
  c: 'c',
  cpp: 'cpp',
  shell: 'bash',
  bash: 'bash',
  sql: 'sql'
});

const BRACE_LANGUAGES = new Set(
  SUPPORTED_LANGUAGES.filter((id) => LANGUAGE_CAPABILITIES[id].fallbackMode === 'brace')
);
const FALLBACK_SUPPORTED_LANGUAGES = new Set([...SUPPORTED_LANGUAGES, 'markdown']);

function _normalizeLang(lang) {
  return String(lang || '').trim().toLowerCase();
}

function isLanguageExcluded(lang) {
  return EXCLUDED_ALIAS_SET.has(_normalizeLang(lang));
}

function isStructuredFormat(lang) {
  return STRUCTURED_SET.has(_normalizeLang(lang));
}

/**
 * Returns true strictly for the 16 canonical programming languages (or false for excluded/unknown).
 */
function isLanguageSupported(lang) {
  const norm = _normalizeLang(lang);
  if (!norm || EXCLUDED_ALIAS_SET.has(norm)) return false;
  return SUPPORTED_SET.has(norm);
}

/**
 * Returns true if the language ID (including structured docs/config and grammar dialects like `tsx`/`bash`)
 * is supported by Konoha's code intelligence pipeline.
 */
function isIndexableLanguage(lang) {
  const norm = _normalizeLang(lang);
  if (!norm || EXCLUDED_ALIAS_SET.has(norm)) return false;
  if (norm === 'tsx' || norm === 'bash') return true;
  return SUPPORTED_SET.has(norm) || STRUCTURED_SET.has(norm);
}

/**
 * Returns the capability descriptor for one of the 16 supported programming languages,
 * normalizing `tsx` -> `typescript` and `bash` -> `shell`. Returns `null` for excluded or unknown languages.
 */
function getCapability(lang) {
  let norm = _normalizeLang(lang);
  if (norm === 'tsx') norm = 'typescript';
  else if (norm === 'bash') norm = 'shell';
  if (!norm || EXCLUDED_ALIAS_SET.has(norm) || !Object.hasOwn(LANGUAGE_CAPABILITIES, norm)) {
    return null;
  }
  return LANGUAGE_CAPABILITIES[norm];
}

/**
 * Detects canonical language ID from a repository path or filename.
 * Explicitly returns `null` for excluded extensions (`.java`, `.cs`, `.lua`) and unknown files.
 */
function detectLanguageByPath(filePath) {
  const raw = String(filePath || '');
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = raw.slice(dot).toLowerCase();
  if (EXCLUDED_EXTENSIONS.includes(ext)) return null;
  return Object.hasOwn(LANG_BY_EXT, ext) ? LANG_BY_EXT[ext] : null;
}

/**
 * Selects the MIT Tree-sitter WASM grammar key (`GRAMMAR_BY_EXT` / `GRAMMAR_BY_LANG`),
 * or `null` if the file/language uses the lexical fallback or is excluded.
 */
function getWasmGrammarKey(language, relPath = '') {
  if (isLanguageExcluded(language)) return null;
  const ext = relPath ? PATH_MODULE.extname(String(relPath)).toLowerCase() : '';
  if (ext && EXCLUDED_EXTENSIONS.includes(ext)) return null;
  if (ext && Object.hasOwn(GRAMMAR_BY_EXT, ext)) return GRAMMAR_BY_EXT[ext];
  const norm = _normalizeLang(language);
  return Object.hasOwn(GRAMMAR_BY_LANG, norm) ? GRAMMAR_BY_LANG[norm] : null;
}

function getExcludedLanguages() {
  return [...EXCLUDED_LANGUAGES];
}

function getLspCandidates(language, relPath = '') {
  const cap = getCapability(language) || getCapability(detectLanguageByPath(relPath));
  if (!cap) return [];
  if (cap.id === 'typescript' && PATH_MODULE.extname(String(relPath || '')).toLowerCase() === '.tsx') {
    return cap.lsp.map((c) => ({ ...c, languageId: 'typescriptreact' }));
  }
  if (cap.id === 'javascript' && PATH_MODULE.extname(String(relPath || '')).toLowerCase() === '.jsx') {
    return cap.lsp.map((c) => ({ ...c, languageId: 'javascriptreact' }));
  }
  return cap.lsp;
}

module.exports = {
  SUPPORTED_LANGUAGES,
  STRUCTURED_FORMATS,
  EXCLUDED_LANGUAGES,
  EXCLUDED_EXTENSIONS,
  LANGUAGE_CAPABILITIES,
  STRUCTURED_DOC_CAPABILITIES,
  LANG_BY_EXT,
  GRAMMAR_BY_EXT,
  GRAMMAR_BY_LANG,
  RESOLVE_EXTENSIONS,
  BRACE_LANGUAGES,
  FALLBACK_SUPPORTED_LANGUAGES,
  isLanguageExcluded,
  isStructuredFormat,
  isLanguageSupported,
  isIndexableLanguage,
  getCapability,
  detectLanguageByPath,
  getWasmGrammarKey,
  getExcludedLanguages,
  getLspCandidates
};
