/**
 * Konoha MCP Subsystem - Skills Search & Project Auto-Migration
 * Extracted from skills.js as part of modularization refactor (Phase 6)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { getDb, sanitizeFts5Query } = db;
const { getWorkspaceRoot, isIdeInstallationDir } = require('./runtime_state');
const { isCanonicalSkill, isEmbeddedReference } = require('../canonical_skills');
const {
  USER_AGENTS_YAML,
  normalizeLegacySkillName,
  contentHash,
  extractSnippet,
  getServedSkillsSet,
  searchMirrorSkills,
  logToolCall,
  isOffensiveSkill
} = require('./skills_common');
const { isPathVisible } = require('./runtime_state');
const { shieldPromptInjection } = require('../migrate');

const HOME = process.env.HOME || process.env.USERPROFILE || require('os').homedir();
let yamlUtils;
try {
  yamlUtils = require('./yaml_utils');
} catch (_) {
  try {
    yamlUtils = require('../yaml_utils');
  } catch (_2) {
    yamlUtils = require(path.join(HOME, '.konoha', 'yaml_utils'));
  }
}
const { parseYaml } = yamlUtils;

function _checkSkillEntry(skillsDir, entry) {
  if (isEmbeddedReference(entry) && !isCanonicalSkill(entry)) return null;
  const full = path.join(skillsDir, entry);
  if (!fs.statSync(full).isDirectory()) return null;
  const skillMd = path.join(full, 'SKILL.md');
  return (fs.existsSync(skillMd) && fs.statSync(skillMd).isFile()) ? entry : null;
}

function autoDetectSkills(skillsDir) {
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) return [];
  const results = [];
  try {
    for (const entry of fs.readdirSync(skillsDir)) {
      const detected = _checkSkillEntry(skillsDir, entry);
      if (detected) results.push(detected);
    }
  } catch (_) { /* ignore */ }
  return results;
}

let _PROJECT_SKILLS_CACHE = {};

function _migrateSingleCandidateDir(cdir, migratedSkills) {
  if (!fs.existsSync(cdir) || !fs.statSync(cdir).isDirectory()) return;
  try {
    const st = fs.statSync(cdir);
    const cacheKey = `${cdir}:${st.mtimeMs}:${st.size}`;
    if (_PROJECT_SKILLS_CACHE[cdir] === cacheKey) return;

    const detected = autoDetectSkills(cdir);
    _PROJECT_SKILLS_CACHE[cdir] = cacheKey;
    if (!detected || detected.length === 0) return;

    const migrateModule = require('../migrate');
    for (const skillName of detected) {
      const cnt = migrateModule.migrateSingleSkill(skillName, cdir);
      if (cnt > 0) {
        migratedSkills.push(`${skillName} (${cdir})`);
        process.stderr.write(`[mcp konoha] Auto-migrated project skill '${skillName}' from ${cdir} into skills.db\n`);
      }
    }
  } catch (e) {
    process.stderr.write(`[mcp konoha] Error auto-migrating project skills from ${cdir}: ${e.message}\n`);
  }
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
    path.join(ws, '.skills'),
    path.join(ws, '.cursor', 'skills'),
    path.join(ws, '.gemini', 'skills'),
    path.join(ws, '.gemini', 'antigravity-cli', 'skills'),
    path.join(ws, '.commandcode', 'skills'),
    path.join(ws, '.claude', 'skills'),
    path.join(ws, '.omp', 'skills'),
    path.join(ws, '.config', 'opencode', 'skills'),
    path.join(ws, '.opencode', 'skills'),
    path.join(ws, 'docs', 'skills')
  ];

  const migratedSkills = [];
  for (const cdir of candidateSubdirs) _migrateSingleCandidateDir(cdir, migratedSkills);
  return migratedSkills;
}

