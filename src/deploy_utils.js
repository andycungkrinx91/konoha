/**
 * Shared install/deploy helpers for Konoha CLI and Cursor bootstrap.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
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
function copySkillsDirFast(srcRoot, destRoot) {
  if (!fs.existsSync(srcRoot)) return;
  ensureDir(destRoot);
  const srcFp = treeFingerprint(srcRoot);
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
    command: (mode === "cursor" || mode === "global") ? "node" : (process.execPath || "node"),
    args: [useJsLauncher ? FILE_TOOLS_LAUNCHER_JS : FILE_TOOLS_MCP_PATH],
    env: {
      ACTIVE_CLIENT: clientName,
      KONOHA_CLIENT: clientName
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
    "server.py",
    "migrate.py",
    "tools_savings_logger.py",
    "platform_utils.js",
    "yaml_parser.py",
    "db_bridges.py",
    "db_agents.py",
    "circuit_breaker.py",
    "persona_memory.py",
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

  const srcPyDir = path.join(SRC_DIR, "file_tools");
  if (fileExists(srcPyDir)) {
    copyRecursiveIfDifferent(srcPyDir, FILE_TOOLS_PY_DIR);
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
              },
            },
            null,
            2,
          ) + "\n",
        );
      }
      if (!fileExists(nodeModulesPath)) {
        const manager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
        execFileSync(manager, ["install", "--prod", "--no-frozen-lockfile"], {
          cwd: SKILLS_DB_DIR,
          stdio: "ignore",
        });
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
