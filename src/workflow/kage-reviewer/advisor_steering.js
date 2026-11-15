'use strict';

/**
 * src/workflow/kage-reviewer/advisor_steering.js
 *
 * Always-on idle @advisor supervisor bootstrap, Plan/TODO/Goal drift
 * detection across all active agents, and direct client-native steering.
 */

const fs = require('fs');
const path = require('path');

const STEERS_FILENAME = '.konoha_advisor_steers.json';
const SAFE_AGENT_RE = /^[a-z0-9-]+$/;
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'into', 'from', 'that', 'this', 'your', 'about',
  'have', 'make', 'task', 'plan', 'todo', 'goal', 'goals', 'agent', 'agents',
  'implement', 'create', 'update', 'build', 'check', 'review', 'file', 'files',
  'code', 'work', 'must', 'should', 'using', 'only', 'after', 'before', 'when',
  'not', 'are', 'but', 'use', 'add', 'fix', 'new', 'all', 'via', 'set', 'run'
]);

function _normalizeClientKey(client) {
  const raw = String(client || 'universal').toLowerCase().trim();
  if (raw === 'agy' || raw === 'antigravity-cli' || raw === 'antigravity-ide') return 'antigravity';
  if (raw === 'claudecode' || raw === 'claude-code') return 'claude';
  if (raw === 'command-code') return 'commandcode';
  return raw || 'universal';
}

function _normalizeAgentName(name) {
  const cleaned = String(name || 'worker').toLowerCase().trim().replace(/^@/, '').replace(/_/g, '-');
  const sanitized = cleaned.replace(/[^a-z0-9-]/g, '');
  return (sanitized && SAFE_AGENT_RE.test(sanitized)) ? sanitized : 'worker';
}

function _stripControlChars(value) {
  return String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ').trim();
}

function _shellQuotePosix(value) {
  return `'${String(value ?? '').replace(/'/g, "'\\''")}'`;
}

