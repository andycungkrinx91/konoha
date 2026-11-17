'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getConfigValue } = require('./config_access');
const { slicePreservingHeadMiddleTail } = require('./context_budget');

const { redactSecrets: _bridgeRedactSecrets } = require('./bridge/utils');

function _redactSecrets(str) {
  return _bridgeRedactSecrets(typeof str === 'string' ? str : String(str || ''));
}

const DEFAULT_AGENT_INPUT_TOKEN_QUOTA = 100000;
const QUOTA_MIN = 1000;
const QUOTA_MAX = 2000000;
const MAX_AGENT_TOKEN_ENTRIES = 2048;
const UNSAFE_AGENT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const AGENT_INPUT_TOKENS = new Map();

function _sanitizeAgentKey(agent) {
  const cleaned = String(agent || 'sannin').replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase();
  if (!cleaned || UNSAFE_AGENT_KEYS.has(cleaned)) return 'sannin';
  return cleaned;
}

function _setBoundedTokenCount(tokenMap, key, value) {
  if (!tokenMap || !key) return;
  if (tokenMap.has(key)) tokenMap.delete(key);
  while (tokenMap.size >= MAX_AGENT_TOKEN_ENTRIES) {
    const oldestKey = tokenMap.keys().next().value;
    if (oldestKey === undefined) break;
    tokenMap.delete(oldestKey);
  }
  tokenMap.set(key, value);
}

function resetAgentInputTokens(agentTokenKey = null) {
  if (!agentTokenKey) {
    AGENT_INPUT_TOKENS.clear();
    return;
  }
  AGENT_INPUT_TOKENS.delete(agentTokenKey);
}

function _clampQuota(value, minVal = QUOTA_MIN) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < minVal) return null;
  return Math.min(QUOTA_MAX, Math.max(minVal, Math.floor(num)));
}

/**
 * Resolve the active per-agent input token quota from explicit override,
 * `KONOHA_AGENT_INPUT_TOKEN_QUOTA`, project SDLC config, or global config.
 */
function resolveDynamicInputQuota({ explicitQuota, sdlcConfig } = {}) {
  const fromExplicit = _clampQuota(explicitQuota, QUOTA_MIN);
  if (fromExplicit !== null) return fromExplicit;
  const fromEnv = _clampQuota(process.env.KONOHA_AGENT_INPUT_TOKEN_QUOTA);
  if (fromEnv !== null) return fromEnv;
  const fromSdlc = _clampQuota(sdlcConfig && sdlcConfig.agent_input_token_quota);
  if (fromSdlc !== null) return fromSdlc;
  const fromCfg = _clampQuota(getConfigValue('agent_input_token_quota', DEFAULT_AGENT_INPUT_TOKEN_QUOTA));
  return fromCfg !== null ? fromCfg : DEFAULT_AGENT_INPUT_TOKEN_QUOTA;
}

function resolveCompactionThreadRef({ taskId, taskDir, sessionId, agent } = {}) {
  const cleanAgent = _sanitizeAgentKey(agent);
  let threadId;
  if (taskId) {
    threadId = String(taskId).slice(0, 128);
  } else if (taskDir) {
    const absDir = path.resolve(taskDir);
    const scopeHash = crypto.createHash('sha256').update(absDir).digest('hex').slice(0, 8);
    threadId = `${path.basename(absDir)}-${scopeHash}`.slice(0, 128);
  } else if (sessionId) {
    threadId = `sess-${String(sessionId)}`.slice(0, 128);
  } else {
    threadId = `anon-${crypto.randomBytes(8).toString('hex')}`;
  }
  return {
    clean_agent: cleanAgent,
    thread_id: threadId,
    checkpoint_ns: `agent:${cleanAgent}`
  };
}

function _summarizeTodoProgress(todos) {
  if (!Array.isArray(todos) || todos.length === 0) return '0/0 completed';
  const done = todos.filter((t) => t && t.status === 'completed').length;
  const active = todos.filter((t) => t && t.status === 'in_progress').map((t) => t.id || t.content).slice(0, 2);
  return active.length > 0 ? `${done}/${todos.length} completed (active: ${active.join(', ')})` : `${done}/${todos.length} completed`;
}

function _compactField(value, maxChars) {
  const text = typeof value === 'string' ? value.trim() : (value ? JSON.stringify(value) : '');
  if (!text) return '';
  return text.length > maxChars ? slicePreservingHeadMiddleTail(text, maxChars, { markerLabel: 'quota-compact' }) : text;
}

/**
 * Persist a per-agent compaction snapshot directly in LangGraph SQLite checkpoint state
 * (`lg_checkpoints`, namespace `agent:<name>`) and attach it to `status.agent_snapshots`.
 */
