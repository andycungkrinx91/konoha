#!/usr/bin/env node
'use strict';
require('./helpers/isolate_db');

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const db = require('../src/db');
const personaMemory = require('../src/persona_memory');
const { startWebServer } = require('../src/web_server');

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch (_) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('Running test_memory_brain_retrieval_and_maintenance...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-brain-ret-'));
  const dbPath = path.join(tmpDir, 'brain_ret.db');
  personaMemory.DB_PATH = dbPath;
  db.DB_PATH = dbPath;
  const projPath = path.join(tmpDir, 'proj_bench');
  fs.mkdirSync(projPath, { recursive: true });

  const prevSemantic = process.env.KONOHA_SEMANTIC_SEARCH;
  let srv = null;

  try {
    // Improved FTS5 phrase/AND/verified prioritization + benchmark
    const exactConfirmed = personaMemory.remember({
      agentName: 'anbu',
      title: 'Playwright Output Cap',
      content: 'qa_e2e_run enforces strict output capping below 2000 characters for token hygiene.',
      projectPath: projPath,
      sourceType: 'doc',
      sourceRef: 'docs/QA-AUTOMATION.md',
      verificationStatus: 'confirmed',
      importance: 4,
      dbPath
    });
    const partialInferred = personaMemory.remember({
      agentName: 'anbu',
      title: 'Token Note',
      content: 'Maybe strict cap applies to logs or output formatting somewhere.',
      projectPath: projPath,
      sourceType: 'inferred',
      confidence: 0.4,
      dbPath
    });

    const ranked = personaMemory.recall({
      agentName: 'anbu',
      query: 'strict output capping',
      projectPath: projPath,
      limit: 5,
      dbPath
    });
    assert.strictEqual(ranked[0].id, exactConfirmed.id, 'Confirmed phrase/AND hit must outrank inferred partial hit');
    assert.strictEqual(ranked[0].is_verified, true);
    assert.strictEqual(ranked[1].is_verified, false);

    const verifiedOnly = personaMemory.recall({
      agentName: 'anbu',
      query: 'strict output',
      projectPath: projPath,
      confirmedOnly: true,
      dbPath
    });
    assert.strictEqual(verifiedOnly.length, 1);
    assert.strictEqual(verifiedOnly[0].id, exactConfirmed.id);

    const bench = personaMemory.benchmarkRetrieval([
      { query: 'strict output capping', expectedId: exactConfirmed.id, projectPath: projPath, agentName: 'anbu', k: 3 }
    ], { dbPath });
    assert.strictEqual(bench.recall_at_k, 1);
    assert.strictEqual(bench.mrr, 1);
    assert.strictEqual(bench.stale_leaks, 0);
    console.log(`  ✓ Retrieval quality benchmark passed (MRR=${bench.mrr}, latency=${bench.avg_latency_ms}ms)`);

    // recallAsync preserves lexical results when KONOHA_SEMANTIC_SEARCH=0 without reporting degraded
    process.env.KONOHA_SEMANTIC_SEARCH = '0';
    const disabledAsync = await personaMemory.recallAsync({
      agentName: 'anbu',
      query: 'strict output capping',
      projectPath: projPath,
      dbPath
    });
    assert.strictEqual(disabledAsync.semantic_status, 'disabled');
    assert.strictEqual(disabledAsync.degraded, false);
    assert.strictEqual(disabledAsync.memories[0].id, exactConfirmed.id);
    console.log('  ✓ recallAsync semantic_status=disabled lexical fallback passed');

    // recallAsync reports degraded (not disabled) when enabled offline without cached models
    const prevOffline = process.env.HF_HUB_OFFLINE;
    const prevHfHome = process.env.HF_HOME;
    const prevHubCache = process.env.HF_HUB_CACHE;
    const emptyHfHome = path.join(tmpDir, 'empty_hf_home');
    fs.mkdirSync(emptyHfHome, { recursive: true });
    process.env.KONOHA_SEMANTIC_SEARCH = '1';
    process.env.HF_HUB_OFFLINE = '1';
    process.env.HF_HOME = emptyHfHome;
    delete process.env.HF_HUB_CACHE;
    try {
      const degradedAsync = await personaMemory.recallAsync({
        agentName: 'anbu',
        query: 'strict output capping',
        projectPath: projPath,
        dbPath
      });
      assert.strictEqual(degradedAsync.semantic_status, 'degraded');
      assert.strictEqual(degradedAsync.degraded, true);
      assert.strictEqual(degradedAsync.memories[0].id, exactConfirmed.id);
      console.log('  ✓ recallAsync semantic_status=degraded offline fallback passed');
    } finally {
      process.env.KONOHA_SEMANTIC_SEARCH = '0';
      if (prevOffline === undefined) delete process.env.HF_HUB_OFFLINE;
      else process.env.HF_HUB_OFFLINE = prevOffline;
      if (prevHfHome === undefined) delete process.env.HF_HOME;
      else process.env.HF_HOME = prevHfHome;
      if (prevHubCache === undefined) delete process.env.HF_HUB_CACHE;
      else process.env.HF_HUB_CACHE = prevHubCache;
    }

    // Conservative background maintenance: never alters confirmed facts, dryRun -> apply -> revert
    const unverifiedNeg = personaMemory.remember({
      agentName: 'anbu',
      content: 'Never cache playwright headless artifacts inside repo root.',
      projectPath: projPath,
      sourceType: 'inferred',
      dbPath
    });
    const unverifiedPos = personaMemory.remember({
      agentName: 'anbu',
      content: 'Always cache playwright headless artifacts inside repo root.',
      projectPath: projPath,
      sourceType: 'inferred',
      dbPath
    });
    const conn = db.getConnection(dbPath, false);
    conn.prepare("UPDATE persona_memories SET updated_at = '2025-01-01T00:00:00Z', last_verified_at = '2025-01-01T00:00:00Z' WHERE id IN (?, ?)")
      .run(unverifiedNeg.id, exactConfirmed.id);
    conn.close();

    const dryRes = personaMemory.runMemoryMaintenance({ projectPath: projPath, dryRun: true, staleDays: 30, dbPath });
    assert.strictEqual(dryRes.dry_run, true);
    assert.ok(dryRes.proposed.some((p) => p.action === 'detect_contradictions'));
    assert.ok(dryRes.proposed.some((p) => p.action === 'flag_stale' && p.memory_id === unverifiedNeg.id));
    assert.ok(!dryRes.proposed.some((p) => p.action === 'flag_stale' && p.memory_id === exactConfirmed.id), 'Confirmed fact must not be marked stale by age alone');

    const applyRes = personaMemory.runMemoryMaintenance({ projectPath: projPath, dryRun: false, staleDays: 30, dbPath });
    assert.strictEqual(applyRes.dry_run, false);
    assert.ok(applyRes.applied >= 1);

    const contradictGraph = personaMemory.traverseKnowledgeGraph({
      memoryId: unverifiedNeg.id,
      relationTypes: ['contradicts'],
      includeUnverified: true,
      projectPath: projPath,
      dbPath
    });
    assert.ok(contradictGraph.edges.some((e) => e.relation_type === 'contradicts' && e.verified === false));

    const revRes = personaMemory.revertMaintenanceRun({ runId: applyRes.run_id, dbPath });
    assert.strictEqual(revRes.ok, true);
    assert.ok(revRes.reverted_count >= 1);
    console.log('  ✓ Conservative traceable & reversible maintenance passed');

    // Web API routes & CLI konoha data smoke
    srv = await startWebServer({ port: 14211, host: '127.0.0.1' });
    const headers = { 'Content-Type': 'application/json', 'X-Konoha-Web-Token': srv.token };
    const correctHttp = await httpRequest({
      hostname: '127.0.0.1', port: 14211,
      path: `/api/v1/persona/${unverifiedPos.id}/correct`,
      method: 'POST', headers
    }, { newContent: 'Never commit playwright artifacts to git.', reason: 'CI policy', actor: 'anbu' });
    assert.strictEqual(correctHttp.status, 200);
    assert.strictEqual(correctHttp.data.ok, true);

    const histHttp = await httpRequest({
      hostname: '127.0.0.1', port: 14211,
      path: `/api/v1/persona/${unverifiedPos.id}/history`,
      method: 'GET', headers
    });
    assert.strictEqual(histHttp.status, 200);
    assert.strictEqual(histHttp.data.memory.lifecycle_status, 'superseded');

    const cliOut = execFileSync(process.execPath, [
      path.resolve(__dirname, '..', 'bin', 'cli.js'),
      'data', 'history', correctHttp.data.new_id
    ], { env: { ...process.env, KONOHA_DB_PATH: dbPath }, encoding: 'utf8' });
    assert.ok(cliOut.includes('corrected') || cliOut.includes('Status:'));
    console.log('  ✓ Web API routes and CLI data subcommands passed');
  } finally {
    if (prevSemantic === undefined) delete process.env.KONOHA_SEMANTIC_SEARCH;
    else process.env.KONOHA_SEMANTIC_SEARCH = prevSemantic;
    if (srv && srv.server) {
      await new Promise((r) => srv.server.close(r));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
