/**
 * Konoha MCP Subsystem - Web Search
 * Extracted from server.js as part of modularization refactor (Phase 5)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { KONOHA_DIR } = require('./runtime_state');
const { detectActiveAgent } = require('./client_detection');
const { logToolCall } = require('./skills');
const { globalCircuitRegistry } = require('../circuit_breaker');

const searxngDir = path.join(KONOHA_DIR, 'searxng');
const instancesCachePath = path.join(searxngDir, 'instances_cache.json');
const bestInstancePath = path.join(searxngDir, 'best_instance.json');
const searchLogPath = path.join(searxngDir, 'search.log');

async function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

function logSearchActivity(source, q, count) {
  try {
    fs.mkdirSync(searxngDir, { recursive: true });
    const ts = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    fs.appendFileSync(searchLogPath, `[${ts}] SOURCE: ${source} | QUERY: ${q} | COUNT: ${count}\n`, 'utf8');
  } catch (_) { /* ignore */ }
}

async function getCandidateInstances() {
  if (fs.existsSync(instancesCachePath)) {
    try {
      const st = fs.statSync(instancesCachePath);
      if (Date.now() - st.mtimeMs < 24 * 3600 * 1000) {
        return JSON.parse(fs.readFileSync(instancesCachePath, 'utf8'));
      }
    } catch (_) { /* ignore */ }
  }

  process.stderr.write('[mcp konoha] Refreshing SearXNG public instances list...\n');
  try {
    const resp = await fetchWithTimeout('https://searx.space/data/instances.json', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, 8000);
    const data = await resp.json();
    const instances = data.instances || {};
    const candidates = [];
    for (const [name, val] of Object.entries(instances)) {
      if (!name.startsWith('https://') || typeof val !== 'object' || !val) continue;
      const uptime = (val.uptime && typeof val.uptime === 'object') ? (val.uptime.uptimeDay || 0) : 0;
      if (uptime <= 95.0) continue;

      let latency = 9999.0;
      let hasTiming = false;
      const timing = val.timing || {};
      if (timing.search && typeof timing.search === 'object' && timing.search.all) {
        latency = timing.search.all.median || timing.search.all.mean || 9999.0;
        hasTiming = true;
      }
      if (!hasTiming && timing.initial && typeof timing.initial === 'object' && timing.initial.all) {
        latency = timing.initial.all.value || 9999.0;
        hasTiming = true;
      }
      if (hasTiming) {
        candidates.push({ url: name, uptime, latency });
      }
    }
    candidates.sort((a, b) => (b.uptime - a.uptime) || (a.latency - b.latency));
    try { fs.writeFileSync(instancesCachePath, JSON.stringify(candidates), 'utf8'); } catch (_) { /* ignore */ }
    return candidates;
  } catch (e) {
    process.stderr.write(`[mcp konoha] Failed to fetch instances.json: ${e.message}\n`);
    if (fs.existsSync(instancesCachePath)) {
      try { return JSON.parse(fs.readFileSync(instancesCachePath, 'utf8')); } catch (_) { /* ignore */ }
    }
    return [];
  }
}

async function resolveBestInstance(candidates) {
  const customSearx = process.env.SEARXNG_URL || process.env.KONOHA_SEARXNG_URL;
  if (customSearx && customSearx.trim()) {
    return customSearx.trim().replace(/\/+$/, '') + '/';
  }
  if (fs.existsSync(bestInstancePath)) {
    try {
      const st = fs.statSync(bestInstancePath);
      if (Date.now() - st.mtimeMs < 3600 * 1000) {
        const cached = JSON.parse(fs.readFileSync(bestInstancePath, 'utf8'));
        if (cached.url) return cached.url;
      }
    } catch (_) { /* ignore */ }
  }

  const testCandidates = (candidates || []).slice(0, 15);
  if (testCandidates.length === 0) return null;

  let bestUrl = null;
  for (const c of testCandidates.slice(0, 5)) {
    const url = c.url.replace(/\/+$/, '') + '/';
    try {
      const resp = await fetchWithTimeout(`${url}search?q=test&format=json`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      }, 3000);
      const resData = await resp.json();
      if (resData && resData.results) {
        bestUrl = url;
        break;
      }
    } catch (_) { /* ignore */ }
  }

  if (bestUrl) {
    try { fs.writeFileSync(bestInstancePath, JSON.stringify({ url: bestUrl, resolved_at: Date.now() / 1000 }), 'utf8'); } catch (_) { /* ignore */ }
    return bestUrl;
  }
  return null;
}

async function querySearxng(instanceUrl, q, num) {
  let netloc = instanceUrl;
  try { netloc = new URL(instanceUrl).host; } catch (_) { /* ignore */ }
  const cb = globalCircuitRegistry.getOrCreate(`searxng:${netloc}`, 3, 60.0);
  if (!cb.allowRequest()) return null;

  const base = instanceUrl.replace(/\/+$/, '') + '/';
  const searchUrl = `${base}search?q=${encodeURIComponent(q)}&format=json`;
  try {
    const resp = await fetchWithTimeout(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }, 2500);
    const data = await resp.json();
    const results = [];
    for (const item of (data.results || []).slice(0, num)) {
      if (item.url && item.title) {
        results.push({
          title: item.title,
          url: item.url,
          snippet: item.content || item.snippet || '',
          source: `SearXNG (${netloc})`
        });
      }
    }
    cb.recordSuccess();
    return results;
  } catch (_) {
    cb.recordFailure();
    try { if (fs.existsSync(bestInstancePath)) fs.unlinkSync(bestInstancePath); } catch (_) { /* ignore */ }
    return null;
  }
}

