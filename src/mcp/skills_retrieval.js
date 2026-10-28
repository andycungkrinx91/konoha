'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { getDb } = db;
const { shieldPromptInjection } = require('../migrate');
const {
  isPathVisible
} = require('./runtime_state');
const {
  MAX_CONTENT_SIZE,
  normalizeLegacySkillName,
  contentHash,
  smartTruncate,
  extractSectionTitle,
  getServedSkillsSet,
  resolveFlowHashFromTask,
  findInMirror,
  logToolCall,
  isOffensiveSkill
} = require('./skills_common');
const { autoMigrateProjectSkills, querySkillsByKeyword } = require('./skills_search');

function _sliceSectionContent(rawSections, requestedSection) {
  if (requestedSection) {
    const reqLower = requestedSection.toLowerCase().replace(/^#+/, '').trim();
    const foundIdx = rawSections.findIndex(s => extractSectionTitle(s).toLowerCase().includes(reqLower));
    if (foundIdx !== -1) {
      return {
        finalContent: rawSections[foundIdx],
        remainingSections: rawSections.filter((_, idx) => idx !== foundIdx).map(extractSectionTitle).slice(0, 10)
      };
    }
  }
  return {
    finalContent: rawSections[0],
    remainingSections: rawSections.slice(1).map(extractSectionTitle).slice(0, 10)
  };
}

function _truncateSkillContent(content, normName, tokenBudget, requestedSection) {
  const shielded = shieldPromptInjection(content);
  let finalContent = shielded;
  let truncated = false;
  let remainingSections = [];

  if (tokenBudget > 0 || requestedSection) {
    const maxChars = tokenBudget > 0 ? tokenBudget * 4 : Infinity;
    const rawSections = shielded.split(/\n(?=#{1,3}\s)/);
    if (rawSections.length > 1) {
      const sliced = _sliceSectionContent(rawSections, requestedSection);
      finalContent = sliced.finalContent;
      remainingSections = sliced.remainingSections;
      truncated = remainingSections.length > 0;
      if (truncated) {
        finalContent += `\n\n[+${remainingSections.length} remaining sections: ${remainingSections.map(s => '#' + s).join(', ')}. Pass section parameter to read each.]`;
      }
    } else if (finalContent.length > maxChars) {
      const truncRes = smartTruncate(finalContent, maxChars, normName);
      finalContent = truncRes.text;
      truncated = truncRes.truncated;
    }
  } else if (finalContent.length > MAX_CONTENT_SIZE && normName !== 'konoha/contract' && normName !== 'contract') {
    const truncRes = smartTruncate(finalContent, MAX_CONTENT_SIZE, normName);
    finalContent = truncRes.text;
    truncated = truncRes.truncated;
  }

  return { finalContent, truncated, remainingSections, hash: contentHash(shielded) };
}

function resolveContractRow(normName) {
  if (normName !== 'konoha/contract' && normName !== 'contract') return null;
  try {
    const { getClientContract } = require('../agent_contract');
    const { getActiveClient } = require('./runtime_state');
    const { detectActiveClient } = require('./client_detection');
    const cl = getActiveClient() || detectActiveClient() || 'generic';
    const contractContent = getClientContract(cl);
    return {
      name: 'konoha/contract', skill_name: 'konoha', type: 'reference',
      tags: 'contract,runtime,orchestration', content: contractContent,
      byte_size: Buffer.byteLength(contractContent, 'utf8'),
      line_count: (contractContent.match(/\n/g) || []).length + 1,
      file_path: path.resolve(__dirname, '../agent_contract.js')
    };
  } catch (_) {
    return null;
  }
}

function loadSkillFromMirrorFallback(normName) {
  const mirrorHit = findInMirror(normName);
  if (!mirrorHit) return null;
  try {
    const mirrorContent = fs.readFileSync(mirrorHit.filePath, 'utf8');
    process.stderr.write(`  ⚠️ [get_skill] '${normName}' not found in SQLite database. Retrieved from mirror fallback: ${mirrorHit.filePath}\n`);
    return {
      name: normName, skill_name: normName.split('/')[0], type: mirrorHit.type, tags: '',
      content: mirrorContent, byte_size: Buffer.byteLength(mirrorContent, 'utf8'),
      line_count: (mirrorContent.match(/\n/g) || []).length + 1, file_path: mirrorHit.filePath
    };
  } catch (readErr) {
    process.stderr.write(`  [Warning] Failed to read mirror skill '${normName}': ${readErr.message}\n`);
    return null;
  }
}

function resolveSkillRow(conn, normName) {
  const contractRow = resolveContractRow(normName);
  if (contractRow) return contractRow;

  if (conn) {
    try {
      let row = conn.prepare('SELECT name, skill_name, type, tags, content, byte_size, line_count, file_path FROM skills WHERE name = ?').get(normName) ||
                conn.prepare('SELECT name, skill_name, type, tags, content, byte_size, line_count, file_path FROM skills WHERE name LIKE ? LIMIT 1').get(`%/${normName}`);

      if (row && isPathVisible(row.file_path)) return row;
    } catch (_) {
      // Database query failed (e.g. table not ready) -> fall through to mirror fallback
    }
  }
  return loadSkillFromMirrorFallback(normName);
}

function _safeCloseDb(conn) {
  if (!conn) return;
  try { conn.close(); } catch (_) { /* best-effort */ }
}

function _recordSkillFlow(effFlowHash, skillName, taskId, sessionId) {
  if (!effFlowHash) return;
  try {
    const personaMemory = require('../persona_memory');
    personaMemory.recordFlowSkill(effFlowHash, skillName, taskId, sessionId);
  } catch (_) { /* ignore */ }
}

function getSkill(name, agentName = null, options = {}) {
  if (typeof agentName === 'object' && agentName !== null) {
    options = agentName;
    agentName = options.agentName || options.agent_name || null;
  }
  process.stderr.write(`[mcp konoha] tool_call: get_skill(name='${name}')\n`);
  try { autoMigrateProjectSkills(); } catch (_) { /* ignore */ }

  const normName = normalizeLegacySkillName(name);
  if (isOffensiveSkill(normName) && agentName !== 'akatsuki') {
    process.stderr.write(`  [Authorization] Denied: Skill '${normName}' requires @akatsuki agent authorization.\n`);
    const res = JSON.stringify({ error: `Access restricted: Offensive red-team skill '${normName}' is strictly authorized for the @akatsuki specialist only.` });
    logToolCall('get_skill', normName, res, agentName);
    return res;
  }

  const tokenBudget = options?.tokenBudget || options?.token_budget ? parseInt(options.tokenBudget || options.token_budget, 10) : (typeof options === 'number' ? options : 0);
  const requestedSection = options?.section ? String(options.section).trim() : null;
  const taskId = options?.taskId || options?.task_id || null;
  const sessionId = options?.sessionId || options?.session_id || null;
  const flowHash = options?.flowHash || options?.flow_hash || null;

  const trackingKey = flowHash || taskId || sessionId || 'default_session';
  getServedSkillsSet(trackingKey).add(normName);

  let conn = null;
  try { conn = getDb(); } catch (_) { conn = null; }
  try {
    const row = resolveSkillRow(conn, normName);
    if (!row || !isPathVisible(row.file_path)) {
      process.stderr.write(`  → Skill '${normName}' NOT found or access restricted\n`);
      const res = JSON.stringify({ error: `Skill '${normName}' not found. Use list_skills or find_skill to discover available skills.` });
      logToolCall('get_skill', normName, res, agentName);
      return res;
    }

    process.stderr.write(`  → Retrieved ${row.name} (${row.byte_size} bytes)\n`);
    const { finalContent, truncated, remainingSections, hash } = _truncateSkillContent(row.content || '', normName, tokenBudget, requestedSection);

    const effFlowHash = resolveFlowHashFromTask(flowHash, taskId);
    _recordSkillFlow(effFlowHash, normName, taskId, sessionId);

    const payload = {
      name: row.name, type: row.type, content: finalContent,
      byte_size: Buffer.byteLength(finalContent, 'utf8'),
      line_count: (finalContent.match(/\n/g) || []).length + 1,
      truncated, hash
    };
    if (effFlowHash) payload.flow_hash = effFlowHash;
    if (remainingSections.length > 0) payload.remaining_sections = remainingSections;

    const res = JSON.stringify(payload);
    logToolCall('get_skill', normName, res, agentName, row ? Math.max(Buffer.byteLength(res, 'utf8'), Number(row.byte_size) || 0) : null);
    return res;
  } finally {
    _safeCloseDb(conn);
  }
}

function _parseSkillNames(skillsInput) {
  let normalizedInput = skillsInput;
  if (typeof normalizedInput === 'object' && normalizedInput !== null && !Array.isArray(normalizedInput)) {
    normalizedInput = normalizedInput.skills || normalizedInput.name || normalizedInput.skill || normalizedInput.names;
  }
  if (Array.isArray(normalizedInput)) {
    return normalizedInput.map(s => String(s).trim()).filter(Boolean);
  }
  if (typeof normalizedInput === 'string') {
    return normalizedInput.includes(',')
      ? normalizedInput.split(',').map(s => s.trim()).filter(Boolean)
      : [normalizedInput.trim()].filter(Boolean);
  }
  return [];
}

function _findSkillInDb(conn, normName) {
  if (!conn) return null;
  try {
    let row = conn.prepare('SELECT name, skill_name, type, tags, content, byte_size, line_count, file_path FROM skills WHERE name = ?').get(normName);
    if (!row) {
      row = conn.prepare('SELECT name, skill_name, type, tags, content, byte_size, line_count, file_path FROM skills WHERE name LIKE ? LIMIT 1').get(`%/${normName}`);
    }
    return (row && isPathVisible(row.file_path)) ? row : null;
  } catch (dbErr) {
    process.stderr.write(`[mcp konoha] DB lookup error for '${normName}': ${dbErr.message}\n`);
    return null;
  }
}

function _loadSingleSkill(conn, normName, agentName, allWarnings) {
  if (isOffensiveSkill(normName) && agentName !== 'akatsuki') {
    return { status: 'denied', error: `Access restricted: Offensive red-team skill '${normName}' is strictly authorized for the @akatsuki specialist only.`, source: 'none' };
  }

  const row = _findSkillInDb(conn, normName);
  if (row?.content) {
    process.stderr.write(`  → [use_skills] Retrieved '${normName}' from database (${row.byte_size || row.content.length} bytes)\n`);
    return { content: row.content, skillType: row.type || 'skill', source: 'database', warning: null };
  }

  const warnMsg = `Skill '${normName}' not found in database. Falling back to mirror skills.`;
  process.stderr.write(`  ⚠️ [use_skills] ${warnMsg}\n`);
  allWarnings.push(warnMsg);

  const mirrorHit = findInMirror(normName);
  if (mirrorHit) {
    try {
      const content = fs.readFileSync(mirrorHit.filePath, 'utf8');
      process.stderr.write(`  → [use_skills] Retrieved '${normName}' from mirror: ${mirrorHit.filePath} (${content.length} bytes)\n`);
      return { content, skillType: mirrorHit.type, source: 'mirror_fallback', warning: warnMsg };
    } catch (readErr) {
      const errWarning = `Failed to read mirror skill '${normName}' from ${mirrorHit.filePath}: ${readErr.message}`;
      allWarnings.push(errWarning);
      return { status: 'not_found', error: errWarning, source: 'none' };
    }
  }

  const notFound = `Skill '${normName}' not found in database or mirror skills.`;
  allWarnings.push(notFound);
  return { status: 'not_found', error: notFound, source: 'none' };
}

function _recordFlowSkillsAndEvidence(effFlowHash, taskId, sessionId, loadedSkills) {
  if (!effFlowHash) return;
  const personaMemory = require('../persona_memory');
  for (const ls of loadedSkills) {
    if (ls.status === 'loaded') {
      try { personaMemory.recordFlowSkill(effFlowHash, ls.name, taskId, sessionId); } catch (_) { /* ignore */ }
    }
  }
  if (!taskId) return;
  try {
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    const t = sdlcManager.getTask(taskId);
    if (t?.evidence) {
      const ev = typeof t.evidence === 'string' ? JSON.parse(t.evidence) : t.evidence;
      const active = Array.isArray(ev.active_skills) ? [...ev.active_skills] : [];
      for (const ls of loadedSkills) {
        if (ls.status === 'loaded' && !active.includes(ls.name)) active.push(ls.name);
      }
      ev.active_skills = active;
      sdlcManager.updateTask(taskId, { evidence: ev });
    }
  } catch (_) { /* ignore */ }
}

function useSkills(skillsInput, agentName = null, options = {}) {
  process.stderr.write(`[mcp konoha] tool_call: use_skills(skills=${JSON.stringify(skillsInput)})\n`);
  try { autoMigrateProjectSkills(); } catch (_) { /* ignore */ }

  const skillNames = _parseSkillNames(skillsInput);
  if (skillNames.length === 0) {
    const errRes = JSON.stringify({ error: 'Missing required argument: skills (skill name or array of skill names).' });
    logToolCall('use_skills', '', errRes, agentName);
    return errRes;
  }

  const tokenBudget = options?.tokenBudget || options?.token_budget ? parseInt(options.tokenBudget || options.token_budget, 10) : 0;
  const requestedSection = options?.section ? String(options.section).trim() : null;
  const taskId = options?.taskId || options?.task_id || null;
  const sessionId = options?.sessionId || options?.session_id || null;
  const flowHash = options?.flowHash || options?.flow_hash || null;

  const trackingKey = flowHash || taskId || sessionId || 'default_session';
  for (const name of skillNames) getServedSkillsSet(trackingKey).add(normalizeLegacySkillName(name));

  const loadedSkills = [];
  const allWarnings = [];
  let conn = null;
  try { conn = getDb(); } catch (err) { allWarnings.push(`Database connection failed: ${err.message}. Falling back to mirror skills.`); }

  for (const rawName of skillNames) {
    const normName = normalizeLegacySkillName(rawName);
    const loaded = _loadSingleSkill(conn, normName, agentName, allWarnings);
    if (!loaded.content) {
      loadedSkills.push({ name: normName, status: loaded.status || 'not_found', error: loaded.error, source: loaded.source || 'none' });
      continue;
    }

    const { finalContent, truncated, remainingSections, hash } = _truncateSkillContent(loaded.content, normName, tokenBudget, requestedSection);
    const item = {
      name: normName, type: loaded.skillType, status: 'loaded', source: loaded.source,
      content: finalContent, byte_size: Buffer.byteLength(finalContent, 'utf8'),
      line_count: (finalContent.match(/\n/g) || []).length + 1, truncated, hash
    };
    if (loaded.warning) item.warning = loaded.warning;
    if (remainingSections.length > 0) item.remaining_sections = remainingSections;
    loadedSkills.push(item);
  }

  if (conn) {
    try { conn.close(); } catch (_) { /* ignore */ }
  }

  const effFlowHash = resolveFlowHashFromTask(flowHash, taskId);
  _recordFlowSkillsAndEvidence(effFlowHash, taskId, sessionId, loadedSkills);

  const resPayload = (skillNames.length === 1 && loadedSkills.length === 1)
    ? { ...loadedSkills[0], skills: loadedSkills, warnings: allWarnings }
    : { status: loadedSkills.some(s => s.status === 'loaded') ? 'success' : 'failed', skills: loadedSkills, warnings: allWarnings };
  if (effFlowHash) resPayload.flow_hash = effFlowHash;

  const resStr = JSON.stringify(resPayload);
  logToolCall('use_skills', skillNames.join(','), resStr, agentName);
  return resStr;
}

function _extractHeadingsAndSummary(lines) {
  const headings = [];
  let summary = '';
  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.startsWith('#')) {
      const h = stripped.replace(/^#+/, '').trim();
      if (h && h.length > 2) {
        const level = stripped.length - stripped.replace(/^#+/, '').length;
        headings.push(`${'  '.repeat(Math.max(0, level - 1))}- ${h}`);
      }
    } else if (!summary && stripped && !stripped.startsWith('```') && !stripped.startsWith('|') && !stripped.startsWith('-')) {
      summary = stripped.substring(0, 200);
    }
  }
  return { headings: headings.slice(0, 15), summary };
}

function optimizeReport(keyword = null, agentName = null) {
  process.stderr.write(`[mcp konoha] tool_call: optimize_report(keyword='${keyword}')\n`);
  const conn = getDb();
  try {
    const rows = keyword ? querySkillsByKeyword(conn, keyword, 10) : conn.prepare(`
      SELECT name, skill_name, type, tags,
             content, byte_size, line_count, file_path,
             0 AS rank
      FROM skills
      ORDER BY skill_name, type DESC
      LIMIT 20
    `).all();

    const visibleRows = rows.filter(r => isPathVisible(r.file_path));
    const reports = [];

    for (const row of visibleRows) {
      const content = shieldPromptInjection(row.content || '');
      const lines = content.split(/\r?\n/);
      const { headings, summary } = _extractHeadingsAndSummary(lines);
      const byteSize = Buffer.byteLength(content, 'utf8');
      reports.push({
        name: row.name,
        type: row.type,
        byte_size: byteSize,
        estimated_tokens: Math.floor(byteSize / 4),
        headings,
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

module.exports = {
  getSkill,
  useSkills,
  optimizeReport
};
