'use strict';

const path = require('path');
const { getDeployableAgentNames, normalizeAgentName } = require('../../src/canonical_agents');
const { getResolvedTaskDir } = require('../../src/mcp/workflow_common');
const { getActiveSessionId, detectActiveClient, resolveFirstSpawnClient } = require('../../src/mcp/client_detection');
const { spawnSubagent, spawnParallelSubagents } = require('../../src/mcp/subagent_spawner');
const worktree = require('../../src/mcp/worktree_isolation');

function _parseRunAgentArgs(args = []) {
  const parsed = {
    agent: null,
    agents: [],
    parallel: false,
    task: null,
    context: null,
    constraints: null,
    skills: [],
    projectPath: null,
    cwd: null,
    taskDir: null,
    sessionId: null,
    flowHash: null,
    taskId: null,
    client: null,
    harnessBin: null,
    execute: false,
    idle: false,
    timeoutMs: null,
    autoReport: false,
    dispatchId: null,
    json: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--agent' || arg === '-a') && args[i + 1]) {
      parsed.agent = args[++i];
    } else if (arg === '--agents' && args[i + 1]) {
      parsed.agents = args[++i].split(',').map((a) => a.trim()).filter(Boolean);
    } else if (arg === '--parallel') {
      parsed.parallel = true;
    } else if (arg === '--execute') {
      parsed.execute = true;
    } else if (arg === '--idle') {
      parsed.idle = true;
    } else if (arg === '--harness-bin' && args[i + 1]) {
      parsed.harnessBin = args[++i];
    } else if (arg === '--timeout-ms' && args[i + 1]) {
      parsed.timeoutMs = Number(args[++i]) || null;
    } else if (arg === '--auto-report') {
      parsed.autoReport = true;
    } else if (arg === '--dispatch-id' && args[i + 1]) {
      parsed.dispatchId = args[++i];
    } else if ((arg === '--task' || arg === '--prompt' || arg === '-t') && args[i + 1]) {
      parsed.task = args[++i];
    } else if (arg === '--context' && args[i + 1]) {
      parsed.context = args[++i];
    } else if (arg === '--constraints' && args[i + 1]) {
      parsed.constraints = args[++i];
    } else if (arg === '--skills' && args[i + 1]) {
      parsed.skills = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if ((arg === '--project-path' || arg === '--project' || arg === '-p') && args[i + 1]) {
      parsed.projectPath = args[++i];
    } else if ((arg === '--cwd' || arg === '--worktree') && args[i + 1]) {
      parsed.cwd = args[++i];
    } else if (arg === '--task-dir' && args[i + 1]) {
      parsed.taskDir = args[++i];
    } else if (arg === '--session-id' && args[i + 1]) {
      parsed.sessionId = args[++i];
    } else if (arg === '--flow-hash' && args[i + 1]) {
      parsed.flowHash = args[++i];
    } else if (arg === '--task-id' && args[i + 1]) {
      parsed.taskId = args[++i];
    } else if (arg === '--client' && args[i + 1]) {
      parsed.client = args[++i];
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (!arg.startsWith('-') && !parsed.agent) {
      parsed.agent = arg;
    } else if (!arg.startsWith('-') && !parsed.task) {
      parsed.task = arg;
    }
  }

  return parsed;
}

async function cmdRunAgent(args = []) {
  const opts = _parseRunAgentArgs(args);
  const validAgents = getDeployableAgentNames().filter((n) => n !== 'sannin');
  if (!opts.task && opts.idle && normalizeAgentName(opts.agent) === 'advisor') {
    opts.task = 'Idle @advisor supervisor armed at workflow start: monitor all agents against Plan, TODOs, and User Goals, and issue direct [ADVISOR STEER] when drifting.';
  }

  if ((opts.parallel || opts.agents.length > 0) && opts.task) {
    const rawList = opts.agents.length > 0
      ? opts.agents
      : (opts.agent ? opts.agent.split(',').map((a) => a.trim()).filter(Boolean) : []);
    const normalizedList = rawList.map(normalizeAgentName).filter((n) => validAgents.includes(n));
    if (normalizedList.length === 0) {
      const errPayload = {
        status: 'error',
        message: `Provide at least one valid subagent via --agents <a1,a2>. Supported: ${validAgents.join(', ')}`
      };
      process.stdout.write(`${JSON.stringify(errPayload, null, 2)}\n`);
      process.exitCode = 1;
      return errPayload;
    }

    const projectPath = opts.projectPath ? path.resolve(opts.projectPath) : process.cwd();
    const client = resolveFirstSpawnClient([opts.client, detectActiveClient()], 'cli');
    const sessionId = opts.sessionId || getActiveSessionId(projectPath, client);
    const taskDir = opts.taskDir || getResolvedTaskDir(null, projectPath, sessionId);
    const isoState = worktree.getIsolationState(projectPath);
    const baseSha = isoState.enabled ? worktree.captureBaseSha(isoState.repo_root) : null;

    const workstreams = normalizedList.map((ag, idx) => ({
      agent: ag,
      domain: ag,
      task: `${opts.task} (${ag} slice #${idx + 1})`,
      skills: opts.skills,
      cwd: opts.cwd || projectPath
    }));

    const spawnBatch = await spawnParallelSubagents(workstreams, {
      taskId: opts.taskId || path.basename(taskDir),
      flowHash: opts.flowHash,
      sessionId,
      projectPath,
      taskDir,
      client,
      context: opts.context,
      constraints: opts.constraints,
      execute: opts.execute,
      harnessBin: opts.harnessBin,
      timeoutMs: opts.timeoutMs,
      autoReport: opts.autoReport,
      dispatchId: opts.dispatchId
    });

    if (!spawnBatch.ok) {
      const errPayload = {
        status: 'error',
        parallel: true,
        agents: normalizedList,
        base_sha: baseSha,
        task_dir: taskDir,
        error_code: spawnBatch.error_code || 'PARALLEL_SPAWN_FAILED',
        error: spawnBatch.error || 'One or more parallel subagent spawns failed.',
        results: spawnBatch.results || []
      };
      process.stdout.write(`${JSON.stringify(errPayload, null, 2)}\n`);
      process.exitCode = 1;
      return errPayload;
    }

    const batchPayload = {
      status: 'parallel_completed',
      parallel: true,
      agents: normalizedList,
      base_sha: baseSha,
      task_dir: taskDir,
      results: spawnBatch.results
    };
    process.stdout.write(`${JSON.stringify(batchPayload, null, 2)}\n`);
    return batchPayload;
  }

  if (!opts.agent || !opts.task) {
    const errPayload = {
      status: 'error',
      message: 'Usage: konoha run-agent --agent <name> --task "<prompt>" [--parallel --agents <a1,a2>] [--cwd <worktree>] [--project-path <path>] [--task-dir <dir>]'
    };
    process.stdout.write(`${JSON.stringify(errPayload, null, 2)}\n`);
    process.exitCode = 1;
    return errPayload;
  }

  const normalizedAgent = normalizeAgentName(opts.agent);
  if (!validAgents.includes(normalizedAgent)) {
    const errPayload = {
      status: 'error',
      message: `Unknown subagent "${opts.agent}". Supported subagents: ${validAgents.join(', ')}`
    };
    process.stdout.write(`${JSON.stringify(errPayload, null, 2)}\n`);
    process.exitCode = 1;
    return errPayload;
  }

  const projectPath = opts.projectPath ? path.resolve(opts.projectPath) : process.cwd();
  const client = resolveFirstSpawnClient([opts.client, detectActiveClient()], 'cli');
  const sessionId = opts.sessionId || getActiveSessionId(projectPath, client);
  const taskDir = opts.taskDir || getResolvedTaskDir(null, projectPath, sessionId);

  const spawned = await spawnSubagent({
    agent: normalizedAgent,
    task: opts.task,
    context: opts.context,
    constraints: opts.constraints,
    skills: opts.skills,
    projectPath,
    cwd: opts.cwd || projectPath,
    taskDir,
    sessionId,
    flowHash: opts.flowHash,
    taskId: opts.taskId || path.basename(taskDir),
    client,
    execute: opts.execute,
    harnessBin: opts.harnessBin,
    timeoutMs: opts.timeoutMs,
    autoReport: opts.autoReport,
    dispatchId: opts.dispatchId
  });

  if (!spawned.ok) {
    process.stdout.write(`${JSON.stringify(spawned)}\n`);
    process.exitCode = 1;
    return spawned;
  }

  process.stdout.write(`${JSON.stringify(spawned)}\n`);
  return spawned;
}

module.exports = {
  cmdRunAgent,
  _parseRunAgentArgs
};
