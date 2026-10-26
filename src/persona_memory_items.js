'use strict';

const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const {
  DB_PATH,
  getDb,
  initMemoryTables,
  computeProjectHash,
  saveOrUpdateProject
} = require('./persona_memory_projects');

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
  if (typeof agentName === 'object' && agentName !== null) {
    const opts = agentName;
    content = opts.content;
    title = opts.title || "";
    memoryType = opts.memoryType || opts.memory_type || (opts.category === 'stack' || opts.category === 'episodic' ? "episodic" : "rule");
    tags = opts.tags || (opts.category && opts.category !== 'episodic' ? opts.category : "");
    importance = opts.importance !== undefined ? opts.importance : 1;
    projectPath = opts.projectPath || opts.project_path || null;
    projectHash = opts.projectHash || opts.project_hash || null;
    sessionId = opts.sessionId || opts.session_id || null;
    dbPath = opts.dbPath || opts.db_path || DB_PATH;
    agentName = opts.agentName || opts.agent_name || opts.persona || null;
  }

  if (!content || !content.trim()) {
    throw new Error("Memory content cannot be empty.");
  }

  const trimmedContent = content.trim();
  const safeContent = trimmedContent.length > 1000 ? trimmedContent.substring(0, 1000) : trimmedContent;

  let cleanAgent = (agentName || "").toLowerCase().trim();
  if (cleanAgent.startsWith("mcp_")) {
    cleanAgent = cleanAgent.substring(4);
  }

  let pHash = null;
  if (projectHash) {
    pHash = String(projectHash).trim() || null;
  } else if (projectPath) {
    pHash = computeProjectHash(projectPath) || null;
    try {
      saveOrUpdateProject(projectPath, "", null, dbPath);
    } catch (_) { /* intentional best-effort fallback */ }
  }

  let sessId = sessionId;
  if (!sessId && sessId !== "") {
    try {
      const { getActiveSessionId } = require('./mcp/client_detection');
      sessId = getActiveSessionId(projectPath);
    } catch (_) { /* intentional best-effort fallback */ }
  }
  sessId = String(sessId || "").trim();

  let finalTitle = title;
  if (!finalTitle) {
    const firstLine = safeContent.split('\n')[0].replace(/^[#*\-\s]+/, '').trim();
    finalTitle = firstLine ? firstLine.substring(0, 60) : `${cleanAgent} memory`;
  }

  const memId = crypto.randomUUID().substring(0, 8);
  const now = new Date().toISOString();

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    let finalId = null;
    const tx = conn.transaction(() => {
      if (pHash) {
        conn.prepare(`
          INSERT OR IGNORE INTO projects (project_hash, project_path, project_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(pHash, projectPath || pHash, projectPath ? path.basename(projectPath) : pHash, now, now);
      }

      const existing = conn.prepare(`
        SELECT id FROM persona_memories
        WHERE agent_name = ? AND content = ? AND project_hash IS ? AND session_id = ?
        LIMIT 1
      `).get(cleanAgent, safeContent, pHash, sessId);

      if (existing) {
        finalId = existing.id;
        conn.prepare(`
          UPDATE persona_memories
          SET updated_at = ?, importance = MAX(importance, ?), title = CASE WHEN ? != '' THEN ? ELSE title END
          WHERE id = ?
        `).run(now, importance, finalTitle, finalTitle, finalId);
        return;
      }

      conn.prepare(`
        INSERT INTO persona_memories (id, project_hash, session_id, agent_name, memory_type, title, content, tags, importance, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(memId, pHash, sessId, cleanAgent, memoryType, finalTitle, safeContent, tags, importance, now, now);
      finalId = memId;
    });
    tx();
    return finalId;
  } finally {
    conn.close();
  }
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
      const row = conn.prepare("SELECT 1 FROM persona_memories WHERE agent_name = ? AND content = ? LIMIT 1").get(cleanAgent, c);
      return Boolean(row);
    } else {
      const row = conn.prepare("SELECT 1 FROM persona_memories WHERE content = ? LIMIT 1").get(c);
      return Boolean(row);
    }
  } finally {
    conn.close();
  }
}

function appendSessionFilter(options) {
  const { allSessions, explicitSession, pHash, strictSession, sessionId, prefix = '' } = options;
  if (allSessions) return { clause: '', params: [] };
  const col = prefix ? `${prefix}.` : '';
  const sid = String(sessionId).trim();
  if (explicitSession) {
    if (pHash && !strictSession) {
      return {
        clause: ` AND (${col}session_id = ? OR (${col}session_id = '' AND (${col}project_hash = '' OR ${col}project_hash IS NULL)) OR (${col}project_hash = ? AND ${col}memory_type != 'episodic'))`,
        params: [sid, pHash]
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
  let allSessions = false;
  let strictSession = false;
  if (typeof agentName === 'object' && agentName !== null) {
    const opts = agentName;
    query = opts.query || "";
    memoryType = opts.memoryType || opts.memory_type || null;
    projectPath = opts.projectPath || opts.project_path || null;
    projectHash = opts.projectHash || opts.project_hash || null;
    sessionId = opts.sessionId || opts.session_id || null;
    limit = opts.limit !== undefined ? opts.limit : 5;
    dbPath = opts.dbPath || opts.db_path || DB_PATH;
    allSessions = Boolean(opts.allSessions || opts.all_sessions || opts.crossSession || opts.cross_session);
    strictSession = Boolean(opts.strictSession || opts.strict_session);
    agentName = opts.agentName || opts.agent_name || opts.persona || null;
  }

  let cleanAgent = (agentName || "").toLowerCase().trim();
  if (cleanAgent.startsWith("mcp_")) {
    cleanAgent = cleanAgent.substring(4);
  }
  const isAll = (!cleanAgent || cleanAgent === "all" || cleanAgent === "global");

  let pHash = "";
  if (projectHash) {
    pHash = String(projectHash).trim();
  } else if (projectPath) {
    pHash = computeProjectHash(projectPath);
  }

  const explicitSession = Boolean(sessionId && sessionId !== 'all' && sessionId !== '*');
  if (sessionId === 'all' || sessionId === '*') {
    allSessions = true;
  }

  let activeSessId = sessionId;
  if (!activeSessId) {
    try {
      const { getActiveSessionId } = require('./mcp/client_detection');
      activeSessId = getActiveSessionId(projectPath);
    } catch (_) { /* intentional best-effort fallback */ }
  }
  activeSessId = String(activeSessId || "").trim();

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);

    if (query && query.trim()) {
      const cleanQ = query.replace(/[^\p{L}\p{N}\s]/gu, ' ');
      const tokens = cleanQ.split(/\s+/).filter(t => t.length > 1 && !['and', 'or', 'not'].includes(t.toLowerCase()));
      if (tokens.length && (!db.hasFts5Support || db.hasFts5Support(conn))) {
        const ftsExpr = tokens.map(t => `"${t}"`).join(" OR ");
        try {
          let sql;
          let params;
          if (isAll) {
            sql = `
              SELECT m.* FROM persona_memories m
              JOIN persona_memories_fts f ON m.id = f.id
              WHERE persona_memories_fts MATCH ?
            `;
            params = [ftsExpr];
          } else {
            sql = `
              SELECT m.* FROM persona_memories m
              JOIN persona_memories_fts f ON m.id = f.id
              WHERE (m.agent_name = ? OR m.agent_name = 'global')
              AND persona_memories_fts MATCH ?
            `;
            params = [cleanAgent, ftsExpr];
          }

          if (pHash) {
            sql += " AND (m.project_hash = ? OR m.project_hash = '' OR m.project_hash IS NULL)";
            params.push(pHash);
          }

          const sessFilter1 = appendSessionFilter({ allSessions, explicitSession, pHash, strictSession, sessionId, prefix: 'm' });
          sql += sessFilter1.clause;
          params.push(...sessFilter1.params);

          if (memoryType) {
            sql += " AND m.memory_type = ?";
            params.push(memoryType);
          }

          if (activeSessId) {
            sql += " ORDER BY (CASE WHEN m.session_id = ? THEN 3 WHEN m.project_hash = ? THEN 2 ELSE 1 END) DESC, m.importance DESC, m.updated_at DESC LIMIT ?";
            params.push(activeSessId, pHash, limit);
          } else {
            sql += " ORDER BY (CASE WHEN m.project_hash = ? THEN 2 ELSE 1 END) DESC, m.importance DESC, m.updated_at DESC LIMIT ?";
            params.push(pHash, limit);
          }

          const rows = conn.prepare(sql).all(...params);
          if (rows && rows.length) {
            return rows;
          }
        } catch (err) {
          if (err && String(err.message).toLowerCase().includes('fts5')) {
            try { db.rebuildAllFts(conn); } catch (_) { /* intentional ignore */ }
          }
        }
      }
    }

    let sql;
    let params;
    if (isAll) {
      sql = "SELECT * FROM persona_memories WHERE 1=1";
      params = [];
    } else {
      sql = "SELECT * FROM persona_memories WHERE (agent_name = ? OR agent_name = 'global')";
      params = [cleanAgent];
    }

    if (pHash) {
      sql += " AND (project_hash = ? OR project_hash = '' OR project_hash IS NULL)";
      params.push(pHash);
    }

    const sessFilter2 = appendSessionFilter({ allSessions, explicitSession, pHash, strictSession, sessionId });
    sql += sessFilter2.clause;
    params.push(...sessFilter2.params);

    if (memoryType) {
      sql += " AND memory_type = ?";
      params.push(memoryType);
    }

    if (activeSessId) {
      sql += " ORDER BY (CASE WHEN session_id = ? THEN 3 WHEN project_hash = ? THEN 2 ELSE 1 END) DESC, importance DESC, updated_at DESC LIMIT ?";
      params.push(activeSessId, pHash, limit);
    } else {
      sql += " ORDER BY (CASE WHEN project_hash = ? THEN 2 ELSE 1 END) DESC, importance DESC, updated_at DESC LIMIT ?";
      params.push(pHash, limit);
    }

    return conn.prepare(sql).all(...params);
  } finally {
    conn.close();
  }
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
  let allSessions = false;
  if (typeof agentName === 'object' && agentName !== null) {
    const opts = agentName;
    memoryType = opts.memoryType || opts.memory_type || null;
    projectPath = opts.projectPath || opts.project_path || null;
    projectHash = opts.projectHash || opts.project_hash || null;
    sessionId = opts.sessionId || opts.session_id || null;
    limit = opts.limit !== undefined ? opts.limit : 50;
    dbPath = opts.dbPath || opts.db_path || DB_PATH;
    allSessions = Boolean(opts.allSessions || opts.all_sessions || opts.crossSession || opts.cross_session);
    agentName = opts.agentName || opts.agent_name || opts.persona || null;
  }

  const explicitSession = Boolean(sessionId && sessionId !== 'all' && sessionId !== '*');
  if (sessionId === 'all' || sessionId === '*') {
    allSessions = true;
  }

  let activeSessId = sessionId;
  if (!activeSessId) {
    try {
      const { getActiveSessionId } = require('./mcp/client_detection');
      activeSessId = getActiveSessionId(projectPath);
    } catch (_) { /* intentional best-effort fallback */ }
  }
  activeSessId = String(activeSessId || "").trim();

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    let sql = "SELECT * FROM persona_memories WHERE 1=1";
    const params = [];

    if (agentName && !["all", "global", ""].includes(agentName.toLowerCase().trim())) {
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
      sql += " AND (project_hash = ? OR project_hash = '' OR project_hash IS NULL)";
      params.push(pHash);
    }

    if (!allSessions) {
      if (explicitSession) {
        if (pHash) {
          sql += " AND (session_id = ? OR session_id = '' OR session_id IS NULL OR (project_hash = ? AND memory_type != 'episodic'))";
          params.push(String(sessionId).trim(), pHash);
        } else {
          sql += " AND (session_id = ? OR session_id = '' OR session_id IS NULL)";
          params.push(String(sessionId).trim());
        }
      } else {
        sql += " AND (memory_type != 'episodic' OR session_id = '' OR session_id IS NULL)";
      }
    }

    if (memoryType) {
      sql += " AND memory_type = ?";
      params.push(memoryType);
    }

    if (activeSessId) {
      sql += " ORDER BY (CASE WHEN session_id = ? THEN 3 WHEN project_hash = ? THEN 2 ELSE 1 END) DESC, agent_name ASC, importance DESC, updated_at DESC LIMIT ?";
      params.push(activeSessId, pHash, limit);
    } else {
      sql += " ORDER BY (CASE WHEN project_hash = ? THEN 2 ELSE 1 END) DESC, agent_name ASC, importance DESC, updated_at DESC LIMIT ?";
      params.push(pHash, limit);
    }

    return conn.prepare(sql).all(...params);
  } finally {
    conn.close();
  }
}

function deleteMemory(memoryId, dbPath = null) {
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const strId = String(memoryId != null ? memoryId : '').trim();
    const numId = /^\d+$/.test(strId) ? parseInt(strId, 10) : null;
    const res = numId !== null
      ? conn.prepare("DELETE FROM persona_memories WHERE id = ? OR id = ?").run(strId, numId)
      : conn.prepare("DELETE FROM persona_memories WHERE id = ?").run(strId);
    return res.changes > 0;
  } finally {
    conn.close();
  }
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
  } finally {
    conn.close();
  }
}

function pruneMemories(options = {}, dbPath = DB_PATH) {
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    let sql = "DELETE FROM persona_memories WHERE 1=1";
    const params = [];

    if (options.projectPath || options.projectHash) {
      let pHash = options.projectHash;
      if (!pHash && options.projectPath) {
        pHash = computeProjectHash(options.projectPath);
      }
      if (pHash) {
        sql += " AND project_hash = ?";
        params.push(pHash);
      }
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
    let sql = "SELECT COUNT(*) as cnt FROM persona_memories WHERE 1=1";
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

function recordFlowSkill(flowHash, skillName, taskId = null, sessionId = null, projectPath = null, dbPath = DB_PATH) {
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
         VALUES (?, 'sannin', ?, ?, 'flow_skill', ?, ?, ?, 1, ?, ?)`
      ).run(memId, pHash, sessionId || '', cleanSkill, content, cleanFlow, now, now);
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
