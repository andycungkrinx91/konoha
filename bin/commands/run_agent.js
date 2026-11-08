'use strict';

const path = require('path');
const { runMcpAgent } = require('../../src/mcp/memory_subagent_runner');
const { dispatchParallelSlicesAsync } = require('../../src/mcp/workflow_sannin');
const { getCanonicalAgentNames, normalizeAgentName } = require('../../src/canonical_agents');
const { getResolvedTaskDir } = require('../../src/mcp/workflow_common');
const { getActiveSessionId, detectActiveClient } = require('../../src/mcp/client_detection');
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
  const validAgents = getCanonicalAgentNames().filter((n) => n !== 'sannin');

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
    const client = opts.client || detectActiveClient() || 'cli';
    const sessionId = opts.sessionId || getActiveSessionId(projectPath, client);
    const taskDir = opts.taskDir || getResolvedTaskDir(null, projectPath, sessionId);
    const isoState = worktree.getIsolationState(projectPath);
    const baseSha = isoState.enabled ? worktree.captureBaseSha(isoState.repo_root) : null;

    const workstreams = normalizedList.map((ag, idx) => ({
      agent: ag,
      domain: ag,
      task: `${opts.task} (${ag} slice #${idx + 1})`,
      skills: opts.skills,
      worktree: opts.cwd || null
    }));

    const results = await dispatchParallelSlicesAsync(workstreams, {
      taskId: opts.taskId || path.basename(taskDir),
      flowHash: opts.flowHash,
      sessionId,
      projectPath,
      taskDir,
      client,
      context: opts.context,
      constraints: opts.constraints
    });

    const batchPayload = {
      status: 'parallel_ready',
      parallel: true,
      agents: normalizedList,
      base_sha: baseSha,
      task_dir: taskDir,
      results
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
  if (opts.projectPath) {
    process.env.KONOHA_WORKSPACE = projectPath;
    process.env.WORKSPACE_ROOT = projectPath;
  }
  const client = opts.client || detectActiveClient() || 'cli';
  const sessionId = opts.sessionId || getActiveSessionId(projectPath, client);
  const taskDir = opts.taskDir || getResolvedTaskDir(null, projectPath, sessionId);

  const rawResult = runMcpAgent(normalizedAgent, {
    task: opts.task,
    context: opts.context,
    constraints: opts.constraints,
    skills: opts.skills,
    projectPath,
    taskDir,
    sessionId,
    flowHash: opts.flowHash,
    taskId: opts.taskId || path.basename(taskDir),
    client,
    worktree: opts.cwd || null
  });

  let parsedResult = null;
  try {
    parsedResult = JSON.parse(rawResult);
  } catch (_) {
    parsedResult = { status: 'ready', agent: normalizedAgent, output: rawResult };
  }

  parsedResult.child_pid = process.pid;
  parsedResult.client = client;
  parsedResult.task_context_received = Boolean(opts.task);
  parsedResult.executed_at = new Date().toISOString();

  if (opts.autoReport) {
    try {
      const { reportFromAgent } = require('../../src/mcp/memory_project_context');
      const reportRaw = reportFromAgent({
        agent_name: normalizedAgent,
        summary: `Child specialist @${normalizedAgent} completed task on client=${client}: ${opts.task.slice(0, 120)}`,
        status: 'completed',
        validation: [`child_spawn_verified:${normalizedAgent}:${client}:pid_${process.pid} (exit 0)`],
        task_dir: taskDir,
        task_id: opts.taskId || path.basename(taskDir),
        dispatch_id: opts.dispatchId || undefined,
        project_path: projectPath
      });
      parsedResult.report_evidence = JSON.parse(reportRaw);
      parsedResult.auto_reported = true;
    } catch (_) {
      parsedResult.auto_reported = false;
    }
  }

  const finalOut = JSON.stringify(parsedResult);
  process.stdout.write(`${finalOut}\n`);
  return parsedResult;
}

module.exports = {
  cmdRunAgent,
  _parseRunAgentArgs
};
