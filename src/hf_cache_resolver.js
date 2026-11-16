'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SEMANTIC_SEARCH_ENV = 'KONOHA_SEMANTIC_SEARCH';

/**
 * Returns true unless KONOHA_SEMANTIC_SEARCH is explicitly disabled via env.
 * @returns {boolean}
 */
function isSemanticSearchEnabled() {
  const val = process.env[SEMANTIC_SEARCH_ENV];
  if (typeof val !== 'string') return true;
  const normalized = val.trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(normalized);
}

/**
 * Resolves explicit HuggingFace cache directory overrides from env vars.
 * @returns {string|null}
 */
function resolveHfCacheOverride() {
  const hubCache = process.env.HF_HUB_CACHE || process.env.HUGGINGFACE_HUB_CACHE;
  if (typeof hubCache === 'string' && hubCache.trim()) {
    return path.resolve(hubCache.trim());
  }
  const hfHome = process.env.HF_HOME;
  if (typeof hfHome === 'string' && hfHome.trim()) {
    return path.join(path.resolve(hfHome.trim()), 'hub');
  }
  return null;
}

/**
 * Returns true when HuggingFace offline mode is enabled in env.
 * @returns {boolean}
 */
function isHfOffline() {
  for (const key of ['HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE']) {
    const raw = process.env[key];
    if (typeof raw === 'string' && ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the default Python/standard HuggingFace hub cache directory.
 * @returns {string|null}
 */
function resolveStandardHfHubCacheDir() {
  const xdgCache = process.env.XDG_CACHE_HOME;
  if (typeof xdgCache === 'string' && xdgCache.trim()) {
    return path.join(path.resolve(xdgCache.trim()), 'huggingface', 'hub');
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return homeDir ? path.join(path.resolve(homeDir), '.cache', 'huggingface', 'hub') : null;
}

/**
 * Resolves the @huggingface/transformers package-local cache directory.
 * @param {string|null} [defaultCacheDir=null]
 * @returns {string|null}
 */
function resolveDefaultPackageCacheDir(defaultCacheDir = null) {
  if (defaultCacheDir) return defaultCacheDir;
  try {
    return path.join(path.dirname(require.resolve('@huggingface/transformers/package.json')), '.cache');
  } catch (_) {
    return null;
  }
}

/**
 * Returns ordered candidate cache directories to inspect for offline models.
 * @param {string|null} [defaultCacheDir=null]
 * @returns {string[]}
 */
function resolveCacheSearchDirs(defaultCacheDir = null) {
  const override = resolveHfCacheOverride();
  if (override) return [override];
  const dirs = [];
  const pkgCache = resolveDefaultPackageCacheDir(defaultCacheDir);
  if (pkgCache) dirs.push(pkgCache);
  const stdCache = resolveStandardHfHubCacheDir();
  if (stdCache && !dirs.includes(stdCache)) dirs.push(stdCache);
  return dirs;
}

/**
 * Applies current env cache/offline settings onto @huggingface/transformers env.
 * @param {object} hfEnv
 * @param {string|null} [defaultCacheDir=null]
 * @param {boolean} [defaultAllowRemote=true]
 * @returns {{ offline: boolean, cacheDir: string|null }}
 */
function configureHfEnv(hfEnv, defaultCacheDir = null, defaultAllowRemote = true) {
  const cacheOverride = resolveHfCacheOverride();
  hfEnv.cacheDir = cacheOverride !== null ? cacheOverride : defaultCacheDir;
  hfEnv.allowLocalModels = true;
  const offline = isHfOffline();
  hfEnv.allowRemoteModels = offline ? false : defaultAllowRemote;
  return { offline, cacheDir: hfEnv.cacheDir };
}

/**
 * Returns true if a model directory contains config.json or non-empty artifact subdirectories.
 * @param {string} dir
 * @returns {boolean}
 */
function dirHasModelArtifacts(dir) {
  try {
    if (!fs.existsSync(dir)) return false;
    return fs.existsSync(path.join(dir, 'config.json'));
  } catch (_) {
    /* uncached or unreadable */
  }
  return false;
}

/**
 * Resolves a valid HuggingFace Hub snapshot directory inside a models--<org>--<repo> folder.
 * Honors refs/main first, then falls back to scanning snapshots/.
 * @param {string} hubRepoDir
 * @returns {string|null}
 */
function resolveHubSnapshotDir(hubRepoDir) {
  const snapshotsDir = path.join(hubRepoDir, 'snapshots');
  if (!fs.existsSync(snapshotsDir)) return null;
  const candidates = [];
  const mainRefPath = path.join(hubRepoDir, 'refs', 'main');
  try {
    if (fs.existsSync(mainRefPath)) {
      const rev = fs.readFileSync(mainRefPath, 'utf8').trim();
      if (rev && !rev.includes('/') && !rev.includes('\\') && rev !== '..' && rev !== '.') {
        candidates.push(path.join(snapshotsDir, rev));
      }
    }
  } catch (_) {
    /* refs/main optional */
  }
  try {
    for (const entry of fs.readdirSync(snapshotsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const snapPath = path.join(snapshotsDir, entry.name);
        if (!candidates.includes(snapPath)) candidates.push(snapPath);
      }
    }
  } catch (_) {
    /* unreadable snapshots */
  }
  for (const snapPath of candidates) {
    if (dirHasModelArtifacts(snapPath)) return snapPath;
  }
  return null;
}

/**
 * Locates a cached model repository across FileCache and HuggingFace Hub snapshot layouts.
 * @param {string|string[]} cacheDirs
 * @param {string} repo
 * @returns {{ layout: string, cacheDir: string, modelRef: string }|null}
 */
function resolveCachedRepoLocation(cacheDirs, repo) {
  if (!cacheDirs || !repo) return null;
  const dirs = Array.isArray(cacheDirs) ? cacheDirs : [cacheDirs];
  for (const cacheDir of dirs) {
    if (!cacheDir) continue;
    const directDir = path.join(cacheDir, ...String(repo).split('/'));
    if (dirHasModelArtifacts(directDir)) {
      return { layout: 'filecache', cacheDir, modelRef: repo };
    }
    const hubRepoDir = path.join(cacheDir, `models--${String(repo).replace('/', '--')}`);
    const snapDir = resolveHubSnapshotDir(hubRepoDir);
    if (snapDir) {
      return { layout: 'hf_hub_snapshot', cacheDir, modelRef: snapDir };
    }
  }
  return null;
}

/**
 * Returns true when a cached model exists in any supported layout under cacheDirs.
 * @param {string|string[]} cacheDirs
 * @param {string} repo
 * @returns {boolean}
 */
function hasCachedRepoFiles(cacheDirs, repo) {
  return Boolean(resolveCachedRepoLocation(cacheDirs, repo));
}

module.exports = {
  SEMANTIC_SEARCH_ENV,
  isSemanticSearchEnabled,
  resolveHfCacheOverride,
  isHfOffline,
  resolveStandardHfHubCacheDir,
  resolveDefaultPackageCacheDir,
  resolveCacheSearchDirs,
  configureHfEnv,
  dirHasModelArtifacts,
  resolveHubSnapshotDir,
  resolveCachedRepoLocation,
  hasCachedRepoFiles,
};
