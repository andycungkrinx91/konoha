'use strict';

/**
 * Pure-JS structural parser for the code-intelligence index.
 *
 * No tree-sitter, no wasm grammars, no native addon: Konoha never installs
 * dependencies on a user's machine, and a compiled parser would need a
 * prebuild for every OS/arch we ship. What we need is not a full AST — only
 * symbol extents (for `code_context`) and identifier mentions (for
 * `code_impact`). A lexer plus brace/indent matching gives both.
 *
 * ponytail: no type resolution, no scopes, no macros, no JSX element symbols.
 * If call-graph precision ever matters more than the zero-dependency
 * constraint, replace `parseFile` with a tree-sitter backend behind the same
 * return shape.
 */

const { MAX_SYMBOLS_PER_FILE, MAX_REFS_PER_FILE } = require('./config');

const LANG_BY_EXT = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.py': 'python', '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.cs': 'csharp', '.kt': 'kotlin', '.swift': 'swift',
  '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.hpp': 'cpp',
  '.rb': 'ruby', '.php': 'php', '.sh': 'shell', '.sql': 'sql',
  '.md': 'markdown', '.markdown': 'markdown'
};

const BRACE_LANGS = new Set([
  'javascript', 'typescript', 'go', 'rust', 'java', 'csharp',
  'kotlin', 'swift', 'c', 'cpp', 'ruby', 'php'
]);

const SUPPORTED = new Set([...BRACE_LANGS, 'python', 'shell', 'sql', 'markdown']);

// Control keywords only. Type names and common methods are deliberately absent:
// filtering `map` or `string` would delete real references.
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'return', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'void',
  'yield', 'await', 'async', 'function', 'class', 'const', 'let', 'var',
  'export', 'import', 'from', 'default', 'extends', 'implements', 'interface',
  'type', 'enum', 'struct', 'trait', 'impl', 'fn', 'def', 'func', 'package',
  'public', 'private', 'protected', 'static', 'final', 'abstract', 'try',
  'catch', 'finally', 'throw', 'this', 'super', 'null', 'undefined', 'true',
  'false', 'self', 'nil', 'lambda', 'with', 'as', 'is', 'not', 'and', 'or',
  'pass', 'raise', 'except', 'elif', 'then', 'end', 'module', 'use', 'pub',
  'mut', 'where', 'match', 'loop', 'unsafe', 'extern', 'crate', 'dyn', 'ref',
  'move', 'go', 'defer', 'chan', 'select', 'range', 'var', 'let', 'function'
]);

const REGEX_PRECEDERS = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', 'return',
  'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void',
  'yield', 'await', '=>', '==', '===', '!=', '!==', '&&', '||', '??'
]);

const MULTI_PUNCT = ['===', '!==', '...', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '::', '->'];

function detectLanguage(relPath) {
  const dot = relPath.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = relPath.slice(dot).toLowerCase();
  return Object.hasOwn(LANG_BY_EXT, ext) ? LANG_BY_EXT[ext] : null;
}

function _isIdentStart(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

function _isIdentPart(ch) {
  return _isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

/** Skips to just before the next newline; the caller keeps the newline token. */
function _skipLineComment(src, i, n) {
  while (i < n && src[i] !== '\n') i++;
  return i;
}

function _skipBlockComment(src, i, n, line) {
  let j = i + 2;
  while (j < n && !(src[j] === '*' && src[j + 1] === '/')) {
    if (src[j] === '\n') line++;
    j++;
  }
  return { i: j + 2, line };
}

/** Consumes a quoted literal. Bodies are dropped; newlines still count. */
function _scanQuoted(src, i, n, line) {
  const quote = src[i];
  if (src[i + 1] === quote && src[i + 2] === quote) {
    let j = i + 3;
    while (j < n && !(src[j] === quote && src[j + 1] === quote && src[j + 2] === quote)) {
      if (src[j] === '\n') line++;
      j++;
    }
    return { i: j + 3, line };
  }
  let j = i + 1;
  while (j < n) {
    if (src[j] === '\\') {
      if (src[j + 1] === '\n') line++;
      j += 2;
      continue;
    }
    if (src[j] === quote) return { i: j + 1, line };
    if (src[j] === '\n') line++;
    j++;
  }
  return { i: j, line };
}

/** Consumes a regex literal so its body cannot leak identifiers as refs. */
function _scanRegex(src, i, n) {
  let j = i + 1;
  let inClass = false;
  while (j < n) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '\n') break;
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) break;
    j++;
  }
  return j + 1;
}

