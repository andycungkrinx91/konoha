'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

let DB_PATH = db.DB_PATH;

function getDefaultDbPath() {
  return db.DB_PATH || DB_PATH;
}

function getDb(dbPath = null) {
  if (dbPath && typeof dbPath === 'object' && typeof dbPath.prepare === 'function') {
    return Object.create(dbPath, {
      close: { value: () => {}, writable: true }
    });
  }
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

function _detectPackageManager(canonical) {
  if (fs.existsSync(path.join(canonical, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(canonical, "bun.lockb")) || fs.existsSync(path.join(canonical, "bun.lock"))) return "bun";
  if (fs.existsSync(path.join(canonical, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(canonical, "package-lock.json"))) return "npm";
  return "pnpm";
}

function _detectNodeFramework(allDeps) {
  if ('next' in allDeps) {
    const ver = allDeps['next'] || '';
    return ver ? `Next.js (${ver})` : "Next.js";
  }
  if ('@sveltejs/kit' in allDeps || 'svelte' in allDeps) return "SvelteKit";
  if ('nuxt' in allDeps || 'nuxt3' in allDeps) return "Nuxt 3";
  if ('@angular/core' in allDeps) return "Angular";
  if ('astro' in allDeps) return "Astro";
  if ('vue' in allDeps) return "Vue";
  if ('react' in allDeps) return "React";
  if ('express' in allDeps) return "Express.js";
  if ('hono' in allDeps) return "Hono";
  return "Unknown";
}

function _detectNodeStyling(allDeps) {
  if ('tailwindcss' in allDeps) {
    const twVer = allDeps['tailwindcss'] || '';
    if ('@tailwindcss/postcss' in allDeps || twVer.startsWith('^4') || twVer.startsWith('4.')) {
      return "Tailwind CSS v4 (@theme directives)";
    }
    return "Tailwind CSS";
  }
  if ('@emotion/react' in allDeps || '@emotion/styled' in allDeps) return "Emotion CSS";
  if ('styled-components' in allDeps) return "Styled Components";
  if ('unocss' in allDeps) return "UnoCSS";
  return "Standard CSS";
}

function _detectNodeDependencies(allDeps) {
  const relevantKeywords = [
    'react', 'vue', 'svelte', 'angular', 'next', 'nuxt', 'tailwind',
    'prisma', 'drizzle', 'fastapi', 'flask', 'express', 'hono', 'zod',
    'trpc', 'lucide', 'motion', 'three', 'vitest', 'jest', 'playwright'
  ];
  const depKeys = Object.keys(allDeps);
  const filteredDeps = depKeys.filter(k => relevantKeywords.some(kw => k.toLowerCase().includes(kw)));
  return filteredDeps.length ? filteredDeps.slice(0, 15) : depKeys.slice(0, 10);
}

function _detectNodeStack(canonical, stackInfo) {
  const pkgJsonPath = path.join(canonical, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return;
  try {
    const pkgData = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    if (pkgData.name) stackInfo.project_name = pkgData.name;
    const allDeps = Object.assign({}, pkgData.dependencies || {}, pkgData.devDependencies || {});
    stackInfo.dependencies = _detectNodeDependencies(allDeps);
    const fw = _detectNodeFramework(allDeps);
    if (fw !== "Unknown") stackInfo.framework = fw;
    stackInfo.styling = _detectNodeStyling(allDeps);
  } catch (_) { /* intentional best-effort fallback */ }
}

function _detectPythonStack(canonical, stackInfo) {
  if (!fs.existsSync(path.join(canonical, "pyproject.toml")) && !fs.existsSync(path.join(canonical, "requirements.txt"))) return;
  stackInfo.language = "Python";
  if (stackInfo.framework !== "Unknown") return;
  const reqPath = path.join(canonical, "requirements.txt");
  if (!fs.existsSync(reqPath)) return;
  try {
    const content = fs.readFileSync(reqPath, 'utf8').toLowerCase();
    if (content.includes("fastapi")) stackInfo.framework = "FastAPI";
    else if (content.includes("django")) stackInfo.framework = "Django";
    else if (content.includes("flask")) stackInfo.framework = "Flask";
  } catch (_) { /* intentional best-effort fallback */ }
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
  } catch (_) { /* intentional best-effort fallback */ }

  stackInfo.project_name = path.basename(canonical);
  stackInfo.package_manager = _detectPackageManager(canonical);

  _detectNodeStack(canonical, stackInfo);
  _detectPythonStack(canonical, stackInfo);

  return stackInfo;
}

function initMemoryTables(conn) {
  db.setupSchema(conn);
}

function saveOrUpdateProject(projectPath, contextSummary = "", techStack = null, dbPath = null) {
  if (!projectPath || !String(projectPath).trim()) {
    return "";
  }

  const trimmed = String(projectPath).trim();
  let canonical = path.resolve(trimmed);
  try {
    if (fs.existsSync(canonical)) canonical = fs.realpathSync(canonical);
  } catch (_) { /* intentional best-effort fallback */ }

  const pHash = computeProjectHash(canonical);
  const now = new Date().toISOString();

  const detected = detectProjectStack(canonical);
  if (techStack) {
    Object.assign(detected, techStack);
  }

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const tx = conn.transaction(() => {
      const existing = conn.prepare("SELECT * FROM projects WHERE project_hash = ?").get(pHash);
      const trimmedSummary = (contextSummary && typeof contextSummary === 'string') ? contextSummary.trim() : '';
      const safeSummary = trimmedSummary.length > 1000 ? trimmedSummary.substring(0, 1000) : trimmedSummary;
      if (existing) {
        const newSummary = safeSummary || existing.context_summary;
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
          safeSummary,
          JSON.stringify(detected),
          now,
          now
        );
      }
    });
    tx();
    return pHash;
  } finally {
    conn.close();
  }
}

function getProjectProfile(projectPathOrHash, dbPath = null) {
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
      } catch (_) { /* intentional best-effort fallback */ }
      return res;
    }
    return null;
  } finally {
    conn.close();
  }
}

