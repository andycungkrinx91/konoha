"use strict";

/**
 * bin/commands/queue.js — Asynchronous Prompt Queue & Autonomous Worker.
 */

const { C, log, info, error, success, header } = require("../lib/format");


async function cmdQueue(args) {
  const sub = args[0] || 'list';
  const inbox = require('../../src/queue/inbox');

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    info('Usage: konoha queue <command>');
    info('Commands:');
    info('  list                     List recent prompt queue tasks');
    info('  next                     Print next pending prompt for execution');
    info('  run                      Process and execute next pending prompt');
    info('  start-worker             Run autonomous background queue worker');
    info('  complete <id> [summary]  Mark prompt task as completed');
    info('  cancel <id>              Cancel a pending task');
    return;
  }

  if (sub === 'run') {
    const worker = require('../../src/queue/worker');
    await worker.pollAndExecute();
    success('Queue execution tick finished.');
    return;
  }

  if (sub === 'start-worker') {
    const worker = require('../../src/queue/worker');
    worker.startWorker();
    success('Autonomous queue worker started. Press Ctrl+C to exit.');
    return;
  }

  if (sub === 'list') {
    const prompts = inbox.listPrompts({ limit: 20 });
    header('Inbound Prompt Queue');
    if (prompts.length === 0) {
      info('No prompts in queue.');
      return;
    }
    prompts.forEach(p => {
      const statusColor = p.status === 'completed' ? C.green : (p.status === 'pending' ? C.yellow : C.red);
      log(`  ${C.cyan}${p.id}${C.reset} [${statusColor}${p.status.toUpperCase()}${C.reset}] (${p.source}): ${p.prompt.slice(0, 60)}...`);
    });
    return;
  }

  if (sub === 'next') {
    const next = inbox.getNextPendingPrompt();
    if (!next) {
      info('No pending prompts in queue.');
      return;
    }
    log(JSON.stringify(next, null, 2));
    return;
  }

  if (sub === 'complete') {
    const id = args[1];
    if (!id) {
      error('Usage: konoha queue complete <task_id> [result_summary]');
      return;
    }
    const summary = args.slice(2).join(' ') || 'Completed via CLI';
    inbox.completePrompt(id, { status: 'completed', result_summary: summary });
    success(`Task ${id} marked as completed.`);
    return;
  }

  if (sub === 'cancel') {
    const id = args[1];
    if (!id) {
      error('Usage: konoha queue cancel <task_id>');
      return;
    }
    inbox.completePrompt(id, { status: 'cancelled', result_summary: 'Cancelled via CLI' });
    success(`Task ${id} cancelled.`);
    return;
  }

  error(`Unknown queue command: ${sub}. Run "konoha queue help" for usage.`);
}





module.exports = {
  cmdQueue,
};
