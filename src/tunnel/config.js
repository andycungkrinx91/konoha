/**
 * Public Tunnel Configuration Manager.
 * Reads and persists settings to SQLite table tunnel_config.
 */

'use strict';

const dbModule = require('../db');
const vault = require('../crypto_vault');

function getTunnelConfig() {
  const conn = dbModule.getConnection();
  const row = conn.prepare('SELECT * FROM tunnel_config WHERE id = 1').get();
  if (!row) {
    return {
      id: 1,
      enabled: 0,
      provider: 'cloudflare',
      mode: 'ephemeral',
      token: '',
      custom_domain: '',
      auth_pin: '',
      public_url: '',
      active_pid: 0,
      started_at: null,
      updated_at: new Date().toISOString()
    };
  }
  return {
    ...row,
    token: vault.decryptSecret(row.token),
    auth_pin: vault.decryptSecret(row.auth_pin)
  };
}

function saveTunnelConfig({
  enabled,
  provider,
  mode,
  token,
  custom_domain,
  auth_pin,
  public_url,
  active_pid,
  started_at
}) {
  const conn = dbModule.getConnection();
  const existing = getTunnelConfig();
  const now = new Date().toISOString();

  const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled;
  const newProvider = provider ? (['cloudflare', 'ngrok'].includes(provider) ? provider : existing.provider) : existing.provider;
  const newMode = mode ? (['ephemeral', 'named'].includes(mode) ? mode : existing.mode) : existing.mode;
  const isMaskedToken = typeof token === 'string' && token.includes('...');
  const newToken = (token !== undefined && !isMaskedToken) ? String(token).trim() : existing.token;
  const newDomain = custom_domain !== undefined ? String(custom_domain).trim() : existing.custom_domain;
  const isMaskedPin = typeof auth_pin === 'string' && auth_pin.includes('***');
  const newPin = (auth_pin !== undefined && !isMaskedPin) ? String(auth_pin).trim() : existing.auth_pin;
  const newUrl = public_url !== undefined ? String(public_url).trim() : existing.public_url;
  const newPid = active_pid !== undefined ? Number(active_pid) || 0 : existing.active_pid;
  const newStartedAt = started_at !== undefined ? started_at : existing.started_at;

  const encryptedToken = vault.encryptSecret(newToken);
  const encryptedPin = vault.encryptSecret(newPin);

  conn.prepare(`
    INSERT INTO tunnel_config (
      id, enabled, provider, mode, token, custom_domain, auth_pin, public_url, active_pid, started_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      provider = excluded.provider,
      mode = excluded.mode,
      token = excluded.token,
      custom_domain = excluded.custom_domain,
      auth_pin = excluded.auth_pin,
      public_url = excluded.public_url,
      active_pid = excluded.active_pid,
      started_at = excluded.started_at,
      updated_at = excluded.updated_at
  `).run(newEnabled, newProvider, newMode, encryptedToken, newDomain, encryptedPin, newUrl, newPid, newStartedAt, now);

  return getTunnelConfig();
}

module.exports = {
  getTunnelConfig,
  saveTunnelConfig
};
