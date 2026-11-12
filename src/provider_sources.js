'use strict';

/**
 * Credential-free discovery of OpenAI-compatible provider sources.
 *
 * These probes are unauthenticated GETs to /v1/models on loopback only. They
 * never read, send or return API keys, so a discovered source can be listed as
 * a bridge candidate without leaking anything into client-facing responses.
 */

const http = require('http');

const { getConfigValue } = require('./config_access');

/** Probe ceiling for OpenAI-compatible endpoints; overridable from ~/.konoha/config.json. */
const PROBE_TIMEOUT_MS = getConfigValue('probe_timeout_ms');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host || '').toLowerCase());
}

function parseModelsPayload(body, statusCode) {
  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode >= 300) {
    return { ok: false, statusCode, data: [] };
  }
  try {
    const parsed = JSON.parse(body);
    const list = Array.isArray(parsed?.data) ? parsed.data : (Array.isArray(parsed?.models) ? parsed.models : null);
    if (!list) return { ok: false, statusCode, data: [] };
    const data = list
      .filter((item) => item && typeof item.id === 'string' && item.id.length > 0)
      .map((item) => ({ id: item.id, owned_by: item.owned_by || null }));
    return { ok: true, statusCode, data };
  } catch (_) {
    return { ok: false, statusCode, error: 'invalid_json', data: [] };
  }
}

/**
 * Probe a loopback OpenAI-compatible endpoint for its served models.
 * Non-loopback hosts are refused so discovery can never be pointed at an
 * arbitrary remote service.
 */
function collectModelsResponse(res, finish) {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => finish(parseModelsPayload(body, res.statusCode)));
}

function probeOpenAiCompatibleEndpoint(port, host = '127.0.0.1', options = {}) {
  if (!isLoopbackHost(host)) {
    return Promise.resolve({ ok: false, error: 'non_loopback_host', data: [] });
  }
  const timeoutMs = options.timeoutMs || PROBE_TIMEOUT_MS;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let req;
    try {
      req = http.get(`http://${host}:${port}/v1/models`, { timeout: timeoutMs }, (res) => collectModelsResponse(res, finish));
    } catch (err) {
      finish({ ok: false, error: err.code || 'request_failed', data: [] });
      return;
    }

    req.on('error', (err) => finish({ ok: false, error: err.code || 'connection_failed', data: [] }));
    req.on('timeout', () => {
      req.destroy();
      finish({ ok: false, error: 'timeout', data: [] });
    });
  });
}

const CREDENTIAL_KEYS = /^(?:api_?key|authorization|auth_?token|access_?token|bearer|password|secret)$/i;

/**
 * Deep-scan a client-facing payload for anything credential-shaped.
 * Bridge API keys live only in the encrypted SQLite store, so any hit here is
 * a leak. Returns the offending property paths (empty when clean).
 */
function findCredentialLeaks(payload, trail = []) {
  const hits = [];
  if (payload === null || payload === undefined) return hits;
  if (Array.isArray(payload)) {
    payload.forEach((item, i) => hits.push(...findCredentialLeaks(item, [...trail, String(i)])));
    return hits;
  }
  if (typeof payload !== 'object') return hits;
  for (const [key, value] of Object.entries(payload)) {
    const path = [...trail, key].join('.');
    if (CREDENTIAL_KEYS.test(key)) {
      hits.push(path);
      continue;
    }
    hits.push(...findCredentialLeaks(value, [...trail, key]));
  }
  return hits;
}

module.exports = {
  PROBE_TIMEOUT_MS,
  isLoopbackHost,
  parseModelsPayload,
  probeOpenAiCompatibleEndpoint,
  findCredentialLeaks
};
