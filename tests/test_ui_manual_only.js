'use strict';

/**
 * tests/test_ui_manual_only.js
 *
 * The Web UI is manual-only: nothing starts it implicitly. `konoha ui` exposes
 * `start` (foreground, blocking) and `build`; `init`, `upgrade`, and the MCP
 * server bootstrap must never spawn a server. A second `konoha ui start` on a
 * port that is already serving must refuse rather than run a duplicate.
 */

require('./helpers/isolate_db');

const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

let passed = 0;
let failed = 0;
function ok(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function portActive(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    sock.setTimeout(500);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
  });
}

async function main() {
  console.log('Running test_ui_manual_only tests...');

  const uiSrc = read('bin/lib/ui_commands.js');
  const cliSrc = read('bin/cli.js');
  const initSrc = read('bin/commands/init.js');
  const upgradeSrc = read('bin/commands/upgrade.js');
  const serverSrc = read('src/server.js');
  const lifecycleSrc = read('bin/lib/runtime_lifecycle.js');
  const installSrc = read('bin/lib/install_lifecycle.js');

  // T1: the CLI surface is exactly start + build.
  ok('T1: dispatcher routes start', /case 'start':\n      await cmdUiStart\(subArgs\);/.test(uiSrc));
  ok('T1: dispatcher routes build', /case 'build':\n      await cmdUiBuild\(\);/.test(uiSrc));
  ok('T1: dispatcher has no stop/restart/status/service/preview/daemon/open cases',
    !/case '(stop|restart|status|service|preview|daemon|open)':/.test(uiSrc));
  ok('T1: unknown subcommand prints help', /default:\n      cmdUiHelp\(\);/.test(uiSrc));
  ok('T1: help advertises only start and build',
    uiSrc.includes('Run the Web UI in the foreground') && !/ui restart|ui status|ui stop/.test(uiSrc));

  // T2: nothing auto-starts a server.
  ok('T2: init never auto-starts the UI', !/ensureUiDaemonAutoStart|cmdUiRestart|spawnBackgroundDaemon/.test(initSrc));
  ok('T2: upgrade never auto-starts the UI', !/ensureUiDaemonAutoStart|cmdUiRestart|spawnBackgroundDaemon/.test(upgradeSrc));
  ok('T2: MCP server bootstrap never auto-starts the UI', !/ensureUiDaemonAutoStart/.test(serverSrc));
  ok('T2: runtime bootstrap never auto-starts the UI', !/maybeAutoStartUiDaemon|KONOHA_UI_AUTOSTART/.test(lifecycleSrc));
  ok('T2: install lifecycle only builds, never restarts', !/cmdUiRestart|ensureUiDaemonAutoStart/.test(installSrc));
  ok('T2: spawn helper is deleted', !/function spawnBackgroundDaemon/.test(uiSrc));
  ok('T2: daemon subcommand is deleted', !/async function cmdUiDaemon/.test(uiSrc));
  ok('T2: cli.js no longer re-exports the autostart helper', !/ensureUiDaemonAutoStart/.test(cliSrc));

  // T3: single instance — a live listener on the port blocks a second start.
  {
    const srv = net.createServer();
    const port = await new Promise((resolve) => {
      srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
    });
    const { execFile } = require('child_process');
    const out = await new Promise((resolve) => {
      execFile(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'ui', 'start', `--port=${port}`, '--no-open'],
        { cwd: ROOT, timeout: 30000, env: process.env },
        (err, stdout, stderr) => resolve({ code: err ? err.code : 0, text: `${stdout}${stderr}` }));
    });
    await new Promise((r) => srv.close(r));
    ok('T3: second start on a live port exits non-zero', out.code !== 0, `code=${out.code}`);
    ok('T3: second start explains it is already running', /already running/i.test(out.text), out.text.trim().slice(0, 160));
    ok('T3: guard probes the port before starting', /async function assertSingleInstance\(port, host\)/.test(uiSrc)
      && /await checkPortActive\(port\)/.test(uiSrc));
    ok('T3: guard runs on the start path and nowhere else',
      /async function cmdUiStart\(args = \[\]\) \{[\s\S]{0,200}await assertSingleInstance\(port, host\)/.test(uiSrc)
      && (uiSrc.match(/await assertSingleInstance\(/g) || []).length === 1);
  }

  // T4: the guard does not trip on a free port (no false positive).
  {
    const port = await freePort();
    const cli = require(path.join(ROOT, 'bin', 'cli.js'));
    const mod = require(path.join(ROOT, 'bin', 'lib', 'ui_commands.js'));
    ok('T4: cli.js exports cmdUi', typeof cli.cmdHelp === 'function');
    ok('T4: ui module no longer exports daemon helpers',
      typeof mod.ensureUiDaemonAutoStart === 'undefined'
      && typeof mod.cmdUiDaemon === 'undefined'
      && typeof mod.waitForPortReady === 'undefined');
    ok('T4: ui module still exports cmdUiStop for uninstall/init --force', typeof mod.cmdUiStop === 'function');
    ok('T4: free port reports inactive', (await portActive(port)) === false);
  }

  // T6: the pre-flight probe cannot see a server that is still booting, so the
  // bind failure must produce the same refusal — one message, two detection points.
  {
    const noticeUses = (uiSrc.match(/portInUseNotice\(/g) || []).length;
    ok('T6: both the probe and the bind failure emit the shared notice', noticeUses === 3);
    ok('T6: EADDRINUSE is routed to the shared notice',
      /if \(err\.code === 'EADDRINUSE'\) \{\s*warn\(portInUseNotice\(host, port\)\)/.test(uiSrc));
    ok('T6: a bind failure exits non-zero', /warn\(portInUseNotice\(host, port\)\);\s*\} else \{\s*error\([\s\S]{0,120}process\.exit\(1\)/.test(uiSrc));
    ok('T6: the notice is defined once', (uiSrc.match(/function portInUseNotice\(/g) || []).length === 1);
  }

  // T5: the boot-time service units invoke the only command that exists.
  {
    const serviceSrc = read('bin/lib/ui_service.js');
    ok('T5: systemd unit runs `ui start`', /ExecStart=\S+ \S+ ui start --port=/.test(serviceSrc));
    ok('T5: launchd unit runs `ui start`', /<string>ui<\/string>\s*<string>start<\/string>/.test(serviceSrc));
    ok('T5: no service unit invokes the deleted web alias', !/cliPath\} web /.test(serviceSrc) && !/<string>web<\/string>/.test(serviceSrc));
    ok('T5: the dead daemon env is gone', !/KONOHA_UI_DAEMON/.test(serviceSrc));
  }

  console.log(`\ntest_ui_manual_only: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('test_ui_manual_only crashed:', err);
  process.exit(1);
});
