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
  _mergeWorkspaceStack(canonical, stackInfo);
  _detectInfraStack(canonical, stackInfo);

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
    let row = conn.prepare("SELECT * FROM projects WHERE project_hash = ? OR project_path = ?").get(pHash, target);
    if (row && (row.framework === 'Unknown' || row.styling === 'Standard CSS')) {
      row = _refreshSingleProjectRow(conn, row) || row;
    }
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

/**
 * Resolve nested package locations for monorepos. Honours the package manager
 * workspace globs when present; otherwise scans well-known container directories.
 * Returns absolute paths of package.json files beneath the workspace root.
 */
function _resolveWorkspacePackages(canonical) {
  const found = [];
  const seen = new Set();
  const push = (pkgPath) => {
    if (seen.has(pkgPath)) return;
    seen.add(pkgPath);
    found.push(pkgPath);
  };
  const globs = _readWorkspaceGlobs(canonical);
  for (const pattern of globs) {
    for (const dir of _expandWorkspacePattern(canonical, pattern)) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) push(pkgPath);
    }
  }
  if (found.length === 0) {
    for (const container of ['apps', 'packages', 'libs', 'services']) {
      const containerDir = path.join(canonical, container);
      let entries = [];
      try {
        entries = fs.readdirSync(containerDir, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pkgPath = path.join(containerDir, entry.name, 'package.json');
        if (fs.existsSync(pkgPath)) push(pkgPath);
      }
    }
  }
  return found;
}

function _readWorkspaceGlobs(canonical) {
  const globs = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(canonical, 'package.json'), 'utf8'));
    const ws = pkg.workspaces;
    if (Array.isArray(ws)) globs.push(...ws);
    else if (ws && Array.isArray(ws.packages)) globs.push(...ws.packages);
  } catch (_) { /* no root manifest */ }
  try {
    const yaml = fs.readFileSync(path.join(canonical, 'pnpm-workspace.yaml'), 'utf8');
    const block = yaml.match(/packages\s*:\s*\n((?:\s*-\s*.+\n?)+)/);
    if (block) {
      for (const line of block[1].split(/[\r\n]+/)) {
        const item = line.replace(/^\s*-\s*/, '').replace(/['"]/g, '').trim();
        if (item) globs.push(item);
      }
    }
  } catch (_) { /* no workspace yaml */ }
  return globs;
}

function _expandWorkspacePattern(canonical, pattern) {
  const clean = String(pattern).replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!clean || clean.startsWith('!')) return [];
  if (!clean.includes('*')) {
    const dir = path.join(canonical, clean);
    return fs.existsSync(dir) ? [dir] : [];
  }
  const segments = clean.split('/');
  let bases = [canonical];
  for (const seg of segments) {
    const next = [];
    for (const base of bases) {
      let entries = [];
      try {
        entries = fs.readdirSync(base, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      if (seg === '*') {
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith('.')) next.push(path.join(base, e.name));
        }
      } else if (seg.includes('*')) {
        const escaped = seg.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        const re = new RegExp('^' + escaped + '$');
        for (const e of entries) {
          if (e.isDirectory() && re.test(e.name)) next.push(path.join(base, e.name));
        }
      } else {
        next.push(path.join(base, seg));
      }
    }
    bases = next;
  }
  return bases.filter((b) => {
    try {
      return fs.statSync(b).isDirectory();
    } catch (_) {
      return false;
    }
  });
}

/**
 * Fall back to workspace packages when the root manifest carries no framework or
 * styling signal, which is normal for monorepo roots that only orchestrate apps.
 */
function _mergeWorkspaceStack(canonical, stackInfo) {
  if (stackInfo.framework !== 'Unknown' && stackInfo.styling !== 'Standard CSS') return;
  const packages = _resolveWorkspacePackages(canonical);
  if (packages.length === 0) return;
  let framework = null;
  let styling = null;
  const deps = new Set(stackInfo.dependencies || []);
  for (const pkgPath of packages) {
    let pkg = null;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (_) {
      continue;
    }
    const allDeps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
    if (!framework) {
      const fw = _detectNodeFramework(allDeps);
      if (fw !== 'Unknown') framework = fw;
    }
    if (!styling) {
      const st = _detectNodeStyling(allDeps);
      if (st !== 'Standard CSS') styling = st;
    }
    for (const d of _detectNodeDependencies(allDeps)) deps.add(d);
    if (framework && styling) break;
  }
  if (framework) stackInfo.framework = framework;
  if (styling) stackInfo.styling = styling;
  stackInfo.dependencies = Array.from(deps);
}


/**
 * Re-detect the tech stack for stored projects whose directory still exists.
 * Stale rows (framework "Unknown" / styling "Standard CSS") are refreshed so the
 * Context surface reports the real stack instead of a cached placeholder.
 * Rows whose directory is gone are left untouched and reported as skipped.
 */
