'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  optimizeContent,
  parseCyberSkillFrontmatter,
  extractTagsFromFilename
} = require('./migrate_helpers');

function defaultStderrLog(...args) {
  process.stderr.write(args.map(a => (typeof a === 'object' && a !== null) ? JSON.stringify(a) : String(a)).join(' ') + '\n');
}

/**
 * Resolve the cyber skills source directory.
 *
 * The pack is opt-in and lives outside the repo. Consent on disk is the only
 * gate: a leftover in-repo copy is never indexed on its own.
 *
 * @param {string} refsDir skill references directory (unused when opted in)
 * @returns {string|null} skills directory, or null when not opted in
 */
function resolveCyberSkillsDir(refsDir) {
  const cyberPack = require('./cyber_pack');
  if (cyberPack.getState() !== 'opted-in') return null;
  const optInDir = cyberPack.getSkillsDir();
  if (fs.existsSync(optInDir) && fs.statSync(optInDir).isDirectory()) return optInDir;
  // Legacy layout: pack extracted next to the skill's own references.
  const legacyDir = path.join(refsDir, "anthropic-cybersecurity-skills-assets", "skills");
  return fs.existsSync(legacyDir) && fs.statSync(legacyDir).isDirectory() ? legacyDir : null;
}

// The pack belongs to the red identity only. Without this guard a full
// `konoha migrate` would attribute all 817 rows to every skill it walks.
const CYBER_PACK_OWNER = 'akatsuki-skill';

function _migrateCyberSkills(conn, refsDir, skillName, skillsOnly, log = defaultStderrLog) {
  if (skillName !== CYBER_PACK_OWNER) return 0;
  const cyberSkillsDir = resolveCyberSkillsDir(refsDir);
  if (skillsOnly || !cyberSkillsDir) {
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
      const extraTags = parseCyberSkillFrontmatter(rawContent);
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

function _migrateReferences(conn, skillDir, skillName, skillsOnly, log = defaultStderrLog) {
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

  count += _migrateCyberSkills(conn, refsDir, skillName, skillsOnly, log);
  return count;
}

function _migrateRootReferences(conn, skillDir, skillName, skillsOnly, log = defaultStderrLog) {
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

function _collectDocFiles(dirPath, prefix = '') {
  if (!fs.existsSync(dirPath)) return [];
  const results = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === 'SecurityCompliance' || ent.name === 'archive' || ent.name === 'templates' || ent.name === 'node_modules') continue;
      const fullPath = path.join(dirPath, ent.name);
      if (ent.isDirectory()) {
        results.push(..._collectDocFiles(fullPath, `${prefix}${ent.name}-`));
      } else if (ent.isFile() && ent.name.endsWith('.md')) {
        results.push({
          path: fullPath,
          name: `${prefix}${ent.name.replace(/\.md$/, '').toLowerCase()}`
        });
      }
    }
  } catch (_) {
    /* ignore unreadable directory */
  }
  return results;
}

function _migrateDocumentation(conn, skillsOnly, options = {}) {
  if (skillsOnly) return 0;
  const targetDir = options.targetDir || path.normalize(path.join(os.homedir(), '.konoha'));
  const log = options.log || defaultStderrLog;
  const candidates = [
    path.join(targetDir, 'docs'),
    path.normalize(path.join(os.homedir(), '.konoha', 'docs')),
    path.resolve(__dirname, '..', 'docs'),
    path.resolve(__dirname, 'docs'),
    path.resolve(process.cwd(), 'docs')
  ];
  const docsDir = candidates.find(d => fs.existsSync(d) && fs.statSync(d).isDirectory());
  if (!docsDir) return 0;

  const docFiles = _collectDocFiles(docsDir, '');
  let count = 0;
  const stmt = conn.prepare(
    "INSERT OR REPLACE INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, 'documentation', ?, ?, ?, ?, ?)"
  );

  for (const doc of docFiles) {
    try {
      const rawContent = fs.readFileSync(doc.path, 'utf8');
      const content = optimizeContent(rawContent);
      const byteSize = Buffer.byteLength(content, 'utf8');
      const lineCount = (content.match(/\n/g) || []).length + 1;
      const docKey = `doc:${doc.name}`;
      const tags = `documentation, ${doc.name.replace(/-/g, ' ')}`;
      stmt.run(docKey, doc.name, tags, content, doc.path, byteSize, lineCount);
      count++;
    } catch (_) {
      /* ignore unreadable doc */
    }
  }
  if (count > 0) {
    log(`  ✓ Seeded ${count} documentation files into SQLite FTS5 database.`);
  }
  return count;
}

module.exports = {
  _migrateCyberSkills,
  _migrateReferences,
  _migrateRootReferences,
  _collectDocFiles,
  _migrateDocumentation
};
