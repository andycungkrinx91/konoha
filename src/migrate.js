#!/usr/bin/env node
const {
  _migrateCyberSkills,
  _migrateReferences,
  _migrateRootReferences,
  _collectDocFiles,
  _migrateDocumentation
} = require('./migrate_references');
/**
 * Skills Migration Engine (v1.1.0 — Enhanced Token Optimization)
 * Pure Node.js replacement for migrate.py using the node:sqlite driver and yaml_utils.
 * Migrates skill content from ~/.agents/skills/ into SQLite FTS5 database.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const db = require('./db');
const { getConfigValue } = require('./config_access');
const {
  seedAgents: seedAgentsHelper,
  extractTagsFromFrontmatter,
  extractTagsFromFilename,
  shieldPromptInjection,
  optimizeContent,
  printSummary: printSummaryHelper,
  autoDetectSkills,
  parseCliArgs,
  normalizeLegacySkillNames,
  verifyRequiredSkills,
  resolveCandidateSkillRoots,
  isSafeExternalSkillFile,
  classifySkillSourceProvenance,
} = require('./migrate_helpers');

const { isEmbeddedReference, isCanonicalSkill } = require('./canonical_skills');

let DB_PATH = db.DB_PATH;
let SKILLS_DIR = path.normalize(path.join(os.homedir(), '.agents', 'skills'));

const { CANONICAL_SKILL_NAMES } = require('./canonical_skills');
const CUSTOM_SKILLS = Array.from(CANONICAL_SKILL_NAMES);

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

const { seedSoulArchetypes, SOUL_ARCHETYPE_SEED } = require('./soul_seeds');

function setupDb(dbPath = null) {
  if (dbPath && typeof dbPath === 'object' && typeof dbPath.prepare === 'function') {
    db.setupSchema(dbPath);
    seedSoulArchetypes(dbPath);
    return dbPath;
  }
  const targetPath = dbPath !== null ? dbPath : DB_PATH;
  const conn = db.getConnection(targetPath, false);
  db.setupSchema(conn);
  seedSoulArchetypes(conn);
  return conn;
}


function _computeSkillRowIdentity(conn, baseSkillName, filePath, skillsDir, rawContent) {
  const prov = classifySkillSourceProvenance(skillsDir);
  const contentHash = crypto.createHash('sha256').update(rawContent || '', 'utf8').digest('hex').slice(0, 16);
  const existingExact = conn.prepare('SELECT name, file_path, tags, content FROM skills WHERE name = ?').get(baseSkillName);

  let rowName = baseSkillName;
  if (prov.scope === 'project' && prov.projectHash) {
    if (existingExact && existingExact.file_path && path.resolve(existingExact.file_path) !== path.resolve(filePath)) {
      rowName = `${baseSkillName}@proj-${prov.projectHash}`;
    } else if (!existingExact && !isCanonicalSkill(baseSkillName)) {
      rowName = baseSkillName;
    }
  } else if (prov.scope === 'global' && prov.harness && prov.harness !== 'agents') {
    if (existingExact && existingExact.file_path && path.resolve(existingExact.file_path) !== path.resolve(filePath)) {
      const existingContent = optimizeContent(rawContent);
      if (existingExact.content !== existingContent) {
        rowName = `${baseSkillName}@global-${prov.harness}`;
      }
    }
  }

  const provTags = [
    `scope:${prov.scope}`,
    `harness:${prov.harness}`,
    prov.projectHash ? `project_hash:${prov.projectHash}` : null,
    `hash:${contentHash}`
  ].filter(Boolean);

  return { rowName, prov, contentHash, provTags };
}

function _migrateFlatSkillFile(conn, skillName, skillsDir) {
  const skillNameClean = path.basename(skillName, ".md");
  const filePath = path.join(skillsDir, skillName);
  if (!isSafeExternalSkillFile(filePath, skillsDir)) {
    log(`  ✗ File not found or unsafe: ${filePath}`);
    return 0;
  }

  const rawContent = fs.readFileSync(filePath, 'utf8');
  const { rowName, contentHash, provTags } = _computeSkillRowIdentity(conn, skillNameClean, filePath, skillsDir, rawContent);

  const existingRow = conn.prepare("SELECT tags, file_path FROM skills WHERE name = ?").get(rowName);
  if (existingRow && existingRow.tags && existingRow.tags.includes(`hash:${contentHash}`) && existingRow.file_path === filePath) {
    return 1;
  }

  try {
    conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(rowName);
  } catch (_) { /* intentional best-effort fallback */ }
  conn.prepare("DELETE FROM skills WHERE name = ?").run(rowName);

  const baseTags = extractTagsFromFrontmatter(rawContent);
  const tags = [baseTags, ...provTags].filter(Boolean).join(',');
  const content = optimizeContent(rawContent);
  const byteSize = Buffer.byteLength(content, 'utf8');
  const rawSize = Buffer.byteLength(rawContent, 'utf8');
  const lineCount = (content.match(/\n/g) || []).length + 1;
  const pct = rawSize > 0 ? ((rawSize - byteSize) / rawSize * 100) : 0;

  conn.prepare(
    "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(rowName, skillNameClean, "skill", tags, content, filePath, byteSize, lineCount);

  log(`  ✓ ${skillName} (${rawSize.toLocaleString()} → ${byteSize.toLocaleString()} bytes, optimized ${pct.toFixed(1)}%)`);
  return 1;
}

