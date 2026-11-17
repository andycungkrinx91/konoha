'use strict';

/**
 * Unified @genin Retrieval & Persistent Codebase Memory Orchestrator.
 *
 * Bridges Konoha's native `code_intel` SQLite index, complementary stdio LSP
 * enrichment, and persistent `persona_memories` / `projects` tables so `@genin`
 * and `sannin` delegation envelopes receive incremental repository truth and
 * structural architecture memory under a deterministic character budget.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const queryEngine = require('./query');
const provenance = require('./provenance');
const { indexRepository, indexRepositoryAsync } = require('./indexer');
const { defaultManager: lspManager } = require('./lsp_manager');
const personaMemory = require('../persona_memory');

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_MAX_HITS = 5;
const DEFAULT_SYNC_MAX_FILES = 5000;
const QUERY_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'how', 'does',
  'what', 'where', 'when', 'find', 'search', 'explore', 'check', 'analyze',
  'understand', 'show', 'list', 'code', 'file', 'files', 'repo', 'repository',
  'project', 'system', 'module', 'using', 'all', 'about', 'trace', 'inspect'
]);

function _isValidRepoDir(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') return null;
  const abs = path.resolve(projectPath);
  if (path.dirname(abs) === abs) return null;
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return null;
    return abs;
  } catch (_) {
    return null;
  }
}

function _extractCandidateSymbols(queryText) {
  const raw = String(queryText || '');
  const seen = new Set();
  const candidates = [];
  const push = (tok) => {
    const clean = tok.replace(/[^A-Za-z0-9_$]/g, '');
    if (clean.length < 3 || seen.has(clean) || QUERY_STOPWORDS.has(clean.toLowerCase())) return;
    seen.add(clean);
    candidates.push(clean);
  };
  for (const m of raw.matchAll(/`([A-Za-z0-9_$.:-]{3,64})`/g)) {
    const parts = m[1].split(/[.:/]/);
    push(parts[parts.length - 1]);
  }
  for (const m of raw.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]{2,60})\b/g)) {
    const token = m[1];
    if (/[A-Z]/.test(token.slice(1)) || token.includes('_')) push(token);
  }
  for (const m of raw.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]{2,60})\b/g)) {
    push(m[1]);
  }
  return candidates.slice(0, 6);
}

function _buildRetrievalQuery(queryText) {
  const clean = String(queryText || '').replace(/[`"']/g, ' ').trim();
  if (!clean) return '';
  const tokens = clean
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Za-z0-9_./-]+|[^A-Za-z0-9_./-]+$/g, ''))
    .filter((t) => t.length >= 2 && !QUERY_STOPWORDS.has(t.toLowerCase()));
  return (tokens.length > 0 ? tokens : clean.split(/\s+/)).slice(0, 8).join(' ');
}

function _summarizeTopology(conn, rootHash) {
  const counts = conn.prepare(`SELECT
      (SELECT COUNT(*) FROM code_files WHERE root_hash = ?) AS files,
      (SELECT COUNT(*) FROM code_symbols WHERE root_hash = ?) AS symbols,
      (SELECT COUNT(*) FROM code_chunks WHERE root_hash = ?) AS chunks,
      (SELECT COUNT(*) FROM code_edges WHERE root_hash = ?) AS edges`).get(rootHash, rootHash, rootHash, rootHash);
  const langs = conn.prepare(
    'SELECT language, COUNT(*) AS cnt FROM code_files WHERE root_hash = ? GROUP BY language ORDER BY cnt DESC, language ASC LIMIT 5'
  ).all(rootHash);
  const hubs = conn.prepare(`SELECT f.rel_path, COUNT(*) AS in_deg
      FROM code_edges e
      JOIN code_files f ON f.id = e.target_file_id
      WHERE e.root_hash = ? AND e.target_file_id IS NOT NULL
      GROUP BY e.target_file_id
      ORDER BY in_deg DESC, f.rel_path ASC
      LIMIT 4`).all(rootHash);
  return {
    files: counts ? counts.files : 0,
    symbols: counts ? counts.symbols : 0,
    chunks: counts ? counts.chunks : 0,
    edges: counts ? counts.edges : 0,
    languages: langs.map((r) => `${r.language}:${r.cnt}`),
    hubs: hubs.map((h) => `${h.rel_path}(${h.in_deg})`)
  };
}

function _upsertTopologyMemory({ memConn, rootPath, resolvedDbPath, agentName, memTitle, pHash, summaryContent }) {
  const existing = memConn.prepare(
    'SELECT id, content FROM persona_memories WHERE agent_name = ? AND title = ? AND project_hash = ? LIMIT 1'
  ).get(agentName, memTitle, pHash);
  if (existing && existing.content === summaryContent) return;
  if (existing) {
    memConn.prepare('DELETE FROM persona_memories WHERE id = ?').run(existing.id);
  }
  personaMemory.saveMemory({
    agentName,
    title: memTitle,
    content: summaryContent,
    memoryType: 'architecture',
    tags: 'codebase-memory,code-intel,topology',
    importance: 2,
    projectPath: rootPath,
    projectHash: pHash,
    sessionId: '',
    dbPath: resolvedDbPath
  });
}

function _closeSeparateConn(openSeparate, memConn, conn) {
  if ((!openSeparate && conn) || !memConn || memConn === conn) return;
  try { memConn.close(); } catch (_) { /* ignore */ }
}

