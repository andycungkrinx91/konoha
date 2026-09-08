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
  } catch (_) {}
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
  if (_KONOHA_HOME === null) {
    _KONOHA_HOME = stripWinPrefix(path.resolve(path.normalize(path.join(os.homedir(), '.konoha'))));
  }
  return _KONOHA_HOME;
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

  // 1. Konoha install directory — always allowed
  const normKonoha = norm(getKonohaHome());
  const sep = path.sep;
  if (normPath === normKonoha || normPath.startsWith(normKonoha + sep) || normPath.startsWith(normKonoha + '/')) {
    return;
  }

  // 1b. Dev repository root
  if (devRoot) {
    const normDev = norm(devRoot);
    if (normPath === normDev || normPath.startsWith(normDev + sep) || normPath.startsWith(normDev + '/')) {
      return;
    }
  }

  // 1.5. Inside home-scoped agent scratch dirs
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
  ];
  for (const p of scratchPrefixes) {
    const pNorm = norm(p);
    if (normPath === pNorm || normPath.startsWith(pNorm + sep) || normPath.startsWith(pNorm + '/')) {
      return;
    }
  }

  // 2. Inside workspace root — if provided
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
  stripWinPrefix,
  isIdeInstallationDir,
  norm,
  assertWithinAllowed,
  resolvePath,
  isProbablyText,
  walkFiles
};
