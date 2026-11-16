'use strict';

/**
 * src/memory_brain.js — Unified, provenance-aware Native Knowledge Brain API
 * over Konoha's canonical SQLite database (`konoha.db`).
 * Unifies persona, project, episodic, session, and knowledge domains.
 */

const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const vectorPipeline = require('./vector_pipeline');
const { classifySemanticStatus } = require('./code_intel/provenance');
const {
  getDb,
  initMemoryTables,
  computeProjectHash,
  saveOrUpdateProject
} = require('./persona_memory_projects');
const {
  VALID_DOMAINS,
  VALID_VERIFICATION_STATUSES,
  VALID_LIFECYCLE_STATUSES,
  recordAuditEvent,
  correctMemory,
  supersedeMemory,
  withdrawMemory,
  verifyMemory,
  restoreMemoryFromAudit,
  getMemoryHistory
} = require('./memory_brain_lifecycle');
const {
  linkMemories,
  extractDeterministicRelations,
  traverseKnowledgeGraph,
  explainRelation
} = require('./memory_brain_graph');
const {
  runMemoryMaintenance,
  revertMaintenanceRun
} = require('./memory_brain_maintenance');

const SECRET_BOUNDARY_RE = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[ps]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|konoha-web-token\s*=\s*[a-f0-9]{16,})/i;
const TRANSIENT_MEMORY_TYPES = new Set([
  'checkpoint', 'lg_checkpoint', 'lg_write', 'workflow_progress',
  'auth_token', 'credential', 'secret', 'session_token'
]);

function assertDurableKnowledgeSafe({ content, memoryType, title = '', sourceRef = '' } = {}) {
  const mType = String(memoryType || '').toLowerCase().trim();
  if (TRANSIENT_MEMORY_TYPES.has(mType)) {
    throw new Error(`MEMORY_BOUNDARY_VIOLATION: transient or credential type '${mType}' must not be stored in durable knowledge memory.`);
  }
  const combined = `${title || ''}\n${content || ''}\n${sourceRef || ''}`;
  if (SECRET_BOUNDARY_RE.test(combined)) {
    throw new Error('MEMORY_BOUNDARY_VIOLATION: credentials, private keys, or session tokens must not be stored in durable knowledge memory.');
  }
}

function _normalizeAgent(agentName) {
  let clean = String(agentName || '').toLowerCase().trim();
  if (clean.startsWith('mcp_')) clean = clean.slice(4);
  return clean;
}

function _inferDomain({ domain, memoryType, projectHash, sessionId }) {
  if (domain && VALID_DOMAINS.has(String(domain).toLowerCase().trim())) {
    return String(domain).toLowerCase().trim();
  }
  const mType = String(memoryType || 'rule').toLowerCase().trim();
  if (mType === 'knowledge') return 'knowledge';
  if (mType === 'episodic') return sessionId ? 'session' : 'episodic';
  if (projectHash) return 'project';
  return 'persona';
}

function _resolveSessionString(sessionId, projectPath) {
  if (sessionId || sessionId === '') return String(sessionId).trim();
  try {
    const { getActiveSessionId } = require('./mcp/client_detection');
    return String(getActiveSessionId(projectPath) || '').trim();
  } catch (_) {
    return '';
  }
}

function _resolveProjectAndSession({ projectPath, projectHash, sessionId, dbPath, autoRegisterProject = false }) {
  let pHash = '';
  if (projectHash) {
    pHash = String(projectHash).trim();
  } else if (projectPath) {
    pHash = computeProjectHash(projectPath) || '';
  }
  if (autoRegisterProject && pHash && !projectHash && projectPath) {
    try { saveOrUpdateProject(projectPath, '', null, dbPath); } catch (_) { /* best-effort */ }
  }
  return { pHash: pHash || null, sessId: _resolveSessionString(sessionId, projectPath) };
}

function _parseJsonObj(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)) || {}; } catch (_) { return {}; }
}

