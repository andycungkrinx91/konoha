'use strict';

/**
 * bin/commands/browser.js — CLI interface for Konoha's Live Headed Browser Workspace
 * across Linux, macOS, and Windows Docker hosts.
 */

const path = require('path');
const { C, log, info, error, success, header } = require('../lib/format');
const { defaultBrowserSessionManager } = require('../../src/workflow/qa-automation/browser_session_manager');
const qaTools = require('../../src/workflow/qa-automation/qa_tools');

const SESSION_ID_RE = /^bs-[A-Za-z0-9-]+$/;
const CONTAINER_ARTIFACTS = '/artifacts';

function cmdBrowserHelp() {
  log(`
${C.cyan}konoha browser${C.reset} — Manage isolated live headed Docker browser workspaces

${C.bold}USAGE${C.reset}
  konoha browser <subcommand> [options]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}open [--url <url>] [--project <dir>] [--build-image] [--no-reuse]${C.reset}
  ${C.cyan}interact <session_id> --action <action> [--target <sel>] [--value <text>] [--url <url>]${C.reset}
  ${C.cyan}shot <session_id> [--full-page]${C.reset}
  ${C.cyan}status${C.reset}
  ${C.cyan}logs <session_id> [--tail <n>]${C.reset}
  ${C.cyan}stop <session_id>${C.reset}
  ${C.cyan}cleanup${C.reset}
  ${C.cyan}qa [--project <dir>] [--grep <pattern>] [--live] [--start-url <url>] [--keep-session]${C.reset}

${C.bold}EXAMPLES${C.reset}
  konoha browser open --url http://localhost:5173 --project .
  konoha browser interact bs-abc123 --action click --target "text=Sign in"
  konoha browser shot bs-abc123
  konoha browser qa --live --start-url http://localhost:4173
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
    else if (a === '--action' && args[i + 1]) opts.action = args[++i];
    else if (a === '--target' && args[i + 1]) opts.target = args[++i];
    else if (a === '--value' && args[i + 1]) opts.value = args[++i];
    else if (a === '--key' && args[i + 1]) opts.key = args[++i];
    else if (a === '--start-url' && args[i + 1]) opts.startUrl = args[++i];
    else if (a === '--build-image') opts.autoBuild = true;
    else if (a === '--headed') opts.headed = true;
    else if (a === '--live') opts.live = true;
    else if (a === '--keep-session') opts.keepSession = true;
    else if (a === '--full-page') opts.fullPage = true;
    else if (a === '--no-reuse') opts.reuse = false;
    else if (!a.startsWith('-') && !opts.positional) opts.positional = a;
  }
  return opts;
}

function _requireSessionId(opts, usage) {
  const id = String(opts.positional || '');
  if (!SESSION_ID_RE.test(id)) {
    error(usage);
    process.exit(1);
  }
  return id;
}

/** Container paths are only meaningful inside the container; map them back for the user. */
function _hostArtifactPath(session, containerPath) {
  const p = String(containerPath || '');
  if (!session || !session.artifacts_path || !p.startsWith(`${CONTAINER_ARTIFACTS}/`)) return p;
  return path.join(session.artifacts_path, p.slice(CONTAINER_ARTIFACTS.length + 1));
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
    if (sub === 'open' || sub === 'start') {
      const sess = await defaultBrowserSessionManager.createSession({
        targetUrl: opts.url || '',
        projectPath: opts.projectPath || process.cwd(),
        buildId: opts.buildId || undefined,
        autoBuild: Boolean(opts.autoBuild),
        reuse: opts.reuse !== false
      });
      success(`Live browser session ready (${sess.session_id})`);
      log(`  Viewer URL:   ${C.cyan}${sess.viewer_url}${C.reset}`);
      log(`  VNC Password: ${sess.vnc_password}`);
      log(`  Build ID:     ${sess.build_id}`);
      if (sess.artifacts_path) log(`  Artifacts:    ${sess.artifacts_path}`);
      log(`  Next:         ${C.cyan}konoha browser status${C.reset} | interact | shot | stop ${sess.session_id}`);
      return;
    }

    if (sub === 'interact') {
      const sessionId = _requireSessionId(opts, 'Usage: konoha browser interact <bs-session-id> --action <action> [--target <selector>] [--value <text>]');
      const action = opts.action || 'status';
      const command = { action };
      if (opts.target) command.target = opts.target;
      if (opts.value !== undefined) command.value = opts.value;
      if (opts.key) command.key = opts.key;
      if (opts.url) command.url = opts.url;
      if (opts.buildId) command.build_id = opts.buildId;
      const res = await defaultBrowserSessionManager.interact(sessionId, command);
      log(JSON.stringify(res, null, 2));
      return;
    }

    if (sub === 'shot') {
      const sessionId = _requireSessionId(opts, 'Usage: konoha browser shot <bs-session-id> [--full-page]');
      const session = defaultBrowserSessionManager.getSession(sessionId);
      const res = await defaultBrowserSessionManager.interact(sessionId, {
        action: 'screenshot',
        fullPage: Boolean(opts.fullPage)
      });
      res.path = _hostArtifactPath(session, res.path);
      log(JSON.stringify(res, null, 2));
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
        log(`  - ${s.session_id} [${s.status}] build=${s.build_id} purpose=${s.purpose} viewer=${s.viewer_url}`);
      }
      return;
    }

    if (sub === 'logs') {
      const sessionId = _requireSessionId(opts, 'Usage: konoha browser logs <bs-session-id> [--tail <n>]');
      const res = defaultBrowserSessionManager.getSessionLogs(sessionId, { tail: opts.tail || 50 });
      if (!res) {
        error(`Session '${sessionId}' not found.`);
        process.exit(1);
      }
      for (const entry of res.logs) {
        log(`[${entry.ts}] [${entry.stream}] ${entry.text}`);
      }
      return;
    }

    if (sub === 'stop') {
      const sessionId = _requireSessionId(opts, 'Usage: konoha browser stop <bs-session-id>');
      const res = await defaultBrowserSessionManager.stopSession(sessionId, { reason: 'cli_stop' });
      if (!res.found) {
        error(`Session '${sessionId}' not found.`);
        process.exit(1);
      }
      success(`Stopped browser session ${sessionId}.`);
      return;
    }

    if (sub === 'cleanup') {
      const res = defaultBrowserSessionManager.cleanupStaleSessions();
      success(`Cleaned up ${res.cleaned_count} stale browser workspace(s).`);
      return;
    }

    if (sub === 'qa') {
      const live = Boolean(opts.live || opts.headed || opts.positional);
      const res = await qaTools.qaE2eRunAsync({
        project_path: opts.projectPath || process.cwd(),
        grep: opts.grep,
        headed: live,
        live,
        start_url: opts.startUrl,
        keep_session: Boolean(opts.keepSession),
        session_id: SESSION_ID_RE.test(opts.positional || '') ? opts.positional : undefined
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
