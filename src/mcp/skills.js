/**
 * src/mcp/skills.js — Skill lookup, caching, FTS5/semantic retrieval, and auto-migration.
 * 
 * CRITICAL INVARIANT (PLAN_REFACTOR.md §2):
 * Reads runtime state via getWorkspaceRoot() and getActiveClient().
 * Never exports or imports mutable state by value.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../db");
const { getDb, sanitizeFts5Query } = db;
const { shieldPromptInjection } = require("../migrate");
const {
  getWorkspaceRoot,
  isPathVisible,
  isIdeInstallationDir,
  HOME,
  AGENTS_DIR
} = require("./runtime_state");
const { detectActiveClient } = require("./client_detection");

const USER_AGENTS_YAML = path.join(AGENTS_DIR, "agents.yaml");
const PREVIEW_LIMIT = 500;
const COMPACT_PREVIEW_LIMIT = 250;
const MAX_CONTENT_SIZE = 12000;

let yamlUtils;
try {
  yamlUtils = require("../../bin/lib/yaml_utils");
} catch (_) {
  try {
    yamlUtils = require("../yaml_utils");
  } catch (_2) {
    yamlUtils = require(path.join(HOME, ".konoha", "yaml_utils"));
  }
}
const { parseYaml } = yamlUtils;

function normalizeLegacySkillName(skill) {
  if (typeof skill !== 'string') return skill;
  if (skill === 'deep-code-explorer') return 'genin-skill';
  if (skill.startsWith('deep-code-explorer/')) {
    return 'genin-skill/' + skill.substring('deep-code-explorer/'.length);
  }
  return skill;
}


let _PROJECT_SKILLS_CACHE = {};

function autoDetectSkills(skillsDir) {
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
    return [];
  }
  const results = [];
  try {
    const entries = fs.readdirSync(skillsDir);
    for (const entry of entries) {
      const full = path.join(skillsDir, entry);
      if (fs.statSync(full).isDirectory()) {
        const skillMd = path.join(full, 'SKILL.md');
        if (fs.existsSync(skillMd) && fs.statSync(skillMd).isFile()) {
          results.push(entry);
        }
      }
    }
  } catch (_) { /* ignore */ }
  return results;
}

function autoMigrateProjectSkills(workspaceRoot = null) {
  const ws = workspaceRoot || getWorkspaceRoot() || process.env.KONOHA_WORKSPACE || process.env.WORKSPACE_ROOT || process.cwd();
  if (!ws || isIdeInstallationDir(ws)) return [];

  let normWs = path.resolve(ws);
  let homeDir = path.resolve(HOME);
  if (process.platform === 'win32') {
    normWs = normWs.toLowerCase();
    homeDir = homeDir.toLowerCase();
  }
  if (normWs === homeDir || normWs === path.resolve('/') || (process.platform === 'win32' && normWs.length <= 3)) {
    return [];
  }

  const candidateSubdirs = [
    path.join(ws, '.agents', 'skills'),
    path.join(ws, 'skills'),
    path.join(ws, '.cursor', 'skills'),
    path.join(ws, '.gemini', 'skills'),
    path.join(ws, '.gemini', 'antigravity-cli', 'skills')
  ];

  const migratedSkills = [];
  const migrateModule = require("../migrate");

  for (const cdir of candidateSubdirs) {
    if (!fs.existsSync(cdir) || !fs.statSync(cdir).isDirectory()) continue;
    try {
      const st = fs.statSync(cdir);
      const cacheKey = `${cdir}:${st.mtimeMs}:${st.size}`;
      if (_PROJECT_SKILLS_CACHE[cdir] === cacheKey) continue;

      const detected = autoDetectSkills(cdir);
      if (!detected || detected.length === 0) {
        _PROJECT_SKILLS_CACHE[cdir] = cacheKey;
        continue;
      }

      for (const skillName of detected) {
        const cnt = migrateModule.migrateSingleSkill(skillName, cdir);
        if (cnt > 0) {
          migratedSkills.push(`${skillName} (${cdir})`);
          process.stderr.write(`[mcp konoha] Auto-migrated project skill '${skillName}' from ${cdir} into skills.db\n`);
        }
      }
      _PROJECT_SKILLS_CACHE[cdir] = cacheKey;
    } catch (e) {
      process.stderr.write(`[mcp konoha] Error auto-migrating project skills from ${cdir}: ${e.message}\n`);
    }
  }

  return migratedSkills;
}

