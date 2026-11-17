'use strict';

/**
 * src/memory_brain_graph.js — Deterministic, evidence-backed knowledge graph
 * over native Konoha memories, with strict project/session isolation.
 */

const crypto = require('crypto');
const { getDb, initMemoryTables, computeProjectHash } = require('./persona_memory_projects');

const VALID_RELATION_TYPES = new Set([
  'supersedes',
  'supports',
  'contradicts',
  'derived_from',
  'depends_on',
  'relates_to',
  'part_of'
]);

const EXPLICIT_REF_RE = /\b(supersedes|supports|contradicts|derived_from|depends_on|relates_to|part_of):([a-zA-Z0-9_-]{4,36})\b/gi;

function _isVisibleInScope(row, { pHash, sessionId, agentName, includeInactive = false }) {
  if (!row) return false;
  if (!includeInactive && row.lifecycle_status && row.lifecycle_status !== 'active') return false;
  if (pHash) {
    const rp = row.project_hash || '';
    if (rp && rp !== pHash) return false;
  }
  if (agentName && !['all', 'global', '*'].includes(String(agentName).toLowerCase())) {
    const cleanAgent = String(agentName).toLowerCase().trim();
    if (row.agent_name && row.agent_name !== 'global' && row.agent_name !== cleanAgent) return false;
  }
  if (sessionId && sessionId !== 'all' && sessionId !== '*') {
    const rs = String(row.session_id || '').trim();
    const isEpisodic = row.memory_type === 'episodic' || row.domain === 'session' || row.domain === 'episodic';
    if (isEpisodic && rs && rs !== String(sessionId).trim()) return false;
  }
  return true;
}

function linkMemories({
  sourceId,
  targetId,
  relationType,
  evidenceRef = '',
  evidenceType = 'explicit',
  confidence = 1.0,
  verified = true,
  actor = 'system',
  dbPath = null
}) {
  if (!sourceId || !targetId) throw new Error('sourceId and targetId are required.');
  if (String(sourceId).trim() === String(targetId).trim()) {
    throw new Error('Cannot create a self-referential memory relation.');
  }
  const relType = String(relationType || '').toLowerCase().trim();
  if (!VALID_RELATION_TYPES.has(relType)) {
    throw new Error(`Unsupported relationType '${relationType}'. Allowed: ${Array.from(VALID_RELATION_TYPES).join(', ')}`);
  }
  const evType = String(evidenceType || 'explicit').trim();
  const isSpeculative = evType === 'inferred' || evType === 'heuristic' || evType === 'contradiction_candidate';
  const finalVerified = isSpeculative ? 0 : (verified ? 1 : 0);
  if (finalVerified === 1 && (!evidenceRef || !String(evidenceRef).trim())) {
    throw new Error('Verified knowledge relations require a non-empty evidenceRef.');
  }

  const conf = Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(1, Number(confidence))) : 1.0;
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const src = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(String(sourceId).trim());
    const dst = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(String(targetId).trim());
    if (!src) throw new Error(`Source memory not found: ${sourceId}`);
    if (!dst) throw new Error(`Target memory not found: ${targetId}`);
    if (src.project_hash && dst.project_hash && src.project_hash !== dst.project_hash) {
      throw new Error('Cannot link memories across isolated project boundaries.');
    }

    const id = `rel_${crypto.randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();
    const pHash = src.project_hash || dst.project_hash || '';
    const sessId = src.session_id || dst.session_id || '';
    conn.prepare(`
      INSERT OR REPLACE INTO memory_relations (
        id, source_memory_id, target_memory_id, relation_type,
        evidence_ref, evidence_type, confidence, verified,
        project_hash, session_id, agent_name, created_by, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      id, src.id, dst.id, relType,
      String(evidenceRef || '').slice(0, 500),
      evType, conf, finalVerified,
      pHash, sessId, src.agent_name || '', String(actor || 'system'), now
    );
    return {
      id,
      source_memory_id: src.id,
      target_memory_id: dst.id,
      relation_type: relType,
      evidence_ref: String(evidenceRef || ''),
      evidence_type: evType,
      verified: finalVerified === 1,
      confidence: conf
    };
  } finally {
    conn.close();
  }
}

function extractDeterministicRelations(conn, memoryRow) {
  if (!conn || !memoryRow || !memoryRow.id) return [];
  const created = [];
  const pHash = memoryRow.project_hash || '';
  const now = new Date().toISOString();
  const seenPairs = new Set();

  const addRel = ({ targetId, relType, evidenceRef, evidenceType, confidence, verified }) => {
    const key = `${targetId}:${relType}`;
    if (!targetId || targetId === memoryRow.id || seenPairs.has(key)) return;
    seenPairs.add(key);
    const id = `rel_${crypto.randomBytes(8).toString('hex')}`;
    conn.prepare(`
      INSERT OR IGNORE INTO memory_relations (
        id, source_memory_id, target_memory_id, relation_type,
        evidence_ref, evidence_type, confidence, verified,
        project_hash, session_id, agent_name, created_by, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deterministic_extractor', 'active', ?)
    `).run(
      id, memoryRow.id, targetId, relType,
      evidenceRef, evidenceType, confidence, verified ? 1 : 0,
      pHash, memoryRow.session_id || '', memoryRow.agent_name || '', now
    );
    created.push({ id, target_memory_id: targetId, relation_type: relType, evidence_ref: evidenceRef, verified: Boolean(verified) });
  };

  const textForRefs = `${memoryRow.content || ''}\n${memoryRow.source_ref || ''}`;
  let match;
  EXPLICIT_REF_RE.lastIndex = 0;
  while ((match = EXPLICIT_REF_RE.exec(textForRefs)) !== null) {
    const relType = match[1].toLowerCase();
    const targetId = match[2];
    const target = conn.prepare('SELECT id, project_hash FROM persona_memories WHERE id = ?').get(targetId);
    if (target && (!pHash || !target.project_hash || target.project_hash === pHash)) {
      addRel({ targetId: target.id, relType, evidenceRef: `explicit:${relType}:${target.id}`, evidenceType: 'explicit_ref', confidence: 0.95, verified: true });
    }
  }

  const srcRef = String(memoryRow.source_ref || '').trim();
  if (srcRef && srcRef.length >= 6) {
    const siblings = conn.prepare(`
      SELECT id, session_id, memory_type, domain FROM persona_memories
      WHERE source_ref = ? AND id != ? AND lifecycle_status = 'active'
        AND (project_hash IS ? OR project_hash = '' OR project_hash IS NULL)
      LIMIT 5
    `).all(srcRef, memoryRow.id, pHash || null);
    for (const sib of siblings) {
      const sameSession = !memoryRow.session_id || !sib.session_id || sib.session_id === memoryRow.session_id;
      if (sib.memory_type === 'episodic' && !sameSession) continue;
      addRel({ targetId: sib.id, relType: 'relates_to', evidenceRef: `shared_source_ref:${srcRef}`, evidenceType: 'shared_source_ref', confidence: 0.7, verified: false });
    }
  }

  return created;
}

