'use strict';

/**
 * Synchronous lexical/brace fallback parser.
 *
 * Used strictly by synchronous JS entrypoints (`parser.parseFile` and
 * `indexer.indexRepository`) when async WASM initialization has not run.
 * Tags files with `FALLBACK_PARSER_VERSION` so the next async WASM index
 * automatically upgrades them cleanly.
 */

const { MAX_SYMBOLS_PER_FILE, MAX_REFS_PER_FILE } = require('./config');

const FALLBACK_PARSER_VERSION = 'fallback-lexer-v1';

const BRACE_LANGS = new Set([
  'javascript', 'typescript', 'go', 'rust', 'java', 'csharp',
  'kotlin', 'swift', 'c', 'cpp', 'ruby', 'php'
]);

const SUPPORTED = new Set([...BRACE_LANGS, 'python', 'shell', 'sql', 'markdown']);

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
  'move', 'go', 'defer', 'chan', 'select', 'range'
]);

const REGEX_PRECEDERS = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', 'return',
  'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void',
  'yield', 'await', '=>', '==', '===', '!=', '!==', '&&', '||', '??'
]);

const MULTI_PUNCT = ['===', '!==', '...', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '::', '->'];

const DECL_KEYWORDS = {
  class: 'class',
  interface: 'interface',
  struct: 'class',
  trait: 'interface',
  enum: 'enum',
  namespace: 'namespace',
  module: 'namespace',
  impl: 'impl'
};

const BRACE_DECL_KEYWORDS = new Set(['function', 'func', 'fn']);

function _isIdentStart(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

function _isIdentPart(ch) {
  return _isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

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

function _scanTripleQuoted(src, i, n, line, quote) {
  let j = i + 3;
  while (j < n && !(src[j] === quote && src[j + 1] === quote && src[j + 2] === quote)) {
    if (src[j] === '\n') line++;
    j++;
  }
  return { i: j + 3, line };
}

function _scanQuoted(src, i, n, line) {
  const quote = src[i];
  if (src[i + 1] === quote && src[i + 2] === quote) {
    return _scanTripleQuoted(src, i, n, line, quote);
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

function _scanRegex(src, i, n) {
  let j = i + 1;
  let inClass = false;
  while (j < n) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '\n') break;
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) break;
    j++;
  }
  return j + 1;
}

function _nextToken(src, cursor, prev, hashComments) {
  const { i, n, line } = cursor;
  const ch = src[i];
  if (ch === '\n') return { i: i + 1, line: line + 1 };
  if (ch === ' ' || ch === '\t' || ch === '\r') return { i: i + 1, line };
  if (ch === '/' && src[i + 1] === '/') return { i: _skipLineComment(src, i, n), line };
  if (ch === '/' && src[i + 1] === '*') return _skipBlockComment(src, i, n, line);
  if (hashComments && ch === '#') return { i: _skipLineComment(src, i, n), line };
  if (ch === '"' || ch === "'" || ch === '`') {
    const s = _scanQuoted(src, i, n, line);
    return { i: s.i, line: s.line, tok: { t: 'str', v: '' } };
  }
  if (ch === '/' && (!prev || REGEX_PRECEDERS.has(prev.v))) {
    return { i: _scanRegex(src, i, n), line, tok: { t: 'str', v: '' } };
  }
  if (_isIdentStart(ch)) {
    let j = i;
    while (j < n && _isIdentPart(src[j])) j++;
    return { i: j, line, tok: { t: 'id', v: src.slice(i, j) } };
  }
  if (ch >= '0' && ch <= '9') {
    let j = i;
    while (j < n && /[0-9a-fA-FxXoObBeE._]/.test(src[j])) j++;
    return { i: j, line, tok: { t: 'num', v: src.slice(i, j) } };
  }
  const matched = MULTI_PUNCT.find((p) => src.startsWith(p, i));
  if (matched) return { i: i + matched.length, line, tok: { t: 'p', v: matched } };
  return { i: i + 1, line, tok: { t: 'p', v: ch } };
}

function tokenize(src, language) {
  const tokens = [];
  const n = src.length;
  const hashComments = language === 'python' || language === 'ruby' || language === 'shell';
  let i = 0;
  let line = 1;
  let prev = null;

  while (i < n) {
    const step = _nextToken(src, { i, n, line }, prev, hashComments);
    if (step.tok) {
      const tok = { t: step.tok.t, v: step.tok.v, line };
      tokens.push(tok);
      prev = tok;
    }
    i = step.i;
    line = step.line;
  }
  return tokens;
}

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
    if (OPEN[tok.v]) {
      stack.push(i);
      continue;
    }
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

function _braceBlockEnd(tokens, match, fromIdx) {
  for (let i = fromIdx; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t !== 'p') continue;
    if (tok.v === '{') {
      const close = match.get(i);
      return close === undefined ? tokens[tokens.length - 1].line : tokens[close].line;
    }
    if (tok.v === ';') return tok.line;
  }
  return tokens[tokens.length - 1].line;
}

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

