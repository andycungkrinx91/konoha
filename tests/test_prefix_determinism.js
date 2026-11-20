#!/usr/bin/env node
'use strict';

/**
 * tests/test_prefix_determinism.js — Konoha prepends a contract block to every client
 * prompt, so those bytes sit at the head of every request the harness makes. Providers
 * cache a prompt prefix only while it is byte-identical, so a single timestamp, uuid,
 * pid, or reordered line in that head turns every later turn into a full-price read.
 *
 * The 9Router sample behind this gate: 780 requests on the `openai-compatible` connection
 * billed 49.5 M prompt tokens with `cachedTokens: 0`. The prefix head is the one part of
 * the payload Konoha controls, so it is the part this test pins.
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const {
  CONTRACT_START,
  CONTRACT_END,
  buildMainAgentContract,
  buildManagedContract,
  buildSubagentContract,
  buildContractManifest,
  validateContractText,
} = require(path.join(ROOT, 'src', 'agent_contract'));

const VOLATILE = [
  [/\b\d{4}-\d{2}-\d{2}\b/, 'an ISO date'],
  [/\b\d{1,2}:\d{2}(?::\d{2})?\b/, 'a clock time'],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/, 'a uuid'],
  [/\b(?:pid|PID)\s*[:=]\s*\d+/, 'a process id'],
  [/\b(?:nonce|request[_-]?id|session[_-]?id)\s*[:=]\s*\S+/i, 'a per-request id'],
  [/\b\d{13}\b/, 'an epoch-millisecond stamp'],
];

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const clients = buildContractManifest().contractClients;

function run() {
  console.log('Running test_prefix_determinism tests...');

  assert.ok(clients.length >= 8, `expected at least 8 client contracts, found ${clients.length}`);

  for (const client of clients) {
    const first = buildMainAgentContract(client);
    const second = buildMainAgentContract(client);

    assert.strictEqual(sha(first), sha(second), `${client} contract is not byte-identical across two builds`);
    assert.ok(first.startsWith(CONTRACT_START), `${client} contract must open with ${CONTRACT_START}`);
    assert.ok(first.trimEnd().endsWith(CONTRACT_END), `${client} contract must close with ${CONTRACT_END}`);

    for (const [pattern, label] of VOLATILE) {
      assert.ok(!pattern.test(first), `${client} contract head carries ${label}; that defeats prefix caching`);
    }

    // Marker-stripped rebuild must reproduce the same head, or a re-deploy reshuffles the
    // prefix on a machine that already had one.
    const rebuilt = buildManagedContract(`user rule\n${first}\n`, first);
    assert.strictEqual(sha(rebuilt), sha(`user rule\n\n${first}\n`), `${client} re-deploy does not reproduce the same contract block`);
    assert.strictEqual((rebuilt.match(new RegExp(CONTRACT_START, 'g')) || []).length, 1, `${client} re-deploy duplicated the managed block`);
  }
  console.log(`✓ ${clients.length} client contract(s) are byte-stable, marker-framed, and free of volatile tokens`);

  // Two different clients must not share a body: the label is part of the head, and a client
  // that reads another client's label loses its own spawn instruction.
  const bodies = new Map(clients.map((c) => [sha(buildMainAgentContract(c)), c]));
  assert.strictEqual(bodies.size, clients.length, 'two clients resolve to an identical contract body');
  console.log('✓ every client contract is distinct');

  // Subagent profiles are spawned repeatedly in one session; their head must be stable too.
  const subA = buildSubagentContract('genin');
  const subB = buildSubagentContract('genin', { client: 'claudecode' });
  assert.strictEqual(sha(subA), sha(subB), 'genin subagent contract is not byte-identical across two builds');
  for (const [pattern, label] of VOLATILE) {
    assert.ok(!pattern.test(subA), `genin subagent contract carries ${label}`);
  }
  console.log('✓ subagent contract head is byte-stable');

  // The managers run validateContractText before deploying; a contract that fails it is
  // silently skipped, which looks exactly like a client that never got a head at all.
  for (const client of clients) {
    const verdict = validateContractText(buildMainAgentContract(client));
    assert.strictEqual(verdict.ok, true, `${client} contract fails validateContractText: missing ${verdict.missing.join(', ')}`);
  }
  console.log('✓ every contract passes the deploy validator');

  console.log('\nAll test_prefix_determinism tests passed!');
}

if (require.main === module) {
  run();
}

module.exports = { run, VOLATILE };