function contentHash(content) {
  return crypto.createHash('md5').update(content || '', 'utf8').digest('hex').substring(0, 12);
}

const LAST_CALL_TIMES = new Map();

function logToolCall(toolName, queryStr, returnedContent, agentName = null) {
  let conn = null;
  try {
    conn = getDb();
    let baselineBytes = 550000;
    try {
      const row = conn.prepare('SELECT SUM(byte_size) as total FROM skills').get();
      if (row && row.total != null) {
        baselineBytes = Number(row.total);
      }
    } catch (_) { /* ignore */ }

    const returnedBytes = Buffer.byteLength(returnedContent || '', 'utf8');
    const currentTime = Date.now() / 1000;
    const agentKey = (agentName || 'direct').toLowerCase();
    LAST_CALL_TIMES.set(agentKey, currentTime);

    const skillSavingTools = new Set([
      'find_skill', 'find_skills', 'list_skills', 'optimize_report',
      'build_from_text', 'build_from_source', 'build_with_image_design',
      'sannin', 'kage', 'jonin', 'anbu', 'chunin', 'tokubetsu_jonin', 'tokubetsu-jonin', 'genin'
    ]);
    const isSubagent = toolName.startsWith('delegate_to_') || toolName.startsWith('mcp_');

    let bytesSaved = 0;
    let tokensSaved = 0;
    let totalLibraryBytes = returnedBytes;

    if (skillSavingTools.has(toolName) || isSubagent) {
      bytesSaved = Math.max(baselineBytes - returnedBytes, 0);
      tokensSaved = Math.floor(bytesSaved / 4);
      totalLibraryBytes = baselineBytes;
    } else if (toolName === 'get_skill') {
      bytesSaved = 0;
      tokensSaved = 0;
      totalLibraryBytes = returnedBytes;
    }

    const clientName = detectActiveClient();
    conn.prepare(`
      INSERT INTO tool_calls (tool, query, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, agent, client)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(toolName, queryStr, returnedBytes, totalLibraryBytes, bytesSaved, tokensSaved, agentName, clientName);
  } catch (_) {
    // Fail silently to avoid breaking MCP stdio
  } finally {
    if (conn) {
      try { conn.close(); } catch (_) {}
    }
  }
}

function smartTruncate(content, maxSize, name = null) {
  if (!content || content.length <= maxSize) {
    return { text: content, truncated: false };
  }
  const lines = content.split('\n');
  let currentSize = 0;
  let lastGoodBoundary = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineSize = line.length + 1;
    if (currentSize + lineSize > maxSize) break;
    currentSize += lineSize;
    if (line.startsWith('#') || line.trim() === '') {
      lastGoodBoundary = i;
    }
  }

  let truncatedStr = '';
  if (lastGoodBoundary > 0 && currentSize > maxSize * 0.6) {
    truncatedStr = lines.slice(0, lastGoodBoundary).join('\n');
  } else {
    truncatedStr = content.substring(0, maxSize);
  }

  if (name) {
    truncatedStr += `\n\n... [Truncated at ${truncatedStr.length} chars. Use get_skill('${name}') for full content.]`;
  } else {
    truncatedStr += `\n\n... [Content truncated at ${truncatedStr.length} characters to save tokens.]`;
  }
  return { text: truncatedStr, truncated: true };
}

function findSkill(keyword, limit = 3, agentName = null, compact = false) {
  process.stderr.write(`[mcp konoha] tool_call: find_skill(keyword='${keyword}', limit=${limit}, compact=${compact})\n`);
  try {
    autoMigrateProjectSkills();
  } catch (_) { /* ignore */ }

  const normKeyword = normalizeLegacySkillName(keyword);
  const conn = getDb();
  const previewLimit = compact ? COMPACT_PREVIEW_LIMIT : PREVIEW_LIMIT;
  try {
    let rows = [];
    try {
      const vectorSearch = require("../vector_search");
      if (vectorSearch.isSemanticSearchEnabled()) {
        const semanticResults = vectorSearch.findSkillSemantic(conn, normKeyword, limit * 2, 25);
        if (semanticResults && semanticResults.length > 0) {
          rows = semanticResults;
        }
      }
    } catch (e) {
      process.stderr.write(`  [Warning] Semantic search failed: ${e.message}. Falling back to FTS5.\n`);
    }

    if (!rows || rows.length === 0) {
      const sanitizedKeyword = sanitizeFts5Query(normKeyword);
      try {
        rows = conn.prepare(`
          SELECT s.name, s.skill_name, s.type, s.tags,
                 s.content, s.byte_size, s.line_count, s.file_path,
                 bm25(skills_fts, 10.0, 5.0, 8.0, 1.0) AS rank
          FROM skills_fts
          JOIN skills s ON skills_fts.rowid = s.rowid
          WHERE skills_fts MATCH ?
          ORDER BY rank
          LIMIT 50
        `).all(sanitizedKeyword);
      } catch (e) {
        process.stderr.write(`  [Warning] FTS5 search failed: ${e.message}. Falling back to LIKE search.\n`);
        rows = [];
      }
    }

    if (!rows || rows.length === 0) {
      const words = normKeyword.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
      const likeKeyword = '%' + words.join('%') + '%';
      rows = conn.prepare(`
        SELECT name, skill_name, type, tags,
               content, byte_size, line_count, file_path,
               0 AS rank
        FROM skills
        WHERE tags LIKE ? OR name LIKE ? OR skill_name LIKE ?
        ORDER BY byte_size ASC
        LIMIT 50
      `).all(likeKeyword, likeKeyword, likeKeyword);
    }

    const visibleRows = [];
    for (const row of rows) {
      if (isPathVisible(row.file_path)) {
        visibleRows.push(row);
      }
      if (visibleRows.length >= limit) break;
    }

    if (visibleRows.length === 0) {
      process.stderr.write('  → 0 skills found\n');
      const res = JSON.stringify({
        found: 0,
        query: normKeyword,
        message: `No skills found for '${normKeyword}'. Use list_skills to see available skills.`
      });
      logToolCall('find_skill', normKeyword, res, agentName);
      return res;
    }

    const results = [];
    process.stderr.write(`  → Found ${visibleRows.length} matching skill/reference entries:\n`);
    for (const row of visibleRows) {
      process.stderr.write(`    - ${row.name} (${row.type}, ${row.byte_size} bytes)\n`);
      const shielded = shieldPromptInjection(row.content || '');
      const isTruncated = shielded.length > previewLimit;
      const preview = isTruncated ? shielded.substring(0, previewLimit) : shielded;

      const entry = {
        name: row.name,
        type: row.type,
        content: preview,
        truncated: isTruncated,
        hash: contentHash(shielded)
      };
      if (isTruncated) {
        entry.hint = `Use get_skill('${row.name}') for full content`;
      }
      results.push(entry);
    }

    const res = JSON.stringify({ found: results.length, query: normKeyword, results });
    logToolCall('find_skill', normKeyword, res, agentName);
    return res;
  } finally {
    conn.close();
  }
}

function listSkills(agentName = null, fields = null) {
  process.stderr.write(`[mcp konoha] tool_call: list_skills(fields=${JSON.stringify(fields)})\n`);
  try {
    autoMigrateProjectSkills();
  } catch (_) { /* ignore */ }

  const conn = getDb();
  try {
    const rows = conn.prepare(`
      SELECT name, skill_name, type, tags, byte_size, line_count, file_path
      FROM skills
      ORDER BY skill_name, type DESC, name
    `).all();

    const effFields = (fields && Array.isArray(fields) && fields.length > 0)
      ? fields
      : ['name', 'type', 'size'];

    const skills = [];
    for (const row of rows) {
      if (isPathVisible(row.file_path)) {
        const entry = {};
        if (effFields.includes('name')) entry.name = row.name;
        if (effFields.includes('type')) entry.type = row.type;
        if (effFields.includes('size')) entry.size = row.byte_size;
        if (effFields.includes('tags')) entry.tags = row.tags;
        if (effFields.includes('lines')) entry.lines = row.line_count;
        if (effFields.includes('skill_name')) entry.skill_name = row.skill_name;
        skills.push(entry);
      }
    }

    process.stderr.write(`  → Total indexed & visible: ${skills.length} entries\n`);
    const res = JSON.stringify({ total: skills.length, skills });
    logToolCall('list_skills', '', res, agentName);
    return res;
  } finally {
    conn.close();
  }
}

function getSkill(name, agentName = null) {
  process.stderr.write(`[mcp konoha] tool_call: get_skill(name='${name}')\n`);
  try {
    autoMigrateProjectSkills();
  } catch (_) { /* ignore */ }

  const normName = normalizeLegacySkillName(name);
  const conn = getDb();
  try {
    const row = conn.prepare(`
      SELECT name, skill_name, type, tags, content, byte_size, line_count, file_path
      FROM skills
      WHERE name = ?
    `).get(normName);

    if (!row || !isPathVisible(row.file_path)) {
      process.stderr.write(`  → Skill '${normName}' NOT found or access restricted\n`);
      const res = JSON.stringify({
        error: `Skill '${normName}' not found. Use list_skills or find_skill to discover available skills.`
      });
      logToolCall('get_skill', normName, res, agentName);
      return res;
    }

    process.stderr.write(`  → Retrieved ${row.name} (${row.byte_size} bytes)\n`);
    const shielded = shieldPromptInjection(row.content || '');
    let content = shielded;
    let truncated = false;

    if (content.length > MAX_CONTENT_SIZE) {
      const truncRes = smartTruncate(content, MAX_CONTENT_SIZE, row.name);
      content = truncRes.text;
      truncated = truncRes.truncated;
    }

    const res = JSON.stringify({
      name: row.name,
      type: row.type,
      content,
      byte_size: Buffer.byteLength(content, 'utf8'),
      line_count: (content.match(/\n/g) || []).length + 1,
      truncated,
      hash: contentHash(shielded)
    });
    logToolCall('get_skill', normName, res, agentName);
    return res;
  } finally {
    conn.close();
  }
}

function optimizeReport(keyword = null, agentName = null) {
  process.stderr.write(`[mcp konoha] tool_call: optimize_report(keyword='${keyword}')\n`);
  const conn = getDb();
  try {
    let rows = [];

    if (keyword) {
      const sanitized = sanitizeFts5Query(keyword);
      try {
        rows = conn.prepare(`
          SELECT s.name, s.skill_name, s.type, s.tags,
                 s.content, s.byte_size, s.line_count, s.file_path,
                 bm25(skills_fts, 10.0, 5.0, 8.0, 1.0) AS rank
          FROM skills_fts
          JOIN skills s ON skills_fts.rowid = s.rowid
          WHERE skills_fts MATCH ?
          ORDER BY rank
          LIMIT 10
        `).all(sanitized);
      } catch (e) {
        process.stderr.write(`  [Warning] FTS5 optimize_report query failed: ${e.message}. Falling back to LIKE.\n`);
        rows = [];
      }

      if (!rows || rows.length === 0) {
        const words = String(keyword).replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
        const likeKeyword = '%' + words.join('%') + '%';
        rows = conn.prepare(`
          SELECT name, skill_name, type, tags,
                 content, byte_size, line_count, file_path,
                 0 AS rank
          FROM skills
          WHERE tags LIKE ? OR name LIKE ? OR skill_name LIKE ?
          ORDER BY byte_size ASC
          LIMIT 10
        `).all(likeKeyword, likeKeyword, likeKeyword);
      }
    } else {
      rows = conn.prepare(`
        SELECT name, skill_name, type, tags,
               content, byte_size, line_count, file_path,
               0 AS rank
        FROM skills
        ORDER BY skill_name, type DESC
        LIMIT 20
      `).all();
    }

    const visibleRows = rows.filter(r => isPathVisible(r.file_path));
    const reports = [];

    for (const row of visibleRows) {
      const content = shieldPromptInjection(row.content || '');
      const headings = [];
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const stripped = line.trim();
        if (stripped.startsWith('#')) {
          const h = stripped.replace(/^#+/, '').trim();
          if (h && h.length > 2) {
            const level = stripped.length - stripped.replace(/^#+/, '').length;
            headings.push(`${'  '.repeat(Math.max(0, level - 1))}- ${h}`);
          }
        }
      }

      let summary = '';
      for (const line of lines) {
        const stripped = line.trim();
        if (stripped && !stripped.startsWith('#') && !stripped.startsWith('```') && !stripped.startsWith('|') && !stripped.startsWith('-')) {
          summary = stripped.substring(0, 200);
          break;
        }
      }

      const byteSize = Buffer.byteLength(content, 'utf8');
      reports.push({
        name: row.name,
        type: row.type,
        byte_size: byteSize,
        estimated_tokens: Math.floor(byteSize / 4),
        headings: headings.slice(0, 15),
        summary,
        hash: contentHash(content)
      });
    }

    const res = JSON.stringify({
      found: reports.length,
      query: keyword || '(all)',
      reports
    });
    logToolCall('optimize_report', keyword || '', res, agentName);
    return res;
  } finally {
    conn.close();
  }
}

