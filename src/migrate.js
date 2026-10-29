#!/usr/bin/env node
/**
 * Skills Migration Engine (v1.1.0 — Enhanced Token Optimization)
 * Pure Node.js replacement for migrate.py using the node:sqlite driver and yaml_utils.
 * Migrates skill content from ~/.agents/skills/ into SQLite FTS5 database.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db');
const {
  seedAgents: seedAgentsHelper,
  extractTagsFromFrontmatter,
  extractTagsFromFilename,
  shieldPromptInjection,
  optimizeContent,
  printSummary: printSummaryHelper,
  hasSkillFiles,
  autoDetectSkills,
  parseCliArgs
} = require('./migrate_helpers');

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

const { isEmbeddedReference, isCanonicalSkill } = require('./canonical_skills');

let DB_PATH = db.DB_PATH;
let SKILLS_DIR = path.normalize(path.join(os.homedir(), '.agents', 'skills'));

const CUSTOM_SKILLS = [
  "akatsuki-skill",
  "anbu-skill",
  "chunin-skill",
  "genin-skill",
  "jonin-skill",
  "kage-skill",
  "konoha",
  "sannin-skill",
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
  return seedAgentsHelper(conn, log);
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


function _migrateFlatSkillFile(conn, skillName, skillsDir) {
  const skillNameClean = path.basename(skillName, ".md");
  const filePath = path.join(skillsDir, skillName);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    log(`  ✗ File not found: ${filePath}`);
    return 0;
  }

  try {
    conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ? OR skill_name IN (SELECT name FROM skills WHERE skill_name = ?)").run(skillNameClean, skillNameClean);
  } catch (_) { /* intentional best-effort fallback */ }
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

function _migrateSkillMd(conn, skillDir, skillName) {
  const skillMd = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillMd) || !fs.statSync(skillMd).isFile()) return 0;

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
  return 1;
}

