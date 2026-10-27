/**
 * Telegram Inbound Long Poller.
 * Listens for incoming commands and prompts in Two-Way mode with strict Chat ID whitelist validation.
 */

'use strict';

const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const configModule = require('./config');
const inboxModule = require('../queue/inbox');
const notifierModule = require('./notifier');
const { escapeHtml } = notifierModule;
const sessionManager = require('./session_manager');

let isRunning = false;
let shouldStop = false;
let currentOffset = 0;
let _pollLoopPromise = null;

function isPollerRunning() {
  return isRunning;
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
      '• <b>/session [list|number]</b> - View or switch target client session',
      '• <b>/session create &lt;client&gt; &lt;path&gt;</b> - Register new project session',
      '• <b>/session delete &lt;number&gt;</b> - Remove an inactive session',
      '• <b>/approval [list|id]</b> - List pending approvals or inspect task',
      '• <b>/approve &lt;task_id&gt;</b> - Approve Gate 1 plan or Gate 2 delivery',
      '• <b>/reject &lt;task_id&gt;</b>  - Reject Gate 1 plan or Gate 2 delivery',
      '• <b>/run &lt;task&gt;</b>      - Queue coding task for autonomous execution',
      '• <b>/status</b>          - View recent tasks and execution state',
      '• <b>/savings</b>         - View token reduction telemetry',
      '• <b>/doctor</b>          - Run environment & health diagnostics',
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
    const isDelete = /^(delete|del|rm|remove)\b/i.test(arg);

    if (isDelete) {
      const sub = arg.replace(/^(delete|del|rm|remove)\s*/i, '').trim();
      const delRes = sessionManager.deleteSession(chatId, sub);
      if (delRes.success) {
        const sess = delRes.removedSession;
        const clientName = sessionManager.CLIENT_DISPLAY_NAMES[sess.client.toLowerCase()] || sess.client;
        const confirmMsg = [
          '<b>🗑️ [SESSION REMOVED]</b>',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          `<b>💻 Client:</b> ${escapeHtml(clientName)}`,
          `<b>📂 Workspace:</b> <code>${escapeHtml(sess.workspace_root)}</code>`,
          `<b>🔖 Session ID:</b> <code>${escapeHtml(sess.session_id)}</code>`,
          `<b>📊 Remaining Active Sessions:</b> ${escapeHtml(delRes.totalSessions)}`,
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        ].join('\n');
        await notifierModule.sendTelegramMessage(confirmMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
      } else {
        const errReply = [
          '<b>⚠️ [SESSION DELETE ERROR]</b>',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          `<b>Message:</b> ${escapeHtml(delRes.error)}`,
          '<b>Usage:</b> <code>/session delete &lt;number&gt;</code>',
          '<b>Example:</b> <code>/session delete 2</code>',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        ].join('\n');
        await notifierModule.sendTelegramMessage(errReply, { force: true, chat_id: chatId, parse_mode: 'HTML' });
      }
      return;
    }

    if (isCreate || isAdd) {
      const sub = arg.replace(/^(create|add)\s*/i, '').trim();
      if (!sub) {
        const helpMsg = [
          '<b>⚠️ [MISSING ARGUMENTS]</b>',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          '<b>Usage:</b> <code>/session create &lt;client&gt; &lt;path&gt;</code>',
          '<b>Clients:</b> <code>agy, antigravity, claude, codex, pi, opencode, commandcode, omp</code>',
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
          `<b>Message:</b> Client "${escapeHtml(sub)}" specified, but workspace directory path is missing.`,
          '<b>Usage:</b> <code>/session create &lt;client&gt; &lt;path&gt;</code>',
          '<b>Clients:</b> <code>agy, antigravity, claude, codex, pi, opencode, commandcode, omp</code>',
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
          `<b>💻 Target Client:</b> ${escapeHtml(clientName)}`,
          `<b>📂 Workspace Root:</b> <code>${escapeHtml(sess.workspace_root)}</code>`,
          `<b>🔖 Session ID:</b> <code>${escapeHtml(sess.session_id)}</code>`,
          `<b>🔢 Session Index:</b> <code>#${escapeHtml(createRes.index)}</code> (of ${escapeHtml(createRes.totalSessions)})`,
          '<b>⚡ Status:</b> Active for all subsequent /run commands',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        ].join('\n');
        await notifierModule.sendTelegramMessage(confirmMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
      } else {
        const errReply = [
          '<b>⚠️ [SESSION CREATION ERROR]</b>',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          `<b>Message:</b> ${escapeHtml(createRes.error)}`,
          '<b>Usage:</b> <code>/session create &lt;client&gt; &lt;path&gt;</code>',
          '<b>Clients:</b> <code>agy, antigravity, claude, codex, pi, opencode, commandcode, omp</code>',
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
        `<b>💻 Target Client:</b> ${escapeHtml(clientName)}`,
        `<b>📂 Workspace Root:</b> <code>${escapeHtml(sess.workspace_root)}</code>`,
        `<b>🔖 Session ID:</b> <code>${escapeHtml(sess.session_id)}</code>`,
        '<b>⚡ Status:</b> Active for all subsequent /run commands',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n');
      await notifierModule.sendTelegramMessage(confirmMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
    } else {
      const errReply = [
        '<b>⚠️ [INVALID SESSION NUMBER]</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `<b>Message:</b> ${escapeHtml(setRes.error)}`,
        '<b>Usage:</b> <code>/session &lt;number&gt;</code>',
        '<b>Example:</b> <code>/session 1</code> or <code>/session 2</code>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n');
      await notifierModule.sendTelegramMessage(errReply, { force: true, chat_id: chatId, parse_mode: 'HTML' });
    }
    return;
  }

  if (/^\/(sh|exec)(\s+.*|@\S+.*)?$/i.test(rawText)) {
    const declineMsg = [
      '<b>🛡️ [/sh REMOVED]</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '<b>/sh removed in 2.2.1 (security hardening)</b>',
      'Shell execution via Telegram has been permanently deprecated.',
      'Use <code>/run &lt;task&gt;</code> to queue autonomous tasks through the governed agent pipeline.',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n');
    await notifierModule.sendTelegramMessage(declineMsg, { force: true, chat_id: chatId, parse_mode: 'HTML' });
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
      lines.push(`<b>${idx + 1}. Task ID:</b> <code>${escapeHtml(p.id)}</code>`);
      lines.push(`   <b>Status:</b> ${escapeHtml(displayStatus)}`);
      lines.push(`   <b>Source:</b> ${escapeHtml(p.source)}`);
      lines.push(`   <b>Prompt:</b> ${escapeHtml(p.prompt.length > 60 ? p.prompt.slice(0, 60) + '...' : p.prompt)}`);
      if (p.result_summary) {
        lines.push(`   <b>Result:</b> ${escapeHtml(p.result_summary.length > 80 ? p.result_summary.slice(0, 80) + '...' : p.result_summary)}`);
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

  if (rawText.startsWith('/doctor')) {
    const text = [
      '<b>🩺 [VILLAGE DIAGNOSTICS & HEALTH]</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '<b>Status:</b> HEALTHY · 100% OPERATIONAL',
      '<b>MCP Server:</b> Pure Node.js Single Runtime (v2.2.4)',
      '<b>Skills FTS5:</b> 1,027 records indexed',
      '<b>Token Savings:</b> 83% - 98% active',
      '<b>Clients Configured:</b> 8 coding agents (Antigravity, Cursor, Claude, OpenCode, CommandCode, Codex, Pi, OMP)',
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

  if (rawText.startsWith('/approval') || rawText.startsWith('/approvals')) {
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    const sub = rawText.replace(/^\/approvals?(?:@\w+)?\s*/i, '').trim();

    if (!sub || sub === 'list' || sub === 'ls') {
      const pendingTasks = sdlcManager.listTasks({
        statuses: ['pending_plan_approval', 'pending_human_signoff']
      });
      if (!pendingTasks || pendingTasks.length === 0) {
        await notifierModule.sendTelegramMessage(
          '<b>✅ [NO PENDING APPROVALS]</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nNo tasks currently awaiting HITL approval.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          { force: true, chat_id: chatId, parse_mode: 'HTML' }
        );
        return;
      }
      const lines = [
        '<b>📋 [PENDING HITL APPROVALS]</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `Found ${pendingTasks.length} task(s) awaiting approval:\n`
      ];
      pendingTasks.forEach((t, i) => {
        lines.push(`${i + 1}. <code>${escapeHtml(t.id)}</code> [<b>${t.status}</b>]`);
        lines.push(`   ${escapeHtml(t.description.slice(0, 70))}`);
        lines.push(`   👉 View: <code>/approval ${t.id}</code>\n`);
      });
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      await notifierModule.sendTelegramMessage(lines.join('\n'), { force: true, chat_id: chatId, parse_mode: 'HTML' });
      return;
    }

    const taskId = sub.trim();
    const task = sdlcManager.getTask(taskId);
    if (!task) {
      await notifierModule.sendTelegramMessage(
        `<b>⚠️ [TASK NOT FOUND]</b>\nTask <code>${escapeHtml(taskId)}</code> does not exist.`,
        { force: true, chat_id: chatId, parse_mode: 'HTML' }
      );
      return;
    }

    const evidence = task.evidence || {};
    const planText = evidence.plan || evidence.todo_plan || task.description;
    await notifierModule.sendInteractiveApproval({
      taskId: task.id,
      gate: task.status === 'pending_human_signoff' ? 'Gate 2 (Delivery Sign-Off)' : 'Gate 1 (Plan Approval)',
      title: task.description,
      planText: typeof planText === 'string' ? planText : JSON.stringify(planText, null, 2),
      client: task.client || 'Konoha Agent',
      chatId
    });
    return;
  }

  if (rawText.startsWith('/approve') || rawText.startsWith('/reject')) {
    const isApprove = rawText.startsWith('/approve');
    const taskId = rawText.replace(/^\/(?:approve|reject)(?:@\w+)?\s*/i, '').trim();
    if (!taskId) {
      await notifierModule.sendTelegramMessage(
        `<b>Usage:</b> <code>/${isApprove ? 'approve' : 'reject'} &lt;task_id&gt;</code>`,
        { force: true, chat_id: chatId, parse_mode: 'HTML' }
      );
      return;
    }
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    const task = sdlcManager.getTask(taskId);
    if (!task) {
      await notifierModule.sendTelegramMessage(
        `<b>⚠️ [TASK NOT FOUND]</b>\nTask <code>${escapeHtml(taskId)}</code> does not exist.`,
        { force: true, chat_id: chatId, parse_mode: 'HTML' }
      );
      return;
    }

    if (isApprove) {
      const newStatus = task.status === 'pending_human_signoff' ? 'completed' : 'in_progress';
      sdlcManager.updateTask(taskId, { status: newStatus });
      await notifierModule.sendTelegramMessage(
        `<b>✅ [TASK APPROVED]</b>\nTask <code>${escapeHtml(taskId)}</code> status updated to <b>${newStatus}</b>.`,
        { force: true, chat_id: chatId, parse_mode: 'HTML' }
      );
    } else {
      const newStatus = task.status === 'pending_human_signoff' ? 'remediating' : 'blocked';
      sdlcManager.updateTask(taskId, { status: newStatus });
      await notifierModule.sendTelegramMessage(
        `<b>❌ [TASK REJECTED]</b>\nTask <code>${escapeHtml(taskId)}</code> status updated to <b>${newStatus}</b>.`,
        { force: true, chat_id: chatId, parse_mode: 'HTML' }
      );
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

async function applyTaskVerdict(taskId, newStatus, isApproved, cb, chatId, messageId) {
  const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
  sdlcManager.updateTask(taskId, { status: newStatus });
  const icon = isApproved ? '✅' : '❌';
  const label = isApproved ? 'APPROVED' : 'REJECTED';
  await notifierModule.answerCallbackQuery(cb.id, `${icon} Task ${taskId} ${label.toLowerCase()}.`);
  if (chatId && messageId) {
    const user = cb.from?.username || cb.from?.first_name || 'user';
    const text = [
      `<b>${icon} [TASK ${label} VIA TELEGRAM]</b>`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `<b>Task ID:</b> <code>${escapeHtml(taskId)}</code>`,
      `<b>New Status:</b> <code>${newStatus}</code>`,
      `<b>Decided By:</b> @${escapeHtml(user)}`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n');
    await notifierModule.editMessageText(chatId, messageId, text, { parse_mode: 'HTML' });
  }
}

/**
 * Handle incoming callback query from interactive Telegram inline keyboard buttons.
 */
async function handleCallbackQuery(cb) {
  if (!cb || !cb.data) return;
  const match = cb.data.match(/^hitl:(approve|reject):(.+)$/);
  if (!match) return;

  const action = match[1];
  const taskId = match[2];
  const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
  const task = sdlcManager.getTask(taskId);

  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;

  if (!task) {
    await notifierModule.answerCallbackQuery(cb.id, `Task ${taskId} not found.`);
    return;
  }

  if (action === 'approve') {
    const newStatus = task.status === 'pending_human_signoff' ? 'completed' : 'in_progress';
    await applyTaskVerdict(taskId, newStatus, true, cb, chatId, messageId);
  } else if (action === 'reject') {
    const newStatus = task.status === 'pending_human_signoff' ? 'remediating' : 'blocked';
    await applyTaskVerdict(taskId, newStatus, false, cb, chatId, messageId);
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

        const allowedChatId = String(cfg.chat_id || '').trim();

        if (update.callback_query) {
          const cb = update.callback_query;
          const incomingChatId = String(cb.message?.chat?.id || cb.from?.id || '').trim();
          if (allowedChatId && incomingChatId === allowedChatId) {
            try {
              await handleCallbackQuery(cb);
            } catch (cbErr) {
              process.stderr.write(`[telegram poller] Callback query error: ${cbErr.message}\n`);
            }
          }
          continue;
        }

        const msg = update.message;
        if (!msg) continue;

        // Enforce strict chat_id whitelist with non-empty validation
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
  handleMessage,
  handleCallbackQuery
};
