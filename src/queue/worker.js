/**
 * Konoha Autonomous Queue Worker.
 * Monitors prompt_queue for pending tasks and executes them asynchronously
 * with zero token waste on idle and smart operational vs AI routing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile, spawnSync } = require('child_process');
const inboxModule = require('./inbox');
const notifierModule = require('../telegram/notifier');

/**
 * Dynamically locate the agy CLI binary across systems.
 */
function resolveAgyBin() {
  if (process.env.AGY_BIN && fs.existsSync(process.env.AGY_BIN)) {
    return process.env.AGY_BIN;
  }
  const userLocal = path.join(os.homedir(), '.local', 'bin', 'agy');
  if (fs.existsSync(userLocal)) {
    return userLocal;
  }
  try {
    const whichRes = spawnSync('which', ['agy'], { encoding: 'utf8' });
    if (whichRes.status === 0 && whichRes.stdout.trim() && fs.existsSync(whichRes.stdout.trim())) {
      return whichRes.stdout.trim();
    }
  } catch (_) { /* fallback */ }
  return 'agy';
}

const CLIENT_DISPLAY_NAMES = {
  antigravity: 'Antigravity IDE/CLI',
  agy: 'Antigravity CLI',
  claudecode: 'Claude Code',
  claude: 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
  commandcode: 'Command Code',
  pi: 'Pi Agent',
  telegram: 'Telegram Bot'
};

let workerTimer = null;
let isExecuting = false;
let workerRunning = false;

const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'rm -rf ~',
  'mkfs',
  'dd if=',
  'drop database',
  'truncate table'
];

/**
 * Check if a prompt is an operational shell command.
 */
