'use strict';

const crypto = require('crypto');
const {
  DB_PATH,
  getDb,
  initMemoryTables,
  computeProjectHash
} = require('./persona_memory_projects');

function _getBrain() {
  return require('./memory_brain');
}

function saveMemory(
  agentName,
  content,
  title = "",
  memoryType = "rule",
  tags = "",
  importance = 1,
  projectPath = null,
  projectHash = null,
  sessionId = null,
  dbPath = DB_PATH
) {
  const opts = (typeof agentName === 'object' && agentName !== null)
    ? agentName
    : { agentName, content, title, memoryType, tags, importance, projectPath, projectHash, sessionId, dbPath };
  return _getBrain().remember(opts).id;
}

function memoryContentExists(content, agentName = null, projectPath = null, projectHash = null, dbPath = DB_PATH) {
  if (typeof content === 'object' && content !== null) {
    const opts = content;
    agentName = opts.agentName || opts.agent_name || null;
    projectPath = opts.projectPath || opts.project_path || null;
    projectHash = opts.projectHash || opts.project_hash || null;
    dbPath = opts.dbPath || opts.db_path || DB_PATH;
    content = opts.content;
  }
  const c = (content || "").trim();
  if (!c) return false;

  let cleanAgent = (agentName || "").toLowerCase().trim();
  if (cleanAgent.startsWith("mcp_")) {
    cleanAgent = cleanAgent.substring(4);
  }

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    if (cleanAgent) {
      const row = conn.prepare("SELECT 1 FROM persona_memories WHERE agent_name = ? AND content = ? AND lifecycle_status = 'active' LIMIT 1").get(cleanAgent, c);
      return Boolean(row);
    } else {
      const row = conn.prepare("SELECT 1 FROM persona_memories WHERE content = ? AND lifecycle_status = 'active' LIMIT 1").get(c);
      return Boolean(row);
    }
  } finally {
    conn.close();
  }
}

function appendSessionFilter(options) {
  const { allSessions, explicitSession, pHash, strictSession, sessionId, prefix = '' } = options;
  const col = prefix ? `${prefix}.` : '';
  const projectBoundary = pHash
    ? ` AND ${col}project_hash = ?`
    : ` AND (${col}project_hash = '' OR ${col}project_hash IS NULL)`;
  const projectParams = pHash ? [pHash] : [];
  // allSessions without a project scope means "everything", matching
  // listMemories; applying the unscoped-project boundary here would hide every
  // project-bound row instead.
  if (allSessions) {
    return pHash
      ? { clause: projectBoundary, params: projectParams }
      : { clause: '', params: [] };
  }
  const sid = String(sessionId).trim();
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

function queryMemories(
  agentName = null,
  query = "",
  memoryType = null,
  projectPath = null,
  projectHash = null,
  sessionId = null,
  limit = 5,
  dbPath = DB_PATH
) {
  const opts = (typeof agentName === 'object' && agentName !== null)
    ? agentName
    : { agentName, query, memoryType, projectPath, projectHash, sessionId, limit, dbPath };
  return _getBrain().recall(opts);
}

function listMemories(
  agentName = null,
  memoryType = null,
  projectPath = null,
  projectHash = null,
  sessionId = null,
  limit = 50,
  dbPath = DB_PATH
) {
  const opts = (typeof agentName === 'object' && agentName !== null)
    ? agentName
    : { agentName, memoryType, projectPath, projectHash, sessionId, limit, dbPath };
  return _getBrain().listKnowledge(opts);
}

function deleteMemory(memoryId, dbPath = null) {
  return _getBrain().deleteKnowledge(memoryId, { dbPath });
}

function _buildPruneProjectQuery(pHash, options) {
  let sql = "DELETE FROM persona_memories WHERE project_hash = ?";
  const params = [pHash];
  if (options.olderThanDays && Number(options.olderThanDays) > 0) {
    sql += " AND created_at < datetime('now', '-' || ? || ' days')";
    params.push(Math.floor(Number(options.olderThanDays)));
  }
  if (options.minImportance && Number(options.minImportance) > 0) {
    sql += " AND importance <= ?";
    params.push(Math.floor(Number(options.minImportance)));
  }
  if (options.memoryType) {
    sql += " AND memory_type = ?";
    params.push(String(options.memoryType).trim().toLowerCase());
  }
  return { sql, params };
}

function _executePruneProjectTx(conn, sql, params, pHash, options) {
  const tx = conn.transaction(() => {
    const res = conn.prepare(sql).run(...params);
    let invariantsCleared = false;
    if (options.clearInvariants || options.all) {
      conn.prepare("UPDATE projects SET context_summary = '' WHERE project_hash = ?").run(pHash);
      invariantsCleared = true;
    }
    return { deleted: res.changes, project_hash: pHash, invariants_cleared: invariantsCleared };
  });
  return tx();
}

function pruneProjectMemories(projectPathOrHash, options = {}, dbPath = null) {
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    let pHash = "";
    if (projectPathOrHash) {
      const trimmed = String(projectPathOrHash).trim();
      pHash = (trimmed.length === 12 && /^[a-f0-9]+$/i.test(trimmed))
        ? trimmed.toLowerCase()
        : computeProjectHash(trimmed);
    }
    if (!pHash) return { deleted: 0, project_hash: "" };

    const { sql, params } = _buildPruneProjectQuery(pHash, options);
    return _executePruneProjectTx(conn, sql, params, pHash, options);
  } finally {
    conn.close();
  }
}

