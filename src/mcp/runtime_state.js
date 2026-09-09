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

const HOME = os.homedir();
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

function konohaTmp(client, sessionId) {
  return path.join(KONOHA_DIR, "tmp", client, sessionId);
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

  const normalizedSlashPath = normFp.replace(/\\/g, "/");
  if (
    normalizedSlashPath.includes(".agents/skills") ||
    normalizedSlashPath.includes(".cursor/skills") ||
    normalizedSlashPath.includes(".gemini/skills") ||
    normalizedSlashPath.includes(".konoha/skills") ||
    normalizedSlashPath.includes("/skills/") ||
    normalizedSlashPath.includes("/docs/skills")
  ) {
    return true;
  }

  const globalAgents = normCase(AGENTS_DIR);
  const globalGemini = normCase(GEMINI_DIR);
  const globalKonoha = normCase(KONOHA_DIR);

  const workspace = getWorkspaceRoot() || process.cwd();
  const currentWorkspace = normCase(workspace);
  const homeDir = normCase(HOME);

  const isGenericWorkspace = (
    currentWorkspace === homeDir ||
    currentWorkspace === normCase("/") ||
    (process.platform === "win32" && currentWorkspace.length <= 3)
  );

  const sep = path.sep;
  if (normFp.startsWith(globalAgents + sep) || normFp === globalAgents) return true;
  if (normFp.startsWith(globalGemini + sep) || normFp === globalGemini) return true;
  if (normFp.startsWith(globalKonoha + sep) || normFp === globalKonoha) return true;

  if (!isGenericWorkspace) {
    if (normFp.startsWith(currentWorkspace + sep) || normFp === currentWorkspace) return true;
    const parentWs = path.dirname(currentWorkspace);
    if (parentWs !== homeDir && parentWs !== normCase("/") && (normFp.startsWith(parentWs + sep) || normFp === parentWs)) {
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
