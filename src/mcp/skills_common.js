'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { getDb } = db;
const {
  HOME,
  AGENTS_DIR
} = require('./runtime_state');
const { detectActiveClient } = require('./client_detection');

const USER_AGENTS_YAML = path.join(AGENTS_DIR, 'agents.yaml');
const MAX_CONTENT_SIZE = 12000;

const OFFENSIVE_SKILL_PREFIXES = ['akatsuki-skill', 'pentest', 'patch-diff-exploit'];

function isOffensiveSkill(skillName, tags = '') {
  if (!skillName || typeof skillName !== 'string') return false;
  const lower = skillName.toLowerCase();
  for (const p of OFFENSIVE_SKILL_PREFIXES) {
    if (lower === p || lower.startsWith(p + '/') || lower.startsWith(p + '-')) {
      return true;
    }
  }
  if (tags && typeof tags === 'string') {
    const tLower = tags.toLowerCase();
    if (tLower.includes('red-team') || tLower.includes('pentest') || tLower.includes('offensive')) {
      return true;
    }
  }
  return false;
}

function normalizeLegacySkillName(skill) {
  if (typeof skill !== 'string') return skill;
  if (skill === 'deep-code-explorer') return 'genin-skill';
  if (skill.startsWith('deep-code-explorer/')) {
    return 'genin-skill/' + skill.substring('deep-code-explorer/'.length);
  }
  return skill;
}

function contentHash(content) {
  return crypto.createHash('md5').update(content || '', 'utf8').digest('hex').substring(0, 12);
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
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

function smartTruncate(content, maxSize, name = null) {
  if (!content) return { text: '', truncated: false };
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes <= maxSize) return { text: content, truncated: false };

  const sections = content.split(/^#{1,3}\s+/m);
  const intro = sections[0] || '';
  let accumulated = intro;
  let keptSections = [];

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const candidate = accumulated + '\n## ' + section;
    if (Buffer.byteLength(candidate, 'utf8') <= maxSize - 400) {
      accumulated = candidate;
      keptSections.push(section);
    } else {
      break;
    }
  }

  if (keptSections.length > 0) {
    const omittedCount = sections.length - 1 - keptSections.length;
    const note = omittedCount > 0
      ? `\n\n... [${omittedCount} additional sections omitted for token budget. Load sub-sections on demand with get_skill("${name || 'skill'}/<section>")]`
      : '';
    return { text: accumulated + note, truncated: true };
  }

  const truncatedBuffer = Buffer.from(content, 'utf8').subarray(0, maxSize - 120);
  const truncatedStr = truncatedBuffer.toString('utf8') + '\n\n... [Content truncated for token budget]';
  return { text: truncatedStr, truncated: true };
}

function extractSnippet(content, maxLen = 150) {
  if (!content || typeof content !== 'string') return '';
  let text = content.replace(/^---[\s\S]*?---\s*/, '').trim();
  text = text.replace(/```[\s\S]*?```/g, '').replace(/\|[^\n]+\|/g, '');
  text = text.replace(/^#+\s+[^\n]+/gm, '').trim();
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen).trim() + '...';
}