function _parseCyberSkillFrontmatter(rawContent) {
  const extraTags = [];
  if (!rawContent.startsWith('---')) return extraTags;
  const endIdx = rawContent.indexOf('---', 3);
  if (endIdx <= 3) return extraTags;

  const fm = rawContent.slice(3, endIdx);
  const tagMatches = fm.match(/tags:\s*([\s\S]*?)(?=\n[a-z_]+:|$)/i);
  if (tagMatches) {
    extraTags.push(...tagMatches[1].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean));
  }
  const mitreMatches = fm.match(/mitre_attack:\s*([\s\S]*?)(?=\n[a-z_]+:|$)/i);
  if (mitreMatches) {
    extraTags.push(...mitreMatches[1].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean));
  }
  const domainMatch = fm.match(/domain:\s*["']?(.*?)["']?\s*$/m);
  if (domainMatch && domainMatch[1]) extraTags.push(domainMatch[1]);
  const subDomainMatch = fm.match(/subdomain:\s*["']?(.*?)["']?\s*$/m);
  if (subDomainMatch && subDomainMatch[1]) extraTags.push(subDomainMatch[1]);
  return extraTags;
}

function _migrateCyberSkills(conn, refsDir, skillName, skillsOnly) {
  const cyberSkillsDir = path.join(refsDir, "anthropic-cybersecurity-skills-assets", "skills");
  if (skillsOnly || !fs.existsSync(cyberSkillsDir) || !fs.statSync(cyberSkillsDir).isDirectory()) {
    return 0;
  }
  const subSkills = fs.readdirSync(cyberSkillsDir).sort();
  let cyberCount = 0;
  let totalCyberBytes = 0;
  const deleteSkill = conn.prepare("DELETE FROM skills WHERE name = ?");
  const insertSkill = conn.prepare(
    "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const cyberBatch = conn.transaction((list) => {
    for (const sub of list) {
      const subSkillMd = path.join(cyberSkillsDir, sub, "SKILL.md");
      if (!fs.existsSync(subSkillMd)) continue;

      const rawContent = fs.readFileSync(subSkillMd, 'utf8');
      const refKey = `${skillName}/${sub}`;
      const extraTags = _parseCyberSkillFrontmatter(rawContent);
      const baseTags = [skillName, 'cybersecurity', 'pentest', 'red-team', sub.replace(/-/g, ' ')];
      const allTags = Array.from(new Set([...baseTags, ...extraTags])).join(',');

      const content = optimizeContent(rawContent);
      const byteSize = Buffer.byteLength(content, 'utf8');
      const lineCount = (content.match(/\n/g) || []).length + 1;

      try {
        conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(refKey);
      } catch (_) { /* best-effort cleanup */ }
      deleteSkill.run(refKey);
      insertSkill.run(refKey, skillName, "reference", allTags, content, subSkillMd, byteSize, lineCount);
      cyberCount += 1;
      totalCyberBytes += byteSize;
    }
  });

  cyberBatch(subSkills);
  log(`  ✓ anthropic-cybersecurity-skills-assets: ${cyberCount} structured cybersecurity skills migrated & indexed (${(totalCyberBytes / 1024 / 1024).toFixed(2)} MB)`);
  return cyberCount;
}

function _migrateReferences(conn, skillDir, skillName, skillsOnly) {
  const refsDir = path.join(skillDir, "references");
  if (!fs.existsSync(refsDir) || !fs.statSync(refsDir).isDirectory()) return 0;

  if (skillsOnly) {
    const mdFiles = fs.readdirSync(refsDir).filter(f => f.endsWith(".md"));
    if (mdFiles.length) {
      log(`  ⏭ References deferred (--skills-only): ${mdFiles.length} files skipped`);
    }
    return 0;
  }

  let count = 0;
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

    try {
      conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(refKey);
    } catch (_) { /* intentional best-effort fallback */ }
    conn.prepare("DELETE FROM skills WHERE name = ?").run(refKey);
    conn.prepare(
      "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(refKey, skillName, "reference", tags, content, refPath, byteSize, lineCount);

    log(`  ✓ references/${refNameRaw}.md (${rawSize.toLocaleString()} → ${byteSize.toLocaleString()} bytes, optimized ${pct.toFixed(1)}%)`);
    count += 1;
  }

  count += _migrateCyberSkills(conn, refsDir, skillName, skillsOnly);
  return count;
}

function _migrateRootReferences(conn, skillDir, skillName, skillsOnly) {
  const excludeFilenames = new Set(["skill.md", "readme.md", "license.md", "changelog.md"]);
  const rootMdFiles = fs.readdirSync(skillDir).filter(f => f.endsWith(".md")).sort();

  if (skillsOnly) {
    const deferredRoot = rootMdFiles.filter(f => !excludeFilenames.has(f.toLowerCase()));
    if (deferredRoot.length) {
      log(`  ⏭ Root references deferred (--skills-only): ${deferredRoot.length} files skipped`);
    }
    return 0;
  }

  let count = 0;
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

    conn.prepare("DELETE FROM skills WHERE name = ?").run(refKey);
    conn.prepare(
      "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(refKey, skillName, "reference", tags, content, filePath, byteSize, lineCount);

    log(`  ✓ ${filename} (${rawSize.toLocaleString()} → ${byteSize.toLocaleString()} bytes, optimized ${pct.toFixed(1)}%) [root reference]`);
    count += 1;
  }
  return count;
}

function migrateSkill(conn, skillName, skillsOnly = false, skillsDir = SKILLS_DIR) {
  if (isEmbeddedReference(skillName) && !isCanonicalSkill(skillName)) {
    log(`  ⏭ Skill '${skillName}' is already an embedded reference in a ninja skill (skipped standalone indexing)`);
    return 0;
  }

  if (skillName.endsWith(".md")) {
    return _migrateFlatSkillFile(conn, skillName, skillsDir);
  }

  const skillDir = path.join(skillsDir, skillName);
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    log(`  ✗ Directory not found: ${skillDir}`);
    return 0;
  }

  try {
    conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ? OR skill_name LIKE ?").run(skillName, `${skillName}/%`);
  } catch (_) { /* intentional best-effort fallback */ }
  conn.prepare("DELETE FROM skills WHERE skill_name = ?").run(skillName);

  let count = _migrateSkillMd(conn, skillDir, skillName);
  count += _migrateReferences(conn, skillDir, skillName, skillsOnly);
  count += _migrateRootReferences(conn, skillDir, skillName, skillsOnly);
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

function printSummary(conn) {
  return printSummaryHelper(conn, { dbPath: DB_PATH, logFn: log });
}

function _resolveCandidateSkillRoots(globalSkillsDir) {
  const candidateRoots = [
    globalSkillsDir,
    path.resolve(process.cwd(), ".agents", "skills"),
    path.resolve(process.cwd(), ".cursor", "skills"),
    path.resolve(process.cwd(), ".gemini", "skills"),
    path.resolve(process.cwd(), ".commandcode", "skills"),
    path.resolve(process.cwd(), ".claude", "skills"),
    path.resolve(process.cwd(), ".omp", "skills"),
    path.resolve(process.cwd(), ".config", "opencode", "skills"),
    path.resolve(process.cwd(), ".opencode", "skills"),
    path.resolve(process.cwd(), "skills"),
    path.resolve(process.cwd(), ".skills"),
    path.resolve(process.cwd(), "docs", "skills"),
    path.normalize(path.join(os.homedir(), ".gemini", "antigravity-cli", "skills")),
    path.normalize(path.join(os.homedir(), ".cursor", "skills")),
    path.normalize(path.join(os.homedir(), ".commandcode", "skills")),
    path.normalize(path.join(os.homedir(), ".claude", "skills")),
    path.normalize(path.join(os.homedir(), ".gemini", "skills")),
    path.normalize(path.join(os.homedir(), ".config", "opencode", "skills")),
    path.normalize(path.join(os.homedir(), ".opencode", "skills")),
    path.normalize(path.join(os.homedir(), ".codex", "skills")),
    path.normalize(path.join(os.homedir(), ".omp", "agent", "skills"))
  ];
  const detected = [];
  for (const cand of candidateRoots) {
    if (hasSkillFiles(cand) && !detected.includes(cand)) {
      detected.push(cand);
    }
  }
  if (detected.length === 0) detected.push(globalSkillsDir);
  return detected;
}

function _resolveDetectedSkillsDirs(options, globalSkillsDir) {
  const detectedSkillsDirs = [];
  if (options.skillsDirs && options.skillsDirs.length) {
    for (const d of options.skillsDirs) {
      const resolved = path.resolve(d);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() && !detectedSkillsDirs.includes(resolved)) {
        detectedSkillsDirs.push(resolved);
      }
    }
  } else if (options.skillsDir) {
    const resolved = path.resolve(options.skillsDir);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      detectedSkillsDirs.push(resolved);
    }
  }
  if (detectedSkillsDirs.length === 0) {
    detectedSkillsDirs.push(..._resolveCandidateSkillRoots(globalSkillsDir));
  }
  return detectedSkillsDirs;
}

