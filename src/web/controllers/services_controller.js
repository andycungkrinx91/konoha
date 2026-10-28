'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const doctor = require('../../doctor');
const dbSavings = require('../../db_savings');
const sembleManager = require('../../semble_manager');
const db = require('../../db');
const {
  sendJson,
  parseBody
} = require('./common');

let lastTelegramPingTime = 0;

function _detectDocsFromText(text) {
  const tmpFile = path.join(os.tmpdir(), `konoha_docs_detect_${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, text, 'utf8');
  try {
    const { detectDocsAi } = require('../../workflow/kage-reviewer/docs_ai_detector');
    return detectDocsAi(tmpFile);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* cleanup */ }
  }
}

async function _handleAiDetect(req, res, pathname, method, parsedUrl) {
  if (method === 'GET' && pathname === '/api/v1/detect-ai') {
    const target = (parsedUrl.searchParams.get('target') || parsedUrl.searchParams.get('path') || parsedUrl.searchParams.get('url') || '').trim();
    if (!target) return sendJson(res, 400, { error: 'Missing required query parameter: target (site directory path or http(s) URL)' });
    try {
      const { detectWebsiteAiAsync } = require('../../workflow/jonin-builder/ai_detector');
      const result = await detectWebsiteAiAsync(target);
      return sendJson(res, result?.error ? 400 : 200, result);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/v1/detect-docs') {
    const filePath = (parsedUrl.searchParams.get('file_path') || parsedUrl.searchParams.get('path') || parsedUrl.searchParams.get('target') || '').trim();
    if (!filePath) return sendJson(res, 400, { error: 'Missing required query parameter: file_path (document file path)' });
    try {
      const { detectDocsAi } = require('../../workflow/kage-reviewer/docs_ai_detector');
      const result = detectDocsAi(filePath);
      return sendJson(res, result?.error ? 400 : 200, result);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/detect-docs/text') {
    try {
      const body = await parseBody(req);
      const text = body?.text ? String(body.text).trim() : '';
      if (!text) return sendJson(res, 400, { error: 'Missing required field: text' });
      const detectResult = _detectDocsFromText(text);
      return sendJson(res, detectResult?.error ? 400 : 200, detectResult);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  return false;
}

function _parseNumericTokens(val) {
  if (typeof val === 'number') return val;
  if (!val || typeof val !== 'string') return 0;
  const clean = val.replace(/^[~ ]+/, '').replace(/\s*tokens?$/i, '').trim();
  const match = clean.match(/^(\d+\.?\d*)([kKmMbB])?$/);
  if (!match) return parseFloat(clean) || 0;
  const num = parseFloat(match[1]);
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'b') return Math.round(num * 1e9);
  if (unit === 'm') return Math.round(num * 1e6);
  if (unit === 'k') return Math.round(num * 1e3);
  return Math.round(num);
}

function _parseNumericCalls(val) {
  if (typeof val === 'number') return val;
  if (!val || typeof val !== 'string') return 0;
  const clean = val.trim();
  const match = clean.match(/^(\d+\.?\d*)([kKmM])?$/);
  if (!match) return parseInt(clean, 10) || 0;
  const num = parseFloat(match[1]);
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'm') return Math.round(num * 1e6);
  if (unit === 'k') return Math.round(num * 1e3);
  return Math.round(num);
}

function _calcCombinedPeriod(dbStats, sCalls, sTokens, sPct) {
  const dbCalls = dbStats?.calls || 0;
  const dbTokens = dbStats?.tokens || 0;
  const dbBytes = dbStats?.bytes || 0;
  const dbTotalBytes = dbStats?.total_bytes || 0;
  const sSavedBytes = sTokens * 4;
  const sTotalBytes = (sPct > 0 && sTokens > 0)
    ? Math.round(sSavedBytes / (sPct / 100))
    : (dbTotalBytes > 0 ? dbTotalBytes : 0);
  const combCalls = dbCalls + sCalls;
  const combTokens = dbTokens + sTokens;
  const combBytes = dbBytes + sSavedBytes;
  const combTotalBytes = dbTotalBytes + (sPct > 0 ? sTotalBytes : 0);
  const combPct = combTotalBytes > 0 ? Math.round((combBytes / combTotalBytes) * 100) : (dbStats?.pct || 0);
  return { calls: combCalls, tokens: combTokens, bytes: combBytes, pct: combPct };
}

function _buildSavingsResponse(report, semble) {
  const parsePct = (val) => (typeof val === 'number' && !isNaN(val)) ? val : (parseInt(val, 10) || 0);
  const today = { ...report.today, pct_saved: typeof report.today?.pct === 'number' ? report.today.pct : 0, tokens_saved_bytes: report.today?.bytes ?? 0, tokens_saved_approx: report.today?.tokens ?? 0 };
  const last7Days = { ...report.last7days, pct_saved: typeof report.last7days?.pct === 'number' ? report.last7days.pct : 0, tokens_saved_bytes: report.last7days?.bytes ?? 0, tokens_saved_approx: report.last7days?.tokens ?? 0 };
  const allTime = { ...report.alltime, pct_saved: typeof report.alltime?.pct === 'number' ? report.alltime.pct : 0, tokens_saved_bytes: report.alltime?.bytes ?? 0, tokens_saved_approx: report.alltime?.tokens ?? 0 };

  const sTodayCalls = _parseNumericCalls(semble.today?.calls);
  const sTodayTokens = _parseNumericTokens(semble.today?.tokens_saved);
  const sTodayPct = parsePct(semble.today?.ratio_pct ?? semble.today?.pct);
  const sLast7Calls = _parseNumericCalls(semble.last_7_days?.calls ?? semble['7days']?.calls ?? semble.last7days?.calls);
  const sLast7Tokens = _parseNumericTokens(semble.last_7_days?.tokens_saved ?? semble['7days']?.tokens_saved ?? semble.last7days?.tokens_saved);
  const sLast7Pct = parsePct(semble.last_7_days?.ratio_pct ?? semble['7days']?.pct ?? semble.last7days?.pct);
  const sAllTimeCalls = _parseNumericCalls(semble.all_time?.calls ?? semble.all?.calls ?? semble.alltime?.calls);
  const sAllTimeTokens = _parseNumericTokens(semble.all_time?.tokens_saved ?? semble.all?.tokens_saved ?? semble.alltime?.tokens_saved);
  const sAllTimePct = parsePct(semble.all_time?.ratio_pct ?? semble.all?.pct ?? semble.alltime?.pct);

  const combinedToday = _calcCombinedPeriod(today, sTodayCalls, sTodayTokens, sTodayPct);
  const combinedLast7Days = _calcCombinedPeriod(last7Days, sLast7Calls, sLast7Tokens, sLast7Pct);
  const combinedAllTime = _calcCombinedPeriod(allTime, sAllTimeCalls, sAllTimeTokens, sAllTimePct);
  const avgPct = combinedToday.pct > 0 ? combinedToday.pct : (combinedLast7Days.pct > 0 ? combinedLast7Days.pct : combinedAllTime.pct);

  const combined = { today: combinedToday, last_7_days: combinedLast7Days, last7days: combinedLast7Days, all_time: combinedAllTime, alltime: combinedAllTime, avg_pct: avgPct };
  return { ...report, today, last7days: last7Days, last_7_days: last7Days, alltime: allTime, all_time: allTime, semble, combined };
}

function _handleSavings(res, pathname, method) {
  if (method !== 'GET' || pathname !== '/api/v1/savings') return false;
  try {
    const report = dbSavings.getSavingsReport();
    const semble = sembleManager.getSembleSavings();
    return sendJson(res, 200, _buildSavingsResponse(report, semble));
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function _handleSemble(req, res, pathname, method) {
  if (method === 'GET' && pathname === '/api/v1/semble') {
    try {
      return sendJson(res, 200, { ok: true, available: sembleManager.isSembleAvailable(), savings: sembleManager.getSembleSavings() });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  if (method === 'GET' && pathname === '/api/v1/semble/savings') {
    try {
      return sendJson(res, 200, { ok: true, savings: sembleManager.getSembleSavings() });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  if (method === 'POST' && pathname === '/api/v1/semble/search') {
    try {
      const body = await parseBody(req);
      const query = (body.query || body.q || '').trim();
      const repo = body.repo || body.path || process.cwd();
      const limit = parseInt(body.limit || 10, 10);
      return sendJson(res, 200, sembleManager.searchSemble(query, repo, limit));
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  return false;
}

function _getSearchStatus() {
  const searxngDir = path.join(os.homedir(), '.konoha', 'searxng');
  const bestPath = path.join(searxngDir, 'best_instance.json');
  const instPath = path.join(searxngDir, 'instances_cache.json');
  const logPath = path.join(searxngDir, 'search.log');
  let bestInstance = null;
  let instancesCount = 0;
  let logSize = 0;
  if (fs.existsSync(bestPath)) {
    try { bestInstance = JSON.parse(fs.readFileSync(bestPath, 'utf8')); } catch (_) { /* ignore */ }
  }
  if (fs.existsSync(instPath)) {
    try {
      const insts = JSON.parse(fs.readFileSync(instPath, 'utf8'));
      instancesCount = Array.isArray(insts) ? insts.length : 0;
    } catch (_) { /* ignore */ }
  }
  if (fs.existsSync(logPath)) {
    try { logSize = fs.statSync(logPath).size; } catch (_) { /* ignore */ }
  }
  return {
    provider: 'SearXNG Multi-Source Chain',
    custom_url: process.env.SEARXNG_URL || process.env.KONOHA_SEARXNG_URL || null,
    best_instance: bestInstance ? bestInstance.url : null,
    best_instance_resolved_at: bestInstance ? bestInstance.resolved_at : null,
    cached_candidates_count: instancesCount,
    search_log_size_bytes: logSize,
    fallbacks: ['DuckDuckGo HTML', 'Startpage HTML', 'Wikipedia OpenSearch'],
    zero_api_key: true
  };
}

async function _executeSkillsSearch(cleanQuery, numResults) {
  const vectorSearch = require('../../vector_search');
  const conn = db.getConnection(null, false);
  try {
    const skillHits = await vectorSearch.findSkillHybrid(conn, cleanQuery, { topK: numResults });
    const results = (skillHits || []).map((s, idx) => ({
      citation_id: idx + 1,
      title: s.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      url: `/skills?q=${encodeURIComponent(s.name)}`,
      snippet: s.tags || s.matched_chunk || `Konoha Skill: ${s.name} (${s.type || 'skill'})`,
      source: `Konoha Skills (${(s.engine || 'fts5').toUpperCase()})`
    }));
    return { status: 'success', query: cleanQuery, source: 'skills', results_count: results.length, results };
  } finally {
    conn.close();
  }
}

async function _executeBlendedSearch(cleanQuery, numResults, searchDepth) {
  const webSearch = require('../../mcp/web_search');
  const vectorSearch = require('../../vector_search');
  const webPromise = webSearch.runWebSearch(cleanQuery, numResults, searchDepth, 'web_ui', { engine: 'all', blended: true });
  const skillsPromise = (async () => {
    const conn = db.getConnection(null, false);
    try { return await vectorSearch.findSkillHybrid(conn, cleanQuery, { topK: 2 }); } finally { conn.close(); }
  })();

  const [webSettled, skillsSettled] = await Promise.allSettled([webPromise, skillsPromise]);
  let parsed = { status: 'success', results: [] };
  if (webSettled.status === 'fulfilled') {
    try { parsed = JSON.parse(webSettled.value); } catch (_) { parsed = { status: 'success', results: [] }; }
  }
  let formattedSkills = [];
  if (skillsSettled.status === 'fulfilled' && Array.isArray(skillsSettled.value)) {
    formattedSkills = skillsSettled.value
      .filter(s => (s.score || 0) >= 0.3)
      .map(s => ({
        title: '[Skill] ' + s.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        url: `/skills?q=${encodeURIComponent(s.name)}`,
        snippet: s.tags || s.matched_chunk || `Konoha Skill: ${s.name} (${s.type || 'skill'})`,
        source: `Konoha Skills (${(s.engine || 'fts5').toUpperCase()})`
      }));
  }
  const combined = [...formattedSkills, ...(parsed.results || [])].slice(0, numResults);
  parsed.results = combined.map((item, idx) => ({ ...item, citation_id: idx + 1 }));
  parsed.results_count = parsed.results.length;
  return parsed;
}

async function _handleSearch(req, res, pathname, method) {
  if (method === 'GET' && pathname === '/api/v1/search/status') {
    try { return sendJson(res, 200, _getSearchStatus()); } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'GET' && pathname === '/api/v1/search/logs') {
    try {
      const logPath = path.join(os.homedir(), '.konoha', 'searxng', 'search.log');
      const logs = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-100).reverse() : [];
      return sendJson(res, 200, { logs, count: logs.length });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'POST' && pathname === '/api/v1/search') {
    try {
      const body = await parseBody(req);
      if (!body.query?.trim()) return sendJson(res, 400, { error: 'Search query is required.' });
      const cleanQuery = body.query.trim();
      const numResults = Math.min(Math.max(parseInt(body.num_results || body.numResults || 5, 10), 1), 50);
      const searchDepth = ['standard', 'deep'].includes(body.search_depth || body.searchDepth) ? (body.search_depth || body.searchDepth) : 'standard';
      const source = String(body.source || body.engine || 'all').toLowerCase();
      if (source === 'skills') return sendJson(res, 200, await _executeSkillsSearch(cleanQuery, numResults));
      if (source === 'all') return sendJson(res, 200, await _executeBlendedSearch(cleanQuery, numResults, searchDepth));
      const webSearch = require('../../mcp/web_search');
      const rawRes = await webSearch.runWebSearch(cleanQuery, numResults, searchDepth, 'web_ui', { engine: source, blended: false });
      let parsed = null;
      try { parsed = JSON.parse(rawRes); } catch (_) { parsed = { status: 'success', results: [] }; }
      return sendJson(res, 200, parsed);
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'POST' && pathname === '/api/v1/search/clear-cache') {
    try {
      const searxngDir = path.join(os.homedir(), '.konoha', 'searxng');
      const bestPath = path.join(searxngDir, 'best_instance.json');
      const instPath = path.join(searxngDir, 'instances_cache.json');
      let cleared = 0;
      if (fs.existsSync(bestPath)) { fs.unlinkSync(bestPath); cleared++; }
      if (fs.existsSync(instPath)) { fs.unlinkSync(instPath); cleared++; }
      return sendJson(res, 200, { ok: true, cleared });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  return false;
}

async function _handleDoctor(req, res, pathname, method, broadcastEvent) {
  if (method === 'GET' && pathname === '/api/v1/doctor') {
    try { return sendJson(res, 200, doctor.getDiagnostics()); } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'POST' && pathname === '/api/v1/doctor/repair') {
    try {
      const body = await parseBody(req);
      const report = doctor.runRepairs(body.check || 'all');
      broadcastEvent('doctor_repaired', report);
      return sendJson(res, 200, report);
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  return false;
}

async function _handleTelegram(req, res, pathname, method, broadcastEvent) {
  if (method === 'GET' && pathname === '/api/v1/telegram/config') {
    try {
      const tgConfig = require('../../telegram/config');
      const poller = require('../../telegram/poller');
      const cfg = tgConfig.getTelegramConfig();
      const maskedToken = cfg.bot_token ? `${cfg.bot_token.slice(0, 8)}...` : '';
      return sendJson(res, 200, {
        ok: true, ...cfg, bot_token: maskedToken, bot_token_masked: maskedToken,
        webhook_secret: cfg.webhook_secret ? '******' : '', has_token: Boolean(cfg.bot_token),
        poller_running: poller.isPollerRunning()
      });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'POST' && pathname === '/api/v1/telegram/config') {
    try {
      const tgConfig = require('../../telegram/config');
      const poller = require('../../telegram/poller');
      const body = await parseBody(req);
      const updated = tgConfig.saveTelegramConfig(body);
      if (updated.enabled && updated.mode === 'two_way' && updated.bot_token) {
        poller.stopPoller(); poller.startPoller();
      } else { poller.stopPoller(); }
      const maskedToken = updated.bot_token ? `${updated.bot_token.slice(0, 8)}...` : '';
      const maskedConfig = { ...updated, bot_token: maskedToken, bot_token_masked: maskedToken, webhook_secret: updated.webhook_secret ? '******' : '', has_token: Boolean(updated.bot_token) };
      broadcastEvent('telegram_updated', { action: 'config', config: maskedConfig, poller_running: poller.isPollerRunning() });
      return sendJson(res, 200, { ok: true, config: maskedConfig, poller_running: poller.isPollerRunning() });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'POST' && pathname === '/api/v1/telegram/test') {
    const now = Date.now();
    if (now - lastTelegramPingTime < 3000) return sendJson(res, 429, { ok: false, error: 'Rate limit: Please wait 3 seconds between test pings' });
    lastTelegramPingTime = now;
    try {
      const tgNotifier = require('../../telegram/notifier');
      const body = await parseBody(req).catch(() => ({}));
      return sendJson(res, 200, await tgNotifier.sendTestPing(body.chat_id || null, body.bot_token || null));
    } catch (err) { return sendJson(res, 500, { ok: false, error: err.message }); }
  }
  if (method === 'POST' && pathname === '/api/v1/telegram/enable') {
    try {
      const tgConfig = require('../../telegram/config');
      const poller = require('../../telegram/poller');
      tgConfig.setTelegramEnabled(true);
      const cfg = tgConfig.getTelegramConfig();
      if (cfg.mode === 'two_way' && cfg.bot_token) { poller.stopPoller(); poller.startPoller(); }
      broadcastEvent('telegram_updated', { action: 'enable', poller_running: poller.isPollerRunning() });
      return sendJson(res, 200, { ok: true, enabled: 1, poller_running: poller.isPollerRunning() });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'POST' && pathname === '/api/v1/telegram/disable') {
    try {
      const tgConfig = require('../../telegram/config');
      const poller = require('../../telegram/poller');
      tgConfig.setTelegramEnabled(false);
      poller.stopPoller();
      broadcastEvent('telegram_updated', { action: 'disable' });
      return sendJson(res, 200, { ok: true, enabled: 0 });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  return false;
}

async function _handleWebhooks(req, res, pathname, method, broadcastEvent) {
  const wm = require('../../webhook_manager');
  if (method === 'GET' && pathname === '/api/v1/webhooks') {
    try { return sendJson(res, 200, { ok: true, webhooks: wm.listWebhooks() }); } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'POST' && pathname === '/api/v1/webhooks') {
    try {
      const body = await parseBody(req);
      const created = wm.createWebhook(body);
      broadcastEvent('webhooks_updated', { action: 'create', webhook: created });
      return sendJson(res, 201, { ok: true, webhook: created });
    } catch (err) { return sendJson(res, 400, { error: err.message }); }
  }
  if (method === 'PUT' && pathname.startsWith('/api/v1/webhooks/') && !pathname.endsWith('/test')) {
    const webhookId = pathname.split('/')[4];
    try {
      const body = await parseBody(req);
      const updated = wm.updateWebhook(webhookId, body);
      broadcastEvent('webhooks_updated', { action: 'update', webhook: updated });
      return sendJson(res, 200, { ok: true, webhook: updated });
    } catch (err) { return sendJson(res, 400, { error: err.message }); }
  }
  if (method === 'DELETE' && pathname.startsWith('/api/v1/webhooks/')) {
    const webhookId = pathname.split('/')[4];
    try {
      const success = wm.deleteWebhook(webhookId);
      broadcastEvent('webhooks_updated', { action: 'delete', id: webhookId });
      return sendJson(res, 200, { ok: success });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'POST' && pathname.startsWith('/api/v1/webhooks/') && pathname.endsWith('/test')) {
    const webhookId = pathname.split('/')[4];
    try {
      const target = wm.getWebhook(webhookId);
      if (!target) return sendJson(res, 404, { error: 'Webhook not found' });
      const testRes = await wm.sendWebhookPayload(target, { event: 'test_ping', message: 'Konoha Village Webhook Integration Test Ping', timestamp: new Date().toISOString(), status: 'SUCCESS' });
      return sendJson(res, 200, { ok: testRes.ok, ...testRes });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  return false;
}

async function _handleQueueAndEvents(req, res, route, ctx) {
  const { pathname, method, parsedUrl } = route;
  if (method === 'GET' && pathname === '/api/v1/queue/prompts') {
    try {
      const inbox = require('../../queue/inbox');
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '20', 10);
      const status = parsedUrl.searchParams.get('status') || null;
      return sendJson(res, 200, { ok: true, prompts: inbox.listPrompts({ limit, status }) });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'POST' && pathname === '/api/v1/queue/prompts') {
    try {
      const inbox = require('../../queue/inbox');
      const body = await parseBody(req);
      if (!body.prompt || !String(body.prompt).trim()) return sendJson(res, 400, { error: 'Prompt text cannot be empty' });
      const task = inbox.enqueuePrompt({ prompt: body.prompt, source: body.source || 'web_ui', sender_info: body.sender || 'web_dashboard', session_id: body.session_id || 'default' });
      ctx.broadcastEvent('queue_updated', { action: 'enqueue', task });
      return sendJson(res, 200, { ok: true, task });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'GET' && pathname === '/api/v1/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write('event: connected\ndata: ' + JSON.stringify({ ok: true, time: Date.now() }) + '\n\n');
    ctx.sseClients.add(res);
    req.on('close', () => { ctx.sseClients.delete(res); });
    return true;
  }
  return false;
}

async function handleServicesRoutes(req, res, ctx, parsedUrl, ...rest) {
  const [pathname, method] = rest;
  const { broadcastEvent } = ctx;

  const aiDetectRes = await _handleAiDetect(req, res, pathname, method, parsedUrl);
  if (aiDetectRes !== false) return aiDetectRes;

  const savingsRes = _handleSavings(res, pathname, method);
  if (savingsRes !== false) return savingsRes;

  const sembleRes = await _handleSemble(req, res, pathname, method);
  if (sembleRes !== false) return sembleRes;

  const searchRes = await _handleSearch(req, res, pathname, method);
  if (searchRes !== false) return searchRes;

  const doctorRes = await _handleDoctor(req, res, pathname, method, broadcastEvent);
  if (doctorRes !== false) return doctorRes;

  const tgRes = await _handleTelegram(req, res, pathname, method, broadcastEvent);
  if (tgRes !== false) return tgRes;

  const webhookRes = await _handleWebhooks(req, res, pathname, method, broadcastEvent);
  if (webhookRes !== false) return webhookRes;

  const queueRes = await _handleQueueAndEvents(req, res, { pathname, method, parsedUrl }, ctx);
  if (queueRes !== false) return queueRes;

  return false;
}

module.exports = {
  handleServicesRoutes
};
