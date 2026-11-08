/**
 * Shared helpers for Konoha token-efficient file tools.
 * Pure Node.js replacement for file_tools/_common.py.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const devPaths = (() => {
  try { return require('../../bin/lib/paths'); } catch (_) { return null; }
})();
const DEV_ROOT_DEFAULT = devPaths ? devPaths.PROJECT_ROOT : null;

const SKIP_DIR_NAMES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'venv', '.venv',
  '__pycache__', '.tox', '.mypy_cache', '.pytest_cache', '.next',
  'coverage', '.nyc_output', 'target', 'go-dist', 'vendor',
  'references', '.turbo', '.cache', 'site-packages', 'third_party'
]);

const SKIP_FILE_NAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock',
  'poetry.lock', 'Gemfile.lock', 'composer.lock'
]);

const TEXT_EXTENSIONS = new Set([
  '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.md',
  '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss', '.sass',
  '.less', '.vue', '.svelte', '.go', '.rs', '.java', '.kt', '.rb',
  '.php', '.sh', '.bash', '.zsh', '.sql', '.env', '.ini', '.cfg',
  '.conf', '.txt', '.rst', '.csv', '.graphql', '.proto'
]);

function stripWinPrefix(p) {
  if (!p || typeof p !== 'string') return p;
  const prefixes = ["\\\\?\\UNC\\", "\\\\?\\unc\\", "\\\\?\\", "//?/UNC/", "//?/unc/", "//?/", "\\??\\UNC\\", "\\??\\"];
  for (const prefix of prefixes) {
    if (p.startsWith(prefix)) {
      if (prefix.toLowerCase().includes("unc")) {
        return "\\\\" + p.substring(prefix.length);
      }
      return p.substring(prefix.length);
    }
  }
  return p;
}

function isIdeInstallationDir(dirPath) {
  if (!dirPath) return false;
  const normPath = String(dirPath).replace(/\\/g, '/').toLowerCase();
  const forbidden = [
    '/appdata/local/programs/antigravity',
    '/program files/antigravity',
    '/program files (x86)/antigravity',
    '/antigravity ide',
    '/antigravity-ide'
  ];
  if (forbidden.some(x => normPath.includes(x))) return true;

  try {
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      const entries = fs.readdirSync(dirPath).map(e => e.toLowerCase());
      const hasIdeBin = entries.some(e => [
        'antigravity ide.exe',
        'antigravity.exe',
        'antigravity ide.visualelementsmanifest.xml',
        'dxcompiler.dll'
      ].includes(e)) || (entries.includes('resources.pak') && entries.includes('v8_context_snapshot.bin'));
      if (hasIdeBin) return true;
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the runtime */ }
  return false;
}

function norm(p) {
  if (!p) return '';
  let cleaned = stripWinPrefix(p);
  cleaned = path.normalize(cleaned);
  cleaned = stripWinPrefix(cleaned);
  if (process.platform === 'win32') {
    cleaned = cleaned.toLowerCase();
  }
  return cleaned;
}

let _KONOHA_HOME = null;
function getKonohaHome() {
  const dynamicHome = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const candidate = stripWinPrefix(path.resolve(path.normalize(path.join(dynamicHome, '.konoha'))));
  if (_KONOHA_HOME === null || !candidate.startsWith(_KONOHA_HOME)) {
    _KONOHA_HOME = candidate;
  }
  return candidate;
}

const TRUSTED_KONOHA_TASK_FILE_RE = /(?:^|\/)(?:\.konoha\/tmp|konoha-tmp)\/([a-zA-Z0-9_-]{1,32})\/([a-zA-Z0-9._-]{1,64})\/([a-zA-Z0-9._-]{1,96})\/scratch\/tasks\/([a-zA-Z0-9._-]{1,96})\/(walkthrough_todos\.json|status\.json|walkthrough\.md|compact_checkpoint\.json|plan\.md|final_report\.md)$/;

function isTrustedKonohaTaskReadPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return false;
  if (rawPath.includes('\0')) return false;
  const trimmed = stripWinPrefix(rawPath.trim().replace(/^file:\/\//i, ''));
  if (!trimmed || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(trimmed)) return false;

  let expanded = trimmed;
  if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    expanded = path.join(home, expanded.slice(2));
  }
  const normalizedFwd = path.resolve(expanded).replace(/\\/g, '/');
  if (!TRUSTED_KONOHA_TASK_FILE_RE.test(normalizedFwd)) {
    return false;
  }

  try {
    if (fs.existsSync(expanded)) {
      const lstat = fs.lstatSync(expanded);
      if (lstat.isSymbolicLink()) return false;
      const realFwd = stripWinPrefix(fs.realpathSync(expanded)).replace(/\\/g, '/');
      if (!TRUSTED_KONOHA_TASK_FILE_RE.test(realFwd)) return false;
    } else {
      const parentDir = path.dirname(expanded);
      if (fs.existsSync(parentDir)) {
        const lstatParent = fs.lstatSync(parentDir);
        if (lstatParent.isSymbolicLink()) return false;
      }
    }
  } catch (_) {
    return false;
  }
  return true;
}

