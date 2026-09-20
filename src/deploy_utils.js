/**
 * Shared install/deploy helpers for Konoha CLI and Cursor bootstrap.
 */
const fs = require("fs");
const path = require("path");

const { spawnSync } = require("child_process");
const { fileExists, ensureDir, IS_WIN, detectPythonOrDefault } = require("./platform_utils");

const {
  HOME,
  SKILLS_DB_DIR, FILE_TOOLS_MCP_PATH, FILE_TOOLS_LAUNCHER_PATH,
  FILE_TOOLS_NODE_PATH_FILE, FILE_TOOLS_PYTHON_CMD_FILE, FILE_TOOLS_PY_DIR,
  SRC_DIR
} = require("../bin/lib/paths");

const FILE_TOOLS_LAUNCHER_JS = path.join(
  SKILLS_DB_DIR,
  "file_tools_launcher.js",
);

/**
 * Resolves the Konoha Web UI application directory (apps/web) across runtimes:
 *   1. ~/.konoha/apps/web            — runtime copy installed by installCliRuntime()
 *   2. <repo>/apps/web               — when running from the konoha repository
 *   3. <npm global root>/Konoha/apps/web — npm-installed package (last resort)
 * A candidate qualifies only if it is a real app dir (package.json named
 * konoha-web, or a build/handler.js production output).
 * opts.preferSources: prefer a directory with buildable sources (src/routes)
 * over a build-only copy — used by `konoha ui build`.
 * Returns null when the UI is unavailable on this machine.
 */
