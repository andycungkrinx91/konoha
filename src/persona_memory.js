/**
 * Persistent Persona Memory & Project Context Engine for Konoha.
 * Pure Node.js replacement for persona_memory.py using better-sqlite3 and crypto.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

let DB_PATH = db.DB_PATH;

function getDefaultDbPath() {
  return DB_PATH || db.DB_PATH;
}

function getDb(dbPath = null) {
  return db.getConnection(dbPath || getDefaultDbPath(), false);
}

function computeProjectHash(projectPath) {
  if (!projectPath || !String(projectPath).trim()) {
    return "";
  }
  const trimmed = String(projectPath).trim();
  try {
    let canonical = path.resolve(trimmed);
    if (fs.existsSync(canonical)) {
      canonical = fs.realpathSync(canonical);
    }
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').substring(0, 12);
  } catch (_) {
    return crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex').substring(0, 12);
  }
}

function detectProjectStack(workspacePath) {
  const stackInfo = {
    project_name: "",
    framework: "Unknown",
    styling: "Standard CSS",
    package_manager: "pnpm",
    language: "TypeScript / JavaScript",
    dependencies: []
  };

  if (!workspacePath || !fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) {
    return stackInfo;
  }

  let canonical = path.resolve(workspacePath);
  try {
    canonical = fs.realpathSync(canonical);
  } catch (_) {}

  stackInfo.project_name = path.basename(canonical);

  // Detect package manager
  if (fs.existsSync(path.join(canonical, "pnpm-lock.yaml"))) {
    stackInfo.package_manager = "pnpm";
  } else if (fs.existsSync(path.join(canonical, "bun.lockb")) || fs.existsSync(path.join(canonical, "bun.lock"))) {
    stackInfo.package_manager = "bun";
  } else if (fs.existsSync(path.join(canonical, "yarn.lock"))) {
    stackInfo.package_manager = "yarn";
  } else if (fs.existsSync(path.join(canonical, "package-lock.json"))) {
    stackInfo.package_manager = "npm";
  }

  // Analyze package.json if present
  const pkgJsonPath = path.join(canonical, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkgData = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      if (pkgData.name) {
        stackInfo.project_name = pkgData.name;
      }

      const allDeps = Object.assign({}, pkgData.dependencies || {}, pkgData.devDependencies || {});

      const relevantKeywords = [
        'react', 'vue', 'svelte', 'angular', 'next', 'nuxt', 'tailwind',
        'prisma', 'drizzle', 'fastapi', 'flask', 'express', 'hono', 'zod',
        'trpc', 'lucide', 'motion', 'three', 'vitest', 'jest', 'playwright'
      ];
      const depKeys = Object.keys(allDeps);
      const filteredDeps = depKeys.filter(k => relevantKeywords.some(kw => k.toLowerCase().includes(kw)));
      stackInfo.dependencies = filteredDeps.length ? filteredDeps.slice(0, 15) : depKeys.slice(0, 10);

      // Framework detection
      if ('next' in allDeps) {
        const ver = allDeps['next'] || '';
        stackInfo.framework = ver ? `Next.js (${ver})` : "Next.js";
      } else if ('@sveltejs/kit' in allDeps || 'svelte' in allDeps) {
        stackInfo.framework = "SvelteKit";
      } else if ('nuxt' in allDeps || 'nuxt3' in allDeps) {
        stackInfo.framework = "Nuxt 3";
      } else if ('@angular/core' in allDeps) {
        stackInfo.framework = "Angular";
      } else if ('astro' in allDeps) {
        stackInfo.framework = "Astro";
      } else if ('vue' in allDeps) {
        stackInfo.framework = "Vue";
      } else if ('react' in allDeps) {
        stackInfo.framework = "React";
      } else if ('express' in allDeps) {
        stackInfo.framework = "Express.js";
      } else if ('hono' in allDeps) {
        stackInfo.framework = "Hono";
      }

      // Styling detection
      if ('tailwindcss' in allDeps) {
        const twVer = allDeps['tailwindcss'] || '';
        if ('@tailwindcss/postcss' in allDeps || twVer.startsWith('^4') || twVer.startsWith('4.')) {
          stackInfo.styling = "Tailwind CSS v4 (@theme directives)";
        } else {
          stackInfo.styling = "Tailwind CSS";
        }
      } else if ('@emotion/react' in allDeps || '@emotion/styled' in allDeps) {
        stackInfo.styling = "Emotion CSS";
      } else if ('styled-components' in allDeps) {
        stackInfo.styling = "Styled Components";
      } else if ('unocss' in allDeps) {
        stackInfo.styling = "UnoCSS";
      }
    } catch (_) {}
  }

  // Python stack detection
  if (fs.existsSync(path.join(canonical, "pyproject.toml")) || fs.existsSync(path.join(canonical, "requirements.txt"))) {
    stackInfo.language = "Python";
    if (stackInfo.framework === "Unknown") {
      const reqPath = path.join(canonical, "requirements.txt");
      if (fs.existsSync(reqPath)) {
        try {
          const content = fs.readFileSync(reqPath, 'utf8').toLowerCase();
          if (content.includes("fastapi")) stackInfo.framework = "FastAPI";
          else if (content.includes("django")) stackInfo.framework = "Django";
          else if (content.includes("flask")) stackInfo.framework = "Flask";
        } catch (_) {}
      }
    }
  }

  return stackInfo;
}

function initMemoryTables(conn) {
  db.setupSchema(conn);
}

function saveOrUpdateProject(projectPath, contextSummary = "", techStack = null, dbPath = DB_PATH) {
  if (!projectPath || !String(projectPath).trim()) {
    return "";
  }

  const trimmed = String(projectPath).trim();
  let canonical = path.resolve(trimmed);
  try {
    if (fs.existsSync(canonical)) canonical = fs.realpathSync(canonical);
  } catch (_) {}

  const pHash = computeProjectHash(canonical);
  const now = new Date().toISOString();

  const detected = detectProjectStack(canonical);
  if (techStack) {
    Object.assign(detected, techStack);
  }

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const existing = conn.prepare("SELECT * FROM projects WHERE project_hash = ?").get(pHash);
    if (existing) {
      const newSummary = (contextSummary && contextSummary.trim()) ? contextSummary.trim() : existing.context_summary;
      conn.prepare(`
        UPDATE projects
        SET project_path = ?, project_name = ?, framework = ?, styling = ?, package_manager = ?,
            context_summary = ?, tech_stack = ?, updated_at = ?
        WHERE project_hash = ?
      `).run(
        canonical,
        detected.project_name || existing.project_name,
        detected.framework || existing.framework,
        detected.styling || existing.styling,
        detected.package_manager || existing.package_manager,
        newSummary,
        JSON.stringify(detected),
        now,
        pHash
      );
    } else {
      conn.prepare(`
        INSERT INTO projects (project_hash, project_path, project_name, framework, styling, package_manager, context_summary, tech_stack, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pHash,
        canonical,
        detected.project_name || path.basename(canonical),
        detected.framework || "Unknown",
        detected.styling || "Standard CSS",
        detected.package_manager || "pnpm",
        (contextSummary || "").trim(),
        JSON.stringify(detected),
        now,
        now
      );
    }
    return pHash;
  } finally {
    conn.close();
  }
}

function getProjectProfile(projectPathOrHash, dbPath = DB_PATH) {
  if (!projectPathOrHash || !String(projectPathOrHash).trim()) {
    return null;
  }

  const target = String(projectPathOrHash).trim();
  const pHash = (target.includes('/') || target.includes('\\') || fs.existsSync(target))
    ? computeProjectHash(target)
    : target;

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const row = conn.prepare("SELECT * FROM projects WHERE project_hash = ? OR project_path = ?").get(pHash, target);
    if (row) {
      const res = Object.assign({}, row);
      try {
        res.tech_stack = JSON.parse(res.tech_stack || "{}");
      } catch (_) {}
      return res;
    }
    return null;
  } finally {
    conn.close();
  }
}

function listProjects(limit = 50, dbPath = DB_PATH) {
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const rows = conn.prepare("SELECT * FROM projects ORDER BY updated_at DESC LIMIT ?").all(limit);
    return rows.map(r => {
      const d = Object.assign({}, r);
      try {
        d.tech_stack = JSON.parse(d.tech_stack || "{}");
      } catch (_) {}
      return d;
    });
  } finally {
    conn.close();
  }
}

function deleteProject(projectPathOrHash, deleteAssociatedMemories = true, dbPath = DB_PATH) {
  if (!projectPathOrHash) return false;
  const target = String(projectPathOrHash).trim();
  const pHash = (target.includes('/') || target.includes('\\') || fs.existsSync(target))
    ? computeProjectHash(target)
    : target;

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const res = conn.prepare("DELETE FROM projects WHERE project_hash = ? OR project_path = ?").run(pHash, target);
    const deleted = res.changes > 0;
    if (deleteAssociatedMemories) {
      conn.prepare("DELETE FROM persona_memories WHERE project_hash = ?").run(pHash);
      try {
        conn.prepare("DELETE FROM persona_memories_fts WHERE project_hash = ?").run(pHash);
      } catch (_) {}
    }
    return deleted;
  } finally {
    conn.close();
  }
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
  dbPath = DB_PATH
) {
  if (typeof agentName === 'object' && agentName !== null) {
    const opts = agentName;
    content = opts.content;
    title = opts.title || "";
    memoryType = opts.memoryType || opts.memory_type || "rule";
    tags = opts.tags || "";
    importance = opts.importance !== undefined ? opts.importance : 1;
    projectPath = opts.projectPath || opts.project_path || null;
    projectHash = opts.projectHash || opts.project_hash || null;
    dbPath = opts.dbPath || opts.db_path || DB_PATH;
    agentName = opts.agentName || opts.agent_name;
  }

  if (!content || !content.trim()) {
    throw new Error("Memory content cannot be empty.");
  }

  let cleanAgent = (agentName || "").toLowerCase().trim();
  if (cleanAgent.startsWith("mcp_")) {
    cleanAgent = cleanAgent.substring(4);
  }

  let pHash = "";
  if (projectHash) {
    pHash = String(projectHash).trim();
  } else if (projectPath) {
    pHash = computeProjectHash(projectPath);
    try {
      saveOrUpdateProject(projectPath, "", null, dbPath);
    } catch (_) {}
  }

  let finalTitle = title;
  if (!finalTitle) {
    const firstLine = content.trim().split('\n')[0].replace(/^[#*\-\s]+/, '').trim();
    finalTitle = firstLine ? firstLine.substring(0, 60) : `${cleanAgent} memory`;
  }

  const memId = crypto.randomUUID().substring(0, 8);
  const now = new Date().toISOString();

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const existing = conn.prepare(`
      SELECT id FROM persona_memories
      WHERE agent_name = ? AND content = ? AND project_hash = ?
      LIMIT 1
    `).get(cleanAgent, content.trim(), pHash);

    if (existing) {
      const existingId = existing.id;
      conn.prepare(`
        UPDATE persona_memories
        SET updated_at = ?, importance = MAX(importance, ?), title = CASE WHEN ? != '' THEN ? ELSE title END
        WHERE id = ?
      `).run(now, importance, finalTitle, finalTitle, existingId);
      return existingId;
    }

    conn.prepare(`
      INSERT INTO persona_memories (id, project_hash, agent_name, memory_type, title, content, tags, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(memId, pHash, cleanAgent, memoryType, finalTitle, content.trim(), tags, importance, now, now);

    try {
      conn.prepare(`
        INSERT INTO persona_memories_fts (id, project_hash, agent_name, title, content, tags)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(memId, pHash, cleanAgent, finalTitle, content.trim(), tags);
    } catch (_) {}

    return memId;
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

function queryMemories(
  agentName = null,
  query = "",
  memoryType = null,
  projectPath = null,
  projectHash = null,
  limit = 5,
  dbPath = DB_PATH
) {
  if (typeof agentName === 'object' && agentName !== null) {
    const opts = agentName;
    query = opts.query || "";
    memoryType = opts.memoryType || opts.memory_type || null;
    projectPath = opts.projectPath || opts.project_path || null;
    projectHash = opts.projectHash || opts.project_hash || null;
    limit = opts.limit !== undefined ? opts.limit : 5;
    dbPath = opts.dbPath || opts.db_path || DB_PATH;
    agentName = opts.agentName || opts.agent_name || null;
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

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);

    if (query && query.trim()) {
      const cleanQ = query.replace(/[^\p{L}\p{N}\s]/gu, ' ');
      const tokens = cleanQ.split(/\s+/).filter(t => t.length > 1 && !['and', 'or', 'not'].includes(t.toLowerCase()));
      if (tokens.length) {
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
            sql += " AND (m.project_hash = ? OR m.project_hash = '')";
            params.push(pHash);
          }

          if (memoryType) {
            sql += " AND m.memory_type = ?";
            params.push(memoryType);
          }

          sql += " ORDER BY (CASE WHEN m.project_hash = ? THEN 2 ELSE 1 END) DESC, m.importance DESC, m.updated_at DESC LIMIT ?";
          params.push(pHash, limit);

          const rows = conn.prepare(sql).all(...params);
          if (rows && rows.length) {
            return rows;
          }
        } catch (_) {}
      }
    }

    // Fallback: Top memories ordered by project scope and importance
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
      sql += " AND (project_hash = ? OR project_hash = '')";
      params.push(pHash);
    }

    if (memoryType) {
      sql += " AND memory_type = ?";
      params.push(memoryType);
    }

    sql += " ORDER BY (CASE WHEN project_hash = ? THEN 2 ELSE 1 END) DESC, importance DESC, updated_at DESC LIMIT ?";
    params.push(pHash, limit);

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
  limit = 50,
  dbPath = DB_PATH
) {
  if (typeof agentName === 'object' && agentName !== null) {
    const opts = agentName;
    memoryType = opts.memoryType || opts.memory_type || null;
    projectPath = opts.projectPath || opts.project_path || null;
    projectHash = opts.projectHash || opts.project_hash || null;
    limit = opts.limit !== undefined ? opts.limit : 50;
    dbPath = opts.dbPath || opts.db_path || DB_PATH;
    agentName = opts.agentName || opts.agent_name || null;
  }

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
      sql += " AND (project_hash = ? OR project_hash = '')";
      params.push(pHash);
    }

    if (memoryType) {
      sql += " AND memory_type = ?";
      params.push(memoryType);
    }

    sql += " ORDER BY (CASE WHEN project_hash = ? THEN 2 ELSE 1 END) DESC, agent_name ASC, importance DESC, updated_at DESC LIMIT ?";
    params.push(pHash, limit);

    return conn.prepare(sql).all(...params);
  } finally {
    conn.close();
  }
}

function deleteMemory(memoryId, dbPath = DB_PATH) {
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const res = conn.prepare("DELETE FROM persona_memories WHERE id = ?").run(memoryId);
    const deleted = res.changes > 0;
    if (deleted) {
      try {
        conn.prepare("DELETE FROM persona_memories_fts WHERE id = ?").run(memoryId);
      } catch (_) {}
    }
    return deleted;
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

function formatMemoriesForPrompt(memories, maxItems = 2) {
  if (!memories || !memories.length) return "";
  const lines = ["### Agent Persona Memory & Learned Rules:"];
  for (const m of memories.slice(0, maxItems)) {
    const mtype = (m.memory_type || "rule").toUpperCase();
    const content = (m.content || "").trim();
    const shortC = content.length > 120 ? content.substring(0, 120) + "..." : content;
    const scopeBadge = m.project_hash ? " [PROJECT]" : "";
    lines.push(`- [${mtype}${scopeBadge}] ${shortC}`);
  }
  return lines.join("\n") + "\n\n";
}

function formatProjectContextForPrompt(projectProfile, memories = null, maxMemories = 2, compact = false) {
  if (!projectProfile && (!memories || !memories.length)) return "";

  const header = compact ? "### 🧠 Project Context Memory (Auto-Compacted):" : "### 🏢 Persistent Project Context & Invariants:";
  const lines = [header];

  if (projectProfile) {
    const name = projectProfile.project_name || "Project";
    const pPath = projectProfile.project_path || "";
    const fw = projectProfile.framework || "Unknown";
    const styling = projectProfile.styling || "Standard CSS";
    const pm = projectProfile.package_manager || "pnpm";
    const summary = (projectProfile.context_summary || "").trim();

    if (compact) {
      lines.push(`- **Stack**: \`${name}\` (${fw} • ${styling} • ${pm})`);
      if (summary) {
        const shortS = summary.length > 100 ? summary.substring(0, 100) + "..." : summary;
        lines.push(`- **Invariants**: ${shortS}`);
      }
    } else {
      lines.push(`- **Stack**: ${name} (\`${pPath}\`) | Framework: \`${fw}\` | Styling: \`${styling}\` | PM: \`${pm}\``);
      if (summary) {
        const shortS = summary.length > 120 ? summary.substring(0, 120) + "..." : summary;
        lines.push(`- **Invariants**: ${shortS}`);
      }
    }
  }

  if (memories && memories.length) {
    const seen = new Set();
    const uniqueMems = [];
    for (const m of memories) {
      const c = (m.content || "").trim();
      if (c && !seen.has(c)) {
        seen.add(c);
        uniqueMems.push(m);
      }
    }
    const maxItems = compact ? 1 : maxMemories;
    for (const m of uniqueMems.slice(0, maxItems)) {
      const mtype = (m.memory_type || "rule").toUpperCase();
      const content = (m.content || "").trim();
      const maxChar = compact ? 80 : 100;
      const shortC = content.length > maxChar ? content.substring(0, maxChar) + "..." : content;
      lines.push(`- [${mtype}] ${shortC}`);
    }
  }

  return lines.join("\n") + "\n\n";
}

module.exports = {
  get DB_PATH() { return DB_PATH || db.DB_PATH; },
  set DB_PATH(val) { DB_PATH = val; db.DB_PATH = val; },
  getDb,
  get_db: getDb,
  computeProjectHash,
  compute_project_hash: computeProjectHash,
  detectProjectStack,
  detect_project_stack: detectProjectStack,
  initMemoryTables,
  init_memory_tables: initMemoryTables,
  saveOrUpdateProject,
  save_or_update_project: saveOrUpdateProject,
  getProjectProfile,
  get_project_profile: getProjectProfile,
  listProjects,
  list_projects: listProjects,
  deleteProject,
  delete_project: deleteProject,
  saveMemory,
  save_memory: saveMemory,
  memoryContentExists,
  memory_content_exists: memoryContentExists,
  queryMemories,
  query_memories: queryMemories,
  listMemories,
  list_memories: listMemories,
  deleteMemory,
  delete_memory: deleteMemory,
  countMemories,
  count_memories: countMemories,
  formatMemoriesForPrompt,
  format_memories_for_prompt: formatMemoriesForPrompt,
  formatProjectContextForPrompt,
  format_project_context_for_prompt: formatProjectContextForPrompt
};
