#!/usr/bin/env node
/**
 * Helper script and in-process module to query token savings and tool call statistics as JSON.
 * Pure Node.js replacement for db_savings.py using the node:sqlite driver.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db');

function parseIsoDatetime(dtStr) {
  if (!dtStr) return null;
  const d = new Date(dtStr);
  return isNaN(d.getTime()) ? null : d;
}

let _memTokenCache = null;
let _memTokenCacheTs = 0;

function findTranscriptPaths(brainDirs) {
  const allPaths = [];
  for (const bDir of brainDirs) {
    if (!fs.existsSync(bDir)) continue;
    try {
      const convEntries = fs.readdirSync(bDir);
      for (const conv of convEntries) {
        const tPath = path.join(bDir, conv, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(tPath)) allPaths.push(tPath);
      }
    } catch (_) { /* best-effort */ }
  }
  return allPaths;
}

function applyCachedTranscript(cachedEntry, cutoffs, metrics) {
  const cAll = cachedEntry.all;
  metrics.all.content_chars += (cAll.content_chars || 0);
  metrics.all.thought_chars += (cAll.thought_chars || 0);
  metrics.all.cost += (cAll.cost || 0.0);

  if (!Array.isArray(cachedEntry.recent)) return;
  for (const rec of cachedEntry.recent) {
    if (rec.ts >= cutoffs.cutoff7DaysTs) {
      metrics["7days"].content_chars += (rec.content_chars || 0);
      metrics["7days"].thought_chars += (rec.thought_chars || 0);
      metrics["7days"].cost += (rec.cost || 0.0);
    }
    if (rec.ts >= cutoffs.cutoffTodayTs) {
      metrics.today.content_chars += (rec.content_chars || 0);
      metrics.today.thought_chars += (rec.thought_chars || 0);
      metrics.today.cost += (rec.cost || 0.0);
    }
  }
}

function isProModelRecord(content, filePath) {
  const lowerContent = content.toLowerCase();
  if (lowerContent.includes("genin") || lowerContent.includes("chunin") || lowerContent.includes("tokubetsu") || lowerContent.includes("jonin")) {
    return false;
  }
  if (lowerContent.includes("anbu") || lowerContent.includes("kage") || lowerContent.includes("antigravity")) {
    return true;
  }
  const lowerPath = filePath.toLowerCase();
  return !(lowerPath.includes("genin") || lowerPath.includes("chunin") || lowerPath.includes("tokubetsu") || lowerPath.includes("jonin"));
}

function parseTranscriptRecord(record, filePath, ctx) {
  if (record.source !== "MODEL" || record.type !== "PLANNER_RESPONSE") return;
  const { cutoffs, rates, metrics, fileAll, fileRecent } = ctx;
  const dt = parseIsoDatetime(record.created_at);
  const content = record.content || "";
  const thinking = record.thinking || "";
  const contentLen = content.length;
  const thinkingLen = thinking.length;
  const totalTurnOutTokens = (contentLen + thinkingLen) / 4.0;

  const rate = isProModelRecord(content, filePath) ? rates.proOutRate : rates.flashOutRate;
  const cost = totalTurnOutTokens * rate;

  fileAll.content_chars += contentLen;
  fileAll.thought_chars += thinkingLen;
  fileAll.cost += cost;
  metrics.all.content_chars += contentLen;
  metrics.all.thought_chars += thinkingLen;
  metrics.all.cost += cost;

  if (!dt) return;
  const ts = dt.getTime() / 1000;
  if (ts >= cutoffs.cutoff7DaysTs) {
    fileRecent.push({ ts, content_chars: contentLen, thought_chars: thinkingLen, cost });
    metrics["7days"].content_chars += contentLen;
    metrics["7days"].thought_chars += thinkingLen;
    metrics["7days"].cost += cost;
  }
  if (ts >= cutoffs.cutoffTodayTs) {
    metrics.today.content_chars += contentLen;
    metrics.today.thought_chars += thinkingLen;
    metrics.today.cost += cost;
  }
}

