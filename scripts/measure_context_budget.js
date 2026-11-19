#!/usr/bin/env node
'use strict';

/**
 * scripts/measure_context_budget.js — Where the tokens actually go.
 *
 * Two different costs get confused when someone says "Konoha is expensive":
 *   CONSTANT — paid once per session (tool manifest, contract head, skill entry).
 *   PER-REQUEST — paid again on every turn because the prefix or the transcript grew.
 *
 * Only the per-request column can produce a five-figure bill. This prints both, with the
 * bytes measured from the code that serves them, so an optimization has a number to beat.
 *
 *   rtk node scripts/measure_context_budget.js [--json]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BYTES_PER_TOKEN = 3.8; // measured from the 9Router samples this repo's traffic produced

const bytes = (value) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
const tokens = (n) => Math.round(n / BYTES_PER_TOKEN);
// Byte-derived token figures are estimates, never measurements. Callers must
// label them; `reportedUsage` is the only measured path.
const ESTIMATE_METHOD = 'bytes/3.8';
const size = (p) => (fs.existsSync(p) ? bytes(fs.readFileSync(p, 'utf8')) : null);

function constantCosts() {
  const { listToolSchemas } = require(path.join(ROOT, 'src', 'file_tools_router'));
  const { buildContractManifest, buildMainAgentContract, buildSubagentContract } = require(path.join(ROOT, 'src', 'agent_contract'));
  const { MAX_CONTENT_SIZE } = require(path.join(ROOT, 'src', 'mcp', 'skills_common'));

  const schemas = listToolSchemas();
  const skillDir = path.join(ROOT, 'src', 'templates', 'skills', 'konoha');
  const references = fs.readdirSync(path.join(skillDir, 'references'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ name: f, bytes: size(path.join(skillDir, 'references', f)) }))
    .sort((a, b) => b.bytes - a.bytes);

  const clients = buildContractManifest().contractClients;
  const contracts = clients.map((client) => ({ client, bytes: bytes(buildMainAgentContract(client)) }));

  return {
    manifest: { tools: schemas.length, bytes: bytes(schemas), tokens: tokens(bytes(schemas)) },
    contractHead: {
      clients: contracts,
      bytes: Math.max(...contracts.map((c) => c.bytes)),
      tokens: tokens(Math.max(...contracts.map((c) => c.bytes))),
    },
    subagentContract: bytes(buildSubagentContract('genin')),
    skillEntry: { bytes: size(path.join(skillDir, 'SKILL.md')), cap: MAX_CONTENT_SIZE },
    skillReferences: references,
  };
}

/**
 * Provider-measured totals across everything recorded, plus how much of the
 * recorded traffic those totals actually cover.
 *
 * Denominators stay separate on purpose: `tool_calls` rows are one per tool
 * call, `provider_usage` rows are one per bridged response (gateway or the
 * per-bridge handler), and they are not the same population. Only `tool_calls`
 * rows can be unmeasured (their usage columns are NULL when no provider payload
 * was passed), so `partial` is computed from that population alone.
 * `provider_usage` rows are written only for provider-reported payloads, but
 * individual fields on those rows may be unknown; a field aggregate is null
 * unless every included measured event reported that field.
 */