function captureLangGraphCompactionState({
  taskDir = '',
  projectPath = '',
  sessionId = '',
  agent = 'sannin',
  task = '',
  taskId = '',
  todos = null,
  work = '',
  progress = '',
  latestCondition = '',
  quotaTokens = DEFAULT_AGENT_INPUT_TOKEN_QUOTA,
  observedInputTokens = 0,
  trigger = 'input_token_quota',
  status = null,
  dbPath = null
} = {}) {
  const effectiveTodos = Array.isArray(todos) ? todos : (Array.isArray(status && status.tasks) ? status.tasks : []);
  const ref = resolveCompactionThreadRef({ taskId: taskId || (status && status.task_id), taskDir, sessionId, agent });
  const cleanAgent = ref.clean_agent;
  const record = {
    ts: new Date().toISOString(),
    trigger: trigger || 'input_token_quota',
    agent: cleanAgent,
    task_id: ref.thread_id,
    project_path: _redactSecrets(projectPath || (status && status.project_path) || ''),
    task: _redactSecrets(_compactField(task || (status && status.prompt) || '', 400)),
    todo: effectiveTodos.map((t) => ({
      id: t.id,
      status: t.status,
      agent: t.agent,
      content: _redactSecrets(_compactField(t.content || t.task || '', 120))
    })),
    work: _redactSecrets(_compactField(work || (status && status.plan) || '', 500)),
    progress: _redactSecrets(progress || _summarizeTodoProgress(effectiveTodos)),
    latest_condition: _redactSecrets(_compactField(latestCondition || '', 900)),
    quota_tokens: Number.isFinite(Number(quotaTokens)) ? Number(quotaTokens) : DEFAULT_AGENT_INPUT_TOKEN_QUOTA,
    observed_input_tokens: Number.isFinite(Number(observedInputTokens)) ? Number(observedInputTokens) : 0
  };
  if (status && typeof status === 'object') {
    status.agent_snapshots = { ...status.agent_snapshots, [cleanAgent]: record };
  }
  let conn = null;
  try {
    const db = require('./db');
    const { KonohaCheckpointSaver } = require('./mcp/langgraph/checkpointer');
    conn = db.getDb(dbPath);
    const saver = new KonohaCheckpointSaver(conn);
    const saved = saver.putCheckpointSync({
      threadId: ref.thread_id,
      checkpointNs: ref.checkpoint_ns,
      channelValues: record,
      metadata: {
        source: 'compaction',
        trigger: record.trigger,
        agent: cleanAgent,
        quota_tokens: record.quota_tokens,
        observed_input_tokens: record.observed_input_tokens
      }
    });
    return {
      ok: true,
      backend: 'langgraph_state',
      thread_id: saved.thread_id,
      checkpoint_ns: saved.checkpoint_ns,
      checkpoint_id: saved.checkpoint_id,
      record
    };
  } catch (err) {
    return {
      ok: false,
      backend: 'langgraph_state',
      thread_id: ref.thread_id,
      checkpoint_ns: ref.checkpoint_ns,
      checkpoint_id: null,
      error: err.message,
      record
    };
  } finally {
    _closeQuietly(conn);
  }
}

function _closeQuietly(conn) {
  if (!conn) return;
  try { conn.close(); } catch (_) { /* best-effort close */ }
}

function getLatestLangGraphCompactionState({ taskId = '', taskDir = '', sessionId = '', agent = 'sannin', dbPath = null } = {}) {
  const ref = resolveCompactionThreadRef({ taskId, taskDir, sessionId, agent });
  let conn = null;
  let row = null;
  try {
    const db = require('./db');
    const { KonohaCheckpointSaver } = require('./mcp/langgraph/checkpointer');
    conn = db.getDb(dbPath);
    row = new KonohaCheckpointSaver(conn).getLatestCheckpointSync({ threadId: ref.thread_id, checkpointNs: ref.checkpoint_ns });
  } catch (_) {
    return null;
  } finally {
    _closeQuietly(conn);
  }
  if (!row) return null;
  return { ...row, state: row.checkpoint?.channel_values || null };
}

/**
 * Compact active context using Head+Middle+Tail slicing, write a LangGraph checkpoint,
 * update `status.compaction` + `status.agent_snapshots`, and build the auto-continue checkpoint block.
 */