/**
 * Tokenizes into { t: 'id'|'p'|'str'|'num', v, line }.
 * Comments are dropped; string bodies are dropped but newlines inside them
 * still advance the line counter, so reported lines stay accurate.
 */
function tokenize(src, language) {
  const tokens = [];
  const n = src.length;
  const hashComments = language === 'python' || language === 'ruby' || language === 'shell';
  let i = 0;
  let line = 1;
  let prev = null;

  const push = (t, v) => {
    const tok = { t, v, line };
    tokens.push(tok);
    prev = tok;
  };

  while (i < n) {
    const ch = src[i];

    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }

    if (ch === '/' && src[i + 1] === '/') { i = _skipLineComment(src, i, n); continue; }
    if (ch === '/' && src[i + 1] === '*') {
      const skipped = _skipBlockComment(src, i, n, line);
      i = skipped.i;
      line = skipped.line;
      continue;
    }
    if (hashComments && ch === '#') { i = _skipLineComment(src, i, n); continue; }

    if (ch === '"' || ch === "'" || ch === '`') {
      const scanned = _scanQuoted(src, i, n, line);
      i = scanned.i;
      line = scanned.line;
      push('str', '');
      continue;
    }

    if (ch === '/' && (!prev || REGEX_PRECEDERS.has(prev.v))) {
      i = _scanRegex(src, i, n);
      push('str', '');
      continue;
    }

    if (_isIdentStart(ch)) {
      let j = i;
      while (j < n && _isIdentPart(src[j])) j++;
      push('id', src.slice(i, j));
      i = j;
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObBeE._]/.test(src[j])) j++;
      push('num', src.slice(i, j));
      i = j;
      continue;
    }

    const matched = MULTI_PUNCT.find((p) => src.startsWith(p, i));
    if (matched) {
      push('p', matched);
      i += matched.length;
      continue;
    }

    push('p', ch);
    i++;
  }

  return tokens;
}

/** Maps each `{`/`(`/`[` token index to its partner index, and vice versa. */
function _findOpener(stack, tokens, openChar) {
  for (let s = stack.length - 1; s >= 0; s--) {
    if (tokens[stack[s]].v === openChar) return s;
  }
  return -1;
}

function matchDelimiters(tokens) {
  const match = new Map();
  const stack = [];
  const OPEN = { '{': '}', '(': ')', '[': ']' };
  const CLOSE = { '}': '{', ')': '(', ']': '[' };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t !== 'p') continue;
    if (OPEN[tok.v]) { stack.push(i); continue; }
    if (!CLOSE[tok.v]) continue;
    const s = _findOpener(stack, tokens, CLOSE[tok.v]);
    if (s < 0) continue;
    match.set(stack[s], i);
    match.set(i, stack[s]);
    stack.length = s;
  }
  return match;
}

function _sigOf(srcLines, line) {
  const raw = (srcLines[line - 1] || '').trim();
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

/** End line of the brace block that starts at or after `fromIdx`. */
function _braceBlockEnd(tokens, match, fromIdx) {
  for (let i = fromIdx; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t !== 'p') continue;
    if (tok.v === '{') {
      const close = match.get(i);
      if (close === undefined) return tokens[tokens.length - 1].line;
      return tokens[close].line;
    }
    if (tok.v === ';') return tok.line;
  }
  return tokens[tokens.length - 1].line;
}

const DECL_KEYWORDS = {
  class: 'class', interface: 'interface', struct: 'class', trait: 'interface',
  enum: 'enum', namespace: 'namespace', module: 'namespace', impl: 'impl'
};

