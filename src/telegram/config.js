/**
 * Telegram Bot Configuration Manager.
 * Reads and persists settings to SQLite table telegram_config.
 */

'use strict';

const dbModule = require('../db');
const vault = require('../crypto_vault');

function getTelegramConfig() {
  const conn = dbModule.getConnection();
  const row = conn.prepare('SELECT * FROM telegram_config WHERE id = 1').get();
  if (!row) {
    return {
      id: 1,
      enabled: 0,
      mode: 'one_way',
      transport: 'polling',
      bot_token: '',
      chat_id: '',
      webhook_secret: '',
      last_notified_at: null,
      updated_at: new Date().toISOString()
    };
  }
  return {
    ...row,
    bot_token: vault.decryptSecret(row.bot_token),
    webhook_secret: vault.decryptSecret(row.webhook_secret)
  };
}

function saveTelegramConfig({
  enabled,
  mode,
  transport,
  bot_token,
  chat_id,
  webhook_secret
}) {
  const conn = dbModule.getConnection();
  const existing = getTelegramConfig();
  const now = new Date().toISOString();

  const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled;
  const newMode = mode ? (['one_way', 'two_way'].includes(mode) ? mode : existing.mode) : existing.mode;
  const newTransport = transport ? (['polling', 'cloudflare', 'ngrok'].includes(transport) ? transport : existing.transport) : existing.transport;
  const isMaskedToken = typeof bot_token === 'string' && bot_token.includes('...');
  const newToken = (bot_token !== undefined && !isMaskedToken) ? String(bot_token).trim() : existing.bot_token;
  const newChatId = chat_id !== undefined ? String(chat_id).trim() : existing.chat_id;
  const isMaskedSecret = typeof webhook_secret === 'string' && webhook_secret.includes('***');
  const newSecret = (webhook_secret !== undefined && !isMaskedSecret) ? String(webhook_secret).trim() : existing.webhook_secret;

  const encryptedToken = vault.encryptSecret(newToken);
  const encryptedSecret = vault.encryptSecret(newSecret);

  conn.prepare(`
    INSERT INTO telegram_config (
      id, enabled, mode, transport, bot_token, chat_id, webhook_secret, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      mode = excluded.mode,
      transport = excluded.transport,
      bot_token = excluded.bot_token,
      chat_id = excluded.chat_id,
      webhook_secret = excluded.webhook_secret,
      updated_at = excluded.updated_at
  `).run(newEnabled, newMode, newTransport, encryptedToken, newChatId, encryptedSecret, now);

  return getTelegramConfig();
}

function setTelegramEnabled(enabled) {
  const conn = dbModule.getConnection();
  const now = new Date().toISOString();
  conn.prepare(`
    UPDATE telegram_config
    SET enabled = ?, updated_at = ?
    WHERE id = 1
  `).run(enabled ? 1 : 0, now);
  return getTelegramConfig();
}

function recordLastNotified() {
  const conn = dbModule.getConnection();
  const now = new Date().toISOString();
  conn.prepare(`
    UPDATE telegram_config
    SET last_notified_at = ?
    WHERE id = 1
  `).run(now);
}

module.exports = {
  getTelegramConfig,
  saveTelegramConfig,
  setTelegramEnabled,
  recordLastNotified
};