function syncCodebaseMemory({ rootPath, rootHash, topology, conn, dbPath, agentName = 'genin' }) {
  if (!rootPath || !topology || topology.files === 0) return null;
  const connPath = conn && typeof conn.name === 'string' && conn.name && conn.name !== ':memory:' ? conn.name : null;
  const resolvedDbPath = dbPath || connPath || personaMemory.DB_PATH;
  const memTitle = `codebase:structure:${rootHash}`;
  const langList = topology.languages.length > 0 ? topology.languages.join(', ') : 'none';
  const hubList = topology.hubs.length > 0 ? topology.hubs.join(', ') : 'none';
  const summaryContent = (
    `Codebase topology for ${path.basename(rootPath)}: ` +
    `${topology.files} files, ${topology.symbols} symbols, ${topology.chunks} chunks, ${topology.edges} edges. ` +
    `Languages: ${langList}. Hub modules: ${hubList}.`
  );

  const openSeparate = Boolean(resolvedDbPath && (!connPath || resolvedDbPath !== connPath));
  const memConn = openSeparate || !conn ? personaMemory.getDb(resolvedDbPath) : conn;
  try {
    personaMemory.initMemoryTables(memConn);
    const pHash = personaMemory.computeProjectHash(rootPath);
    _upsertTopologyMemory({ memConn, rootPath, resolvedDbPath, agentName, memTitle, pHash, summaryContent });
    const profile = memConn.prepare('SELECT context_summary FROM projects WHERE project_hash = ?').get(pHash);
    if (!profile || !profile.context_summary || profile.context_summary.startsWith('Codebase topology for ')) {
      personaMemory.saveOrUpdateProject(rootPath, summaryContent, null, resolvedDbPath);
    }
    return { title: memTitle, content: summaryContent, projectHash: pHash };
  } catch (_) {
    return null;
  } finally {
    _closeSeparateConn(openSeparate, memConn, conn);
  }
}

function _finalizeFreshIndex(conn, absRoot, indexResult) {
  const rootRow = store.getRoot(conn, absRoot);
  if (!rootRow) return { available: false, reason: 'root_unindexed' };
  const topology = _summarizeTopology(conn, rootRow.root_hash);
  return {
    available: true,
    rootPath: absRoot,
    rootHash: rootRow.root_hash,
    status: rootRow.status,
    indexResult,
    topology
  };
}

function ensureCodeIndexFresh(options = {}) {
  const absRoot = _isValidRepoDir(options.rootPath);
  if (!absRoot) return { available: false, reason: 'invalid_project_path' };
  const conn = options.conn || store.openConnection();
  const existing = store.getRoot(conn, absRoot);
  let indexResult = null;
  if (options.sync !== false || !existing) {
    indexResult = indexRepository({
      rootPath: absRoot,
      conn,
      maxFiles: Math.min(Number(options.maxFiles) || DEFAULT_SYNC_MAX_FILES, DEFAULT_SYNC_MAX_FILES),
      timeoutMs: options.timeoutMs || 15000
    });
  }
  return _finalizeFreshIndex(conn, absRoot, indexResult);
}

async function ensureCodeIndexFreshAsync(options = {}) {
  const absRoot = _isValidRepoDir(options.rootPath);
  if (!absRoot) return { available: false, reason: 'invalid_project_path' };
  const conn = options.conn || store.openConnection();
  const existing = store.getRoot(conn, absRoot);
  let indexResult = null;
  if (options.sync !== false || !existing) {
    indexResult = await indexRepositoryAsync({
      rootPath: absRoot,
      conn,
      embed: options.embed,
      maxFiles: Math.min(Number(options.maxFiles) || DEFAULT_SYNC_MAX_FILES, DEFAULT_SYNC_MAX_FILES),
      timeoutMs: options.timeoutMs || 15000
    });
  }
  return _finalizeFreshIndex(conn, absRoot, indexResult);
}