function _buildSkillsToMigrate(options, skillsMap, defaultDir) {
  const skillsToMigrate = [];
  if (options.skills && options.skills.length) {
    for (const s of options.skills) {
      const dir = skillsMap.get(s) || defaultDir;
      skillsToMigrate.push({ name: s, dir });
    }
  } else {
    for (const [s, dir] of skillsMap.entries()) {
      skillsToMigrate.push({ name: s, dir });
    }
    if (skillsToMigrate.length === 0) {
      for (const s of CUSTOM_SKILLS) {
        skillsToMigrate.push({ name: s, dir: defaultDir });
      }
    }
  }
  return skillsToMigrate;
}

function _cleanDeletedSkills(conn, options) {
  if (!options.clean && !options.pruneDeleted) return;
  const rows = conn.prepare("SELECT DISTINCT skill_name FROM skills").all();
  const deletedSkills = new Set();
  for (const r of rows) {
    const sName = r.skill_name;
    const fpRows = conn.prepare("SELECT file_path FROM skills WHERE skill_name = ? AND file_path IS NOT NULL").all(sName);
    const anyExists = fpRows.some(fp => fp.file_path && fs.existsSync(fp.file_path));
    if (!anyExists && fpRows.length) deletedSkills.add(sName);
  }

  if (deletedSkills.size) {
    log("\n🗑️  Cleaning up deleted skills from database:");
    for (const sName of Array.from(deletedSkills).sort()) {
      try { conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(sName); } catch (_) { /* ignore */ }
      conn.prepare("DELETE FROM skills WHERE skill_name = ?").run(sName);
      log(`  ✓ Cleaned up: ${sName}`);
    }
  }
}