function extractSectionTitle(sectionText) {
  const firstLine = sectionText.split('\n')[0].trim();
  return firstLine.replace(/^[#\s]+/, '').trim();
}

const SERVED_SKILLS_BY_FLOW = new Map();

function getServedSkillsSet(keyId) {
  const key = keyId || 'default_session';
  if (!SERVED_SKILLS_BY_FLOW.has(key)) {
    SERVED_SKILLS_BY_FLOW.set(key, new Set());
  }
  return SERVED_SKILLS_BY_FLOW.get(key);
}

function resolveFlowHashFromTask(flowHash, taskId) {
  if (flowHash) return flowHash;
  if (!taskId) return null;
  try {
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    const t = sdlcManager.getTask(taskId);
    if (t && t.evidence) {
      const ev = typeof t.evidence === 'string' ? JSON.parse(t.evidence) : t.evidence;
      if (ev && ev.flow_hash) return ev.flow_hash;
    }
  } catch (_) { /* ignore */ }
  return null;
}

function getMirrorRoots() {
  const home = process.env.HOME || process.env.USERPROFILE || HOME || require('os').homedir();
  const candidates = [
    path.resolve(home, '.agents', 'skills'),
    path.resolve(home, '.gemini', 'antigravity-cli', 'skills'),
    path.resolve(home, '.gemini', 'skills'),
    path.resolve(home, '.cursor', 'skills'),
    path.resolve(home, '.claude', 'skills'),
    path.resolve(home, '.commandcode', 'skills'),
    path.resolve(home, '.codex', 'skills'),
    path.resolve(home, '.config', 'opencode', 'skills'),
    path.resolve(home, '.opencode', 'skills'),
    path.resolve(home, '.pi', 'agent', 'skills'),
    path.resolve(home, '.pi', 'skills'),
    path.resolve(home, '.omp', 'agent', 'skills'),
    path.resolve(home, '.omp', 'skills')
  ];
  const roots = [];
  for (const c of candidates) {
    if (fs.existsSync(c) && !roots.includes(c)) roots.push(c);
  }
  return roots.length > 0 ? roots : [path.resolve(home, '.agents', 'skills')];
}

function _findSubpathInMirror(root, norm, resolvedRoot) {
  const parts = norm.split('/');
  const parentSkill = parts[0];
  const subName = parts.slice(1).join('/');
  const candidatePaths = [
    path.join(root, parentSkill, 'references', `${subName}.md`),
    path.join(root, parentSkill, 'references', subName),
    path.join(root, parentSkill, `${subName}.md`),
    path.join(root, parentSkill, subName, 'SKILL.md'),
    path.join(root, `${norm}.md`),
    path.join(root, norm, 'SKILL.md')
  ];
  for (const cp of candidatePaths) {
    const resolvedPath = path.resolve(cp);
    const rel = path.relative(resolvedRoot, resolvedPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (fs.existsSync(cp) && fs.statSync(cp).isFile()) {
      return { filePath: cp, type: 'reference' };
    }
  }
  return null;
}

function _findTopLevelInMirror(root, norm, resolvedRoot) {
  const candidatePaths = [
    path.join(root, norm, 'SKILL.md'),
    path.join(root, `${norm}.md`),
    path.join(root, norm)
  ];
  for (const cp of candidatePaths) {
    const resolvedPath = path.resolve(cp);
    const rel = path.relative(resolvedRoot, resolvedPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (fs.existsSync(cp) && fs.statSync(cp).isFile()) {
      return { filePath: cp, type: 'skill' };
    }
  }
  try {
    const subs = fs.readdirSync(root, { withFileTypes: true });
    for (const sub of subs) {
      if (!sub.isDirectory()) continue;
      const refPath = path.join(root, sub.name, 'references', `${norm}.md`);
      const resolvedPath = path.resolve(refPath);
      const rel = path.relative(resolvedRoot, resolvedPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      if (fs.existsSync(refPath) && fs.statSync(refPath).isFile()) {
        return { filePath: refPath, type: 'reference' };
      }
    }
  } catch (_) { /* ignore */ }
  return null;
}

function findInMirror(name) {
  const norm = normalizeLegacySkillName(name);
  if (!norm || typeof norm !== 'string') return null;
  if (norm.includes('..') || path.isAbsolute(norm) || /^[a-zA-Z]:/.test(norm)) return null;

  for (const root of getMirrorRoots()) {
    if (!fs.existsSync(root)) continue;
    const resolvedRoot = path.resolve(root);
    const hit = norm.includes('/')
      ? _findSubpathInMirror(root, norm, resolvedRoot)
      : _findTopLevelInMirror(root, norm, resolvedRoot);
    if (hit) return hit;
  }
  return null;
}

function _searchSingleMirrorEntry(entry, root, terms, seen, hits) {
  if (!entry.isDirectory()) return;
  const skillName = entry.name;
  const skillMd = path.join(root, skillName, 'SKILL.md');
  if (!fs.existsSync(skillMd)) return;
  const matchName = skillName.toLowerCase();
  const matches = terms.some(t => matchName.includes(t));
  if (!matches || seen.has(skillName)) return;

  seen.add(skillName);
  try {
    const content = fs.readFileSync(skillMd, 'utf8');
    hits.push({
      name: skillName, skill_name: skillName, type: 'skill', tags: '', content,
      byte_size: Buffer.byteLength(content, 'utf8'), line_count: (content.match(/\n/g) || []).length + 1,
      file_path: skillMd, rank: -0.5
    });
  } catch (_) { /* ignore */ }
}

function searchMirrorSkills(keyword, limit = 5) {
  const terms = String(keyword || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits = [];
  const seen = new Set();

  for (const root of getMirrorRoots()) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        _searchSingleMirrorEntry(entry, root, terms, seen, hits);
        if (hits.length >= limit) return hits;
      }
    } catch (_) { /* ignore */ }
  }
  return hits;
}

const LAST_CALL_TIMES = new Map();

function _getFindSkillBaselineBytes(conn, queryStr) {
  try {
    const words = String(queryStr || '').replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return 15000;
    const lk = '%' + words.join('%') + '%';
    const sumRow = conn.prepare(`
      SELECT COALESCE(SUM(byte_size), 0) as total_matched
      FROM (SELECT byte_size FROM skills WHERE tags LIKE ? OR name LIKE ? OR skill_name LIKE ? LIMIT 5)
    `).get(lk, lk, lk);
    return sumRow?.total_matched > 0 ? Number(sumRow.total_matched) : 15000;
  } catch (_) {
    return 15000;
  }
}

function _extractSkillTarget(queryStr) {
  if (typeof queryStr === 'string' && queryStr.startsWith('{')) {
    try {
      const parsed = JSON.parse(queryStr);
      return parsed.name || queryStr;
    } catch (_) {
      return queryStr;
    }
  }
  return queryStr;
}

function _getGetSkillBaselineBytes(conn, queryStr, returnedBytes) {
  try {
    const skillTarget = _extractSkillTarget(queryStr);
    const sRow = conn.prepare('SELECT byte_size FROM skills WHERE name = ? OR name LIKE ? LIMIT 1').get(skillTarget, `%/${skillTarget}`);
    return sRow?.byte_size ? Number(sRow.byte_size) : returnedBytes;
  } catch (_) {
    return returnedBytes;
  }
}

function _calculateBaselineBytes(conn, toolName, queryStr, returnedBytes, baselineOverride) {
  if (baselineOverride !== null && baselineOverride !== undefined && Number(baselineOverride) > 0) {
    return Math.max(returnedBytes, Number(baselineOverride));
  }
  if (toolName === 'find_skill' || toolName === 'find_skills') {
    return Math.max(returnedBytes, _getFindSkillBaselineBytes(conn, queryStr));
  }
  if (toolName === 'get_skill') {
    return Math.max(returnedBytes, _getGetSkillBaselineBytes(conn, queryStr, returnedBytes));
  }
  if (['list_skills', 'optimize_report'].includes(toolName)) {
    return Math.max(returnedBytes, 35000);
  }
  return returnedBytes;
}

function logToolCall(toolName, queryStr, returnedContent, agentName = null, baselineOverride = null) {
  let conn = null;
  try {
    conn = getDb();
    const returnedBytes = Buffer.byteLength(returnedContent || '', 'utf8');
    const currentTime = Date.now() / 1000;
    const agentKey = (agentName || 'direct').toLowerCase();
    LAST_CALL_TIMES.set(agentKey, currentTime);

    const baselineBytes = _calculateBaselineBytes(conn, toolName, queryStr, returnedBytes, baselineOverride);
    const bytesSaved = Math.max(baselineBytes - returnedBytes, 0);
    const tokensSaved = Math.floor(bytesSaved / 4);
    const clientName = detectActiveClient();

    conn.prepare(`
      INSERT INTO tool_calls (tool, query, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, agent, client)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(toolName, queryStr, returnedBytes, baselineBytes, bytesSaved, tokensSaved, agentName, clientName);
  } catch (_) {
    // Fail silently on logging errors
  } finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* intentional fallback */ }
    }
  }
}

module.exports = {
  USER_AGENTS_YAML,
  MAX_CONTENT_SIZE,
  normalizeLegacySkillName,
  contentHash,
  levenshtein,
  fuzzyResolveSkill,
  smartTruncate,
  extractSnippet,
  extractSectionTitle,
  getServedSkillsSet,
  resolveFlowHashFromTask,
  getMirrorRoots,
  findInMirror,
  searchMirrorSkills,
  logToolCall,
  isOffensiveSkill
};