function _resolvePruneProjectHash(options) {
  if (options.projectHash) return options.projectHash;
  if (options.projectPath) return computeProjectHash(options.projectPath);
  return null;
}

function _buildPruneMemoriesQuery(options) {
  let sql = "DELETE FROM persona_memories WHERE 1=1";
  const params = [];

  const pHash = _resolvePruneProjectHash(options);
  if (pHash) {
    sql += " AND project_hash = ?";
    params.push(pHash);
  }
  if (options.agentName) {
    let clean = String(options.agentName).toLowerCase().trim();
    if (clean.startsWith("mcp_")) clean = clean.substring(4);
    sql += " AND agent_name = ?";
    params.push(clean);
  }
  if (options.olderThanDays && Number(options.olderThanDays) > 0) {
    sql += " AND created_at < datetime('now', '-' || ? || ' days')";
    params.push(Math.floor(Number(options.olderThanDays)));
  }
  if (options.minImportance && Number(options.minImportance) > 0) {
    sql += " AND importance <= ?";
    params.push(Math.floor(Number(options.minImportance)));
  }
  if (options.memoryType) {
    sql += " AND memory_type = ?";
    params.push(String(options.memoryType).trim().toLowerCase());
  }
  return { sql, params };
}

function pruneMemories(options = {}, dbPath = DB_PATH) {
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const { sql, params } = _buildPruneMemoriesQuery(options);
    const res = conn.prepare(sql).run(...params);
    return { deleted: res.changes };
  } finally {
    conn.close();
  }
}

function countMemories(agentName = null, projectPath = null, projectHash = null, dbPath = DB_PATH) {
  if (typeof agentName === 'object' && agentName !== null) {
    const opts = agentName;
    projectPath = opts.projectPath || opts.project_path || null;
    projectHash = opts.projectHash || opts.project_hash || null;
    dbPath = opts.dbPath || opts.db_path || DB_PATH;
    agentName = opts.agentName || opts.agent_name || null;
  }

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    let sql = "SELECT COUNT(*) as cnt FROM persona_memories WHERE lifecycle_status = 'active'";
    const params = [];

    if (agentName) {
      let clean = agentName.toLowerCase().trim();
      if (clean.startsWith("mcp_")) clean = clean.substring(4);
      sql += " AND (agent_name = ? OR agent_name = 'global')";
      params.push(clean);
    }

    let pHash = "";
    if (projectHash) {
      pHash = String(projectHash).trim();
    } else if (projectPath) {
      pHash = computeProjectHash(projectPath);
    }

    if (pHash) {
      sql += " AND (project_hash = ? OR project_hash = '')";
      params.push(pHash);
    }

    const row = conn.prepare(sql).get(...params);
    return row ? row.cnt : 0;
  } catch (_) {
    return 0;
  } finally {
    conn.close();
  }
}

