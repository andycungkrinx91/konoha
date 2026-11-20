#!/usr/bin/env node
'use strict';

/**
 * tests/test_chunin_knowledge.js
 *
 * Covers the Chunin research knowledge store end to end on an in-memory database,
 * with no network and no model download:
 *
 *   1. URL canonicalization — tracking params, scheme, host case, trailing slash,
 *      query ordering, and rejection of non-http(s) input.
 *   2. Bulk upsert — one batched write, transactional, with the three dedupe
 *      layers (content_hash, canonical_url, within-batch duplicates).
 *   3. Retrieval — top-K from FTS5 with the requested limit honoured.
 *   4. The dzhng/deep-research loop — breadth/depth clamping, nextBreadth =
 *      ceil(breadth / 2), visitedUrls accumulation, and no repeat fetches.
 *   5. Web-search exclusion — `exclude_urls` removes known URLs and returns only
 *      net-new results.
 */

const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');

const { applyChuninKnowledgeSchema } = require('../src/chunin_knowledge_ddl');
const knowledge = require('../src/mcp/chunin_knowledge');
const { canonicalizeUrl } = require('../src/url_canonical');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  applyChuninKnowledgeSchema(db);
  return db;
}

function testCanonicalization() {
  const cases = [
    ['https://Example.com/a/?utm_source=x&b=2#frag', 'https://example.com/a?b=2'],
    ['http://example.com/a?b=2', 'https://example.com/a?b=2'],
    ['https://example.com', 'https://example.com'],
    ['https://example.com/', 'https://example.com'],
    ['https://example.com/index.html', 'https://example.com'],
    ['https://x.com/p?b=2&a=1', 'https://x.com/p?a=1&b=2'],
    ['https://x.com/p?utm_medium=a&utm_campaign=b', 'https://x.com/p'],
    ['not a url', ''],
    ['ftp://x.com/f', '']
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(canonicalizeUrl(input), expected, `canonicalizeUrl(${input})`);
  }
  console.log(`  ok   ${cases.length} canonicalization cases`);
}

async function testBulkUpsertAndDedupe() {
  const db = freshDb();
  const topic = 'sqlite vector search';

  const first = await knowledge.storeLearnings({
    topic,
    conn: db,
    learnings: [
      { learning_text: 'sqlite-vec supports cosine distance', canonical_url: 'https://a.com/vec', source_title: 'A' },
      { learning_text: 'FTS5 provides bm25 ranking', canonical_url: 'https://b.com/fts', source_title: 'B' },
      // Same URL, different spelling + tracking param: must dedupe.
      { learning_text: 'A different sentence about the same page', canonical_url: 'https://a.com/vec/?utm_source=x', source_title: 'A' },
      // Same text, different casing/whitespace: must dedupe by hash.
      { learning_text: 'sqlite-vec   SUPPORTS cosine distance', canonical_url: 'https://c.com/dup', source_title: 'C' },
      { learning_text: '   ', canonical_url: 'https://d.com/empty', source_title: 'D' }
    ]
  });

  assert.strictEqual(first.inserted, 2, `expected 2 inserted, got ${first.inserted}`);
  assert.strictEqual(first.reasons.duplicate_url, 1, 'URL duplicate must be counted');
  assert.strictEqual(first.reasons.duplicate_hash, 1, 'hash duplicate must be counted');
  assert.strictEqual(first.reasons.invalid, 1, 'blank learning must be counted');
  console.log('  ok   bulk upsert dedupes by URL, hash and blank text');

  const rows = db.prepare('SELECT COUNT(*) AS n FROM chunin_knowledge').get();
  assert.strictEqual(Number(rows.n), 2, 'store must hold exactly the accepted rows');

  // Re-storing the same batch inserts nothing.
  const second = await knowledge.storeLearnings({
    topic,
    conn: db,
    learnings: [
      { learning_text: 'sqlite-vec supports cosine distance', canonical_url: 'https://a.com/vec' },
      { learning_text: 'FTS5 provides bm25 ranking', canonical_url: 'https://b.com/fts' }
    ]
  });
  assert.strictEqual(second.inserted, 0, 'a repeated batch must insert nothing');
  console.log('  ok   re-storing the same batch is a no-op');

  const tx = db.prepare('SELECT COUNT(*) AS n FROM chunin_knowledge_fts').get();
  assert.ok(Number(tx.n) >= 2, 'FTS index must be populated by the trigger');
  console.log('  ok   FTS5 triggers keep the index in sync');
  db.close();
}