function formatKnowledgeRecord(row) {
  if (!row) return null;
  const verif = row.verification_status || 'confirmed';
  const life = row.lifecycle_status || 'active';
  const out = { ...row };
  delete out.embedding;
  out.is_verified = verif === 'confirmed';
  out.provenance = {
    domain: row.domain || 'persona',
    source_type: row.source_type || 'agent',
    source_ref: row.source_ref || '',
    creator_agent: row.creator_agent || row.agent_name || '',
    confidence: Number(row.confidence ?? 1.0),
    verification_status: verif,
    lifecycle_status: life,
    superseded_by: row.superseded_by || null,
    valid_from: row.valid_from || row.created_at || '',
    valid_until: row.valid_until || '',
    last_verified_at: row.last_verified_at || row.updated_at || ''
  };
  return out;
}

function _buildSessionWhereClause(options) {
  const { allSessions, explicitSession, pHash, strictSession, sessionId, prefix = '' } = options;
  const col = prefix ? `${prefix}.` : '';
  const projectBoundary = pHash
    ? ` AND ${col}project_hash = ?`
    : ` AND (${col}project_hash = '' OR ${col}project_hash IS NULL)`;
  const projectParams = pHash ? [pHash] : [];
  if (allSessions) {
    return pHash ? { clause: projectBoundary, params: projectParams } : { clause: '', params: [] };
  }
  const sid = String(sessionId || '').trim();
  if (explicitSession) {
    if (pHash && !strictSession) {
      return {
        clause: ` AND ((${col}session_id = ? AND (${col}project_hash = ? OR ${col}project_hash = '' OR ${col}project_hash IS NULL)) OR (${col}project_hash = ? AND ${col}memory_type != 'episodic'))`,
        params: [sid, pHash, pHash]
      };
    }
    return {
      clause: ` AND (${col}session_id = ? OR (${col}session_id = '' AND (${col}project_hash = '' OR ${col}project_hash IS NULL)))`,
      params: [sid]
    };
  }
  return {
    clause: ` AND (${col}memory_type != 'episodic' OR (${col}session_id = '' AND (${col}project_hash = '' OR ${col}project_hash IS NULL)))`,
    params: []
  };
}

