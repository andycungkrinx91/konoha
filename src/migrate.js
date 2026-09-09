#!/usr/bin/env node
/**
 * Skills Migration Engine (v1.1.0 — Enhanced Token Optimization)
 * Pure Node.js replacement for migrate.py using better-sqlite3 and yaml_utils.
 * Migrates skill content from ~/.agents/skills/ into SQLite FTS5 database.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const db = require('./db');

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

let DB_PATH = db.DB_PATH;
let SKILLS_DIR = path.normalize(path.join(os.homedir(), '.agents', 'skills'));

const CUSTOM_SKILLS = [
  "anbu-skill",
  "chunin-skill",
  "genin-skill",
  "jonin-skill",
  "kage-skill",
  "konoha",
  "tokubetsu-jonin-skill",
];

function log(...args) {
  if (process.env.ACTIVE_CLIENT || process.env.KONOHA_CLIENT || require.main !== module) {
    process.stderr.write(args.map(a => (typeof a === "object" && a !== null) ? JSON.stringify(a) : String(a)).join(" ") + "\n");
  } else {
    console.log(...args);
  }
}

function seedAgents(conn) {
  let templatePath = path.join(__dirname, "templates", "agents.yaml");
  if (!fs.existsSync(templatePath)) {
    templatePath = path.resolve(process.cwd(), "src", "templates", "agents.yaml");
  }
  if (!fs.existsSync(templatePath)) {
    templatePath = path.normalize(path.join(os.homedir(), ".agents", "agents.yaml"));
  }

  if (!fs.existsSync(templatePath)) {
    log(`  ✗ Agent template not found: ${templatePath}`);
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
    log(`  ✓ Seeded ${agents.length} agents from template.`);
  } catch (err) {
    log(`  ✗ Failed to seed agents: ${err.message}`);
  }
}

function setupDb(dbPath = null) {
  if (dbPath && typeof dbPath === 'object' && typeof dbPath.prepare === 'function') {
    db.setupSchema(dbPath);
    return dbPath;
  }
  const targetPath = dbPath !== null ? dbPath : DB_PATH;
  const conn = db.getConnection(targetPath, false);
  db.setupSchema(conn);
  return conn;
}

function extractTagsFromFrontmatter(content) {
  if (!content) return "";
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return "";

  const frontmatter = match[1];
  const descMatch = frontmatter.match(/description:\s*["']?(.*?)["']?\s*$/m);
  if (!descMatch) return "";

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

  return unique.slice(0, 30).join(",");
}

function extractTagsFromFilename(filepath, skillName) {
  const basename = path.basename(filepath, path.extname(filepath));
  const parts = basename.split("-");
  return [skillName].concat(parts).join(",");
}

function shieldPromptInjection(content) {
  if (!content) return "";

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
  if (!content) return "";

  // 1. Strip trailing whitespace per line
  let res = content.replace(/[ \t]+$/gm, '');

  // 2. Collapse 3+ consecutive blank lines -> 1 blank line
  res = res.replace(/\n([ \t]*\n){2,}/g, '\n\n');

  // 3. Shield against prompt injections
  res = shieldPromptInjection(res);

  // 4. Strip leading/trailing whitespace from entire content
  return res.trim();
}

function contentMd5(content) {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex').substring(0, 12);
}

function migrateSkill(conn, skillName, skillsOnly = false, skillsDir = SKILLS_DIR) {
  // Check if skillName is a flat file
  if (skillName.endsWith(".md")) {
    const skillNameClean = path.basename(skillName, ".md");
    const filePath = path.join(skillsDir, skillName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      log(`  ✗ File not found: ${filePath}`);
      return 0;
    }

    try {
      conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ? OR skill_name IN (SELECT name FROM skills WHERE skill_name = ?)").run(skillNameClean, skillNameClean);
    } catch (_) {}
    conn.prepare("DELETE FROM skills WHERE skill_name = ?").run(skillNameClean);

    const rawContent = fs.readFileSync(filePath, 'utf8');
    const tags = extractTagsFromFrontmatter(rawContent);
    const content = optimizeContent(rawContent);
    const byteSize = Buffer.byteLength(content, 'utf8');
    const rawSize = Buffer.byteLength(rawContent, 'utf8');
    const lineCount = (content.match(/\n/g) || []).length + 1;
    const pct = rawSize > 0 ? ((rawSize - byteSize) / rawSize * 100) : 0;

    conn.prepare("DELETE FROM skills WHERE name = ?").run(skillNameClean);
    conn.prepare(
      "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(skillNameClean, skillNameClean, "skill", tags, content, filePath, byteSize, lineCount);

    log(`  ✓ ${skillName} (${rawSize.toLocaleString()} → ${byteSize.toLocaleString()} bytes, optimized ${pct.toFixed(1)}%)`);
    return 1;
  }

  const skillDir = path.join(skillsDir, skillName);
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    log(`  ✗ Directory not found: ${skillDir}`);
    return 0;
  }

  try {
    conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ? OR skill_name IN (SELECT name FROM skills WHERE skill_name = ?)").run(skillName, skillName);
  } catch (_) {}
  conn.prepare("DELETE FROM skills WHERE skill_name = ?").run(skillName);

  let count = 0;

  // 1. Migrate SKILL.md
  const skillMd = path.join(skillDir, "SKILL.md");
  if (fs.existsSync(skillMd) && fs.statSync(skillMd).isFile()) {
    const rawContent = fs.readFileSync(skillMd, 'utf8');
    const tags = extractTagsFromFrontmatter(rawContent);
    const content = optimizeContent(rawContent);
    const byteSize = Buffer.byteLength(content, 'utf8');
    const rawSize = Buffer.byteLength(rawContent, 'utf8');
    const lineCount = (content.match(/\n/g) || []).length + 1;
    const pct = rawSize > 0 ? ((rawSize - byteSize) / rawSize * 100) : 0;

    conn.prepare("DELETE FROM skills WHERE name = ?").run(skillName);
    conn.prepare(
      "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(skillName, skillName, "skill", tags, content, skillMd, byteSize, lineCount);

    log(`  ✓ SKILL.md (${rawSize.toLocaleString()} → ${byteSize.toLocaleString()} bytes, optimized ${pct.toFixed(1)}%)`);
    count += 1;
  }

  // 2. Migrate references/*.md
  const refsDir = path.join(skillDir, "references");
  if (skillsOnly && fs.existsSync(refsDir) && fs.statSync(refsDir).isDirectory()) {
    const mdFiles = fs.readdirSync(refsDir).filter(f => f.endsWith(".md"));
    if (mdFiles.length) {
      log(`  ⏭ References deferred (--skills-only): ${mdFiles.length} files skipped`);
    }
  } else if (fs.existsSync(refsDir) && fs.statSync(refsDir).isDirectory()) {
    const refFiles = fs.readdirSync(refsDir).filter(f => f.endsWith(".md")).sort();
    for (const file of refFiles) {
      const refPath = path.join(refsDir, file);
      const refNameRaw = path.basename(file, ".md");
      const refKey = `${skillName}/${refNameRaw}`;

      const rawContent = fs.readFileSync(refPath, 'utf8');
      const tags = extractTagsFromFilename(refPath, skillName);
      const content = optimizeContent(rawContent);
      const byteSize = Buffer.byteLength(content, 'utf8');
      const rawSize = Buffer.byteLength(rawContent, 'utf8');
      const lineCount = (content.match(/\n/g) || []).length + 1;
      const pct = rawSize > 0 ? ((rawSize - byteSize) / rawSize * 100) : 0;

      conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(refKey);
      conn.prepare("DELETE FROM skills WHERE name = ?").run(refKey);
      conn.prepare(
        "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(refKey, skillName, "reference", tags, content, refPath, byteSize, lineCount);

      log(`  ✓ references/${refNameRaw}.md (${rawSize.toLocaleString()} → ${byteSize.toLocaleString()} bytes, optimized ${pct.toFixed(1)}%)`);
      count += 1;
    }
  }

  // 3. Migrate other .md files in root of skill directory
  const excludeFilenames = new Set(["skill.md", "readme.md", "license.md", "changelog.md"]);
  const rootMdFiles = fs.readdirSync(skillDir).filter(f => f.endsWith(".md")).sort();

  if (skillsOnly) {
    const deferredRoot = rootMdFiles.filter(f => !excludeFilenames.has(f.toLowerCase()));
    if (deferredRoot.length) {
      log(`  ⏭ Root references deferred (--skills-only): ${deferredRoot.length} files skipped`);
    }
  } else {
    for (const filename of rootMdFiles) {
      if (excludeFilenames.has(filename.toLowerCase())) continue;

      const filePath = path.join(skillDir, filename);
      const refNameRaw = path.basename(filename, ".md");
      const refKey = `${skillName}/${refNameRaw}`;

      const rawContent = fs.readFileSync(filePath, 'utf8');
      const tags = extractTagsFromFilename(filePath, skillName);
      const content = optimizeContent(rawContent);
      const byteSize = Buffer.byteLength(content, 'utf8');
      const rawSize = Buffer.byteLength(rawContent, 'utf8');
      const lineCount = (content.match(/\n/g) || []).length + 1;
      const pct = rawSize > 0 ? ((rawSize - byteSize) / rawSize * 100) : 0;

      conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(refKey);
      conn.prepare("DELETE FROM skills WHERE name = ?").run(refKey);
      conn.prepare(
        "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(refKey, skillName, "reference", tags, content, filePath, byteSize, lineCount);

      log(`  ✓ ${filename} (${rawSize.toLocaleString()} → ${byteSize.toLocaleString()} bytes, optimized ${pct.toFixed(1)}%) [root reference]`);
      count += 1;
    }
  }

  return count;
}

function migrateSingleSkill(skillName, skillsDir = SKILLS_DIR, conn = null) {
  let closeConn = false;
  if (!conn) {
    conn = setupDb();
    closeConn = true;
  }
  try {
    return migrateSkill(conn, skillName, false, skillsDir);
  } finally {
    if (closeConn) {
      conn.close();
    }
  }
}

function migrate_skills(args = {}) {
  const force = !!args.force;
  let skills = args.skills;
  let skillsDir = args.skills_dir || SKILLS_DIR;
  if (typeof skills === 'string') {
    try { skills = JSON.parse(skills); } catch (_) { skills = [skills]; }
  }
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
    return { status: "error", message: `Skills directory not found: ${skillsDir}` };
  }
  const conn = setupDb();
  try {
    if (!skills || skills.length === 0) {
      skills = autoDetectSkills(skillsDir);
    }
    let total = 0;
    const migrated = [];
    for (const s of skills) {
      const count = migrateSkill(conn, s, false, skillsDir);
      total += count;
      migrated.push(s);
    }
    normalizeLegacySkillNames(conn);
    const row = conn.prepare("SELECT COUNT(*) as count FROM skills").get();
    const count = row ? row.count : 0;
    return {
      status: "ok",
      migrated,
      total_skills_migrated: total,
      total_entries_in_db: count,
      skills_dir: skillsDir
    };
  } finally {
    conn.close();
  }
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
    const newName = name.replace("deep-code-explorer", "genin-skill");
    const newSkillName = skillName === "deep-code-explorer" ? "genin-skill" : skillName;
    const existing = conn.prepare("SELECT 1 FROM skills WHERE name = ?").get(newName);
    if (existing) {
      conn.prepare("DELETE FROM skills WHERE name = ?").run(name);
      removed += 1;
    } else {
      conn.prepare("UPDATE skills SET name = ?, skill_name = ? WHERE name = ?").run(newName, newSkillName, name);
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
  const missing = required.filter(s => !conn.prepare("SELECT 1 FROM skills WHERE name = ?").get(s));
  const legacyRows = conn.prepare(
    "SELECT name FROM skills WHERE name LIKE 'deep-code-explorer%' OR skill_name = 'deep-code-explorer'"
  ).all();
  return { missing, remainingLegacy: legacyRows.map(r => r.name) };
}

function printSummary(conn) {
  const rows = conn.prepare(`
    SELECT skill_name, type, COUNT(*) as cnt, SUM(byte_size) as total_bytes
    FROM skills
    GROUP BY skill_name, type
    ORDER BY skill_name, type DESC
  `).all();

  log("\n" + "=".repeat(60));
  log("MIGRATION SUMMARY");
  log("=".repeat(60));

  let totalRows = 0;
  let totalBytes = 0;
  let currentSkill = null;

  for (const row of rows) {
    if (row.skill_name !== currentSkill) {
      if (currentSkill !== null) {
        log();
      }
      currentSkill = row.skill_name;
      log(`\n📦 ${currentSkill}`);
    }

    const label = row.type === "skill" ? "SKILL.md" : "references";
    const cnt = row.cnt || 0;
    const bs = row.total_bytes || 0;
    log(`   ${label}: ${cnt} file(s), ${bs.toLocaleString()} bytes`);
    totalRows += cnt;
    totalBytes += bs;
  }

  log(`\n${"=".repeat(60)}`);
  log(`TOTAL: ${totalRows} entries, ${totalBytes.toLocaleString()} bytes indexed`);
  log(`Database: ${DB_PATH}`);
  const dbSize = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
  log(`Database size: ${dbSize.toLocaleString()} bytes`);
  log("=".repeat(60));
}

function autoDetectSkills(skillsDir) {
  const detected = [];
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
    return detected;
  }

  const entries = fs.readdirSync(skillsDir).sort();
  for (const entry of entries) {
    const entryPath = path.join(skillsDir, entry);
    if (fs.statSync(entryPath).isDirectory()) {
      const skillMd = path.join(entryPath, "SKILL.md");
      if (fs.existsSync(skillMd) && fs.statSync(skillMd).isFile()) {
        detected.push(entry);
      }
    } else if (fs.statSync(entryPath).isFile() && entry.endsWith("-skill.md")) {
      detected.push(entry);
    }
  }
  return detected;
}

async function runMigration(options = {}) {
  if (options.skillsDir) {
    SKILLS_DIR = path.resolve(options.skillsDir);
  } else {
    const defaultDir = path.normalize(path.join(os.homedir(), ".agents", "skills"));
    let hasSkills = false;
    if (fs.existsSync(defaultDir) && fs.statSync(defaultDir).isDirectory()) {
      try {
        const entries = fs.readdirSync(defaultDir);
        hasSkills = entries.some(d => {
          const p = path.join(defaultDir, d);
          return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "SKILL.md"));
        });
      } catch (_) {}
    }

    if (!hasSkills) {
      const localDir = path.resolve(process.cwd(), ".agents", "skills");
      if (fs.existsSync(localDir) && fs.statSync(localDir).isDirectory()) {
        SKILLS_DIR = localDir;
      } else {
        SKILLS_DIR = defaultDir;
      }
    } else {
      SKILLS_DIR = defaultDir;
    }
  }

  if (options.dbPath) {
    DB_PATH = path.resolve(options.dbPath);
  }

  let skillsToMigrate = [];
  if (options.skills && options.skills.length) {
    skillsToMigrate = options.skills;
  } else {
    const detected = autoDetectSkills(SKILLS_DIR);
    skillsToMigrate = detected.length ? detected : CUSTOM_SKILLS;
  }

  const requiredSet = new Set(options.requireSkill || []);
  skillsToMigrate.sort((a, b) => {
    const aReq = requiredSet.has(a) ? 0 : 1;
    const bReq = requiredSet.has(b) ? 0 : 1;
    if (aReq !== bReq) return aReq - bReq;
    return a.localeCompare(b);
  });

  let timeBudget = 150.0;
  if (process.env.KONOHA_MIGRATE_TIME_BUDGET) {
    const parsed = parseFloat(process.env.KONOHA_MIGRATE_TIME_BUDGET);
    if (!isNaN(parsed)) timeBudget = parsed;
  }

  const startTime = Date.now();
  let deferredSkills = 0;

  log("🚀 Skills Migration to SQLite FTS5 (v1.1.0 — Enhanced Optimization)");
  log(`   Source: ${SKILLS_DIR}`);
  log(`   Target: ${DB_PATH}`);
  log(`   Skills: ${skillsToMigrate.join(', ')}\n`);

  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const conn = setupDb(DB_PATH);
  seedAgents(conn);

  if (options.clean) {
    log("🧹 Purging existing skills from database...");
    try {
      conn.prepare("DELETE FROM skill_chunks").run();
    } catch (_) {}
    conn.prepare("DELETE FROM skills").run();
  }

  let total = 0;
  for (const skillName of skillsToMigrate) {
    if (!requiredSet.has(skillName) && timeBudget > 0 && ((Date.now() - startTime) / 1000) > timeBudget) {
      deferredSkills += 1;
      continue;
    }
    log(`\n📦 Migrating: ${skillName}`);
    const count = migrateSkill(conn, skillName, options.skillsOnly);
    total += count;
  }

  if (deferredSkills) {
    log(`\n  ⏭ Time budget reached; ${deferredSkills} skills deferred to on-demand indexing`);
  }

  const { migrated: migratedLegacy, removed: removedLegacy } = normalizeLegacySkillNames(conn);
  if (migratedLegacy || removedLegacy) {
    log(`  Canonicalized legacy skill rows: ${migratedLegacy} migrated, ${removedLegacy} duplicates removed.`);
  }

  const { missing: missingRequired, remainingLegacy } = verifyRequiredSkills(conn, options.requireSkill);
  if (missingRequired.length || remainingLegacy.length) {
    if (missingRequired.length) {
      log(`  ✗ Required canonical skills missing: ${missingRequired.join(', ')}`);
    }
    if (remainingLegacy.length) {
      log(`  ✗ Legacy skill rows remain: ${remainingLegacy.join(', ')}`);
    }
    conn.close();
    process.exit(1);
  }

  // Clean up deleted skills
  const rows = conn.prepare("SELECT DISTINCT skill_name FROM skills").all();
  const deletedSkills = new Set();
  for (const r of rows) {
    const sName = r.skill_name;
    const fpRows = conn.prepare("SELECT file_path FROM skills WHERE skill_name = ? AND file_path IS NOT NULL").all(sName);
    const anyExists = fpRows.some(fp => fp.file_path && fs.existsSync(fp.file_path));
    if (!anyExists && fpRows.length) {
      deletedSkills.add(sName);
    }
  }

  if (deletedSkills.size) {
    log("\n🗑️  Cleaning up deleted skills from database:");
    for (const sName of Array.from(deletedSkills).sort()) {
      conn.prepare("DELETE FROM skills WHERE skill_name = ?").run(sName);
      log(`  ✓ Cleaned up: ${sName}`);
    }
  }

  // Verify FTS index
  log("\n🔍 Verifying FTS index...");
  for (const testWord of ['security', 'terraform', 'svelte']) {
    try {
      const result = conn.prepare("SELECT COUNT(*) as cnt FROM skills_fts WHERE skills_fts MATCH ?").get(testWord);
      log(`   FTS test query '${testWord}': ${result ? result.cnt : 0} matches`);
    } catch (_) {
      log(`   FTS test query '${testWord}': skipped (no matches)`);
    }
  }

  // Vector embeddings hook
  let semanticEnabled = true;
  try {
    const vectorSearch = require('./vector_search');
    if (vectorSearch.isSemanticSearchEnabled) {
      semanticEnabled = vectorSearch.isSemanticSearchEnabled();
    }
  } catch (_) {}

  const shouldEmbed = !options.skipEmbeddings && (semanticEnabled || options.rebuildEmbeddings);
  if (shouldEmbed) {
    try {
      const vectorSearch = require('./vector_search');
      if (typeof vectorSearch.backfillAllEmbeddings === 'function') {
        log("\n⚡ Pre-caching neural models across platforms (IBM Granite + GTE Reranker)...");
        if (typeof vectorSearch.predownloadAllModels === 'function') {
          await vectorSearch.predownloadAllModels(false);
        }
        log("⚡ Synchronizing vector embeddings (IBM Granite Multilingual)...");
        const chunksIndexed = await vectorSearch.backfillAllEmbeddings(conn, options.rebuildEmbeddings);
        log(`   Vector index synchronized: ${chunksIndexed} chunks processed.`);
      }
    } catch (e) {
      log(`   ⚠ Vector embedding generation deferred/skipped: ${e.message}`);
    }
  }

  printSummary(conn);
  conn.close();
  log(`\n✅ Migration complete! ${total} entries indexed.`);
}


async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: migrate.js [options]');
    console.log('Options:');
    console.log('  --skills-dir <dir>       Path to skills directory');
    console.log('  --db-path <path>         Path to SQLite database');
    console.log('  --clean                  Clean existing database tables before migrating');
    console.log('  --skills <skills...>     Specific skills to migrate');
    console.log('  --skills-only            Only migrate SKILL.md entries, defer references');
    console.log('  --skip-embeddings        Skip generating neural embeddings');
    console.log('  --rebuild-embeddings     Rebuild embeddings for all skill chunks');
    console.log('  --require-skill <skill>  Require specific skills');
    console.log('  --help, -h               Show this help message');
    return;
  }
  const options = {
    skillsDir: null,
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
      options.skillsDir = args[++i];
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

  await runMigration(options);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  migrate: runMigration,
  runMigration,
  migrateSkill,
  migrateSingleSkill,
  migrate_skills,
  optimizeContent,
  extractTagsFromFrontmatter,
  extractTagsFromFilename,
  shieldPromptInjection,
  autoDetectSkills,
  setupDb,
  seedAgents,
  printSummary,
  normalizeLegacySkillNames,
  normalize_legacy_skill_names: normalizeLegacySkillNames,
  verifyRequiredSkills,
  verify_required_skills: verifyRequiredSkills
};