function assertWithinAllowed(resolvedPath, baseDir = null, devRoot = null) {
  resolvedPath = stripWinPrefix(resolvedPath);
  if (baseDir) baseDir = stripWinPrefix(baseDir);
  devRoot = devRoot || DEV_ROOT_DEFAULT;

  if (isIdeInstallationDir(resolvedPath)) {
    throw new Error(`Access to IDE installation directory is forbidden: ${resolvedPath}`);
  }

  const normPath = norm(resolvedPath);
  if (isIdeInstallationDir(normPath)) {
    throw new Error(`Access to IDE installation directory is forbidden: ${resolvedPath}`);
  }

  // Verified read-only Konoha task coordination files (e.g. walkthrough_todos.json)
  if (isTrustedKonohaTaskReadPath(resolvedPath)) {
    return;
  }

  // Block sensitive Konoha key material even inside ~/.konoha
  const fwdPath = normPath.replace(/\\/g, '/');
  if (fwdPath.includes('/.konoha/keys/') || fwdPath.endsWith('/.konoha/keys')) {
    throw new Error(`Access to Konoha secret key directory is forbidden: ${resolvedPath}`);
  }

  // Konoha install directory — allowed for managed resources
  const normKonoha = norm(getKonohaHome());
  const sep = path.sep;
  if (normPath === normKonoha || normPath.startsWith(normKonoha + sep) || normPath.startsWith(normKonoha + '/')) {
    return;
  }

  // Dev repository root
  if (devRoot) {
    const normDev = norm(devRoot);
    if (normPath === normDev || normPath.startsWith(normDev + sep) || normPath.startsWith(normDev + '/')) {
      return;
    }
  }

  // Inside home-scoped agent scratch dirs
  const homeDir = os.homedir();
  const scratchPrefixes = [
    path.join(homeDir, '.gemini'),
    path.join(homeDir, '.claude'),
    path.join(homeDir, '.cursor'),
    path.join(homeDir, '.vscode'),
    path.join(homeDir, '.openai'),
    path.join(homeDir, '.windsurf'),
    path.join(homeDir, '.commandcode'),
    path.join(homeDir, '.opencode'),
    path.join(homeDir, '.config'),
    path.join(homeDir, '.codex'),
    path.join(homeDir, '.agents'),
    path.join(homeDir, '.claude.json'),
    path.join(homeDir, '.pi'),
    path.join(homeDir, '.omp'),
  ];
  for (const p of scratchPrefixes) {
    const pNorm = norm(p);
    if (normPath === pNorm || normPath.startsWith(pNorm + sep) || normPath.startsWith(pNorm + '/')) {
      return;
    }
  }

  // Inside workspace root — if provided
  const workspace = baseDir || process.cwd();
  if (!workspace) return;
  let wsReal = stripWinPrefix(workspace);
  try {
    wsReal = fs.realpathSync(path.resolve(wsReal));
  } catch (_) {
    wsReal = path.resolve(wsReal);
  }
  wsReal = stripWinPrefix(wsReal);
  const wsNorm = norm(wsReal);

  const rel = path.relative(wsNorm, normPath);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return;
  }

  throw new Error(`Path outside workspace: ${resolvedPath}`);
}

function resolvePath(rawPath, baseDir = null, devRoot = null) {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('path is required');
  }
  let p = stripWinPrefix(rawPath);
  if (baseDir) baseDir = stripWinPrefix(baseDir);
  devRoot = devRoot || DEV_ROOT_DEFAULT;

  if (p.startsWith('~/') || p === '~') {
    p = path.join(os.homedir(), p.substring(1));
  }

  let expanded;
  if (!path.isAbsolute(p)) {
    let base = baseDir && !isIdeInstallationDir(baseDir) ? baseDir : null;
    if (!base) {
      const cwd = process.cwd();
      base = !isIdeInstallationDir(cwd) ? cwd : os.homedir();
    }
    expanded = path.resolve(base, p);
  } else {
    expanded = path.resolve(p);
  }

  if (typeof rawPath === 'string' && /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(rawPath) && rawPath.includes('.konoha/tmp')) {
    throw new Error(`Path traversal forbidden in Konoha task path: ${rawPath}`);
  }
  let real;
  try {
    real = fs.realpathSync(expanded);
  } catch (_) {
    real = expanded;
  }
  real = stripWinPrefix(real);
  assertWithinAllowed(real, baseDir, devRoot);
  return real;
}

function isProbablyText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (ext === '') {
    const base = path.basename(filePath).toLowerCase();
    if (['dockerfile', 'makefile', 'readme', 'license', 'jenkinsfile', 'vagrantfile'].includes(base)) return true;
  }
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(1024);
    const bytesRead = fs.readSync(fd, buf, 0, 1024, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function* walkFiles(dirPath, skipDirs = SKIP_DIR_NAMES, skipFiles = SKIP_FILE_NAMES) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    const fullPath = path.join(dirPath, name);
    if (entry.isDirectory()) {
      if (skipDirs.has(name) || name.startsWith('.')) continue;
      yield* walkFiles(fullPath, skipDirs, skipFiles);
    } else if (entry.isFile()) {
      if (skipFiles && skipFiles.has(name)) continue;
      yield fullPath;
    }
  }
}

module.exports = {
  SKIP_DIR_NAMES,
  SKIP_FILE_NAMES,
  TEXT_EXTENSIONS,
  TRUSTED_KONOHA_TASK_FILE_RE,
  stripWinPrefix,
  isIdeInstallationDir,
  isTrustedKonohaTaskReadPath,
  norm,
  assertWithinAllowed,
  resolvePath,
  isProbablyText,
  walkFiles
};
