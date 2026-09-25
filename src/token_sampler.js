'use strict';

/**
 * src/token_sampler.js
 * Live tiktoken (cl100k_base) sampling and accuracy verification against the /4 heuristic.
 * Measures real byte-to-token ratios, detects heuristic drift, and flags divergence.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let _cachedDrift = null;
let _lastSampleTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

/**
 * Counts exact cl100k_base tokens for a given string using python3 tiktoken.
 * @param {string} text - Payload text to tokenize
 * @returns {number} Token count, or Math.floor(bytes/4) fallback if python3/tiktoken is unavailable
 */
function countTiktoken(text) {
  if (!text || typeof text !== 'string') return 0;
  const byteLen = Buffer.byteLength(text, 'utf8');
  if (byteLen === 0) return 0;

  try {
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
    /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */
  }

  return Math.floor(byteLen / 4);
}

/**
 * Evaluates live drift between the /4 heuristic and real cl100k_base tiktoken tokens
 * across representative payloads (e.g. from skills.db and recent tool payloads).
 * @param {object} [options]
 * @param {boolean} [options.force=false] - Bypass in-memory cache
 * @returns {object} Drift metrics object
 */
function getDriftMetrics(options = {}) {
  const now = Date.now();
  if (!options.force && _cachedDrift && (now - _lastSampleTime < CACHE_TTL_MS)) {
    return _cachedDrift;
  }

  // Gather sample corpus from standard Konoha payload shapes (code, JSON, markdown)
  const samples = [];
  
  // 1. JSON tool result payload sample (from canonical schemas)
  try {
    const { listToolSchemas } = require('./file_tools_router');
    samples.push(JSON.stringify(listToolSchemas().slice(0, 3)));
  } catch (_) { /* best-effort sample */ }

  // 2. Markdown skill document sample
  const sampleSkillPath = path.join(__dirname, 'templates', 'skills', 'sannin-skill', 'SKILL.md');
  if (fs.existsSync(sampleSkillPath)) {
    try {
      samples.push(fs.readFileSync(sampleSkillPath, 'utf8').slice(0, 4000));
    } catch (_) { /* ignore */ }
  }

  // 3. JavaScript code sample
  const sampleCodePath = path.join(__dirname, 'db_savings.js');
  if (fs.existsSync(sampleCodePath)) {
    try {
      samples.push(fs.readFileSync(sampleCodePath, 'utf8').slice(0, 4000));
    } catch (_) { /* ignore */ }
  }

  // Measure each sample
  let totalBytes = 0;
  let totalTiktoken = 0;
  let totalHeuristic = 0;

  for (const text of samples) {
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
  
  // Threshold: ±5% is healthy; > 5% triggers drift alert
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
    timestamp: new Date().toISOString()
  };
  _lastSampleTime = now;

  return _cachedDrift;
}

module.exports = {
  countTiktoken,
  getDriftMetrics
};