/**
 * Tracks a class/interface body opening at this depth, so members declared
 * inside it are recorded as methods rather than free functions.
 */
function _openBrace(symbols, classStack, depth) {
  const next = depth + 1;
  const top = symbols[symbols.length - 1];
  if (top && (top.kind === 'class' || top.kind === 'interface') && top._pendingBody) {
    classStack.push({ name: top.name, depth: next });
    delete top._pendingBody;
  }
  return next;
}

function _closeBrace(classStack, depth) {
  const last = classStack[classStack.length - 1];
  if (last && last.depth === depth) classStack.pop();
  return Math.max(0, depth - 1);
}

/** Shared parse state for one file. */
function _parserContext(src, language) {
  const lines = src.split('\n');
  const tokens = tokenize(src, language);
  return {
    lines,
    tokens,
    language,
    match: matchDelimiters(tokens),
    symbols: [],
    declTokenIdx: new Set(),
    classStack: [],
    depth: 0
  };
}

/**
 * Appends one symbol. `startIdx` is the token index that names it; the
 * reported line comes from that token so it survives comment removal.
 */
function _addSymbol(ctx, { name, kind, startIdx, endLine, parentName }) {
  if (ctx.symbols.length >= MAX_SYMBOLS_PER_FILE) return false;
  if (!name || KEYWORDS.has(name)) return false;
  const startLine = ctx.tokens[startIdx].line;
  ctx.symbols.push({
    name,
    kind,
    parentName: parentName || '',
    startLine,
    endLine: Math.max(endLine, startLine),
    signature: _sigOf(ctx.lines, startLine),
    language: ctx.language
  });
  return true;
}

/** `function NAME`, `func NAME`, `fn NAME`. Returns the new cursor, or -1. */
function _declFunction(ctx, i) {
  const tokens = ctx.tokens;
  let nameIdx = i + 1;
  // Go receiver form: func (r *T) Name(...)
  if (ctx.language === 'go' && tokens[nameIdx] && tokens[nameIdx].v === '(') {
    const close = ctx.match.get(nameIdx);
    nameIdx = close === undefined ? nameIdx : close + 1;
  }
  const nameTok = tokens[nameIdx];
  if (!nameTok || nameTok.t !== 'id') return -1;
  const owner = ctx.classStack[ctx.classStack.length - 1];
  const endLine = _braceBlockEnd(tokens, ctx.match, nameIdx + 1);
  _addSymbol(ctx, { name: nameTok.v, kind: owner ? 'method' : 'function', startIdx: nameIdx, endLine, parentName: owner ? owner.name : '' });
  ctx.declTokenIdx.add(nameIdx);
  return nameIdx;
}

/** `class`/`interface`/`struct`/`enum`/`namespace`/`impl` declarations. */
function _declKeyword(ctx, keyword, i) {
  const nameTok = ctx.tokens[i + 1];
  if (!nameTok || nameTok.t !== 'id') return -1;
  const kind = DECL_KEYWORDS[keyword];
  const endLine = _braceBlockEnd(ctx.tokens, ctx.match, i + 2);
  const added = _addSymbol(ctx, { name: nameTok.v, kind, startIdx: i + 1, endLine });
  if (added && (kind === 'class' || kind === 'interface')) {
    ctx.symbols[ctx.symbols.length - 1]._pendingBody = true;
  }
  ctx.declTokenIdx.add(i + 1);
  return i + 1;
}

function _declType(ctx, i) {
  const nameTok = ctx.tokens[i + 1];
  if (!nameTok || nameTok.t !== 'id') return -1;
  _addSymbol(ctx, { name: nameTok.v, kind: 'type', startIdx: i + 1, endLine: nameTok.line });
  ctx.declTokenIdx.add(i + 1);
  return i + 1;
}

function _startsFunction(tokens, match, j) {
  if (tokens[j] && tokens[j].v === 'function') return true;
  if (!tokens[j] || tokens[j].v !== '(') return false;
  const close = match.get(j);
  const after = close === undefined ? null : tokens[close + 1];
  return Boolean(after && after.v === '=>');
}

