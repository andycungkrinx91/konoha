"use strict";

/**
 * bin/commands/telegram.js — Telegram Bot Remote Notifications & Two-Way Polling.
 */

const { info, error, success, header } = require("../lib/format");


async function cmdTelegram(args) {
  const sub = args[0] || 'status';
  const subArgs = args.slice(1);
  const tgConfig = require('../../src/telegram/config');
  const tgNotifier = require('../../src/telegram/notifier');
  const tgPoller = require('../../src/telegram/poller');

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    info('Usage: konoha telegram <command>');
    info('Commands:');
    info('  status                   Show current Telegram integration status');
    info('  config [options]         Configure bot token, chat ID, and mode');
    info('    --token <bot_token>    Set Telegram Bot API token');
    info('    --chat-id <id>         Set authorized recipient chat ID');
    info('    --mode <one_way|two_way> Set operating mode (one_way or two_way)');
    info('  test                     Send an immediate verification test message');
    info('  enable                   Enable Telegram notifications');
    info('  disable                  Disable Telegram notifications');
    info('  start-poller             Start Two-Way inbound polling listener');
    info('  stop-poller              Stop inbound polling listener');
    return;
  }

  if (sub === 'status') {
    const cfg = tgConfig.getTelegramConfig();
    header('Telegram Bot Integration Status');
    info(`Enabled:       ${cfg.enabled ? 'Yes [ACTIVE]' : 'No [DISABLED]'}`);
    info(`Mode:          ${cfg.mode === 'two_way' ? 'Two-Way (Alerts + Inbound Prompting)' : 'One-Way (Alerts Only)'}`);
    info(`Transport:     ${cfg.transport}`);
    info(`Bot Token:     ${cfg.bot_token ? `${cfg.bot_token.slice(0, 10)}...` : '(not configured)'}`);
    info(`Chat ID:       ${cfg.chat_id || '(not configured)'}`);
    info(`Poller:        ${tgPoller.isPollerRunning() ? 'Running' : 'Stopped'}`);
    info(`Last Notified: ${cfg.last_notified_at || 'Never'}`);
    return;
  }

  if (sub === 'edit') {
    error("Unknown subcommand 'edit' for 'konoha telegram'. Use canonical subcommand 'konoha telegram config'.");
    process.exit(1);
  }

  if (sub === 'config') {
    let token = undefined;
    let chatId = undefined;
    let mode = undefined;
    let transport = undefined;
    let enableFlag = undefined;

    for (let i = 0; i < subArgs.length; i++) {
      if ((subArgs[i] === '--token' || subArgs[i] === '-t') && subArgs[i + 1]) {
        token = subArgs[++i];
      } else if ((subArgs[i] === '--chat-id' || subArgs[i] === '-c') && subArgs[i + 1]) {
        chatId = subArgs[++i];
      } else if ((subArgs[i] === '--mode' || subArgs[i] === '-m') && subArgs[i + 1]) {
        mode = subArgs[++i];
      } else if (subArgs[i] === '--transport' && subArgs[i + 1]) {
        transport = subArgs[++i];
      } else if (subArgs[i] === '--enable') {
        enableFlag = true;
      } else if (subArgs[i] === '--disable') {
        enableFlag = false;
      }
    }

    const updated = tgConfig.saveTelegramConfig({
      bot_token: token,
      chat_id: chatId,
      mode: mode,
      transport: transport,
      enabled: enableFlag
    });

    success('Telegram configuration updated successfully.');
    info(`Mode: ${updated.mode} | Enabled: ${updated.enabled ? 'Yes' : 'No'} | Chat ID: ${updated.chat_id || '(none)'}`);
    return;
  }

  if (sub === 'enable') {
    tgConfig.setTelegramEnabled(true);
    success('Telegram integration enabled.');
    return;
  }

  if (sub === 'disable') {
    tgConfig.setTelegramEnabled(false);
    tgPoller.stopPoller();
    success('Telegram integration disabled.');
    return;
  }

  if (sub === 'test') {
    info('Dispatching test notification to configured Telegram chat...');
    const res = await tgNotifier.sendTestPing();
    if (res.ok) {
      success('Test message sent successfully! Check your Telegram chat.');
    } else {
      error(`Failed to send test message: ${res.error || 'Unknown error'}`);
    }
    return;
  }

  if (sub === 'notify-kage' || sub === 'test-gate') {
    info('Dispatching Kage final gate review notification to Telegram...');
    const summaryArg = subArgs.join(' ') || 'Kage Review Gate verified: APPROVED (100% confidence, 0 AI slop findings).';
    const res = await tgNotifier.notifyKageReviewPassed({
      title: 'Kage Final Gate Review: APPROVED',
      summary: summaryArg,
      kageScore: 100,
      slopFindings: 0
    });
    if (res.ok) {
      success('Kage review gate notification delivered to Telegram!');
    } else {
      error(`Failed to send gate notification: ${res.error || 'Unknown error'}`);
    }
    return;
  }

  if (sub === 'start-poller') {
    tgPoller.startPoller();
    success('Telegram polling listener started.');
    return;
  }

  if (sub === 'stop-poller') {
    tgPoller.stopPoller();
    success('Telegram polling listener stopped.');
    return;
  }

  error(`Unknown telegram command: ${sub}. Run "konoha telegram help" for usage.`);
}



module.exports = {
  cmdTelegram,
};
