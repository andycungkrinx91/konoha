'use strict';

const path = require('path');
const { runMcpAgent } = require('../../src/mcp/memory_subagent_runner');
const { getCanonicalAgentNames, normalizeAgentName } = require('../../src/canonical_agents');
const { getResolvedTaskDir } = require('../../src/mcp/workflow_common');
const { getActiveSessionId, detectActiveClient } = require('../../src/mcp/client_detection');

function _parseRunAgentArgs(args = []) {
  const parsed = {
    agent: null,
    task: null,
    context: null,
    constraints: null,
    skills: [],
    projectPath: null,
    taskDir: null,
    sessionId: null,
    flowHash: null,
    taskId: null,
    client: null,
    json: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--agent' || arg === '-a') && args[i + 1]) {
      parsed.agent = args[++i];
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
  if (!opts.agent || !opts.task) {
    const errPayload = {
      status: 'error',
      message: 'Usage: konoha run-agent --agent <name> --task "<prompt>" [--project-path <path>] [--task-dir <dir>]'
    };
    process.stdout.write(`${JSON.stringify(errPayload, null, 2)}\n`);
    process.exitCode = 1;
    return errPayload;
  }

  const normalizedAgent = normalizeAgentName(opts.agent);
  const validAgents = getCanonicalAgentNames().filter((n) => n !== 'sannin');
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
    client
  });

  process.stdout.write(`${rawResult}\n`);
  try {
    return JSON.parse(rawResult);
  } catch (_) {
    return { status: 'ready', agent: normalizedAgent, output: rawResult };
  }
}

module.exports = {
  cmdRunAgent,
  _parseRunAgentArgs
};
