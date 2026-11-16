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
const { defaultManager: lspManager } = require('./lsp_manager');

function _asDirectory(raw) {
  const abs = path.resolve(String(raw));
  try {
    return fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  } catch (_) {
    return abs;
  }
}

function _tryFollowParentSymlink(cursor, pending, depth) {
  let lstat = null;
  try {
    lstat = fs.lstatSync(cursor);
  } catch (_) {
    return 'continue';
  }
  if (!lstat) return 'continue';
  if (!lstat.isSymbolicLink() || depth >= 16) return 'break';
  try {
    const rawLink = fs.readlinkSync(cursor);
    const targetPath = path.resolve(path.dirname(cursor), rawLink);
    const fullTarget = pending.length > 0 ? path.join(targetPath, ...pending) : targetPath;
    return _realpathOrResolve(fullTarget, depth + 1);
  } catch (_) {
    return 'break';
  }
}

function _resolveNonexistentRealpath(resolved, depth) {
  const pending = [];
  let cursor = resolved;
  while (cursor && cursor !== path.dirname(cursor)) {
    const step = _tryFollowParentSymlink(cursor, pending, depth);
    if (step === 'break') break;
    if (step !== 'continue') return step;
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

function _realpathOrResolve(target, depth = 0) {
  const resolved = path.resolve(String(target));
  try {
    return fs.realpathSync(resolved);
  } catch (_) {
    return _resolveNonexistentRealpath(resolved, depth);
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
    ...(result.incomplete ? {
      incomplete: true,
      cap_reached: Boolean(result.capReached),
      unreadable_dirs: result.unreadableDirs || [],
      unreadable_files: result.unreadableFiles || []
    } : {}),
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
    ...(result.snapshot ? { snapshot: result.snapshot } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.error ? { error: result.error } : {}),
    hits: result.hits.map((h) => ({
      path: h.relPath,
      language: h.language,
      lines: [h.startLine, h.endLine],
      ...(h.symbolName ? { symbol: h.symbolName } : {}),
      score: h.score,
      ...(h.vectorScore ? { vector_score: h.vectorScore } : {}),
      ...(h.rerankScore ? { rerank_score: h.rerankScore } : {}),
      provenance: h.provenance || 'heuristic',
      confidence: h.confidence !== undefined ? h.confidence : 0.6,
      ...(h.parseEngine ? { parse_engine: h.parseEngine } : {}),
      ...(h.contentHash ? { content_hash: h.contentHash } : {}),
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
    ...(result.snapshot ? { snapshot: result.snapshot } : {}),
    ...(result.error ? { error: result.error } : {}),
    symbols: result.symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      parent: s.parentName || null,
      path: s.relPath,
      language: s.language,
      lines: [s.startLine, s.endLine],
      signature: s.signature,
      provenance: s.provenance || 'heuristic',
      confidence: s.confidence !== undefined ? s.confidence : 0.6,
      ...(s.parseEngine ? { parse_engine: s.parseEngine } : {}),
      ...(s.contentHash ? { content_hash: s.contentHash } : {})
    }))
  };
}

function _resolveRootByRelPath(relPath) {
  if (!relPath) return null;
  try {
    const roots = store.listRoots(_conn());
    const match = roots.find((r) => r.root_path && fs.existsSync(path.join(r.root_path, relPath)));
    return match ? _validateRootPath(match.root_path) : null;
  } catch (_) {
    return null;
  }
}

function _resolveRootForLsp(args, relPath = '') {
  const explicit = args.root || args.dir || args.directory || args.repo;
  if (explicit) return _validateRootPath(explicit);
  const byRelPath = _resolveRootByRelPath(relPath);
  if (byRelPath) return byRelPath;
  const ws = _router().getWorkspaceRoot();
  return ws ? _validateRootPath(ws) : null;
}

async function codeSymbolAsync(args = {}) {
  const base = codeSymbol(args);
  if (base.error || args.lsp === false || !Array.isArray(base.symbols) || base.symbols.length === 0) {
    return base;
  }
  const first = base.symbols[0];
  const rootPath = _resolveRootForLsp(args, first.path);
  if (!rootPath) return base;
  const lsp = await lspManager.enrichSymbol({
    rootPath,
    name: base.name,
    symbols: base.symbols.map((s) => ({
      name: s.name,
      relPath: s.path,
      language: s.language,
      startLine: Array.isArray(s.lines) ? s.lines[0] : 1
    })),
    timeoutMs: args.lsp_timeout_ms
  });
  return lsp && lsp.lsp_available ? { ...base, lsp } : base;
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
    lines: result.startLine > 0 ? [result.startLine, result.endLine] : [0, 0],
    empty: !result.text,
    out_of_range: Boolean(result.outOfRange),
    truncated: Boolean(result.truncated),
    provenance: result.provenance || 'heuristic',
    confidence: result.confidence !== undefined ? result.confidence : 0.6,
    ...(result.parseEngine ? { parse_engine: result.parseEngine } : {}),
    ...(result.contentHash ? { content_hash: result.contentHash } : {}),
    ...(result.snapshot ? { snapshot: result.snapshot } : {}),
    content: result.text
  };
}

async function codeContextAsync(args = {}) {
  const base = codeContext(args);
  if (base.error || base.out_of_range || base.empty || args.lsp === false) return base;
  const rootPath = _resolveRootForLsp(args, base.path);
  if (!rootPath) return base;
  const lsp = await lspManager.enrichContext({
    rootPath,
    relPath: base.path,
    startLine: Array.isArray(base.lines) ? base.lines[0] : 1,
    language: base.language,
    timeoutMs: args.lsp_timeout_ms
  });
  return lsp && lsp.lsp_available ? { ...base, lsp } : base;
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
    ...(result.snapshot ? { snapshot: result.snapshot } : {}),
    dependents: result.nodes.map((n) => ({
      path: n.relPath,
      line: n.line,
      depth: n.depth,
      kind: n.kind,
      of: n.target,
      enclosing: n.enclosing,
      provenance: n.provenance || 'unresolved',
      confidence: n.confidence !== undefined ? n.confidence : 0.35,
      resolved: Boolean(n.resolved),
      ...(n.contentHash ? { content_hash: n.contentHash } : {})
    }))
  };
}

