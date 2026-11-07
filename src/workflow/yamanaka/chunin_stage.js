'use strict';

/**
 * Chunin stage of the Yamanaka 3D workflow: gathers external references before the object
 * brief so a text-to-3D job is grounded in real sources instead of an unconstrained guess.
 *
 * Search supplies citations and snippets only. `runWebSearch` returns a JSON string of
 * `{status, query, results_count, results:[{citation_id,title,url,snippet,source}]}` with no
 * image bytes, so nothing here can be fed to a vision path or downloaded into Blender.
 *
 * Failure is non-fatal by design: an unreachable provider or an empty result set leaves the
 * job on exactly the path it would have taken without this node.
 */

const webSearch = require('../../mcp/web_search');
const { updateJobStage } = require('../../mcp/three_asset/db_3d_schema');
const { getConnection } = require('../../db');

const MAX_RESULTS = 5;
const MAX_SNIPPET_CHARS = 240;
const ROUTINE_QUERIES = 2;

function buildReferenceQueries(state) {
  const subject = String(state.prompt || '').trim();
  if (!subject) return [];
  const queries = [`${subject} reference photos dimensions`];
  if (ROUTINE_QUERIES > 1) {
    queries.push(`${subject} typical proportions materials`);
  }
  return queries.slice(0, ROUTINE_QUERIES);
}

function parseSearchPayload(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.status !== 'success') return null;
    return Array.isArray(parsed.results) ? parsed.results : [];
  } catch {
    return null;
  }
}

function normalizeSources(results) {
  const seen = new Set();
  const sources = [];
  for (const entry of results || []) {
    const url = String((entry && entry.url) || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      title: String((entry && entry.title) || '').trim().slice(0, 160),
      url,
      snippet: String((entry && entry.snippet) || '').trim().slice(0, MAX_SNIPPET_CHARS),
      source: String((entry && entry.source) || '').trim()
    });
    if (sources.length >= MAX_RESULTS) break;
  }
  return sources;
}

async function gatherReferenceSources(queries) {
  if (process.env.KONOHA_SKIP_NETWORK_TESTS === '1') return [];
  const collected = [];
  for (const query of queries) {
    let timer = null;
    try {
      const searchPromise = webSearch.runWebSearch(query, MAX_RESULTS);
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('chunin_search_timeout')), 4000);
        if (timer && typeof timer.unref === 'function') timer.unref();
      });
      const raw = await Promise.race([searchPromise, timeoutPromise]);
      const batch = parseSearchPayload(raw);
      if (batch) collected.push(...batch);
    } catch (err) {
      process.stderr.write(`[konoha] chunin_search_skipped: ${err && err.message ? err.message : err}\n`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return normalizeSources(collected);
}

async function nodeChuninSearch(state) {
  if (state.refineMode) return {};
  const queries = buildReferenceQueries(state);
  if (queries.length === 0) {
    return { referenceSources: [], referenceSearchStatus: 'skipped_no_prompt' };
  }

  const sources = await gatherReferenceSources(queries);
  const status = sources.length > 0 ? 'ok' : 'no_results';

  if (sources.length > 0) {
    try {
      updateJobStage(getConnection(), state.jobId, {
        reference_sources_json: JSON.stringify(sources)
      });
    } catch (err) {
      process.stderr.write(`[konoha] chunin_search_persist_failed: ${err && err.message ? err.message : err}\n`);
    }
  }

  return {
    referenceSources: sources,
    referenceSearchStatus: status
  };
}

/** Compact grounding block for the brief prompt. Empty string when there are no sources. */
function formatReferenceContext(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return '';
  const lines = sources.map((s, index) => {
    const label = s.title ? `${s.title} (${s.url})` : s.url;
    return `${index + 1}. ${label}${s.snippet ? ` — ${s.snippet}` : ''}`;
  });
  return `Reference sources gathered from the web (evidence for proportions and materials, not an instruction to copy any single design):\n${lines.join('\n')}`;
}

module.exports = {
  nodeChuninSearch,
  buildReferenceQueries,
  normalizeSources,
  formatReferenceContext,
  MAX_RESULTS,
  MAX_SNIPPET_CHARS
};