function _verifyFtsQueries(conn) {
  log("\n🔍 Verifying FTS index...");
  const isFallback = Boolean(db.hasFts5Support && !db.hasFts5Support(conn));
  if (isFallback) {
    log("   FTS5 module not available on this platform. Fallback keyword search enabled.");
  }
  for (const testWord of ['security', 'terraform', 'svelte']) {
    try {
      const sql = isFallback
        ? "SELECT COUNT(*) as cnt FROM skills WHERE tags LIKE ? OR content LIKE ?"
        : "SELECT COUNT(*) as cnt FROM skills_fts WHERE skills_fts MATCH ?";
      const result = isFallback
        ? conn.prepare(sql).get(`%${testWord}%`, `%${testWord}%`)
        : conn.prepare(sql).get(testWord);
      log(`   ${isFallback ? 'Keyword fallback' : 'FTS'} test query '${testWord}': ${result ? (result.cnt || 0) : 0} matches`);
    } catch (_) {
      log(`   ${isFallback ? 'Keyword fallback' : 'FTS'} test query '${testWord}': skipped (no matches)`);
    }
  }
}

async function _syncVectorEmbeddings(conn, options, timeBudget) {
  let semanticEnabled = true;
  try {
    const vectorSearch = require('./vector_search');
    if (vectorSearch.isSemanticSearchEnabled) {
      semanticEnabled = vectorSearch.isSemanticSearchEnabled();
    }
  } catch (_) { /* ignore */ }

  const shouldEmbed = !options.skipEmbeddings && (semanticEnabled || options.rebuildEmbeddings);
  if (!shouldEmbed) return;

  try {
    const vectorSearch = require('./vector_search');
    if (typeof vectorSearch.backfillAllEmbeddings === 'function') {
      log("\n⚡ Pre-caching neural models across platforms (IBM Granite + GTE Reranker)...");
      if (typeof vectorSearch.predownloadAllModels === 'function') {
        await vectorSearch.predownloadAllModels(false);
      }
      log("⚡ Synchronizing vector embeddings (IBM Granite Multilingual)...");
      const forceRebuild = !!options.rebuildEmbeddings;
      const chunksIndexed = await vectorSearch.backfillAllEmbeddings(conn, forceRebuild, timeBudget || 180.0);
      log(`   Vector index synchronized: ${chunksIndexed} chunks processed.`);
    }
  } catch (e) {
    log(`   ⚠ Vector embedding generation deferred/skipped: ${e.message}`);
  }
}

function _cleanSingleStaleSkill(conn, name) {
  if (!isEmbeddedReference(name) || isCanonicalSkill(name)) return;
  try {
    conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(name);
  } catch (_) { /* ignore */ }
  conn.prepare("DELETE FROM skills WHERE name = ?").run(name);
  log(`  ✓ Cleaned up stale embedded reference skill entry: ${name}`);
}

function _cleanStaleEmbeddedSkills(conn) {
  try {
    const staleSkills = conn.prepare("SELECT name FROM skills WHERE type = 'skill'").all();
    for (const row of staleSkills) {
      _cleanSingleStaleSkill(conn, row.name);
    }
  } catch (_) { /* ignore */ }
}

function _purgeExistingSkills(conn, options) {
  if (!options.clean) return;
  log("🧹 Purging existing skills from database...");
  if (options.rebuildEmbeddings) {
    try { conn.prepare("DELETE FROM skill_chunks").run(); } catch (_) { /* ignore */ }
  }
  conn.prepare("DELETE FROM skills").run();
}

