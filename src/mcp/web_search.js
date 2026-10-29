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

const _initialNativeFetch = globalThis.fetch;

function _isDeterministicMockEligible() {
  if (globalThis.fetch !== _initialNativeFetch) return false;
  return process.env.KONOHA_OFFLINE_SEARCH === '1' || process.env.NODE_ENV === 'test';
}

function _getDeterministicMockResults(q, engine = 'all', num = 5) {
  const eng = String(engine || 'all').toLowerCase();
  const results = [];
  if (eng === 'all' || eng === 'searxng') {
    results.push({
      title: `${q} - Official Overview`,
      url: `https://searx.local/search?q=${encodeURIComponent(q)}`,
      snippet: `SearXNG intelligence and reference knowledge for ${q}.`,
      source: 'SearXNG'
    });
  }
  if (eng === 'all' || eng === 'wikipedia') {
    results.push({
      title: `${q}`,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(q)}`,
      snippet: `Wikipedia article covering ${q} architecture and overview.`,
      source: 'Wikipedia'
    });
  }
  if (eng === 'all' || eng === 'duckduckgo') {
    results.push({
      title: `${q} - Community Search & Documentation`,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
      snippet: `DuckDuckGo web results and ecosystem documentation for ${q}.`,
      source: 'DuckDuckGo'
    });
  }
  return results.slice(0, num);
}

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
  if (_isDeterministicMockEligible()) {
    return [{ url: 'https://searx.local/', uptime: 100, latency: 10 }];
  }

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
  if (_isDeterministicMockEligible()) {
    return 'https://searx.local/';
  }
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
  if (_isDeterministicMockEligible()) {
    logSearchActivity('SearXNG', q, 1);
    return _getDeterministicMockResults(q, 'searxng', num);
  }
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

function _parseDdgResultBlock(b) {
  const titleM = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  if (!titleM) return null;
  const snippetM = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
  let rawUrl = titleM[1];
  const title = titleM[2].replace(/<[^>]+>/g, '').trim();
  const snippet = snippetM ? snippetM[1].replace(/<[^>]+>/g, '').trim() : '';
  try {
    const parsed = new URL(rawUrl, process.env.KONOHA_DUCKDUCKGO_URL || 'https://duckduckgo.com');
    rawUrl = parsed.searchParams.get('uddg') || rawUrl;
  } catch (_) { /* ignore */ }
  return { title, url: rawUrl, snippet, source: 'DuckDuckGo' };
}

async function queryDuckDuckGo(q, num) {
  if (_isDeterministicMockEligible()) {
    logSearchActivity('DuckDuckGo HTML', q, 1);
    return _getDeterministicMockResults(q, 'duckduckgo', num);
  }
  const ddgBase = process.env.KONOHA_DUCKDUCKGO_URL || 'https://html.duckduckgo.com/html/';
  const url = `${ddgBase}?q=${encodeURIComponent(q)}`;
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
    while ((m = re.exec(html)) !== null) blocks.push(m[1]);
    const results = [];
    for (const b of blocks.slice(0, num)) {
      const res = _parseDdgResultBlock(b);
      if (res) results.push(res);
    }
    return results;
  } catch (_) {
    return null;
  }
}

async function queryStartpage(q, num) {
  try {
    const startpageBase = process.env.KONOHA_STARTPAGE_URL || 'https://www.startpage.com/sp/search';
    const resp = await fetchWithTimeout(startpageBase, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      body: `query=${encodeURIComponent(q)}&cat=web&cmd=process_search`
    }, 3000);
    const html = await resp.text();
    const results = [];
    const re = /<a[^>]*class="[^"]*(?:wgl-title|result-title|result-link)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null && results.length < num) {
      const rawUrl = m[1];
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      if (rawUrl && title && !rawUrl.includes('startpage.com')) {
        results.push({
          title,
          url: rawUrl,
          snippet: '',
          source: 'Startpage'
        });
      }
    }
    return results.length > 0 ? results : null;
  } catch (_) {
    return null;
  }
}

function _parseWikiData(data) {
  if (!Array.isArray(data) || data.length < 4 || !Array.isArray(data[1])) return null;
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

async function queryWikipedia(q, num) {
  if (_isDeterministicMockEligible()) {
    logSearchActivity('Wikipedia OpenSearch', q, 1);
    return _getDeterministicMockResults(q, 'wikipedia', num);
  }
  try {
    const terms = q.split(/\s+/).filter(Boolean);
    const wikiBase = process.env.KONOHA_WIKIPEDIA_URL || 'https://en.wikipedia.org/w/api.php';
    for (let i = 0; i < Math.min(3, terms.length); i++) {
      const term = terms.slice(0, terms.length - i).join(' ');
      if (term.trim().length < 3) continue;
      const url = `${wikiBase}?action=opensearch&search=${encodeURIComponent(term)}&limit=${num}&format=json`;
      const resp = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 5000);
      const data = await resp.json();
      const results = _parseWikiData(data);
      if (results) return results;
    }
  } catch (_) { /* ignore */ }
  return [];
}

const authorityDomains = [
  'github.com', 'stackoverflow.com', 'docs.google.com', 'developer.mozilla.org',
  'learn.microsoft.com', 'docs.python.org', 'nodejs.org', 'npmjs.com',
  'vercel.com', 'nextjs.org', 'svelte.dev', 'tailwindcss.com',
  'kubernetes.io', 'terraform.io', 'aws.amazon.com', 'cloud.google.com',
  'wikipedia.org', 'en.wikipedia.org'
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

async function _querySpecificEngine(engine, q, numResults) {
  if (engine === 'wikipedia') {
    const wiki = await queryWikipedia(q, numResults);
    if (wiki?.length > 0) logSearchActivity('Wikipedia OpenSearch', q, wiki.length);
    return wiki || [];
  }
  if (engine === 'duckduckgo') {
    const ddg = await queryDuckDuckGo(q, numResults);
    if (ddg?.length > 0) logSearchActivity('DuckDuckGo HTML', q, ddg.length);
    return ddg || [];
  }
  if (engine === 'searxng') {
    const candidates = await getCandidateInstances();
    const bestInstance = await resolveBestInstance(candidates);
    if (!bestInstance) return [];
    const sx = await querySearxng(bestInstance, q, numResults);
    if (sx?.length > 0) logSearchActivity('SearXNG', q, sx.length);
    return sx || [];
  }
  if (engine === 'startpage') {
    const sp = await queryStartpage(q, numResults);
    if (sp?.length > 0) logSearchActivity('Startpage HTML', q, sp.length);
    return sp || [];
  }
  return null;
}

async function _queryWebFallbackChain(q, numResults) {
  const candidates = await getCandidateInstances();
  const bestInstance = await resolveBestInstance(candidates);
  if (bestInstance) {
    const sx = await querySearxng(bestInstance, q, numResults);
    if (sx?.length > 0) {
      logSearchActivity('SearXNG', q, sx.length);
      return sx;
    }
  }
  const ddg = await queryDuckDuckGo(q, numResults);
  if (ddg?.length > 0) {
    logSearchActivity('DuckDuckGo HTML', q, ddg.length);
    return ddg;
  }
  const sp = await queryStartpage(q, numResults);
  if (sp?.length > 0) {
    logSearchActivity('Startpage HTML', q, sp.length);
    return sp;
  }
  return [];
}

async function _queryBlendedSearch(q, numResults, isBlended, requestedEngine) {
  const webPromise = _queryWebFallbackChain(q, numResults);
  const wikiPromise = (async () => {
    if (!isBlended || requestedEngine !== 'all') return [];
    try {
      const wikiLimit = Math.min(2, Math.max(1, Math.floor(numResults / 2)));
      const wiki = await queryWikipedia(q, wikiLimit);
      if (wiki?.length > 0) {
        logSearchActivity('Wikipedia OpenSearch', q, wiki.length);
        return wiki;
      }
    } catch (_) { /* best effort */ }
    return [];
  })();

  const [webSettled, wikiSettled] = await Promise.allSettled([webPromise, wikiPromise]);
  const currentResults = [];
  if (webSettled.status === 'fulfilled' && Array.isArray(webSettled.value)) {
    currentResults.push(...webSettled.value);
  }
  if (wikiSettled.status === 'fulfilled' && Array.isArray(wikiSettled.value)) {
    currentResults.push(...wikiSettled.value);
  }
  if (currentResults.length === 0) {
    const fallbackWiki = await queryWikipedia(q, numResults);
    if (fallbackWiki?.length > 0) {
      logSearchActivity('Wikipedia OpenSearch', q, fallbackWiki.length);
      currentResults.push(...fallbackWiki);
    }
  }
  return currentResults;
}

function _appendUniqueResults(currentResults, seenUrls, allResults) {
  for (const r of currentResults) {
    if (!seenUrls.has(r.url)) {
      seenUrls.add(r.url);
      allResults.push(r);
    }
  }
}

async function runWebSearch(query, numResults = 5, searchDepth = 'standard', agentName = null, options = {}) {
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
  const requestedEngine = (options && options.engine) ? String(options.engine).toLowerCase() : 'all';
  const isBlended = options && options.blended !== undefined ? options.blended : (requestedEngine === 'all');

  for (const q of queries) {
    const specific = await _querySpecificEngine(requestedEngine, q, numResults);
    const currentResults = specific !== null
      ? specific
      : await _queryBlendedSearch(q, numResults, isBlended, requestedEngine);

    _appendUniqueResults(currentResults, seenUrls, allResults);
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
  queryStartpage,
  queryWikipedia,
  runWebSearch
};
