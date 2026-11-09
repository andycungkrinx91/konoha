'use strict';

/**
 * src/config_backup_manager.js — Automatic Global & Project Configuration Backup,
 * Integrity Verification, and Ownership Manifest Engine for all 8 AI Clients.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SUPPORTED_CLIENTS = ['antigravity', 'cursor', 'claude', 'opencode', 'commandcode', 'codex', 'pi', 'omp'];

function _normOpts(options) {
  if (!options) return {};
  if (typeof options === 'string') return { konohaRoot: options };
  return typeof options === 'object' ? options : {};
}

function getHomeDir(options = {}) {
  const opts = _normOpts(options);
  return opts.home || opts.homeDir || process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function getKonohaRoot(options = {}) {
  const opts = _normOpts(options);
  if (opts.konohaRoot) return path.resolve(opts.konohaRoot);
  if (opts.konohaHome) return path.resolve(opts.konohaHome);
  if (process.env.KONOHA_HOME) return path.resolve(process.env.KONOHA_HOME);
  if (process.env.KONOHA_SKILLS_DB_DIR) return path.resolve(process.env.KONOHA_SKILLS_DB_DIR);
  return path.join(getHomeDir(opts), '.konoha');
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
      ['.gemini', 'settings.json'], ['.gemini', 'GEMINI.md'],
      ['.gemini', 'config', 'settings.json'], ['.gemini', 'config', 'mcp_config.json'],
      ['.gemini', 'config', 'hooks.json'], ['.gemini', 'config', 'GEMINI.md'], ['.gemini', 'config', 'AGENTS.md'],
      ['.gemini', 'antigravity', 'settings.json'], ['.gemini', 'antigravity', 'mcp_config.json'],
      ['.gemini', 'antigravity-cli', 'settings.json'], ['.gemini', 'antigravity-cli', 'mcp_config.json'],
      ['.gemini', 'antigravity-ide', 'settings.json'], ['.gemini', 'antigravity-ide', 'mcp_config.json'],
      ['.agents', 'AGENTS.md'], ['.agents', 'agents.yaml']
    ],
    project: [['GEMINI.md'], ['AGENTS.md'], ['.agents', 'AGENTS.md'], ['.gemini', 'settings.json']]
  },
  cursor: {
    global: [
      ['.cursor', 'mcp.json'], ['.cursor', 'settings.json'], ['.cursor', 'cli-config.json'], ['.cursor', 'hooks.json'],
      ['.cursor', 'rules', 'konoha.mdc'], ['.cursor', 'rules', 'rtk.mdc'],
      ['.config', 'Cursor', 'User', 'settings.json'],
      ['Library', 'Application Support', 'Cursor', 'User', 'settings.json'],
      ['AppData', 'Roaming', 'Cursor', 'User', 'settings.json']
    ],
    project: [['.cursor', 'mcp.json'], ['.cursor', 'rules', 'konoha.mdc'], ['.cursor', 'rules', 'rtk.mdc']]
  },
  claude: {
    global: [['.claude.json'], ['.claude', 'settings.json'], ['.claude', 'settings.local.json'], ['.claude', 'CLAUDE.md'], ['.claude', 'rules', 'rtk.md']],
    project: [['.mcp.json'], ['CLAUDE.md'], ['.claude', 'settings.json'], ['.claude', 'settings.local.json'], ['.claude', 'rules', 'rtk.md']]
  },
  opencode: {
    global: [
      ['.config', 'opencode', 'opencode.json'], ['.config', 'opencode', 'settings.json'], ['.config', 'opencode', 'AGENTS.md'],
      ['.config', 'opencode', 'rules', 'konoha.md'], ['.config', 'opencode', 'rules', 'rtk.md'],
      ['.opencode', 'opencode.json'], ['.opencode', 'config.json'], ['.opencode', 'settings.json']
    ],
    project: [['opencode.json'], ['.opencode', 'opencode.json'], ['.opencode', 'settings.json']]
  },
  commandcode: {
    global: [['.commandcode', 'mcp.json'], ['.commandcode', 'settings.json'], ['.commandcode', 'CLAUDE.md'], ['.commandcode', 'rules', 'rtk.md']],
    project: [['.commandcode', 'mcp.json'], ['.commandcode', 'settings.json'], ['.commandcode', 'rules', 'rtk.md']]
  },
  codex: {
    global: [['.codex', 'config.toml'], ['.codex', 'settings.json'], ['.codex', 'AGENTS.md'], ['.codex', 'rules', 'rtk.md']],
    project: [['.codex', 'config.toml'], ['.codex', 'settings.json'], ['AGENTS.md']]
  },
  pi: {
    global: [['.pi', 'agent', 'mcp.json'], ['.pi', 'agent', 'settings.json'], ['.pi', 'agent', 'AGENTS.md'], ['.pi', 'agent', 'extensions', 'konoha-blocker.ts'], ['.pi', 'settings.json']],
    project: [['.pi', 'mcp.json'], ['.pi', 'settings.json']]
  },
  omp: {
    global: [
      ['.omp', 'agent', 'mcp.json'], ['.omp', 'agent', 'config.yml'], ['.omp', 'agent', 'settings.json'], ['.omp', 'agent', 'AGENTS.md'],
      ['.omp', 'mcp.json'], ['.omp', 'config.yml'], ['.omp', 'settings.json'], ['.omp', 'rules', 'rtk.md']
    ],
    project: [['.omp', 'mcp.json'], ['.omp', 'config.yml'], ['.omp', 'settings.json']]
  }
};

function _joinPaths(baseDir, relPaths) {
  return relPaths.map((rel) => path.join(baseDir, ...rel));
}

function _appendCursorAppdata(globalList, appdata) {
  if (!appdata) return;
  const winCursorSettings = path.join(appdata, 'Cursor', 'User', 'settings.json');
  if (!globalList.includes(winCursorSettings)) globalList.push(winCursorSettings);
}

function getClientConfigMap(options = {}) {
  const opts = _normOpts(options);
  const home = getHomeDir(opts);
  const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : null;
  const isDistinctProject = Boolean(
    projectRoot &&
    path.resolve(projectRoot) !== path.resolve(home) &&
    fs.existsSync(projectRoot)
  );
  const out = {};
  for (const [client, spec] of Object.entries(CLIENT_REL_CONFIG_SPECS)) {
    const globalList = _joinPaths(home, spec.global);
    if (client === 'cursor') {
      _appendCursorAppdata(globalList, opts.appdata || process.env.APPDATA);
    }
    out[client] = {
      global: globalList,
      project: isDistinctProject ? _joinPaths(projectRoot, spec.project) : []
    };
  }
  return out;
}

function inferClientAndScope(filePath, options = {}) {
  const opts = _normOpts(options);
  const norm = path.resolve(filePath).replace(/\\/g, '/');
  const home = path.resolve(getHomeDir(opts)).replace(/\\/g, '/');
  const isUnderHome = norm.startsWith(home + '/') && (
    norm.slice(home.length + 1).startsWith('.') ||
    norm.slice(home.length + 1).startsWith('AppData/') ||
    norm.slice(home.length + 1).startsWith('Library/')
  );
  const isKnownGlobalPattern = (
    norm.includes('/.gemini/antigravity') ||
    norm.includes('/.gemini/config/') ||
    norm.includes('/.config/Cursor/') ||
    norm.includes('/Library/Application Support/Cursor/') ||
    norm.includes('/AppData/Roaming/Cursor/') ||
    norm.includes('/.config/opencode/') ||
    norm.includes('/.pi/agent/') ||
    norm.includes('/.omp/agent/') ||
    norm.endsWith('/.claude.json') ||
    norm.endsWith('/.agents/agents.yaml')
  );
  const scope = opts.scope || ((isUnderHome || isKnownGlobalPattern) ? 'global' : 'project');

  if (opts.client && SUPPORTED_CLIENTS.includes(opts.client)) {
    return { client: opts.client, scope };
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
  const opts = _normOpts(options);
  const absPath = path.resolve(filePath);
  const { client, scope } = inferClientAndScope(absPath, opts);

  let lstat;
  try {
    lstat = fs.lstatSync(absPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      recordOwnership(absPath, { client, scope, createdByKonoha: true }, opts);
      return { ok: true, existed: false, backedUp: false, verified: true, client, scope, sourcePath: absPath, backupPath: null };
    }
    throw new Error(`Cannot inspect config file ${absPath}: ${err.message}`);
  }

  let stat = lstat;
  if (lstat.isSymbolicLink()) {
    try {
      stat = fs.statSync(absPath);
    } catch (err) {
      throw new Error(`Cannot back up broken symlink ${absPath}: ${err.message}`);
    }
  }
  if (!stat.isFile()) {
    return { ok: true, existed: false, backedUp: false, verified: true, client, scope, sourcePath: absPath, backupPath: null };
  }

  if (opts.simulateBackupFailure === true || process.env.KONOHA_SIMULATE_BACKUP_FAILURE === '1') {
    throw new Error(`Simulated backup verification failure for ${absPath}`);
  }

  const srcBuf = fs.readFileSync(absPath);
  const sha8 = computeSha256(srcBuf).slice(0, 8);
  const stamp = formatDateStamp();
  const safeBase = path.basename(absPath).replace(/[^a-zA-Z0-9._-]/g, '_');
  const pathHash = crypto.createHash('sha256').update(absPath).digest('hex').slice(0, 6);
  const backupDir = path.join(getBackupsRoot(opts), 'configs', client, scope);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  let backupName = `${stamp}-${pathHash}-${sha8}-${safeBase}.bak`;
  let backupPath = path.join(backupDir, backupName);
  let collisionAttempt = 0;
  while (fs.existsSync(backupPath)) {
    collisionAttempt += 1;
    const nonce = crypto.randomBytes(2).toString('hex');
    backupName = `${stamp}-${collisionAttempt}-${nonce}-${pathHash}-${sha8}-${safeBase}.bak`;
    backupPath = path.join(backupDir, backupName);
  }

  const fileMode = (stat.mode & 0o777) ? Math.min(stat.mode & 0o777, 0o600) : 0o600;
  const tmpBackupPath = `${backupPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpBackupPath, srcBuf, { mode: fileMode || 0o600 });
  try {
    fs.chmodSync(tmpBackupPath, fileMode || 0o600);
  } catch (_) { /* ignore on non-POSIX */ }
  fs.renameSync(tmpBackupPath, backupPath);

  const verification = verifyBackupIntegrity(absPath, backupPath);
  if (!verification.ok) {
    try { fs.unlinkSync(backupPath); } catch (_) { /* ignore */ }
    throw new Error(`Configuration backup integrity check failed for ${absPath}: ${verification.error}`);
  }

  recordOwnership(absPath, {
    client,
    scope,
    backupPath,
    sha256: verification.sha256
  }, opts);

  return {
    ok: true,
    existed: true,
    backedUp: true,
    verified: true,
    client,
    scope,
    sourcePath: absPath,
    backupPath,
    sha256: verification.sha256,
    size: verification.size,
    mode: fileMode || 0o600
  };
}

