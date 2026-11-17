'use strict';

/**
 * src/memory_brain_export.js — Canonical Markdown/JSON export, validated restore/import,
 * index rebuild, and repeatable retrieval quality/latency benchmark helpers.
 */

const crypto = require('crypto');
const db = require('./db');
const { getDb, initMemoryTables, computeProjectHash } = require('./persona_memory_projects');
const { assertDurableKnowledgeSafe, formatKnowledgeRecord, recall } = require('./memory_brain');
const { recordAuditEvent } = require('./memory_brain_lifecycle');

function _escapeYaml(val) {
  return String(val ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
}

function exportMemoryBrain({
  format = 'markdown',
  projectPath = null,
  projectHash = null,
  includeInactive = false,
  dbPath = null
} = {}) {
  const pHash = projectHash || (projectPath ? computeProjectHash(projectPath) : null);
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    let memSql = 'SELECT * FROM persona_memories WHERE 1=1';
    const memParams = [];
    if (pHash) {
      memSql += ' AND project_hash = ?';
      memParams.push(pHash);
    }
    if (!includeInactive) {
      memSql += " AND lifecycle_status = 'active'";
    }
    memSql += ' ORDER BY created_at ASC, id ASC';
    const memories = conn.prepare(memSql).all(...memParams).map(formatKnowledgeRecord);

    const relSql = pHash
      ? 'SELECT * FROM memory_relations WHERE project_hash = ? ORDER BY created_at ASC'
      : 'SELECT * FROM memory_relations ORDER BY created_at ASC';
    const relations = (pHash ? conn.prepare(relSql).all(pHash) : conn.prepare(relSql).all())
      .map((r) => ({ ...r, verified: Boolean(r.verified) }));

    const auditSql = pHash
      ? 'SELECT id, memory_id, action, actor, reason, evidence_ref, reversible, reverted_at, created_at FROM memory_audit_events WHERE project_hash = ? ORDER BY created_at ASC LIMIT 200'
      : 'SELECT id, memory_id, action, actor, reason, evidence_ref, reversible, reverted_at, created_at FROM memory_audit_events ORDER BY created_at ASC LIMIT 200';
    const auditEvents = pHash ? conn.prepare(auditSql).all(pHash) : conn.prepare(auditSql).all();

    if (format === 'json') {
      return {
        schema_version: require('./db_schema').CURRENT_SCHEMA_VERSION,
        exported_at: new Date().toISOString(),
        project_hash: pHash || null,
        memories,
        relations,
        audit_events: auditEvents
      };
    }

    const lines = [
      '# Konoha Knowledge Brain Export',
      '',
      `- Exported At: ${new Date().toISOString()}`,
      `- Project Scope: ${pHash || 'all'}`,
      `- Memories: ${memories.length}`,
      `- Relations: ${relations.length}`,
      ''
    ];
    for (const m of memories) {
      lines.push('---');
      lines.push(`id: "${_escapeYaml(m.id)}"`);
      lines.push(`domain: "${_escapeYaml(m.domain)}"`);
      lines.push(`agent: "${_escapeYaml(m.agent_name)}"`);
      lines.push(`type: "${_escapeYaml(m.memory_type)}"`);
      lines.push(`title: "${_escapeYaml(m.title)}"`);
      lines.push(`project_hash: "${_escapeYaml(m.project_hash || '')}"`);
      lines.push(`session_id: "${_escapeYaml(m.session_id || '')}"`);
      lines.push(`source_type: "${_escapeYaml(m.source_type)}"`);
      lines.push(`source_ref: "${_escapeYaml(m.source_ref)}"`);
      lines.push(`creator_agent: "${_escapeYaml(m.creator_agent)}"`);
      lines.push(`confidence: ${Number(m.confidence ?? 1.0)}`);
      lines.push(`verification_status: "${_escapeYaml(m.verification_status)}"`);
      lines.push(`lifecycle_status: "${_escapeYaml(m.lifecycle_status)}"`);
      lines.push(`updated_at: "${_escapeYaml(m.updated_at)}"`);
      lines.push('---');
      lines.push(String(m.content || '').trim());
      lines.push('');
    }
    if (relations.length > 0) {
      lines.push('## Knowledge Relations', '');
      for (const rel of relations) {
        lines.push(`- ${rel.source_memory_id} --[${rel.relation_type}, verified=${rel.verified}]--> ${rel.target_memory_id} (evidence: ${rel.evidence_ref || 'none'})`);
      }
      lines.push('');
    }
    return lines.join('\n');
  } finally {
    conn.close();
  }
}