function listProjects(limit = 50, dbPath = null) {
  if (typeof limit === 'string' && (limit.includes('/') || limit.includes('\\') || limit.endsWith('.db'))) {
    dbPath = limit;
    limit = 50;
  }
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const rows = conn.prepare("SELECT * FROM projects ORDER BY updated_at DESC LIMIT ?").all(limit);
    return rows.map(r => {
      const d = Object.assign({}, r);
      try {
        d.tech_stack = JSON.parse(d.tech_stack || "{}");
      } catch (_) { /* intentional best-effort fallback */ }
      return d;
    });
  } finally {
    conn.close();
  }
}

function deleteProject(projectPathOrHash, deleteAssociatedMemories = true, dbPath = null) {
  if (!projectPathOrHash) return false;
  const target = String(projectPathOrHash).trim();
  const pHash = (target.includes('/') || target.includes('\\') || fs.existsSync(target))
    ? computeProjectHash(target)
    : target;

  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const tx = conn.transaction(() => {
      const res = conn.prepare("DELETE FROM projects WHERE project_hash = ? OR project_path = ?").run(pHash, target);
      const deleted = res.changes > 0;
      if (deleteAssociatedMemories) {
        conn.prepare("DELETE FROM persona_memories WHERE project_hash = ?").run(pHash);
      }
      return deleted;
    });
    return tx();
  } finally {
    conn.close();
  }
}

function _deleteAssociatedMemories(conn, options) {
  if (options.deleteAssociatedMemories === false) return;
  if (options.keepCurrent && options.currentHash) {
    conn.prepare("DELETE FROM persona_memories WHERE project_hash != ? AND project_hash != ''").run(options.currentHash);
  } else {
    conn.prepare("DELETE FROM persona_memories WHERE project_hash IS NOT NULL AND project_hash != ''").run();
  }
}

function pruneAllProjects(options = {}, dbPath = null) {
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    let sql = "DELETE FROM projects WHERE 1=1";
    const params = [];
    if (options.keepCurrent && options.currentHash) {
      sql += " AND project_hash != ?";
      params.push(options.currentHash);
    }
    const tx = conn.transaction(() => {
      const res = conn.prepare(sql).run(...params);
      _deleteAssociatedMemories(conn, options);
      return { deleted: res.changes };
    });
    return tx();
  } finally {
    conn.close();
  }
}

module.exports = {
  DB_PATH,
  getDefaultDbPath,
  getDb,
  computeProjectHash,
  detectProjectStack,
  initMemoryTables,
  saveOrUpdateProject,
  getProjectProfile,
  listProjects,
  deleteProject,
  pruneAllProjects
};
