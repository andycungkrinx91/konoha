"use strict";

/**
 * bin/commands/webhook.js — Webhook Integration CLI Management.
 */

const { info, error, success, header } = require("../lib/format");
const wm = require('../../src/webhook_manager');

async function cmdWebhook(args) {
  const sub = args[0] || 'list';
  const subArgs = args.slice(1);

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    info('Usage: konoha webhook <command>');
    info('Commands:');
    info('  list                             List configured outbound webhooks');
    info('  add <name> <url> [options]       Add a new outbound webhook');
    info('    --auth <none|bearer|api_key|jwt|custom_header>');
    info('    --token <secret_token_or_key>');
    info('    --header <custom_header_name>');
    info('  test <id>                        Dispatch immediate test payload to webhook');
    info('  delete <id>                      Remove a webhook integration');
    info('  enable <id>                      Enable webhook delivery');
    info('  disable <id>                     Disable webhook delivery');
    return;
  }

  if (sub === 'list' || sub === 'ls') {
    header('Configured Outbound Webhooks');
    const list = wm.listWebhooks();
    if (list.length === 0) {
      info('No webhooks configured. Run "konoha webhook add <name> <url>" to create one.');
      return;
    }
    list.forEach(w => {
      const status = w.enabled ? 'ENABLED' : 'DISABLED';
      const auth = w.auth_type !== 'none' ? ` (${w.auth_type})` : '';
      info(`• [${w.id}] ${w.name}: ${w.url} [${status}]${auth}`);
      if (w.last_status) {
        info(`   Last Delivery: HTTP ${w.last_status} (${w.last_delivered_at || 'unknown'})`);
      }
    });
    return;
  }

  if (sub === 'add') {
    const name = subArgs[0];
    const url = subArgs[1];
    if (!name || !url) {
      error('Usage: konoha webhook add <name> <url> [--auth <type>] [--token <key>] [--header <custom_header>]');
      process.exit(1);
    }

    let authType = 'none';
    let authToken = '';
    let customHeader = '';

    for (let i = 2; i < subArgs.length; i++) {
      if ((subArgs[i] === '--auth' || subArgs[i] === '-a') && subArgs[i + 1]) {
        authType = subArgs[++i];
      } else if ((subArgs[i] === '--token' || subArgs[i] === '-t') && subArgs[i + 1]) {
        authToken = subArgs[++i];
      } else if ((subArgs[i] === '--header' || subArgs[i] === '-h') && subArgs[i + 1]) {
        customHeader = subArgs[++i];
      }
    }

    try {
      const created = wm.createWebhook({
        name,
        url,
        auth_type: authType,
        auth_token: authToken,
        custom_header: customHeader
      });
      success(`Webhook created successfully with ID: ${created.id}`);
      info(`Name: ${created.name} | URL: ${created.url} | Auth: ${created.auth_type}`);
    } catch (err) {
      error(`Failed to create webhook: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (sub === 'test') {
    const id = subArgs[0];
    if (!id) {
      error('Usage: konoha webhook test <id>');
      process.exit(1);
    }
    const target = wm.getWebhook(id);
    if (!target) {
      error(`Webhook not found: ${id}`);
      process.exit(1);
    }
    info(`Dispatching test payload to ${target.name} (${target.url})...`);
    const res = await wm.sendWebhookPayload(target, {
      event: 'test_ping',
      message: 'Konoha Village CLI Webhook Test',
      timestamp: new Date().toISOString()
    });
    if (res.ok) {
      success(`Test delivery succeeded! Status: HTTP ${res.status}`);
    } else {
      error(`Test delivery failed: ${res.error || `HTTP ${res.status}`}`);
    }
    return;
  }

  if (sub === 'delete' || sub === 'rm') {
    const id = subArgs[0];
    if (!id) {
      error('Usage: konoha webhook delete <id>');
      process.exit(1);
    }
    const deleted = wm.deleteWebhook(id);
    if (deleted) {
      success(`Webhook ${id} removed.`);
    } else {
      error(`Webhook not found: ${id}`);
    }
    return;
  }

  if (sub === 'enable' || sub === 'disable') {
    const id = subArgs[0];
    if (!id) {
      error(`Usage: konoha webhook ${sub} <id>`);
      process.exit(1);
    }
    try {
      const updated = wm.updateWebhook(id, { enabled: sub === 'enable' ? 1 : 0 });
      success(`Webhook ${id} is now ${updated.enabled ? 'ENABLED' : 'DISABLED'}.`);
    } catch (err) {
      error(err.message);
    }
    return;
  }

  error(`Unknown webhook command: ${sub}. Run "konoha webhook help" for usage.`);
}

module.exports = {
  cmdWebhook
};
