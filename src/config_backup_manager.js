'use strict';

/**
 * src/config_backup_manager.js — Automatic Global & Project Configuration Backup,
 * Integrity Verification, and Ownership Manifest Engine for all 8 AI Clients.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SUPPORTED_CLIENTS = [
  'antigravity',
  'cursor',
  'claude',
  'opencode',
  'commandcode',
  'codex',
  'pi',
  'omp'
];

function getHomeDir(options = {}) {
  return options.home || options.homeDir || process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function getKonohaRoot(options = {}) {
  if (options.konohaRoot) return path.resolve(options.konohaRoot);
  if (process.env.KONOHA_HOME) return path.resolve(process.env.KONOHA_HOME);
  if (process.env.KONOHA_SKILLS_DB_DIR) return path.resolve(process.env.KONOHA_SKILLS_DB_DIR);
  return path.join(getHomeDir(options), '.konoha');
}

function getBackupsRoot(options = {}) {
  return path.join(getKonohaRoot(options), 'backups');
}

function getBackupRoot(options = {}) {
  return path.join(getBackupsRoot(options), 'configs');
}

function getOwnershipManifestPath(options = {}) {
  return path.join(getBackupsRoot(options), 'ownership_manifest.json');
}

function computeSha256(contentBufferOrStr) {
  const buf = Buffer.isBuffer(contentBufferOrStr)
    ? contentBufferOrStr
    : Buffer.from(String(contentBufferOrStr || ''), 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

let _backupSeq = 0;
function formatDateStamp(now = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const yyyy = now.getUTCFullYear();
  const mm = pad(now.getUTCMonth() + 1);
  const dd = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mi = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());
  const ms = pad(now.getUTCMilliseconds(), 3);
  const seq = pad((++_backupSeq) % 1000, 3);
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}-${ms}-${seq}`;
}

function detectFormat(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.jsonc')) return 'jsonc';
  if (lower.endsWith('.json') || lower.endsWith('.code-workspace')) return 'json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.toml')) return 'toml';
  if (lower.endsWith('.xml')) return 'xml';
  return 'text';
}

function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n' || ch === '\r') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) {
        out += text[++i];
      } else if (ch === stringChar) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

function validateFileSyntax(filePath, rawContent) {
  const text = Buffer.isBuffer(rawContent) ? rawContent.toString('utf8') : String(rawContent || '');
  if (!text.trim()) return { valid: true, format: detectFormat(filePath) };

  const fmt = detectFormat(filePath);
  try {
    if (fmt === 'json') {
      JSON.parse(text);
    } else if (fmt === 'jsonc') {
      JSON.parse(stripJsonComments(text));
    } else if (fmt === 'xml') {
      const openTags = (text.match(/<[a-zA-Z0-9_:-]+(?:\s[^>]*)?(?<!\/)>/g) || []).length;
      const closeTags = (text.match(/<\/[a-zA-Z0-9_:-]+\s*>/g) || []).length;
      if (openTags > 0 && closeTags === 0 && !text.includes('/>')) {
        return { valid: false, format: fmt, error: 'Malformed XML: unclosed element tags' };
      }
    }
    return { valid: true, format: fmt };
  } catch (err) {
    return { valid: false, format: fmt, error: err.message };
  }
}

const CLIENT_REL_CONFIG_SPECS = {
  antigravity: {
    global: [
      ['.gemini', 'settings.json'],
      ['.gemini', 'GEMINI.md'],
      ['.gemini', 'config', 'mcp_config.json'],
      ['.gemini', 'antigravity', 'mcp_config.json'],
      ['.gemini', 'antigravity-ide', 'mcp_config.json'],
      ['.gemini', 'antigravity-cli', 'settings.json'],
      ['.gemini', 'antigravity-ide', 'settings.json'],
      ['.agents', 'AGENTS.md'],
      ['.agents', 'agents.yaml']
    ],
    project: [['GEMINI.md'], ['AGENTS.md'], ['.agents', 'AGENTS.md'], ['.gemini', 'settings.json']]
  },
  cursor: {
    global: [
      ['.cursor', 'mcp.json'],
      ['.cursor', 'cli-config.json'],
      ['.cursor', 'hooks.json'],
      ['.cursor', 'rules', 'konoha.mdc'],
      ['.config', 'Cursor', 'User', 'settings.json']
    ],
    project: [['.cursor', 'mcp.json'], ['.cursor', 'rules', 'konoha.mdc']]
  },
  claude: {
    global: [['.claude.json'], ['.claude', 'settings.json'], ['.claude', 'CLAUDE.md']],
    project: [['.mcp.json'], ['CLAUDE.md'], ['.claude', 'settings.json'], ['.claude', 'settings.local.json']]
  },
  opencode: {
    global: [
      ['.config', 'opencode', 'opencode.json'],
      ['.config', 'opencode', 'settings.json'],
      ['.config', 'opencode', 'AGENTS.md'],
      ['.opencode', 'opencode.json'],
      ['.opencode', 'settings.json']
    ],
    project: [['opencode.json'], ['.opencode', 'opencode.json']]
  },
  commandcode: {
    global: [['.commandcode', 'mcp.json'], ['.commandcode', 'settings.json'], ['.commandcode', 'CLAUDE.md']],
    project: [['.commandcode', 'mcp.json'], ['.commandcode', 'settings.json']]
  },
  codex: {
    global: [['.codex', 'config.toml'], ['.codex', 'AGENTS.md']],
    project: [['.codex', 'config.toml'], ['AGENTS.md']]
  },
  pi: {
    global: [['.pi', 'agent', 'mcp.json'], ['.pi', 'agent', 'settings.json'], ['.pi', 'agent', 'AGENTS.md']],
    project: [['.pi', 'mcp.json'], ['.pi', 'settings.json']]
  },
  omp: {
    global: [['.omp', 'agent', 'mcp.json'], ['.omp', 'agent', 'config.yml'], ['.omp', 'agent', 'AGENTS.md']],
    project: [['.omp', 'mcp.json'], ['.omp', 'config.yml']]
  }
};

function _joinPaths(baseDir, relPaths) {
  return relPaths.map((rel) => path.join(baseDir, ...rel));
}

function getClientConfigMap(options = {}) {
  const home = getHomeDir(options);
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : null;
  const isDistinctProject = Boolean(
    projectRoot &&
    path.resolve(projectRoot) !== path.resolve(home) &&
    fs.existsSync(projectRoot)
  );
  const out = {};
  for (const [client, spec] of Object.entries(CLIENT_REL_CONFIG_SPECS)) {
    out[client] = {
      global: _joinPaths(home, spec.global),
      project: isDistinctProject ? _joinPaths(projectRoot, spec.project) : []
    };
  }
  return out;
}

function inferClientAndScope(filePath, options = {}) {
  const norm = path.resolve(filePath).replace(/\\/g, '/');
  const home = getHomeDir(options).replace(/\\/g, '/');
  const isGlobal = norm.startsWith(home + '/') && (
    norm.slice(home.length + 1).startsWith('.') ||
    norm.slice(home.length + 1).startsWith('AppData/') ||
    norm.slice(home.length + 1).startsWith('Library/')
  );
  const scope = options.scope || (isGlobal ? 'global' : 'project');

  if (options.client && SUPPORTED_CLIENTS.includes(options.client)) {
    return { client: options.client, scope };
  }
  if (norm.includes('.cursor') || norm.includes('/Cursor/')) return { client: 'cursor', scope };
  if (norm.includes('.commandcode')) return { client: 'commandcode', scope };
  if (norm.includes('.claude') || norm.endsWith('/.mcp.json') || norm.endsWith('/CLAUDE.md')) return { client: 'claude', scope };
  if (norm.includes('opencode')) return { client: 'opencode', scope };
  if (norm.includes('.codex')) return { client: 'codex', scope };
  if (norm.includes('/.pi/')) return { client: 'pi', scope };
  if (norm.includes('/.omp/')) return { client: 'omp', scope };
  return { client: 'antigravity', scope };
}

function verifyBackupIntegrity(sourcePath, backupPath) {
  if (!fs.existsSync(sourcePath)) {
    return { ok: true, skipped: true };
  }
  if (!backupPath || !fs.existsSync(backupPath)) {
    return { ok: false, error: `Backup file missing: ${backupPath}` };
  }
  try {
    const srcBuf = fs.readFileSync(sourcePath);
    const bakBuf = fs.readFileSync(backupPath);
    if (srcBuf.length !== bakBuf.length) {
      return { ok: false, error: `Backup size mismatch (${bakBuf.length} vs ${srcBuf.length} bytes)` };
    }
    const srcHash = computeSha256(srcBuf);
    const bakHash = computeSha256(bakBuf);
    if (srcHash !== bakHash) {
      return { ok: false, error: `Backup SHA-256 mismatch (${bakHash} vs ${srcHash})` };
    }
    return { ok: true, sha256: bakHash, size: bakBuf.length };
  } catch (err) {
    return { ok: false, error: `Backup verification read failed: ${err.message}` };
  }
}

function loadOwnershipManifest(options = {}) {
  const manifestPath = getOwnershipManifestPath(options);
  try {
    if (fs.existsSync(manifestPath)) {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.files) return parsed;
    }
  } catch (_) { /* return fresh manifest on parse failure */ }
  return { version: 1, updated_at: new Date().toISOString(), files: {} };
}

