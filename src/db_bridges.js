#!/usr/bin/env node
/**
 * Bridge storage management for Konoha via SQLite (skills.db).
 * Pure Node.js replacement for db_bridges.py using the node:sqlite driver.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');
const db = require('./db');
const vault = require('./crypto_vault');

const BRIDGES_JSON_PATH = path.normalize(path.join(os.homedir(), '.konoha', 'bridges.json'));
const DEFAULT_BRIDGES = [];
const EXTERNAL_ANTIGRAVITY_PROVIDER = 'antigravity-extension';
const EXTERNAL_ANTIGRAVITY_PORT = 1313;
const EXTERNAL_ANTIGRAVITY_URL = 'http://127.0.0.1:1313';

function getDbConnection(dbPath = null) {
  const target = dbPath !== null ? dbPath : db.DB_PATH;
  const conn = db.getConnection(target, false);
  db.setupSchema(conn);
  return conn;
}


function decryptApiKey(rawKey) {
  if (!rawKey) return null;
  if (!vault.isEncrypted(rawKey)) {
    return rawKey;
  }
  const decrypted = vault.decryptSecret(rawKey);
  if (!decrypted && rawKey) {
    throw new Error('Crypto vault key unavailable or corrupted: failed to decrypt bridge api_key');
  }
  return decrypted;
}

function encryptApiKey(rawKey) {
  if (!rawKey) return null;
  if (vault.isEncrypted(rawKey)) {
    return rawKey;
  }
  const encrypted = vault.encryptSecret(rawKey);
  if (!encrypted) {
    throw new Error('Crypto vault key unavailable: failed to encrypt bridge api_key');
  }
  return encrypted;
}

function _loadBridgesToInsert() {
  if (!fs.existsSync(BRIDGES_JSON_PATH)) return DEFAULT_BRIDGES;
  try {
    const data = JSON.parse(fs.readFileSync(BRIDGES_JSON_PATH, 'utf-8'));
    return Array.isArray(data) && data.length > 0 ? data : DEFAULT_BRIDGES;
  } catch (_) {
    return DEFAULT_BRIDGES;
  }
}

function _isValidTargetUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function _insertSingleBridgeRow(stmt, b) {
  const name = b.name;
  if (!name) return;
  const provider = b.provider || 'openai';
  const isExternalAntigravity = provider === EXTERNAL_ANTIGRAVITY_PROVIDER;
  const port = parseInt(b.port !== undefined ? b.port : (isExternalAntigravity ? EXTERNAL_ANTIGRAVITY_PORT : 11435), 10);
  if (isExternalAntigravity && port !== EXTERNAL_ANTIGRAVITY_PORT) {
    return;
  }
  const enabledDefault = isExternalAntigravity ? false : true;
  const enabled = (b.enabled !== undefined ? b.enabled : enabledDefault) ? 1 : 0;
  let targetUrl = b.targetUrl || b.target_url || null;
  if (isExternalAntigravity && !targetUrl) {
    targetUrl = EXTERNAL_ANTIGRAVITY_URL;
  }
  if (isExternalAntigravity && targetUrl && !_isValidTargetUrl(targetUrl)) {
    return;
  }
  const rawKey = b.apiKey || b.api_key || null;
  const apiKey = encryptApiKey(rawKey);
  stmt.run(name, port, provider, enabled, targetUrl, apiKey);
}

function autoMigrateJsonIfNeeded(conn) {
  const row = conn.prepare("SELECT COUNT(*) as cnt FROM bridges").get();
  if (row && row.cnt > 0) {
    return;
  }

  const bridgesToInsert = _loadBridgesToInsert();

  const stmt = conn.prepare(`
    INSERT OR REPLACE INTO bridges (name, port, provider, enabled, target_url, api_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const b of bridgesToInsert) {
    _insertSingleBridgeRow(stmt, b);
  }
}

function listBridges(dbPath = null) {
  const conn = getDbConnection(dbPath);
  try {
    autoMigrateJsonIfNeeded(conn);
    const rows = conn.prepare("SELECT name, port, provider, enabled, target_url, api_key FROM bridges").all();
    const result = [];
    for (const r of rows) {
      const item = {
        name: r.name,
        port: r.port,
        provider: r.provider,
        enabled: Boolean(r.enabled)
      };
      if (r.target_url) {
        item.targetUrl = r.target_url;
      }
      if (r.api_key) {
        item.apiKey = decryptApiKey(r.api_key);
      }
      result.push(item);
    }
    return result;
  } finally {
    conn.close();
  }
}

function upsertBridge(bridgeDict, dbPath = null) {
  const conn = getDbConnection(dbPath);
  try {
    const name = bridgeDict.name;
    if (!name) {
      throw new Error("Bridge name is required");
    }
    const provider = bridgeDict.provider || 'openai';
    const isExternalAntigravity = provider === EXTERNAL_ANTIGRAVITY_PROVIDER;
    const port = parseInt(bridgeDict.port !== undefined ? bridgeDict.port : (isExternalAntigravity ? EXTERNAL_ANTIGRAVITY_PORT : 11435), 10);
    if (isExternalAntigravity && port !== EXTERNAL_ANTIGRAVITY_PORT) {
      throw new Error(`${EXTERNAL_ANTIGRAVITY_PROVIDER} must use port ${EXTERNAL_ANTIGRAVITY_PORT}`);
    }
    const enabledDefault = isExternalAntigravity ? false : true;
    const enabled = (bridgeDict.enabled !== undefined ? bridgeDict.enabled : enabledDefault) ? 1 : 0;
    let targetUrl = bridgeDict.targetUrl || bridgeDict.target_url || null;
    if (isExternalAntigravity && !targetUrl) {
      targetUrl = EXTERNAL_ANTIGRAVITY_URL;
    }
    if (isExternalAntigravity && targetUrl) {
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
        throw new Error(`${EXTERNAL_ANTIGRAVITY_PROVIDER} targetUrl must be a loopback http URL`);
      }
    }
    const rawKey = bridgeDict.apiKey || bridgeDict.api_key || null;
    const apiKey = encryptApiKey(rawKey);

    conn.prepare(`
      INSERT OR REPLACE INTO bridges (name, port, provider, enabled, target_url, api_key)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, port, provider, enabled, targetUrl, apiKey);
  } finally {
    conn.close();
  }
}


function migrateBridgesEncryption(dbPath = null) {
  const target = dbPath !== null ? dbPath : db.DB_PATH;
  if (!fs.existsSync(target)) {
    return { migrated: 0, backedUp: false };
  }

  try {
    fs.chmodSync(target, 0o600);
  } catch (_) {
    /* intentional best-effort chmod */
  }

  try {
    const keyPath = vault.getKeyFilePath ? vault.getKeyFilePath() : path.join(path.dirname(target), '.vault_key');
    if (fs.existsSync(keyPath)) {
      fs.chmodSync(keyPath, 0o600);
    }
  } catch (_) {
    /* intentional best-effort chmod */
  }

  const conn = getDbConnection(target);
  try {
    const unencryptedRows = conn.prepare(`
      SELECT name, api_key FROM bridges
      WHERE api_key IS NOT NULL AND api_key != '' AND api_key NOT LIKE 'enc:v1:%'
    `).all();

    if (unencryptedRows.length === 0) {
      return { migrated: 0, backedUp: false };
    }

    const backupDir = path.dirname(target);
    const backupName = `${path.basename(target)}.backup.${Date.now()}`;
    const backupPath = path.join(backupDir, backupName);
    try {
      conn.prepare(`VACUUM INTO ?`).run(backupPath);
      try {
        fs.chmodSync(backupPath, 0o600);
      } catch (_) {
        /* intentional best-effort chmod */
      }
    } catch (err) {
      throw new Error(`Failed to create database backup before bridges migration: ${err.message}`);
    }

    const updateStmt = conn.prepare(`UPDATE bridges SET api_key = ? WHERE name = ?`);
    const tx = conn.transaction(() => {
      for (const row of unencryptedRows) {
        const encrypted = encryptApiKey(row.api_key);
        updateStmt.run(encrypted, row.name);
      }
    });
    tx();

    return { migrated: unencryptedRows.length, backedUp: true, backupPath };
  } finally {
    conn.close();
  }
}