function parseTranscriptFile(filePath, cutoffs, rates, metrics) {
  const fileAll = { content_chars: 0, thought_chars: 0, cost: 0.0 };
  const fileRecent = [];
  const contentStr = fs.readFileSync(filePath, 'utf-8');
  const lines = contentStr.split('\n');
  const ctx = { cutoffs, rates, metrics, fileAll, fileRecent };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('"source":"MODEL"')) continue;
    try {
      const record = JSON.parse(trimmed);
      parseTranscriptRecord(record, filePath, ctx);
    } catch (_) { /* best-effort */ }
  }
  return { fileAll, fileRecent };
}

function loadTranscriptCache(cacheFile) {
  if (!fs.existsSync(cacheFile)) return { version: 2, files: {} };
  try {
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    return (cache && typeof cache === 'object' && cache.files) ? cache : { version: 2, files: {} };
  } catch (_) {
    return { version: 2, files: {} };
  }
}

function calculateAllModelTokens() {
  const nowMs = Date.now();
  if (_memTokenCache && (nowMs - _memTokenCacheTs < 15000)) return _memTokenCache;

  const home = os.homedir();
  const brainDirs = [
    path.join(home, '.gemini', 'antigravity-cli', 'brain'),
    path.join(home, '.gemini', 'antigravity-ide', 'brain')
  ];

  const now = new Date();
  const cutoffToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const cutoff7Days = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0);
  const cutoffs = {
    cutoffTodayTs: cutoffToday.getTime() / 1000,
    cutoff7DaysTs: cutoff7Days.getTime() / 1000
  };
  const rates = { flashOutRate: 0.30 / 1000000, proOutRate: 5.00 / 1000000 };

  const metrics = {
    today: { content_chars: 0, thought_chars: 0, cost: 0.0 },
    "7days": { content_chars: 0, thought_chars: 0, cost: 0.0 },
    all: { content_chars: 0, thought_chars: 0, cost: 0.0 }
  };

  const cacheFile = path.join(home, '.konoha', 'transcript_cache.json');
  const cache = loadTranscriptCache(cacheFile);
  const allPaths = findTranscriptPaths(brainDirs);
  let cacheUpdated = false;

  for (const filePath of allPaths) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const st = fs.statSync(filePath);
      const mtime = st.mtimeMs / 1000;
      const size = st.size;
      const cachedEntry = cache.files?.[filePath];
      if (cachedEntry && Math.abs(cachedEntry.mtime - mtime) < 0.001 && cachedEntry.size === size && cachedEntry.all) {
        applyCachedTranscript(cachedEntry, cutoffs, metrics);
        continue;
      }

      const { fileAll, fileRecent } = parseTranscriptFile(filePath, cutoffs, rates, metrics);
      if (!cache.files) cache.files = {};
      cache.files[filePath] = { mtime, size, all: fileAll, recent: fileRecent };
      cacheUpdated = true;
    } catch (_) { /* best-effort */ }
  }

  if (cacheUpdated) {
    try {
      const dir = path.dirname(cacheFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(cache), 'utf-8');
    } catch (_) { /* best-effort */ }
  }

  const res = {
    today: { content_tokens: Math.floor(metrics.today.content_chars / 4), thought_tokens: Math.floor(metrics.today.thought_chars / 4), output_cost_usd: metrics.today.cost },
    "7days": { content_tokens: Math.floor(metrics["7days"].content_chars / 4), thought_tokens: Math.floor(metrics["7days"].thought_chars / 4), output_cost_usd: metrics["7days"].cost },
    all: { content_tokens: Math.floor(metrics.all.content_chars / 4), thought_tokens: Math.floor(metrics.all.thought_chars / 4), output_cost_usd: metrics.all.cost }
  };
  _memTokenCache = res;
  _memTokenCacheTs = Date.now();
  return res;
}

