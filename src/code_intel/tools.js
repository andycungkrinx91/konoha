'use strict';

/**
 * MCP tool handlers for the native code-intelligence index.
 *
 * Handlers are thin: validate the arguments, delegate, return a plain object.
 * `file_tools_router` owns JSON serialization and error formatting.
 */

const fs = require('fs');
const path = require('path');
const { indexRepository } = require('./indexer');
const store = require('./store');
const query = require('./query');

function _asDirectory(raw) {
  const abs = path.resolve(String(raw));
  try {
    return fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  } catch (_) {
    return abs;
  }
}

// Explicit directory keys outrank 'path', which callers also use to name a file.
function _optionalRoot(args) {
  const raw = args.root || args.dir || args.directory || args.repo || args.path;
  return raw ? _asDirectory(raw) : undefined;
}

function _rootPath(args) {
  return _asDirectory(args.root || args.dir || args.directory || args.repo || args.path || process.cwd());
}

function _conn() {
  return store.openConnection();
}

function codeIndex(args = {}) {
  const rootPath = _rootPath(args);
  const result = indexRepository({
    rootPath,
    conn: _conn(),
    force: args.force === true,
    maxFiles: args.max_files !== undefined ? Number(args.max_files) : undefined
  });
  return {
    root: result.rootPath,
    root_hash: result.rootHash,
    status: result.status,
    files: result.files,
    symbols: result.symbols,
    chunks: result.chunks,
    indexed_now: result.indexed,
    removed: result.removed,
    unchanged: result.skippedUnchanged,
    errors: result.errors,
    duration_ms: result.durationMs,
    skipped: result.skipped.slice(0, 50)
  };
}

function codeSearch(args = {}) {
  const text = args.query || args.q || args.text || args.pattern;
  if (!text) return { error: 'query is required' };
  const result = query.search({
    query: text,
    conn: _conn(),
    rootPath: _optionalRoot(args),
    limit: args.limit !== undefined ? Number(args.limit) : undefined
  });
  return {
    query: result.query,
    total: result.total,
    degraded: result.degraded,
    ...(result.error ? { error: result.error } : {}),
    hits: result.hits.map((h) => ({
      path: h.relPath,
      language: h.language,
      lines: [h.startLine, h.endLine],
      score: h.score,
      snippet: h.snippet
    }))
  };
}

function codeSymbol(args = {}) {
  const name = args.name || args.symbol || args.identifier;
  if (!name) return { error: 'name is required' };
  const result = query.findSymbol({
    name,
    conn: _conn(),
    rootPath: _optionalRoot(args)
  });
  return {
    name: result.name,
    ambiguous: result.ambiguous,
    candidate_count: result.candidateCount || 0,
    ...(result.error ? { error: result.error } : {}),
    symbols: result.symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      parent: s.parentName || null,
      path: s.relPath,
      language: s.language,
      lines: [s.startLine, s.endLine],
      signature: s.signature
    }))
  };
}

function codeContext(args = {}) {
  let relPath = args.file || args.path || args.rel_path || args.relPath;
  if (!relPath) return { error: 'file is required' };
  const rootPath = _optionalRoot(args);
  // An absolute file is resolved against the root the caller named.
  if (rootPath && path.isAbsolute(relPath)) relPath = path.relative(rootPath, relPath);
  const result = query.getContext({
    relPath,
    conn: _conn(),
    rootPath,
    startLine: args.start_line !== undefined ? Number(args.start_line) : args.line !== undefined ? Number(args.line) : undefined,
    endLine: args.end_line !== undefined ? Number(args.end_line) : undefined
  });
  if (result.error) return { error: result.error };
  // 'content', not 'text': file_tools_router#formatToolResult treats a 'text'
  // field as the whole payload and would emit the source instead of JSON.
  return {
    path: result.relPath,
    language: result.language,
    lines: [result.startLine, result.endLine],
    empty: result.truncated,
    content: result.text
  };
}

function codeImpact(args = {}) {
  const name = args.name || args.symbol || args.identifier;
  if (!name) return { error: 'name is required' };
  const result = query.impact({
    name,
    conn: _conn(),
    rootPath: _optionalRoot(args),
    maxDepth: args.max_depth !== undefined ? Number(args.max_depth) : undefined,
    maxNodes: args.max_nodes !== undefined ? Number(args.max_nodes) : undefined
  });
  if (result.error) return { error: result.error };
  return {
    name: result.name,
    truncated: result.truncated,
    max_depth: result.maxDepth,
    dependents: result.nodes.map((n) => ({
      path: n.relPath,
      line: n.line,
      depth: n.depth,
      kind: n.kind,
      of: n.target,
      enclosing: n.enclosing
    }))
  };
}

function codeStatus(args = {}) {
  const conn = _conn();
  const result = query.status({ conn, rootPath: _optionalRoot(args) });
  return {
    fts_available: store.ftsAvailable(conn),
    roots: result.roots.map((r) => ({
      root: r.root_path,
      root_hash: r.root_hash,
      status: r.status,
      files: r.file_count,
      symbols: r.symbol_count,
      chunks: r.chunk_count,
      indexed_at: r.indexed_at,
      error: r.error || null
    }))
  };
}

function codeRemove(args = {}) {
  const rootPath = _rootPath(args);
  const removed = store.removeRoot(_conn(), rootPath);
  return { root: rootPath, removed };
}

module.exports = {
  code_index: codeIndex,
  code_search: codeSearch,
  code_symbol: codeSymbol,
  code_context: codeContext,
  code_impact: codeImpact,
  code_status: codeStatus,
  code_remove: codeRemove
};
