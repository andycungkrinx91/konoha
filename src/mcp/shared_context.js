'use strict';

/**
 * src/mcp/shared_context.js
 *
 * Cross-agent live task context. A specialist's `report_from_agent` finding is
 * persisted once (reusing `persona_memories`, no new table, no second index) and
 * then handed to sibling specialists at spawn time so they do not re-derive work
 * another agent already did.
 *
 * Scoping: `source_ref` carries the task id, `domain` separates these rows from
 * persona/project knowledge, and `memory_type='finding'` keeps them out of
 * knowledge queries that filter by type.
 */

const SC_DOMAIN = 'shared_task';
const SC_MEMORY_TYPE = 'finding';
const SC_MAX_ITEMS = 5;
const SC_SNIPPET_CHARS = 320;
const SC_MAX_BYTES = 700;
// A block smaller than this cannot carry the header plus one useful finding.
const SC_MIN_LINE_BYTES = 80;

function _normAgent(name) {
  return String(name || '').toLowerCase().trim().replace(/^mcp_/, '').replace(/_/g, '-');
}

/**
 * Root task identity shared by every agent in one workflow. Slices carry their
 * own `task_id`, so keying on the dispatch id would scope context to a single
 * slice and defeat reuse; the root id is what all siblings have in common.
 */
function resolveTaskId({ taskDir = '', workflowStatus = null, explicit = '' } = {}) {
  const explicitId = String(explicit || '').trim();
  if (explicitId) return explicitId;
  let status = workflowStatus;
  if (!status && taskDir) {
    try { status = require('./workflow_common').loadWorkflowStatus(taskDir); } catch (_) { status = null; }
  }
  const root = status && (status.task_id || status.root_task_id);
  if (root) return String(root);
  return taskDir ? require('path').basename(String(taskDir)) : '';
}

function _clip(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1))}…` : clean;
}

function _fileCount(filesCreated, filesModified) {
  return (Array.isArray(filesCreated) ? filesCreated.length : 0) + (Array.isArray(filesModified) ? filesModified.length : 0);
}

/**
 * Record (or replace) one agent's finding for a task. A re-report for the same
 * (task, agent) supersedes the previous row instead of appending, so the shared
 * block never accumulates stale duplicates.
 */
function recordFinding(options = {}) {
  const agent = _normAgent(options.agent || options.agentName);
  const taskId = String(options.taskId || '').trim();
  if (!agent || !taskId) return null;

  const personaMemory = require('../persona_memory_items');
  const status = String(options.status || 'completed').trim();
  const summary = _clip(options.summary, SC_SNIPPET_CHARS);
  if (!summary) return null;
  const learnings = Array.isArray(options.learnings) ? options.learnings.filter(Boolean) : [];
  const files = _fileCount(options.filesCreated, options.filesModified);
  const content = _clip(`${agent} · ${status} · ${summary}${files > 0 ? ` · files=${files}` : ''}${learnings.length > 0 ? ` · learnings=${_clip(learnings.join('; '), 120)}` : ''}`, SC_SNIPPET_CHARS);

  const scope = { agentName: agent, taskId, projectPath: options.projectPath, sessionId: options.sessionId };
  for (const prior of _recallFindings(scope, 20)) {
    if (prior.agent_name !== agent) continue;
    if (prior.content === content) return prior.id;
    try { personaMemory.deleteMemory(prior.id); } catch (_) { /* best effort */ }
  }

  return personaMemory.saveMemory({
    agentName: agent,
    content,
    title: `shared:${taskId}:${agent}`,
    memoryType: SC_MEMORY_TYPE,
    domain: SC_DOMAIN,
    sourceType: 'agent',
    sourceRef: taskId,
    creatorAgent: agent,
    projectPath: options.projectPath,
    sessionId: options.sessionId,
    confidence: options.verified === false ? 0.6 : 1.0,
    verificationStatus: options.verified === false ? 'unverified' : 'confirmed',
    importance: 2,
    metadata: {
      task_id: taskId,
      status,
      files,
      learnings: learnings.slice(0, 3).map((l) => _clip(l, 160))
    }
  });
}

function _recallFindings({ agentName, taskId, projectPath, sessionId } = {}, limit = SC_MAX_ITEMS) {
  try {
    const personaMemory = require('../persona_memory_items');
    const rows = personaMemory.queryMemories({
      agentName: agentName || 'all',
      memoryType: SC_MEMORY_TYPE,
      domain: SC_DOMAIN,
      sourceRef: taskId,
      projectPath,
      sessionId,
      allSessions: true,
      limit
    });
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

/** Sibling findings for this task, caller excluded, newest first. */
function readSharedContext(options = {}) {
  const excludeAgent = _normAgent(options.excludeAgent);
  const limit = Math.min(Math.max(parseInt(options.limit ?? SC_MAX_ITEMS, 10) || SC_MAX_ITEMS, 1), 20);
  return _recallFindings(options, limit + 1)
    .filter((row) => row && row.agent_name !== excludeAgent)
    .slice(0, limit)
    .map((row) => {
      let meta = {};
      try { meta = JSON.parse(row.metadata_json || '{}') || {}; } catch (_) { meta = {}; }
      return {
        agent: _normAgent(row.agent_name),
        status: String(meta.status || 'reported'),
        summary: _clip(String(row.content || '').replace(/^[^·]*·\s*[^·]*·\s*/, ''), 200),
        files: Number(meta.files || 0),
        unverified: row.verification_status === 'unverified'
      };
    });
}

/** Prompt block for sibling findings, or '' when the task has none yet. */
function formatSharedContextBlock(rows, maxBytes = SC_MAX_BYTES) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const cap = Number(maxBytes) > 0 ? Math.min(Number(maxBytes), SC_MAX_BYTES) : 0;
  const header = '### Shared Task Context (do not re-derive)';
  const headerBytes = Buffer.byteLength(header, 'utf8') + 1;
  if (cap < headerBytes + SC_MIN_LINE_BYTES) return '';
  const lines = [];
  let bytes = headerBytes;
  for (const row of rows) {
    const line = `- @${row.agent} (${row.status}${row.unverified ? ', unverified' : ''}): ${row.summary}${row.files > 0 ? ` · files=${row.files}` : ''}`;
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    if (bytes + lineBytes > cap) break;
    lines.push(line);
    bytes += lineBytes;
  }
  if (lines.length === 0) return '';
  return `${header}\n${lines.join('\n')}`;
}

module.exports = {
  SC_DOMAIN,
  SC_MEMORY_TYPE,
  SC_MAX_ITEMS,
  SC_MAX_BYTES,
  SC_MIN_LINE_BYTES,
  resolveTaskId,
  recordFinding,
  readSharedContext,
  formatSharedContextBlock
};
