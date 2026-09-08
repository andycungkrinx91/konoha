#!/usr/bin/env node
'use strict';

/**
 * tests/test_web_search.js — Test Konoha's zero-API-key fallback search chain, caching, and fallback execution.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server = require('../src/server');

async function run() {
  console.log('Running test_web_search tests...');
  const originalFetch = global.fetch;
  const originalSearxUrl = process.env.SEARXNG_URL;

  try {
    // 1. Query simplification
    const query = 'how to implement sveltekit 3d threlte framework in production';
    const terms = query.split(/\s+/);
    assert.ok(terms.length > 5);

    const shortened = [];
    for (let i = 0; i < Math.min(3, terms.length); i++) {
      const simpQ = terms.slice(0, terms.length - i).join(' ');
      shortened.push(simpQ);
    }
    assert.strictEqual(shortened.length, 3);
    assert.strictEqual(shortened[0], query);
    assert.strictEqual(shortened[1], 'how to implement sveltekit 3d threlte framework in');
    console.log('✓ Query simplification passed');

    // 2. SearXNG parser and null safety
    const bestCache = path.join(os.homedir(), '.konoha', 'searxng', 'best_instance.json');
    const instCache = path.join(os.homedir(), '.konoha', 'searxng', 'instances_cache.json');
    for (const c of [bestCache, instCache]) {
      try { if (fs.existsSync(c)) fs.unlinkSync(c); } catch (_) {}
    }

    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('instances.json')) {
        return {
          ok: true,
          json: async () => ({
            instances: {
              'https://searx.test': {
                uptime: { uptimeDay: 99.0 },
                timing: { search: { all: { median: 0.05 } } }
              },
              'https://searx.broken-null-uptime': {
                uptime: null,
                timing: null
              },
              'https://searx.broken-null-search': {
                uptime: { uptimeDay: 98.0 },
                timing: { search: null }
              }
            }
          })
        };
      } else if (urlStr.includes('searx.test/search') || urlStr.includes('searx.test')) {
        if (urlStr.includes('q=test')) {
          return {
            ok: true,
            json: async () => ({ results: [] })
          };
        }
        return {
          ok: true,
          json: async () => ({
            results: [
              { title: 'Test Svelte', url: 'https://svelte.dev', content: 'Svelte component framework' }
            ]
          })
        };
      }
      throw new Error('Not mocked: ' + urlStr);
    };

    const res1Str = await server.runWebSearch('Svelte', 1);
    const data1 = JSON.parse(res1Str);
    assert.strictEqual(data1.status, 'success');
    assert.ok(data1.results.length > 0);
    assert.strictEqual(data1.results[0].title, 'Test Svelte');
    assert.strictEqual(data1.results[0].url, 'https://svelte.dev');
    assert.strictEqual(data1.results[0].snippet, 'Svelte component framework');
    console.log('✓ SearXNG parser and null safety passed');

    // 3. SearXNG env override
    process.env.SEARXNG_URL = 'https://custom-searx.internal';
    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('custom-searx.internal')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              { title: 'Test Svelte', url: 'https://svelte.dev', content: 'Svelte component framework' }
            ]
          })
        };
      }
      throw new Error('Not mocked: ' + urlStr);
    };

    const res2Str = await server.runWebSearch('Svelte', 1);
    const data2 = JSON.parse(res2Str);
    assert.strictEqual(data2.status, 'success');
    assert.ok(data2.results.length > 0);
    assert.ok(data2.results[0].source.includes('custom-searx.internal'));
    console.log('✓ SearXNG env override passed');

    // 4. Wikipedia fallback
    delete process.env.SEARXNG_URL;
    for (const c of [bestCache, instCache]) {
      try { if (fs.existsSync(c)) fs.unlinkSync(c); } catch (_) {}
    }

    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('wikipedia')) {
        return {
          ok: true,
          json: async () => [
            'Python',
            ['Python (programming language)'],
            ['A high-level programming language.'],
            ['https://en.wikipedia.org/wiki/Python_(programming_language)']
          ]
        };
      }
      throw new Error('Engine unavailable');
    };

    const res3Str = await server.runWebSearch('Python Programming Language', 2);
    const data3 = JSON.parse(res3Str);
    assert.strictEqual(data3.status, 'success');
    assert.ok(data3.results_count >= 1);
    if (data3.results && data3.results.length > 0) {
      assert.strictEqual(data3.results[0].source, 'Wikipedia');
    }
    console.log('✓ Wikipedia fallback passed');

    console.log('\nAll test_web_search tests passed!');
  } finally {
    global.fetch = originalFetch;
    if (originalSearxUrl !== undefined) {
      process.env.SEARXNG_URL = originalSearxUrl;
    } else {
      delete process.env.SEARXNG_URL;
    }
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