function refreshProjectStacks(options = {}, dbPath = null) {
  const onlyStale = options.onlyStale !== false;
  const conn = getDb(dbPath);
  try {
    initMemoryTables(conn);
    const rows = conn.prepare('SELECT project_hash, project_path, framework, styling FROM projects').all();
    const now = new Date().toISOString();
    const updated = [];
    const skipped = [];
    const tx = conn.transaction(() => {
      const stmt = conn.prepare('UPDATE projects SET framework = ?, styling = ?, package_manager = ?, project_name = ?, updated_at = ? WHERE project_hash = ?');
      for (const row of rows) {
        const projectPath = row.project_path;
        if (!projectPath || !fs.existsSync(projectPath)) {
          skipped.push({ project_hash: row.project_hash, reason: 'path_missing' });
          continue;
        }
        if (onlyStale && row.framework !== 'Unknown' && row.styling !== 'Standard CSS') {
          skipped.push({ project_hash: row.project_hash, reason: 'already_detected' });
          continue;
        }
        const detected = detectProjectStack(projectPath);
        const framework = detected.framework === 'Unknown' ? row.framework : detected.framework;
        const styling = detected.styling === 'Standard CSS' ? row.styling : detected.styling;
        if (framework === row.framework && styling === row.styling) {
          skipped.push({ project_hash: row.project_hash, reason: 'no_change' });
          continue;
        }
        stmt.run(framework, styling, detected.package_manager, detected.project_name || null, now, row.project_hash);
        updated.push({ project_hash: row.project_hash, framework, styling });
      }
    });
    tx();
    return { updated: updated.length, skipped: skipped.length, details: updated };
  } finally {
    conn.close();
  }
}

/**
 * Detect infrastructure-as-code stacks (Helm, Terraform, Kubernetes, Docker,
 * build/CI pipelines). These workspaces legitimately have no package.json or
 * Python manifest, so without this branch they report a misleading "Unknown".
 */
function _detectInfraStack(canonical, stackInfo) {
  if (stackInfo.framework !== 'Unknown') return;
  const has = (rel) => {
    try {
      return fs.existsSync(path.join(canonical, rel));
    } catch (_) {
      return false;
    }
  };
  const hasDir = (rel) => {
    try {
      return fs.statSync(path.join(canonical, rel)).isDirectory();
    } catch (_) {
      return false;
    }
  };
  let hasTf = false;
  try {
    hasTf = fs.readdirSync(canonical).some((f) => f.endsWith('.tf') || f.endsWith('.tfstate'));
  } catch (_) { /* unreadable workspace */ }

  const signals = [
    hasDir('helmfile.d') || has('helmfile.yaml') || has('helmfile.yml'),
    hasDir('chart') || has('Chart.yaml'),
    hasTf,
    hasDir('k8s') || hasDir('kubernetes') || hasDir('manifests'),
    has('Dockerfile') || has('docker-compose.yml') || has('docker-compose.yaml'),
    hasDir('.buildkite') || has('Jenkinsfile') || hasDir('jenkinsfile') || hasDir('.github'),
    hasDir('rundeck-job') || hasDir('cloud-script')
  ];
  const score = signals.filter(Boolean).length;
  if (score === 0) return;

  if (hasDir('helmfile.d') || has('helmfile.yaml') || has('helmfile.yml') || has('Chart.yaml') || hasDir('chart')) {
    stackInfo.framework = 'Helm / Kubernetes';
    stackInfo.language = 'YAML / IaC';
  } else if (hasTf) {
    stackInfo.framework = 'Terraform';
    stackInfo.language = 'HCL / IaC';
  } else if (has('docker-compose.yml') || has('docker-compose.yaml')) {
    stackInfo.framework = 'Docker Compose';
    stackInfo.language = 'YAML / IaC';
  } else if (has('Dockerfile')) {
    stackInfo.framework = 'Docker';
    stackInfo.language = 'YAML / IaC';
  } else if (hasDir('.buildkite') || has('Jenkinsfile') || hasDir('jenkinsfile')) {
    stackInfo.framework = 'CI Pipeline';
    stackInfo.language = 'YAML / IaC';
  }
  if (stackInfo.styling === 'Standard CSS') stackInfo.styling = 'Not applicable';
}


function _refreshSingleProjectRow(conn, row) {
  const projectPath = row.project_path;
  if (!projectPath) return null;
  try {
    if (!fs.existsSync(projectPath)) return null;
  } catch (_) {
    return null;
  }
  const detected = detectProjectStack(projectPath);
  const framework = detected.framework === 'Unknown' ? row.framework : detected.framework;
  const styling = detected.styling === 'Standard CSS' ? row.styling : detected.styling;
  if (framework === row.framework && styling === row.styling) return null;
  const now = new Date().toISOString();
  conn.prepare('UPDATE projects SET framework = ?, styling = ?, package_manager = ?, updated_at = ? WHERE project_hash = ?')
    .run(framework, styling, detected.package_manager, now, row.project_hash);
  return Object.assign({}, row, { framework, styling, package_manager: detected.package_manager, updated_at: now });
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
  pruneAllProjects,
  refreshProjectStacks
};
