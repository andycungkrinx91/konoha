'use strict';

/**
 * src/token_sampler.js
 * Deterministic cl100k_base token counting using pure-JS gpt-tokenizer with
 * explicit fallback chain (pure-JS -> python -> byte heuristic).
 */

const path = require('path');
const fs = require('fs');

let _pureJsTokenizer = null;
let _lastEstimator = 'pure_js_cl100k';
let _cachedDrift = null;
let _lastSampleTime = 0;
const CACHE_TTL_MS = 60 * 1000;

function _getPureJsTokenizer() {
  if (_pureJsTokenizer === null) {
    try {
      _pureJsTokenizer = require('gpt-tokenizer/cjs/encoding/cl100k_base');
    } catch (_) {
      try {
        _pureJsTokenizer = require('gpt-tokenizer');
      } catch (_) {
        _pureJsTokenizer = false;
      }
    }
  }
  return _pureJsTokenizer || null;
}

function getLastEstimatorUsed() {
  return _lastEstimator;
}

/**
 * Counts exact cl100k_base tokens for a given string using pure-JS gpt-tokenizer,
 * with explicit fallback chain to python and byte heuristic.
 * @param {string} text - Payload text to tokenize
 * @param {object} [options]
 * @param {boolean} [options.pureJsOnly=false]
 * @returns {number} Token count
 */
function _countPureJs(tokenizer, text) {
  if (!tokenizer || typeof tokenizer.countTokens !== 'function') return null;
  try {
    const count = tokenizer.countTokens(text);
    if (typeof count === 'number' && !isNaN(count) && count >= 0) return count;
  } catch (_) {
    /* fallback to python */
  }
  return null;
}

function _countPython(text) {
  try {
    const { spawnSync } = require('child_process');
    const res = spawnSync('python3', [
      '-c',
      'import tiktoken, sys; enc = tiktoken.get_encoding("cl100k_base"); print(len(enc.encode(sys.stdin.read())))'
    ], {
      input: text,
      encoding: 'utf8',
      timeout: 3000
    });
    if (res.status === 0 && res.stdout) {
      const parsed = parseInt(res.stdout.trim(), 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
  } catch (_) {
    /* fallback to byte heuristic */
  }
  return null;
}

function countTiktoken(text, options = {}) {
  if (!text || typeof text !== 'string') return 0;
  const byteLen = Buffer.byteLength(text, 'utf8');
  if (byteLen === 0) return 0;

  const pureCount = _countPureJs(_getPureJsTokenizer(), text);
  if (pureCount !== null) {
    _lastEstimator = 'pure_js_cl100k';
    return pureCount;
  }

  if (!options.pureJsOnly) {
    const pyCount = _countPython(text);
    if (pyCount !== null) {
      _lastEstimator = 'python_tiktoken';
      return pyCount;
    }
  }

  _lastEstimator = 'byte_heuristic';
  return Math.floor(byteLen / 4);
}

function _gatherSampleCorpus() {
  const samples = [];
  try {
    const { listToolSchemas } = require('./file_tools_router');
    samples.push(JSON.stringify(listToolSchemas().slice(0, 3)));
  } catch (_) { /* best-effort */ }

  const candidates = [
    path.join(__dirname, 'templates', 'skills', 'sannin-skill', 'SKILL.md'),
    path.join(__dirname, 'db_savings.js')
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      samples.push(fs.readFileSync(p, 'utf8').slice(0, 4000));
    } catch (_) { /* ignore */ }
  }
  return samples;
}

function getDriftMetrics(options = {}) {
  const now = Date.now();
  if (!options.force && _cachedDrift && (now - _lastSampleTime < CACHE_TTL_MS)) {
    return _cachedDrift;
  }

  const samples = _gatherSampleCorpus();

  let totalBytes = 0;
  let totalTiktoken = 0;
  let totalHeuristic = 0;

  for (let i = 0; i < samples.length; i++) {
    const text = samples[i];
    const bytes = Buffer.byteLength(text, 'utf8');
    const tik = countTiktoken(text);
    const heur = Math.floor(bytes / 4);

    totalBytes += bytes;
    totalTiktoken += tik;
    totalHeuristic += heur;
  }

  if (totalTiktoken === 0) totalTiktoken = 1;
  const empiricalBytesPerToken = Number((totalBytes / totalTiktoken).toFixed(3));
  const diffTokens = totalHeuristic - totalTiktoken;
  const divergencePct = Number(((Math.abs(diffTokens) / totalTiktoken) * 100).toFixed(2));

  const isHealthy = divergencePct <= 5.0;
  const status = isHealthy ? 'healthy' : 'drift_detected';
  const alertMessage = isHealthy
    ? null
    : `Heuristic drift warning: /4 formula diverges by ${divergencePct}% from cl100k_base (ratio: ${empiricalBytesPerToken} bytes/token).`;

  _cachedDrift = {
    sampleCount: samples.length,
    totalBytes,
    totalTiktokenTokens: totalTiktoken,
    totalHeuristicTokens: totalHeuristic,
    empiricalBytesPerToken,
    divergencePct,
    status,
    isHealthy,
    alertMessage,
    estimatorUsed: _lastEstimator,
    timestamp: new Date().toISOString()
  };
  _lastSampleTime = now;

  return _cachedDrift;
}

module.exports = {
  countTiktoken,
  getLastEstimatorUsed,
  getDriftMetrics
};
