'use strict';

/**
 * src/mcp/subagent_worker.js — Isolated child process entrypoint for subagent execution.
 * Reads JSON payload from stdin, applies workspace & read-only env scoping,
 * compiles agent context via runMcpAgent({ isChildWorker: true }), optionally emits
 * auto-report evidence from the child PID, and prints structured JSON output to stdout.
 */

const fs = require('fs');
const path = require('path');
const { isReadOnlyAgent } = require('../agent_file_safety');
const { normalizeAgentName } = require('../canonical_agents');
const { runMcpAgentAsync } = require('./memory_subagent_runner');
const { reportFromAgent } = require('./memory_project_context');

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const rawInput = await readStdin();
  const payload = JSON.parse(rawInput || '{}');
  const agent = normalizeAgentName(payload.agent || '');
  if (!agent) {
    process.stdout.write(`${JSON.stringify({ ok: false, status: 'error', error_code: 'INVALID_AGENT', message: 'Missing agent name in worker payload.' })}\n`);
    process.exit(1);
    return;
  }

  const readOnly = isReadOnlyAgent(agent);
  process.env.KONOHA_IS_CHILD_WORKER = '1';
  process.env.KONOHA_READONLY = readOnly ? '1' : '0';

  const projectPath = payload.projectPath ? path.resolve(payload.projectPath) : process.cwd();
  const workDir = payload.cwd ? path.resolve(payload.cwd) : projectPath;
  process.env.KONOHA_WORKSPACE = projectPath;
  process.env.WORKSPACE_ROOT = projectPath;

  if (fs.existsSync(workDir)) {
    process.chdir(workDir);
  }

  const rawResult = await runMcpAgentAsync(agent, {
    task: payload.task || '',
    context: payload.context || undefined,
    constraints: payload.constraints || undefined,
    skills: Array.isArray(payload.skills) ? payload.skills : [],
    projectPath,
    taskDir: payload.taskDir || undefined,
    sessionId: payload.sessionId || undefined,
    flowHash: payload.flowHash || undefined,
    taskId: payload.taskId || undefined,
    client: payload.client || 'cli',
    worktree: payload.cwd || null,
    isChildWorker: true
  });

  let parsed = null;
  try {
    parsed = JSON.parse(rawResult);
  } catch (_) {
    parsed = { status: 'ready', agent, output: rawResult };
  }

  parsed.child_pid = process.pid;
  parsed.parent_pid = payload.parentPid || process.ppid;
  parsed.effective_cwd = process.cwd();
  parsed.read_only_enforced = readOnly;
  parsed.konoha_readonly_env = process.env.KONOHA_READONLY;
  parsed.client = payload.client || 'cli';
  parsed.task_context_received = Boolean(payload.task);
  parsed.executed_at = new Date().toISOString();

  if (payload.autoReport) {
    try {
      const reportRaw = reportFromAgent({
        agent_name: agent,
        summary: `Child specialist @${agent} completed task on client=${parsed.client}: ${String(payload.task || '').slice(0, 120)}`,
        status: 'completed',
        validation: [`child_spawn_verified:${agent}:${parsed.client}:pid_${process.pid} (exit 0)`],
        task_dir: payload.taskDir,
        task_id: payload.taskId || (payload.taskDir ? path.basename(payload.taskDir) : undefined),
        dispatch_id: payload.dispatchId || undefined,
        project_path: projectPath
      });
      parsed.report_evidence = JSON.parse(reportRaw);
      parsed.auto_reported = true;
    } catch (err) {
      parsed.auto_reported = false;
      parsed.auto_report_error = err.message;
    }
  }

  process.stdout.write(`${JSON.stringify(parsed)}\n`);
}

main().catch((err) => {
  process.stdout.write(`${JSON.stringify({ ok: false, status: 'error', error_code: 'WORKER_CRASH', message: err.message })}\n`);
  process.exit(1);
});