/** `const NAME = (…) =>` / `= function` / `= async (`. */
function _declVariable(ctx, i) {
  const tokens = ctx.tokens;
  const nameTok = tokens[i + 1];
  if (!nameTok || nameTok.t !== 'id') return -1;
  let j = i + 2;
  if (!tokens[j] || tokens[j].v !== '=') return -1;
  j++;
  if (tokens[j] && tokens[j].v === 'async') j++;
  if (!_startsFunction(tokens, ctx.match, j)) return -1;
  const endLine = _braceBlockEnd(tokens, ctx.match, j);
  _addSymbol(ctx, { name: nameTok.v, kind: 'function', startIdx: i + 1, endLine });
  ctx.declTokenIdx.add(i + 1);
  return i;
}

/** Method inside a class body: NAME(…) { */
function _declMethod(ctx, tok, i) {
  if (ctx.classStack.length === 0 || ctx.declTokenIdx.has(i)) return -1;
  const tokens = ctx.tokens;
  const next = tokens[i + 1];
  if (!next || next.t !== 'p' || next.v !== '(') return -1;
  const close = ctx.match.get(i + 1);
  const after = close === undefined ? null : tokens[close + 1];
  if (!after || after.t !== 'p' || after.v !== '{') return -1;
  const prevTok = tokens[i - 1];
  if (prevTok && prevTok.t === 'p' && (prevTok.v === '.' || prevTok.v === '?.')) return -1;
  const endLine = _braceBlockEnd(tokens, ctx.match, close + 1);
  _addSymbol(ctx, { name: tok.v, kind: 'method', startIdx: i, endLine, parentName: ctx.classStack[ctx.classStack.length - 1].name });
  ctx.declTokenIdx.add(i);
  return i;
}

const BRACE_DECL_KEYWORDS = new Set(['function', 'func', 'fn']);

/** Tries each declaration form for one identifier token. */
function _declAt(ctx, tok, i) {
  if (BRACE_DECL_KEYWORDS.has(tok.v)) return _declFunction(ctx, i);
  if (Object.hasOwn(DECL_KEYWORDS, tok.v)) return _declKeyword(ctx, tok.v, i);
  if (tok.v === 'type') return _declType(ctx, i);
  if (tok.v === 'const' || tok.v === 'let' || tok.v === 'var') return _declVariable(ctx, i);
  return _declMethod(ctx, tok, i);
}