function traverseKnowledgeGraph({
  memoryId,
  depth = 2,
  relationTypes = null,
  includeUnverified = true,
  includeInactive = false,
  projectPath = null,
  projectHash = null,
  sessionId = null,
  agentName = null,
  dbPath = null
}) {
  if (!memoryId) return { root_id: null, nodes: [], edges: [] };
  const pHash = projectHash || (projectPath ? computeProjectHash(projectPath) : '');
  const maxDepth = Math.min(Math.max(Number(depth) || 1, 1), 4);
  const relFilter = Array.isArray(relationTypes) && relationTypes.length > 0
    ? new Set(relationTypes.map((r) => String(r).toLowerCase()))
    : null;

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const rootId = String(memoryId).trim();
    const rootRow = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(rootId);
    if (!rootRow || !_isVisibleInScope(rootRow, { pHash, sessionId, agentName, includeInactive: true })) {
      return { root_id: rootId, nodes: [], edges: [] };
    }

    const nodeMap = new Map();
    const edgeMap = new Map();
    const queue = [{ id: rootRow.id, hop: 0 }];
    const visited = new Set([rootRow.id]);

    const sanitizeNode = (r, hop) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      domain: r.domain,
      memory_type: r.memory_type,
      agent_name: r.agent_name,
      source_type: r.source_type,
      source_ref: r.source_ref,
      verification_status: r.verification_status,
      lifecycle_status: r.lifecycle_status,
      confidence: r.confidence,
      hop
    });
    nodeMap.set(rootRow.id, sanitizeNode(rootRow, 0));

    while (queue.length > 0) {
      const current = queue.shift();
      if (current.hop >= maxDepth) continue;
      const rows = conn.prepare(`
        SELECT * FROM memory_relations
        WHERE status = 'active' AND (source_memory_id = ? OR target_memory_id = ?)
        ORDER BY verified DESC, confidence DESC, created_at ASC
      `).all(current.id, current.id);

      for (const edge of rows) {
        if (relFilter && !relFilter.has(edge.relation_type)) continue;
        if (!includeUnverified && !edge.verified) continue;
        const peerId = edge.source_memory_id === current.id ? edge.target_memory_id : edge.source_memory_id;
        const peerRow = conn.prepare('SELECT * FROM persona_memories WHERE id = ?').get(peerId);
        if (!_isVisibleInScope(peerRow, { pHash, sessionId, agentName, includeInactive })) continue;

        edgeMap.set(edge.id, {
          id: edge.id,
          source_memory_id: edge.source_memory_id,
          target_memory_id: edge.target_memory_id,
          relation_type: edge.relation_type,
          evidence_ref: edge.evidence_ref,
          evidence_type: edge.evidence_type,
          verified: Boolean(edge.verified),
          confidence: edge.confidence
        });
        if (!nodeMap.has(peerRow.id)) {
          nodeMap.set(peerRow.id, sanitizeNode(peerRow, current.hop + 1));
        }
        if (!visited.has(peerRow.id)) {
          visited.add(peerRow.id);
          queue.push({ id: peerRow.id, hop: current.hop + 1 });
        }
      }
    }

    return {
      root_id: rootRow.id,
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values())
    };
  } finally {
    conn.close();
  }
}

function explainRelation(edgeId, { dbPath = null } = {}) {
  if (!edgeId) return null;
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const edge = conn.prepare('SELECT * FROM memory_relations WHERE id = ?').get(String(edgeId).trim());
    if (!edge) return null;
    const source = conn.prepare('SELECT id, title, content, verification_status, lifecycle_status FROM persona_memories WHERE id = ?').get(edge.source_memory_id);
    const target = conn.prepare('SELECT id, title, content, verification_status, lifecycle_status FROM persona_memories WHERE id = ?').get(edge.target_memory_id);
    return {
      edge: {
        ...edge,
        verified: Boolean(edge.verified)
      },
      source: source || null,
      target: target || null,
      explanation: `${edge.source_memory_id} -[${edge.relation_type} (${edge.verified ? 'verified' : 'unverified'}, ${edge.evidence_type})]-> ${edge.target_memory_id} via evidence '${edge.evidence_ref || 'none'}'`
    };
  } finally {
    conn.close();
  }
}

module.exports = {
  VALID_RELATION_TYPES,
  linkMemories,
  extractDeterministicRelations,
  traverseKnowledgeGraph,
  explainRelation
};