function queryInputSavingsCost(conn, timeFilter = null) {
  let whereClause = "";
  if (timeFilter === "today") {
    whereClause = "WHERE date(timestamp, 'localtime') >= date('now', 'localtime')";
  } else if (timeFilter === "7days") {
    whereClause = "WHERE date(timestamp, 'localtime') >= date('now', '-7 days', 'localtime')";
  }

  const query = `
    SELECT agent, COALESCE(SUM(tokens_saved), 0) as tokens
    FROM tool_calls
    ${whereClause}
    GROUP BY agent
  `;
  const rows = conn.prepare(query).all();

  const flashRate = 0.075 / 1000000;
  const proRate = 1.25 / 1000000;
  let totalSavedUsd = 0.0;

  for (const row of rows) {
    const agent = (row.agent || "").toLowerCase();
    const tokens = row.tokens || 0;

    let isPro = true;
    if (agent.includes("genin") || agent.includes("chunin") || agent.includes("tokubetsu") || agent.includes("jonin")) {
      isPro = false;
    }

    const rate = isPro ? proRate : flashRate;
    totalSavedUsd += tokens * rate;
  }

  return totalSavedUsd;
}

function queryStats(conn, timeFilter = null, modelTokens = null) {
  let whereClause = "";
  if (timeFilter === null || timeFilter === "all") {
    whereClause = "";
  } else if (timeFilter === "today") {
    whereClause = "WHERE date(timestamp, 'localtime') >= date('now', 'localtime')";
  } else if (timeFilter === "7days") {
    whereClause = "WHERE date(timestamp, 'localtime') >= date('now', '-7 days', 'localtime')";
  }

  let libraryBaselineBytes = 2065 * 1024;
  try {
    const baselineRow = conn.prepare("SELECT SUM(byte_size) as b FROM skills").get();
    if (baselineRow && baselineRow.b) {
      libraryBaselineBytes = 2065 * 1024;
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  const query = `
    SELECT
        COUNT(*) as calls,
        COALESCE(SUM(bytes_saved), 0) as bytes,
        COALESCE(SUM(tokens_saved), 0) as tokens,
        COALESCE(SUM(bytes_saved + returned_bytes), 0) as total_tool_calls_bytes
    FROM tool_calls
    ${whereClause}
  `;
  const row = conn.prepare(query).get();
  const totalBytes = row.total_tool_calls_bytes;
  const pct = totalBytes > 0 ? Math.round((row.bytes / totalBytes) * 100) : 0;

  const savedUsd = queryInputSavingsCost(conn, timeFilter);
  const outStats = modelTokens || { content_tokens: 0, thought_tokens: 0, output_cost_usd: 0.0 };
  const netSavedUsd = Math.max(0.0, savedUsd - outStats.output_cost_usd);

  const byClient = {
    antigravity: { calls: 0, bytes: 0, tokens: 0 },
    agy: { calls: 0, bytes: 0, tokens: 0 },
    cursor: { calls: 0, bytes: 0, tokens: 0 },
    claudecode: { calls: 0, bytes: 0, tokens: 0 },
    opencode: { calls: 0, bytes: 0, tokens: 0 },
    commandcode: { calls: 0, bytes: 0, tokens: 0 },
    codex: { calls: 0, bytes: 0, tokens: 0 },
    pi: { calls: 0, bytes: 0, tokens: 0 },
    omp: { calls: 0, bytes: 0, tokens: 0 },
    // Calls with no verified client session signal (honest attribution):
    // displayed as "Unattributed" instead of being hidden or labeled "Unknown".
    unattributed: { calls: 0, bytes: 0, tokens: 0 },
  };

  const queryClient = `
    SELECT
        COALESCE(client, 'antigravity') as c_name,
        COUNT(*) as calls,
        COALESCE(SUM(bytes_saved), 0) as bytes,
        COALESCE(SUM(tokens_saved), 0) as tokens
    FROM tool_calls
    ${whereClause}
    GROUP BY c_name
  `;

  try {
    const rowsClient = conn.prepare(queryClient).all();
    for (const rC of rowsClient) {
      let cName = (rC.c_name || "").toLowerCase();
      if (!(cName in byClient)) {
        cName = "unattributed";
      }
      if (!byClient[cName]) {
        byClient[cName] = { calls: 0, bytes: 0, tokens: 0 };
      }
      byClient[cName].calls += rC.calls;
      byClient[cName].bytes += rC.bytes;
      byClient[cName].tokens += rC.tokens;
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  return {
    calls: row.calls,
    bytes: row.bytes,
    tokens: row.tokens,
    pct,
    total_bytes: totalBytes,
    db_size_bytes: libraryBaselineBytes,
    saved_usd: savedUsd,
    content_tokens: outStats.content_tokens,
    thought_tokens: outStats.thought_tokens,
    output_cost_usd: outStats.output_cost_usd,
    net_saved_usd: netSavedUsd,
    by_client: byClient
  };
}

function extractQueryString(query) {
  if (typeof query === 'string' && query.startsWith('{')) {
    try {
      const p = JSON.parse(query);
      return p.query || p.keyword || p.keywords || query;
    } catch (_) { /* ignore */ }
  }
  return query;
}

function resolveMatchedFtsBytes(conn, words) {
  if (!words || words.length === 0) return 0;
  try {
    const ftsMatch = words.map(w => `"${w.replace(/"/g, '""')}*"`).join(' OR ');
    const fRowMatched = conn.prepare(`
      SELECT COALESCE(SUM(s.byte_size), 0) as total_matched
      FROM (SELECT rowid FROM skills_fts WHERE skills_fts MATCH ? LIMIT 10) f
      JOIN skills s ON s.rowid = f.rowid
    `).get(ftsMatch);
    if (fRowMatched && fRowMatched.total_matched > 0) return Number(fRowMatched.total_matched);
  } catch (_) {
    try {
      const lk = '%' + words[0] + '%';
      const likeRow = conn.prepare(`
        SELECT COALESCE(SUM(byte_size), 0) as total_matched
        FROM (SELECT byte_size FROM skills WHERE tags LIKE ? OR name LIKE ? OR skill_name LIKE ? LIMIT 5)
      `).get(lk, lk, lk);
      if (likeRow && likeRow.total_matched > 0) return Number(likeRow.total_matched);
    } catch (_) { /* ignore */ }
  }
  return 0;
}

function sanitizeLegacyFindRows(conn) {
  const legacyFindRows = conn.prepare(`
    SELECT id, query, returned_bytes FROM tool_calls WHERE tool IN ('find_skill', 'find_skills') AND total_library_bytes >= 400000
  `).all();
  const updateFindRow = conn.prepare(`
    UPDATE tool_calls SET total_library_bytes = ?, bytes_saved = ?, tokens_saved = ? WHERE id = ?
  `);
  for (const fRow of legacyFindRows) {
    const extracted = extractQueryString(fRow.query);
    const words = String(extracted || '').replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const matchedBytes = resolveMatchedFtsBytes(conn, words);
    const finalBaseline = Math.max(Number(fRow.returned_bytes) || 0, matchedBytes);
    const bSaved = Math.max(0, finalBaseline - (Number(fRow.returned_bytes) || 0));
    const tSaved = Math.floor(bSaved / 4);
    updateFindRow.run(finalBaseline, bSaved, tSaved, fRow.id);
  }
}

function sanitizeLegacyGetSkillRows(conn) {
  const getSkillRows = conn.prepare("SELECT id, query, returned_bytes FROM tool_calls WHERE tool = 'get_skill' AND bytes_saved = 0").all();
  const updateGetSkill = conn.prepare("UPDATE tool_calls SET total_library_bytes = ?, bytes_saved = ?, tokens_saved = ? WHERE id = ?");
  for (const gRow of getSkillRows) {
    let skillTarget = gRow.query;
    if (typeof skillTarget === 'string' && skillTarget.startsWith('{')) {
      try { skillTarget = JSON.parse(skillTarget).name || skillTarget; } catch (_) { /* ignore */ }
    }
    const sRow = conn.prepare('SELECT byte_size FROM skills WHERE name = ? OR name LIKE ? LIMIT 1').get(skillTarget, `%/${skillTarget}`);
    if (sRow && sRow.byte_size > gRow.returned_bytes) {
      const bSaved = sRow.byte_size - gRow.returned_bytes;
      const tSaved = Math.floor(bSaved / 4);
      updateGetSkill.run(sRow.byte_size, bSaved, tSaved, gRow.id);
    }
  }
}

function sanitizeLegacyRecords(conn) {
  try {
    conn.prepare("DELETE FROM tool_calls WHERE tool LIKE 'test_%' OR query LIKE '%test_tool%'").run();
    conn.prepare(`
      UPDATE tool_calls
      SET total_library_bytes = returned_bytes, bytes_saved = 0, tokens_saved = 0
      WHERE tool IN ('anbu', 'genin', 'sannin', 'kage', 'jonin', 'tokubetsu_jonin', 'tokubetsu-jonin')
        AND total_library_bytes > returned_bytes
    `).run();
    conn.prepare(`
      UPDATE tool_calls
      SET total_library_bytes = returned_bytes, bytes_saved = 0, tokens_saved = 0
      WHERE tool NOT IN ('find_skill', 'find_skills', 'list_skills', 'optimize_report', 'get_skill')
        AND total_library_bytes >= 400000
    `).run();
    try { sanitizeLegacyFindRows(conn); } catch (_) { /* ignore */ }

    conn.prepare(`
      UPDATE tool_calls
      SET total_library_bytes = MAX(returned_bytes, 35000),
          bytes_saved = MAX(0, MAX(returned_bytes, 35000) - returned_bytes),
          tokens_saved = CAST((MAX(0, MAX(returned_bytes, 35000) - returned_bytes) / 4) AS INTEGER)
      WHERE tool IN ('list_skills', 'optimize_report') AND total_library_bytes >= 400000
    `).run();
    try { sanitizeLegacyGetSkillRows(conn); } catch (_) { /* ignore */ }
  } catch (_) { /* best-effort */ }
}

function getSavingsReport(dbPath = null) {
  const targetPath = dbPath || db.DB_PATH;
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Database not found at ${targetPath}`);
  }

  const conn = db.getConnection(targetPath, false);
  try {
    db.setupSchema(conn);
    sanitizeLegacyRecords(conn);

    const allModelTokens = calculateAllModelTokens();
    const statsToday = queryStats(conn, "today", allModelTokens.today);
    const stats7Days = queryStats(conn, "7days", allModelTokens["7days"]);
    const statsAll = queryStats(conn, "all", allModelTokens.all);

    const rows = conn.prepare(`
      SELECT
          tool,
          COUNT(*) as calls,
          COALESCE(SUM(bytes_saved), 0) as bytes,
          COALESCE(SUM(bytes_saved + returned_bytes), 0) as total_bytes
      FROM tool_calls
      GROUP BY tool
      ORDER BY calls DESC
    `).all();

    const byCallType = [];
    for (const r of rows) {
      const calls = r.calls;
      const bytesSaved = r.bytes;
      const totalBytes = r.total_bytes;
      const pct = totalBytes > 0 ? Math.round((bytesSaved / totalBytes) * 100) : 0;
      byCallType.push({
        tool: r.tool,
        calls,
        bytes: bytesSaved,
        pct
      });
    }

    let tiktokenAccuracy = null;
    try {
      const tokenSampler = require('./token_sampler');
      tiktokenAccuracy = tokenSampler.getDriftMetrics();
    } catch (_) { /* best-effort fallback: failure here must never crash telemetry */ }

    return {
      today: statsToday,
      last7days: stats7Days,
      alltime: statsAll,
      by_call_type: byCallType,
      tiktoken_accuracy: tiktokenAccuracy
    };
  } finally {
    conn.close();
  }
}

if (require.main === module) {
  const customDbPath = process.argv[2] || null;
  try {
    const report = getSavingsReport(customDbPath);
    console.log(JSON.stringify(report));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

module.exports = {
  getSavingsReport,
  calculateAllModelTokens,
  queryStats,
  queryInputSavingsCost,
  sanitizeLegacyRecords
};
