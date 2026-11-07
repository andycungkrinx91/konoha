/**
 * src/mcp/runtime_state.js — Shared runtime state and path visibility utilities.
 * 
 * CRITICAL INVARIANT (PLAN_REFACTOR.md §2):
 * No module may ever export a mutable primitive by value.
 * WORKSPACE_ROOT and ACTIVE_CLIENT are kept strictly private inside this module closure.
 * Access is permitted ONLY via getWorkspaceRoot/setWorkspaceRoot and getActiveClient/setActiveClient.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const KONOHA_DIR = path.join(HOME, ".konoha");
const AGENTS_DIR = path.join(HOME, ".agents");
const GEMINI_DIR = path.join(HOME, ".gemini");
const CURSOR_DIR = path.join(HOME, ".cursor");
const CLAUDE_DIR = path.join(HOME, ".claude");

function isIdeInstallationDir(dirPath) {
  if (!dirPath) return false;
  const norm = String(dirPath).replace(/\\/g, "/").toLowerCase();
  const forbidden = [
    "/appdata/local/programs/antigravity",
    "/program files/antigravity",
    "/program files (x86)/antigravity",
    "/antigravity ide",
    "/antigravity-ide"
  ];
  if (forbidden.some(x => norm.includes(x))) return true;
  try {
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      const entries = fs.readdirSync(dirPath).map(e => e.toLowerCase());
      const hasIdeBin = entries.some(e => [
        "antigravity ide.exe",
        "antigravity.exe",
        "antigravity ide.visualelementsmanifest.xml",
        "dxcompiler.dll"
      ].includes(e)) || (entries.includes("resources.pak") && entries.includes("v8_context_snapshot.bin"));
      if (hasIdeBin) return true;
    }
  } catch (_) { /* ignore */ }
  return false;
}

let _rawWs = process.env.WORKSPACE_ROOT || process.env.KONOHA_WORKSPACE || null;
let _WORKSPACE_ROOT = (!_rawWs || isIdeInstallationDir(_rawWs))
  ? (!isIdeInstallationDir(process.cwd()) ? process.cwd() : null)
  : _rawWs;
let _ACTIVE_CLIENT = process.env.ACTIVE_CLIENT || process.env.KONOHA_CLIENT || null;
let _ACTIVE_SESSION_ID = process.env.ANTIGRAVITY_CONVERSATION_ID ||
  process.env.CLAUDE_CONVERSATION_ID ||
  process.env.PI_SESSION_ID ||
  process.env.CURSOR_SESSION_ID ||
  process.env.OPENCODE_SESSION_ID ||
  process.env.COMMANDCODE_SESSION_ID ||
  process.env.SESSION_ID ||
  null;

function getWorkspaceRoot() {
  return _WORKSPACE_ROOT;
}

function setWorkspaceRoot(val) {
  _WORKSPACE_ROOT = val;
}

function getActiveClient() {
  return _ACTIVE_CLIENT;
}

function setActiveClient(val) {
  _ACTIVE_CLIENT = val;
}

function getActiveSessionId() {
  return _ACTIVE_SESSION_ID;
}

function setActiveSessionId(val) {
  _ACTIVE_SESSION_ID = val;
}

function konohaTmp(client = 'universal', arg2 = 'global', arg3 = null) {
  if (arg3 !== null) {
    return path.join(KONOHA_DIR, "tmp", client || 'universal', arg2 || 'global', arg3 || 'default');
  }
  return path.join(KONOHA_DIR, "tmp", client || 'universal', arg2 || 'default');
}

function uriToPath(uri) {
  if (!uri) return null;
  try {
    let p = uri;
    if (p.startsWith("file://")) {
      try {
        const url = new URL(p);
        const decodedPath = decodeURIComponent(url.pathname);
        // Preserve UNC hosts: file://server/share → \\server\share (Windows)
        p = url.host ? `//${url.host}${decodedPath}` : decodedPath;
      } catch (_) {
        p = decodeURIComponent(p.substring(7));
      }
    } else if (p.startsWith("file:/")) {
      p = decodeURIComponent(p.substring(5));
    } else {
      p = decodeURIComponent(p);
    }
    if (process.platform === "win32" && p.startsWith("/") && p.length > 2 && p[2] === ":") {
      p = p.substring(1);
    }
    return path.normalize(p);
  } catch (_) {
    return uri;
  }
}

function normCase(p) {
  if (!p) return "";
  let res = path.resolve(p);
  if (process.platform === "win32") res = res.toLowerCase();
  return res;
}

function isPathVisible(filePath) {
  if (!filePath) return true;
  const normFp = normCase(filePath);
  if (isIdeInstallationDir(normFp)) return false;

  const currentHome = process.env.HOME || process.env.USERPROFILE || HOME;
  const homeDir = normCase(currentHome);
  const sep = path.sep;

  const globalAllowedRoots = [
    normCase(path.join(currentHome, ".agents")),
    normCase(path.join(currentHome, ".konoha")),
    normCase(path.join(currentHome, ".gemini")),
    normCase(path.join(currentHome, ".cursor")),
    normCase(path.join(currentHome, ".claude")),
    normCase(path.join(currentHome, ".commandcode")),
    normCase(path.join(currentHome, ".codex")),
    normCase(path.join(currentHome, ".config", "opencode")),
    normCase(path.join(currentHome, ".opencode")),
    normCase(path.join(currentHome, ".pi")),
    normCase(path.join(currentHome, ".omp")),
    normCase(AGENTS_DIR),
    normCase(GEMINI_DIR),
    normCase(KONOHA_DIR),
    normCase(path.resolve(__dirname, "..", "templates"))
  ];

  for (const gRoot of globalAllowedRoots) {
    if (gRoot && (normFp === gRoot || normFp.startsWith(gRoot + sep))) {
      return true;
    }
  }

  const workspace = getWorkspaceRoot() || process.env.KONOHA_WORKSPACE || process.env.WORKSPACE_ROOT || process.cwd();
  const currentWorkspace = normCase(workspace);

  const isGenericWorkspace = (
    currentWorkspace === homeDir ||
    currentWorkspace === normCase("/") ||
    (process.platform === "win32" && currentWorkspace.length <= 3)
  );

  if (!isGenericWorkspace) {
    if (normFp === currentWorkspace || normFp.startsWith(currentWorkspace + sep)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  getWorkspaceRoot,
  setWorkspaceRoot,
  getActiveClient,
  setActiveClient,
  getActiveSessionId,
  setActiveSessionId,
  konohaTmp,
  uriToPath,
  isIdeInstallationDir,
  normCase,
  isPathVisible,
  HOME,
  KONOHA_DIR,
  AGENTS_DIR,
  GEMINI_DIR,
  CURSOR_DIR,
  CLAUDE_DIR
};