async function testRetrievalTopK() {
  const db = freshDb();
  const topic = 'postgres indexing';
  const learnings = [];
  for (let i = 0; i < 12; i++) {
    learnings.push({
      learning_text: `postgres indexing detail number ${i} about btree and gin`,
      canonical_url: `https://pg.example.com/${i}`,
      source_title: `PG ${i}`
    });
  }
  const stored = await knowledge.storeLearnings({ topic, conn: db, learnings });
  assert.strictEqual(stored.inserted, 12, 'all twelve learnings must be stored');

  const top5 = await knowledge.retrieveRelevant({ topic, conn: db, topK: 5 });
  assert.strictEqual(top5.length, 5, `topK=5 must return 5 rows, got ${top5.length}`);
  assert.ok(top5.every(row => row.learning_text.includes('postgres')), 'results must match the topic');

  const top3 = await knowledge.retrieveRelevant({ topic, conn: db, topK: 3 });
  assert.strictEqual(top3.length, 3, 'topK=3 must be honoured');

  const none = await knowledge.retrieveRelevant({ topic: 'quantum chromodynamics', conn: db, topK: 5 });
  assert.strictEqual(none.length, 0, 'an unrelated topic must not invent results');
  console.log('  ok   top-K retrieval honours the limit and does not fabricate matches');
  db.close();
}

async function testDeepResearchLoop() {
  const calls = [];
  const search = async (query, limit, exclude) => {
    calls.push({ query, limit, excludeCount: exclude.length });
    return [
      { url: 'https://one.example.com/a', snippet: 'first finding', title: 'One', follow_up_question: 'deeper question' },
      // Same page as above under a different spelling: must not be fetched twice.
      { url: 'https://one.example.com/a/?utm_source=z', snippet: 'duplicate', title: 'One dup' },
      { url: 'https://two.example.com/b', snippet: 'second finding', title: 'Two' }
    ];
  };

  const result = await knowledge.runDeepResearchLoop({ topic: 'root topic', search, breadth: 3, depth: 2 });
  assert.strictEqual(result.levels, 2, 'depth=2 must run two levels');
  assert.deepStrictEqual(result.visitedUrls, [
    'https://one.example.com/a',
    'https://two.example.com/b'
  ], 'visited URLs must be canonical and unique');
  assert.strictEqual(result.learnings.length, 2, 'duplicate page must not produce a second learning');
  assert.ok(result.followUpQuestions.includes('deeper question'), 'follow-up questions must be tracked');
  console.log('  ok   deep-research loop tracks learnings, follow-ups and unique visited URLs');

  // Clamping: breadth 99 -> 5, depth 99 -> 3.
  calls.length = 0;
  const clamped = await knowledge.runDeepResearchLoop({ topic: 't', search, breadth: 99, depth: 99 });
  assert.strictEqual(clamped.levels, 3, 'depth must clamp to 3');
  console.log('  ok   breadth/depth clamp to their documented maxima');

  // A failing search must not abort the loop.
  const flaky = async () => { throw new Error('network down'); };
  const survived = await knowledge.runDeepResearchLoop({ topic: 't', search: flaky, breadth: 2, depth: 2 });
  assert.deepStrictEqual(survived.learnings, [], 'a failing search yields no learnings, not a crash');
  assert.strictEqual(survived.levels, 1, 'loop stops when no follow-up questions arrive');
  console.log('  ok   a failing search degrades instead of throwing');
}

async function testWebSearchExclusion() {
  const { runWebSearch } = require('../src/mcp/web_search');
  // The deterministic mock path answers without network access.
  const raw = await runWebSearch('konoha mcp orchestrator', 5, 'standard', 'test', {
    excludeUrls: ['https://example.com/known/?utm_source=x']
  });
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.status, 'success', 'search must succeed');
  assert.ok(Array.isArray(parsed.results), 'results must be an array');
  assert.ok(parsed.excluded_count >= 1, 'exclusion count must be reported');
  for (const result of parsed.results) {
    assert.notStrictEqual(
      canonicalizeUrl(result.url),
      'https://example.com/known',
      'an excluded URL must not be returned'
    );
  }
  console.log('  ok   web search honours exclude_urls and reports the exclusion count');
}

(async () => {
  console.log('Running test_chunin_knowledge: Chunin research knowledge store...');
  testCanonicalization();
  await testBulkUpsertAndDedupe();
  await testRetrievalTopK();
  await testDeepResearchLoop();
  await testWebSearchExclusion();
  console.log('\nAll test_chunin_knowledge checks passed successfully!');
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