function deleteBridge(name, dbPath = null) {
  const conn = getDbConnection(dbPath);
  try {
    conn.prepare("DELETE FROM bridges WHERE name = ?").run(name);
  } finally {
    conn.close();
  }
}

function setEnabled(name, enabledBool, dbPath = null) {
  const conn = getDbConnection(dbPath);
  try {
    conn.prepare("UPDATE bridges SET enabled = ? WHERE name = ?").run(enabledBool ? 1 : 0, name);
  } finally {
    conn.close();
  }
}

function _isCallerMcpSubprocess() {
  if (process.env.KONOHA_DAEMON === 'true') return false;
  try {
    const ppid = process.ppid;
    if (fs.existsSync(`/proc/${ppid}/cmdline`)) {
      const pcmd = fs.readFileSync(`/proc/${ppid}/cmdline`, 'utf8');
      return pcmd.includes('file_tools_mcp.js');
    }
  } catch (_) { /* non-fatal */ }
  return false;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log(JSON.stringify(listBridges()));
    return;
  }

  const cmd = args[0];
  if (cmd === '--list' || cmd === 'list') {
    if (_isCallerMcpSubprocess()) {
      console.log("[]");
      return;
    }
    console.log(JSON.stringify(listBridges()));
  } else if (cmd === '--upsert' || cmd === 'upsert') {
    if (args.length < 2) process.exit(1);
    const b = JSON.parse(args[1]);
    upsertBridge(b);
    console.log(JSON.stringify({ ok: true }));
  } else if (cmd === '--delete' || cmd === 'delete') {
    if (args.length < 2) process.exit(1);
    deleteBridge(args[1]);
    console.log(JSON.stringify({ ok: true }));
  } else if (cmd === '--enable' || cmd === 'enable') {
    if (args.length < 2) process.exit(1);
    setEnabled(args[1], true);
    console.log(JSON.stringify({ ok: true }));
  } else if (cmd === '--disable' || cmd === 'disable') {
    if (args.length < 2) process.exit(1);
    setEnabled(args[1], false);
    console.log(JSON.stringify({ ok: true }));
  } else {
    console.log(JSON.stringify(listBridges()));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  listBridges,
  list_bridges: listBridges,
  upsertBridge,
  upsert_bridge: upsertBridge,
  deleteBridge,
  delete_bridge: deleteBridge,
  setEnabled,
  set_enabled: setEnabled,
  autoMigrateJsonIfNeeded,
  auto_migrate_json_if_needed: autoMigrateJsonIfNeeded,
  getDbConnection,
  get_db_connection: getDbConnection,
  migrateBridgesEncryption,
  migrate_bridges_encryption: migrateBridgesEncryption
};
