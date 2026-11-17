#!/usr/bin/env node
'use strict';

/**
 * Regression coverage for the four defects that made "spawn never happens":
 *
 *  1. OMP exports no OMP_* marker of its own, so the PI branch in
 *     detectActiveClient() claimed every OMP session and every fresh CLI
 *     process reported client=pi → UNSUPPORTED_NATIVE_SPAWN.
 *  2. `omp -p --agent <name>` is not a valid invocation: oclif rejects
 *     `--agent` with exit 2, so the omp harness branch could never launch.
 *  3. `run-agent --execute --client cli` refused to launch even though a
 *     harness binary was installed, because `cli` has no native subagent tool.
 *  4. The advertised CLI fallback omitted `--task` and `--execute`, so it
 *     printed another directive instead of spawning anything.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SPAWNER = path.join(REPO_ROOT, 'src', 'mcp', 'subagent_spawner.js');
const DETECTION = path.join(REPO_ROOT, 'src', 'mcp', 'client_detection.js');
const LAZY = path.join(REPO_ROOT, 'src', 'mcp', 'lazy_subagent.js');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`✗ ${name}\n  ${err && err.message}`);
  }
}

/** Runs `detectActiveClient()` in a clean child so ambient harness vars cannot leak in. */
function detectWith(env) {
  const script = `
    const { detectActiveClient } = require(${JSON.stringify(DETECTION)});
    process.stdout.write(JSON.stringify({ client: detectActiveClient() }));
  `;
  const base = { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, SystemRoot: process.env.SystemRoot };
  const run = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...base, ...env }
  });
  assert.strictEqual(run.status, 0, `detection probe failed: ${run.stderr}`);
  return JSON.parse(run.stdout).client;
}

check('1. OMP sessions resolve to the omp harness, not pi', () => {
  // OMP's real environment: PI variable names, OMP state directory.
  assert.strictEqual(
    detectWith({ PI_SESSION_FILE: '/home/u/.omp/agent/sessions/2026-11-17T01-58-03-761Z_01a1e739.jsonl', PI_SESSION_ID: '01a1e739' }),
    'omp',
    'an OMP session file under ~/.omp must not be reported as pi'
  );
  assert.strictEqual(
    detectWith({ PI_SESSION_FILE: 'C:\\Users\\u\\.omp\\agent\\sessions\\s.jsonl' }),
    'omp',
    'Windows OMP state paths must resolve to omp'
  );
  assert.strictEqual(
    detectWith({ PI_CODING_AGENT_DIR: '/home/u/.omp/agent' }),
    'omp',
    'PI_CODING_AGENT_DIR pointing at ~/.omp must resolve to omp'
  );
  assert.strictEqual(
    detectWith({ OMP_SESSION_FILE: '/home/u/.omp/agent/sessions/s.jsonl' }),
    'omp',
    'OMP_SESSION_FILE must resolve to omp'
  );
});

check('2. Real PI sessions still resolve to pi', () => {
  assert.strictEqual(
    detectWith({ PI_SESSION_FILE: '/home/u/.pi/agent/sessions/--path--/s.jsonl' }),
    'pi',
    'PI state directories must keep resolving to pi'
  );
  assert.strictEqual(detectWith({ PI_SESSION_ID: 'abc' }), 'pi', 'a bare PI_SESSION_ID must still resolve to pi');
  assert.strictEqual(detectWith({ PI_CODING_AGENT: '1' }), 'pi', 'PI_CODING_AGENT must still resolve to pi');
  assert.strictEqual(detectWith({}), 'unattributed', 'an empty environment must stay unattributed');
});

check('3. ACTIVE_CLIENT still outranks harness inference', () => {
  assert.strictEqual(detectWith({ ACTIVE_CLIENT: 'cursor', PI_SESSION_FILE: '/home/u/.omp/agent/sessions/s.jsonl' }), 'cursor');
  assert.strictEqual(detectWith({ KONOHA_CLIENT: 'codex', PI_SESSION_FILE: '/home/u/.omp/agent/sessions/s.jsonl' }), 'codex');
});

const spawner = require(SPAWNER);

