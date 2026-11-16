'use strict';

/**
 * src/memory_brain_lifecycle.js — Auditable memory lifecycle mutations
 * (correction, supersession, withdrawal/invalidation, verification, and restore).
 */

const crypto = require('crypto');
const path = require('path');
const { getDb, initMemoryTables } = require('./persona_memory_projects');

const VALID_DOMAINS = new Set(['persona', 'project', 'episodic', 'session', 'knowledge']);
const VALID_VERIFICATION_STATUSES = new Set(['confirmed', 'unverified', 'inferred', 'disputed']);
const VALID_LIFECYCLE_STATUSES = new Set(['active', 'superseded', 'withdrawn', 'invalidated', 'archived']);

function _parseAuditJson(raw, label = 'json') {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch (err) {
    throw new Error(`Invalid ${label} JSON in memory audit record: ${err.message}`);
  }
}

function _parseJsonObjOrEmpty(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  return JSON.parse(String(raw));
}

function recordAuditEvent(conn, {
  memoryId,
  action,
  actor = 'system',
  reason = '',
  evidenceRef = '',
  previousState = {},
  newState = {},
  projectHash = '',
  sessionId = '',
  reversible = 1
}) {
  const id = `aud_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();
  conn.prepare(`
    INSERT INTO memory_audit_events (
      id, memory_id, action, actor, reason, evidence_ref,
      previous_state, new_state, project_hash, session_id, reversible, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(memoryId || ''),
    String(action || 'updated'),
    String(actor || 'system'),
    String(reason || ''),
    String(evidenceRef || ''),
    typeof previousState === 'string' ? previousState : JSON.stringify(previousState || {}),
    typeof newState === 'string' ? newState : JSON.stringify(newState || {}),
    String(projectHash || ''),
    String(sessionId || ''),
    reversible ? 1 : 0,
    now
  );
  return id;
}

function _snapshotRow(row) {
  if (!row) return {};
  const snap = { ...row };
  delete snap.embedding;
  return snap;
}