function querySkillsByKeyword(conn, keyword, limit = 50) {
  let rows = [];
  if (!db.hasFts5Support || db.hasFts5Support(conn)) {
    const sanitizedKeyword = sanitizeFts5Query(keyword);
    try {
      rows = conn.prepare(`
        SELECT s.name, s.skill_name, s.type, s.tags,
               s.content, s.byte_size, s.line_count, s.file_path,
               bm25(skills_fts, 10.0, 5.0, 8.0, 1.0) AS rank
        FROM skills_fts
        JOIN skills s ON skills_fts.rowid = s.rowid
        WHERE skills_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(sanitizedKeyword, limit);
    } catch (e) {
      process.stderr.write(`  [Warning] FTS5 search query failed: ${e.message}. Falling back to LIKE search.\n`);
      rows = [];
    }
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
      LIMIT ?
    `).all(likeKeyword, likeKeyword, likeKeyword, limit);
  }
  return rows || [];
}

const _SKILL_QUERY_CACHE = new Map();
const MAX_QUERY_CACHE = 150;

function clearSkillQueryCache() {
  _SKILL_QUERY_CACHE.clear();
}

function _fetchCandidateSkillRows(conn, normKeyword, limit) {
  if (!conn) return [];
  let rows = [];
  try {
    const vectorSearch = require('../vector_search');
    if (vectorSearch.isSemanticSearchEnabled()) {
      const semanticResults = vectorSearch.findSkillSemantic(conn, normKeyword, limit * 2, 25);
      if (semanticResults && semanticResults.length > 0) rows = semanticResults;
    }
  } catch (e) {
    process.stderr.write(`  [Warning] Semantic search failed: ${e.message}. Falling back to FTS5.\n`);
  }
  if (!rows || rows.length === 0) {
    try {
      rows = querySkillsByKeyword(conn, normKeyword, 50);
    } catch (_) {
      rows = [];
    }
  }
  return rows || [];
}

function _sortSkillRows(rows, normKeyword) {
  if (!rows || rows.length <= 1) return;
  rows.sort((a, b) => {
    const aExact = a.name.toLowerCase() === normKeyword.toLowerCase() || (a.skill_name && a.skill_name.toLowerCase() === normKeyword.toLowerCase());
    const bExact = b.name.toLowerCase() === normKeyword.toLowerCase() || (b.skill_name && b.skill_name.toLowerCase() === normKeyword.toLowerCase());
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    if (a.type === 'skill' && b.type === 'reference') return -1;
    if (a.type === 'reference' && b.type === 'skill') return 1;
    return 0;
  });
}

function _collectVisibleRows(rows, agentName, limit) {
  const visible = [];
  for (const row of rows) {
    if (agentName !== 'akatsuki' && isOffensiveSkill(row.name, row.tags)) continue;
    if (isPathVisible(row.file_path)) visible.push(row);
    if (visible.length >= limit) break;
  }
  return visible;
}

function _appendMirrorFallbacks(normKeyword, limit, agentName, visibleRows) {
  if (visibleRows.length > 0) return;
  const mirrorRows = searchMirrorSkills(normKeyword, limit);
  if (!mirrorRows || mirrorRows.length === 0) return;
  process.stderr.write(`  ⚠️ [find_skill] '${normKeyword}' not found in SQLite FTS5/RAG. Retrieved ${mirrorRows.length} matches from mirror fallback.\n`);
  for (const mRow of mirrorRows) {
    if (agentName !== 'akatsuki' && isOffensiveSkill(mRow.name, mRow.tags)) continue;
    visibleRows.push(mRow);
  }
}

function _buildFindSkillResults(visibleRows, trackingKey) {
  const servedSet = getServedSkillsSet(trackingKey);
  const results = [];
  process.stderr.write(`  → Found ${visibleRows.length} matching skill/reference entries:\n`);
  for (const row of visibleRows) {
    process.stderr.write(`    - ${row.name} (${row.type}, ${row.byte_size} bytes)\n`);
    const shielded = shieldPromptInjection(row.content || '');
    const isAlreadyServed = servedSet.has(row.name);
    servedSet.add(row.name);

    const snippet = extractSnippet(shielded, 150);
    const estTokens = Math.ceil(Buffer.byteLength(shielded, 'utf8') / 4);
    const score = row.rank ? Math.round(Math.abs(row.rank) * 100) / 100 : 1.0;

    results.push({
      id: row.name, name: row.name, type: row.type, score, estimated_tokens: estTokens,
      snippet: isAlreadyServed ? '[LOADED]' : snippet, content: isAlreadyServed ? '[LOADED]' : snippet,
      loaded: isAlreadyServed, truncated: true, hash: contentHash(shielded),
      hint: `Use get_skill('${row.name}') for full content`
    });
  }
  return results;
}

function findSkill(keyword, limit = 3, agentName = null, compact = false, ...rest) {
  let [taskId = null, flowHash = null] = rest;
  if (typeof limit === 'object' && limit !== null) {
    const opts = limit;
    agentName = opts.agentName || opts.agent_name || agentName;
    compact = opts.compact !== undefined ? opts.compact : compact;
    taskId = opts.taskId || opts.task_id || taskId;
    flowHash = opts.flowHash || opts.flow_hash || flowHash;
    limit = opts.limit !== undefined ? opts.limit : 3;
  }
  process.stderr.write(`[mcp konoha] tool_call: find_skill(keyword='${keyword}', limit=${limit}, compact=${compact})\n`);
  try { autoMigrateProjectSkills(); } catch (_) { /* ignore */ }

  const normKeyword = normalizeLegacySkillName(keyword);
  const trackingKey = flowHash || taskId || 'default_session';
  const cacheKey = `${normKeyword}:${limit}:${compact}:${agentName || ''}:${trackingKey}`;
  if (_SKILL_QUERY_CACHE.has(cacheKey)) return _SKILL_QUERY_CACHE.get(cacheKey);

  if (agentName !== 'akatsuki' && isOffensiveSkill(normKeyword)) {
    const emptyResult = JSON.stringify({ found: 0, query: keyword, message: `No skills found for '${keyword}'. Use list_skills to see available skills.` });
    _SKILL_QUERY_CACHE.set(cacheKey, emptyResult);
    return emptyResult;
  }

  let conn = null;
  try { conn = getDb(); } catch (_) { conn = null; }
  try {
    const rows = _fetchCandidateSkillRows(conn, normKeyword, limit);
    _sortSkillRows(rows, normKeyword);
    const visibleRows = _collectVisibleRows(rows, agentName, limit);
    _appendMirrorFallbacks(normKeyword, limit, agentName, visibleRows);

    if (visibleRows.length === 0) {
      process.stderr.write('  → 0 skills found\n');
      const res = JSON.stringify({ found: 0, query: normKeyword, message: `No skills found for '${normKeyword}'. Use list_skills to see available skills.` });
      logToolCall('find_skill', normKeyword, res, agentName);
      return res;
    }

    const results = _buildFindSkillResults(visibleRows, trackingKey);
    const unsnippetedBaseline = visibleRows.reduce((acc, r) => acc + (Number(r.byte_size) || 0), 0);
    const res = JSON.stringify({ found: results.length, query: normKeyword, results });
    logToolCall('find_skill', normKeyword, res, agentName, Math.max(Buffer.byteLength(res, 'utf8'), unsnippetedBaseline));

    if (_SKILL_QUERY_CACHE.size >= MAX_QUERY_CACHE) {
      const firstKey = _SKILL_QUERY_CACHE.keys().next().value;
      _SKILL_QUERY_CACHE.delete(firstKey);
    }
    _SKILL_QUERY_CACHE.set(cacheKey, res);
    return res;
  } finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* best-effort */ }
    }
  }
}