function _persistMemoryInTx(conn, rec) {
  const now = new Date().toISOString();
  if (rec.pHash) {
    conn.prepare(`
      INSERT OR IGNORE INTO projects (project_hash, project_path, project_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(rec.pHash, rec.projectPath || rec.pHash, rec.projectPath ? path.basename(rec.projectPath) : rec.pHash, now, now);
  }

  const existing = conn.prepare(`
    SELECT * FROM persona_memories
    WHERE agent_name = ? AND content = ? AND project_hash IS ? AND session_id = ? AND lifecycle_status = 'active'
    LIMIT 1
  `).get(rec.cleanAgent, rec.safeContent, rec.pHash, rec.sessId);

  if (existing) {
    conn.prepare(`
      UPDATE persona_memories
      SET updated_at = ?, importance = MAX(importance, ?),
          title = CASE WHEN ? != '' THEN ? ELSE title END,
          access_count = COALESCE(access_count, 0) + 1,
          last_verified_at = CASE WHEN ? = 'confirmed' THEN ? ELSE last_verified_at END
      WHERE id = ?
    `).run(now, rec.importance, rec.finalTitle, rec.finalTitle, rec.verificationStatus, now, existing.id);
    const refreshed = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(existing.id);
    return { ...formatKnowledgeRecord(refreshed), created: false, relations_created: [] };
  }

  const memId = crypto.randomUUID().substring(0, 8);
  conn.prepare(`
    INSERT INTO persona_memories (
      id, project_hash, session_id, agent_name, memory_type, title, content, tags, importance,
      domain, source_type, source_ref, creator_agent, confidence, verification_status,
      lifecycle_status, superseded_by, valid_from, valid_until, last_verified_at,
      access_count, salience, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(
    memId, rec.pHash, rec.sessId, rec.cleanAgent, rec.memoryType, rec.finalTitle, rec.safeContent, rec.tags, rec.importance,
    rec.domain, rec.sourceType, rec.sourceRef, rec.creatorAgent, rec.confidence, rec.verificationStatus,
    rec.lifecycleStatus, rec.validFrom || now, rec.validUntil, rec.verificationStatus === 'confirmed' ? now : '',
    rec.salience, rec.metadataJson, now, now
  );

  const savedRow = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(memId);
  recordAuditEvent(conn, {
    memoryId: memId,
    action: 'created',
    actor: rec.creatorAgent,
    reason: rec.sourceRef ? `Recorded from ${rec.sourceType}: ${rec.sourceRef}` : `Recorded in domain ${rec.domain}`,
    evidenceRef: rec.sourceRef,
    previousState: {},
    newState: formatKnowledgeRecord(savedRow),
    projectHash: rec.pHash || '',
    sessionId: rec.sessId
  });
  const relationsCreated = extractDeterministicRelations(conn, savedRow);
  return { ...formatKnowledgeRecord(savedRow), created: true, relations_created: relationsCreated };
}

function remember(opts = {}) {
  const content = String(opts.content || '').trim();
  if (!content) throw new Error('Memory content cannot be empty.');
  const memoryType = String(opts.memoryType || opts.memory_type || (opts.category === 'stack' || opts.category === 'episodic' ? 'episodic' : 'rule')).trim();
  const titleArg = opts.title || '';
  const sourceRef = String(opts.sourceRef || opts.source_ref || '').trim();
  assertDurableKnowledgeSafe({ content, memoryType, title: titleArg, sourceRef });

  const safeContent = content.length > 1000 ? content.substring(0, 1000) : content;
  const cleanAgent = _normalizeAgent(opts.agentName || opts.agent_name || opts.persona);
  const dbPath = opts.dbPath || opts.db_path || null;
  const projectPath = opts.projectPath || opts.project_path || null;
  const { pHash, sessId } = _resolveProjectAndSession({
    projectPath,
    projectHash: opts.projectHash || opts.project_hash || null,
    sessionId: opts.sessionId !== undefined ? opts.sessionId : opts.session_id,
    dbPath,
    autoRegisterProject: true
  });

  const tags = String(opts.tags || (opts.category && opts.category !== 'episodic' ? opts.category : '')).trim();
  const importance = opts.importance !== undefined ? Number(opts.importance) : 1;
  const domain = _inferDomain({ domain: opts.domain, memoryType, projectHash: pHash, sessionId: sessId });
  const sourceType = String(opts.sourceType || opts.source_type || (opts.inferred ? 'inferred' : 'agent')).trim();
  const creatorAgent = String(opts.creatorAgent || opts.creator_agent || cleanAgent).trim();
  const inferredFlag = Boolean(opts.inferred || sourceType === 'inferred');
  const rawVerif = opts.verificationStatus || opts.verification_status || (inferredFlag ? 'inferred' : (opts.verified === false ? 'unverified' : 'confirmed'));
  const verificationStatus = VALID_VERIFICATION_STATUSES.has(rawVerif) ? rawVerif : 'confirmed';
  const rawLife = opts.lifecycleStatus || opts.lifecycle_status || 'active';
  const lifecycleStatus = VALID_LIFECYCLE_STATUSES.has(rawLife) ? rawLife : 'active';
  const confidence = opts.confidence !== undefined
    ? Math.max(0, Math.min(1, Number(opts.confidence)))
    : (verificationStatus === 'confirmed' ? 1.0 : 0.6);
  const salience = opts.salience !== undefined ? Number(opts.salience) : Math.max(1.0, Math.min(5.0, Number(importance || 1)));
  const validFrom = opts.validFrom || opts.valid_from || '';
  const validUntil = opts.validUntil || opts.valid_until || '';
  const metadataJson = JSON.stringify(_parseJsonObj(opts.metadata || opts.metadata_json));

  let finalTitle = String(titleArg || '').trim();
  if (!finalTitle) {
    const firstLine = safeContent.split('\n')[0].replace(/^[#*\-\s]+/, '').trim();
    finalTitle = firstLine ? firstLine.substring(0, 60) : `${cleanAgent} memory`;
  }

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const tx = conn.transaction(() => _persistMemoryInTx(conn, {
      pHash, projectPath, cleanAgent, safeContent, sessId, importance, finalTitle,
      verificationStatus, memoryType, tags, domain, sourceType, sourceRef, creatorAgent,
      confidence, lifecycleStatus, validFrom, validUntil, salience, metadataJson
    }));
    return tx();
  } finally {
    conn.close();
  }
}

function _buildCommonFilterSql(opts, prefix, nowIso) {
  const col = prefix ? `${prefix}.` : '';
  const clauses = [];
  const params = [];

  if (!opts.includeInactive) {
    const life = opts.lifecycleStatus || opts.lifecycle_status || 'active';
    clauses.push(` AND ${col}lifecycle_status = ?`);
    params.push(String(life));
  }
  if (!opts.includeExpired && !opts.includeInactive) {
    clauses.push(` AND (${col}valid_until = '' OR ${col}valid_until IS NULL OR ${col}valid_until >= ?)`);
    params.push(nowIso);
  }
  if (opts.memoryType || opts.memory_type) {
    clauses.push(` AND ${col}memory_type = ?`);
    params.push(String(opts.memoryType || opts.memory_type).trim());
  }
  if (opts.domain) {
    clauses.push(` AND ${col}domain = ?`);
    params.push(String(opts.domain).trim().toLowerCase());
  }
  if (opts.confirmedOnly) {
    clauses.push(` AND ${col}verification_status = 'confirmed'`);
  } else if (opts.excludeInferred) {
    clauses.push(` AND ${col}verification_status != 'inferred'`);
  } else if (opts.verificationStatus || opts.verification_status) {
    clauses.push(` AND ${col}verification_status = ?`);
    params.push(String(opts.verificationStatus || opts.verification_status).trim());
  }
  if (opts.sourceType || opts.source_type) {
    clauses.push(` AND ${col}source_type = ?`);
    params.push(String(opts.sourceType || opts.source_type).trim());
  }
  if (opts.minConfidence !== undefined && Number.isFinite(Number(opts.minConfidence))) {
    clauses.push(` AND ${col}confidence >= ?`);
    params.push(Number(opts.minConfidence));
  }
  if (opts.since) {
    clauses.push(` AND ${col}updated_at >= ?`);
    params.push(String(opts.since));
  }
  return { sql: clauses.join(''), params };
}

function _scoreCandidate(row, { activeSessId, pHash, ftsTier = 0, bm25 = 0, nowMs }) {
  const scopeWeight = (activeSessId && row.session_id === activeSessId)
    ? 4.0
    : (pHash && row.project_hash === pHash ? 2.5 : 1.0);
  const verifWeight = row.verification_status === 'confirmed'
    ? 1.5
    : (row.verification_status === 'unverified' ? 0.6 : (row.verification_status === 'inferred' ? 0.3 : 0.1));
  const confWeight = Number(row.confidence ?? 1.0);
  const salWeight = Math.min(3.0, Number(row.salience ?? 1.0)) * 0.4 + Number(row.importance || 1) * 0.35;
  const updatedMs = Date.parse(row.updated_at || row.created_at || '');
  const ageDays = Number.isFinite(updatedMs) ? Math.max(0, (nowMs - updatedMs) / (24 * 60 * 60 * 1000)) : 30;
  const recencyWeight = 1 / (1 + ageDays / 30);
  const bm25Bonus = bm25 < 0 ? Math.min(3.0, -bm25 * 0.25) : 0;
  return ftsTier + bm25Bonus + scopeWeight + verifWeight + confWeight + salWeight + recencyWeight;
}

function _runFtsQueryPass(conn, { ftsExpr, baseWhere, filterSql, params, limit }) {
  const sql = `
    SELECT m.*, bm25(persona_memories_fts) AS fts_bm25
    FROM persona_memories m
    JOIN persona_memories_fts f ON m.id = f.id
    WHERE ${baseWhere} AND persona_memories_fts MATCH ? ${filterSql}
    ORDER BY bm25(persona_memories_fts) ASC, m.importance DESC, m.updated_at DESC
    LIMIT ?
  `;
  return conn.prepare(sql).all(ftsExpr, ...params, limit);
}

function _runFtsPasses(conn, queryOpts) {
  const { query, agentClause, tailSql, tailParams, activeSessId, pHash, nowMs, limit } = queryOpts;
  if (!query) return null;
  if (db.hasFts5Support && !db.hasFts5Support(conn)) return null;
  const cleanQ = query.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  const tokens = cleanQ.split(/\s+/).filter((t) => t.length > 1 && !['and', 'or', 'not'].includes(t.toLowerCase()));
  if (!tokens.length) return null;

  try {
    const candidateCap = Math.max(limit * 4, 20);
    const merged = new Map();
    const passes = tokens.length >= 2
      ? [
          [`"${tokens.join(' ')}"`, 6.0],
          [tokens.map((t) => `"${t}"`).join(' AND '), 3.5],
          [tokens.map((t) => `"${t}"`).join(' OR '), 1.0]
        ]
      : [[tokens.map((t) => `"${t}"`).join(' OR '), 1.0]];

    for (const [ftsExpr, tier] of passes) {
      for (const row of _runFtsQueryPass(conn, { ftsExpr, baseWhere: agentClause, filterSql: tailSql, params: tailParams, limit: candidateCap })) {
        const score = _scoreCandidate(row, { activeSessId, pHash, ftsTier: tier, bm25: Number(row.fts_bm25 || 0), nowMs });
        const prev = merged.get(row.id);
        if (!prev || score > prev.score) merged.set(row.id, { row, score });
      }
    }
    if (merged.size === 0) return null;
    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row, score }) => ({ ...formatKnowledgeRecord(row), score: Number(score.toFixed(4)) }));
  } catch (err) {
    if (err && String(err.message).toLowerCase().includes('fts5')) {
      try { db.rebuildAllFts(conn); } catch (_) { /* ignore */ }
    }
    return null;
  }
}

function recall(opts = {}) {
  const cleanAgent = _normalizeAgent(opts.agentName || opts.agent_name || opts.persona);
  const rawAgent = String(opts.agentName || opts.agent_name || opts.persona || '').toLowerCase().trim();
  const isAll = (!rawAgent || rawAgent === 'all' || rawAgent === 'global');
  const query = String(opts.query || '').trim();
  const limit = Math.min(Math.max(parseInt(opts.limit ?? 5, 10) || 5, 1), 100);
  const dbPath = opts.dbPath || opts.db_path || null;
  const projectPath = opts.projectPath || opts.project_path || null;
  const sessionId = opts.sessionId ?? opts.session_id ?? null;
  const allSessions = Boolean(opts.allSessions || opts.all_sessions || opts.crossSession || opts.cross_session || sessionId === 'all' || sessionId === '*');
  const strictSession = Boolean(opts.strictSession || opts.strict_session);
  const explicitSession = Boolean(sessionId && sessionId !== 'all' && sessionId !== '*');

  const { pHash, sessId: activeSessId } = _resolveProjectAndSession({
    projectPath,
    projectHash: opts.projectHash || opts.project_hash || null,
    sessionId,
    dbPath,
    autoRegisterProject: false
  });

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const agentClause = isAll ? '1=1' : "(m.agent_name = ? OR m.agent_name = 'global')";
    const agentParams = isAll ? [] : [cleanAgent];
    const projClause = pHash ? " AND (m.project_hash = ? OR m.project_hash = '' OR m.project_hash IS NULL)" : '';
    const projParams = pHash ? [pHash] : [];
    const sessFilter = _buildSessionWhereClause({ allSessions, explicitSession, pHash, strictSession, sessionId, prefix: 'm' });
    const common = _buildCommonFilterSql(opts, 'm', nowIso);
    const tailSql = `${projClause}${sessFilter.clause}${common.sql}`;
    const tailParams = [...agentParams, ...projParams, ...sessFilter.params, ...common.params];

    const ftsRanked = _runFtsPasses(conn, { query, agentClause, tailSql, tailParams, activeSessId, pHash, nowMs, limit });
    if (ftsRanked) return ftsRanked;

    const fallbackRows = conn.prepare(`
      SELECT m.* FROM persona_memories m
      WHERE ${agentClause}${tailSql}
      ORDER BY (CASE WHEN m.session_id = ? THEN 3 WHEN m.project_hash = ? THEN 2 ELSE 1 END) DESC,
               (CASE WHEN m.verification_status = 'confirmed' THEN 1 ELSE 0 END) DESC,
               m.importance DESC, m.salience DESC, m.updated_at DESC
      LIMIT ?
    `).all(...tailParams, activeSessId || '', pHash || '', limit);

    return fallbackRows.map((row) => ({
      ...formatKnowledgeRecord(row),
      score: Number(_scoreCandidate(row, { activeSessId, pHash, ftsTier: 0, bm25: 0, nowMs }).toFixed(4))
    }));
  } finally {
    conn.close();
  }
}

