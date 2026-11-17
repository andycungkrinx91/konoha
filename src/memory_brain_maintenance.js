'use strict';

/**
 * src/memory_brain_maintenance.js — Conservative, traceable, and reversible
 * background maintenance for Konoha's native knowledge brain.
 * Verified/confirmed facts are NEVER silently rewritten or deleted.
 */

const crypto = require('crypto');
const { getDb, initMemoryTables, computeProjectHash } = require('./persona_memory_projects');
const { recordAuditEvent, restoreMemoryFromAudit } = require('./memory_brain_lifecycle');

const NEGATION_RE = /\b(never|do not|don't|avoid|disable|forbidden|must not|cannot|can't)\b/i;
const AFFIRM_RE = /\b(always|must|enable|require|use|prefer)\b/i;
const STOPWORDS = new Set([
  'always', 'never', 'must', 'should', 'avoid', 'enable', 'disable', 'use', 'using',
  'with', 'from', 'that', 'this', 'only', 'for', 'and', 'the', 'into', 'when'
]);

function _extractSubjectTokens(text) {
  return Array.from(new Set(
    String(text || '').toLowerCase()
      .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  ));
}

function _parseJson(raw) {
  try { return JSON.parse(raw || '{}') || {}; } catch (_) { return {}; }
}

function _findDuplicateProposals(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.agent_name}::${r.project_hash || ''}::${r.session_id || ''}::${String(r.content || '').trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const proposals = [];
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    items.sort((a, b) => {
      const vA = a.verification_status === 'confirmed' ? 1 : 0;
      const vB = b.verification_status === 'confirmed' ? 1 : 0;
      if (vA !== vB) return vB - vA;
      return (Number(b.confidence || 0) - Number(a.confidence || 0)) || String(b.updated_at).localeCompare(String(a.updated_at));
    });
    const keeper = items[0];
    for (const dup of items.slice(1)) {
      if (dup.verification_status === 'confirmed') continue;
      proposals.push({ action: 'deduplicate', memory_id: dup.id, keeper_id: keeper.id, reason: `Duplicate unverified memory of ${keeper.id}` });
    }
  }
  return proposals;
}

function _evaluateStaleRow(r, { cutoffMs, nowIso, staleDays }) {
  if (r.valid_until && r.valid_until < nowIso) {
    if (r.verification_status === 'confirmed') {
      const meta = _parseJson(r.metadata_json);
      return meta.stale_review ? null : {
        action: 'flag_stale', memory_id: r.id, next_lifecycle: null,
        reason: 'valid_until elapsed on confirmed fact (flagged for human review only)'
      };
    }
    return { action: 'flag_stale', memory_id: r.id, next_lifecycle: 'archived', reason: 'valid_until elapsed on unverified memory' };
  }
  if (r.verification_status === 'confirmed') return null;
  const ts = Date.parse(r.last_verified_at || r.updated_at || r.created_at || '');
  if (!Number.isFinite(ts) || ts >= cutoffMs) return null;
  const meta = _parseJson(r.metadata_json);
  return meta.stale_review ? null : {
    action: 'flag_stale', memory_id: r.id, next_lifecycle: null,
    reason: `Unverified memory older than ${staleDays} days`
  };
}

function _findStaleProposals(rows, staleDays, nowMs) {
  const cutoffMs = nowMs - Math.max(1, staleDays) * 24 * 60 * 60 * 1000;
  const nowIso = new Date(nowMs).toISOString();
  const proposals = [];
  for (const r of rows) {
    const prop = _evaluateStaleRow(r, { cutoffMs, nowIso, staleDays });
    if (prop) proposals.push(prop);
  }
  return proposals;
}

