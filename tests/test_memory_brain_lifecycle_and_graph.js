#!/usr/bin/env node
'use strict';
require('./helpers/isolate_db');

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const personaMemory = require('../src/persona_memory');

function run() {
  console.log('Running test_memory_brain_lifecycle_and_graph...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-brain-life-'));
  const dbPath = path.join(tmpDir, 'brain_life.db');
  personaMemory.DB_PATH = dbPath;
  db.DB_PATH = dbPath;

  const projA = path.join(tmpDir, 'proj_a');
  const projB = path.join(tmpDir, 'proj_b');
  fs.mkdirSync(projA, { recursive: true });
  fs.mkdirSync(projB, { recursive: true });

  try {
    // Correction & supersession preserve audit trail and hide stale fact from current truth
    const oldMem = personaMemory.remember({
      agentName: 'anbu',
      title: 'Cache TTL',
      content: 'Use 300s Redis TTL for user session tokens.',
      projectPath: projA,
      sourceType: 'agent',
      sourceRef: 'src/cache.js:10',
      dbPath
    });
    const corrected = personaMemory.correctMemory({
      id: oldMem.id,
      newContent: 'Use 900s Redis TTL for user session tokens.',
      reason: 'Updated SLA requirement',
      actor: 'kage',
      evidenceRef: 'docs/SLA.md#L22',
      dbPath
    });
    assert.strictEqual(corrected.ok, true);
    assert.ok(corrected.new_id && corrected.new_id !== oldMem.id);

    const activeRecall = personaMemory.recall({
      agentName: 'anbu',
      query: 'Redis TTL user session',
      projectPath: projA,
      dbPath
    });
    assert.strictEqual(activeRecall.length, 1, 'Stale superseded fact must not appear as current truth');
    assert.strictEqual(activeRecall[0].id, corrected.new_id);
    assert.ok(activeRecall[0].content.includes('900s'));

    const allIncludingInactive = personaMemory.recall({
      agentName: 'anbu',
      query: 'Redis TTL',
      projectPath: projA,
      includeInactive: true,
      dbPath
    });
    assert.strictEqual(allIncludingInactive.length, 2, 'Historical query with includeInactive returns both');

    const history = personaMemory.getMemoryHistory(oldMem.id, { dbPath });
    assert.strictEqual(history.memory.lifecycle_status, 'superseded');
    assert.strictEqual(history.memory.superseded_by, corrected.new_id);
    assert.strictEqual(history.supersession_chain[0].id, corrected.new_id);
    assert.ok(history.audit_events.some((e) => e.action === 'superseded' && e.actor === 'kage'));
    console.log('  ✓ Correction, supersession, and audit history passed');

    // Withdrawal / invalidation + hard delete with reversible audit restore
    const withdrawnRes = personaMemory.withdrawMemory({
      id: corrected.new_id,
      status: 'invalidated',
      reason: 'Switched to stateless JWT',
      actor: 'kage',
      dbPath
    });
    assert.strictEqual(withdrawnRes.lifecycle_status, 'invalidated');
    assert.strictEqual(
      personaMemory.recall({ agentName: 'anbu', query: 'Redis TTL', projectPath: projA, dbPath }).length,
      0,
      'Invalidated memory must be excluded from active recall'
    );

    const ephemeralRule = personaMemory.remember({
      agentName: 'jonin',
      content: 'Temporary font fallback rule.',
      projectPath: projA,
      dbPath
    });
    assert.strictEqual(personaMemory.deleteMemory(ephemeralRule.id, dbPath), true);
    const delHist = personaMemory.getMemoryHistory(ephemeralRule.id, { dbPath });
    const delEvent = delHist.audit_events.find((e) => e.action === 'deleted');
    assert.ok(delEvent && delEvent.previous_state.content === 'Temporary font fallback rule.', 'Hard delete must preserve pre-delete snapshot in audit log');
    const restored = personaMemory.restoreMemoryFromAudit(delEvent.id, { dbPath });
    assert.strictEqual(restored.ok, true);
    assert.strictEqual(
      personaMemory.recall({ agentName: 'jonin', query: 'font fallback', projectPath: projA, dbPath }).length,
      1,
      'Restored memory must become active again'
    );
    console.log('  ✓ Withdrawal, invalidation, delete audit snapshot, and restore passed');

    // Deterministic knowledge graph, evidence requirement, inferred vs verified, and isolation
    const fact1 = personaMemory.remember({
      agentName: 'chunin',
      content: 'Primary database uses SQLite WAL mode.',
      projectPath: projA,
      sourceType: 'doc',
      sourceRef: 'docs/ARCHITECTURE.md',
      dbPath
    });
    const fact2 = personaMemory.remember({
      agentName: 'anbu',
      content: `Transactions acquire BEGIN IMMEDIATE. depends_on:${fact1.id}`,
      projectPath: projA,
      sourceType: 'doc',
      sourceRef: 'docs/ARCHITECTURE.md',
      dbPath
    });
    const factB = personaMemory.remember({
      agentName: 'anbu',
      content: 'Project B uses Postgres 16.',
      projectPath: projB,
      dbPath
    });

    assert.throws(() => personaMemory.linkMemories({
      sourceId: fact1.id,
      targetId: fact2.id,
      relationType: 'supports',
      verified: true,
      evidenceRef: '',
      dbPath
    }), /evidenceRef/);

    assert.throws(() => personaMemory.linkMemories({
      sourceId: fact1.id,
      targetId: factB.id,
      relationType: 'relates_to',
      evidenceRef: 'cross-project-attempt',
      dbPath
    }), /isolated project boundaries/);

    const unverifiedEdge = personaMemory.linkMemories({
      sourceId: fact2.id,
      targetId: fact1.id,
      relationType: 'supports',
      evidenceType: 'inferred',
      evidenceRef: 'heuristic note',
      verified: true,
      dbPath
    });
    assert.strictEqual(unverifiedEdge.verified, false, 'Inferred evidence must never be marked verified');

    const graphVerifiedOnly = personaMemory.traverseKnowledgeGraph({
      memoryId: fact2.id,
      depth: 2,
      includeUnverified: false,
      projectPath: projA,
      dbPath
    });
    assert.ok(graphVerifiedOnly.edges.some((e) => e.relation_type === 'depends_on' && e.verified === true));
    assert.ok(!graphVerifiedOnly.edges.some((e) => e.evidence_type === 'inferred'));

    const explained = personaMemory.explainRelation(unverifiedEdge.id, { dbPath });
    assert.ok(explained.explanation.includes('unverified'));
    console.log('  ✓ Deterministic evidence-backed knowledge graph & isolation passed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run();