/** Collects non-declaration identifier uses as reference edges. */
function _collectRefs(ctx) {
  const { tokens, declTokenIdx } = ctx;
  const refs = [];
  const seen = new Set();
  for (let i = 0; i < tokens.length && refs.length < MAX_REFS_PER_FILE; i++) {
    const tok = tokens[i];
    if (tok.t !== 'id' || KEYWORDS.has(tok.v) || declTokenIdx.has(i)) continue;
    const prevTok = tokens[i - 1];
    const nextTok = tokens[i + 1];
    let kind = 'ident';
    if (prevTok && prevTok.t === 'p' && (prevTok.v === '.' || prevTok.v === '?.')) kind = 'member';
    else if (nextTok && nextTok.t === 'p' && nextTok.v === '(') kind = 'call';
    else if (nextTok && nextTok.t === 'p' && nextTok.v === ':') continue; // object key
    const key = `${tok.v}@${tok.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ targetName: tok.v, kind, line: tok.line });
  }
  return refs;
}

function _parseBraceLanguage(src, language) {
  const ctx = _parserContext(src, language);
  const tokens = ctx.tokens;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.t === 'p') {
      if (tok.v === '{') ctx.depth = _openBrace(ctx.symbols, ctx.classStack, ctx.depth);
      else if (tok.v === '}') ctx.depth = _closeBrace(ctx.classStack, ctx.depth);
      continue;
    }
    if (tok.t !== 'id') continue;

    const next = _declAt(ctx, tok, i);
    if (next >= 0) i = next;
  }

  for (const s of ctx.symbols) delete s._pendingBody;
  return { symbols: ctx.symbols, refs: _collectRefs(ctx) };
}

function _parsePython(src, language) {
  const lines = src.split('\n');
  const symbols = [];
  const declLine = new Set();

  const indentOf = (s) => s.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = indentOf(raw);
    const m = raw.match(/^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)\s*[(:]/);
    if (!m) continue;

    const name = m[2];
    const kind = m[1] === 'class' ? 'class' : 'function';
    let endLine = idx + 1;
    for (let j = idx + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) continue;
      if (indentOf(l) <= indent) break;
      endLine = j + 1;
    }
    symbols.push({
      name, kind, parentName: '',
      startLine: idx + 1, endLine,
      signature: raw.trim().slice(0, 200),
      language
    });
    declLine.add(idx + 1);
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) break;
  }

  const tokens = tokenize(src, language);
  const refs = [];
  const seen = new Set();
  for (let i = 0; i < tokens.length && refs.length < MAX_REFS_PER_FILE; i++) {
    const tok = tokens[i];
    if (tok.t !== 'id' || KEYWORDS.has(tok.v)) continue;
    if (declLine.has(tok.line) && symbols.some((s) => s.startLine === tok.line && s.name === tok.v)) continue;
    const prevTok = tokens[i - 1];
    const nextTok = tokens[i + 1];
    let kind = 'ident';
    if (prevTok && prevTok.t === 'p' && prevTok.v === '.') kind = 'member';
    else if (nextTok && nextTok.t === 'p' && nextTok.v === '(') kind = 'call';
    const key = `${tok.v}@${tok.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ targetName: tok.v, kind, line: tok.line });
  }

  return { symbols, refs };
}

/**
 * @param {string} source file contents
 * @param {string} language value from detectLanguage
 * @returns {{symbols: Array, refs: Array}}
 */
function parseFile(source, language) {
  if (!SUPPORTED.has(language)) return { symbols: [], refs: [] };
  if (language === 'python') return _parsePython(source, language);
  if (language === 'markdown' || language === 'sql' || language === 'shell') {
    return { symbols: [], refs: [] };
  }
  return _parseBraceLanguage(source, language);
}

/**
 * Splits a file into indexable chunks, preferring symbol extents so a search
 * hit lands on a whole function rather than an arbitrary 40-line window.
 *
 * Only outermost symbols become chunk anchors. A method inside a class is
 * covered by the class chunk; emitting both would store and return the same
 * body twice.
 */
function buildChunks(source, symbols, limits) {
  const lines = source.split('\n');
  const { CHUNK_MAX_LINES, CHUNK_MAX_CHARS, CHUNK_OVERLAP_LINES } = limits;
  const chunks = [];

  const pushRange = (startLine, endLine) => {
    let s = startLine;
    while (s <= endLine) {
      let e = Math.min(endLine, s + CHUNK_MAX_LINES - 1);
      let body = lines.slice(s - 1, e).join('\n');
      while (body.length > CHUNK_MAX_CHARS && e > s) {
        e--;
        body = lines.slice(s - 1, e).join('\n');
      }
      if (body.trim()) chunks.push({ startLine: s, endLine: e, body });
      if (e >= endLine) break;
      s = Math.max(s + 1, e - CHUNK_OVERLAP_LINES + 1);
    }
  };

  const outer = [];
  for (const sym of [...symbols].sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine)) {
    if (outer.some(([s, e]) => sym.startLine >= s && sym.endLine <= e)) continue;
    outer.push([sym.startLine, sym.endLine]);
  }

  for (const [s, e] of outer) pushRange(s, e);

  // Remaining lines (imports, top-level constants, prose) as gap chunks.
  let cursor = 1;
  for (const [s, e] of outer) {
    if (s > cursor) pushRange(cursor, s - 1);
    cursor = Math.max(cursor, e + 1);
  }
  if (cursor <= lines.length) pushRange(cursor, lines.length);

  return chunks;
}

module.exports = {
  LANG_BY_EXT,
  detectLanguage,
  tokenize,
  parseFile,
  buildChunks
};