function compactAndBuildLatestCondition({
  taskDir = '',
  projectPath = '',
  sessionId = '',
  agent = 'sannin',
  task = '',
  taskId = '',
  todos = null,
  work = '',
  progress = '',
  contextText = '',
  quotaTokens = null,
  observedInputTokens = 0,
  trigger = 'input_token_quota',
  status = null,
  saveStatusFn = null
} = {}) {
  const effectiveQuota = resolveDynamicInputQuota({ explicitQuota: quotaTokens });
  const observed = Number.isFinite(Number(observedInputTokens)) ? Math.floor(Number(observedInputTokens)) : 0;
  const effectiveTodos = Array.isArray(todos) ? todos : (Array.isArray(status && status.tasks) ? status.tasks : []);
  const effProgress = _redactSecrets(progress || _summarizeTodoProgress(effectiveTodos));
  const combinedWork = [work, contextText].filter(Boolean).join('\n');
  const compactedWork = _compactField(combinedWork || (status && status.plan) || '', 650);
  const todoBrief = effectiveTodos.slice(0, 6).map((t) => `${t.id}[${t.status}]`).join(', ');
  const rawCondition = [
    `Agent=@${agent || 'sannin'}`,
    `Progress=${effProgress}`,
    todoBrief ? `Todos=${todoBrief}` : '',
    compactedWork ? `Context=${compactedWork}` : ''
  ].filter(Boolean).join(' | ');
  const latestCondition = _redactSecrets(slicePreservingHeadMiddleTail(rawCondition, 900, { markerLabel: 'latest-condition' }));

  const capture = captureLangGraphCompactionState({
    taskDir, projectPath, sessionId, agent, task, taskId,
    todos: effectiveTodos, work: compactedWork, progress: effProgress,
    latestCondition, quotaTokens: effectiveQuota, observedInputTokens: observed,
    trigger, status
  });

  const safeAgent = _sanitizeAgentKey(agent);
  const compactionMeta = {
    compacted: true,
    compacted_at: new Date().toISOString(),
    backend: 'langgraph_state',
    checkpoint_persisted: capture.ok === true,
    trigger: trigger || 'input_token_quota',
    auto_continue: true,
    quota_tokens: effectiveQuota,
    observed_input_tokens: observed,
    thread_id: capture.thread_id,
    checkpoint_ns: capture.checkpoint_ns,
    checkpoint_id: capture.checkpoint_id || null,
    latest_condition: latestCondition,
    preserved_anchors: ['head', 'middle', 'tail']
  };
  if (status && typeof status === 'object') {
    status.compaction = compactionMeta;
    if (typeof saveStatusFn === 'function' && taskDir) {
      try { saveStatusFn(taskDir, status); } catch (_) { /* best-effort save */ }
    }
  }
  const checkpointBlock = [
    '## LATEST CONDITION CHECKPOINT (Auto-Continue)',
    `- Agent: @${safeAgent} | Quota: ${observed}/${effectiveQuota} tokens | Progress: ${effProgress}`,
    `- LangGraph State: thread=${capture.thread_id} ns=${capture.checkpoint_ns}${capture.checkpoint_id ? ` ckpt=${capture.checkpoint_id}` : ''}`,
    `- Latest Condition: ${latestCondition}`,
    '- Auto-Continue: Context compacted with Head+Middle+Tail preservation. Resume execution immediately from this LangGraph checkpoint.'
  ].filter(Boolean).join('\n');

  return {
    compacted: true,
    backend: 'langgraph_state',
    checkpoint_persisted: capture.ok === true,
    auto_continue: true,
    quota_tokens: effectiveQuota,
    observed_input_tokens: observed,
    thread_id: capture.thread_id,
    checkpoint_ns: capture.checkpoint_ns,
    checkpoint_id: capture.checkpoint_id || null,
    latest_condition: latestCondition,
    checkpoint_block: checkpointBlock,
    agent_snapshots: status && status.agent_snapshots ? status.agent_snapshots : { [safeAgent]: capture.record },
    compaction: compactionMeta
  };
}

function evaluateAgentQuotaTurn({
  tokenMap,
  agentTokenKey,
  observedInputTokens,
  explicitQuota,
  sdlcConfig,
  taskDir,
  projectPath,
  sessionId,
  agent,
  task,
  taskId,
  todos,
  work,
  contextText,
  status,
  saveStatusFn
}) {
  const quotaTokens = resolveDynamicInputQuota({ explicitQuota, sdlcConfig });
  const prev = tokenMap ? (tokenMap.get(agentTokenKey) || 0) : 0;
  const accumulated = prev + Math.max(0, Number(observedInputTokens) || 0);
  if (accumulated < quotaTokens) {
    _setBoundedTokenCount(tokenMap, agentTokenKey, accumulated);
    return { triggered: false, quota_tokens: quotaTokens, observed_input_tokens: accumulated, auto_continue: false };
  }
  const compacted = compactAndBuildLatestCondition({
    taskDir, projectPath, sessionId, agent, task, taskId, todos, work, contextText,
    quotaTokens, observedInputTokens: accumulated, trigger: 'input_token_quota', status, saveStatusFn
  });
  const postCompactionTokens = Math.max(1, Math.ceil(Buffer.byteLength(compacted.checkpoint_block || '', 'utf8') / 3.5));
  _setBoundedTokenCount(tokenMap, agentTokenKey, postCompactionTokens);
  return {
    triggered: true,
    backend: 'langgraph_state',
    checkpoint_persisted: compacted.checkpoint_persisted === true,
    thread_id: compacted.thread_id,
    checkpoint_ns: compacted.checkpoint_ns,
    checkpoint_id: compacted.checkpoint_id,
    quota_tokens: quotaTokens,
    observed_input_tokens: accumulated,
    post_compaction_tokens: postCompactionTokens,
    auto_continue: true,
    latest_condition: compacted.latest_condition,
    checkpoint_block: compacted.checkpoint_block
  };
}

