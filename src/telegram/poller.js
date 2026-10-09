/**
 * Telegram Inbound Long Poller.
 * Listens for incoming commands and prompts in Two-Way mode with strict Chat ID whitelist validation.
 */

'use strict';

const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const fs = require('fs');
const configModule = require('./config');
const inboxModule = require('../queue/inbox');
const notifierModule = require('./notifier');
const sessionManager = require('./session_manager');

let isRunning = false;
let shouldStop = false;
let currentOffset = 0;
let _pollLoopPromise = null;

function isPollerRunning() {
  return isRunning;
}

/**
 * Safely escape HTML characters for Telegram HTML parse_mode.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sanitize noisy shell preamble and non-critical job control warnings from interactive shell execution.
 */
function sanitizeShellOutput(text) {
  if (!text || typeof text !== 'string') return '';
  const lines = text.split('\n');
  const filtered = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      filtered.push(line);
      continue;
    }
    // Filter out interactive shell job control warnings when run without TTY
    if (/^bash:\s*cannot set terminal process group/i.test(trimmed)) continue;
    if (/^bash:\s*no job control in this shell/i.test(trimmed)) continue;
    if (/^zsh:\s*can't set tty pgrp/i.test(trimmed)) continue;
    if (/^zsh:\s*no job control/i.test(trimmed)) continue;
    // Filter out nvm / node startup announcement
    if (/^Now using node v\d+/i.test(trimmed)) continue;
    filtered.push(line);
  }
  return filtered.join('\n').trim();
}

/**
 * Identify dangerous or destructive commands to prevent system harm via Telegram /sh.
 */
function isDangerousCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  const lower = cmd.toLowerCase().trim();
  if (/rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/|\/\*|~|\.|\.\.)(\s|$)/i.test(lower)) return true;
  if (/rm\s+-[a-z]*r\s+(\/|\/\*|~|\.|\.\.)(\s|$)/i.test(lower)) return true;
  if (/mkfs(\.[a-z0-9]+)?\s+/i.test(lower)) return true;
  if (/dd\s+.*of=\/dev\/(sd[a-z]|nvme|hd[a-z]|null|zero)/i.test(lower)) return true;
  if (/>\s*\/dev\/(sd[a-z]|nvme|hd[a-z])/i.test(lower)) return true;
  if (/\b(drop\s+database|truncate\s+table|drop\s+table)\b/i.test(lower)) return true;
  if (/:(\s*)\(\s*\)\s*\{/i.test(lower)) return true;
  if (/chmod\s+(-[a-z]*r\s+)?777\s+(\/|~)/i.test(lower)) return true;
  if (/curl\s+.*\|\s*(bash|sh|sudo)/i.test(lower)) return true;
  if (/wget\s+.*\|\s*(bash|sh|sudo)/i.test(lower)) return true;
  const patterns = ['rm -rf /', 'rm -rf ~', 'rm -rf *', 'rm -rf .', 'mkfs', 'dd if=', 'drop database', 'truncate table'];
  return patterns.some(p => lower.includes(p));
}

/**
 * Handle an incoming authorized message.
 */