function _upsertImportedMemory(conn, { m, mode, actor, now }) {
  if (!m.content || !String(m.content).trim()) return false;
  const id = String(m.id || crypto.randomUUID().slice(0, 8));
  if (m.project_hash) {
    conn.prepare(`
      INSERT OR IGNORE INTO projects (project_hash, project_path, project_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(m.project_hash, m.project_hash, m.project_hash, now, now);
  }
  const exists = conn.prepare('SELECT id FROM persona_memories WHERE id = ?').get(id);
  if (exists && mode === 'merge') return false;

  conn.prepare(`
    INSERT OR REPLACE INTO persona_memories (
      id, project_hash, session_id, agent_name, memory_type, title, content, tags, importance,
      domain, source_type, source_ref, creator_agent, confidence, verification_status,
      lifecycle_status, superseded_by, valid_from, valid_until, last_verified_at,
      access_count, salience, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, m.project_hash || null, m.session_id || '', m.agent_name || 'sannin',
    m.memory_type || 'rule', m.title || '', String(m.content).slice(0, 1000), m.tags || '',
    Number(m.importance || 1), m.domain || 'persona', m.source_type || 'import',
    m.source_ref || '', m.creator_agent || actor, Number(m.confidence ?? 1.0),
    m.verification_status || 'confirmed', m.lifecycle_status || 'active',
    m.superseded_by || null, m.valid_from || m.created_at || now, m.valid_until || '',
    m.last_verified_at || now, Number(m.access_count || 0), Number(m.salience ?? 1.0),
    typeof m.metadata_json === 'string' ? m.metadata_json : JSON.stringify(m.metadata_json || {}),
    m.created_at || now, m.updated_at || now
  );
  recordAuditEvent(conn, {
    memoryId: id,
    action: 'imported',
    actor,
    reason: `Imported via ${mode} mode`,
    newState: { id, lifecycle_status: m.lifecycle_status || 'active' },
    projectHash: m.project_hash || '',
    sessionId: m.session_id || ''
  });
  return true;
}

function _insertImportedRelation(conn, rel, actor, now) {
  if (!rel.source_memory_id || !rel.target_memory_id || !rel.relation_type) return false;
  conn.prepare(`
    INSERT OR IGNORE INTO memory_relations (
      id, source_memory_id, target_memory_id, relation_type,
      evidence_ref, evidence_type, confidence, verified,
      project_hash, session_id, agent_name, created_by, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rel.id || `rel_${crypto.randomBytes(8).toString('hex')}`,
    rel.source_memory_id, rel.target_memory_id, rel.relation_type,
    rel.evidence_ref || '', rel.evidence_type || 'explicit', Number(rel.confidence ?? 1.0),
    rel.verified ? 1 : 0, rel.project_hash || '', rel.session_id || '',
    rel.agent_name || '', rel.created_by || actor, rel.status || 'active',
    rel.created_at || now
  );
  return true;
}

function _applyImportPayload(conn, { payload, mode, actor }) {
  const now = new Date().toISOString();
  let importedMemories = 0;
  let importedRelations = 0;
  for (const m of payload.memories) {
    if (_upsertImportedMemory(conn, { m, mode, actor, now })) importedMemories++;
  }
  for (const rel of (payload.relations || [])) {
    if (_insertImportedRelation(conn, rel, actor, now)) importedRelations++;
  }
  return { ok: true, imported_memories: importedMemories, imported_relations: importedRelations };
}

function importMemoryBrain(bundle, { mode = 'merge', actor = 'import', dbPath = null } = {}) {
  const payload = typeof bundle === 'string' ? JSON.parse(bundle) : bundle;
  if (!payload || !Array.isArray(payload.memories)) {
    throw new Error('Invalid memory brain bundle: memories array is required.');
  }
  for (const m of payload.memories) {
    assertDurableKnowledgeSafe({
      content: m.content,
      memoryType: m.memory_type,
      title: m.title,
      sourceRef: m.source_ref
    });
  }

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const tx = conn.transaction(() => _applyImportPayload(conn, { payload, mode, actor }));
    return tx();
  } finally {
    conn.close();
  }
}

function rebuildMemoryIndex({ dbPath = null } = {}) {
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const fts = db.rebuildAllFts(conn);
    const countRow = conn.prepare("SELECT COUNT(*) AS c FROM persona_memories WHERE lifecycle_status = 'active'").get();
    return {
      ok: true,
      fts,
      active_memories: countRow ? countRow.c : 0
    };
  } finally {
    conn.close();
  }
}

function benchmarkRetrieval(cases = [], { dbPath = null } = {}) {
  const list = Array.isArray(cases) ? cases : [];
  if (list.length === 0) return { count: 0, recall_at_k: 0, mrr: 0, stale_leaks: 0, avg_latency_ms: 0 };

  let hits = 0;
  let reciprocalSum = 0;
  let staleLeaks = 0;
  let totalMs = 0;

  for (const item of list) {
    const t0 = performance.now();
    const res = recall({
      query: item.query,
      agentName: item.agentName || 'all',
      projectPath: item.projectPath || null,
      projectHash: item.projectHash || null,
      sessionId: item.sessionId || null,
      allSessions: item.allSessions !== undefined ? item.allSessions : true,
      limit: item.k || 5,
      dbPath
    });
    totalMs += performance.now() - t0;

    if (res.some((r) => r.lifecycle_status !== 'active')) {
      staleLeaks++;
    }
    const idx = res.findIndex((r) => r.id === item.expectedId || (item.expectedSubstring && r.content.includes(item.expectedSubstring)));
    if (idx !== -1) {
      hits++;
      reciprocalSum += 1 / (idx + 1);
    }
  }

  return {
    count: list.length,
    recall_at_k: Number((hits / list.length).toFixed(4)),
    mrr: Number((reciprocalSum / list.length).toFixed(4)),
    stale_leaks: staleLeaks,
    avg_latency_ms: Number((totalMs / list.length).toFixed(3))
  };
}

module.exports = {
  exportMemoryBrain,
  importMemoryBrain,
  rebuildMemoryIndex,
  benchmarkRetrieval
};
