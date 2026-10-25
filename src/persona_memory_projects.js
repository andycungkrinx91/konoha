'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

let DB_PATH = db.DB_PATH;

function getDefaultDbPath() {
  return DB_PATH || db.DB_PATH;
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

  if (fs.existsSync(path.join(canonical, "pnpm-lock.yaml"))) {
    stackInfo.package_manager = "pnpm";
  } else if (fs.existsSync(path.join(canonical, "bun.lockb")) || fs.existsSync(path.join(canonical, "bun.lock"))) {
    stackInfo.package_manager = "bun";
  } else if (fs.existsSync(path.join(canonical, "yarn.lock"))) {
    stackInfo.package_manager = "yarn";
  } else if (fs.existsSync(path.join(canonical, "package-lock.json"))) {
    stackInfo.package_manager = "npm";
  }

  const pkgJsonPath = path.join(canonical, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkgData = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      if (pkgData.name) {
        stackInfo.project_name = pkgData.name;
      }

      const allDeps = Object.assign({}, pkgData.dependencies || {}, pkgData.devDependencies || {});

      const relevantKeywords = [
        'react', 'vue', 'svelte', 'angular', 'next', 'nuxt', 'tailwind',
        'prisma', 'drizzle', 'fastapi', 'flask', 'express', 'hono', 'zod',
        'trpc', 'lucide', 'motion', 'three', 'vitest', 'jest', 'playwright'
      ];
      const depKeys = Object.keys(allDeps);
      const filteredDeps = depKeys.filter(k => relevantKeywords.some(kw => k.toLowerCase().includes(kw)));
      stackInfo.dependencies = filteredDeps.length ? filteredDeps.slice(0, 15) : depKeys.slice(0, 10);

      if ('next' in allDeps) {
        const ver = allDeps['next'] || '';
        stackInfo.framework = ver ? `Next.js (${ver})` : "Next.js";
      } else if ('@sveltejs/kit' in allDeps || 'svelte' in allDeps) {
        stackInfo.framework = "SvelteKit";
      } else if ('nuxt' in allDeps || 'nuxt3' in allDeps) {
        stackInfo.framework = "Nuxt 3";
      } else if ('@angular/core' in allDeps) {
        stackInfo.framework = "Angular";
      } else if ('astro' in allDeps) {
        stackInfo.framework = "Astro";
      } else if ('vue' in allDeps) {
        stackInfo.framework = "Vue";
      } else if ('react' in allDeps) {
        stackInfo.framework = "React";
      } else if ('express' in allDeps) {
        stackInfo.framework = "Express.js";
      } else if ('hono' in allDeps) {
        stackInfo.framework = "Hono";
      }

      if ('tailwindcss' in allDeps) {
        const twVer = allDeps['tailwindcss'] || '';
        if ('@tailwindcss/postcss' in allDeps || twVer.startsWith('^4') || twVer.startsWith('4.')) {
          stackInfo.styling = "Tailwind CSS v4 (@theme directives)";
        } else {
          stackInfo.styling = "Tailwind CSS";
        }
      } else if ('@emotion/react' in allDeps || '@emotion/styled' in allDeps) {
        stackInfo.styling = "Emotion CSS";
      } else if ('styled-components' in allDeps) {
        stackInfo.styling = "Styled Components";
      } else if ('unocss' in allDeps) {
        stackInfo.styling = "UnoCSS";
      }
    } catch (_) { /* intentional best-effort fallback */ }
  }

  if (fs.existsSync(path.join(canonical, "pyproject.toml")) || fs.existsSync(path.join(canonical, "requirements.txt"))) {
    stackInfo.language = "Python";
    if (stackInfo.framework === "Unknown") {
      const reqPath = path.join(canonical, "requirements.txt");
      if (fs.existsSync(reqPath)) {
        try {
          const content = fs.readFileSync(reqPath, 'utf8').toLowerCase();
          if (content.includes("fastapi")) stackInfo.framework = "FastAPI";
          else if (content.includes("django")) stackInfo.framework = "Django";
          else if (content.includes("flask")) stackInfo.framework = "Flask";
        } catch (_) { /* intentional best-effort fallback */ }
      }
    }
  }

  return stackInfo;
}

function initMemoryTables(conn) {
  db.setupSchema(conn);
}

function saveOrUpdateProject(projectPath, contextSummary = "", techStack = null, dbPath = DB_PATH) {
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

function getProjectProfile(projectPathOrHash, dbPath = DB_PATH) {
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

function listProjects(limit = 50, dbPath = DB_PATH) {
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

function deleteProject(projectPathOrHash, deleteAssociatedMemories = true, dbPath = DB_PATH) {
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

function pruneAllProjects(options = {}, dbPath = DB_PATH) {
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
      if (options.deleteAssociatedMemories !== false) {
        if (options.keepCurrent && options.currentHash) {
          conn.prepare("DELETE FROM persona_memories WHERE project_hash != ? AND project_hash != ''").run(options.currentHash);
        } else {
          conn.prepare("DELETE FROM persona_memories WHERE project_hash IS NOT NULL AND project_hash != ''").run();
        }
      }
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
