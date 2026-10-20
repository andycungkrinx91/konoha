/**
 * src/webhook_manager.js — Webhook Outbound Notification & Task Dispatch Engine.
 *
 * Supports full endpoint URLs with optional Bearer, API Key, JWT, or Custom Header authentication.
 */

'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const dbModule = require('./db');
const vault = require('./crypto_vault');

function getDb() {
  return dbModule.getConnection();
}

function ensureTable(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      auth_type TEXT CHECK (auth_type IN ('none', 'bearer', 'api_key', 'jwt', 'custom_header')) DEFAULT 'none',
      auth_token TEXT DEFAULT '',
      custom_header TEXT DEFAULT '',
      events TEXT DEFAULT 'all',
      last_status INTEGER DEFAULT NULL,
      last_delivered_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function listWebhooks() {
  const conn = getDb();
  ensureTable(conn);
  const rows = conn.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
  return rows.map(r => ({
    ...r,
    enabled: Boolean(r.enabled),
    auth_token: r.auth_token ? vault.decryptSecret(r.auth_token) : '',
    auth_token_masked: r.auth_token ? '******' : ''
  }));
}

function getWebhook(id) {
  if (!id) return null;
  const conn = getDb();
  ensureTable(conn);
  const row = conn.prepare('SELECT * FROM webhooks WHERE id = ?').get(String(id));
  if (!row) return null;
  return {
    ...row,
    enabled: Boolean(row.enabled),
    auth_token: row.auth_token ? vault.decryptSecret(row.auth_token) : '',
    auth_token_masked: row.auth_token ? '******' : ''
  };
}

function createWebhook({ name, url, auth_type = 'none', auth_token = '', custom_header = '', events = 'all', enabled = 1 }) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Webhook name is required');
  }
  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error('Webhook URL is required');
  }
  const cleanUrl = url.trim();
  try {
    const parsed = new URL(cleanUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('URL must start with http:// or https://');
    }
  } catch (err) {
    throw new Error(`Invalid URL: ${err.message}`);
  }

  const validAuthTypes = ['none', 'bearer', 'api_key', 'jwt', 'custom_header'];
  const cleanAuthType = validAuthTypes.includes(auth_type) ? auth_type : 'none';

  const conn = getDb();
  ensureTable(conn);
  const id = `wh_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const encryptedToken = auth_token ? vault.encryptSecret(auth_token.trim()) : '';

  conn.prepare(`
    INSERT INTO webhooks (id, name, url, enabled, auth_type, auth_token, custom_header, events, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), cleanUrl, enabled ? 1 : 0, cleanAuthType, encryptedToken, (custom_header || '').trim(), (events || 'all').trim(), now, now);

  return getWebhook(id);
}

function updateWebhook(id, data = {}) {
  const existing = getWebhook(id);
  if (!existing) {
    throw new Error(`Webhook not found: ${id}`);
  }

  const cleanName = data.name !== undefined ? String(data.name).trim() : existing.name;
  let cleanUrl = existing.url;
  if (data.url !== undefined) {
    cleanUrl = String(data.url).trim();
    const parsed = new URL(cleanUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('URL must start with http:// or https://');
    }
  }

  const validAuthTypes = ['none', 'bearer', 'api_key', 'jwt', 'custom_header'];
  const cleanAuthType = data.auth_type !== undefined && validAuthTypes.includes(data.auth_type)
    ? data.auth_type
    : existing.auth_type;

  let encryptedToken = existing.auth_token ? vault.encryptSecret(existing.auth_token) : '';
  if (data.auth_token !== undefined) {
    const tokenStr = String(data.auth_token).trim();
    if (!tokenStr.includes('***')) {
      encryptedToken = tokenStr ? vault.encryptSecret(tokenStr) : '';
    }
  }

  const cleanHeader = data.custom_header !== undefined ? String(data.custom_header).trim() : existing.custom_header;
  const cleanEvents = data.events !== undefined ? String(data.events).trim() : existing.events;
  const cleanEnabled = data.enabled !== undefined ? (data.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);
  const now = new Date().toISOString();

  const conn = getDb();
  conn.prepare(`
    UPDATE webhooks
    SET name = ?, url = ?, enabled = ?, auth_type = ?, auth_token = ?, custom_header = ?, events = ?, updated_at = ?
    WHERE id = ?
  `).run(cleanName, cleanUrl, cleanEnabled, cleanAuthType, encryptedToken, cleanHeader, cleanEvents, now, id);

  return getWebhook(id);
}

function deleteWebhook(id) {
  const conn = getDb();
  ensureTable(conn);
  const res = conn.prepare('DELETE FROM webhooks WHERE id = ?').run(String(id));
  return res.changes > 0;
}

/**
 * Dispatch HTTP request to a webhook endpoint with payload and configured auth headers.
 */
function sendWebhookPayload(webhook, payload) {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(webhook.url);
      const isHttps = urlObj.protocol === 'https:';
      const transport = isHttps ? https : http;

      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Konoha-Webhook-Engine/2.2.4'
      };

      if (webhook.auth_token) {
        if (webhook.auth_type === 'bearer' || webhook.auth_type === 'jwt') {
          headers['Authorization'] = `Bearer ${webhook.auth_token}`;
        } else if (webhook.auth_type === 'api_key') {
          headers['X-API-Key'] = webhook.auth_token;
        } else if (webhook.auth_type === 'custom_header' && webhook.custom_header) {
          headers[webhook.custom_header] = webhook.auth_token;
        }
      }

      const bodyData = JSON.stringify(payload);
      headers['Content-Length'] = Buffer.byteLength(bodyData);

      const reqOpts = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: `${urlObj.pathname || '/'}${urlObj.search || ''}`,
        method: 'POST',
        headers,
        timeout: 10000
      };

      const req = transport.request(reqOpts, (res) => {
        let respData = '';
        res.on('data', chunk => { respData += chunk; });
        res.on('end', () => {
          const status = res.statusCode;
          const ok = status >= 200 && status < 300;
          try {
            const conn = getDb();
            conn.prepare(`
              UPDATE webhooks
              SET last_status = ?, last_delivered_at = ?
              WHERE id = ?
            `).run(status, new Date().toISOString(), webhook.id);
          } catch (_) {
            // Non-critical audit timestamp update failure
          }
          resolve({ ok, status, data: respData.slice(0, 500) });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Webhook request timed out after 10000ms' });
      });

      req.on('error', (err) => {
        resolve({ ok: false, error: err.message });
      });

      req.write(bodyData);
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

/**
 * Broadcast event to all active matching webhooks.
 */
async function dispatchWebhookEvent(eventType, eventData) {
  try {
    const list = listWebhooks().filter(w => w.enabled);
    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      payload: eventData
    };
    const results = await Promise.all(
      list.map(w => {
        if (w.events === 'all' || w.events.split(',').map(s => s.trim()).includes(eventType)) {
          return sendWebhookPayload(w, payload);
        }
        return Promise.resolve({ skipped: true });
      })
    );
    return results;
  } catch (_) {
    // Non-fatal broadcast failure
    return [];
  }
}

module.exports = {
  listWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  sendWebhookPayload,
  dispatchWebhookEvent
};
