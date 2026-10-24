#!/usr/bin/env node
'use strict';

/**
 * scripts/verify_provider_cache.js
 *
 * Verifies 100% prefix determinism (SHA-256 hash match) across Turns 1, 2, and 3
 * and asserts all subagent prompts strictly adhere to the < 8,000 byte (< 8 KB) ceiling.
 */

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const server = require('../src/server');

const NINJA_AGENTS = ['sannin', 'genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
const TEST_CLIENTS = ['antigravity', 'claudecode', 'cursor', 'commandcode', 'opencode'];
const REPO_ROOT = path.resolve(__dirname, '..');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function verifyProviderCacheDeterminism() {
  console.log('--- Verifying Provider Prompt Cache Determinism & Token Ceilings ---\n');

  let totalChecks = 0;
  let passCount = 0;

  for (const client of TEST_CLIENTS) {
    server.ACTIVE_CLIENT = client;
    console.log(`[Client: ${client}]`);

    for (const agent of NINJA_AGENTS) {
      const sessionId = `cache-verify-${client}-${agent}-${Date.now()}`;
      process.env.SESSION_ID = sessionId;

      const taskSpec = {
        task: `Implement verification test for ${agent} caching`,
        project_path: REPO_ROOT
      };

      // Turn 1
      const res1 = JSON.parse(server.runMcpAgent(agent, taskSpec));
      const p1 = res1.instructions || '';
      const b1 = Buffer.byteLength(p1, 'utf8');
      const h1 = sha256(p1);

      // Turn 2
      const res2 = JSON.parse(server.runMcpAgent(agent, taskSpec));
      const p2 = res2.instructions || '';
      const b2 = Buffer.byteLength(p2, 'utf8');
      const h2 = sha256(p2);

      // Turn 3
      const res3 = JSON.parse(server.runMcpAgent(agent, taskSpec));
      const p3 = res3.instructions || '';
      const b3 = Buffer.byteLength(p3, 'utf8');
      const h3 = sha256(p3);

      totalChecks += 4;

      // 1. Ceiling check (< 8,000 bytes)
      assert.ok(b1 < 8000, `${client} ${agent} Turn 1 size (${b1}B) must be < 8000 bytes`);
      assert.ok(b2 < 8000, `${client} ${agent} Turn 2 size (${b2}B) must be < 8000 bytes`);
      assert.ok(b3 < 8000, `${client} ${agent} Turn 3 size (${b3}B) must be < 8000 bytes`);
      passCount++;

      // 2. Hash determinism check (T1 == T2)
      assert.strictEqual(h1, h2, `${client} ${agent} Turn 1 and Turn 2 hashes must match (T1: ${h1.slice(0, 8)}, T2: ${h2.slice(0, 8)})`);
      passCount++;

      // 3. Hash determinism check (T2 == T3)
      assert.strictEqual(h2, h3, `${client} ${agent} Turn 2 and Turn 3 hashes must match (T2: ${h2.slice(0, 8)}, T3: ${h3.slice(0, 8)})`);
      passCount++;

      // 4. Invariants check
      assert.ok(p1.includes('Token Preservation'), `${client} ${agent} must include Token Preservation badge`);
      passCount++;

      console.log(`  ✓ @${agent.padEnd(16)} | Size: ${b1}B (<8KB) | SHA-256: ${h1.slice(0, 12)}... | T1==T2==T3: match`);
    }
    console.log('');
  }

  console.log(`All ${passCount} / ${totalChecks} provider cache verification checks passed cleanly!`);
}

if (require.main === module) {
  try {
    verifyProviderCacheDeterminism();
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Verification failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { verifyProviderCacheDeterminism };
