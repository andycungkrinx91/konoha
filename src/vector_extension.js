'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SQLITE_VECTOR_VERSION = "1.1.0";
const VECTOR_DIMENSION = 384;

let _EXTENSION_FAILED_ONCE = false;
const _LOADED_CONNECTIONS = new WeakSet();

function getPlatformTag(sys = process.platform, mArch = process.arch) {
  let s = (sys || '').toLowerCase();
  if (s === 'win32' || s === 'windows') s = 'windows';
  else if (s === 'darwin' || s === 'macos') s = 'darwin';
  else if (s === 'linux') s = 'linux';

  let a = (mArch || '').toLowerCase();
  if (['x86_64', 'amd64', 'x64'].includes(a)) a = 'x64';
  else if (['aarch64', 'arm64'].includes(a)) a = 'arm64';

  return `${s}-${a}`;
}

function getPlatformAssetInfo(sys = process.platform, mArch = process.arch) {
  let s = (sys || '').toLowerCase();
  if (s === 'win32' || s === 'windows') s = 'win32';
  else if (s === 'darwin' || s === 'macos') s = 'darwin';
  else if (s === 'linux') s = 'linux';

  let a = (mArch || '').toLowerCase();
  if (['x86_64', 'amd64', 'x64'].includes(a)) a = 'x64';
  else if (['aarch64', 'arm64'].includes(a)) a = 'arm64';

  if (s === 'linux') {
    if (a === 'x64') return [`vector-linux-x86_64-${SQLITE_VECTOR_VERSION}.tar.gz`, "vector.so"];
    if (a === 'arm64') return [`vector-linux-arm64-${SQLITE_VECTOR_VERSION}.tar.gz`, "vector.so"];
  } else if (s === 'darwin') {
    if (a === 'arm64') return [`vector-macos-arm64-${SQLITE_VECTOR_VERSION}.tar.gz`, "vector.dylib"];
    if (a === 'x64') return [`vector-macos-x86_64-${SQLITE_VECTOR_VERSION}.tar.gz`, "vector.dylib"];
  } else if (s === 'win32') {
    if (a === 'x64') return [`vector-windows-x86_64-${SQLITE_VECTOR_VERSION}.zip`, "vector.dll"];
  }
  return [null, null];
}

function getVendorDir() {
  const custom = process.env.KONOHA_SQLITE_VEC_DIR;
  if (custom && fs.existsSync(custom)) {
    return path.resolve(custom);
  }
  return path.join(os.homedir(), ".konoha", "vendor");
}

function findExtensionFile(candidateDirs, libName) {
  for (const cDir of candidateDirs) {
    const targetFile = path.join(cDir, libName);
    if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
      return targetFile;
    }
  }
  return null;
}

function ensureVectorExtension() {
  if (_EXTENSION_FAILED_ONCE) return null;
  const [assetName, libName] = getPlatformAssetInfo();
  if (!assetName || !libName) return null;

  const tag = getPlatformTag();
  const repoRoot = path.dirname(__dirname);

  const candidateDirs = [
    path.join(repoRoot, "vendor", "sqlite-vector", tag),
    path.join(repoRoot, "vendor", "sqlite-vector", process.platform),
    path.join(repoRoot, "vendor", "sqlite-vector"),
    path.join(getVendorDir(), tag),
    path.join(getVendorDir(), process.platform),
    getVendorDir()
  ];

  return findExtensionFile(candidateDirs, libName);
}

function loadVectorExtension(conn) {
  if (_LOADED_CONNECTIONS.has(conn)) return true;

  const extPath = ensureVectorExtension();
  if (!extPath || !fs.existsSync(extPath)) return false;

  try {
    conn.loadExtension(extPath);
    _LOADED_CONNECTIONS.add(conn);
    return true;
  } catch (_) {
    _EXTENSION_FAILED_ONCE = true;
    return false;
  }
}

function initVectorTableIfSupported(conn) {
  if (!loadVectorExtension(conn)) return false;
  try {
    conn.prepare(
      `SELECT vector_init('skill_chunks', 'embedding', 'type=FLOAT32,dimension=${VECTOR_DIMENSION},distance=COSINE,normalized=1');`
    ).get();
    return true;
  } catch (_) {
    return false;
  }
}

function enableLoadExtensionSafe(conn) {
  try {
    if (conn && typeof conn.loadExtension === 'function') {
      conn.loadExtension('');
      return true;
    }
    if (conn && typeof conn.enable_load_extension === 'function') {
      conn.enable_load_extension(true);
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

module.exports = {
  SQLITE_VECTOR_VERSION,
  VECTOR_DIMENSION,
  getPlatformTag,
  getPlatformAssetInfo,
  getVendorDir,
  ensureVectorExtension,
  loadVectorExtension,
  initVectorTableIfSupported,
  enableLoadExtensionSafe
};