function _findContradictionProposals(rows) {
  const proposals = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if ((a.project_hash || '') !== (b.project_hash || '')) continue;
      const negA = NEGATION_RE.test(a.content);
      const negB = NEGATION_RE.test(b.content);
      const affA = AFFIRM_RE.test(a.content);
      const affB = AFFIRM_RE.test(b.content);
      if (!((negA && affB && !negB) || (negB && affA && !negA))) continue;
      const tokA = new Set(_extractSubjectTokens(a.content));
      const overlap = _extractSubjectTokens(b.content).filter((t) => tokA.has(t));
      if (overlap.length >= 2) {
        proposals.push({
          action: 'detect_contradictions',
          source_id: a.id,
          target_id: b.id,
          evidence_ref: `matched tokens: ${overlap.slice(0, 5).join(', ')}`,
          reason: 'Opposite polarity directives sharing subject terms'
        });
      }
    }
  }
  return proposals;
}

function _findSalienceProposals(rows, staleDays, nowMs) {
  const cutoffMs = nowMs - Math.max(7, Math.floor(staleDays / 2)) * 24 * 60 * 60 * 1000;
  const proposals = [];
  for (const r of rows) {
    if (r.verification_status === 'confirmed' || Number(r.importance || 1) > 1) continue;
    const curSalience = Number(r.salience ?? 1.0);
    if (curSalience <= 0.35 || Number(r.access_count || 0) > 0) continue;
    const ts = Date.parse(r.updated_at || r.created_at || '');
    if (Number.isFinite(ts) && ts < cutoffMs) {
      proposals.push({
        action: 'decay_salience',
        memory_id: r.id,
        next_salience: Number(Math.max(0.25, curSalience * 0.7).toFixed(3)),
        reason: 'Low-importance unused memory salience decay'
      });
    }
  }
  return proposals;
}

function _applySingleProposal(conn, { proposal: p, rowById, actor, runId, now }) {
  if (p.action === 'deduplicate') {
    const dup = rowById.get(p.memory_id);
    if (!dup || dup.verification_status === 'confirmed') return null;
    conn.prepare("UPDATE persona_memories SET lifecycle_status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ?")
      .run(p.keeper_id, now, dup.id);
    const updated = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(dup.id);
    return recordAuditEvent(conn, {
      memoryId: dup.id, action: 'maintenance_deduplicate', actor, reason: `${p.reason} [run:${runId}]`,
      evidenceRef: runId, previousState: dup, newState: updated,
      projectHash: dup.project_hash || '', sessionId: dup.session_id || ''
    });
  }
  if (p.action === 'flag_stale') {
    const row = rowById.get(p.memory_id);
    if (!row) return null;
    const meta = { ..._parseJson(row.metadata_json), stale_review: true, stale_reason: p.reason, flagged_at: now };
    const nextLife = (p.next_lifecycle && row.verification_status !== 'confirmed') ? p.next_lifecycle : row.lifecycle_status;
    conn.prepare('UPDATE persona_memories SET lifecycle_status = ?, metadata_json = ?, updated_at = ? WHERE id = ?')
      .run(nextLife, JSON.stringify(meta), now, row.id);
    const updated = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(row.id);
    return recordAuditEvent(conn, {
      memoryId: row.id, action: 'maintenance_flag_stale', actor, reason: `${p.reason} [run:${runId}]`,
      evidenceRef: runId, previousState: row, newState: updated,
      projectHash: row.project_hash || '', sessionId: row.session_id || ''
    });
  }
  if (p.action === 'detect_contradictions') {
    const src = rowById.get(p.source_id);
    const relId = `rel_${crypto.randomBytes(8).toString('hex')}`;
    conn.prepare(`
      INSERT OR IGNORE INTO memory_relations (
        id, source_memory_id, target_memory_id, relation_type,
        evidence_ref, evidence_type, confidence, verified,
        project_hash, session_id, agent_name, created_by, status, created_at
      ) VALUES (?, ?, ?, 'contradicts', ?, 'contradiction_candidate', 0.6, 0, ?, ?, ?, ?, 'active', ?)
    `).run(relId, p.source_id, p.target_id, p.evidence_ref, src?.project_hash || '', src?.session_id || '', src?.agent_name || '', actor, now);
    return null;
  }
  if (p.action === 'decay_salience') {
    const row = rowById.get(p.memory_id);
    if (!row || row.verification_status === 'confirmed') return null;
    conn.prepare('UPDATE persona_memories SET salience = ?, updated_at = ? WHERE id = ?').run(p.next_salience, now, row.id);
    const updated = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(row.id);
    return recordAuditEvent(conn, {
      memoryId: row.id, action: 'maintenance_decay_salience', actor, reason: `${p.reason} [run:${runId}]`,
      evidenceRef: runId, previousState: row, newState: updated,
      projectHash: row.project_hash || '', sessionId: row.session_id || ''
    });
  }
  return null;
}