check('4. The omp harness invocation is one omp actually accepts', () => {
  // Assert the raw invocation, not `buildHarnessCommand`: on a Windows machine that
  // has omp installed the platform wrapper returns the ComSpec form, which is the
  // fix working, not the argv contract being tested here.
  const spec = spawner.buildRawHarnessInvocation('omp', { agent: 'genin', prompt: 'do the slice', readOnly: false });
  assert.ok(spec && spec.command === 'omp', 'omp must map to the omp binary');
  assert.ok(!spec.args.includes('--agent'), 'omp has no --agent flag; passing it makes every spawn exit 2');
  assert.strictEqual(spec.args[0], '-p', 'omp needs -p for non-interactive execution');
  assert.strictEqual(spec.args[spec.args.length - 1], 'do the slice', 'the prompt must be the trailing positional');
  assert.ok(
    spec.args.join(' ').includes('genin'),
    'the specialist identity must still reach the child through the appended system prompt'
  );
  assert.ok(spawner.buildHarnessCommand('omp', { agent: 'genin', prompt: 'do the slice' }), 'the platform wrapper must still produce a launchable spec');
});

check('5. Every registered harness still yields a non-empty invocation', () => {
  for (const client of ['claude', 'cursor', 'codex', 'opencode', 'commandcode', 'omp', 'antigravity', 'pi']) {
    const spec = spawner.buildHarnessCommand(client, { agent: 'anbu', prompt: 'x' });
    assert.ok(spec && Array.isArray(spec.args) && spec.args.length > 0, `${client} must produce a harness invocation`);
  }
  assert.strictEqual(spawner.buildHarnessCommand('not-a-harness', { agent: 'anbu', prompt: 'x' }), null);
});

const originalPath = process.env.PATH;

