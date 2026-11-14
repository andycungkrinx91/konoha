'use strict';

/**
 * MCP tool handlers for the native code-intelligence index.
 *
 * Handlers validate workspace/repository containment, apply runtime options,
 * delegate to the index/query engine, and return plain objects for `file_tools_router`.
 */

const fs = require('fs');
const path = require('path');
const { indexRepository, indexRepositoryAsync } = require('./indexer');
const store = require('./store');
const query = require('./query');
const { isSemanticSearchEnabled } = require('../vector_pipeline');

function _asDirectory(raw) {
  const abs = path.resolve(String(raw));
  try {
    return fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  } catch (_) {
    return abs;
  }
}

function _realpathOrResolve(target, depth = 0) {
  const resolved = path.resolve(String(target));
  try {
    return fs.realpathSync(resolved);
  } catch (_) {
    const pending = [];
    let cursor = resolved;
    while (cursor && cursor !== path.dirname(cursor)) {
      let lstat = null;
      try {
        lstat = fs.lstatSync(cursor);
      } catch (_) {
        lstat = null;
      }
      if (lstat) {
        if (lstat.isSymbolicLink() && depth < 16) {
          try {
            const rawLink = fs.readlinkSync(cursor);
            const targetPath = path.resolve(path.dirname(cursor), rawLink);
            const fullTarget = pending.length > 0 ? path.join(targetPath, ...pending) : targetPath;
            return _realpathOrResolve(fullTarget, depth + 1);
          } catch (_) {
            break;
          }
        }
        break;
      }
      pending.unshift(path.basename(cursor));
      cursor = path.dirname(cursor);
    }
    try {
      const base = fs.existsSync(cursor) ? fs.realpathSync(cursor) : cursor;
      return pending.length > 0 ? path.join(base, ...pending) : base;
    } catch (_) {
      return resolved;
    }
  }
}

function _router() {
  return require('../file_tools_router');
}

function _validateRootPath(raw) {
  const realDir = _realpathOrResolve(_asDirectory(raw));
  _router().assertWithinAllowed(realDir);
  return realDir;
}

// Explicit directory keys outrank 'path', which callers also use to name a file.
function _optionalRoot(args) {
  const raw = args.root || args.dir || args.directory || args.repo || args.path;
  return raw ? _validateRootPath(raw) : undefined;
}

function _rootPath(args) {
  const raw = args.root || args.dir || args.directory || args.repo || args.path
    || _router().getWorkspaceRoot() || process.cwd();
  return _validateRootPath(raw);
}

function _resolveContainedFile(rootPath, rawFile) {
  const normalizedInput = String(rawFile).replace(/\\/g, '/');
  if (rootPath) {
    const candidate = path.isAbsolute(rawFile) ? path.resolve(rawFile) : path.resolve(rootPath, rawFile);
    const realFile = _realpathOrResolve(candidate);
    const rel = path.relative(rootPath, realFile);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`Path outside repository root: ${rawFile}`);
    }
    _router().assertWithinAllowed(realFile);
    return { realFile, relPath: rel.replace(/\\/g, '/') };
  }
  const base = _realpathOrResolve(_router().getWorkspaceRoot() || process.cwd());
  const candidate = path.isAbsolute(rawFile) ? path.resolve(rawFile) : path.resolve(base, rawFile);
  const realFile = _realpathOrResolve(candidate);
  const relFromBase = path.relative(base, realFile);
  if (relFromBase === '..' || relFromBase.startsWith(`..${path.sep}`) || path.isAbsolute(relFromBase)) {
    throw new Error(`Path outside workspace: ${rawFile}`);
  }
  _router().assertWithinAllowed(realFile);
  const rel = path.relative(base, realFile);
  const relPath = (!rel.startsWith('..') && !path.isAbsolute(rel))
    ? rel.replace(/\\/g, '/')
    : normalizedInput.replace(/^\.\//, '');
  return { realFile, relPath };
}

function _conn() {
  return store.openConnection();
}

function _buildIndexOptions(args = {}, extra = {}) {
  const rootPath = _rootPath(args);
  const verify = (args.verify === 'fast_stat' || args.fast_stat === true) ? 'fast_stat' : 'strict';
  return {
    rootPath,
    conn: _conn(),
    force: args.force === true,
    verify,
    fast_stat: verify === 'fast_stat',
    embed: args.embed !== undefined ? args.embed !== false : isSemanticSearchEnabled(),
    embeddingModel: args.embedding_model,
    maxFiles: args.max_files !== undefined ? Number(args.max_files) : undefined,
    timeoutMs: args.timeout_ms !== undefined ? Number(args.timeout_ms) : undefined,
    ...extra
  };
}

function _formatIndexResponse(result) {
  return {
    root: result.rootPath,
    root_hash: result.rootHash,
    status: result.status,
    verify_mode: result.verifyMode || 'strict',
    files: result.files,
    symbols: result.symbols,
    chunks: result.chunks,
    edges: result.edges || 0,
    edges_resolved: result.edgesResolved || 0,
    embedded_chunks: result.embeddedChunks || 0,
    embedding_model: result.embeddingModel || null,
    ...(result.semanticSkipped ? { semantic_skipped: result.semanticSkipped } : {}),
    indexed_now: result.indexed,
    removed: result.removed,
    unchanged: result.skippedUnchanged,
    errors: result.errors,
    duration_ms: result.durationMs,
    skipped: result.skipped.slice(0, 50)
  };
}