function _extractDomainTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_./-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function initAdvisorSessionSupervisor(options = {}) {
  const normClient = _normalizeClientKey(options.client);
  const status = (options.status && typeof options.status === 'object') ? options.status : null;
  const existing = (status && status.advisor_supervisor && typeof status.advisor_supervisor === 'object')
    ? status.advisor_supervisor
    : {};
  const todos = Array.isArray(options.todos)
    ? options.todos
    : (status && Array.isArray(status.tasks) ? status.tasks : []);

  const supervisor = {
    agent: 'advisor',
    role: 'resident_supervisor',
    state: existing.state || 'idle',
    mode: options.mode || existing.mode || 'realtime-idle',
    started_from_beginning: true,
    review_scope: 'all_agents',
    watch_targets: ['plan', 'todo', 'goals'],
    client: normClient,
    tokens_used: Number.isFinite(existing.tokens_used) ? existing.tokens_used : 0,
    max_turn_tokens: Number(options.maxTurnTokens || existing.max_turn_tokens || 1000),
    goal_anchor: String(options.goal || options.prompt || status?.prompt || existing.goal_anchor || '').slice(0, 400),
    plan_anchor: String(options.plan || status?.plan || existing.plan_anchor || '').slice(0, 400),
    todo_count: todos.length,
    active_agents: Array.isArray(options.activeAgents)
      ? options.activeAgents
      : (Array.isArray(existing.active_agents) ? existing.active_agents : []),
    started_at: existing.started_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (status) {
    status.advisor_supervisor = supervisor;
    if (!Array.isArray(status.advisor_audit_log) || status.advisor_audit_log.length === 0) {
      status.advisor_audit_log = [{
        stage: 'session_start',
        status: 'IDLE_OK',
        approved: true,
        tokens_used: 0,
        bytes_used: 0,
        violations: [],
        timestamp: supervisor.started_at
      }];
    }
  }

  return supervisor;
}

function _checkNegativeConstraints(anchorText, summaryText) {
  if (!anchorText || !summaryText) return null;
  const negMatches = String(anchorText).matchAll(/\b(?:never|do\s+not|must\s+not|avoid|without)\s+([a-z0-9_./-]{3,32})/gi);
  const sumLower = String(summaryText).toLowerCase();
  for (const match of negMatches) {
    const forbidden = String(match[1] || '').toLowerCase();
    if (!forbidden || STOP_WORDS.has(forbidden)) continue;
    const violatedRe = new RegExp(`\\b(?:used|added|installed|created|switched\\s+to|implemented|running)\\s+${forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (violatedRe.test(sumLower)) {
      return forbidden;
    }
  }
  return null;
}

function checkPlanTodoGoalDrift({
  agent = 'worker',
  status = 'in_progress',
  delegatedTodo = '',
  goal = '',
  plan = '',
  todos = [],
  summary = '',
  filesCreated = [],
  filesModified = []
} = {}) {
  const violations = [];
  const normAgent = _normalizeAgentName(agent);
  const sumText = String(summary || '');
  const filesText = `${(filesCreated || []).join(' ')} ${(filesModified || []).join(' ')}`.toLowerCase();
  const combinedLower = `${sumText.toLowerCase()} ${filesText}`;
  const isExploratory = ['genin', 'chunin', 'kage', 'advisor'].includes(normAgent);

  // User Goal alignment check
  if (goal && sumText) {
    if (/\b(ignored\s+the\s+goal|off[- ]goal|unrelated\s+feature|replaced\s+the\s+goal|instead\s+of\s+the\s+user)\b/i.test(sumText)) {
      violations.push({
        type: 'goal_drift',
        detail: `@${normAgent} deviated from user goal ("${String(goal).slice(0, 100)}").`
      });
    } else {
      const brokenConstraint = _checkNegativeConstraints(goal, sumText);
      if (brokenConstraint) {
        violations.push({
          type: 'goal_drift',
          detail: `@${normAgent} violated goal constraint prohibiting "${brokenConstraint}".`
        });
      } else if (!isExploratory) {
        const goalTokens = _extractDomainTokens(goal);
        const sumTokens = _extractDomainTokens(sumText);
        if (goalTokens.length >= 4 && sumTokens.length >= 5) {
          const overlap = goalTokens.filter((t) => combinedLower.includes(t));
          if (overlap.length === 0) {
            violations.push({
              type: 'goal_drift',
              detail: `@${normAgent} output shares zero domain terms with user goal ("${String(goal).slice(0, 100)}").`
            });
          }
        }
      }
    }
  }

  // Approved Plan alignment check
  if (plan && sumText) {
    if (/\b(skipped\s+plan|bypassed\s+(?:the\s+)?plan|ignored\s+plan|abandoned\s+plan|bypassed\s+gate)\b/i.test(sumText)) {
      violations.push({
        type: 'plan_drift',
        detail: `@${normAgent} bypassed or contradicted the approved plan.`
      });
    } else {
      const brokenPlanRule = _checkNegativeConstraints(plan, sumText);
      if (brokenPlanRule) {
        violations.push({
          type: 'plan_drift',
          detail: `@${normAgent} violated approved plan constraint prohibiting "${brokenPlanRule}".`
        });
      }
    }
  }

  // Active checklist alignment across delegated task and pending backlog items
  const activeTodos = Array.isArray(todos)
    ? todos.filter((t) => t && t.status !== 'completed' && (!t.agent || _normalizeAgentName(t.agent) === normAgent))
    : [];
  const primaryTodo = delegatedTodo || (activeTodos[0] && (activeTodos[0].task || activeTodos[0].title)) || '';
  if (primaryTodo && sumText) {
    if (/\b(skipped\s+(?:the\s+)?todo|unrelated\s+to\s+todo|abandoned\s+(?:the\s+)?todo|instead\s+of|skipped\s+the\s+requested|unrelated\s+task|abandoned\s+the\s+original)\b/i.test(sumText)) {
      violations.push({
        type: 'todo_drift',
        detail: `@${normAgent} deviated from active TODO: "${String(primaryTodo).slice(0, 120)}".`
      });
    } else if (delegatedTodo || (status === 'completed' && activeTodos.length > 0 && !isExploratory)) {
      const todoTokens = _extractDomainTokens(primaryTodo);
      const matched = todoTokens.filter((t) => combinedLower.includes(t));
      if (todoTokens.length >= 3 && matched.length === 0) {
        violations.push({
          type: 'todo_drift',
          detail: `@${normAgent} output has zero domain overlap with delegated TODO ("${String(primaryTodo).slice(0, 120)}").`
        });
      }
    }
  }

  return violations;
}

function buildClientSteerCall(options = {}) {
  const normClient = _normalizeClientKey(options.client);
  const targetAgent = _normalizeAgentName(options.targetAgent || 'worker');
  const recipient = options.targetAgentId || targetAgent;
  const directive = String(options.directive || '').trim();
  const piSubagentSupported = Boolean(options.piSubagentSupported);
  const pack = (transport, tool, call) => ({
    client: normClient,
    target_agent: targetAgent,
    transport,
    tool,
    call,
    summary: `${tool}(${JSON.stringify(call)})`
  });

  if (normClient === 'antigravity') return pack('native_message', 'send_message', { Recipient: recipient, Message: directive });
  if (normClient === 'claude') return pack('native_message', 'SendMessage', { to: recipient, message: directive, summary: `Advisor steer -> @${targetAgent}` });
  if (normClient === 'codex') return pack('native_input', 'send_input', { id: recipient, message: directive });
  if (normClient === 'omp') return pack('native_task_steer', 'task', { tasks: [{ name: `${targetAgent}-steer`, agent: targetAgent, task: directive }] });
  if (normClient === 'cursor' || normClient === 'opencode' || normClient === 'commandcode') {
    return pack('native_task_steer', normClient === 'cursor' ? 'Task' : 'task', { subagent_type: targetAgent, prompt: directive });
  }
  if (normClient === 'pi' && piSubagentSupported) return pack('pi_subagent_steer', 'subagent', { agent: targetAgent, task: directive });

  const cleanDirective = _stripControlChars(directive);
  const cliArgs = ['node', '~/.konoha/bin/cli.js', 'run-agent', '--agent', targetAgent, '--task', cleanDirective];
  return {
    client: normClient,
    target_agent: targetAgent,
    transport: 'cli_steer',
    tool: 'run_command',
    args: cliArgs,
    command: `rtk node ~/.konoha/bin/cli.js run-agent --agent ${targetAgent} --task ${_shellQuotePosix(cleanDirective)}`,
    summary: `rtk node ~/.konoha/bin/cli.js run-agent --agent ${targetAgent} --task "..."`
  };
}

function _getSteerQueuePath(taskDir) {
  if (!taskDir || typeof taskDir !== 'string' || taskDir.includes('\0')) return null;
  const resolvedDir = path.resolve(taskDir);
  try {
    if (fs.existsSync(resolvedDir) && fs.lstatSync(resolvedDir).isSymbolicLink()) return null;
  } catch {
    return null;
  }
  const queuePath = path.resolve(resolvedDir, STEERS_FILENAME);
  if (!queuePath.startsWith(resolvedDir + path.sep)) return null;
  return queuePath;
}

function _readSteerQueue(taskDir) {
  const queuePath = _getSteerQueuePath(taskDir);
  if (!queuePath || !fs.existsSync(queuePath)) return [];
  try {
    if (fs.lstatSync(queuePath).isSymbolicLink()) return [];
    const parsed = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function _writeSteerQueue(taskDir, entries) {
  const queuePath = _getSteerQueuePath(taskDir);
  if (!queuePath) return false;
  const tmpPath = `${queuePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.mkdirSync(path.dirname(queuePath), { recursive: true });
    if (fs.existsSync(queuePath) && fs.lstatSync(queuePath).isSymbolicLink()) return false;
    fs.writeFileSync(tmpPath, JSON.stringify(entries.slice(-30), null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmpPath, queuePath);
    return true;
  } catch {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return false;
  }
}

function _tryBreakStaleLock(lockPath) {
  try {
    if (Date.now() - fs.lstatSync(lockPath).mtimeMs > 5000) fs.unlinkSync(lockPath);
  } catch { /* ignore */ }
}

function _tryAcquireSteerLock(lockPath) {
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err && err.code === 'EEXIST') _tryBreakStaleLock(lockPath);
    return false;
  }
}

function _sleepSyncMs(ms) {
  try {
    if (typeof SharedArrayBuffer !== 'undefined') {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    }
  } catch { /* ignore */ }
}

function _withSteerQueueLock(taskDir, fn, fallback = null) {
  const queuePath = _getSteerQueuePath(taskDir);
  if (!queuePath) return fn();
  const lockPath = `${queuePath}.lock`;
  let acquired = false;
  try {
    fs.mkdirSync(path.dirname(queuePath), { recursive: true });
    for (let i = 0; i < 60; i++) {
      acquired = _tryAcquireSteerLock(lockPath);
      if (acquired) break;
      _sleepSyncMs(2);
    }
    if (!acquired) return fallback;
    return fn();
  } finally {
    if (acquired) {
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    }
  }
}

function enqueueAdvisorSteer(options = {}) {
  const targetAgent = _normalizeAgentName(options.targetAgent || options.agent || 'worker');
  const steerCall = options.clientSteerCall || buildClientSteerCall({
    client: options.client,
    targetAgent,
    targetAgentId: options.targetAgentId,
    directive: options.directive,
    piSubagentSupported: options.piSubagentSupported
  });

  const record = {
    id: `steer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    target_agent: targetAgent,
    target_agent_id: options.targetAgentId || null,
    task_id: options.taskId || null,
    status: 'pending',
    violations: Array.isArray(options.violations) ? options.violations : [],
    directive: String(options.directive || ''),
    client_steer_call: steerCall,
    created_at: new Date().toISOString()
  };

  if (options.taskDir) {
    _withSteerQueueLock(options.taskDir, () => {
      const queue = _readSteerQueue(options.taskDir);
      queue.push(record);
      _writeSteerQueue(options.taskDir, queue);
    });
  }
  if (options.workflowStatus && typeof options.workflowStatus === 'object') {
    const existing = Array.isArray(options.workflowStatus.advisor_steers) ? options.workflowStatus.advisor_steers : [];
    options.workflowStatus.advisor_steers = [...existing.slice(-19), record];
    if (options.workflowStatus.advisor_supervisor) {
      options.workflowStatus.advisor_supervisor.state = 'steering';
      options.workflowStatus.advisor_supervisor.last_steered_agent = targetAgent;
      options.workflowStatus.advisor_supervisor.updated_at = record.created_at;
    }
  }
  return record;
}

function peekPendingAdvisorSteers(taskDir, targetAgent = null) {
  const queue = _readSteerQueue(taskDir);
  const norm = targetAgent ? _normalizeAgentName(targetAgent) : null;
  return queue.filter((s) => s && s.status === 'pending' && (!norm || s.target_agent === norm));
}

function acknowledgeAdvisorSteers(taskDir, targetAgent = null, steerIds = null) {
  if (!taskDir) return [];
  return _withSteerQueueLock(taskDir, () => {
    const queue = _readSteerQueue(taskDir);
    const norm = targetAgent ? _normalizeAgentName(targetAgent) : null;
    const idSet = Array.isArray(steerIds) ? new Set(steerIds) : null;
    const acked = [];
    const now = new Date().toISOString();
    for (const item of queue) {
      if (!item || item.status !== 'pending') continue;
      const matchAgent = !norm || item.target_agent === norm;
      const matchId = !idSet || idSet.has(item.id);
      if (matchAgent && matchId) {
        item.status = 'delivered';
        item.delivered_at = now;
        acked.push(item);
      }
    }
    if (acked.length > 0) _writeSteerQueue(taskDir, queue);
    return acked;
  }, []);
}

function formatSteerInjectionBlock(steers = []) {
  if (!Array.isArray(steers) || steers.length === 0) return '';
  const items = steers.slice(-3).map((s) => `- ${s.directive}`).join('\n');
  return `[ADVISOR STEER DIRECTIVE — MANDATORY COURSE CORRECTION]\n${items}\nAcknowledge and realign immediately with the approved Plan, TODOs, and User Goals.`;
}

function consumeAdvisorSteerContext(taskDir, targetAgent = null) {
  if (!taskDir) return { pending: [], block: '' };
  const norm = targetAgent ? _normalizeAgentName(targetAgent) : null;
  const delivered = _withSteerQueueLock(taskDir, () => {
    const queue = _readSteerQueue(taskDir);
    const matched = [];
    const now = new Date().toISOString();
    for (const item of queue) {
      if (!item || item.status !== 'pending') continue;
      if (norm && item.target_agent !== norm) continue;
      item.status = 'delivered';
      item.delivered_at = now;
      matched.push({ ...item });
    }
    if (matched.length > 0) _writeSteerQueue(taskDir, queue);
    return matched;
  }, []);
  if (!delivered || delivered.length === 0) return { pending: [], block: '' };
  return { pending: delivered, block: formatSteerInjectionBlock(delivered) };
}

module.exports = {
  STEERS_FILENAME,
  initAdvisorSessionSupervisor,
  checkPlanTodoGoalDrift,
  buildClientSteerCall,
  enqueueAdvisorSteer,
  peekPendingAdvisorSteers,
  acknowledgeAdvisorSteers,
  formatSteerInjectionBlock,
  consumeAdvisorSteerContext
};