function listSkills(agentName = null, fields = null) {
  process.stderr.write(`[mcp konoha] tool_call: list_skills(fields=${JSON.stringify(fields)})\n`);
  try { autoMigrateProjectSkills(); } catch (_) { /* ignore */ }

  const effFields = (fields && Array.isArray(fields) && fields.length > 0)
    ? fields
    : ['name', 'type', 'size'];

  let conn = null;
  try { conn = getDb(); } catch (_) { conn = null; }
  try {
    let rows = [];
    if (conn) {
      try {
        rows = conn.prepare(`
          SELECT name, skill_name, type, tags, byte_size, line_count, file_path
          FROM skills
          ORDER BY skill_name, type DESC, name
        `).all();
      } catch (_) { rows = []; }
    }

    if (!rows || rows.length === 0) {
      rows = searchMirrorSkills('', 100);
    }

    const skills = [];
    const seenNames = new Set();
    for (const row of rows) {
      if (seenNames.has(row.name)) continue;
      seenNames.add(row.name);
      if (agentName !== 'akatsuki' && isOffensiveSkill(row.name, row.tags)) continue;
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

    const res = JSON.stringify({ count: skills.length, skills });
    logToolCall('list_skills', '', res, agentName);
    return res;
  } finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* best-effort */ }
    }
  }
}

function _getSkillsFromYaml(agentName) {
  if (!fs.existsSync(USER_AGENTS_YAML)) return null;
  try {
    const parsed = parseYaml(fs.readFileSync(USER_AGENTS_YAML, 'utf8'));
    if (!Array.isArray(parsed)) return null;
    for (const ag of parsed) {
      if (ag?.name === agentName) {
        return Array.isArray(ag.skills) ? ag.skills : [];
      }
    }
  } catch (_) { /* ignore */ }
  return null;
}

function getAgentSkills(agentName) {
  if (!agentName) return null;
  let conn = null;
  try {
    conn = getDb();
    const row = conn.prepare('SELECT skills FROM agents WHERE name = ?').get(agentName);
    if (row?.skills) {
      try { return JSON.parse(row.skills); } catch (_) { /* ignore */ }
    }
    return _getSkillsFromYaml(agentName);
  } catch (e) {
    process.stderr.write(`[mcp konoha] Error reading agent skills: ${e.message}\n`);
    return null;
  } finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* intentional fallback */ }
    }
  }
}

module.exports = {
  autoDetectSkills,
  autoMigrateProjectSkills,
  querySkillsByKeyword,
  clearSkillQueryCache,
  findSkill,
  listSkills,
  getAgentSkills
};