function getAgentSkills(agentName) {
  if (!agentName) return null;
  let conn = null;
  try {
    conn = getDb();
    const row = conn.prepare('SELECT skills FROM agents WHERE name = ?').get(agentName);
    if (row && row.skills) {
      try {
        return JSON.parse(row.skills);
      } catch (_) { /* ignore */ }
    }
    if (fs.existsSync(USER_AGENTS_YAML)) {
      const parsed = parseYaml(fs.readFileSync(USER_AGENTS_YAML, 'utf8'));
      if (Array.isArray(parsed)) {
        for (const ag of parsed) {
          if (ag && ag.name === agentName) {
            return Array.isArray(ag.skills) ? ag.skills : [];
          }
        }
      }
    }
  } catch (e) {
    process.stderr.write(`[mcp konoha] Error reading agent skills: ${e.message}\n`);
  } finally {
    if (conn) {
      try { conn.close(); } catch (_) {}
    }
  }
  return null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function fuzzyResolveSkill(requested, conn, maxDistance = 3) {
  const norm = normalizeLegacySkillName(requested);
  const exact = conn.prepare(`
    SELECT name FROM skills WHERE name = ? OR skill_name = ?
    ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END LIMIT 1
  `).get(norm, norm, norm);
  if (exact) return exact.name;

  const candidates = conn.prepare(`
    SELECT DISTINCT skill_name FROM skills WHERE skill_name IS NOT NULL AND skill_name != ''
  `).all();

  let bestName = null;
  let bestDist = maxDistance + 1;
  for (const row of candidates) {
    const d = levenshtein(norm.toLowerCase(), row.skill_name.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      bestName = row.skill_name;
    }
  }
  return bestName;
}

module.exports = {
  findSkill,
  listSkills,
  getSkill,
  optimizeReport,
  getAgentSkills,
  fuzzyResolveSkill,
  levenshtein,
  contentHash,
  smartTruncate,
  autoMigrateProjectSkills,
  autoDetectSkills,
  normalizeLegacySkillName,
  logToolCall
};