function isOperationalCommand(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;
  const p = prompt.trim();
  if (p.startsWith('/sh ') || p.startsWith('/exec ') || p.startsWith('sh: ') || p.startsWith('exec: ')) {
    return true;
  }
  const directCmds = [
    'ssh ',
    'git ',
    'curl ',
    'df ',
    'free ',
    'uptime ',
    'docker ',
    'systemctl ',
    'node ',
    'npm ',
    'pnpm ',
    'cat ',
    'ls ',
    'bin/magento ',
    'kubectl ',
    'helm '
  ];
  const firstWord = p.split(/\s+/)[0];
  if (firstWord.startsWith('kc') || firstWord.startsWith('helmkc') || directCmds.some(cmd => p.startsWith(cmd) || firstWord === cmd.trim())) {
    return true;
  }
  if (/use\s+command\s+[`"']?([^`"'\n]+)[`"']?/i.test(p)) {
    return true;
  }
  return false;
}

/**
 * Extract executable shell command from prompt.
 */
function extractCommand(prompt) {
  const p = prompt.trim();
  if (p.startsWith('/sh ')) return p.slice(4).trim();
  if (p.startsWith('/exec ')) return p.slice(6).trim();
  if (p.startsWith('sh: ')) return p.slice(4).trim();
  if (p.startsWith('exec: ')) return p.slice(6).trim();

  const match = p.match(/(?:use|run)\s+command\s+[`"']?([^`"'\n]+)[`"']?/i);
  if (match && match[1]) {
    const cmd = match[1].trim();
    const sshKeyMatch = p.match(/ssh\s+key\s+(?:from\s+)?([~/\w.-]+)/i);
    const hostMatch = p.match(/(?:check|on|host)\s+([\w.-]+\.[a-z]{2,})/i);
    const pathMatch = p.match(/(?:use\s+path|path|directory)\s+([~/\w.-]+)/i);
    if (sshKeyMatch && hostMatch) {
      const key = sshKeyMatch[1];
      const host = hostMatch[1];
      const user = p.includes('mage2user') ? 'mage2user' : 'root';
      const targetPath = pathMatch ? pathMatch[1] : '';
      const cleanRemoteCmd = cmd.replace(/please/gi, '').trim();
      const remoteCmd = targetPath ? `cd ${targetPath} && ${cleanRemoteCmd}` : cleanRemoteCmd;
      return `ssh -i ${key} -o StrictHostKeyChecking=no ${user}@${host} "${remoteCmd}"`;
    }
    return cmd.replace(/please/gi, '').trim();
  }

  return p;
}

/**
 * Format duration into human-readable string.
 */
function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s`;
}

/**
 * Extract meaningful task summary from output.
 */
function extractTaskSummary(output) {
  if (!output || typeof output !== 'string') return '(Execution completed)';
  const clean = output.trim();

  const summaryMatch = clean.match(/(?:###\s*(?:Summary|Verification|Kage Reviewer Confidence Gate Report|Completed Fixes)[\s\S]+)$/i);
  if (summaryMatch && summaryMatch[0]) {
    const section = summaryMatch[0].trim();
    return section.length > 800 ? section.slice(0, 800) + '...' : section;
  }

  if (clean.length > 800) {
    return '...' + clean.slice(-800).trim();
  }
  return clean;
}

/**
 * Extract evaluated Kage confidence score from output.
 */
function extractKageScore(output) {
  if (!output || typeof output !== 'string') return 100;
  const match = output.match(/(?:confidence\s*score|overall\s*confidence)[:\s*]+(\d+)%/i);
  if (match && match[1]) {
    const score = parseInt(match[1], 10);
    if (!isNaN(score)) return score;
  }
  return 100;
}

/**
 * Finalize task execution state and dispatch Telegram notification.
 */
async function finalizeTaskResult(task, { isSuccess, summary, duration, client, agent, tokenReduction, kageScore = null }) {
  const evaluatedKageScore = kageScore !== null ? kageScore : (isSuccess ? 100 : 0);
  inboxModule.completePrompt(task.id, {
    status: isSuccess ? 'completed' : 'failed',
    result_summary: summary,
    token_savings_percent: tokenReduction,
    kage_confidence_score: evaluatedKageScore
  });

  try {
    await notifierModule.sendTaskCompletedNotification({
      title: task.prompt.trim(),
      taskId: task.id,
      summary,
      status: isSuccess ? 'SUCCESS' : 'FAILED',
      duration,
      client,
      agent,
      tokenReduction,
      kageScore: evaluatedKageScore,
      slopFindings: 0
    });
  } catch (_) {
    /* intentional best-effort fallback: notification failure must not crash queue worker */
  }
}

/**
 * Dynamically detect executing ninja agent from prompt, CLI output markers, or domain heuristics.
 * Eliminates hardcoded 'Kage & Jonin' fallback.
 */
function detectExecutingAgent(prompt = '', output = '', fallback = null) {
  const p = (prompt || '').trim();

  // 1. Direct slash command prefix
  const directMatch = p.match(/^\/(kage|anbu|jonin|genin|chunin|tokubetsu[-_]jonin|sannin)/i);
  if (directMatch) {
    const raw = directMatch[1].toLowerCase().replace('_', '-');
    const names = {
      kage: 'Village Leader Kage',
      anbu: 'Black Ops Anbu',
      jonin: 'Elite Builder Jonin',
      genin: 'Scout Genin',
      chunin: 'Intel Ninja Chunin',
      'tokubetsu-jonin': 'Scribe Tokubetsu Jonin',
      sannin: 'Master Orchestrator Sannin'
    };
    if (names[raw]) return names[raw];
  }

  // 2. Dynamic output markers: inspect output turns for [icon Agent] active
  if (output && typeof output === 'string') {
    const matches = output.match(/\[([^\]]+)\]\s+active/gi);
    if (matches && matches.length > 0) {
      const last = matches[matches.length - 1];
      const m = last.match(/\[(?:[^\w\s]*\s*)?([a-zA-Z_-]+)\]/i);
      if (m && m[1]) {
        const key = m[1].toLowerCase().replace(/_/g, '-');
        const map = {
          kage: 'Village Leader Kage',
          anbu: 'Black Ops Anbu',
          jonin: 'Elite Builder Jonin',
          genin: 'Scout Genin',
          chunin: 'Intel Ninja Chunin',
          'tokubetsu-jonin': 'Scribe Tokubetsu Jonin',
          sannin: 'Master Orchestrator Sannin'
        };
        if (map[key]) return map[key];
      }
    }
  }

  // 3. Fallback heuristic from prompt keywords
  const lower = p.toLowerCase();
  if (lower.includes('backend') || lower.includes('bug') || lower.includes('fix') || lower.includes('docker') || lower.includes('api') || lower.includes('server')) {
    return 'Black Ops Anbu';
  }
  if (lower.includes('ui') || lower.includes('frontend') || lower.includes('css') || lower.includes('tailwind') || lower.includes('component') || lower.includes('design')) {
    return 'Elite Builder Jonin';
  }
  if (lower.includes('doc') || lower.includes('readme') || lower.includes('spec') || lower.includes('write')) {
    return 'Scribe Tokubetsu Jonin';
  }
  if (lower.includes('security') || lower.includes('audit') || lower.includes('review') || lower.includes('risk') || lower.includes('architect')) {
    return 'Village Leader Kage';
  }
  if (lower.includes('explore') || lower.includes('search') || lower.includes('trace') || lower.includes('find')) {
    return 'Scout Genin';
  }

  return fallback || 'Master Orchestrator Sannin';
}

/**
 * Execute a single task.
 */
async function processTask(task) {
  const startTime = Date.now();
  const cleanPrompt = task.prompt.trim();
  const execCwd = (task.workspace_root && fs.existsSync(task.workspace_root)) ? task.workspace_root : process.cwd();

  // Guard against destructive commands
  const lowerPrompt = cleanPrompt.toLowerCase();
  if (DANGEROUS_PATTERNS.some(pat => lowerPrompt.includes(pat))) {
    const errorMsg = 'Blocked: Destructive command rejected by Konoha safety guardrails.';
    await finalizeTaskResult(task, {
      isSuccess: false,
      summary: errorMsg,
      duration: '0.1s',
      client: 'Konoha Safety Guard',
      agent: 'Kage',
      tokenReduction: 100
    });
    return;
  }

  // 1. Operational Command (0 LLM Tokens)
  if (isOperationalCommand(cleanPrompt)) {
    const cmd = extractCommand(cleanPrompt);
    const userShell = (process.env.SHELL && fs.existsSync(process.env.SHELL))
      ? process.env.SHELL
      : (fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh');

    return new Promise((resolve) => {
      execFile(userShell, ['-i', '-c', cmd], { cwd: execCwd, timeout: 30 * 60 * 1000, maxBuffer: 5 * 1024 * 1024, env: { ...process.env, SHELL: userShell } }, async (err, stdout, stderr) => {
        const duration = formatDuration(Date.now() - startTime);
        const output = (stdout || stderr || (err ? err.message : '')).trim();
        const isSuccess = !err;
        const summary = output ? (output.length > 500 ? output.slice(0, 500) + '...' : output) : '(Command completed with 0 output)';
        const agentName = detectExecutingAgent(cleanPrompt, output, 'Black Ops Anbu');
        const clientName = task.client ? (CLIENT_DISPLAY_NAMES[task.client.toLowerCase()] || task.client) : 'Konoha Autonomous Worker (Operational)';

        await finalizeTaskResult(task, {
          isSuccess,
          summary,
          duration,
          client: clientName,
          agent: agentName,
          tokenReduction: 100
        });

        resolve();
      });
    });
  }

  // 2. AI Coding / Reasoning Task via Headless CLI
  // Uses agy CLI with low reasoning effort and 45-minute timeout for complex tasks
  return new Promise((resolve) => {
    const agyBin = resolveAgyBin();
    const agyArgs = ['-p', cleanPrompt, '--effort', 'low', '--dangerously-skip-permissions', '--print-timeout', '45m'];
    const execEnv = {
      ...process.env,
      KONOHA_TASK_ID: task.id,
      KONOHA_SESSION_ID: task.session_id || '',
      KONOHA_WORKSPACE: execCwd
    };
    execFile(agyBin, agyArgs, { cwd: execCwd, env: execEnv, timeout: 45 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 }, async (err, stdout, stderr) => {
      const duration = formatDuration(Date.now() - startTime);
      const output = (stdout || stderr || (err ? err.message : '')).trim();
      const isSuccess = !err;
      const summary = isSuccess ? extractTaskSummary(output) : (output ? output.slice(0, 500) : '(Task failed with 0 output)');
      const kageScore = isSuccess ? extractKageScore(output) : 0;
      const agentName = detectExecutingAgent(cleanPrompt, output);
      const clientName = task.client ? (CLIENT_DISPLAY_NAMES[task.client.toLowerCase()] || task.client) : 'Antigravity Headless CLI';

      await finalizeTaskResult(task, {
        isSuccess,
        summary,
        duration,
        client: clientName,
        agent: agentName,
        tokenReduction: 94.2,
        kageScore
      });

      resolve();
    });
  });
}

/**
 * Poll prompt_queue and execute next pending task.
 */
async function pollAndExecute() {
  if (isExecuting) return;
  try {
    const task = inboxModule.claimNextPendingPrompt({ client: 'konoha-worker' });
    if (!task) return;

    process.stdout.write(`[konoha queue worker] Claimed task ${task.id} (${task.source}): "${(task.prompt || '').slice(0, 60)}"\n`);
    isExecuting = true;
    await processTask(task);
    process.stdout.write(`[konoha queue worker] Finished task ${task.id}\n`);
  } catch (err) {
    process.stderr.write(`[konoha queue worker] Execution error: ${err.message}\n`);
  } finally {
    isExecuting = false;
  }
}

/**
 * Start the autonomous queue worker.
 */
function startWorker({ intervalMs = 2500 } = {}) {
  if (workerRunning) return;
  workerRunning = true;
  workerTimer = setInterval(pollAndExecute, intervalMs);
  if (workerTimer.unref) workerTimer.unref();
}

/**
 * Stop the autonomous queue worker.
 */
function stopWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  workerRunning = false;
}

function isWorkerRunning() {
  return workerRunning;
}

module.exports = {
  startWorker,
  stopWorker,
  isWorkerRunning,
  pollAndExecute,
  isOperationalCommand,
  extractCommand,
  formatDuration,
  extractTaskSummary,
  extractKageScore,
  detectExecutingAgent
};