async function _withTimeoutAbort(timeoutMs, fn) {
  const controller = new AbortController();
  let timer = null;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  }
  try {
    return await fn(controller.signal);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function codeIndex(args = {}) {
  return _formatIndexResponse(indexRepository(_buildIndexOptions(args)));
}

async function codeIndexAsync(args = {}) {
  const opts = _buildIndexOptions(args);
  const result = await _withTimeoutAbort(opts.timeoutMs, (signal) =>
    indexRepositoryAsync({ ...opts, signal })
  );
  return _formatIndexResponse(result);
}

function _formatSearchResponse(result) {
  return {
    query: result.query,
    total: result.total,
    degraded: result.degraded,
    semantic_applied: Boolean(result.semantic_applied),
    reranked: Boolean(result.reranked),
    ...(result.error ? { error: result.error } : {}),
    hits: result.hits.map((h) => ({
      path: h.relPath,
      language: h.language,
      lines: [h.startLine, h.endLine],
      ...(h.symbolName ? { symbol: h.symbolName } : {}),
      score: h.score,
      ...(h.vectorScore ? { vector_score: h.vectorScore } : {}),
      ...(h.rerankScore ? { rerank_score: h.rerankScore } : {}),
      snippet: h.snippet
    }))
  };
}

function _searchOptions(args = {}) {
  return {
    query: args.query || args.q || args.text || args.pattern,
    conn: _conn(),
    rootPath: _optionalRoot(args),
    limit: args.limit !== undefined ? Number(args.limit) : undefined,
    filter: args.filter,
    semantic: args.semantic,
    rerank: args.rerank
  };
}

function codeSearch(args = {}) {
  const opts = _searchOptions(args);
  if (!opts.query) return { error: 'query is required' };
  return _formatSearchResponse(query.search(opts));
}

async function codeSearchAsync(args = {}) {
  const opts = _searchOptions(args);
  if (!opts.query) return { error: 'query is required' };
  return _formatSearchResponse(await query.searchAsync(opts));
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
  const rawFile = args.file || args.file_path || args.path || args.rel_path || args.relPath;
  if (!rawFile) return { error: 'file is required' };
  const rootPath = _optionalRoot(args);
  const { relPath } = _resolveContainedFile(rootPath, rawFile);
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
    empty: !result.text || Boolean(result.truncated),
    truncated: Boolean(result.truncated),
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

function _buildRelatedOptions(args = {}) {
  const rootPath = _optionalRoot(args);
  const hasExplicitDir = Boolean(args.root || args.dir || args.directory || args.repo);
  const rawFile = args.file || args.file_path || args.rel_path || args.relPath || (hasExplicitDir ? args.path : undefined);
  const symbol = args.symbol || args.name || args.identifier;
  if (!rawFile && !symbol) return { error: 'file or symbol is required' };
  let relPath = '';
  if (rawFile) {
    relPath = _resolveContainedFile(rootPath, rawFile).relPath;
  }
  return {
    conn: _conn(),
    rootPath,
    relPath,
    symbol,
    limit: args.limit !== undefined ? Number(args.limit) : undefined,
    filter: args.filter,
    semantic: args.semantic,
    rerank: args.rerank
  };
}

function _formatRelatedResponse(result) {
  if (result.error) {
    return {
      error: result.error,
      anchor: result.anchor || null,
      related: [],
      total: 0
    };
  }
  return {
    anchor: result.anchor,
    total: result.total,
    semantic_applied: Boolean(result.semantic_applied),
    reranked: Boolean(result.reranked),
    degraded: Boolean(result.degraded),
    related: result.related.map((r) => ({
      path: r.relPath,
      language: r.language,
      content_kind: r.contentKind,
      score: r.score,
      structural_score: r.structuralScore,
      vector_score: r.vectorScore,
      rerank_score: r.rerankScore,
      reasons: r.reasons,
      relationships: r.relationships,
      best_span: r.bestSpan,
      snippet: r.snippet
    }))
  };
}

function codeRelated(args = {}) {
  const opts = _buildRelatedOptions(args);
  if (opts.error) return { error: opts.error };
  return _formatRelatedResponse(query.related(opts));
}

async function codeRelatedAsync(args = {}) {
  const opts = _buildRelatedOptions(args);
  if (opts.error) return { error: opts.error };
  return _formatRelatedResponse(await query.relatedAsync(opts));
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
  code_index_async: codeIndexAsync,
  code_search: codeSearch,
  code_search_async: codeSearchAsync,
  code_symbol: codeSymbol,
  code_context: codeContext,
  code_impact: codeImpact,
  code_related: codeRelated,
  code_related_async: codeRelatedAsync,
  code_status: codeStatus,
  code_remove: codeRemove
};