function withPath(dir, fn) {
  process.env.PATH = dir;
  try {
    return fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

check('6. A real child process launches on the installed harness, not on native-tool support', () => {
  const tempBin = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-spawn-bin-'));
  try {
    const fake = path.join(tempBin, process.platform === 'win32' ? 'omp.cmd' : 'omp');
    fs.writeFileSync(fake, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const resolved = withPath(tempBin, () => {
      const capability = spawner.validateSpawnCapability('cli', { execute: true });
      assert.strictEqual(capability.ok, true, 'cli + execute must launch when a harness binary exists');
      assert.strictEqual(capability.client, 'omp', 'the installed harness becomes the spawn client');
      return spawner.resolveInstalledHarnessClient();
    });
    assert.strictEqual(resolved, 'omp', 'the installed harness probe must find the binary on PATH');
    assert.strictEqual(spawner.findExecutableOnPath('definitely-not-installed-xyz'), null);
  } finally {
    fs.rmSync(tempBin, { recursive: true, force: true });
  }
});

check('7. With no harness installed, cli + execute still fails closed', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-empty-bin-'));
  try {
    withPath(emptyDir, () => {
      assert.strictEqual(spawner.resolveInstalledHarnessClient(), null);
      const capability = spawner.validateSpawnCapability('cli', { execute: true });
      assert.strictEqual(capability.ok, false, 'no installed harness must fail closed, not crash');
      assert.strictEqual(capability.payload.error_code, 'UNSUPPORTED_NATIVE_SPAWN');
      assert.ok(/No headless harness invocation configured/.test(capability.payload.error), capability.payload.error);
    });
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

check('8. Directive-only mode stays directive-only', () => {
  const capability = spawner.validateSpawnCapability('cli', {});
  assert.strictEqual(capability.ok, true);
  assert.strictEqual(capability.client, 'cli');
  assert.strictEqual(capability.descriptor.tool, null, 'without --execute the CLI bridge must not claim a spawn tool');
});

check('9. pi still fails closed without the pi-subagents extension', () => {
  const capability = spawner.validateSpawnCapability('pi', {});
  assert.strictEqual(capability.ok, false);
  assert.strictEqual(capability.payload.error_code, 'UNSUPPORTED_NATIVE_SPAWN');
  assert.strictEqual(spawner.validateSpawnCapability('unknown-client', {}).ok, false);
});

check('10. The advertised CLI fallback actually spawns', () => {
  const { buildSpawnDirective } = require(LAZY);
  const directive = buildSpawnDirective({
    client: 'cli',
    agent: 'anbu',
    prompt: "Fix the 'broken' parser; echo $HOME and `date`",
    projectPath: REPO_ROOT
  });
  assert.ok(directive.includes('## Spawn (mandatory)'), `expected a spawn directive, got: ${directive}`);
  const fallback = directive.match(/CLI fallback: `([^`]+)`/);
  assert.ok(fallback, `directive must advertise a CLI fallback: ${directive}`);
  const command = fallback[1];
  assert.ok(command.includes('run-agent'), command);
  assert.ok(command.includes('--task '), `fallback must pass --task, which the parser requires: ${command}`);
  assert.ok(command.includes('--execute'), `fallback must pass --execute or it only prints another directive: ${command}`);
  assert.ok(command.includes("'\\''"), `fallback must POSIX-quote the task text: ${command}`);
});

check('11. The parallel CLI fallback actually spawns', () => {
  const { buildParallelSpawnDirective } = require(LAZY);
  const directive = buildParallelSpawnDirective({
    client: 'cli',
    dispatches: [
      { agent: 'genin', task: 'explore', domain: 'explore' },
      { agent: 'anbu', task: 'fix', domain: 'fix' }
    ],
    projectPath: REPO_ROOT
  });
  assert.ok(directive.includes('--parallel'), directive);
  assert.ok(directive.includes('--execute'), `parallel fallback must execute: ${directive}`);
  assert.ok(directive.includes('--task '), `parallel fallback must pass --task: ${directive}`);
});

check('12. The omp `task` call matches the schema omp actually validates', () => {
  // Mirrors OMP's own definition, which is `.raw({... "+": "delete"})`: unknown
  // keys are dropped silently, so a typo loses data instead of failing loudly.
  const OMP_ITEM_KEYS = ['name', 'agent', 'task', 'solutionSpace', 'outputSchema', 'schemaMode', 'tools', 'isolated'];
  const OMP_ITEM_REQUIRED = ['agent', 'task', 'solutionSpace'];
  const OMP_TOP_KEYS = ['context', 'tasks'];
  const OMP_TOP_REQUIRED = ['context', 'tasks'];

  const { buildSpawnDirective } = require(LAZY);
  const directive = buildSpawnDirective({
    client: 'omp',
    agent: 'genin',
    prompt: 'Explore the parser',
    projectPath: REPO_ROOT,
    worktreePath: '/tmp/wt-schema-probe'
  });
  const nativeCall = directive.match(/Spawn `genin` via `(.+?)` \(CLI fallback/);
  assert.ok(nativeCall, `omp must get a native task() call: ${directive}`);
  const call = nativeCall[1];
  assert.ok(call.startsWith('task('), call);

  const topKeys = [...call.matchAll(/(?:^task\(|, )([A-Za-z_][A-Za-z0-9_]*)=/g)].map((m) => m[1]);
  for (const key of topKeys) {
    assert.ok(OMP_TOP_KEYS.includes(key), `"${key}" is not in omp's task schema and would be dropped: ${call}`);
  }
  for (const key of OMP_TOP_REQUIRED) {
    assert.ok(topKeys.includes(key), `omp requires top-level "${key}": ${call}`);
  }

  const itemBody = call.match(/tasks=\[\{([\s\S]*)\}\]\)$/);
  assert.ok(itemBody, `expected a single task item: ${call}`);
  const itemKeys = [...itemBody[1].matchAll(/(?:^|, )([A-Za-z_][A-Za-z0-9_]*):/g)].map((m) => m[1]);
  for (const key of itemKeys) {
    assert.ok(OMP_ITEM_KEYS.includes(key), `"${key}" is not in omp's task item schema and would be dropped: ${call}`);
  }
  for (const key of OMP_ITEM_REQUIRED) {
    assert.ok(itemKeys.includes(key), `omp requires item key "${key}": ${call}`);
  }
  assert.ok(!itemKeys.includes('cwd'), `cwd is not in the item schema; the worktree must ride in the task text: ${call}`);
  assert.ok(!itemKeys.includes('isolated'), `isolated would provision a second checkout on top of Konoha's worktree: ${call}`);
  const contextValue = call.match(/^task\(context=("(?:[^"\\]|\\.)*")/);
  assert.ok(contextValue, `context must be a string literal: ${call}`);
  assert.ok(!contextValue[1].includes('Explore the parser'), `context is the shared envelope and must not repeat the per-task body: ${call}`);
  assert.ok(!contextValue[1].includes('/tmp/wt-schema-probe'), `the worktree belongs in the task text, not in shared context: ${call}`);
  assert.ok(call.includes('/tmp/wt-schema-probe'), `the worktree path must still reach the child: ${call}`);
});

check('13. Windows `.cmd` harness shims are launched through ComSpec, not spawned directly', () => {
  // Node refuses to spawn a `.cmd`/`.bat` without a shell (EINVAL since the
  // CVE-2024-27980 fix), so npm/pnpm-installed harnesses could never launch on
  // Windows. The probe runs in a child because `process.platform` is pinned there.
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-shim-'));
  const exeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-exe-'));
  fs.writeFileSync(path.join(shimDir, 'omp.cmd'), '@echo off\r\n');
  fs.writeFileSync(path.join(exeDir, 'claude.exe'), 'MZ');

  const probe = (dir, prompt) => {
    const script = `
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.PATHEXT = '.com;.exe;.bat;.cmd';
      process.env.ComSpec = 'C:\\\\Windows\\\\system32\\\\cmd.exe';
      const spawner = require(${JSON.stringify(SPAWNER)});
      const spec = spawner.buildHarnessCommand('${dir === shimDir ? 'omp' : 'claude'}', {
        agent: 'genin',
        prompt: ${JSON.stringify(prompt)},
        readOnly: false
      });
      process.stdout.write(JSON.stringify(spec));
    `;
    const run = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      // Windows children need SystemRoot and USERPROFILE: the module graph reaches
      // `os.homedir()`, and a real `windows-latest` run must not die before asserting.
      env: {
        PATH: dir,
        PATHEXT: '.com;.exe;.bat;.cmd',
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec
      }
    });
    assert.strictEqual(run.status, 0, `shim probe failed: ${run.stderr}`);
    return JSON.parse(run.stdout);
  };

  const shim = probe(shimDir, 'line one\nline two');
  assert.strictEqual(shim.command, 'C:\\Windows\\system32\\cmd.exe', 'a .cmd shim must go through ComSpec');
  assert.deepStrictEqual(shim.args.slice(0, 3), ['/d', '/s', '/c'], shim.args.join(' '));
  assert.strictEqual(shim.args.length, 4, 'cmd.exe takes one command-line argument after /c');
  assert.strictEqual(shim.windowsVerbatimArguments, true, 'cmd.exe needs an unquoted command line');
  const line = shim.args[3];
  assert.ok(line.startsWith('"') && line.endsWith('"'), 'the outer pair is what /s strips');
  assert.ok(line.includes('omp.cmd'), `the resolved shim path must be used: ${line}`);
  assert.ok(line.includes('"-p"'), `flags must stay separate argv tokens: ${line}`);
  assert.ok(!line.includes('\n'), `cmd.exe treats a newline as a command separator: ${line}`);
  assert.ok(line.includes('line one line two'), `the prompt must survive flattened, not truncated: ${line}`);

  const exe = probe(exeDir, 'do the slice');
  assert.strictEqual(exe.command, path.join(exeDir, 'claude.exe'), 'a real executable is spawned directly');
  assert.ok(!exe.windowsVerbatimArguments, 'a direct spawn keeps Node quoting its own argv');
});

check('14. A reported MCP client name cannot resolve OMP to Pi', () => {
  const { resolveClientFromInfo } = require(path.join(REPO_ROOT, 'src', 'mcp', 'protocol.js'));
  assert.strictEqual(resolveClientFromInfo({ name: 'omp' }), 'omp');
  assert.strictEqual(resolveClientFromInfo({ name: 'OMP' }), 'omp');
  assert.strictEqual(resolveClientFromInfo({ name: 'pi' }), 'pi');
  assert.strictEqual(resolveClientFromInfo({ name: 'omp-pi-bridge' }), 'omp', 'the more specific harness wins');
});

check('15. A same-named file that cannot be executed is not a harness', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-noexec-'));
  try {
    const spawner = require(SPAWNER);
    const fake = path.join(dir, 'omp');
    fs.writeFileSync(fake, 'not a program\n', { mode: 0o644 });
    if (process.platform !== 'win32') fs.chmodSync(fake, 0o644);
    assert.strictEqual(
      withPath(dir, () => spawner.findExecutableOnPath('omp')),
      null,
      process.platform === 'win32'
        ? 'a file with no PATHEXT extension is not runnable on Windows'
        : 'POSIX must not select a file it cannot execute'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('16. A timeout kills the whole process tree, not just the launcher', () => {
  const spawner = require(SPAWNER);
  const graceful = spawner.windowsKillInvocation(4242, false);
  assert.deepStrictEqual(
    graceful.args.slice(0, 4),
    ['/pid', '4242', '/T'],
    'without /T the .cmd harness outlives the cmd.exe launcher it runs under'
  );
  assert.ok(!graceful.args.includes('/F'), 'the graceful pass must give the child time to exit');
  assert.deepStrictEqual(spawner.windowsKillInvocation(4242, true).args, ['/pid', '4242', '/T', '/F']);
});

const summary = `${passed} passed, ${failures.length} failed`;
console.log(`\n${summary}`);
if (failures.length > 0) {
  for (const f of failures) console.error(`\nFAILED: ${f.name}\n${f.err && f.err.stack}`);
  process.exit(1);
}
console.log('All spawn harness contract tests passed!');