function _cosineSimilarity(queryVec, blob) {
  if (!queryVec || !blob || blob.length !== queryVec.byteLength) return 0;
  const target = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < queryVec.length; i++) {
    const a = queryVec[i];
    const b = target[i];
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function _semanticFallbackPayload(lexical, baseStatus) {
  return {
    memories: lexical,
    total: lexical.length,
    semantic_status: baseStatus.semanticStatus,
    semantic_applied: false,
    reranked: false,
    degraded: baseStatus.semanticDegraded,
    semantic_reason: baseStatus.reason
  };
}

async function _fuseVectorScores(dbPath, queryStr, lexical, scoreById) {
  const conn = getDb(dbPath);
  try {
    const qVec = await vectorPipeline.embedText(queryStr);
    if (!qVec) return false;
    const placeholders = lexical.map(() => '?').join(',');
    const embRows = conn.prepare(`SELECT id, embedding FROM persona_memories WHERE id IN (${placeholders}) AND embedding IS NOT NULL`)
      .all(...lexical.map((m) => m.id));
    if (embRows.length === 0) return false;
    embRows
      .map((r) => ({ id: r.id, sim: _cosineSimilarity(qVec, r.embedding) }))
      .sort((a, b) => b.sim - a.sim)
      .forEach((v, idx) => {
        scoreById.set(v.id, (scoreById.get(v.id) || 0) + 1 / (60 + idx + 1));
      });
    return true;
  } finally {
    conn.close();
  }
}

async function _fuseRerankScores(queryStr, lexical, scoreById) {
  const docs = lexical.map((m) => `${m.title || ''}\n${m.content || ''}`);
  const rerankedDocs = await vectorPipeline.rerank(queryStr, docs, lexical.length);
  if (!Array.isArray(rerankedDocs) || rerankedDocs.length === 0) return false;
  rerankedDocs.forEach((item, rankIdx) => {
    const mem = lexical[item.index];
    if (mem) scoreById.set(mem.id, (scoreById.get(mem.id) || 0) + 1 / (60 + rankIdx + 1));
  });
  return Boolean(rerankedDocs.some((r) => r && r.reranked));
}

async function recallAsync(opts = {}) {
  const lexical = recall(opts);
  const enabled = vectorPipeline.isSemanticSearchEnabled();
  const runtime = vectorPipeline.getRuntimeStatus();
  const baseStatus = classifySemanticStatus({ enabled, runtime });

  if (!opts.query || !String(opts.query).trim() || lexical.length === 0 || baseStatus.semanticStatus !== 'available') {
    return _semanticFallbackPayload(lexical, baseStatus);
  }

  try {
    const queryStr = String(opts.query).trim();
    const scoreById = new Map(lexical.map((m, idx) => [m.id, 1 / (60 + idx + 1)]));
    const semanticApplied = await _fuseVectorScores(opts.dbPath || opts.db_path || null, queryStr, lexical, scoreById);
    const reranked = await _fuseRerankScores(queryStr, lexical, scoreById);
    const fused = [...lexical].sort((a, b) => (scoreById.get(b.id) || 0) - (scoreById.get(a.id) || 0));
    return {
      memories: fused,
      total: fused.length,
      semantic_status: 'available',
      semantic_applied: semanticApplied,
      reranked,
      degraded: false,
      semantic_reason: null
    };
  } catch (err) {
    return _semanticFallbackPayload(lexical, {
      semanticStatus: 'degraded',
      semanticDegraded: true,
      reason: err.message
    });
  }
}

function listKnowledge(opts = {}) {
  const limit = Math.min(Math.max(parseInt(opts.limit ?? 50, 10) || 50, 1), 200);
  const dbPath = opts.dbPath || opts.db_path || null;
  const projectPath = opts.projectPath || opts.project_path || null;
  let allSessions = Boolean(opts.allSessions || opts.all_sessions || opts.crossSession || opts.cross_session);
  const sessionId = opts.sessionId ?? opts.session_id ?? null;
  if (sessionId === 'all' || sessionId === '*') allSessions = true;
  const explicitSession = Boolean(sessionId && sessionId !== 'all' && sessionId !== '*');
  const rawAgent = String(opts.agentName || opts.agent_name || opts.persona || '').toLowerCase().trim();
  const isAll = (!rawAgent || rawAgent === 'all' || rawAgent === 'global');

  const { pHash, sessId: activeSessId } = _resolveProjectAndSession({
    projectPath,
    projectHash: opts.projectHash || opts.project_hash || null,
    sessionId,
    dbPath,
    autoRegisterProject: false
  });

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const nowIso = new Date().toISOString();
    const params = [];
    let sql = 'SELECT * FROM persona_memories WHERE 1=1';
    if (!isAll) {
      sql += " AND (agent_name = ? OR agent_name = 'global')";
      params.push(_normalizeAgent(rawAgent));
    }
    if (pHash) {
      sql += " AND (project_hash = ? OR project_hash = '' OR project_hash IS NULL)";
      params.push(pHash);
    }
    const sessClause = _buildSessionWhereClause({ allSessions, explicitSession, pHash, strictSession: Boolean(opts.strictSession), sessionId });
    sql += sessClause.clause;
    params.push(...sessClause.params);
    const common = _buildCommonFilterSql(opts, '', nowIso);
    sql += common.sql;
    params.push(...common.params);
    sql += ' ORDER BY (CASE WHEN session_id = ? THEN 3 WHEN project_hash = ? THEN 2 ELSE 1 END) DESC, agent_name ASC, importance DESC, updated_at DESC LIMIT ?';
    params.push(activeSessId || '', pHash || '', limit);

    return conn.prepare(sql).all(...params).map(formatKnowledgeRecord);
  } finally {
    conn.close();
  }
}