function resolveWebUiDir(opts = {}) {
  const candidates = [
    path.join(HOME, ".konoha", "apps", "web"),
    path.resolve(__dirname, "..", "apps", "web")
  ];
  try {
    const isWin = process.platform === "win32";
    const res = spawnSync(isWin ? "npm.cmd" : "npm", ["root", "-g"], {
      encoding: "utf-8",
      timeout: 8000,
      shell: isWin
    });
    const globalRoot = ((res.stdout || "") + "").trim().split(/\r?\n/).filter(Boolean).pop();
    if (globalRoot) candidates.push(path.join(globalRoot, "Konoha", "apps", "web"));
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  const qualifying = [];
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) continue;
      let qualifies = false;
      let hasSources = false;
      const pkg = path.join(dir, "package.json");
      if (fs.existsSync(pkg)) {
        try {
          if (JSON.parse(fs.readFileSync(pkg, "utf8")).name === "konoha-web") {
            qualifies = true;
            hasSources = fs.existsSync(path.join(dir, "src", "routes"));
          }
        } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
      if (!qualifies && fs.existsSync(path.join(dir, "build", "handler.js"))) qualifies = true;
      if (qualifies) qualifying.push({ dir, hasSources });
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  if (qualifying.length === 0) return null;
  if (opts.preferSources) {
    const withSources = qualifying.find((c) => c.hasSources);
    if (withSources) return withSources.dir;
    return null;
  }
  return qualifying[0].dir;
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

function copyIfDifferent(src, dest) {
  if (!fileExists(src)) return false;
  if (!fileExists(dest)) {
    copyFile(src, dest);
    return true;
  }
  try {
    const a = fs.readFileSync(src);
    const b = fs.readFileSync(dest);
    if (!a.equals(b)) {
      copyFile(src, dest);
      return true;
    }
  } catch {
    try {
      copyFile(src, dest);
      return true;
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  return false;
}

function copyRecursiveIfDifferent(src, dest) {
  let stats;
  try {
    stats = fs.statSync(src);
  } catch {
    return;
  }
  if (stats.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursiveIfDifferent(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    copyIfDifferent(src, dest);
  }
}

function listSkillEntries(skillsDir) {
  if (!fileExists(skillsDir)) return [];
  const entries = [];
  try {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        fileExists(path.join(skillsDir, entry.name, "SKILL.md"))
      ) {
        entries.push(entry.name);
      } else if (entry.isFile() && entry.name.endsWith("-skill.md")) {
        entries.push(entry.name);
      }
    }
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  return entries;
}

// Fast mtime+size fingerprint for a directory tree. Returns "mtime:count:size".
function treeFingerprint(root) {
  let maxMtime = 0;
  let count = 0;
  let totalSize = 0;
  if (!fs.existsSync(root)) return "0:0:0";
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (dir === root && (entry.name === '.claude' || entry.name === '.cursor' || entry.name === 'CLAUDE.md' || entry.name === '.git' || entry.name === '.DS_Store')) {
        continue;
      }
      const p = path.join(dir, entry.name);
      try {
        const st = fs.statSync(p);
        if (entry.isDirectory()) { stack.push(p); }
        else { count++; totalSize += st.size; if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs; }
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }
  return `${maxMtime.toFixed(0)}:${count}:${totalSize}`;
}

// Copy srcRoot -> destRoot only when files have actually changed.
function copySkillsDirFast(srcRoot, destRoot, precomputedSrcFp = null) {
  if (!fs.existsSync(srcRoot)) return;
  ensureDir(destRoot);
  const srcFp = precomputedSrcFp || treeFingerprint(srcRoot);
  const fpMarker = destRoot + '.fingerprint';
  let destFp = null;
  try { destFp = fs.readFileSync(fpMarker, 'utf-8').trim(); } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  if (srcFp === destFp) return;

  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (dir === srcRoot && (entry.name === '.claude' || entry.name === '.cursor' || entry.name === 'CLAUDE.md' || entry.name === '.git' || entry.name === '.DS_Store')) {
        continue;
      }
      const s = path.join(dir, entry.name);
      const d = path.join(destRoot, path.relative(srcRoot, s));
      if (entry.isDirectory()) {
        ensureDir(d);
        walk(s);
      } else {
        copyIfDifferent(s, d);
      }
    }
  };
  walk(srcRoot);

  // Prune top-level entries in destRoot that do not exist in srcRoot (except fingerprint markers & ignore)
  try {
    const destEntries = fs.readdirSync(destRoot, { withFileTypes: true });
    const srcEntriesSet = new Set();
    try {
      for (const e of fs.readdirSync(srcRoot)) {
        if (e !== '.claude' && e !== '.cursor' && e !== 'CLAUDE.md' && e !== '.git' && e !== '.DS_Store') {
          srcEntriesSet.add(e);
        }
      }
    } catch (_) { /* ignore */ }
    for (const de of destEntries) {
      if (de.name === '.ignore' || de.name.endsWith('.fingerprint') || de.name === '.fingerprint') continue;
      if (!srcEntriesSet.has(de.name)) {
        try {
          fs.rmSync(path.join(destRoot, de.name), { recursive: true, force: true });
        } catch (_) { /* ignore */ }
      }
    }
  } catch (_) { /* ignore */ }

  try { fs.writeFileSync(fpMarker, srcFp, 'utf-8'); } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
}

function mirrorSkillsDirectory() {
  return 0;
}

function syncCursorSkillsFromAgents() {
  return 0;
}

/**
 * Parse a Node.js semver string into { major, minor, patch }.
 * Returns null if string cannot be parsed.
 */
function parseNodeVersion(verStr) {
  if (!verStr || typeof verStr !== 'string') return null;
  const m = verStr.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: m[3] ? parseInt(m[3], 10) : 0,
  };
}

/**
 * Check if a Node.js version satisfies minimum requirements (default: >= 18.12.0).
 */
function isNodeVersionCompatible(ver, minMajor = 18, minMinor = 12) {
  const parsed = typeof ver === 'object' && ver !== null ? ver : parseNodeVersion(ver);
  if (!parsed) return false;
  if (parsed.major > minMajor) return true;
  if (parsed.major === minMajor && parsed.minor >= minMinor) return true;
  return false;
}

/**
 * Check if a candidate node binary path exists and is compatible.
 */
function checkNodeCandidate(candidatePath, minMajor = 18, minMinor = 12) {
  if (!candidatePath || typeof candidatePath !== 'string') return null;
  const normalized = path.resolve(candidatePath.trim());
  if (!fileExists(normalized)) return null;

  if (normalized === process.execPath) {
    if (isNodeVersionCompatible(process.versions.node, minMajor, minMinor)) {
      return { path: normalized, version: `v${process.versions.node}` };
    }
    return null;
  }

  try {
    const res = spawnSync(normalized, ['-v'], {
      encoding: 'utf8',
      timeout: 2500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (res.status === 0 && res.stdout) {
      const verStr = res.stdout.trim();
      if (isNodeVersionCompatible(verStr, minMajor, minMinor)) {
        return { path: normalized, version: verStr };
      }
    }
  } catch (_) { /* intentional best-effort fallback */ }
  return null;
}

/**
 * Resolves an installed Node.js binary satisfying minimum version (>= 18.12.0).
 * Handles user shells configured with nvm, fnm, asdf, volta, or system defaults.
 */
function resolveCompatibleNode(options = {}) {
  const minMajor = options.minMajor != null ? options.minMajor : 18;
  const minMinor = options.minMinor != null ? options.minMinor : 12;

  // 1. Check process.env.KONOHA_NODE
  if (process.env.KONOHA_NODE) {
    const checked = checkNodeCandidate(process.env.KONOHA_NODE, minMajor, minMinor);
    if (checked) return checked.path;
  }

  // 2. Check process.execPath
  if (process.execPath && isNodeVersionCompatible(process.versions.node, minMajor, minMinor)) {
    return process.execPath;
  }

  // 3. Check FILE_TOOLS_NODE_PATH_FILE (~/.konoha/.node_exec_path)
  if (fileExists(FILE_TOOLS_NODE_PATH_FILE)) {
    try {
      const recorded = fs.readFileSync(FILE_TOOLS_NODE_PATH_FILE, 'utf8').trim();
      if (recorded) {
        const checked = checkNodeCandidate(recorded, minMajor, minMinor);
        if (checked) return checked.path;
      }
    } catch (_) { /* intentional best-effort fallback */ }
  }

  const isWin = process.platform === 'win32';
  const nodeExeName = isWin ? 'node.exe' : 'node';

  // 4. Scan NVM versions
  const nvmDir = process.env.NVM_DIR || path.join(HOME, '.nvm');
  const nvmVersionsDir = path.join(nvmDir, 'versions', 'node');
  if (fileExists(nvmVersionsDir)) {
    try {
      const entries = fs.readdirSync(nvmVersionsDir)
        .map(name => ({ name, ver: parseNodeVersion(name) }))
        .filter(item => item.ver && isNodeVersionCompatible(item.ver, minMajor, minMinor))
        .sort((a, b) => b.ver.major - a.ver.major || b.ver.minor - a.ver.minor || b.ver.patch - a.ver.patch);

      for (const entry of entries) {
        const binPath = path.join(nvmVersionsDir, entry.name, isWin ? '' : 'bin', nodeExeName);
        const checked = checkNodeCandidate(binPath, minMajor, minMinor);
        if (checked) return checked.path;
      }
    } catch (_) { /* intentional best-effort fallback */ }
  }

  // 5. Scan fnm, asdf, volta, and local version managers
  const managerDirs = [
    path.join(HOME, '.local', 'share', 'fnm', 'current', 'bin', nodeExeName),
    path.join(HOME, '.fnm', 'current', 'bin', nodeExeName),
    path.join(HOME, '.volta', 'bin', nodeExeName),
  ];
  for (const mPath of managerDirs) {
    const checked = checkNodeCandidate(mPath, minMajor, minMinor);
    if (checked) return checked.path;
  }

  const asdfNodeDir = path.join(HOME, '.asdf', 'installs', 'nodejs');
  if (fileExists(asdfNodeDir)) {
    try {
      const entries = fs.readdirSync(asdfNodeDir)
        .map(name => ({ name, ver: parseNodeVersion(name) }))
        .filter(item => item.ver && isNodeVersionCompatible(item.ver, minMajor, minMinor))
        .sort((a, b) => b.ver.major - a.ver.major || b.ver.minor - a.ver.minor || b.ver.patch - a.ver.patch);

      for (const entry of entries) {
        const binPath = path.join(asdfNodeDir, entry.name, 'bin', nodeExeName);
        const checked = checkNodeCandidate(binPath, minMajor, minMinor);
        if (checked) return checked.path;
      }
    } catch (_) { /* intentional best-effort fallback */ }
  }

  // 6. Scan PATH entries
  const currentPath = process.env.PATH || process.env.Path || '';
  if (currentPath) {
    const dirs = currentPath.split(path.delimiter);
    for (const d of dirs) {
      if (!d) continue;
      const candidate = path.join(d, nodeExeName);
      const checked = checkNodeCandidate(candidate, minMajor, minMinor);
      if (checked) return checked.path;
    }
  }

  // 7. Check standard unix paths
  if (!isWin) {
    const standardPaths = ['/usr/local/bin/node', '/usr/bin/node'];
    for (const stdPath of standardPaths) {
      const checked = checkNodeCandidate(stdPath, minMajor, minMinor);
      if (checked) return checked.path;
    }
  }

  // Fallback to process.execPath or 'node'
  return process.execPath || 'node';
}

/**
 * Creates an environment object where the directory of a compatible Node (>= 18.12.0)
 * is guaranteed to be at the front of PATH.
 */
function resolveCompatibleNodeEnv(baseEnv = process.env, options = {}) {
  const childEnv = Object.assign({}, baseEnv);
  const nodePath = resolveCompatibleNode(options);
  const nodeBinDir = path.dirname(nodePath);

  if (nodeBinDir) {
    const existingPath = childEnv.PATH || childEnv.Path || '';
    const parts = existingPath.split(path.delimiter).filter(p => p && p !== nodeBinDir);
    childEnv.PATH = [nodeBinDir, ...parts].join(path.delimiter);
    if (process.platform === 'win32') {
      childEnv.Path = childEnv.PATH;
    }
  }
  childEnv.KONOHA_NODE = nodePath;
  return { env: childEnv, nodePath, nodeBinDir };
}

function writeNodeExecPathRecord() {
  try {
    const nodePath = resolveCompatibleNode();
    fs.writeFileSync(FILE_TOOLS_NODE_PATH_FILE, `${nodePath}\n`);
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
}

function writePythonCmdRecord(pythonCmd) {
  const cmd = pythonCmd || detectPythonOrDefault();
  try {
    fs.writeFileSync(
      FILE_TOOLS_PYTHON_CMD_FILE,
      `${Array.isArray(cmd) ? JSON.stringify(cmd) : cmd}\n`,
    );
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
}

/**
 * Build konoha MCP stdio entry (Linux, macOS, Windows).
 * @param {'cursor'|'global'|'execPath'} mode
 */
function buildKonohaFilesMcpEntry(mode = "execPath") {
  if (!fileExists(FILE_TOOLS_MCP_PATH)) {
    return null;
  }

  const launcherJs = fileExists(FILE_TOOLS_LAUNCHER_JS)
    ? FILE_TOOLS_LAUNCHER_JS
    : FILE_TOOLS_MCP_PATH;
  const useJsLauncher = launcherJs !== FILE_TOOLS_MCP_PATH;

  const clientName = (mode === "global" || mode === "execPath") ? "antigravity" : mode;

  return {
    type: "stdio",
    // Absolute node path: GUI-launched IDEs may not inherit a shell PATH
    command: process.execPath || "node",
    args: [useJsLauncher ? FILE_TOOLS_LAUNCHER_JS : FILE_TOOLS_MCP_PATH],
    env: {
      ACTIVE_CLIENT: clientName,
      KONOHA_CLIENT: clientName,
      KONOHA_SEMANTIC_SEARCH: "1"
    },
    autoApprove: ["*"],
    auto_approve: true
  };
}



function installFileTools(silent = true, pythonCmd = null) {
  ensureDir(SKILLS_DB_DIR);
  [
    "file_tools_mcp.js",
    "file_tools_router.js",
    "mcp_tool_manifest.json",
    "file_tools_launcher.js",
    "server.js",
    "migrate.js",
    "tools_savings_logger.js",
    "agent_stats.js",
    "platform_utils.js",
    "db.js",
    "db_stats.js",
    "db_savings.js",
    "db_bridges.js",
    "db_agents.js",
    "circuit_breaker.js",
    "persona_memory.js",
    "vector_search.js",
    "yaml_utils.js",
  ].forEach((f) => {
    const src = path.join(SRC_DIR, f);
    const dest = path.join(SKILLS_DB_DIR, f);
    if (fileExists(src)) {
      copyIfDifferent(src, dest);
    }
  });

  // Root-mirror EVERY root-level src/*.js module into the runtime directory.
  // The installed mcp/ subsystem resolves shared modules via relative requires
  // like require('../sdlc_manager'), which point at the runtime ROOT — not at
  // runtime src/. The hardcoded list above inevitably misses modules added
  // later (e.g. sdlc_manager.js), crashing ALL subagent MCP tools
  // (sannin/jonin/anbu/kage/…) after every deploy — the "workflow never runs"
  // regression. This dynamic pass keeps the root mirror complete.
  try {
    for (const entry of fs.readdirSync(SRC_DIR, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js')) {
        copyIfDifferent(path.join(SRC_DIR, entry.name), path.join(SKILLS_DB_DIR, entry.name));
      }
    }
  } catch (_) { /* non-fatal */ }

  const launcherShSrc = path.join(SRC_DIR, "file_tools_launcher.sh");
  if (fileExists(launcherShSrc)) {
    copyIfDifferent(launcherShSrc, FILE_TOOLS_LAUNCHER_PATH);
    if (!IS_WIN) {
      try {
        fs.chmodSync(FILE_TOOLS_LAUNCHER_PATH, 0o755);
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }

  writeNodeExecPathRecord();
  writePythonCmdRecord(pythonCmd);

  const srcJsDir = path.join(SRC_DIR, "file_tools");
  if (fileExists(srcJsDir)) {
    copyRecursiveIfDifferent(srcJsDir, FILE_TOOLS_PY_DIR);
  }

  const srcMcpDir = path.join(SRC_DIR, "mcp");
  const destMcpDir = path.join(SKILLS_DB_DIR, "mcp");
  if (fileExists(srcMcpDir)) {
    copyRecursiveIfDifferent(srcMcpDir, destMcpDir);
  }

  const srcBridgeDir = path.join(SRC_DIR, "bridge");
  const destBridgeDir = path.join(SKILLS_DB_DIR, "bridge");
  if (fileExists(srcBridgeDir)) {
    copyRecursiveIfDifferent(srcBridgeDir, destBridgeDir);

    try {
      const { execFileSync } = require("child_process");
      const pkgPath = path.join(SKILLS_DB_DIR, "package.json");
      const nodeModulesPath = path.join(SKILLS_DB_DIR, "node_modules");
      if (!fileExists(pkgPath)) {
        fs.writeFileSync(
          pkgPath,
          JSON.stringify(
            {
              name: "konoha-runtime",
              version: "1.0.0",
              private: true,
              dependencies: {
                "@bufbuild/protobuf": "^2.11.0",
                "better-sqlite3": "^13.0.3",
                "@huggingface/transformers": "^4.2.0"
              },
            },
            null,
            2,
          ) + "\n",
        );
      }
      if (!fileExists(nodeModulesPath) || !fileExists(path.join(nodeModulesPath, 'better-sqlite3'))) {
        const isWin = process.platform === "win32";
        // .cmd/.bat shims require shell:true since Node >= 18.20.2 (CVE-2024-27980);
        // fall back to npm when pnpm is unavailable
        const pmCandidates = [
          { cmd: isWin ? "pnpm.cmd" : "pnpm", args: ["install", "--prod", "--no-frozen-lockfile"] },
          { cmd: isWin ? "npm.cmd" : "npm", args: ["install", "--omit=dev", "--no-audit", "--no-fund"] },
        ];
        let lastErr = null;
        const { env: childEnv } = resolveCompatibleNodeEnv(process.env);
        for (const pm of pmCandidates) {
          try {
            execFileSync(pm.cmd, pm.args, {
              cwd: SKILLS_DB_DIR,
              stdio: "ignore",
              shell: isWin,
              timeout: 300000,
              env: childEnv,
            });
            lastErr = null;
            break;
          } catch (pmErr) {
            lastErr = pmErr;
          }
        }
        if (lastErr) throw lastErr;
      }
    } catch (err) {
      if (!silent) {
        console.warn(
          `[warning] Failed to install Konoha runtime dependencies with pnpm in ~/.konoha: ${err.message}`,
        );
      }
    }
  }
  return fileExists(FILE_TOOLS_MCP_PATH);
}

/**
 * Safely cleans stale artifacts, legacy databases, dead PIDs, old backups,
 * and orphan modules from the Konoha runtime directory (~/.konoha).
 *
 * Preserves:
 *  - konoha.db (active SQLite DB) and its WAL/SHM files
 *  - transformers_cache/ (downloaded neural model weights)
 *  - node_modules/ (installed production dependencies)
 *  - searxng/ (local SearXNG container/config)
 *  - vendor/ (vendored libraries)
 *  - assets/ (vsix, pre-cached model weights)
 *  - web_token, bridges.json, konoha-bridge.json
 *  - package.json, pnpm-lock.yaml
 *
 * Purges:
 *  - konoha.db.bak-* and skills.db.bak-* (abandoned disk bloat)
 *  - *.bak, *.backup, *~, .*.bak*
 *  - Legacy skills.db* (pre-unified database)
 *  - Legacy *.py, *.pyc, __pycache__ in runtime root
 *  - Stale PID files (*.pid: bridge.pid, ui.pid)
 *  - Dead caches & logs (*.log, transcript_cache.json, package-lock.json)
 *  - Transient task scratch folders in tmp/
 *  - Root-level .vsix files (canonical location is assets/*.vsix)
 *  - Root-level cli.js (canonical location is bin/cli.js)
 *  - Root-level hook-wrapper (deprecated legacy wrapper)
 *  - Orphaned root .js files that do not exist in src/
 *  - Truncates WAL & vacuums konoha.db to reclaim disk pages
 *
 * @param {Object} [options]
 * @param {string} [options.targetDir] - Directory to clean (defaults to SKILLS_DB_DIR)
 * @param {string} [options.srcDir] - Source directory to compare JS files against (defaults to SRC_DIR)
 * @param {boolean} [options.silent] - Suppress log output
 * @param {boolean} [options.vacuumDatabase] - Run VACUUM & checkpoint on konoha.db (default: true)
 * @returns {{ purgedFiles: number, reclaimedBytes: number, errors: string[], details: string[] }}
 */
function cleanKonohaRuntimeDir(options = {}) {
  const target = path.resolve(options.targetDir || SKILLS_DB_DIR);
  const src = path.resolve(options.srcDir || SRC_DIR);
  const silent = options.silent === true;
  const vacuumDb = options.vacuumDatabase !== false;

  const result = {
    purgedFiles: 0,
    reclaimedBytes: 0,
    errors: [],
    details: [],
  };

  if (!target || target === '/' || target === HOME || target === path.resolve(HOME, '..')) {
    throw new Error(`Refusing to clean unsafe directory: ${target}`);
  }
  if (target === src) {
    throw new Error(`Refusing to clean source directory: targetDir equals srcDir (${target})`);
  }
  if (!fs.existsSync(target)) {
    ensureDir(target);
    return result;
  }

  const activeScript = process.argv[1] ? path.resolve(process.argv[1]) : '';

  // 1. Clean transient task scratch folders inside tmp/
  const tmpDir = path.join(target, 'tmp');
  if (fs.existsSync(tmpDir)) {
    try {
      const tmpEntries = fs.readdirSync(tmpDir, { withFileTypes: true });
      for (const entry of tmpEntries) {
        if (entry.name === '.' || entry.name === '..') continue;
        const entryPath = path.join(tmpDir, entry.name);
        try {
          let size = 0;
          try {
            const stat = fs.statSync(entryPath);
            size = stat.size || 0;
          } catch (_) { /* non-fatal stat error */ }
          fs.rmSync(entryPath, { recursive: true, force: true });
          result.purgedFiles++;
          result.reclaimedBytes += size;
          result.details.push(`tmp/${entry.name}`);
        } catch (tmpErr) {
          result.errors.push(`Failed to clean tmp/${entry.name}: ${tmpErr.message}`);
        }
      }
    } catch (readErr) {
      result.errors.push(`Failed to read tmp directory: ${readErr.message}`);
    }
  }

  // 2. Scan and clean root-level items in targetDir
  const preserveDirs = new Set([
    'transformers_cache',
    'node_modules',
    'vendor',
    'searxng',
    'assets',
    'apps',
    'bin',
    'bridge',
    'file_tools',
    'mcp',
    'src',
    '.agents',
    'tmp',
  ]);

  const preserveFiles = new Set([
    'konoha.db',
    'konoha.db-wal',
    'konoha.db-shm',
    'package.json',
    'pnpm-lock.yaml',
    'web_token',
    'bridges.json',
    'konoha-bridge.json',
    '.python_cmd',
    '.node_exec_path',
    '.deploy-fingerprint',
    '.gitignore',
  ]);

  let entries = [];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (err) {
    result.errors.push(`Failed to read target directory: ${err.message}`);
    return result;
  }

  for (const entry of entries) {
    const name = entry.name;
    if (name === '.' || name === '..') continue;
    const itemPath = path.join(target, name);

    if (activeScript && itemPath === activeScript) {
      continue;
    }

    if (entry.isDirectory()) {
      if (preserveDirs.has(name)) {
        continue;
      }
      if (name === '__pycache__' || name === '.pytest_cache' || name === '.ruff_cache') {
        try {
          fs.rmSync(itemPath, { recursive: true, force: true });
          result.purgedFiles++;
          result.details.push(`${name}/`);
        } catch (dirErr) {
          result.errors.push(`Failed to remove directory ${name}: ${dirErr.message}`);
        }
      }
      continue;
    }

    if (preserveFiles.has(name)) {
      continue;
    }

    let shouldPurge = false;
    let purgeReason = '';

    if (
      name.startsWith('konoha.db.bak') ||
      name.startsWith('skills.db.bak') ||
      name.startsWith('.konoha.db.bak') ||
      name.endsWith('.bak') ||
      name.endsWith('.backup') ||
      name.endsWith('~')
    ) {
      shouldPurge = true;
      purgeReason = 'stale backup';
    } else if (
      name === 'skills.db' ||
      name === 'skills.db-wal' ||
      name === 'skills.db-shm' ||
      name === 'skills.db.journal'
    ) {
      shouldPurge = true;
      purgeReason = 'legacy database';
    } else if (name.endsWith('.py') || name.endsWith('.pyc')) {
      shouldPurge = true;
      purgeReason = 'legacy python script';
    } else if (name.endsWith('.pid') || name === 'package-lock.json') {
      shouldPurge = true;
      purgeReason = 'stale lock/pid';
    } else if (name === 'transcript_cache.json' || name.endsWith('.log')) {
      shouldPurge = true;
      purgeReason = 'dead cache/log';
    } else if (name.endsWith('.vsix') || name === 'hook-wrapper') {
      shouldPurge = true;
      purgeReason = 'misplaced or deprecated artifact';
    } else if (name === 'cli.js') {
      shouldPurge = true;
      purgeReason = 'obsolete root cli.js (canonical in bin/cli.js)';
    } else if (name.endsWith('.js')) {
      const isKnownRuntimeFile = (
        name === 'server.js' ||
        name === 'file_tools_launcher.js'
      );
      const existsInSrc = fs.existsSync(path.join(src, name));
      if (!isKnownRuntimeFile && !existsInSrc) {
        shouldPurge = true;
        purgeReason = 'orphaned module (not in src/)';
      }
    }

    if (shouldPurge) {
      try {
        let size = 0;
        try {
          size = fs.statSync(itemPath).size;
        } catch (_) { /* non-fatal stat error */ }
        fs.unlinkSync(itemPath);
        result.purgedFiles++;
        result.reclaimedBytes += size;
        result.details.push(`${name} (${purgeReason})`);
      } catch (unlinkErr) {
        result.errors.push(`Failed to unlink ${name}: ${unlinkErr.message}`);
      }
    }
  }

  // 3. Vacuum and truncate WAL on konoha.db if enabled
  if (vacuumDb) {
    const activeDbPath = path.join(target, 'konoha.db');
    if (fs.existsSync(activeDbPath)) {
      try {
        const Database = require('better-sqlite3');
        const db = new Database(activeDbPath, { timeout: 5000 });
        try {
          db.pragma('wal_checkpoint(TRUNCATE)');
          db.exec('VACUUM');
        } finally {
          db.close();
        }
      } catch (dbErr) {
        if (!silent) {
          result.errors.push(`Database vacuum skipped: ${dbErr.message}`);
        }
      }
    }
  }

  return result;
}

module.exports = {
  HOME,
  SRC_DIR,
  SKILLS_DB_DIR,
  FILE_TOOLS_MCP_PATH,
  FILE_TOOLS_LAUNCHER_JS,
  FILE_TOOLS_LAUNCHER_PATH,
  FILE_TOOLS_NODE_PATH_FILE,
  resolveWebUiDir,
  FILE_TOOLS_PYTHON_CMD_FILE,
  FILE_TOOLS_PY_DIR,
  fileExists,
  ensureDir,
  copyIfDifferent,
  copyRecursiveIfDifferent,
  listSkillEntries,
  mirrorSkillsDirectory,
  syncCursorSkillsFromAgents,
  writeNodeExecPathRecord,
  writePythonCmdRecord,
  buildKonohaFilesMcpEntry,
  treeFingerprint,
  copySkillsDirFast,
  installFileTools,
  cleanKonohaRuntimeDir,
  parseNodeVersion,
  isNodeVersionCompatible,
  resolveCompatibleNode,
  resolveCompatibleNodeEnv,
};
