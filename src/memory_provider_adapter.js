'use strict';

/**
 * src/memory_provider_adapter.js — Pluggable MemoryProviderAdapter boundary.
 * Konoha native SQLite (`konoha.db`) is ALWAYS the canonical system of record.
 * GBrain is strictly an optional external adapter behind this interface.
 */

const http = require('http');
const https = require('https');

class MemoryProviderAdapter {
  constructor(name = 'base') {
    this.providerName = name;
    this.authoritative = false;
  }

  health() {
    return { provider: this.providerName, available: false, authoritative: this.authoritative };
  }
}

class NativeSqliteMemoryProvider extends MemoryProviderAdapter {
  constructor(brainApi = null) {
    super('konoha_native_sqlite');
    this.authoritative = true;
    this._brain = brainApi;
  }

  _api() {
    if (!this._brain) this._brain = require('./memory_brain');
    return this._brain;
  }

  health() {
    return { provider: this.providerName, available: true, authoritative: true };
  }

  save(opts) {
    return this._api().remember(opts);
  }

  query(opts) {
    return this._api().recall(opts);
  }

  queryAsync(opts) {
    return this._api().recallAsync(opts);
  }

  list(opts) {
    return this._api().listKnowledge(opts);
  }

  correct(opts) {
    return this._api().correctMemory(opts);
  }

  withdraw(opts) {
    return this._api().withdrawMemory(opts);
  }

  delete(id, opts) {
    return this._api().deleteMemory(id, opts);
  }
}

class GBrainMemoryAdapter extends MemoryProviderAdapter {
  constructor(options = {}) {
    super('gbrain_optional');
    this.authoritative = false;
    this.endpoint = options.endpoint || process.env.KONOHA_GBRAIN_URL || '';
    this.timeoutMs = Number(options.timeoutMs) || 2000;
    this.conflictPolicy = options.conflictPolicy || 'native_wins';
    this.enabled = Boolean(this.endpoint && options.enabled !== false);
  }

  health() {
    if (!this.enabled || !this.endpoint) {
      return {
        provider: this.providerName,
        available: false,
        enabled: false,
        authoritative: false,
        conflict_policy: this.conflictPolicy,
        reason: 'gbrain_not_configured'
      };
    }
    return {
      provider: this.providerName,
      available: false,
      enabled: true,
      authoritative: false,
      conflict_policy: this.conflictPolicy,
      endpoint: this.endpoint,
      reason: 'remote_probe_not_run'
    };
  }

  async syncSnapshotToExternal(records = []) {
    if (!this.enabled || !this.endpoint) {
      return {
        ok: false,
        skipped: true,
        provider: this.providerName,
        authoritative_store: 'konoha_native_sqlite',
        reason: 'gbrain_not_configured'
      };
    }
    return new Promise((resolve) => {
      try {
        const parsed = new URL(this.endpoint);
        const client = parsed.protocol === 'https:' ? https : http;
        const body = JSON.stringify({
          source: 'konoha',
          conflict_policy: this.conflictPolicy,
          records: Array.isArray(records) ? records : []
        });
        const req = client.request(
          parsed,
          {
            method: 'POST',
            timeout: this.timeoutMs,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body)
            }
          },
          (res) => {
            let text = '';
            res.on('data', (c) => { if (text.length < 4096) text += c; });
            res.on('end', () => {
              resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                provider: this.providerName,
                authoritative_store: 'konoha_native_sqlite',
                conflict_policy: this.conflictPolicy,
                response: text
              });
            });
          }
        );
        req.on('timeout', () => {
          req.destroy();
          resolve({ ok: false, provider: this.providerName, authoritative_store: 'konoha_native_sqlite', reason: 'timeout' });
        });
        req.on('error', (err) => {
          resolve({ ok: false, provider: this.providerName, authoritative_store: 'konoha_native_sqlite', reason: err.message });
        });
        req.write(body);
        req.end();
      } catch (err) {
        resolve({ ok: false, provider: this.providerName, authoritative_store: 'konoha_native_sqlite', reason: err.message });
      }
    });
  }
}

function getMemoryProvider(options = {}) {
  const nativeProvider = new NativeSqliteMemoryProvider(options.brainApi || null);
  const gbrainAdapter = options.enableGbrain || process.env.KONOHA_GBRAIN_URL
    ? new GBrainMemoryAdapter(options.gbrain || {})
    : null;
  return {
    primary: nativeProvider,
    optionalExternal: gbrainAdapter,
    status() {
      return {
        primary: nativeProvider.health(),
        optional_external: gbrainAdapter ? gbrainAdapter.health() : { provider: 'gbrain_optional', enabled: false, available: false, authoritative: false }
      };
    }
  };
}

module.exports = {
  MemoryProviderAdapter,
  NativeSqliteMemoryProvider,
  GBrainMemoryAdapter,
  getMemoryProvider
};