function saveOwnershipManifest(manifest, options = {}) {
  const manifestPath = getOwnershipManifestPath(options);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  manifest.updated_at = new Date().toISOString();
  const tmpPath = `${manifestPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, manifestPath);
}

function _appendBackupHistory(existing, backupPath, sha256) {
  if (!backupPath) return;
  existing.latest_backup = backupPath;
  existing.latest_sha256 = sha256 || null;
  if (!existing.backups.includes(backupPath)) {
    existing.backups.push(backupPath);
    if (existing.backups.length > 25) {
      existing.backups = existing.backups.slice(-25);
    }
  }
}

function recordOwnership(filePath, metadata = {}, options = {}) {
  const absPath = path.resolve(filePath);
  const { client, scope } = inferClientAndScope(absPath, metadata);
  const manifest = loadOwnershipManifest(options);
  const existing = manifest.files[absPath] || {
    client,
    scope,
    created_by_konoha: false,
    owned_keys: [],
    owned_sections: [],
    backups: []
  };

  if (metadata.createdByKonoha === true && existing.backups.length === 0) {
    existing.created_by_konoha = true;
  }
  if (Array.isArray(metadata.ownedKeys) || Array.isArray(metadata.keysOwned)) {
    const kList = metadata.ownedKeys || metadata.keysOwned || [];
    existing.owned_keys = Array.from(new Set([...(existing.owned_keys || []), ...kList]));
  }
  if (Array.isArray(metadata.ownedSections)) {
    existing.owned_sections = Array.from(new Set([...(existing.owned_sections || []), ...metadata.ownedSections]));
  }
  _appendBackupHistory(existing, metadata.backupPath, metadata.sha256);
  existing.updated_at = new Date().toISOString();
  manifest.files[absPath] = existing;
  saveOwnershipManifest(manifest, options);
  return existing;
}

function backupConfigFile(filePath, options = {}) {
  const absPath = path.resolve(filePath);
  const { client, scope } = inferClientAndScope(absPath, options);
  if (!fs.existsSync(absPath)) {
    recordOwnership(absPath, { client, scope, createdByKonoha: true }, options);
    return { ok: true, existed: false, client, scope, backupPath: null };
  }

  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (err) {
    return { ok: false, error: `Cannot stat config file ${absPath}: ${err.message}` };
  }
  if (!stat.isFile()) {
    return { ok: true, existed: false, client, scope, backupPath: null };
  }

  if (options.simulateBackupFailure === true || process.env.KONOHA_SIMULATE_BACKUP_FAILURE === '1') {
    throw new Error(`Simulated backup verification failure for ${absPath}`);
  }

  const srcBuf = fs.readFileSync(absPath);
  const sha8 = computeSha256(srcBuf).slice(0, 8);
  const stamp = formatDateStamp();
  const safeBase = path.basename(absPath).replace(/[^a-zA-Z0-9._-]/g, '_');
  const pathHash = crypto.createHash('sha256').update(absPath).digest('hex').slice(0, 6);
  const backupDir = path.join(getBackupsRoot(options), 'configs', client, scope);
  fs.mkdirSync(backupDir, { recursive: true });

  const backupName = `${stamp}-${pathHash}-${sha8}-${safeBase}.bak`;
  const backupPath = path.join(backupDir, backupName);
  fs.writeFileSync(backupPath, srcBuf);

  const verification = verifyBackupIntegrity(absPath, backupPath);
  if (!verification.ok) {
    throw new Error(`Configuration backup integrity check failed for ${absPath}: ${verification.error}`);
  }

  recordOwnership(absPath, {
    client,
    scope,
    backupPath,
    sha256: verification.sha256
  }, options);

  return {
    ok: true,
    existed: true,
    backedUp: true,
    client,
    scope,
    sourcePath: absPath,
    backupPath,
    sha256: verification.sha256,
    size: verification.size
  };
}

function _backupScopeFiles(filePaths, client, scope, options, results) {
  for (const filePath of (filePaths || [])) {
    if (!fs.existsSync(filePath)) continue;
    results.push(backupConfigFile(filePath, { ...options, client, scope }));
  }
}

function _resolveTargetClients(clientsInput) {
  if (!clientsInput || clientsInput === 'all') return [...SUPPORTED_CLIENTS];
  const rawList = Array.isArray(clientsInput) ? clientsInput : String(clientsInput).split(',');
  const normalized = rawList
    .map(c => String(c || '').trim().toLowerCase())
    .map(c => (c === 'claude-code' ? 'claude' : c === 'command-code' ? 'commandcode' : c === 'gemini' ? 'antigravity' : c))
    .filter(Boolean);
  if (normalized.includes('all')) return [...SUPPORTED_CLIENTS];
  return normalized.filter(c => SUPPORTED_CLIENTS.includes(c));
}

function backupClientConfigs(clientsInput, options = {}) {
  const targetClients = _resolveTargetClients(clientsInput);
  const configMap = getClientConfigMap(options);
  const scopeFilter = options.scope || 'all';
  const includeGlobal = options.includeGlobal !== false && (scopeFilter === 'all' || scopeFilter === 'global');
  const includeProject = options.includeProject !== false && (scopeFilter === 'all' || scopeFilter === 'project');
  const results = [];

  for (const client of targetClients) {
    const scopes = configMap[client] || { global: [], project: [] };
    if (includeGlobal) {
      _backupScopeFiles(scopes.global, client, 'global', options, results);
    }
    if (includeProject) {
      _backupScopeFiles(scopes.project, client, 'project', options, results);
    }
  }
  return {
    ok: true,
    clients: targetClients,
    backedUpCount: results.filter(r => r.existed).length,
    backups: results
  };
}

function backupAllDetectedClients(options = {}) {
  return backupClientConfigs('all', options);
}

function _matchesBackupFilter(meta, targetClients, scopeFilter) {
  if (!meta) return false;
  if (!targetClients.includes(meta.client)) return false;
  if (scopeFilter !== 'all' && meta.scope !== scopeFilter) return false;
  return true;
}

function listClientBackups(options = {}) {
  const manifest = loadOwnershipManifest(options);
  const targetClients = _resolveTargetClients(options.client || options.clients || 'all');
  const scopeFilter = options.scope || 'all';
  const entries = [];

  for (const [sourcePath, meta] of Object.entries(manifest.files || {})) {
    if (!_matchesBackupFilter(meta, targetClients, scopeFilter)) continue;
    const backups = Array.isArray(meta.backups) ? meta.backups.filter(b => fs.existsSync(b)) : [];
    const latestBackup = meta.latest_backup && fs.existsSync(meta.latest_backup)
      ? meta.latest_backup
      : (backups[backups.length - 1] || null);
    entries.push({
      sourcePath,
      client: meta.client,
      scope: meta.scope,
      createdByKonoha: Boolean(meta.created_by_konoha),
      latestBackup,
      latestSha256: meta.latest_sha256 || null,
      backupCount: backups.length,
      backups
    });
  }
  return entries;
}

function _restoreSingleManifestEntry(entry, restored, removedCreated) {
  if (entry.latestBackup && fs.existsSync(entry.latestBackup)) {
    fs.mkdirSync(path.dirname(entry.sourcePath), { recursive: true });
    fs.copyFileSync(entry.latestBackup, entry.sourcePath);
    const check = verifyBackupIntegrity(entry.sourcePath, entry.latestBackup);
    if (!check.ok) {
      throw new Error(`Restore integrity check failed for ${entry.sourcePath}: ${check.error}`);
    }
    restored.push({
      sourcePath: entry.sourcePath,
      backupPath: entry.latestBackup,
      client: entry.client,
      scope: entry.scope,
      sha256: check.sha256
    });
    return;
  }
  if (entry.createdByKonoha && fs.existsSync(entry.sourcePath)) {
    fs.unlinkSync(entry.sourcePath);
    removedCreated.push(entry.sourcePath);
  }
}

function restoreLatestClientBackups(options = {}) {
  const entries = listClientBackups(options);
  const restored = [];
  const removedCreated = [];
  for (const entry of entries) {
    _restoreSingleManifestEntry(entry, restored, removedCreated);
  }
  return {
    ok: true,
    restoredCount: restored.length,
    removedCreatedCount: removedCreated.length,
    restored,
    removedCreated
  };
}

function _restoreBatchItem(item, restored) {
  if (!item || !item.sourcePath || !item.existed || !item.backupPath) return;
  if (!fs.existsSync(item.backupPath)) return;
  const check = verifyBackupIntegrity(item.backupPath, item.backupPath);
  if (check.ok) {
    fs.mkdirSync(path.dirname(item.sourcePath), { recursive: true });
    fs.copyFileSync(item.backupPath, item.sourcePath);
    restored.push(item.sourcePath);
  }
}

function restoreFromBackupSnapshot(backupBatchOrPath, targetPathOrOptions = {}) {
  if (typeof backupBatchOrPath === 'string' && typeof targetPathOrOptions === 'string') {
    if (!fs.existsSync(backupBatchOrPath)) {
      return { ok: false, error: `Backup snapshot not found: ${backupBatchOrPath}` };
    }
    fs.mkdirSync(path.dirname(targetPathOrOptions), { recursive: true });
    fs.copyFileSync(backupBatchOrPath, targetPathOrOptions);
    return { ok: true, restored: [targetPathOrOptions] };
  }
  const restored = [];
  const items = Array.isArray(backupBatchOrPath) ? backupBatchOrPath : (backupBatchOrPath && backupBatchOrPath.backups) || [];
  for (const item of items) {
    _restoreBatchItem(item, restored);
  }
  return { ok: true, restored, options: targetPathOrOptions };
}

module.exports = {
  SUPPORTED_CLIENTS,
  getHomeDir,
  getKonohaRoot,
  getBackupsRoot,
  getBackupRoot,
  getOwnershipManifestPath,
  computeSha256,
  detectFormat,
  stripJsonComments,
  validateFileSyntax,
  getClientConfigMap,
  inferClientAndScope,
  verifyBackupIntegrity,
  loadOwnershipManifest,
  saveOwnershipManifest,
  recordOwnership,
  backupConfigFile,
  backupClientConfigs,
  backupAllDetectedClients,
  listClientBackups,
  restoreLatestClientBackups,
  restoreFromBackupSnapshot
};