function _queryMatchingSymbols(conn, absRoot, queryText, hits) {
  const candidates = _extractCandidateSymbols(queryText);
  if (candidates.length === 0 && hits.length > 0 && hits[0].symbolName) {
    candidates.push(hits[0].symbolName);
  }
  const symbols = [];
  const seen = new Set();
  for (const name of candidates.slice(0, 3)) {
    const found = queryEngine.findSymbol({ name, rootPath: absRoot, conn, limit: 3 });
    for (const s of found.symbols || []) {
      const k = `${s.relPath}:${s.name}:${s.startLine}`;
      if (!seen.has(k)) {
        seen.add(k);
        symbols.push(s);
      }
      if (symbols.length >= 4) break;
    }
    if (symbols.length >= 4) break;
  }
  let impact = null;
  if (symbols.length > 0) {
    const primary = symbols[0];
    const imp = queryEngine.impact({ name: primary.name, rootPath: absRoot, conn, maxDepth: 2, maxNodes: 6 });
    if (!imp.error && imp.nodes.length > 0) {
      impact = { target: primary.name, nodes: imp.nodes.slice(0, 6) };
    }
  }
  return { symbols, impact };
}

function _loadPersistedMemories(absRoot, queryText, sessionId, dbPath) {
  try {
    const qMems = personaMemory.queryMemories({
      query: queryText || 'codebase architecture',
      projectPath: absRoot,
      sessionId,
      allSessions: false,
      limit: 3,
      excludeDomains: ['shared_task'],
      dbPath: dbPath || personaMemory.DB_PATH
    });
    if (Array.isArray(qMems) && qMems.length > 0) return qMems;
    return personaMemory.listMemories({
      projectPath: absRoot,
      allSessions: true,
      limit: 3,
      dbPath: dbPath || personaMemory.DB_PATH
    }) || [];
  } catch (_) {
    return [];
  }
}

function _truncateTextStrict(text, maxChars) {
  if (text.length <= maxChars) return text;
  if (maxChars <= 16) return text.slice(0, maxChars);
  const sliced = text.slice(0, maxChars - 14);
  const cut = sliced.lastIndexOf('\n');
  const clean = cut > Math.floor(maxChars * 0.5) ? sliced.slice(0, cut) : sliced;
  return `${clean.trimEnd()}\n...[bounded]`;
}

function _formatUnifiedContext({ fresh, hits, symbols, impact, lspEnrich, memories, maxChars }) {
  const cap = Math.max(120, Number(maxChars) || DEFAULT_MAX_CHARS);
  const topo = fresh.topology || { files: 0, symbols: 0, edges: 0, languages: [] };
  const lines = [];
  lines.push(
    `### Unified Codebase Retrieval (${fresh.status}: ${topo.files} files, ${topo.symbols} symbols, ${topo.edges} edges)`
  );
  if (topo.languages && topo.languages.length > 0) {
    lines.push(`- Languages: ${topo.languages.join(', ')}`);
  }
  if (hits && hits.length > 0) {
    lines.push('- Top Code Hits:');
    for (const h of hits.slice(0, 4)) {
      const snip = String(h.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 90);
      const sym = h.symbolName ? ` (${h.symbolName})` : '';
      lines.push(`  - \`${h.relPath}:${h.startLine}-${h.endLine}\`${sym}: ${snip}`);
    }
  }
  if (symbols && symbols.length > 0) {
    const symStr = symbols.slice(0, 3).map((s) => `\`${s.name}\`@${s.relPath}:${s.startLine}`).join(', ');
    lines.push(`- Symbols: ${symStr}`);
  }
  if (impact && impact.nodes && impact.nodes.length > 0) {
    const deps = impact.nodes.slice(0, 4).map((n) => `\`${n.relPath}:${n.line}\`(${n.kind})`).join(', ');
    lines.push(`- Impact (\`${impact.target}\`): ${deps}`);
  }
  if (lspEnrich && lspEnrich.lsp_available) {
    const refCount = Array.isArray(lspEnrich.references) ? lspEnrich.references.length : 0;
    const hover = lspEnrich.hover ? ` | ${String(lspEnrich.hover).replace(/\s+/g, ' ').slice(0, 80)}` : '';
    lines.push(`- LSP (${lspEnrich.server}): ${refCount} refs${hover}`);
  }
  if (memories && memories.length > 0) {
    lines.push('- Persisted Memory:');
    for (const m of memories.slice(0, 2)) {
      const c = String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      lines.push(`  - [${m.memory_type || 'memory'}] ${c}`);
    }
  }
  const text = _truncateTextStrict(`${lines.join('\n')}\n`, cap);
  return { text, budgetUsed: text.length, maxChars: cap };
}

