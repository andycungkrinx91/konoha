'use strict';

/**
 * Syntax- and scope-aware code chunker.
 *
 * Splits declarations along AST/block boundaries while preserving leading
 * docstrings/comments and parent scope context, keeping chunks comfortably
 * inside MiniLM's 512-token context window.
 */

const crypto = require('crypto');
const {
  CHUNK_MAX_LINES,
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_LINES
} = require('./config');

const CHUNK_SCHEMA_VERSION = 'ast-chunk-v1';

function _chunkHash(body) {
  const norm = String(body || '').trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(norm, 'utf8').digest('hex').slice(0, 24);
}

function _isCommentOrDecoratorLine(trimmed) {
  if (!trimmed) return false;
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('--') ||
    trimmed.startsWith('@')
  );
}

function _extendStartWithLeadingDocs(lines, startLine, floorLine) {
  let cursor = startLine - 1;
  let captured = 0;
  while (cursor >= floorLine && captured < 12) {
    const trimmed = (lines[cursor - 1] || '').trim();
    if (!_isCommentOrDecoratorLine(trimmed)) break;
    cursor--;
    captured++;
  }
  return captured > 0 ? cursor + 1 : startLine;
}

function _pushWindowedRange(lines, rangeSpec, limits, chunks) {
  const maxLines = limits.CHUNK_MAX_LINES || CHUNK_MAX_LINES;
  const maxChars = limits.CHUNK_MAX_CHARS || CHUNK_MAX_CHARS;
  const overlap = limits.CHUNK_OVERLAP_LINES !== undefined ? limits.CHUNK_OVERLAP_LINES : CHUNK_OVERLAP_LINES;
  const { startLine, endLine, chunkKind, symbolName, parentName } = rangeSpec;

  let s = startLine;
  while (s <= endLine) {
    let e = Math.min(endLine, s + maxLines - 1);
    let body = lines.slice(s - 1, e).join('\n');
    while (body.length > maxChars && e > s) {
      e--;
      body = lines.slice(s - 1, e).join('\n');
    }
    if (body.trim()) {
      chunks.push({
        startLine: s,
        endLine: e,
        body,
        chunkKind: chunkKind || 'block',
        symbolName: symbolName || '',
        parentName: parentName || '',
        contentHash: _chunkHash(body)
      });
    }
    if (e >= endLine) break;
    s = Math.max(s + 1, e - overlap + 1);
  }
}

function _childSpansForContainer(sym, allSymbols) {
  return allSymbols
    .filter((child) => (
      child !== sym &&
      child.startLine > sym.startLine &&
      child.endLine <= sym.endLine
    ))
    .sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
}

function _emitSymbolChunk(lines, anchor, allSymbols, limits, chunks) {
  const maxLines = limits.CHUNK_MAX_LINES || CHUNK_MAX_LINES;
  const maxChars = limits.CHUNK_MAX_CHARS || CHUNK_MAX_CHARS;
  const fullBody = lines.slice(anchor.startLine - 1, anchor.endLine).join('\n');
  const lineCount = anchor.endLine - anchor.startLine + 1;

  if (lineCount <= maxLines && fullBody.length <= maxChars) {
    if (fullBody.trim()) {
      chunks.push({
        startLine: anchor.startLine,
        endLine: anchor.endLine,
        body: fullBody,
        chunkKind: anchor.kind || 'symbol',
        symbolName: anchor.name || '',
        parentName: anchor.parentName || '',
        contentHash: _chunkHash(fullBody)
      });
    }
    return;
  }

  const children = _childSpansForContainer(anchor, allSymbols);
  if (children.length === 0) {
    _pushWindowedRange(lines, {
      startLine: anchor.startLine,
      endLine: anchor.endLine,
      chunkKind: anchor.kind || 'symbol',
      symbolName: anchor.name || '',
      parentName: anchor.parentName || ''
    }, limits, chunks);
    return;
  }

  let cursor = anchor.startLine;
  for (const child of children) {
    if (child.startLine < cursor) continue;
    if (child.startLine > cursor) {
      _pushWindowedRange(lines, {
        startLine: cursor,
        endLine: child.startLine - 1,
        chunkKind: anchor.kind || 'block',
        symbolName: anchor.name || '',
        parentName: anchor.parentName || ''
      }, limits, chunks);
    }
    _pushWindowedRange(lines, {
      startLine: child.startLine,
      endLine: child.endLine,
      chunkKind: child.kind || 'method',
      symbolName: child.name || '',
      parentName: child.parentName || anchor.name || ''
    }, limits, chunks);
    cursor = child.endLine + 1;
  }
  if (cursor <= anchor.endLine) {
    _pushWindowedRange(lines, {
      startLine: cursor,
      endLine: anchor.endLine,
      chunkKind: anchor.kind || 'block',
      symbolName: anchor.name || '',
      parentName: anchor.parentName || ''
    }, limits, chunks);
  }
}

function _selectOutermostAnchors(lines, symbols) {
  const sorted = [...(symbols || [])].sort(
    (a, b) => a.startLine - b.startLine || b.endLine - a.endLine
  );
  const outer = [];
  for (const sym of sorted) {
    if (outer.some((o) => sym.startLine >= o.startLine && sym.endLine <= o.endLine)) continue;
    const prevEnd = outer.length > 0 ? outer[outer.length - 1].endLine : 0;
    const startWithDocs = _extendStartWithLeadingDocs(lines, sym.startLine, prevEnd + 1);
    outer.push({
      ...sym,
      startLine: startWithDocs
    });
  }
  return outer;
}

/**
 * Splits `source` into bounded chunks preserving outermost symbol boundaries,
 * child declarations inside oversized classes, leading docs, and gap regions.
 */
function buildChunks(source, symbols, limits = {}) {
  const text = String(source || '');
  if (!text.trim()) return [];
  const lines = text.split('\n');
  const resolvedLimits = {
    CHUNK_MAX_LINES: limits.CHUNK_MAX_LINES || CHUNK_MAX_LINES,
    CHUNK_MAX_CHARS: limits.CHUNK_MAX_CHARS || CHUNK_MAX_CHARS,
    CHUNK_OVERLAP_LINES: limits.CHUNK_OVERLAP_LINES !== undefined ? limits.CHUNK_OVERLAP_LINES : CHUNK_OVERLAP_LINES
  };

  const chunks = [];
  const outer = _selectOutermostAnchors(lines, symbols);

  for (const anchor of outer) {
    _emitSymbolChunk(lines, anchor, symbols || [], resolvedLimits, chunks);
  }

  let cursor = 1;
  for (const anchor of outer) {
    if (anchor.startLine > cursor) {
      _pushWindowedRange(lines, {
        startLine: cursor,
        endLine: anchor.startLine - 1,
        chunkKind: 'block'
      }, resolvedLimits, chunks);
    }
    cursor = Math.max(cursor, anchor.endLine + 1);
  }
  if (cursor <= lines.length) {
    _pushWindowedRange(lines, {
      startLine: cursor,
      endLine: lines.length,
      chunkKind: 'block'
    }, resolvedLimits, chunks);
  }

  return chunks;
}

module.exports = {
  CHUNK_SCHEMA_VERSION,
  buildChunks
};