function deleteKnowledge(memoryId, { actor = 'user', reason = 'deleted', dbPath = null } = {}) {
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const strId = String(memoryId != null ? memoryId : '').trim();
    if (!strId) return false;
    const tx = conn.transaction(() => {
      const numId = /^\d+$/.test(strId) ? parseInt(strId, 10) : null;
      const existing = numId !== null
        ? conn.prepare('SELECT * FROM persona_memories WHERE id = ? OR id = ?').get(strId, numId)
        : conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(strId);
      if (!existing) return false;
      recordAuditEvent(conn, {
        memoryId: existing.id,
        action: 'deleted',
        actor,
        reason,
        previousState: formatKnowledgeRecord(existing),
        newState: {},
        projectHash: existing.project_hash || '',
        sessionId: existing.session_id || ''
      });
      const res = conn.prepare('DELETE FROM persona_memories WHERE id = ?').run(existing.id);
      return res.changes > 0;
    });
    return tx();
  } finally {
    conn.close();
  }
}

module.exports = {
  VALID_DOMAINS,
  VALID_VERIFICATION_STATUSES,
  VALID_LIFECYCLE_STATUSES,
  assertDurableKnowledgeSafe,
  formatKnowledgeRecord,
  remember,
  saveKnowledge: remember,
  recall,
  recallAsync,
  listKnowledge,
  deleteKnowledge,
  correctMemory,
  supersedeMemory,
  withdrawMemory,
  verifyMemory,
  restoreMemoryFromAudit,
  getMemoryHistory,
  linkMemories,
  extractDeterministicRelations,
  traverseKnowledgeGraph,
  explainRelation,
  runMemoryMaintenance,
  revertMaintenanceRun
};