async function queryDuckDuckGo(q, num) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  try {
    const resp = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, 2500);
    const html = await resp.text();
    const blocks = [];
    const re = /<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      blocks.push(m[1]);
    }
    const results = [];
    for (const b of blocks.slice(0, num)) {
      const titleM = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const snippetM = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      if (titleM) {
        let rawUrl = titleM[1];
        const title = titleM[2].replace(/<[^>]+>/g, '').trim();
        let snippet = '';
        if (snippetM) snippet = snippetM[1].replace(/<[^>]+>/g, '').trim();
        try {
          const parsed = new URL(rawUrl, 'https://duckduckgo.com');
          rawUrl = parsed.searchParams.get('uddg') || rawUrl;
        } catch (_) { /* ignore */ }
        results.push({
          title,
          url: rawUrl,
          snippet,
          source: 'DuckDuckGo'
        });
      }
    }
    return results;
  } catch (_) {
    return null;
  }
}

async function queryWikipedia(q, num) {
  try {
    const terms = q.split(/\s+/).filter(Boolean);
    for (let i = 0; i < Math.min(3, terms.length); i++) {
      const term = terms.slice(0, terms.length - i).join(' ');
      if (term.trim().length < 3) continue;
      const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(term)}&limit=${num}&format=json`;
      const resp = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 5000);
      const data = await resp.json();
      if (Array.isArray(data) && data.length >= 4 && Array.isArray(data[1])) {
        const titles = data[1];
        const descriptions = data[2] || [];
        const urls = data[3] || [];
        const results = [];
        for (let j = 0; j < titles.length; j++) {
          results.push({
            title: titles[j],
            url: urls[j],
            snippet: descriptions[j] || `Wikipedia page for ${titles[j]}.`,
            source: 'Wikipedia'
          });
        }
        return results;
      }
    }
  } catch (_) { /* ignore */ }
  return [];
}

const authorityDomains = [
  'github.com', 'stackoverflow.com', 'docs.google.com', 'developer.mozilla.org',
  'learn.microsoft.com', 'docs.python.org', 'nodejs.org', 'npmjs.com',
  'vercel.com', 'nextjs.org', 'svelte.dev', 'tailwindcss.com',
  'kubernetes.io', 'terraform.io', 'aws.amazon.com', 'cloud.google.com'
];

function rankScore(r) {
  let score = 0;
  const u = (r.url || '').toLowerCase();
  for (const ad of authorityDomains) {
    if (u.includes(ad)) { score += 10; break; }
  }
  if (r.snippet) score += Math.min(Math.floor(r.snippet.length / 50), 5);
  return score;
}

async function runWebSearch(query, numResults = 5, searchDepth = 'standard', agentName = null) {
  if (!query || !query.trim()) {
    return JSON.stringify({ status: 'error', message: 'Query is required.' });
  }

  try { fs.mkdirSync(searxngDir, { recursive: true }); } catch (_) { /* ignore */ }

  const queries = [query.trim()];
  if (searchDepth === 'deep') {
    const base = query.trim();
    queries.push(`${base} best practices 2024 2025 2026`);
    queries.push(`${base} comparison alternatives`);
  }

  const allResults = [];
  const seenUrls = new Set();

  for (const q of queries) {
    let currentResults = null;
    const candidates = await getCandidateInstances();
    const bestInstance = await resolveBestInstance(candidates);
    if (bestInstance) {
      currentResults = await querySearxng(bestInstance, q, numResults);
      if (currentResults && currentResults.length > 0) {
        logSearchActivity('SearXNG', q, currentResults.length);
      }
    }
    if (!currentResults || currentResults.length === 0) {
      currentResults = await queryDuckDuckGo(q, numResults);
      if (currentResults && currentResults.length > 0) {
        logSearchActivity('DuckDuckGo HTML', q, currentResults.length);
      }
    }
    if (!currentResults || currentResults.length === 0) {
      currentResults = await queryWikipedia(q, numResults);
      if (currentResults && currentResults.length > 0) {
        logSearchActivity('Wikipedia OpenSearch', q, currentResults.length);
      }
    }
    for (const r of (currentResults || [])) {
      if (!seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        allResults.push(r);
      }
    }
  }

  allResults.sort((a, b) => rankScore(b) - rankScore(a));
  const formatted = allResults.slice(0, numResults).map((r, i) => ({
    citation_id: i + 1,
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    source: r.source
  }));

  const res = JSON.stringify({
    status: 'success',
    query,
    search_depth: searchDepth,
    results_count: formatted.length,
    results: formatted
  });
  logToolCall('web_search', `query=${query}, depth=${searchDepth}`, res.substring(0, 500), agentName || detectActiveAgent());
  return res;
}

module.exports = {
  fetchWithTimeout,
  logSearchActivity,
  getCandidateInstances,
  resolveBestInstance,
  querySearxng,
  queryDuckDuckGo,
  queryWikipedia,
  runWebSearch
};