function _fallbackTerms(rawQuery, effQuery) {
  const candidates = _extractCandidateSymbols(rawQuery);
  return [...new Set([...candidates, ...effQuery.split(/\s+/).filter((t) => t.length >= 2)])].slice(0, 6);
}

function _mergeUniqueHits(merged, seen, hits, limit) {
  for (const hit of hits || []) {
    const key = `${hit.relPath}:${hit.startLine}:${hit.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
    if (merged.length >= limit) return true;
  }
  return false;
}

function _searchSyncWithFallback(conn, absRoot, rawQuery, effQuery, limit) {
  if (!effQuery) return { hits: [], total: 0, degraded: false, semantic_status: 'disabled', semantic_applied: false, reranked: false };
  const primary = queryEngine.search({ rootPath: absRoot, query: effQuery, conn, limit });
  if (primary && Array.isArray(primary.hits) && primary.hits.length > 0) return primary;

  const merged = [];
  const seen = new Set();
  let degraded = Boolean(primary && primary.degraded);
  const statuses = [primary && primary.semantic_status];
  for (const term of _fallbackTerms(rawQuery, effQuery)) {
    const res = queryEngine.search({ rootPath: absRoot, query: term, conn, limit });
    if (res && res.degraded) degraded = true;
    if (res && res.semantic_status) statuses.push(res.semantic_status);
    if (_mergeUniqueHits(merged, seen, res && res.hits, limit)) break;
  }
  return {
    query: effQuery,
    hits: merged,
    total: merged.length,
    degraded,
    semantic_status: provenance.mergeSemanticStatuses(statuses),
    semantic_applied: false,
    reranked: false
  };
}

async function _searchAsyncWithFallback(conn, absRoot, rawQuery, effQuery, limit) {
  if (!effQuery) return { hits: [], total: 0, degraded: false, semantic_status: 'disabled', semantic_applied: false, reranked: false };
  const primary = await queryEngine.searchAsync({ rootPath: absRoot, query: effQuery, conn, limit });
  if (primary && Array.isArray(primary.hits) && primary.hits.length > 0) return primary;

  const merged = [];
  const seen = new Set();
  let degraded = Boolean(primary && primary.degraded);
  let semanticApplied = Boolean(primary && primary.semantic_applied);
  let reranked = Boolean(primary && primary.reranked);
  const statuses = [primary && primary.semantic_status];
  for (const term of _fallbackTerms(rawQuery, effQuery)) {
    const res = await queryEngine.searchAsync({ rootPath: absRoot, query: term, conn, limit });
    if (res && res.degraded) degraded = true;
    if (res && res.semantic_applied) semanticApplied = true;
    if (res && res.reranked) reranked = true;
    if (res && res.semantic_status) statuses.push(res.semantic_status);
    if (_mergeUniqueHits(merged, seen, res && res.hits, limit)) break;
  }
  return {
    query: effQuery,
    hits: merged,
    total: merged.length,
    degraded,
    semantic_status: provenance.mergeSemanticStatuses(statuses),
    semantic_applied: semanticApplied,
    reranked
  };
}

function _prepareRetrievalPostIndex(conn, absRoot, fresh, options) {
  if (!fresh.available) {
    return { errorResult: { available: false, reason: fresh.reason, text: '' } };
  }
  const persistedArch = syncCodebaseMemory({
    rootPath: absRoot,
    rootHash: fresh.rootHash,
    topology: fresh.topology,
    conn,
    dbPath: options.dbPath,
    agentName: options.agentName || 'genin'
  });
  return {
    persistedArch,
    effQuery: _buildRetrievalQuery(options.query)
  };
}

function _buildUnifiedContextResult({
  absRoot,
  fresh,
  persistedArch,
  searchRes,
  symbols,
  impact,
  lspEnrich = null,
  memories,
  maxChars,
  extraFields = {}
}) {
  const hits = searchRes.hits || [];
  const formatted = _formatUnifiedContext({
    fresh,
    hits,
    symbols,
    impact,
    lspEnrich,
    memories,
    maxChars: maxChars || DEFAULT_MAX_CHARS
  });

  return {
    available: true,
    rootPath: absRoot,
    rootHash: fresh.rootHash,
    status: fresh.status,
    topology: fresh.topology,
    persistedMemoryId: persistedArch ? persistedArch.title : null,
    hits,
    symbols,
    impact,
    ...extraFields,
    memories,
    budgetUsed: formatted.budgetUsed,
    maxChars: formatted.maxChars,
    text: formatted.text
  };
}

function retrieveUnifiedContextSync(options = {}) {
  const absRoot = _isValidRepoDir(options.projectPath || options.rootPath);
  if (!absRoot) return { available: false, reason: 'invalid_project_path', text: '' };
  const conn = options.conn || store.openConnection();
  try {
    const fresh = ensureCodeIndexFresh({
      rootPath: absRoot,
      conn,
      sync: options.sync,
      maxFiles: options.maxFiles
    });
    const prep = _prepareRetrievalPostIndex(conn, absRoot, fresh, options);
    if (prep.errorResult) return prep.errorResult;

    const searchRes = _searchSyncWithFallback(
      conn,
      absRoot,
      options.query,
      prep.effQuery,
      options.maxHits || DEFAULT_MAX_HITS
    );
    const { symbols, impact } = _queryMatchingSymbols(conn, absRoot, options.query, searchRes.hits || []);
    const memories = _loadPersistedMemories(absRoot, prep.effQuery, options.sessionId, options.dbPath);

    return _buildUnifiedContextResult({
      absRoot,
      fresh,
      persistedArch: prep.persistedArch,
      searchRes,
      symbols,
      impact,
      memories,
      maxChars: options.maxChars,
      extraFields: {
        mode: 'sync',
        semantic_status: searchRes.semantic_status || 'disabled',
        semantic_applied: Boolean(searchRes.semantic_applied),
        reranked: Boolean(searchRes.reranked),
        degraded: Boolean(searchRes.degraded),
        lspStatus: lspManager.getStatusSnapshot()
      }
    });
  } catch (err) {
    return { available: false, reason: err.message || 'retrieval_failed', text: '' };
  }
}

async function retrieveUnifiedContextAsync(options = {}) {
  const absRoot = _isValidRepoDir(options.projectPath || options.rootPath);
  if (!absRoot) return { available: false, reason: 'invalid_project_path', text: '' };
  const conn = options.conn || store.openConnection();
  try {
    const fresh = await ensureCodeIndexFreshAsync({
      rootPath: absRoot,
      conn,
      sync: options.sync,
      embed: options.embed,
      maxFiles: options.maxFiles
    });
    const prep = _prepareRetrievalPostIndex(conn, absRoot, fresh, options);
    if (prep.errorResult) return prep.errorResult;

    const searchRes = await _searchAsyncWithFallback(
      conn,
      absRoot,
      options.query,
      prep.effQuery,
      options.maxHits || DEFAULT_MAX_HITS
    );
    const { symbols, impact } = _queryMatchingSymbols(conn, absRoot, options.query, searchRes.hits || []);
    let lspEnrich = null;
    if (options.lsp !== false && symbols.length > 0) {
      lspEnrich = await lspManager.enrichSymbol({
        rootPath: absRoot,
        symbols,
        name: symbols[0].name,
        timeoutMs: options.lspTimeoutMs,
        commandOverride: options.lspCommandOverride
      }).catch(() => null);
    }
    const memories = _loadPersistedMemories(absRoot, prep.effQuery, options.sessionId, options.dbPath);

    return _buildUnifiedContextResult({
      absRoot,
      fresh,
      persistedArch: prep.persistedArch,
      searchRes,
      symbols,
      impact,
      lspEnrich,
      memories,
      maxChars: options.maxChars,
      extraFields: {
        mode: 'async',
        semantic_status: searchRes.semantic_status || 'disabled',
        semantic_applied: Boolean(searchRes.semantic_applied),
        reranked: Boolean(searchRes.reranked),
        lsp: lspEnrich,
        degraded: Boolean(searchRes.degraded)
      }
    });
  } catch (err) {
    return { available: false, reason: err.message || 'retrieval_failed', text: '' };
  }
}

module.exports = {
  DEFAULT_MAX_CHARS,
  ensureCodeIndexFresh,
  ensureCodeIndexFreshAsync,
  syncCodebaseMemory,
  retrieveUnifiedContextSync,
  retrieveUnifiedContextAsync,
  _extractCandidateSymbols
};