function _migrateSkillMd(conn, skillDir, skillName, skillsDir = SKILLS_DIR) {
  const skillMd = path.join(skillDir, "SKILL.md");
  if (!isSafeExternalSkillFile(skillMd, skillDir)) return { count: 0, rowName: skillName, unchanged: false };

  const rawContent = fs.readFileSync(skillMd, 'utf8');
  const { rowName, contentHash, provTags } = _computeSkillRowIdentity(conn, skillName, skillMd, skillsDir, rawContent);

  const existingRow = conn.prepare("SELECT tags, file_path FROM skills WHERE name = ?").get(rowName);
  if (existingRow && existingRow.tags && existingRow.tags.includes(`hash:${contentHash}`) && existingRow.file_path === skillMd) {
    return { count: 1, rowName, unchanged: true };
  }

  const baseTags = extractTagsFromFrontmatter(rawContent);
  const tags = [baseTags, ...provTags].filter(Boolean).join(',');
  const content = optimizeContent(rawContent);
  const byteSize = Buffer.byteLength(content, 'utf8');
  const rawSize = Buffer.byteLength(rawContent, 'utf8');
  const lineCount = (content.match(/\n/g) || []).length + 1;
  const pct = rawSize > 0 ? ((rawSize - byteSize) / rawSize * 100) : 0;

  try {
    conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(rowName);
  } catch (_) { /* best-effort */ }
  conn.prepare("DELETE FROM skills WHERE name = ?").run(rowName);
  conn.prepare(
    "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(rowName, skillName, "skill", tags, content, skillMd, byteSize, lineCount);

  log(`  ✓ SKILL.md (${rawSize.toLocaleString()} → ${byteSize.toLocaleString()} bytes, optimized ${pct.toFixed(1)}%)`);
  return { count: 1, rowName, unchanged: false };
}

// SKILL.md hashes alone cannot detect a reference file that was added or edited,
// so an unchanged SKILL.md still triggers the reference pass when any indexed
// reference is missing, changed size, or no longer exists on disk.
const _ROOT_REF_EXCLUDES = new Set(["skill.md", "readme.md", "license.md", "changelog.md"]);

// SKILL.md hashes alone cannot detect a reference file that was added or edited,
// so an unchanged SKILL.md still triggers the reference pass when any indexed
// reference is missing, changed size, or no longer exists on disk.
// Pruning and staleness are scoped to the rows this skill dir owns: rows indexed from
// another mirror under the same prefix belong to that mirror and must survive.
function _referenceFilesOnDisk(skillDir) {
  const files = [];
  const refsDir = path.join(skillDir, "references");
  if (fs.existsSync(refsDir) && fs.statSync(refsDir).isDirectory()) {
    for (const file of fs.readdirSync(refsDir)) {
      if (file.endsWith(".md")) files.push(path.join(refsDir, file));
    }
  }
  for (const file of fs.readdirSync(skillDir)) {
    if (file.endsWith(".md") && !_ROOT_REF_EXCLUDES.has(file.toLowerCase())) files.push(path.join(skillDir, file));
  }
  return files;
}

// Rows written by _migrateReferences and _migrateRootReferences are the only ones
// whose file_path sits directly in <skill>/ or <skill>/references/; nested skill-pack
// rows live deeper and must not count as stale, nor be pruned, from this dir.
function _directReferenceRows(conn, skillDir, prefix) {
  const dirs = new Set([skillDir, path.join(skillDir, "references")]);
  return conn.prepare("SELECT name, file_path, byte_size FROM skills WHERE skill_name = ?").all(prefix)
    .filter((row) => row.file_path && dirs.has(path.dirname(row.file_path)));
}

function _refsStale(conn, skillDir, prefix) {
  const rows = _directReferenceRows(conn, skillDir, prefix);
  if (rows.some((row) => !fs.existsSync(row.file_path))) return true;
  const indexedSize = new Map(rows.map((row) => [row.name, row.byte_size]));
  return _referenceFilesOnDisk(skillDir).some((file) => {
    const key = `${prefix}/${path.basename(file, ".md")}`;
    return indexedSize.get(key) !== Buffer.byteLength(optimizeContent(fs.readFileSync(file, "utf8")), "utf8");
  });
}

function _pruneOrphanReferences(conn, skillDir, prefix) {
  const orphans = _directReferenceRows(conn, skillDir, prefix).filter((row) => !fs.existsSync(row.file_path));
  for (const row of orphans) {
    try {
      conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(row.name);
    } catch (_) { /* intentional best-effort fallback */ }
    conn.prepare("DELETE FROM skills WHERE name = ?").run(row.name);
  }
  return orphans.length;
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

  const mdRes = _migrateSkillMd(conn, skillDir, skillName, skillsDir);
  let count = mdRes.count;
  const effectivePrefix = mdRes.rowName || skillName;
  if (!mdRes.unchanged || (!skillsOnly && _refsStale(conn, skillDir, effectivePrefix))) {
    if (!skillsOnly) _pruneOrphanReferences(conn, skillDir, effectivePrefix);
    count += _migrateReferences(conn, skillDir, effectivePrefix, skillsOnly, log);
    count += _migrateRootReferences(conn, skillDir, effectivePrefix, skillsOnly, log);
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
    if (!args.skills || args.skills.length === 0) {
      total += _migrateDocumentation(conn, false);
    }
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
    detectedSkillsDirs.push(...resolveCandidateSkillRoots(globalSkillsDir));
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
  const rows = conn.prepare("SELECT DISTINCT skill_name FROM skills WHERE type = 'skill'").all();
  const deletedSkills = new Set();
  for (const r of rows) {
    const sName = r.skill_name;
    const fpRows = conn.prepare("SELECT file_path FROM skills WHERE skill_name = ? AND type = 'skill' AND file_path IS NOT NULL").all(sName);
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
  try {
    conn.exec("INSERT INTO skills_fts(skills_fts) VALUES('rebuild')");
  } catch (_) { /* best effort if fts not supported */ }
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
  const prevDbPath = DB_PATH;
  try {
    return await _runMigration(options);
  } finally {
    // Module-level path state must not leak between in-process calls.
    DB_PATH = prevDbPath;
  }
}

async function _runMigration(options = {}) {
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

  // A fresh install embeds 228 skills + references in ~163 s on a laptop, so the
  // old 150 s default truncated the alphabetical tail on every single install.
  // The budget only bounds how long migration may run before deferring the rest;
  // it must never be shorter than the caller's own timeout, or the work is
  // silently truncated while the caller still believes it finished.
  let timeBudget = getConfigValue('migrate_time_budget_seconds', 900.0);
  if (options.timeBudgetSeconds) {
    timeBudget = options.timeBudgetSeconds;
  } else if (process.env.KONOHA_MIGRATE_TIME_BUDGET) {
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
  const soulCount = seedSoulArchetypes(conn);
  log(`  ✓ Seeded ${soulCount} soul archetypes into soul_archetypes (SQLite-first).`);

  // Upgrades from <= 2.2.19 can still carry cyber rows and on-disk copies from a
  // pack the user already removed. Clean them here so `doctor --vps` stops
  // failing; an opted-in pack is untouched.
  try {
    const purge = require('./cyber_pack').purgeLegacyResidue(conn, { dbPath: DB_PATH });
    if (purge) log(`  ✓ Purged cyber-pack residue: ${purge.removedRows} rows, ${purge.removedDirs.length} dirs.`);
  } catch (_) { /* optional cleanup must never break migration */ }

  _purgeExistingSkills(conn, options);

  let total = 0;
  total += _migrateDocumentation(conn, options.skillsOnly);
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
    return { ok: false, reason: 'required_skills_missing', missingRequired, remainingLegacy, indexed: total };
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
  return { ok: true, indexed: total, deferredSkills, dbPath: DB_PATH };
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
  const result = await runMigration(options);
  if (result && result.ok === false) process.exit(1);
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
  _refsStale,
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
  verify_required_skills: verifyRequiredSkills,
  seedSoulArchetypes,
  SOUL_ARCHETYPE_SEED
};