function runMemoryMaintenance({
  projectPath = null,
  projectHash = null,
  dryRun = true,
  actions = ['deduplicate', 'flag_stale', 'detect_contradictions', 'decay_salience'],
  staleDays = 90,
  actor = 'maintenance',
  dbPath = null
} = {}) {
  const pHash = projectHash || (projectPath ? computeProjectHash(projectPath) : '');
  const runId = `maint_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const actionSet = new Set(Array.isArray(actions) ? actions : []);
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const rows = pHash
      ? conn.prepare("SELECT * FROM persona_memories WHERE lifecycle_status = 'active' AND project_hash = ? ORDER BY created_at ASC").all(pHash)
      : conn.prepare("SELECT * FROM persona_memories WHERE lifecycle_status = 'active' ORDER BY created_at ASC").all();
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const proposed = [
      ...(actionSet.has('deduplicate') ? _findDuplicateProposals(rows) : []),
      ...(actionSet.has('flag_stale') ? _findStaleProposals(rows, staleDays, nowMs) : []),
      ...(actionSet.has('detect_contradictions') ? _findContradictionProposals(rows) : []),
      ...(actionSet.has('decay_salience') ? _findSalienceProposals(rows, staleDays, nowMs) : [])
    ];

    if (dryRun || proposed.length === 0) {
      return { run_id: runId, dry_run: true, project_hash: pHash || null, proposed, applied: 0, audit_event_ids: [] };
    }

    const auditEventIds = [];
    const tx = conn.transaction(() => {
      for (const p of proposed) {
        const auditId = _applySingleProposal(conn, { proposal: p, rowById, actor, runId, now: nowIso });
        if (auditId) auditEventIds.push(auditId);
      }
    });
    tx();
    return {
      run_id: runId,
      dry_run: false,
      project_hash: pHash || null,
      proposed,
      applied: auditEventIds.length,
      audit_event_ids: auditEventIds
    };
  } finally {
    conn.close();
  }
}

function _collectUnrevertedRunEventIds(runId, dbPath) {
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const rows = conn.prepare(
      "SELECT id FROM memory_audit_events WHERE evidence_ref = ? AND reverted_at = '' AND reversible = 1 ORDER BY created_at DESC, rowid DESC"
    ).all(String(runId).trim());
    return rows.map((r) => r.id);
  } finally {
    conn.close();
  }
}

function revertMaintenanceRun({ runId = null, auditEventIds = null, actor = 'maintenance_revert', dbPath = null } = {}) {
  const ids = Array.isArray(auditEventIds) ? [...auditEventIds] : [];
  if (runId) {
    for (const evId of _collectUnrevertedRunEventIds(runId, dbPath)) {
      if (!ids.includes(evId)) ids.push(evId);
    }
  }
  const reverted = [];
  for (const evId of ids.reverse()) {
    const res = restoreMemoryFromAudit(evId, { actor, reason: `Revert maintenance ${runId || evId}`, dbPath });
    reverted.push(res);
  }
  return { ok: true, reverted_count: reverted.length, reverted };
}

module.exports = {
  runMemoryMaintenance,
  revertMaintenanceRun
};