function _insertSupersedesEdge(conn, { sourceId, targetId, evidenceRef, actor, existingRow }) {
  const relId = `rel_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();
  conn.prepare(`
    INSERT OR REPLACE INTO memory_relations (
      id, source_memory_id, target_memory_id, relation_type,
      evidence_ref, evidence_type, confidence, verified,
      project_hash, session_id, agent_name, created_by, status, created_at
    ) VALUES (?, ?, ?, 'supersedes', ?, 'supersession', 1.0, 1, ?, ?, ?, ?, 'active', ?)
  `).run(
    relId,
    sourceId,
    targetId,
    String(evidenceRef || 'correction'),
    String(existingRow.project_hash || ''),
    String(existingRow.session_id || ''),
    String(existingRow.agent_name || ''),
    String(actor || 'system'),
    now
  );
  return relId;
}

function correctMemory({
  id,
  newContent,
  title = null,
  tags = null,
  importance = null,
  reason = '',
  actor = 'system',
  evidenceRef = '',
  sourceType = null,
  sourceRef = null,
  verificationStatus = 'confirmed',
  confidence = 1.0,
  dbPath = null
}) {
  if (!id || !String(id).trim()) throw new Error('Memory id is required for correction.');
  if (!newContent || !String(newContent).trim()) throw new Error('newContent cannot be empty.');
  const safeContent = String(newContent).trim().slice(0, 1000);
  const vStatus = VALID_VERIFICATION_STATUSES.has(verificationStatus) ? verificationStatus : 'confirmed';
  const conf = Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(1, Number(confidence))) : 1.0;

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const tx = conn.transaction(() => {
      const oldRow = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(String(id).trim());
      if (!oldRow) throw new Error(`Memory not found: ${id}`);
      if (oldRow.lifecycle_status && oldRow.lifecycle_status !== 'active') {
        throw new Error(`Memory ${id} is already '${oldRow.lifecycle_status}' and cannot be corrected again.`);
      }

      const now = new Date().toISOString();
      const newId = crypto.randomUUID().slice(0, 8);
      const nextTitle = title !== null && title !== undefined
        ? String(title)
        : (oldRow.title || safeContent.split('\n')[0].slice(0, 60));
      const nextTags = tags !== null && tags !== undefined ? String(tags) : (oldRow.tags || '');
      const nextImp = importance !== null && importance !== undefined ? Number(importance) : Number(oldRow.importance || 1);
      const nextSourceType = sourceType || oldRow.source_type || 'agent';
      const nextSourceRef = sourceRef !== null && sourceRef !== undefined ? String(sourceRef) : (evidenceRef || oldRow.source_ref || '');

      conn.prepare(`
        INSERT INTO persona_memories (
          id, project_hash, session_id, agent_name, memory_type, title, content, tags, importance,
          domain, source_type, source_ref, creator_agent, confidence, verification_status,
          lifecycle_status, superseded_by, valid_from, valid_until, last_verified_at,
          access_count, salience, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, '', ?, 0, ?, ?, ?, ?)
      `).run(
        newId, oldRow.project_hash, oldRow.session_id || '', oldRow.agent_name, oldRow.memory_type,
        nextTitle, safeContent, nextTags, nextImp,
        oldRow.domain || 'persona', nextSourceType, nextSourceRef, String(actor || oldRow.creator_agent || oldRow.agent_name),
        conf, vStatus, now, now, Number(oldRow.salience || 1.0),
        JSON.stringify({ ..._parseJsonObjOrEmpty(oldRow.metadata_json), corrects: oldRow.id, correction_reason: reason || '' }),
        now, now
      );

      conn.prepare(`
        UPDATE persona_memories
        SET lifecycle_status = 'superseded', superseded_by = ?, valid_until = ?, updated_at = ?
        WHERE id = ?
      `).run(newId, now, now, oldRow.id);

      const newRow = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(newId);
      const oldUpdated = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(oldRow.id);
      const relationId = _insertSupersedesEdge(conn, { sourceId: newId, targetId: oldRow.id, evidenceRef: evidenceRef || reason || 'correction', actor, existingRow: oldRow });
      const supAuditId = recordAuditEvent(conn, {
        memoryId: oldRow.id,
        action: 'superseded',
        actor,
        reason: reason || `Superseded by ${newId}`,
        evidenceRef: evidenceRef || newId,
        previousState: _snapshotRow(oldRow),
        newState: _snapshotRow(oldUpdated),
        projectHash: oldRow.project_hash || '',
        sessionId: oldRow.session_id || ''
      });
      const createAuditId = recordAuditEvent(conn, {
        memoryId: newId,
        action: 'corrected',
        actor,
        reason: reason || `Corrects ${oldRow.id}`,
        evidenceRef: evidenceRef || oldRow.id,
        previousState: { supersedes: oldRow.id },
        newState: _snapshotRow(newRow),
        projectHash: oldRow.project_hash || '',
        sessionId: oldRow.session_id || ''
      });

      return {
        ok: true,
        old_id: oldRow.id,
        new_id: newId,
        superseded_by: newId,
        relation_id: relationId,
        audit_event_ids: [supAuditId, createAuditId]
      };
    });
    return tx();
  } finally {
    conn.close();
  }
}

function _executeSupersede(conn, { oldId, newId, reason, actor, evidenceRef }) {
  const oldRow = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(String(oldId).trim());
  const newRow = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(String(newId).trim());
  if (!oldRow) throw new Error(`Old memory not found: ${oldId}`);
  if (!newRow) throw new Error(`Replacement memory not found: ${newId}`);
  if ((oldRow.project_hash || '') !== (newRow.project_hash || '')) {
    throw new Error('Cannot supersede across isolated project boundaries.');
  }
  const now = new Date().toISOString();
  conn.prepare(`
    UPDATE persona_memories
    SET lifecycle_status = 'superseded', superseded_by = ?, valid_until = ?, updated_at = ?
    WHERE id = ?
  `).run(newRow.id, now, now, oldRow.id);

  const updatedOld = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(oldRow.id);
  const relationId = _insertSupersedesEdge(conn, {
    sourceId: newRow.id,
    targetId: oldRow.id,
    evidenceRef: evidenceRef || reason || 'supersedes',
    actor,
    existingRow: oldRow
  });
  const auditId = recordAuditEvent(conn, {
    memoryId: oldRow.id,
    action: 'superseded',
    actor,
    reason: reason || `Superseded by ${newRow.id}`,
    evidenceRef: evidenceRef || newRow.id,
    previousState: _snapshotRow(oldRow),
    newState: _snapshotRow(updatedOld),
    projectHash: oldRow.project_hash || '',
    sessionId: oldRow.session_id || ''
  });
  return { ok: true, old_id: oldRow.id, superseded_by: newRow.id, relation_id: relationId, audit_event_id: auditId };
}

function supersedeMemory({ oldId, newId = null, newContent = null, reason = '', actor = 'system', evidenceRef = '', dbPath = null }) {
  if (!oldId) throw new Error('oldId is required.');
  if (!newId && newContent) {
    return correctMemory({ id: oldId, newContent, reason, actor, evidenceRef, dbPath });
  }
  if (!newId) throw new Error('Either newId or newContent is required to supersede a memory.');
  if (String(oldId).trim() === String(newId).trim()) throw new Error('A memory cannot supersede itself.');

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const tx = conn.transaction(() => _executeSupersede(conn, { oldId, newId, reason, actor, evidenceRef }));
    return tx();
  } finally {
    conn.close();
  }
}

function withdrawMemory({ id, status = 'withdrawn', reason = '', actor = 'system', evidenceRef = '', dbPath = null }) {
  if (!id || !String(id).trim()) throw new Error('Memory id is required.');
  const targetStatus = ['withdrawn', 'invalidated', 'archived'].includes(status) ? status : 'withdrawn';
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const tx = conn.transaction(() => {
      const existing = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(String(id).trim());
      if (!existing) return { ok: false, found: false, id: String(id).trim() };
      const now = new Date().toISOString();
      conn.prepare(`
        UPDATE persona_memories
        SET lifecycle_status = ?, valid_until = ?, updated_at = ?
        WHERE id = ?
      `).run(targetStatus, now, now, existing.id);
      const updated = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(existing.id);
      const auditId = recordAuditEvent(conn, {
        memoryId: existing.id,
        action: targetStatus,
        actor,
        reason: reason || `Marked as ${targetStatus}`,
        evidenceRef,
        previousState: _snapshotRow(existing),
        newState: _snapshotRow(updated),
        projectHash: existing.project_hash || '',
        sessionId: existing.session_id || ''
      });
      return { ok: true, found: true, id: existing.id, lifecycle_status: targetStatus, audit_event_id: auditId };
    });
    return tx();
  } finally {
    conn.close();
  }
}

function verifyMemory({ id, verificationStatus = 'confirmed', actor = 'system', evidenceRef = '', confidence = 1.0, dbPath = null }) {
  if (!id) throw new Error('Memory id is required.');
  const nextVerif = VALID_VERIFICATION_STATUSES.has(verificationStatus) ? verificationStatus : 'confirmed';
  const nextConf = Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(1, Number(confidence))) : 1.0;
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const tx = conn.transaction(() => {
      const existing = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(String(id).trim());
      if (!existing) throw new Error(`Memory not found: ${id}`);
      const now = new Date().toISOString();
      conn.prepare(`
        UPDATE persona_memories
        SET verification_status = ?, confidence = ?, last_verified_at = ?,
            source_ref = CASE WHEN ? != '' THEN ? ELSE source_ref END, updated_at = ?
        WHERE id = ?
      `).run(nextVerif, nextConf, now, String(evidenceRef || ''), String(evidenceRef || ''), now, existing.id);
      const updated = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(existing.id);
      const auditId = recordAuditEvent(conn, {
        memoryId: existing.id,
        action: 'verified',
        actor,
        reason: `Verification status set to ${nextVerif}`,
        evidenceRef,
        previousState: _snapshotRow(existing),
        newState: _snapshotRow(updated),
        projectHash: existing.project_hash || '',
        sessionId: existing.session_id || ''
      });
      return { ok: true, id: existing.id, verification_status: nextVerif, confidence: nextConf, audit_event_id: auditId };
    });
    return tx();
  } finally {
    conn.close();
  }
}

function _applyRestoreSnapshot(conn, prev, now) {
  if (prev.project_hash) {
    conn.prepare(`
      INSERT OR IGNORE INTO projects (project_hash, project_path, project_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(prev.project_hash, prev.project_hash, path.basename(String(prev.project_hash)), now, now);
  }
  const existing = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(prev.id);
  if (existing) {
    conn.prepare(`
      UPDATE persona_memories
      SET content = ?, title = ?, tags = ?, importance = ?, domain = ?,
          source_type = ?, source_ref = ?, creator_agent = ?, confidence = ?,
          verification_status = ?, lifecycle_status = ?, superseded_by = ?,
          valid_until = ?, salience = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      prev.content, prev.title || '', prev.tags || '', prev.importance || 1,
      prev.domain || 'persona', prev.source_type || 'agent', prev.source_ref || '',
      prev.creator_agent || prev.agent_name || '', prev.confidence ?? 1.0,
      prev.verification_status || 'confirmed', prev.lifecycle_status || 'active',
      prev.superseded_by || null, prev.valid_until || '', prev.salience ?? 1.0,
      prev.metadata_json || '{}', now, prev.id
    );
    return existing;
  }
  conn.prepare(`
    INSERT INTO persona_memories (
      id, project_hash, session_id, agent_name, memory_type, title, content, tags, importance,
      domain, source_type, source_ref, creator_agent, confidence, verification_status,
      lifecycle_status, superseded_by, valid_from, valid_until, last_verified_at,
      access_count, salience, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    prev.id, prev.project_hash || null, prev.session_id || '', prev.agent_name || 'sannin',
    prev.memory_type || 'rule', prev.title || '', prev.content, prev.tags || '', prev.importance || 1,
    prev.domain || 'persona', prev.source_type || 'agent', prev.source_ref || '',
    prev.creator_agent || prev.agent_name || '', prev.confidence ?? 1.0,
    prev.verification_status || 'confirmed', prev.lifecycle_status || 'active',
    prev.superseded_by || null, prev.valid_from || prev.created_at || now, prev.valid_until || '',
    prev.last_verified_at || now, prev.access_count || 0, prev.salience ?? 1.0,
    prev.metadata_json || '{}', prev.created_at || now, now
  );
  return null;
}

function _executeRestoreAudit(conn, { eventId, actor, reason }) {
  const ev = conn.prepare('SELECT * FROM memory_audit_events WHERE id = ?').get(String(eventId).trim());
  if (!ev) throw new Error(`Audit event not found: ${eventId}`);
  if (!ev.reversible) throw new Error(`Audit event ${eventId} is not marked reversible.`);
  if (ev.reverted_at) throw new Error(`Audit event ${eventId} was already reverted at ${ev.reverted_at}.`);

  const prev = _parseAuditJson(ev.previous_state, 'previous_state');
  if (!prev || !prev.id || !prev.content) {
    throw new Error(`Audit event ${eventId} has no restorable previous_state snapshot.`);
  }
  const now = new Date().toISOString();
  const existing = _applyRestoreSnapshot(conn, prev, now);

  conn.prepare('UPDATE memory_audit_events SET reverted_at = ? WHERE id = ?').run(now, ev.id);
  const restoreAuditId = recordAuditEvent(conn, {
    memoryId: prev.id,
    action: 'restored',
    actor,
    reason: reason || `Reverted ${ev.id}`,
    evidenceRef: ev.id,
    previousState: _snapshotRow(existing),
    newState: prev,
    projectHash: prev.project_hash || '',
    sessionId: prev.session_id || ''
  });
  return { ok: true, memory_id: prev.id, restored_from_event: ev.id, audit_event_id: restoreAuditId };
}

function restoreMemoryFromAudit(eventId, { actor = 'system', reason = 'restored_from_audit', dbPath = null } = {}) {
  if (!eventId) throw new Error('eventId is required.');
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const tx = conn.transaction(() => _executeRestoreAudit(conn, { eventId, actor, reason }));
    return tx();
  } finally {
    conn.close();
  }
}

function getMemoryHistory(memoryId, { dbPath = null } = {}) {
  if (!memoryId) return { memory: null, audit_events: [], supersession_chain: [] };
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const id = String(memoryId).trim();
    const memory = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(id) || null;
    const events = conn.prepare(
      'SELECT * FROM memory_audit_events WHERE memory_id = ? ORDER BY created_at ASC, rowid ASC'
    ).all(id);

    const chain = [];
    const visited = new Set([id]);
    let cur = memory;
    while (cur && cur.superseded_by && !visited.has(cur.superseded_by) && chain.length < 20) {
      visited.add(cur.superseded_by);
      const next = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(cur.superseded_by);
      if (!next) break;
      chain.push({ id: next.id, title: next.title, lifecycle_status: next.lifecycle_status, updated_at: next.updated_at });
      cur = next;
    }

    return {
      memory: memory ? _snapshotRow(memory) : null,
      audit_events: events.map((e) => ({
        ...e,
        previous_state: _parseAuditJson(e.previous_state, 'previous_state') || {},
        new_state: _parseAuditJson(e.new_state, 'new_state') || {}
      })),
      supersession_chain: chain
    };
  } finally {
    conn.close();
  }
}

module.exports = {
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
};