function ensureBackupBeforeModify(filePath, options = {}) {
  const res = backupConfigFile(filePath, options);
  if (!res || !res.ok || (res.existed && (!res.backedUp || !res.verified))) {
    throw new Error((res && res.error) || `Pre-modification configuration backup failed for ${filePath}`);
  }
  return res;
}

function formatBackupSummaryLines(backupSummary) {
  if (!backupSummary || !Array.isArray(backupSummary.backups)) {
    return ['  [Backup] Configuration backup check completed.'];
  }
  const backedUp = backupSummary.backups.filter((b) => b && b.existed && b.backedUp);
  if (backedUp.length === 0) {
    return ['  [Backup] No existing client configuration files required backup (fresh state).'];
  }
  const lines = [
    `  [Backup] Backed up and verified ${backedUp.length} existing configuration file(s) before modification:`
  ];
  for (const item of backedUp) {
    const statusLabel = item.verified !== false ? 'verified SHA-256 ✓' : 'unverified';
    lines.push(`    • [${item.client}:${item.scope}] ${item.sourcePath} -> ${item.backupPath} (${statusLabel})`);
  }
  return lines;
}

function _backupScopeFiles(filePaths, client, scope, options, results) {
  for (const filePath of (filePaths || [])) {
    let existsOrLink = false;
    try {
      fs.lstatSync(filePath);
      existsOrLink = true;
    } catch (_) {
      existsOrLink = false;
    }
    if (!existsOrLink) continue;
    results.push(ensureBackupBeforeModify(filePath, { ..._normOpts(options), client, scope }));
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
  const backedUpCount = results.filter(r => r.existed).length;
  return {
    ok: true,
    clients: targetClients,
    backedUpCount,
    totalBackedUp: backedUpCount,
    backups: results
  };
}

function backupAllDetectedClients(options = {}) {
  // Callers that know which clients were requested (konoha init --client=omp)
  // narrow the sweep here; an absent list keeps the historical all-clients sweep.
  return backupClientConfigs(options.clients || options.client || 'all', options);
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
  ensureBackupBeforeModify,
  formatBackupSummaryLines,
  backupClientConfigs,
  backupAllDetectedClients,
  listClientBackups,
  restoreLatestClientBackups,
  restoreFromBackupSnapshot
};
