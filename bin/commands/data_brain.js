'use strict';

/**
 * bin/commands/data_brain.js — CLI handlers for provenance-aware Knowledge Brain
 * operations (correct, withdraw, history, graph, maintain, revert).
 */

const fs = require('fs');
const { DB_PATH } = require('../lib/paths');
const { C, log, info, warn, error, success, header } = require('../lib/format');

function _requireDb() {
  if (!fs.existsSync(DB_PATH)) {
    error('SQLite database not found.');
    process.exit(1);
  }
  return require('../../src/persona_memory');
}

async function cmdDataCorrect(args = []) {
  const id = args[0];
  let newContent = '';
  let reason = '';
  let evidenceRef = '';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--reason' && args[i + 1]) reason = args[++i];
    else if (args[i] === '--evidence' && args[i + 1]) evidenceRef = args[++i];
    else newContent += (newContent ? ' ' : '') + args[i];
  }
  if (!id || !newContent) {
    error('Usage: konoha data correct <id> <newContent> [--reason <txt>] [--evidence <ref>]');
    process.exit(1);
  }
  const pm = _requireDb();
  const res = pm.correctMemory({ id, newContent, reason, evidenceRef, actor: 'cli', dbPath: DB_PATH });
  success(`Corrected memory ${id} -> ${res.new_id}`);
  log(`  ${C.dim}Relation: ${res.relation_id}${C.reset}`);
}

async function cmdDataWithdraw(args = []) {
  const id = args[0];
  let reason = '';
  let status = 'withdrawn';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--reason' && args[i + 1]) reason = args[++i];
    else if (args[i] === '--status' && args[i + 1]) status = args[++i];
  }
  if (!id) {
    error('Usage: konoha data withdraw <id> [--status withdrawn|invalidated] [--reason <txt>]');
    process.exit(1);
  }
  const pm = _requireDb();
  const res = pm.withdrawMemory({ id, status, reason, actor: 'cli', dbPath: DB_PATH });
  if (!res.found) {
    warn(`Memory ID '${id}' not found.`);
    return;
  }
  success(`Marked memory ${id} as '${res.lifecycle_status}'.`);
}

async function cmdDataHistory(args = []) {
  const id = args[0];
  if (!id) {
    error('Usage: konoha data history <id>');
    process.exit(1);
  }
  const pm = _requireDb();
  const hist = pm.getMemoryHistory(id, { dbPath: DB_PATH });
  header(`Memory History: ${id}`);
  if (hist.memory) {
    log(`  Status: ${hist.memory.lifecycle_status} | Verification: ${hist.memory.verification_status} | Confidence: ${hist.memory.confidence}`);
  }
  for (const ev of hist.audit_events) {
    log(`  - [${ev.created_at}] ${C.cyan}${ev.action}${C.reset} by ${ev.actor} (${ev.id}): ${ev.reason}`);
  }
}

async function cmdDataGraph(args = []) {
  const id = args[0];
  if (!id) {
    error('Usage: konoha data graph <id> [--depth <n>]');
    process.exit(1);
  }
  let depth = 2;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--depth' && args[i + 1]) depth = parseInt(args[++i], 10) || 2;
  }
  const pm = _requireDb();
  const graph = pm.traverseKnowledgeGraph({ memoryId: id, depth, includeUnverified: true, dbPath: DB_PATH });
  header(`Knowledge Graph for ${id}`);
  log(`  Nodes: ${graph.nodes.length} | Edges: ${graph.edges.length}`);
  for (const e of graph.edges) {
    const tag = e.verified ? 'verified' : 'unverified';
    log(`  ${e.source_memory_id} --[${e.relation_type} (${tag})]--> ${e.target_memory_id} [${e.evidence_ref || 'none'}]`);
  }
}

async function cmdDataMaintain(args = []) {
  const apply = args.includes('--apply');
  const pm = _requireDb();
  const res = pm.runMemoryMaintenance({ dryRun: !apply, actor: 'cli_maintenance', dbPath: DB_PATH });
  header(`Memory Maintenance (${res.dry_run ? 'DRY RUN' : 'APPLIED'})`);
  info(`Run ID: ${res.run_id} | Proposed: ${res.proposed.length} | Applied: ${res.applied}`);
}

async function cmdDataRevert(args = []) {
  const runOrEventId = args[0];
  if (!runOrEventId) {
    error('Usage: konoha data revert <runId|auditEventId>');
    process.exit(1);
  }
  const pm = _requireDb();
  const res = runOrEventId.startsWith('aud_')
    ? pm.restoreMemoryFromAudit(runOrEventId, { actor: 'cli_revert', dbPath: DB_PATH })
    : pm.revertMaintenanceRun({ runId: runOrEventId, actor: 'cli_revert', dbPath: DB_PATH });
  success(`Reverted cleanly: ${JSON.stringify(res)}`);
}

module.exports = {
  cmdDataCorrect,
  cmdDataWithdraw,
  cmdDataHistory,
  cmdDataGraph,
  cmdDataMaintain,
  cmdDataRevert
};
