'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let yamlUtils;
try {
  yamlUtils = require('../bin/lib/yaml_utils');
} catch (_) {
  try {
    yamlUtils = require('./yaml_utils');
  } catch (_2) {
    yamlUtils = require(path.join(os.homedir(), '.konoha', 'yaml_utils'));
  }
}
const { parseYaml } = yamlUtils;

function seedAgents(conn, logFn = console.log) {
  let templatePath = path.join(__dirname, 'templates', 'agents.yaml');
  if (!fs.existsSync(templatePath)) {
    templatePath = path.resolve(process.cwd(), 'src', 'templates', 'agents.yaml');
  }
  if (!fs.existsSync(templatePath)) {
    templatePath = path.normalize(path.join(os.homedir(), '.agents', 'agents.yaml'));
  }

  if (!fs.existsSync(templatePath)) {
    logFn(`  ✗ Agent template not found: ${templatePath}`);
    return;
  }

  try {
    const content = fs.readFileSync(templatePath, 'utf8');
    const agents = parseYaml(content);
    if (!Array.isArray(agents)) return;

    const stmt = conn.prepare(`
      INSERT OR REPLACE INTO agents (
        name, icon, title, purpose, skills, delegate_when,
        constraints_text, workflow, description, instructions, delegation_keywords, enable_mcp_tools
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = conn.transaction((list) => {
      for (const a of list) {
        const name = a.name;
        if (!name) continue;
        const skillsStr = JSON.stringify(a.skills || []);
        stmt.run(
          name,
          a.icon || null,
          a.title || null,
          a.purpose || null,
          skillsStr,
          a.delegateWhen || a.delegate_when || null,
          a.constraints || a.constraints_text || null,
          a.workflow || null,
          a.description || null,
          a.instructions || null,
          a.delegationKeywords || a.delegation_keywords || null,
          (a.enable_mcp_tools !== undefined ? a.enable_mcp_tools : true) ? 1 : 0
        );
      }
    });

    insertMany(agents);
    logFn(`  ✓ Seeded ${agents.length} agents from template.`);
  } catch (err) {
    logFn(`  ✗ Failed to seed agents: ${err.message}`);
  }
}

function extractTagsFromFrontmatter(content) {
  if (!content) return '';
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return '';

  const frontmatter = match[1];
  const descMatch = frontmatter.match(/description:\s*["']?(.*?)["']?\s*$/m);
  if (!descMatch) return '';

  const description = descMatch[1];
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
    'it', 'its', 'use', 'used', 'using', 'when', 'what', 'how', 'which',
    'who', 'where', 'why', 'not', 'no', 'all', 'any', 'each', 'every',
    'such', 'than', 'too', 'very', 'just', 'only', 'also', 'into',
    'across', 'about', 'up', 'out', 'if', 'then', 'so', 'as'
  ]);

  const words = description.toLowerCase().match(/[a-z0-9_-]+/g) || [];
  const keywords = words.filter(w => !stopWords.has(w) && w.length > 2);

  const seen = new Set();
  const unique = [];
  for (const kw of keywords) {
    if (!seen.has(kw)) {
      seen.add(kw);
      unique.push(kw);
    }
  }

  return unique.slice(0, 30).join(',');
}

function extractTagsFromFilename(filepath, skillName) {
  const basename = path.basename(filepath, path.extname(filepath));
  const parts = basename.split('-');
  return [skillName].concat(parts).join(',');
}

function shieldPromptInjection(content) {
  if (!content) return '';

  const rules = [
    [/#+\s*Global\s+Agent\s+Instructions/gi, '# [NEUTRALIZED] Global Agent Instructions'],
    [/#+\s*User\s+Rules/gi, '# [NEUTRALIZED] User Rules'],
    [/#+\s*Session\s+Startup\s*—\s*Auto-Initialize\s+Team/gi, '# [NEUTRALIZED] Session Startup'],
    [/#+\s*Subagent\s+Definitions/gi, '# [NEUTRALIZED] Subagent Definitions'],
    [/#+\s*Auto-Delegation/gi, '# [NEUTRALIZED] Auto-Delegation'],
    [/#+\s*Tools\s+&\s+Guardrails/gi, '# [NEUTRALIZED] Tools & Guardrails'],
    [/#+\s*@(orchestrator|genin|kage|chunin|jonin|anbu|tokubetsu-jonin)\b/gi, '# [NEUTRALIZED] Subagent Spoof'],
    [/At\s+the\s+START\s+of\s+every\s+session,\s+define\s+the\s+following/gi, '[NEUTRALIZED ACTION] Define subagents'],
    [/The\s+orchestrator\s+MUST\s+follow\s+this\s+workflow/gi, '[NEUTRALIZED ACTION] Orchestrator workflow'],
    [/Every\s+response\s+MUST\s+start\s+with\s+a\s+log\s+line/gi, '[NEUTRALIZED RULE] Start response log']
  ];

  let sanitized = content;
  for (const [pattern, replacement] of rules) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

function optimizeContent(content) {
  if (!content) return '';
  let res = content.replace(/[ \t]+$/gm, '');
  res = res.replace(/\n([ \t]*\n){2,}/g, '\n\n');
  res = shieldPromptInjection(res);
  return res.trim();
}

function normalizeLegacySkillNames(conn) {
  const rows = conn.prepare(
    "SELECT name, skill_name FROM skills WHERE name LIKE 'deep-code-explorer%' OR skill_name = 'deep-code-explorer'"
  ).all();

  let migrated = 0;
  let removed = 0;

  for (const r of rows) {
    const name = r.name;
    const skillName = r.skill_name;
    const newName = name.replace('deep-code-explorer', 'genin-skill');
    const newSkillName = skillName === 'deep-code-explorer' ? 'genin-skill' : skillName;
    const existing = conn.prepare('SELECT 1 FROM skills WHERE name = ?').get(newName);
    if (existing) {
      conn.prepare('DELETE FROM skills WHERE name = ?').run(name);
      removed += 1;
    } else {
      conn.prepare('UPDATE skills SET name = ?, skill_name = ? WHERE name = ?').run(newName, newSkillName, name);
      migrated += 1;
    }
  }

  return {
    migrated,
    removed,
    [Symbol.iterator]: function* () {
      yield migrated;
      yield removed;
    }
  };
}

function verifyRequiredSkills(conn, requiredSkills = []) {
  const required = Array.from(new Set((requiredSkills || []).filter(Boolean))).sort();
  const missing = required.filter(s => !conn.prepare('SELECT 1 FROM skills WHERE name = ?').get(s));
  const legacyRows = conn.prepare(
    "SELECT name FROM skills WHERE name LIKE 'deep-code-explorer%' OR skill_name = 'deep-code-explorer'"
  ).all();
  return { missing, remainingLegacy: legacyRows.map(r => r.name) };
}

function _logSummaryGroup(row, currentSkill, logFn) {
  if (row.skill_name !== currentSkill) {
    if (currentSkill !== null) logFn();
    logFn(`\n📦 ${row.skill_name}`);
  }
  const label = row.type === 'skill' ? 'SKILL.md' : 'references';
  const cnt = row.cnt || 0;
  const bs = row.total_bytes || 0;
  logFn(`   ${label}: ${cnt} file(s), ${bs.toLocaleString()} bytes`);
  return { newSkill: row.skill_name, cnt, bs };
}

function printSummary(conn, options = {}) {
  const dbPath = options.dbPath || '';
  const logFn = options.logFn || console.log;
  const rows = conn.prepare(`
    SELECT skill_name, type, COUNT(*) as cnt, SUM(byte_size) as total_bytes
    FROM skills
    GROUP BY skill_name, type
    ORDER BY skill_name, type DESC
  `).all();

  logFn('\n' + '='.repeat(60));
  logFn('MIGRATION SUMMARY');
  logFn('='.repeat(60));

  let totalRows = 0;
  let totalBytes = 0;
  let currentSkill = null;

  for (const row of rows) {
    const { newSkill, cnt, bs } = _logSummaryGroup(row, currentSkill, logFn);
    currentSkill = newSkill;
    totalRows += cnt;
    totalBytes += bs;
  }

  logFn(`\n${'='.repeat(60)}`);
  logFn(`TOTAL: ${totalRows} entries, ${totalBytes.toLocaleString()} bytes indexed`);
  logFn(`Database: ${dbPath}`);
  const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  logFn(`Database size: ${dbSize.toLocaleString()} bytes`);
  logFn('='.repeat(60));
}

function hasSkillFiles(cand) {
  try {
    if (!fs.existsSync(cand) || !fs.statSync(cand).isDirectory()) return false;
    const entries = fs.readdirSync(cand);
    return entries.some(d => {
      const p = path.join(cand, d);
      try {
        return (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'SKILL.md'))) ||
               (fs.statSync(p).isFile() && d.endsWith('-skill.md'));
      } catch { return false; }
    });
  } catch { return false; }
}

function _isDetectedSkillEntry(entry, skillsDir) {
  const entryPath = path.join(skillsDir, entry);
  try {
    if (!fs.existsSync(entryPath)) return false;
    const st = fs.statSync(entryPath);
    if (st.isDirectory()) {
      const skillMd = path.join(entryPath, 'SKILL.md');
      return fs.existsSync(skillMd) && fs.statSync(skillMd).isFile();
    }
    return st.isFile() && entry.endsWith('-skill.md');
  } catch {
    return false;
  }
}

function autoDetectSkills(skillsDir) {
  const { isEmbeddedReference, isCanonicalSkill } = require('./canonical_skills');
  const detected = [];
  try {
    if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
      return detected;
    }
  } catch {
    return detected;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(skillsDir).sort();
  } catch {
    return detected;
  }

  for (const entry of entries) {
    if (isEmbeddedReference(entry) && !isCanonicalSkill(entry)) continue;
    if (_isDetectedSkillEntry(entry, skillsDir)) {
      detected.push(entry);
    }
  }

  return detected;
}
function parseCliArgs(args) {
  if (args.includes('--help') || args.includes('-h')) {
    return null;
  }
  const options = {
    skillsDir: null,
    skillsDirs: [],
    skills: [],
    dbPath: null,
    clean: false,
    rebuildEmbeddings: false,
    skipEmbeddings: false,
    skillsOnly: false,
    requireSkill: []
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--skills-dir' && i + 1 < args.length) {
      const dirPath = args[++i];
      if (!options.skillsDirs.includes(dirPath)) options.skillsDirs.push(dirPath);
      options.skillsDir = dirPath;
    } else if (a === '--skills') {
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options.skills.push(args[++i]);
      }
    } else if (a === '--db-path' && i + 1 < args.length) {
      options.dbPath = args[++i];
    } else if (a === '--clean') {
      options.clean = true;
    } else if (a === '--rebuild-embeddings') {
      options.rebuildEmbeddings = true;
    } else if (a === '--skip-embeddings') {
      options.skipEmbeddings = true;
    } else if (a === '--skills-only') {
      options.skillsOnly = true;
    } else if (a === '--require-skill' && i + 1 < args.length) {
      options.requireSkill.push(args[++i]);
    }
  }
  return options;
}

module.exports = {
  seedAgents,
  extractTagsFromFrontmatter,
  extractTagsFromFilename,
  shieldPromptInjection,
  optimizeContent,
  normalizeLegacySkillNames,
  verifyRequiredSkills,
  printSummary,
  hasSkillFiles,
  autoDetectSkills,
  parseCliArgs
};