function pruneSessionMemories(sessionId, dbPath = DB_PATH) {
  if (!sessionId) return { deleted: 0 };
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const res = conn.prepare("DELETE FROM persona_memories WHERE session_id = ?").run(sessionId);
    return { deleted: res.changes };
  } finally {
    conn.close();
  }
}

/**
 * Resolve the agent to attribute a memory to. Explicit names win; otherwise the
 * active agent is detected, and anything non-canonical falls back to the router.
 */
function resolveMemoryAgent(explicitAgent) {
  const { normalizeAgentName, isCanonicalAgent } = require('./canonical_agents');
  const explicit = normalizeAgentName(explicitAgent);
  if (explicit && isCanonicalAgent(explicit)) return explicit;
  try {
    const { detectActiveAgent } = require('./mcp/client_detection');
    const detected = normalizeAgentName(detectActiveAgent());
    if (detected && isCanonicalAgent(detected)) return detected;
  } catch (_) { /* detection unavailable: fall through to router */ }
  return 'sannin';
}

function recordFlowSkill(flowHash, skillName, taskId = null, sessionId = null, ...rest) {
  // Accepts optional (projectPath, dbPath, agentName). agentName defaults to the
  // detected active agent so delegated subagents are attributed correctly.
  const [projectPath = null, dbPath = DB_PATH, agentName = null] = rest;
  if (!flowHash || !skillName) return null;
  const cleanSkill = String(skillName).trim();
  const cleanFlow = String(flowHash).trim();
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const existing = conn.prepare(
      "SELECT id FROM persona_memories WHERE memory_type = 'flow_skill' AND tags = ? AND title = ? LIMIT 1"
    ).get(cleanFlow, cleanSkill);
    const now = new Date().toISOString();
    const content = JSON.stringify({ flow_hash: cleanFlow, skill_name: cleanSkill, task_id: taskId, loaded_at: now });
    if (!existing) {
      let pHash = null;
      if (projectPath) {
        pHash = computeProjectHash(projectPath);
      }
      const memId = crypto.randomUUID().substring(0, 8);
      conn.prepare(
        `INSERT INTO persona_memories (id, agent_name, project_hash, session_id, memory_type, title, content, tags, importance, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'flow_skill', ?, ?, ?, 1, ?, ?)`
      ).run(memId, resolveMemoryAgent(agentName), pHash, sessionId || '', cleanSkill, content, cleanFlow, now, now);
      return memId;
    }
    return existing.id;
  } catch (_) {
    return null;
  } finally {
    conn.close();
  }
}

function getFlowSkills(flowHash, dbPath = DB_PATH) {
  if (!flowHash) return [];
  const cleanFlow = String(flowHash).trim();
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const rows = conn.prepare(
      "SELECT title FROM persona_memories WHERE memory_type = 'flow_skill' AND tags = ? ORDER BY id ASC"
    ).all(cleanFlow);
    return rows.map(r => r.title);
  } catch (_) {
    return [];
  } finally {
    conn.close();
  }
}

module.exports = {
  saveMemory,
  memoryContentExists,
  appendSessionFilter,
  queryMemories,
  listMemories,
  deleteMemory,
  pruneProjectMemories,
  pruneMemories,
  countMemories,
  pruneSessionMemories,
  recordFlowSkill,
  getFlowSkills
};
