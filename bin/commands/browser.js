'use strict';

/**
 * bin/commands/browser.js — CLI interface for Konoha's Live Headed Browser Workspace
 * across Linux, macOS, and Windows Docker hosts.
 */

const { C, log, info, error, success, header } = require('../lib/format');
const { defaultBrowserSessionManager } = require('../../src/workflow/qa-automation/browser_session_manager');
const qaTools = require('../../src/workflow/qa-automation/qa_tools');

function cmdBrowserHelp() {
  log(`
${C.cyan}konoha browser${C.reset} — Manage isolated live headed Docker browser workspaces

${C.bold}USAGE${C.reset}
  konoha browser <subcommand> [options]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}start [--url <url>] [--project <dir>] [--playwright-ui] [--build-image]${C.reset}
  ${C.cyan}status${C.reset}
  ${C.cyan}logs <session_id> [--tail <n>]${C.reset}
  ${C.cyan}stop <session_id>${C.reset}
  ${C.cyan}cleanup${C.reset}
  ${C.cyan}qa [--project <dir>] [--grep <pattern>] [--headed] [--playwright-ui]${C.reset}
`);
}

function _parseOpts(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--url' && args[i + 1]) opts.url = args[++i];
    else if (a === '--project' && args[i + 1]) opts.projectPath = args[++i];
    else if (a === '--build-id' && args[i + 1]) opts.buildId = args[++i];
    else if (a === '--grep' && args[i + 1]) opts.grep = args[++i];
    else if (a === '--tail' && args[i + 1]) opts.tail = parseInt(args[++i], 10);
    else if (a === '--playwright-ui') opts.playwrightUi = true;
    else if (a === '--build-image') opts.autoBuild = true;
    else if (a === '--headed') opts.headed = true;
    else if (a === '--no-reuse') opts.reuse = false;
    else if (!a.startsWith('-') && !opts.positional) opts.positional = a;
  }
  return opts;
}

async function cmdBrowser(args = []) {
  const sub = args[0];
  const rest = args.slice(1);
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    cmdBrowserHelp();
    return;
  }

  const opts = _parseOpts(rest);
  try {
    if (sub === 'start') {
      const sess = await defaultBrowserSessionManager.createSession({
        targetUrl: opts.url || '',
        projectPath: opts.projectPath || process.cwd(),
        buildId: opts.buildId || undefined,
        playwrightUi: Boolean(opts.playwrightUi),
        autoBuild: Boolean(opts.autoBuild),
        reuse: opts.reuse !== false
      });
      success(`Live browser session ready (${sess.session_id})`);
      log(`  Viewer URL:   ${C.cyan}${sess.viewer_url}${C.reset}`);
      log(`  VNC Password: ${sess.vnc_password}`);
      log(`  Build ID:     ${sess.build_id}`);
      if (sess.playwright_ui_url) log(`  Playwright UI: ${sess.playwright_ui_url}`);
      return;
    }

    if (sub === 'status') {
      header('Konoha Browser Workspaces');
      const docker = defaultBrowserSessionManager.isDockerAvailable();
      info(`Docker: ${docker.available ? `available (${docker.version || 'ok'})` : 'unavailable'}`);
      const list = defaultBrowserSessionManager.listSessions({ includeStopped: true });
      if (list.length === 0) {
        log('  No browser sessions recorded.');
        return;
      }
      for (const s of list) {
        log(`  - ${s.session_id} [${s.status}] build=${s.build_id} viewer=${s.viewer_url}`);
      }
      return;
    }

    if (sub === 'logs') {
      if (!opts.positional) {
        error('Usage: konoha browser logs <session_id>');
        process.exit(1);
      }
      const res = defaultBrowserSessionManager.getSessionLogs(opts.positional, { tail: opts.tail || 50 });
      if (!res) {
        error(`Session '${opts.positional}' not found.`);
        process.exit(1);
      }
      for (const entry of res.logs) {
        log(`[${entry.ts}] [${entry.stream}] ${entry.text}`);
      }
      return;
    }

    if (sub === 'stop') {
      if (!opts.positional) {
        error('Usage: konoha browser stop <session_id>');
        process.exit(1);
      }
      const res = await defaultBrowserSessionManager.stopSession(opts.positional, { reason: 'cli_stop' });
      if (!res.found) {
        error(`Session '${opts.positional}' not found.`);
        process.exit(1);
      }
      success(`Stopped browser session ${opts.positional}.`);
      return;
    }

    if (sub === 'cleanup') {
      const res = defaultBrowserSessionManager.cleanupStaleSessions();
      success(`Cleaned up ${res.cleaned_count} stale browser workspace(s).`);
      return;
    }

    if (sub === 'qa') {
      const res = await qaTools.qaE2eRunAsync({
        project_path: opts.projectPath || process.cwd(),
        grep: opts.grep,
        headed: Boolean(opts.headed),
        live: Boolean(opts.headed),
        playwright_ui: Boolean(opts.playwrightUi)
      });
      log(JSON.stringify(res, null, 2));
      if (res.status === 'failed' || res.status === 'error') process.exit(1);
      return;
    }

    error(`Unknown browser subcommand: ${sub}`);
    cmdBrowserHelp();
    process.exit(1);
  } catch (err) {
    error(`Browser workspace error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { cmdBrowser, cmdBrowserHelp };