async function runMigration(options = {}) {
  const globalSkillsDir = path.normalize(path.join(os.homedir(), ".agents", "skills"));
  const templateSkillsDir = path.resolve(__dirname, "templates", "skills");
  const srcTemplateSkillsDir = path.resolve(process.cwd(), "src", "templates", "skills");
  const effectiveTemplateDir = fs.existsSync(srcTemplateSkillsDir)
    ? srcTemplateSkillsDir
    : (fs.existsSync(templateSkillsDir) ? templateSkillsDir : null);

  if (effectiveTemplateDir && (!options.skillsDir || path.resolve(options.skillsDir) === path.resolve(globalSkillsDir))) {
    try {
      const deployUtils = require('./deploy_utils');
      deployUtils.copySkillsDirFast(effectiveTemplateDir, globalSkillsDir);
    } catch (_) { /* best-effort sync */ }
  }

  const detectedSkillsDirs = _resolveDetectedSkillsDirs(options, globalSkillsDir);
  SKILLS_DIR = detectedSkillsDirs[0];

  if (options.dbPath) {
    DB_PATH = path.resolve(options.dbPath);
  }

  const skillsMap = new Map();
  for (const dir of detectedSkillsDirs) {
    const detected = autoDetectSkills(dir);
    for (const s of detected) {
      skillsMap.set(s, dir);
    }
  }

  const skillsToMigrate = _buildSkillsToMigrate(options, skillsMap, SKILLS_DIR);
  const requiredSet = new Set(options.requireSkill || []);
  skillsToMigrate.sort((a, b) => {
    const aReq = requiredSet.has(a.name) ? 0 : 1;
    const bReq = requiredSet.has(b.name) ? 0 : 1;
    if (aReq !== bReq) return aReq - bReq;
    return a.name.localeCompare(b.name);
  });

  let timeBudget = 150.0;
  if (process.env.KONOHA_MIGRATE_TIME_BUDGET) {
    const parsed = parseFloat(process.env.KONOHA_MIGRATE_TIME_BUDGET);
    if (!isNaN(parsed)) timeBudget = parsed;
  }

  const startTime = Date.now();
  let deferredSkills = 0;

  log("🚀 Skills Migration to SQLite FTS5 (v1.1.0 — Enhanced Optimization)");
  log(`   Source: ${detectedSkillsDirs.join(', ')}`);
  log(`   Target: ${DB_PATH}`);
  log(`   Skills: ${skillsToMigrate.map(s => s.name).join(', ')}\n`);

  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const conn = setupDb(DB_PATH);
  conn.pragma('foreign_keys = OFF');
  seedAgents(conn);

  _purgeExistingSkills(conn, options);

  let total = 0;
  for (const item of skillsToMigrate) {
    if (!requiredSet.has(item.name) && timeBudget > 0 && ((Date.now() - startTime) / 1000) > timeBudget) {
      deferredSkills += 1;
      continue;
    }
    log(`\n📦 Migrating: ${item.name}`);
    total += migrateSkill(conn, item.name, options.skillsOnly, item.dir);
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
    if (missingRequired.length) log(`  ✗ Required canonical skills missing: ${missingRequired.join(', ')}`);
    if (remainingLegacy.length) log(`  ✗ Legacy skill rows remain: ${remainingLegacy.join(', ')}`);
    conn.close();
    process.exit(1);
  }

  _cleanDeletedSkills(conn, options);
  _cleanStaleEmbeddedSkills(conn);

  try {
    const orphanRes = conn.prepare("DELETE FROM skill_chunks WHERE skill_name NOT IN (SELECT name FROM skills)").run();
    if (orphanRes?.changes > 0) log(`  ✓ Pruned ${orphanRes.changes} orphaned vector chunks.`);
  } catch (_) { /* ignore */ }

  _verifyFtsQueries(conn);
  await _syncVectorEmbeddings(conn, options, timeBudget);

  printSummary(conn);
  conn.pragma('foreign_keys = ON');
  conn.close();
  log(`\n✅ Migration complete! ${total} entries indexed.`);
}


async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (!options) {
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