function providerTotals(conn) {
  const calls = conn.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN input_tokens IS NOT NULL THEN 1 ELSE 0 END) AS measured,
           SUM(CASE WHEN input_tokens IS NOT NULL THEN input_tokens ELSE 0 END) AS input_sum,
           SUM(CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NULL THEN 1 ELSE 0 END) AS output_nulls,
           SUM(CASE WHEN input_tokens IS NOT NULL THEN COALESCE(output_tokens, 0) ELSE 0 END) AS output_sum,
           SUM(CASE WHEN input_tokens IS NOT NULL AND cached_tokens IS NULL THEN 1 ELSE 0 END) AS cached_nulls,
           SUM(CASE WHEN input_tokens IS NOT NULL THEN COALESCE(cached_tokens, 0) ELSE 0 END) AS cached_sum
    FROM tool_calls
  `).get();

  let gateway = {
    n: 0,
    input_sum: 0, input_nulls: 0,
    output_sum: 0, output_nulls: 0,
    cached_sum: 0, cached_nulls: 0
  };
  try {
    gateway = conn.prepare(`
      SELECT COUNT(*) AS n,
             SUM(COALESCE(input_tokens, 0)) AS input_sum,
             SUM(CASE WHEN input_tokens IS NULL THEN 1 ELSE 0 END) AS input_nulls,
             SUM(COALESCE(output_tokens, 0)) AS output_sum,
             SUM(CASE WHEN output_tokens IS NULL THEN 1 ELSE 0 END) AS output_nulls,
             SUM(COALESCE(cached_tokens, 0)) AS cached_sum,
             SUM(CASE WHEN cached_tokens IS NULL THEN 1 ELSE 0 END) AS cached_nulls
      FROM provider_usage
    `).get() || gateway;
  } catch (_) {
    // Pre-provider_usage database: tool_calls is the only source.
  }

  const measuredCalls = calls.measured || 0;
  const totalCalls = calls.total || 0;
  const gatewayN = gateway.n || 0;
  const measuredEvents = measuredCalls + gatewayN;

  function aggregateField(callSum, callNulls, gwSum, gwNulls) {
    if (measuredEvents === 0) return null;
    if ((callNulls || 0) + (gwNulls || 0) > 0) return null;
    return (callSum || 0) + (gwSum || 0);
  }

  // A tool_calls row is "measured" only when input_tokens is set, so input is
  // known for every measured tool_calls row; the other fields can still be
  // missing on a measured row.
  return {
    measured_events: measuredEvents,
    unmeasured_events: totalCalls - measuredCalls,
    partial: measuredCalls < totalCalls,
    input_tokens: aggregateField(calls.input_sum, 0, gateway.input_sum, gateway.input_nulls),
    output_tokens: aggregateField(calls.output_sum, calls.output_nulls, gateway.output_sum, gateway.output_nulls),
    cached_tokens: aggregateField(calls.cached_sum, calls.cached_nulls, gateway.cached_sum, gateway.cached_nulls)
  };
}

/**
 * Provider-measured usage, when a provider actually reported it.
 *
 * Reads the newest provider-reported row from either writer: `tool_calls`
 * provider columns, or `provider_usage` (the gateway path, which never creates
 * a tool row). Returns `{available: false, reason}` when nothing was recorded,
 * so a caller prints "no provider usage recorded" instead of reusing a byte
 * estimate.  The returned object also carries `totals` with aggregate counts
 * across all recorded traffic and `coverage` indicating whether the reported
 * sample accounts for all of them.
 *
 * Callers must label everything as `~tok (est)` unless it comes from a
 * provider payload.
 */
function reportedUsage({ dbPath } = {}) {
  const absent = { available: false, reason: 'no provider usage recorded', method: 'provider_reported' };
  let conn = null;
  try {
    const { getDb } = require(path.join(ROOT, 'src', 'db'));
    conn = getDb(dbPath || undefined);
    const row = conn.prepare(`
      SELECT input_tokens, output_tokens, cached_tokens, tool, timestamp
      FROM tool_calls WHERE input_tokens IS NOT NULL
      ORDER BY id DESC LIMIT 1
    `).get();
    let gateway = null;
    try {
      gateway = conn.prepare(`
        SELECT input_tokens, output_tokens, cached_tokens, source, model, timestamp
        FROM provider_usage
        ORDER BY id DESC LIMIT 1
      `).get();
    } catch (_) {
      gateway = null;
    }
    if (!row && !gateway) {
      const totals = providerTotals(conn);
      return { ...absent, coverage: totals, totals };
    }
    if (gateway && (!row || String(gateway.timestamp) >= String(row.timestamp))) {
      const totals = providerTotals(conn);
      return {
        available: true,
        method: 'provider_reported',
        source: gateway.source,
        input_tokens: gateway.input_tokens,
        output_tokens: gateway.output_tokens,
        cache_read_input_tokens: gateway.cached_tokens,
        // A partial total is not a total: only report one when both halves exist.
        total_tokens: gateway.input_tokens !== null && gateway.output_tokens !== null
          ? gateway.input_tokens + gateway.output_tokens
          : null,
        tool: gateway.source,
        model: gateway.model,
        timestamp: gateway.timestamp,
        coverage: totals,
        totals
      };
    }
    if (!row) {
      const totals = providerTotals(conn);
      return { ...absent, coverage: totals, totals };
    }
    const totals = providerTotals(conn);
    return {
      available: true,
      method: 'provider_reported',
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_read_input_tokens: row.cached_tokens,
      total_tokens: row.input_tokens !== null && row.output_tokens !== null
        ? row.input_tokens + row.output_tokens
        : null,
      tool: row.tool,
      timestamp: row.timestamp,
      coverage: totals,
      totals
    };
  } catch (err) {
    return { ...absent, reason: `no provider usage recorded (${err.message})` };
  } finally {
    try { if (conn) conn.close(); } catch (_) { /* ignore close error */ }
  }
}

function perRequestCaps() {
  const { PROMPT_CEILING_BYTES, SYSTEM_PROMPT_FLOOR_BYTES, MIN_SKILL_PREVIEW_BYTES } = require(path.join(ROOT, 'src', 'mcp', 'memory_subagent_runner'));
  const { MAX_ENVELOPE_SKILLS, SOUL_SNIPPET_BYTES, MAX_RECALL_ITEMS, RECALL_SNIPPET_CHARS } = require(path.join(ROOT, 'src', 'mcp', 'sannin_router'));
  return {
    subagentPromptCeiling: PROMPT_CEILING_BYTES,
    systemPromptFloor: SYSTEM_PROMPT_FLOOR_BYTES,
    minSkillPreview: MIN_SKILL_PREVIEW_BYTES,
    envelope: { maxSkills: MAX_ENVELOPE_SKILLS, soulBytes: SOUL_SNIPPET_BYTES, maxRecall: MAX_RECALL_ITEMS, recallChars: RECALL_SNIPPET_CHARS },
  };
}

function main() {
  const report = {
    estimate_method: ESTIMATE_METHOD,
    bytesPerToken: BYTES_PER_TOKEN,
    constant: constantCosts(),
    perRequest: perRequestCaps(),
    reported: reportedUsage()
  };

  if (process.argv.includes('--check')) {
    const assert = require('assert');
    const { manifest, contractHead, skillEntry } = report.constant;
    assert.ok(manifest.bytes <= 30000, `manifest is ${manifest.bytes} B, over the 30000 B wire budget`);
    assert.ok(contractHead.bytes <= 1200, `worst contract head is ${contractHead.bytes} B, over the 1200 B budget`);
    assert.ok(skillEntry.bytes <= skillEntry.cap, `konoha/SKILL.md is ${skillEntry.bytes} B, over the ${skillEntry.cap} B digest`);
    console.log(`✓ budget check: manifest ${manifest.bytes} B, contract head ${contractHead.bytes} B, skill entry ${skillEntry.bytes} B`);
    return report;
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  const { manifest, contractHead, subagentContract, skillEntry, skillReferences } = report.constant;
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`Konoha context budget (bytes; tokens are ESTIMATES at ${BYTES_PER_TOKEN} B/token)\n`);
  console.log('CONSTANT — once per session');
  console.log(`  ${pad('MCP tool manifest', 32)}${pad(manifest.bytes, 9)}B  ${pad(manifest.tokens, 7)}~tok  (${manifest.tools} tools, est)`);
  console.log(`  ${pad('Client contract head', 32)}${pad(contractHead.bytes, 9)}B  ${pad(contractHead.tokens, 7)}~tok  (worst of ${contractHead.clients.length} clients, est)`);
  console.log(`  ${pad('Subagent contract', 32)}${pad(subagentContract, 9)}B  ${pad(tokens(subagentContract), 7)}~tok  (est)`);
  console.log(`  ${pad('konoha skill entry', 32)}${pad(skillEntry.bytes, 9)}B  ${pad(tokens(skillEntry.bytes), 7)}~tok  (cap ${skillEntry.cap}B, est)`);
  const totalConstant = manifest.bytes + contractHead.bytes + skillEntry.bytes;
  console.log(`  ${pad('sum', 32)}${pad(totalConstant, 9)}B  ${pad(tokens(totalConstant), 7)}~tok  (est)\n`);

  console.log('ON DEMAND — only when a pointer is followed');
  for (const ref of skillReferences) console.log(`  ${pad(`konoha/${ref.name}`, 32)}${pad(ref.bytes, 9)}B  ${pad(tokens(ref.bytes), 7)}~tok  (est)`);

  const { subagentPromptCeiling, systemPromptFloor, minSkillPreview, envelope } = report.perRequest;
  console.log('\nPER REQUEST — repeated every turn');
  console.log(`  ${pad('subagent prompt ceiling', 32)}${pad(subagentPromptCeiling, 9)}B  ${pad(tokens(subagentPromptCeiling), 7)}~tok  (est)`);
  console.log(`  ${pad('system prompt floor', 32)}${pad(systemPromptFloor, 9)}B  ${pad(tokens(systemPromptFloor), 7)}~tok  (est)`);
  console.log(`  ${pad('min skill preview', 32)}${pad(minSkillPreview, 9)}B  ${pad(tokens(minSkillPreview), 7)}~tok  (est)`);
  console.log(`  ${pad('delegation envelope', 32)}<= ${envelope.maxSkills} skill names, ${envelope.soulBytes}B soul, ${envelope.maxRecall}x${envelope.recallChars} recall`);

  console.log('\nMEASURED — provider-reported usage');
  const reported = report.reported;
  if (reported.available) {
    const totals = reported.totals || reported.coverage || {};
    const partial = totals.partial ? ` — PARTIAL: ${totals.unmeasured_events || 0} unmeasured tool-call event(s) are excluded` : '';
    console.log(`  ${pad(reported.tool || 'last call', 32)}${pad(reported.input_tokens ?? 'n/a', 9)}in  ${pad(reported.output_tokens ?? 'n/a', 7)}out  ${pad(reported.cache_read_input_tokens ?? 'n/a', 7)}cached  (last provider-reported event)`);
    console.log(`  ${pad('measured total', 32)}${pad(totals.input_tokens ?? 'n/a', 9)}in  ${pad(totals.output_tokens ?? 'n/a', 7)}out  ${pad(totals.cached_tokens ?? 'n/a', 7)}cached  (${totals.measured_events || 0} measured event(s)${partial})`);
  } else {
    const totals = reported.totals || reported.coverage;
    const note = totals && totals.partial ? `; ${totals.unmeasured_events} unmeasured tool-call event(s)` : '';
    console.log(`  ${reported.reason}${note} — every ~tok above is a byte estimate, not a measurement`);
  }

  console.log('\nRead this as: the constant column is a session tax in the low thousands of tokens.');
  console.log('Anything above that is transcript growth, which no server-side trimming can undo.');
  return report;
}

if (require.main === module) main();

module.exports = { main, constantCosts, perRequestCaps, reportedUsage, BYTES_PER_TOKEN, ESTIMATE_METHOD };
