/**
 * Shared install/deploy helpers for Konoha CLI and Cursor bootstrap.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
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
  } catch (_) {}

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
        } catch (_) {}
      }
      if (!qualifies && fs.existsSync(path.join(dir, "build", "handler.js"))) qualifies = true;
      if (qualifies) qualifying.push({ dir, hasSources });
    } catch (_) {}
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
    } catch {}
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
  } catch {}
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
      } catch {}
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
  try { destFp = fs.readFileSync(fpMarker, 'utf-8').trim(); } catch {}
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
  try { fs.writeFileSync(fpMarker, srcFp, 'utf-8'); } catch {}
}

function mirrorSkillsDirectory(srcDir, destDir) {
  return 0;
}

function syncCursorSkillsFromAgents(options = {}) {
  return 0;
}

function writeNodeExecPathRecord() {
  try {
    const nodePath = process.execPath || "node";
    fs.writeFileSync(FILE_TOOLS_NODE_PATH_FILE, `${nodePath}\n`);
  } catch {}
}

function writePythonCmdRecord(pythonCmd) {
  const cmd = pythonCmd || detectPythonOrDefault();
  try {
    fs.writeFileSync(
      FILE_TOOLS_PYTHON_CMD_FILE,
      `${Array.isArray(cmd) ? JSON.stringify(cmd) : cmd}\n`,
    );
  } catch {}
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

function buildKonohaMcpEntry(mode = "execPath") {
  return buildKonohaFilesMcpEntry(mode);
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

  const launcherShSrc = path.join(SRC_DIR, "file_tools_launcher.sh");
  if (fileExists(launcherShSrc)) {
    copyIfDifferent(launcherShSrc, FILE_TOOLS_LAUNCHER_PATH);
    if (!IS_WIN) {
      try {
        fs.chmodSync(FILE_TOOLS_LAUNCHER_PATH, 0o755);
      } catch {}
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
        for (const pm of pmCandidates) {
          try {
            execFileSync(pm.cmd, pm.args, {
              cwd: SKILLS_DB_DIR,
              stdio: "ignore",
              shell: isWin,
              timeout: 300000,
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
  buildKonohaMcpEntry,
  treeFingerprint,
  copySkillsDirFast,
  installFileTools,
};