async function codeImpactAsync(args = {}) {
  const base = codeImpact(args);
  if (base.error || args.lsp === false) return base;
  const conn = _conn();
  const rootPathOpt = args.root || args.dir || args.directory || args.repo
    ? _validateRootPath(args.root || args.dir || args.directory || args.repo)
    : undefined;
  const symRes = query.findSymbol({ name: base.name, conn, rootPath: rootPathOpt });
  const anchor = symRes && Array.isArray(symRes.symbols) ? symRes.symbols[0] : null;
  if (!anchor) return base;
  const rootPath = rootPathOpt || _resolveRootForLsp(args, anchor.relPath);
  if (!rootPath) return base;
  const lsp = await lspManager.enrichImpact({
    rootPath,
    anchorSymbol: anchor,
    name: base.name,
    timeoutMs: args.lsp_timeout_ms
  });
  if (!lsp || !lsp.lsp_available) return base;
  const existingKeys = new Set(base.dependents.map((d) => `${d.path}:${d.line}`));
  const merged = [...base.dependents];
  for (const ref of lsp.references || []) {
    const key = `${ref.relPath}:${ref.line}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    merged.push({
      path: ref.relPath,
      line: ref.line,
      depth: 1,
      kind: 'lsp_reference',
      of: base.name,
      enclosing: null,
      provenance: 'lsp',
      confidence: 1.0,
      resolved: true
    });
  }
  return { ...base, dependents: merged, lsp };
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
    ...(result.snapshot ? { snapshot: result.snapshot } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
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
      provenance: r.provenance || 'heuristic',
      confidence: r.confidence !== undefined ? r.confidence : 0.6,
      ...(r.parseEngine ? { parse_engine: r.parseEngine } : {}),
      ...(r.contentHash ? { content_hash: r.contentHash } : {}),
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
  const base = _formatRelatedResponse(await query.relatedAsync(opts));
  if (base.error || args.lsp === false || !base.anchor || !base.anchor.relPath) {
    return base;
  }
  const rootPath = opts.rootPath || _resolveRootForLsp(args, base.anchor.relPath);
  if (!rootPath) return base;
  let anchorLine = Number(args.line) || 1;
  const targetSym = opts.symbol || base.anchor.symbol;
  if (!args.line && targetSym) {
    const found = query.findSymbol({ name: targetSym, conn: opts.conn, rootPath });
    const match = (found.symbols || []).find((s) => s.relPath === base.anchor.relPath);
    if (match) anchorLine = match.startLine;
  }
  const lsp = await lspManager.enrichRelated({
    rootPath,
    relPath: base.anchor.relPath,
    line: anchorLine,
    symbol: targetSym,
    language: base.anchor.language,
    timeoutMs: args.lsp_timeout_ms
  });
  return lsp && lsp.lsp_available ? { ...base, lsp } : base;
}

function codeStatus(args = {}) {
  const conn = _conn();
  const result = query.status({ conn, rootPath: _optionalRoot(args) });
  return {
    fts_available: store.ftsAvailable(conn),
    lsp: lspManager.getStatusSnapshot(),
    roots: result.roots.map((r) => ({
      root: r.root_path,
      root_hash: r.root_hash,
      head_sha: r.head_sha || '',
      ...(r.current_head_sha ? { current_head_sha: r.current_head_sha } : {}),
      status: r.status,
      snapshot_consistent: r.snapshot_consistent !== undefined ? Boolean(r.snapshot_consistent) : (r.status === 'fresh' || r.status === 'ready'),
      stale_head: Boolean(r.stale_head),
      files: r.file_count,
      symbols: r.symbol_count,
      chunks: r.chunk_count,
      indexed_at: r.indexed_at,
      indexed_epoch_ms: Number(r.indexed_epoch_ms || 0),
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
  code_symbol_async: codeSymbolAsync,
  code_context: codeContext,
  code_context_async: codeContextAsync,
  code_impact: codeImpact,
  code_impact_async: codeImpactAsync,
  code_related: codeRelated,
  code_related_async: codeRelatedAsync,
  code_status: codeStatus,
  code_remove: codeRemove
};