function prepareAgentTurnEnvelope({
  opts = {},
  dbAgentName = 'sannin',
  spawnClient = 'universal',
  resolvedProjPath = '',
  resolvedSessionId = 'default',
  sdlcConfig = null,
  effTaskDir = '',
  instructions = '',
  extraBytes = 0,
  todoHelpers,
  workflowHelpers
}) {
  const hasExplicitTaskDir = Boolean(opts.taskDir && effTaskDir);
  const statusFile = hasExplicitTaskDir ? path.join(effTaskDir, 'status.json') : '';
  const hasStatusFile = Boolean(statusFile && fs.existsSync(statusFile));
  const wfStatus = hasStatusFile
    ? workflowHelpers.loadWorkflowStatus(effTaskDir)
    : { prompt: opts.task || '', client: spawnClient, assigned_agent: dbAgentName, phase: 'execute' };
  if (wfStatus && !wfStatus.prompt && opts.task) wfStatus.prompt = opts.task;
  if (wfStatus && !wfStatus.client) wfStatus.client = spawnClient;
  todoHelpers.markAgentTodoInProgress(wfStatus, dbAgentName);
  const todoSync = todoHelpers.syncTodoAndWalkthrough(wfStatus, {
    client: spawnClient,
    taskDir: hasExplicitTaskDir ? effTaskDir : '',
    taskId: opts.taskId,
    syncDb: Boolean(opts.taskId)
  });
  if (hasStatusFile) {
    try { workflowHelpers.saveWorkflowStatus(effTaskDir, wfStatus); } catch (_) { /* best-effort save */ }
  }

  const rawObserved = Number.isFinite(Number(opts.observedInputTokens)) && Number(opts.observedInputTokens) > 0
    ? Number(opts.observedInputTokens)
    : Math.max(1, Math.ceil((Buffer.byteLength(instructions || '', 'utf8') + extraBytes) / 3.5));
  const quotaCheck = evaluateAgentQuotaTurn({
    tokenMap: AGENT_INPUT_TOKENS,
    agentTokenKey: `${resolvedSessionId}:${dbAgentName}`,
    observedInputTokens: rawObserved,
    explicitQuota: opts.agentInputTokenQuota,
    sdlcConfig,
    taskDir: effTaskDir,
    projectPath: resolvedProjPath,
    sessionId: resolvedSessionId,
    agent: dbAgentName,
    task: opts.task || '',
    taskId: opts.taskId || '',
    todos: todoSync.todos,
    work: (wfStatus && wfStatus.plan) || '',
    contextText: instructions,
    status: hasStatusFile ? wfStatus : null,
    saveStatusFn: hasStatusFile ? workflowHelpers.saveWorkflowStatus : null
  });

  const hasActiveWorkflowContext = hasExplicitTaskDir || hasStatusFile || Boolean(opts.taskId);
  const todoLine = hasActiveWorkflowContext
    ? todoHelpers.formatTodoSyncBlock(todoSync.client_todo_directive, todoSync.todos)
    : '';
  let nextInstructions = instructions;
  if (quotaCheck.triggered && quotaCheck.checkpoint_block) {
    nextInstructions = `${quotaCheck.checkpoint_block}\n\n${slicePreservingHeadMiddleTail(instructions, 1800, { markerLabel: 'quota-body' })}`;
  }
  if (todoLine && !nextInstructions.includes('[TODO SYNC]')) {
    nextInstructions = `${nextInstructions}\n\n${todoLine}`;
  }
  return { instructions: nextInstructions, todoSync, quotaCheck };
}

module.exports = {
  DEFAULT_AGENT_INPUT_TOKEN_QUOTA,
  QUOTA_MIN,
  QUOTA_MAX,
  AGENT_INPUT_TOKENS,
  resetAgentInputTokens,
  resolveDynamicInputQuota,
  resolveCompactionThreadRef,
  captureLangGraphCompactionState,
  getLatestLangGraphCompactionState,
  compactAndBuildLatestCondition,
  evaluateAgentQuotaTurn,
  prepareAgentTurnEnvelope
};