function _declFunction(ctx, i) {
  const tokens = ctx.tokens;
  let nameIdx = i + 1;
  if (ctx.language === 'go' && tokens[nameIdx] && tokens[nameIdx].v === '(') {
    const close = ctx.match.get(nameIdx);
    nameIdx = close === undefined ? nameIdx : close + 1;
  }
  const nameTok = tokens[nameIdx];
  if (!nameTok || nameTok.t !== 'id') return -1;
  const owner = ctx.classStack[ctx.classStack.length - 1];
  const endLine = _braceBlockEnd(tokens, ctx.match, nameIdx + 1);
  _addSymbol(ctx, {
    name: nameTok.v,
    kind: owner ? 'method' : 'function',
    startIdx: nameIdx,
    endLine,
    parentName: owner ? owner.name : ''
  });
  ctx.declTokenIdx.add(nameIdx);
  return nameIdx;
}

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
  _addSymbol(ctx, {
    name: tok.v,
    kind: 'method',
    startIdx: i,
    endLine,
    parentName: ctx.classStack[ctx.classStack.length - 1].name
  });
  ctx.declTokenIdx.add(i);
  return i;
}

function _declAt(ctx, tok, i) {
  if (BRACE_DECL_KEYWORDS.has(tok.v)) return _declFunction(ctx, i);
  if (Object.hasOwn(DECL_KEYWORDS, tok.v)) return _declKeyword(ctx, tok.v, i);
  if (tok.v === 'type') return _declType(ctx, i);
  if (tok.v === 'const' || tok.v === 'let' || tok.v === 'var') return _declVariable(ctx, i);
  return _declMethod(ctx, tok, i);
}

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
    else if (nextTok && nextTok.t === 'p' && nextTok.v === ':') continue;
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

function _indentOf(s) {
  return s.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
}

function _pythonSymbolEnd(lines, idx, indent) {
  let endLine = idx + 1;
  for (let j = idx + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim()) continue;
    if (_indentOf(l) <= indent) break;
    endLine = j + 1;
  }
  return endLine;
}

function _collectPythonRefs(src, language, symbols, declLine) {
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
  return refs;
}

function _parsePython(src, language) {
  const lines = src.split('\n');
  const symbols = [];
  const declLine = new Set();
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const m = raw.match(/^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)\s*[(:]/);
    if (!m) continue;
    symbols.push({
      name: m[2],
      kind: m[1] === 'class' ? 'class' : 'function',
      parentName: '',
      startLine: idx + 1,
      endLine: _pythonSymbolEnd(lines, idx, _indentOf(raw)),
      signature: raw.trim().slice(0, 200),
      language
    });
    declLine.add(idx + 1);
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) break;
  }
  return { symbols, refs: _collectPythonRefs(src, language, symbols, declLine) };
}

function parseFile(source, language) {
  if (!SUPPORTED.has(language)) return { symbols: [], refs: [] };
  if (language === 'python') return _parsePython(source, language);
  if (language === 'markdown' || language === 'sql' || language === 'shell') {
    return { symbols: [], refs: [] };
  }
  return _parseBraceLanguage(source, language);
}

module.exports = {
  FALLBACK_PARSER_VERSION,
  KEYWORDS,
  BRACE_LANGS,
  SUPPORTED,
  tokenize,
  matchDelimiters,
  parseFile
};
