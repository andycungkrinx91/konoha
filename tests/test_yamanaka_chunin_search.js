#!/usr/bin/env node
'use strict';

/**
 * Chunin reference-search stage of the Yamanaka 3D workflow.
 *
 * Asserts the stage grounds a text job in real citations without ever becoming load-bearing:
 * a search outage must leave generation on exactly the path it would have taken without it.
 */

const assert = require('assert');
const {
  nodeChuninSearch,
  buildReferenceQueries,
  normalizeSources,
  formatReferenceContext,
  MAX_RESULTS,
  MAX_SNIPPET_CHARS
} = require('../src/workflow/yamanaka/chunin_stage');

function stage() { return require('../src/workflow/yamanaka/chunin_stage'); }

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}: ${err.message}`);
  }
}

function installSearchMock(runner) {
  const searchPath = require.resolve('../src/mcp/web_search');
  const stagePath = require.resolve('../src/workflow/yamanaka/chunin_stage');
  const prevSearch = require.cache[searchPath];
  const prevStage = require.cache[stagePath];
  require.cache[searchPath] = { id: searchPath, filename: searchPath, loaded: true, exports: { runWebSearch: runner } };
  delete require.cache[stagePath];
  return () => {
    if (prevSearch) require.cache[searchPath] = prevSearch;
    else delete require.cache[searchPath];
    if (prevStage) require.cache[stagePath] = prevStage;
    else delete require.cache[stagePath];
  };
}

function withSearchResults(results) {
  const payload = JSON.stringify({ status: 'success', query: 'q', results_count: results.length, results });
  return installSearchMock(async () => payload);
}

function withSearchFailure(mode) {
  const runner = mode === 'throw'
    ? async () => { throw new Error('provider unreachable'); }
    : async () => JSON.stringify({ status: 'error', message: 'no backend' });
  return installSearchMock(runner);
}

async function run() {
  console.log('Chunin reference search');

  await test('builds a bounded query set from the prompt', () => {
    const queries = buildReferenceQueries({ prompt: 'rice cooker' });
    assert.ok(queries.length >= 1 && queries.length <= 2, `expected 1-2 queries, got ${queries.length}`);
    assert.ok(queries[0].includes('rice cooker'));
    assert.deepStrictEqual(buildReferenceQueries({ prompt: '' }), []);
  });

  await test('normalizes, dedupes and caps sources', () => {
    const raw = Array.from({ length: MAX_RESULTS + 5 }, (_, i) => ({
      title: `T${i}`, url: `https://example.com/${i}`, snippet: 'x'.repeat(500), source: 'web'
    }));
    raw.push({ title: 'DUP', url: 'https://example.com/0', snippet: 'dup', source: 'web' });
    const out = normalizeSources(raw);
    assert.strictEqual(out.length, MAX_RESULTS);
    assert.ok(out.every((s) => s.snippet.length <= MAX_SNIPPET_CHARS));
    assert.strictEqual(new Set(out.map((s) => s.url)).size, out.length);
  });

  await test('skips entries without a url', () => {
    const out = normalizeSources([{ title: 'no url' }, { url: 'https://ok.example', title: 'ok' }]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].url, 'https://ok.example');
  });

  await test('refine jobs never search (they inherit the parent brief)', async () => {
    const res = await stage().nodeChuninSearch({ refineMode: true, prompt: 'anything' });
    assert.deepStrictEqual(res, {});
  });

  await test('status is skipped_no_prompt when there is nothing to search', async () => {
    const res = await stage().nodeChuninSearch({ prompt: '' });
    assert.strictEqual(res.referenceSearchStatus, 'skipped_no_prompt');
    assert.deepStrictEqual(res.referenceSources, []);
  });

  await test('collects sources and persists them on the job', async () => {
    const restore = withSearchResults([
      { title: 'Rice cooker spec', url: 'https://a.example/rice', snippet: 'lid, vent', source: 'web' }
    ]);
    const calls = [];
    const dbSchemaPath = require.resolve('../src/mcp/three_asset/db_3d_schema');
    const previousSchema = require.cache[dbSchemaPath];
    require.cache[dbSchemaPath] = {
      id: dbSchemaPath,
      filename: dbSchemaPath,
      loaded: true,
      exports: { updateJobStage: (_conn, _jobId, patch) => calls.push(patch) }
    };
    try {
      const res = await stage().nodeChuninSearch({ jobId: 'job-1', prompt: 'rice cooker' });
      assert.strictEqual(res.referenceSearchStatus, 'ok');
      assert.strictEqual(res.referenceSources.length, 1);
      assert.strictEqual(res.referenceSources[0].url, 'https://a.example/rice');
      assert.ok(calls.length >= 1, 'expected the sources to be persisted');
      const persisted = JSON.parse(calls[0].reference_sources_json);
      assert.strictEqual(persisted[0].url, 'https://a.example/rice');
    } finally {
      restore();
      if (previousSchema) require.cache[dbSchemaPath] = previousSchema;
      else delete require.cache[dbSchemaPath];
    }
  });

  await test('a throwing provider is non-fatal and yields no_results', async () => {
    const restore = withSearchFailure('throw');
    try {
      const res = await stage().nodeChuninSearch({ jobId: 'job-2', prompt: 'rice cooker' });
      assert.strictEqual(res.referenceSearchStatus, 'no_results');
      assert.deepStrictEqual(res.referenceSources, []);
    } finally {
      restore();
    }
  });

  await test('an error status from the provider is non-fatal and yields no_results', async () => {
    const restore = withSearchFailure('error-status');
    try {
      const res = await stage().nodeChuninSearch({ jobId: 'job-3', prompt: 'rice cooker' });
      assert.strictEqual(res.referenceSearchStatus, 'no_results');
    } finally {
      restore();
    }
  });

  await test('formatReferenceContext is empty with no sources and bounded with many', () => {
    assert.strictEqual(formatReferenceContext([]), '');
    assert.strictEqual(formatReferenceContext(null), '');
    const many = Array.from({ length: MAX_RESULTS }, (_, i) => ({
      title: `T${i}`, url: `https://example.com/${i}`, snippet: 's'.repeat(MAX_SNIPPET_CHARS)
    }));
    const text = formatReferenceContext(many);
    assert.ok(text.includes('https://example.com/0'));
    assert.ok(/evidence for proportions/.test(text), 'context must frame sources as evidence, not instructions');
  });

  await test('brief prompt caps reference context so the budget cannot be blown', () => {
    const specBrief = require('../src/mcp/three_asset/spec_brief');
    const huge = 'A'.repeat(50000);
    const src = require('fs').readFileSync(require.resolve('../src/mcp/three_asset/spec_brief'), 'utf8');
    assert.ok(src.includes('MAX_REFERENCE_CONTEXT_BYTES'), 'a hard byte cap must exist');
    assert.ok(/truncated/.test(src), 'truncation must be marked in the prompt');
    assert.ok(typeof specBrief.generateObjectBrief === 'function');
    assert.ok(huge.length > 1200);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