async function handleMessage(msg) {
  if (!msg || !msg.text) return;

  const cfg = configModule.getTelegramConfig();
  const allowedChatId = String(cfg.chat_id || '').trim();
  const incomingChatId = String(msg.chat?.id || '').trim();
  if (!allowedChatId || incomingChatId !== allowedChatId) {
    return;
  }

  const rawText = msg.text.trim();
  const chatId = msg.chat.id;

  if (rawText.startsWith('/help') || rawText.startsWith('/start')) {
    const helpText = [
      '<b>🏯 [KONOHA TELEGRAM BOT ACTIVE]</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Welcome to Konoha Village Remote Ingress.',
      '',
      '<b>📋 Commands:</b>',
      '• <b>/session [number]</b> - View or switch target client session (or /session create &lt;client&gt; &lt;path&gt;)',
      '• <b>/run &lt;task&gt;</b>      - Queue coding task for autonomous execution',
      '• <b>/sh &lt;cmd&gt;</b>        - Execute shell command in target workspace',
      '• <b>/status</b>          - View workspace status and pending tasks',
      '• <b>/savings</b>         - View token reduction telemetry',
      '• <b>/cancel</b>          - Cancel pending queued task',
      '• <b>/help</b>            - Show this command reference',
      '',
      '<b>🥷 Subagent Direct Dispatch:</b>',
      '• <b>/kage &lt;prompt&gt;</b>    - Village Leader (Architecture & security audit)',
      '• <b>/anbu &lt;prompt&gt;</b>    - Black Ops (Backend, DevOps, bug fixing)',
      '• <b>/jonin &lt;prompt&gt;</b>   - Elite Builder (UI/UX, frontend components)',
      '• <b>/genin &lt;prompt&gt;</b>   - Scout (Codebase exploration & analysis)',
      '• <b>/chunin &lt;prompt&gt;</b>  - Intel Ninja (Web research & docs synthesis)',
      '• <b>/tokubetsu_jonin &lt;prompt&gt;</b> - Scribe (Tech docs, specs & reports)',
      '• <b>/sannin &lt;prompt&gt;</b>  - Master Orchestrator (Triage & planning)',
      '',
      '<i>You can also send any plain message directly to queue it as a prompt.</i>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n');
    await notifierModule.sendTelegramMessage(helpText, { force: true, chat_id: chatId, parse_mode: 'HTML' });
    return;
  }

  if (rawText.startsWith('/session')) {
    const arg = rawText.replace(/^\/session(?:@\w+)?\s*/i, '').trim();
    if (!arg || arg === 'list' || arg === 'ls') {
      const listText = sessionManager.formatSessionList(chatId);
      await notifierModule.sendTelegramMessage(listText, { force: true, chat_id: chatId, parse_mode: 'HTML' });
      return;
    }

    const isCreate = /^create\b/i.test(arg);
    const isAdd = /^add\b/i.test(arg);
    if (isCreate || isAdd) {
      const sub = arg.replace(/^(create|add)\s*/i, '').trim();
      if (!sub) {
        const helpMsg = [
          '<b>⚠️ [MISSING ARGUMENTS]</b>',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          '<b>Usage:</b> <code>/session create &lt;client&gt; &lt;path&gt;</code>',
          '<b>Clients:</b> <code>agy, antigravity, claude, codex, pi, opencode, commandcode</code>',
          '<b>Example:</b> <code>/session create agy /home/user/myproject</code>',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        ].join('\n');
        await notifierModule.sendTelegramMessage(helpMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
        return;
      }

      const match = sub.match(/^([^\s]+)\s+(.+)$/);
      if (!match) {
        const helpMsg = [
          '<b>⚠️ [MISSING WORKSPACE PATH]</b>',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          `<b>Message:</b> Client "${sub}" specified, but workspace directory path is missing.`,
          '<b>Usage:</b> <code>/session create &lt;client&gt; &lt;path&gt;</code>',
          '<b>Clients:</b> <code>agy, antigravity, claude, codex, pi, opencode, commandcode</code>',
          '<b>Example:</b> <code>/session create agy /home/user/myproject</code>',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        ].join('\n');
        await notifierModule.sendTelegramMessage(helpMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
        return;
      }

      const clientArg = match[1].trim();
      const pathArg = match[2].trim();
      const createRes = sessionManager.createSession(chatId, clientArg, pathArg);
      if (createRes.success) {
        const sess = createRes.session;
        const clientName = sessionManager.CLIENT_DISPLAY_NAMES[sess.client.toLowerCase()] || sess.client;
        const confirmMsg = [
          '<b>🎛️ [SESSION CREATED & TARGETED]</b>',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          `<b>💻 Target Client:</b> ${clientName}`,
          `<b>📂 Workspace Root:</b> <code>${sess.workspace_root}</code>`,
          `<b>🔖 Session ID:</b> <code>${sess.session_id}</code>`,
          `<b>🔢 Session Index:</b> <code>#${createRes.index}</code> (of ${createRes.totalSessions})`,
          '<b>⚡ Status:</b> Active for all subsequent /run and /sh commands',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        ].join('\n');
        await notifierModule.sendTelegramMessage(confirmMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
      } else {
        const errReply = [
          '<b>⚠️ [SESSION CREATION ERROR]</b>',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          `<b>Message:</b> ${createRes.error}`,
          '<b>Usage:</b> <code>/session create &lt;client&gt; &lt;path&gt;</code>',
          '<b>Clients:</b> <code>agy, antigravity, claude, codex, pi, opencode, commandcode</code>',
          '<b>Example:</b> <code>/session create agy /home/user/myproject</code>',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        ].join('\n');
        await notifierModule.sendTelegramMessage(errReply, { force: true, chat_id: chatId, parse_mode: 'HTML' });
      }
      return;
    }

    const setRes = sessionManager.setTargetSession(chatId, arg);
    if (setRes.success) {
      const sess = setRes.session;
      const clientName = sessionManager.CLIENT_DISPLAY_NAMES[sess.client.toLowerCase()] || sess.client;
      const confirmMsg = [
        '<b>🎛️ [TARGET SESSION UPDATED]</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `<b>💻 Target Client:</b> ${clientName}`,
        `<b>📂 Workspace Root:</b> <code>${sess.workspace_root}</code>`,
        `<b>🔖 Session ID:</b> <code>${sess.session_id}</code>`,
        '<b>⚡ Status:</b> Active for all subsequent /run and /sh commands',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n');
      await notifierModule.sendTelegramMessage(confirmMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
    } else {
      const errReply = [
        '<b>⚠️ [INVALID SESSION NUMBER]</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `<b>Message:</b> ${setRes.error}`,
        '<b>Usage:</b> <code>/session &lt;number&gt;</code>',
        '<b>Example:</b> <code>/session 1</code> or <code>/session 2</code>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n');
      await notifierModule.sendTelegramMessage(errReply, { force: true, chat_id: chatId, parse_mode: 'HTML' });
    }
    return;
  }

  if (/^\/(sh|exec)(\s+.*|@\S+.*)?$/i.test(rawText)) {
    const cmd = rawText.replace(/^\/(sh|exec)(@[^\s]+)?\s*/i, '').trim();
    if (!cmd) {
      const errMsg = [
        '<b>⚠️ [ERROR] Empty Command</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '<b>Message:</b> Empty command received.',
        '<b>Usage:</b> <code>/sh &lt;command&gt;</code>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n');
      await notifierModule.sendTelegramMessage(errMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
      return;
    }
    if (isDangerousCommand(cmd)) {
      const blockedMsg = [
        '<b>🛡️ [BLOCKED] Security Guardrail</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '<b>Status:</b> BLOCKED',
        '<b>Reason:</b> Dangerous command blocked by security guardrails.',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n');
      await notifierModule.sendTelegramMessage(blockedMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
      return;
    }

    const { execFile } = require('child_process');
    const targetSession = sessionManager.getTargetSession(chatId);
    const execCwd = (targetSession.workspace_root && fs.existsSync(targetSession.workspace_root))
      ? targetSession.workspace_root
      : process.cwd();
    const clientName = sessionManager.CLIENT_DISPLAY_NAMES[targetSession.client.toLowerCase()] || targetSession.client;

    const userShell = (process.env.SHELL && fs.existsSync(process.env.SHELL))
      ? process.env.SHELL
      : (fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh');

    await notifierModule.sendTelegramMessage(`⚙️ Executing in <code>${execCwd}</code> (${clientName}):\n<code>${escapeHtml(cmd)}</code>`, { force: true, chat_id: chatId, parse_mode: 'HTML' });
    execFile(userShell, ['-i', '-c', cmd], { cwd: execCwd, timeout: 600000, maxBuffer: 1024 * 1024, env: { ...process.env, SHELL: userShell } }, async (err, stdout, stderr) => {
      const cleanStdout = sanitizeShellOutput(stdout);
      const cleanStderr = sanitizeShellOutput(stderr);
      const combined = [cleanStdout, cleanStderr].filter(Boolean).join('\n').trim();
      const output = combined || (err ? err.message : '');
      const statusIcon = err ? '❌ [FAILED]' : '✅ [SUCCESS]';
      const cleanOut = output ? (output.length > 3500 ? output.slice(0, 3500) + '\n...[truncated]' : output) : '(Command completed with 0 output)';
      const formattedOut = cleanOut === '(Command completed with 0 output)'
        ? '<i>(Command completed with 0 output)</i>'
        : `<pre>${escapeHtml(cleanOut)}</pre>`;
      const reply = [
        `<b>🏯 ${statusIcon}</b>`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `<b>📂 Workspace:</b> <code>${execCwd}</code>`,
        formattedOut,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n');
      await notifierModule.sendTelegramMessage(reply, { force: true, chat_id: chatId, parse_mode: 'HTML' });
    });
    return;
  }

  if (rawText.startsWith('/status')) {
    const recent = inboxModule.listPrompts({ limit: 5 });
    if (recent.length === 0) {
      const idleMsg = [
        '<b>Status Recent Task</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '<b>Workspace Status:</b> IDLE',
        'No active or queued tasks.',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n');
      await notifierModule.sendTelegramMessage(idleMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
      return;
    }
    const lines = [
      '<b>Status Recent Task</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ];
    recent.forEach((p, idx) => {
      let displayStatus = (p.status || 'pending').toLowerCase();
      if (displayStatus === 'processing') {
        displayStatus = 'running';
      }
      lines.push(`<b>${idx + 1}. Task ID:</b> <code>${p.id}</code>`);
      lines.push(`   <b>Status:</b> ${displayStatus}`);
      lines.push(`   <b>Source:</b> ${p.source}`);
      lines.push(`   <b>Prompt:</b> ${p.prompt.length > 60 ? p.prompt.slice(0, 60) + '...' : p.prompt}`);
      if (p.result_summary) {
        lines.push(`   <b>Result:</b> ${p.result_summary.length > 80 ? p.result_summary.slice(0, 80) + '...' : p.result_summary}`);
      }
      lines.push('────────────────────────────');
    });
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    await notifierModule.sendTelegramMessage(lines.join('\n'), { force: true, chat_id: chatId, parse_mode: 'HTML' });
    return;
  }

  if (rawText.startsWith('/savings')) {
    const text = [
      '<b>💎 [TOKEN TELEMETRY BENCHMARK]</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '<b>Target Reduction:</b> 83% - 98% Saved',
      '<b>Status:</b> Active across all coding agents',
      '<b>Telemetry Engine:</b> Bounded file tools & SQLite FTS5 index active',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n');
    await notifierModule.sendTelegramMessage(text, { force: true, chat_id: chatId, parse_mode: 'HTML' });
    return;
  }

  if (rawText.startsWith('/cancel')) {
    const pending = inboxModule.getNextPendingPrompt();
    if (pending) {
      inboxModule.completePrompt(pending.id, { status: 'cancelled', result_summary: 'Cancelled from Telegram' });
      const cancelMsg = [
        `<b>🚫 [CANCELLED] Task ${pending.id}</b>`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `<b>🔖 Task ID:</b> <code>${pending.id}</code>`,
        '<b>📊 Status:</b> cancelled',
        '<b>⚡ Detail:</b> Task cancelled from Telegram',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n');
      await notifierModule.sendTelegramMessage(cancelMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
    } else {
      const noCancelMsg = [
        '<b>🚫 [CANCEL] Notice</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '<b>Notice:</b> No pending task found in queue to cancel.',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n');
      await notifierModule.sendTelegramMessage(noCancelMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
    }
    return;
  }

  // Subagent Direct Dispatch: /kage, /anbu, /jonin, /genin, /chunin, /tokubetsu_jonin, /sannin
  const AGENT_SUBCOMMANDS = {
    kage: { name: 'Village Leader Kage', defaultPrompt: 'Execute Kage architecture and security risk assessment review on current workspace', icon: '🛡️' },
    anbu: { name: 'Black Ops Anbu', defaultPrompt: 'Execute Anbu backend development, bug fixing, and infrastructure hardening', icon: '♠️' },
    jonin: { name: 'Elite Builder Jonin', defaultPrompt: 'Execute Jonin UI/UX design matching and component development', icon: '♦️' },
    genin: { name: 'Scout Genin', defaultPrompt: 'Execute Genin codebase exploration, symbol search, and dependency analysis', icon: '⚑' },
    chunin: { name: 'Intel Ninja Chunin', defaultPrompt: 'Execute Chunin web research, documentation lookup, and synthesis', icon: '▫️' },
    'tokubetsu-jonin': { name: 'Scribe Tokubetsu Jonin', defaultPrompt: 'Execute Tokubetsu Jonin technical documentation and report generation', icon: '⬡' },
    sannin: { name: 'Master Orchestrator Sannin', defaultPrompt: 'Execute Sannin task triage and multi-agent workflow orchestration', icon: '✧' }
  };

  const agentMatch = rawText.match(/^\/(kage|anbu|jonin|genin|chunin|tokubetsu[-_]jonin|sannin)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (agentMatch) {
    const rawAgentKey = agentMatch[1].toLowerCase().replace('_', '-');
    const agentInfo = AGENT_SUBCOMMANDS[rawAgentKey];
    const userPrompt = (agentMatch[2] || '').trim();
    const finalPrompt = userPrompt || agentInfo.defaultPrompt;
    const targetSession = sessionManager.getTargetSession(chatId);

    const task = inboxModule.enqueuePrompt({
      prompt: `/${rawAgentKey} ${finalPrompt}`,
      source: 'telegram',
      sender_info: msg.from?.username || String(chatId),
      session_id: targetSession.session_id,
      workspace_root: targetSession.workspace_root,
      client: targetSession.client
    });

    const clientDisplay = sessionManager.CLIENT_DISPLAY_NAMES[targetSession.client.toLowerCase()] || targetSession.client;
    const reply = [
      `<b>${agentInfo.icon} [QUEUED #${task.id}] Task Dispatched to ${agentInfo.name}</b>`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `<b>🔖 Task ID:</b> <code>${task.id}</code>`,
      `<b>📋 Prompt:</b> ${finalPrompt.length > 100 ? finalPrompt.slice(0, 100) + '...' : finalPrompt}`,
      `<b>💻 Target Client:</b> ${clientDisplay}`,
      `<b>📂 Workspace:</b> <code>${targetSession.workspace_root}</code>`,
      '<b>📊 Status:</b> pending',
      `<b>⚡ Routing:</b> Direct dispatch to ${agentInfo.name}`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n');
    await notifierModule.sendTelegramMessage(reply, { force: true, chat_id: chatId, parse_mode: 'HTML' });
    return;
  }

  // Handle /run <prompt> or plain text prompt
  let promptText = rawText;
  if (promptText.startsWith('/run ')) {
    promptText = promptText.slice(5).trim();
  } else if (promptText.startsWith('/run@')) {
    promptText = promptText.replace(/^\/run@[^\s]+\s*/, '').trim();
  } else if (promptText === '/run' || promptText.startsWith('/run@')) {
    promptText = '';
  }

  if (!promptText) {
    const emptyErr = [
      '<b>⚠️ [ERROR] Empty prompt received</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '<b>Message:</b> Empty prompt received.',
      '<b>Usage:</b> <code>/run &lt;task description&gt;</code>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n');
    await notifierModule.sendTelegramMessage(emptyErr, { force: true, chat_id: chatId, parse_mode: 'HTML' });
    return;
  }

  const targetSession = sessionManager.getTargetSession(chatId);
  const task = inboxModule.enqueuePrompt({
    prompt: promptText,
    source: 'telegram',
    sender_info: msg.from?.username || String(chatId),
    session_id: targetSession.session_id,
    workspace_root: targetSession.workspace_root,
    client: targetSession.client
  });

  const clientDisplay = sessionManager.CLIENT_DISPLAY_NAMES[targetSession.client.toLowerCase()] || targetSession.client;
  const reply = [
    `<b>⏳ [QUEUED #${task.id}] Task Accepted</b>`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `<b>🔖 Task ID:</b> <code>${task.id}</code>`,
    `<b>📋 Prompt:</b> ${promptText.length > 100 ? promptText.slice(0, 100) + '...' : promptText}`,
    `<b>💻 Target Client:</b> ${clientDisplay}`,
    `<b>📂 Workspace:</b> <code>${targetSession.workspace_root}</code>`,
    '<b>📊 Status:</b> pending',
    '<b>⚡ Queue:</b> Dispatched to Autonomous Worker',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');

  await notifierModule.sendTelegramMessage(reply, { force: true, chat_id: chatId, parse_mode: 'HTML' });
}

/**
 * Execute a single poll request.
 */
async function pollOnce(token, timeout = 30) {
  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${currentOffset}&timeout=${timeout}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout((timeout + 15) * 1000)
    });
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.result)) {
      if (data && !data.ok) {
        process.stderr.write(`[telegram poller] getUpdates API error: ${data.description || 'Unknown error'}\n`);
      }
      return [];
    }
    return data.result;
  } catch (err) {
    if (err.name !== 'TimeoutError' && !err.message.includes('aborted')) {
      process.stderr.write(`[telegram poller] Polling fetch error: ${err.message}\n`);
    }
    return [];
  }
}

/**
 * Start the polling loop.
 */
function startPoller() {
  if (isRunning) return;
  const config = configModule.getTelegramConfig();

  if (!config.enabled || config.mode !== 'two_way' || !config.bot_token) {
    return;
  }

  isRunning = true;
  shouldStop = false;

  _pollLoopPromise = (async () => {
    while (!shouldStop) {
      const cfg = configModule.getTelegramConfig();
      if (!cfg.enabled || cfg.mode !== 'two_way' || !cfg.bot_token) {
        break;
      }

      const updates = await pollOnce(cfg.bot_token, 15);
      for (const update of updates) {
        if (update.update_id >= currentOffset) {
          currentOffset = update.update_id + 1;
        }

        const msg = update.message;
        if (!msg) continue;

        // Enforce strict chat_id whitelist with non-empty validation
        const allowedChatId = String(cfg.chat_id || '').trim();
        if (!allowedChatId || String(msg.chat.id).trim() !== allowedChatId) {
          process.stderr.write(`[telegram poller] Dropped message from unauthorized chat ID: ${msg.chat?.id}\n`);
          continue;
        }

        try {
          process.stdout.write(`[telegram poller] Processing message #${update.update_id} from @${msg.from?.username || msg.chat.id}: "${(msg.text || '').slice(0, 60)}"\n`);
          await handleMessage(msg);
        } catch (handleErr) {
          process.stderr.write(`[telegram poller] Message handling error: ${handleErr.message}\n`);
        }
      }

      if (shouldStop) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    isRunning = false;
  })();
}

/**
 * Stop polling loop.
 */
function stopPoller() {
  shouldStop = true;
  isRunning = false;
}

module.exports = {
  isPollerRunning,
  startPoller,
  stopPoller,
  pollOnce,
  handleMessage
};
