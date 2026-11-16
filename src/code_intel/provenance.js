'use strict';

/**
 * Provenance, extraction confidence, content hashing, and snapshot freshness helpers
 * for native code intelligence DB rows and tool responses.
 */

function parseMetricsJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw)) || {};
  } catch (_) {
    return {};
  }
}

function classifyEngineProvenance(engine) {
  const normalized = String(engine || 'lexer').trim();
  if (normalized === 'tree-sitter-wasm') {
    return { provenance: 'parser', parseEngine: normalized, verified: true, defaultConfidence: 1.0 };
  }
  if (normalized === 'structured-markdown' || normalized === 'structured-config') {
    return { provenance: 'parser', parseEngine: normalized, verified: true, defaultConfidence: 0.95 };
  }
  if (normalized === 'lsp') {
    return { provenance: 'lsp', parseEngine: 'lsp', verified: true, defaultConfidence: 1.0 };
  }
  return { provenance: 'heuristic', parseEngine: normalized || 'lexer', verified: false, defaultConfidence: 0.6 };
}

function buildFileProvenance(fileRow = {}) {
  const metrics = parseMetricsJson(fileRow.metrics_json || fileRow.metricsJson);
  const engine = fileRow.parseEngine || metrics.engine || 'lexer';
  const base = classifyEngineProvenance(engine);
  return {
    provenance: base.provenance,
    parseEngine: base.parseEngine,
    parserVersion: fileRow.parser_version || fileRow.parserVersion || '',
    contentHash: fileRow.content_hash || fileRow.contentHash || '',
    verified: base.verified,
    confidence: base.defaultConfidence,
    indexedAt: fileRow.indexed_at || fileRow.indexedAt || ''
  };
}

function resolveRefProvenance(fileEngine, resolvedTargetId, confidenceOverride = null) {
  if (!resolvedTargetId) {
    return {
      provenance: 'unresolved',
      confidence: confidenceOverride !== null ? Number(confidenceOverride) : 0.35,
      resolved: false
    };
  }
  const engineInfo = classifyEngineProvenance(fileEngine);
  const conf = confidenceOverride !== null ? Number(confidenceOverride) : (engineInfo.verified ? 0.95 : 0.65);
  return {
    provenance: engineInfo.verified && conf >= 0.8 ? 'parser' : 'heuristic',
    confidence: Number(conf.toFixed(4)),
    resolved: true
  };
}

function resolveEdgeProvenance(fileEngine, hasTarget, confidence = 0.5) {
  const numericConf = Number.isFinite(Number(confidence)) ? Number(confidence) : 0.5;
  if (!hasTarget) {
    return {
      provenance: 'unresolved',
      confidence: numericConf,
      resolved: false
    };
  }
  const engineInfo = classifyEngineProvenance(fileEngine);
  const isVerified = engineInfo.verified && numericConf >= 0.85;
  return {
    provenance: isVerified ? 'parser' : 'heuristic',
    confidence: Number(numericConf.toFixed(4)),
    resolved: true
  };
}

function buildSnapshotMetadata(rootRow, options = {}) {
  if (!rootRow) return null;
  const checkHead = options.checkHead !== false && Boolean(rootRow.root_path);
  const { resolveGitHeadSha } = checkHead ? require('./store') : { resolveGitHeadSha: () => '' };
  const currentHeadSha = checkHead ? resolveGitHeadSha(rootRow.root_path) : '';
  const storedSha = rootRow.head_sha || '';
  const staleHead = Boolean(currentHeadSha && storedSha && currentHeadSha !== storedSha);
  const ready = rootRow.status === 'fresh' || rootRow.status === 'ready';
  return {
    root_hash: rootRow.root_hash || '',
    head_sha: storedSha,
    ...(currentHeadSha ? { current_head_sha: currentHeadSha } : {}),
    indexed_at: rootRow.indexed_at || '',
    indexed_epoch_ms: Number(rootRow.indexed_epoch_ms || 0),
    status: rootRow.status || 'unknown',
    stale_head: staleHead,
    snapshot_consistent: ready && !staleHead
  };
}

function buildHitProvenance(row = {}) {
  const fp = buildFileProvenance(row);
  return {
    provenance: fp.provenance,
    parseEngine: fp.parseEngine,
    parserVersion: fp.parserVersion,
    contentHash: fp.contentHash,
    confidence: fp.confidence,
    verified: fp.verified
  };
}

function formatSyncHit(r, score, snippet) {
  return {
    relPath: r.rel_path,
    language: r.language,
    startLine: r.start_line,
    endLine: r.end_line,
    score,
    ...buildHitProvenance(r),
    snippet
  };
}

function formatAsyncHit(r, score, rerankScore, snippet) {
  return {
    relPath: r.relPath,
    language: r.language,
    startLine: r.startLine,
    endLine: r.endLine,
    symbolName: r.symbolName,
    score,
    rrfScore: r.rrfScore,
    rerankScore,
    vectorScore: r.vectorScore || 0,
    ...buildHitProvenance(r),
    snippet
  };
}

function assembleContextText(chunks, hasWindow, startLine, endLine) {
  if (!chunks || chunks.length === 0) {
    return { text: '', actualStart: 0, actualEnd: 0, outOfRange: Boolean(hasWindow), truncated: false };
  }
  const lineMap = new Map();
  for (const chunk of chunks) {
    const lines = String(chunk.body || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineNo = (Number(chunk.start_line) || 1) + i;
      if (!lineMap.has(lineNo)) lineMap.set(lineNo, lines[i]);
    }
  }
  const sortedNos = Array.from(lineMap.keys()).sort((a, b) => a - b);
  const chosen = hasWindow
    ? sortedNos.filter((n) => n >= startLine && n <= endLine)
    : sortedNos;
  if (chosen.length === 0) {
    return { text: '', actualStart: 0, actualEnd: 0, outOfRange: Boolean(hasWindow), truncated: false };
  }
  return {
    text: chosen.map((n) => lineMap.get(n)).join('\n'),
    actualStart: chosen[0],
    actualEnd: chosen[chosen.length - 1],
    outOfRange: false,
    truncated: false
  };
}

module.exports = {
  parseMetricsJson,
  classifyEngineProvenance,
  buildFileProvenance,
  resolveRefProvenance,
  resolveEdgeProvenance,
  buildSnapshotMetadata,
  buildHitProvenance,
  formatSyncHit,
  formatAsyncHit,
  assembleContextText
};
